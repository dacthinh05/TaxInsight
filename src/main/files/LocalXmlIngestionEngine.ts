import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import {
  FilingType,
  LocalXmlFileEntry,
  LocalXmlImportResult,
  PeriodNormalized,
  TaxFiling,
  TaxType
} from '../../shared/types';
import { normalizeVatPeriod } from '../../shared/dateUtils';
import { ZipExtractor } from './ZipExtractor';

export class LocalXmlIngestionEngine {
  /**
   * Quét và nạp dữ liệu từ một danh sách đường dẫn tệp (file paths)
   * Có thể bao gồm cả tệp .xml và .zip
   */
  public static async ingestFiles(
    filePaths: string[],
    baseExtractionDir?: string
  ): Promise<LocalXmlImportResult> {
    const rawFiles: string[] = [];

    for (const fp of filePaths) {
      if (!fs.existsSync(fp)) continue;
      try {
        const stat = fs.statSync(fp);
        if (stat.isDirectory()) {
          const nested = this.collectXmlAndZipFiles(fp);
          rawFiles.push(...nested);
        } else if (stat.isFile()) {
          rawFiles.push(fp);
        }
      } catch {}
    }

    return this.processFileList(rawFiles, baseExtractionDir);
  }

  /**
   * Quét và nạp đệ quy toàn bộ các tệp .xml và .zip trong một thư mục
   */
  public static async ingestDirectory(
    dirPath: string,
    baseExtractionDir?: string
  ): Promise<LocalXmlImportResult> {
    if (!fs.existsSync(dirPath)) {
      return {
        success: false,
        importedCount: 0,
        skippedCount: 0,
        taxCodes: [],
        years: [],
        filings: [],
        errors: [`Thư mục không tồn tại: ${dirPath}`]
      };
    }

    const files = this.collectXmlAndZipFiles(dirPath);
    return this.processFileList(files, baseExtractionDir || dirPath);
  }

  /**
   * Thu thập đệ quy toàn bộ file .xml và .zip trong thư mục
   */
  public static collectXmlAndZipFiles(dirPath: string, accumulated: string[] = []): string[] {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          this.collectXmlAndZipFiles(fullPath, accumulated);
        } else if (entry.isFile()) {
          const lower = entry.name.toLowerCase();
          if (lower.endsWith('.xml') || lower.endsWith('.zip')) {
            accumulated.push(fullPath);
          }
        }
      }
    } catch {}
    return accumulated;
  }

  /**
   * Xử lý danh sách tệp .xml và .zip đã thu thập được
   */
  private static async processFileList(
    files: string[],
    baseExtractionDir?: string
  ): Promise<LocalXmlImportResult> {
    const entries: LocalXmlFileEntry[] = [];
    const errors: string[] = [];
    let skippedCount = 0;

    // Xử lý từng file
    for (const filePath of files) {
      const lower = filePath.toLowerCase();
      if (lower.endsWith('.zip')) {
        // Giải nén ZIP và đọc các file XML bên trong
        try {
          const zipBuffer = fs.readFileSync(filePath);
          const zip = new AdmZip(zipBuffer);
          const zipEntries = zip.getEntries();
          const extractTargetDir = baseExtractionDir
            ? path.join(baseExtractionDir, '.offline_extracted', path.basename(filePath, '.zip'))
            : path.join(path.dirname(filePath), '.offline_extracted', path.basename(filePath, '.zip'));

          if (!fs.existsSync(extractTargetDir)) {
            fs.mkdirSync(extractTargetDir, { recursive: true });
          }

          for (const ze of zipEntries) {
            if (ze.isDirectory) continue;
            if (!ze.entryName.toLowerCase().endsWith('.xml')) continue;
            
            // Tránh zip-bomb (> 50MB)
            if (ze.header.size > 50 * 1024 * 1024) continue;

            const xmlContent = ze.getData().toString('utf-8');
            const extractedFilePath = path.join(extractTargetDir, path.basename(ze.entryName));
            fs.writeFileSync(extractedFilePath, xmlContent, 'utf-8');

            const parsed = this.parseXmlContent(xmlContent, extractedFilePath);
            if (parsed) {
              entries.push(parsed);
            } else {
              skippedCount++;
            }
          }
        } catch (zipErr: unknown) {
          const msg = zipErr instanceof Error ? zipErr.message : String(zipErr);
          errors.push(`Không giải nén được file ZIP ${path.basename(filePath)}: ${msg}`);
          skippedCount++;
        }
      } else if (lower.endsWith('.xml')) {
        try {
          const xmlContent = fs.readFileSync(filePath, 'utf-8');
          const parsed = this.parseXmlContent(xmlContent, filePath);
          if (parsed) {
            entries.push(parsed);
          } else {
            skippedCount++;
          }
        } catch (readErr: unknown) {
          const msg = readErr instanceof Error ? readErr.message : String(readErr);
          errors.push(`Lỗi đọc file XML ${path.basename(filePath)}: ${msg}`);
          skippedCount++;
        }
      }
    }

    // Dedup theo filing.id (nếu cùng 1 tờ khai xuất hiện nhiều lần thì giữ bản mới nhất)
    const filingMap = new Map<string, TaxFiling>();
    const taxCodeSet = new Set<string>();
    const yearSet = new Set<number>();

    for (const entry of entries) {
      if (entry.taxCode) taxCodeSet.add(entry.taxCode);
      if (entry.periodNormalized?.year) yearSet.add(entry.periodNormalized.year);

      // Nếu có baseExtractionDir, sao chép file XML vào workspace chuẩn: {baseDir}/{taxCode}_{year}/{fileName}
      if (baseExtractionDir && fs.existsSync(baseExtractionDir) && entry.taxCode && entry.periodNormalized?.year) {
        try {
          const targetTaxDir = path.join(baseExtractionDir, `${entry.taxCode}_${entry.periodNormalized.year}`);
          if (!fs.existsSync(targetTaxDir)) {
            fs.mkdirSync(targetTaxDir, { recursive: true });
          }
          const destXmlPath = path.join(targetTaxDir, entry.fileName);
          if (path.resolve(entry.filePath) !== path.resolve(destXmlPath)) {
            fs.copyFileSync(entry.filePath, destXmlPath);
          }
          // Cập nhật đường dẫn file trong filing về thư mục workspace
          entry.filing.downloadedFiles = { xml: destXmlPath };

          // Ghi nhận vào manifest .tax_manifest.json để các engine phân tích nạp tức thì
          const manifestPath = path.join(targetTaxDir, '.tax_manifest.json');
          let manifestData: Record<string, any> = {};
          if (fs.existsSync(manifestPath)) {
            try { manifestData = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) || {}; } catch {}
          }
          manifestData[entry.filing.id] = {
            id: entry.filing.id,
            title: entry.filing.title,
            declarationCode: entry.declarationCode,
            period: entry.period,
            xmlPath: destXmlPath,
            downloadedAt: new Date().toISOString()
          };
          fs.writeFileSync(manifestPath, JSON.stringify(manifestData, null, 2), 'utf-8');
        } catch {}
      }

      filingMap.set(entry.filing.id, entry.filing);
    }

    const uniqueFilings = Array.from(filingMap.values());
    const taxCodes = Array.from(taxCodeSet);
    const years = Array.from(yearSet).sort((a, b) => a - b);

    // Xác định primaryTaxCode (MST xuất hiện nhiều nhất)
    let primaryTaxCode: string | undefined;
    if (taxCodes.length > 0) {
      const counts = new Map<string, number>();
      for (const e of entries) {
        if (e.taxCode) counts.set(e.taxCode, (counts.get(e.taxCode) || 0) + 1);
      }
      let maxCount = -1;
      for (const [code, count] of counts.entries()) {
        if (count > maxCount) {
          maxCount = count;
          primaryTaxCode = code;
        }
      }
    }

    const primaryYear = years.length > 0 ? years[years.length - 1] : undefined;

    return {
      success: uniqueFilings.length > 0,
      importedCount: uniqueFilings.length,
      skippedCount,
      taxCodes,
      primaryTaxCode,
      years,
      primaryYear,
      filings: uniqueFilings,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  /**
   * Bóc tách Metadata từ nội dung XML thuần túy
   */
  public static parseXmlContent(xmlContent: string, filePath: string): LocalXmlFileEntry | null {
    if (!xmlContent || typeof xmlContent !== 'string') return null;

    // 1. Trích xuất Mã số thuế (MST)
    const mstMatch =
      xmlContent.match(/<(?:[a-zA-Z0-9_]+:)?(?:mst|maSoThue|tin|nntMst)[^>]*>([^<]+)<\//i) ||
      xmlContent.match(/<(?:[a-zA-Z0-9_]+:)?mst\s*=\s*["']([^"']+)["']/i);
    const rawMst = mstMatch ? mstMatch[1].trim().replace(/[^a-zA-Z0-9_-]/g, '') : '';
    if (!rawMst) {
      // File XML không chứa mã số thuế -> không phải tờ khai hợp lệ
      return null;
    }

    // 2. Trích xuất Tên người nộp thuế
    const nameMatch =
      xmlContent.match(/<(?:[a-zA-Z0-9_]+:)?(?:tenNNT|tenNnt|tenNguoiNopThue)[^>]*>([^<]+)<\//i);
    const taxpayerName = nameMatch ? nameMatch[1].trim() : undefined;

    // 3. Trích xuất Mã mẫu biểu tờ khai (declarationCode) & Phân loại sắc thuế (taxType)
    let declarationCode = '';
    let taxType: TaxType = 'OTHER';
    let title = 'Tờ khai thuế điện tử';

    const maTKhaiMatch =
      xmlContent.match(/<(?:[a-zA-Z0-9_]+:)?(?:maTKhai|maHSo)[^>]*>([^<]+)<\//i);
    if (maTKhaiMatch && maTKhaiMatch[1].trim()) {
      declarationCode = maTKhaiMatch[1].trim();
    }

    // Nhận diện theo nội dung hoặc tag đặc trưng nếu maTKhai không rõ
    const cleanXml = xmlContent.toLowerCase();
    if (declarationCode.includes('01/GTGT') || cleanXml.includes('ct22') || cleanXml.includes('ct25') || cleanXml.includes('ct35') || cleanXml.includes('ct43')) {
      declarationCode = '01/GTGT';
      taxType = 'VAT';
      title = 'Tờ khai thuế GTGT (01/GTGT)';
    } else if (declarationCode.includes('02/GTGT')) {
      declarationCode = '02/GTGT';
      taxType = 'VAT';
      title = 'Tờ khai thuế GTGT dự án đầu tư (02/GTGT)';
    } else if (declarationCode.includes('03/GTGT')) {
      declarationCode = '03/GTGT';
      taxType = 'VAT';
      title = 'Tờ khai thuế GTGT theo tỷ lệ % (03/GTGT)';
    } else if (declarationCode.includes('04/GTGT')) {
      declarationCode = '04/GTGT';
      taxType = 'VAT';
      title = 'Tờ khai thuế GTGT trực tiếp (04/GTGT)';
    } else if (declarationCode.includes('05/QTT') || cleanXml.includes('05/qtt-tncn') || cleanXml.includes('ct36') || cleanXml.includes('ct41')) {
      declarationCode = '05/QTT-TNCN';
      taxType = 'PIT';
      title = 'Tờ khai quyết toán thuế TNCN (05/QTT-TNCN)';
    } else if (declarationCode.includes('05/KK') || cleanXml.includes('05/kk-tncn') || cleanXml.includes('ct21') || cleanXml.includes('ct24') || cleanXml.includes('ct34')) {
      declarationCode = '05/KK-TNCN';
      taxType = 'PIT';
      title = 'Tờ khai khấu trừ thuế TNCN (05/KK-TNCN)';
    } else if (declarationCode.includes('03/TNDN')) {
      declarationCode = '03/TNDN';
      taxType = 'CIT';
      title = 'Tờ khai quyết toán thuế TNDN (03/TNDN)';
    } else if (declarationCode.includes('01/LPMB') || declarationCode.includes('01/MBAI')) {
      declarationCode = '01/LPMB';
      taxType = 'OTHER';
      title = 'Tờ khai lệ phí môn bài (01/LPMB)';
    } else if (declarationCode) {
      title = `Tờ khai ${declarationCode}`;
    }

    // 4. Trích xuất Kỳ kê khai (period)
    let periodRaw = '';
    const kyMatch =
      xmlContent.match(/<(?:[a-zA-Z0-9_]+:)?(?:kyKKhai|kyTinhThue|kyKhaiThue)[^>]*>([^<]+)<\//i);
    if (kyMatch && kyMatch[1].trim()) {
      periodRaw = kyMatch[1].trim();
    } else {
      // Tìm theo format ngày bắt đầu / kết thúc: kyKKhaiTuNgay
      const fromMatch = xmlContent.match(/<(?:[a-zA-Z0-9_]+:)?kyKKhaiTuNgay[^>]*>([^<]+)<\//i);
      if (fromMatch && fromMatch[1].trim()) {
        periodRaw = fromMatch[1].trim();
      }
    }

    const norm = normalizeVatPeriod(periodRaw, '');
    let periodNormalized: PeriodNormalized | undefined;
    if (norm.year > 0) {
      periodNormalized = {
        raw: periodRaw || norm.label,
        type: norm.type === 'MONTH' ? 'MONTH' : norm.type === 'QUARTER' ? 'QUARTER' : 'YEAR',
        month: norm.month,
        quarter: norm.quarter,
        year: norm.year
      };
    }

    const periodStr = norm.label || periodRaw || (norm.year ? `Năm ${norm.year}` : 'Không xác định');

    // 5. Trích xuất Lần nộp & Số lần bổ sung
    let filingType: FilingType = 'ORIGINAL';
    let supplementalNo = 0;

    const soLanMatch =
      xmlContent.match(/<(?:[a-zA-Z0-9_]+:)?(?:soLan|lanBS|soLanBS)[^>]*>(\d+)<\//i);
    if (soLanMatch) {
      const parsedLan = parseInt(soLanMatch[1], 10);
      if (!isNaN(parsedLan)) {
        if (parsedLan > 0) {
          filingType = 'SUPPLEMENTAL';
          supplementalNo = parsedLan;
        } else {
          filingType = 'ORIGINAL';
          supplementalNo = 0;
        }
      }
    }

    // 6. Trích xuất Ngày nộp / Ngày lập
    let submittedAt = '';
    const dateMatch =
      xmlContent.match(/<(?:[a-zA-Z0-9_]+:)?(?:ngayNop|ngayLap|ngayKy|ngayGui)[^>]*>([^<]+)<\//i);
    if (dateMatch && dateMatch[1].trim()) {
      submittedAt = dateMatch[1].trim();
    } else {
      try {
        const stat = fs.statSync(filePath);
        const d = new Date(stat.mtime);
        submittedAt = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
      } catch {}
    }

    // 7. Tạo ID duy nhất ổn định cho hồ sơ
    const safeFormCode = (declarationCode || 'TK').replace(/[^a-zA-Z0-9_-]/g, '_');
    const safePeriodKey = norm.key || `${norm.year || 'UNKNOWN'}`;
    const filingId = `LOCAL_${rawMst}_${safeFormCode}_${safePeriodKey}_BS${supplementalNo}`;

    const fileName = path.basename(filePath);

    const filing: TaxFiling = {
      id: filingId,
      taxCode: rawMst,
      declarationCode: declarationCode || undefined,
      title: supplementalNo > 0 ? `${title} (Bổ sung lần ${supplementalNo})` : title,
      taxType,
      period: periodStr,
      periodNormalized,
      submittedAt,
      filingType,
      supplementalNo: supplementalNo > 0 ? supplementalNo : undefined,
      status: 'Tệp máy tính',
      downloadAvailable: true,
      downloadStatus: 'COMPLETED',
      downloadedFiles: {
        xml: filePath
      },
      source: 'local-xml'
    };

    return {
      filePath,
      fileName,
      taxCode: rawMst,
      taxpayerName,
      declarationCode,
      title: filing.title,
      taxType,
      period: periodStr,
      periodNormalized,
      filingType,
      supplementalNo,
      submittedAt,
      status: 'Tệp máy tính',
      filing
    };
  }
}

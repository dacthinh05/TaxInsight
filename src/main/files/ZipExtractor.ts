import AdmZip from 'adm-zip';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { isSafeExtractionPath, sanitizeFilename } from '../../shared/sanitizer';
import { TaxFiling } from '../../shared/types';

export interface ExtractedZipResult {
  isExisting: boolean;
  savedPaths: string[];
  xmlPath?: string;
  pdfPath?: string;
  sha256: string;
  fileHashes: Record<string, string>;
}

export class ZipExtractor {
  private static MAX_ZIP_SIZE = 100 * 1024 * 1024; // 100MB (nén)
  private static MAX_ENTRIES = 50;
  private static MAX_UNCOMPRESSED_TOTAL = 200 * 1024 * 1024; // 200MB (sau giải nén)
  private static MAX_UNCOMPRESSED_ENTRY = 50 * 1024 * 1024; // 50MB mỗi entry

  public static computeSha256(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  private static buildFilingIdentity(filing: TaxFiling, taxCode: string): string {
    const cleanTaxCode = sanitizeFilename(taxCode || 'MST').replace(/\s+/g, '-').slice(0, 16);
    const cleanId = sanitizeFilename(filing.id || 'hoso').replace(/\s+/g, '-').slice(0, 40);
    return `${cleanTaxCode}_${cleanId}`;
  }

  /**
   * sanitizeFilename giới hạn cả chuỗi ở 150 ký tự. Tách extension ra ngoài để
   * tên dài không bị cắt mất ".xml"/".pdf".
   */
  private static buildSafeFileName(baseName: string, extension: string): string {
    const safeExtension = /^\.[a-z0-9]{1,12}$/i.test(extension) ? extension.toLowerCase() : '';
    const sanitizedBase = sanitizeFilename(baseName, 'document');
    const maxBaseLength = Math.max(1, 150 - safeExtension.length);
    const boundedBase = sanitizedBase
      .slice(0, maxBaseLength)
      .replace(/[. ]+$/, '') || 'document';
    return `${boundedBase}${safeExtension}`;
  }

  /**
   * Không ghi đè file khác nội dung. Nếu tên chính đã được một file khác dùng,
   * tạo tên ổn định theo hash nội dung để lần chạy sau vẫn nhận diện EXISTING.
   */
  private static resolveCollisionSafePath(
    destDir: string,
    fileName: string,
    data: Buffer
  ): { targetPath: string; isExisting: boolean; hash: string } {
    const dataHash = this.computeSha256(data);
    const primaryPath = path.join(destDir, fileName);

    if (!fs.existsSync(primaryPath)) {
      return { targetPath: primaryPath, isExisting: false, hash: dataHash };
    }

    const primaryHash = this.computeSha256(fs.readFileSync(primaryPath));
    if (primaryHash === dataHash) {
      return { targetPath: primaryPath, isExisting: true, hash: dataHash };
    }

    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext);
    const collisionName = this.buildSafeFileName(`${base}_${dataHash.slice(0, 10)}`, ext);
    const collisionPath = path.join(destDir, collisionName);
    if (fs.existsSync(collisionPath)) {
      const collisionHash = this.computeSha256(fs.readFileSync(collisionPath));
      if (collisionHash === dataHash) {
        return { targetPath: collisionPath, isExisting: true, hash: dataHash };
      }
    }

    return { targetPath: collisionPath, isExisting: false, hash: dataHash };
  }

  /**
   * Kiểm tra buffer có phải XML hồ sơ thuế thật sự hay không.
   * Trước đây điều kiện "bắt đầu bằng '<' và chứa '>'" quá lỏng — trang HTML lỗi
   * của portal (vd: "Hết phiên làm việc") bị lưu nhầm thành file .xml và đánh
   * dấu COMPLETED, gây hỏng dữ liệu kho hồ sơ một cách âm thầm.
   */
  private static isRealXmlContent(zipBuffer: Buffer): boolean {
    const head = zipBuffer.slice(0, Math.min(zipBuffer.length, 4096)).toString('utf-8').trim();
    if (!head.startsWith('<')) return false;

    const lowerHead = head.toLowerCase();
    if (['<!doctype html', '<html', '<head', '<body', '<script', '<iframe'].some(m => lowerHead.includes(m))) {
      return false;
    }

    if (head.startsWith('<?xml')) return true;

    // Thẻ gốc phải tồn tại thẻ đóng tương ứng và KHÔNG phải thẻ HTML phổ biến
    // (chặn cả trang lỗi dạng fragment như <div>...</div>)
    const rootMatch = head.match(/^<([A-Za-z][\w.:-]*)/);
    if (!rootMatch) return false;

    const rootTagLower = rootMatch[1].toLowerCase();
    if (ZipExtractor.HTML_ROOT_DENYLIST.has(rootTagLower)) return false;

    return zipBuffer.toString('utf-8').includes(`</${rootMatch[1]}>`);
  }

  private static readonly HTML_ROOT_DENYLIST = new Set([
    'html', 'body', 'head', 'div', 'span', 'p', 'a', 'table', 'tbody', 'thead', 'tfoot',
    'tr', 'td', 'th', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'form', 'input', 'button',
    'select', 'option', 'textarea', 'label', 'fieldset', 'legend', 'script', 'style',
    'iframe', 'frameset', 'frame', 'object', 'embed', 'applet', 'noscript', 'svg',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'br', 'hr', 'img', 'font', 'b', 'i', 'u',
    'small', 'strong', 'em', 'pre', 'code', 'blockquote', 'center', 'nav', 'header',
    'footer', 'section', 'article', 'aside', 'main'
  ]);

  /**
   * Giải mã Base64, kiểm tra an toàn Zip-Slip, tính SHA-256 hash và lưu các file ra thư mục
   */
  public static extractBase64Zip(
    base64Content: string,
    destDir: string,
    filing: TaxFiling,
    taxCode: string
  ): ExtractedZipResult {
    if (!base64Content) {
      throw new Error('Nội dung Base64 rỗng');
    }

    const zipBuffer = Buffer.from(base64Content, 'base64');
    if (zipBuffer.length === 0) {
      throw new Error('Buffer giải mã có kích thước 0 byte');
    }

    if (zipBuffer.length > this.MAX_ZIP_SIZE) {
      throw new Error('Kích thước ZIP vượt quá giới hạn an toàn 100MB');
    }

    const sha256 = this.computeSha256(zipBuffer);

    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    const prefixCode = (filing.declarationCode || filing.procedureCode || 'TKHAI').replace(/[\/\\]/g, '-');
    const rawPeriodText = filing.period || filing.periodNormalized?.raw || 'KhongKy';
    const cleanPeriod = rawPeriodText
      .replace(/[\/\s:]/g, '-')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd');

    const isQuyetToan = (filing.title || '').toLowerCase().includes('quyết toán') || (filing.declarationCode || '').includes('03/TNDN') || (filing.declarationCode || '').includes('QTT');
    const filingSuffix = filing.filingType === 'SUPPLEMENTAL'
      ? `BoSung-L${filing.supplementalNo || 1}`
      : (isQuyetToan ? 'QuyetToan' : 'ChinhThuc');
    const filingIdentity = this.buildFilingIdentity(filing, taxCode);

    // ─── 1. KIỂM TRA TỆP XML ĐƠN LẺ (Không nén trong ZIP) ──────────────
    const isDirectXml = this.isRealXmlContent(zipBuffer);

    if (isDirectXml) {
      const finalFileName = this.buildSafeFileName(
        `${prefixCode}_${cleanPeriod}_${filingSuffix}_${filingIdentity}`,
        '.xml'
      );
      const resolved = this.resolveCollisionSafePath(destDir, finalFileName, zipBuffer);
      if (!resolved.isExisting) {
        fs.writeFileSync(resolved.targetPath, zipBuffer);
      }
      if (fs.statSync(resolved.targetPath).size === 0) {
        throw new Error(`Tệp XML đã lưu "${finalFileName}" có kích thước 0 byte`);
      }
      return {
        isExisting: resolved.isExisting,
        savedPaths: [resolved.targetPath],
        xmlPath: resolved.targetPath,
        sha256,
        fileHashes: { [resolved.targetPath]: resolved.hash }
      };
    }

    // ─── 2. KIỂM TRA TỆP PDF ĐƠN LẺ (Không nén trong ZIP) ──────────────
    const headerSlice = zipBuffer.slice(0, 5).toString('utf-8').trim();
    const isDirectPdf = headerSlice.startsWith('%PDF');
    if (isDirectPdf) {
      const finalFileName = this.buildSafeFileName(
        `${prefixCode}_${cleanPeriod}_${filingSuffix}_${filingIdentity}`,
        '.pdf'
      );
      const resolved = this.resolveCollisionSafePath(destDir, finalFileName, zipBuffer);
      if (!resolved.isExisting) {
        fs.writeFileSync(resolved.targetPath, zipBuffer);
      }
      if (fs.statSync(resolved.targetPath).size === 0) {
        throw new Error(`Tệp PDF đã lưu "${finalFileName}" có kích thước 0 byte`);
      }

      return {
        isExisting: resolved.isExisting,
        savedPaths: [resolved.targetPath],
        pdfPath: resolved.targetPath,
        sha256,
        fileHashes: { [resolved.targetPath]: resolved.hash }
      };
    }

    // ─── 3. GIẢI NÉN TỆP NÉN ZIP ──────────────────────────────────────
    let zip: AdmZip;
    try {
      zip = new AdmZip(zipBuffer);
    } catch (err: any) {
      // Fallback: nếu AdmZip thất bại nhưng buffer là XML hồ sơ hợp lệ
      if (this.isRealXmlContent(zipBuffer)) {
        const finalFileName = this.buildSafeFileName(
          `${prefixCode}_${cleanPeriod}_${filingSuffix}_${filingIdentity}`,
          '.xml'
        );
        const resolved = this.resolveCollisionSafePath(destDir, finalFileName, zipBuffer);
        if (!resolved.isExisting) {
          fs.writeFileSync(resolved.targetPath, zipBuffer);
        }
        if (fs.statSync(resolved.targetPath).size === 0) {
          throw new Error(`Tệp XML đã lưu "${finalFileName}" có kích thước 0 byte (AdmZip fallback)`);
        }
        return {
          isExisting: resolved.isExisting,
          savedPaths: [resolved.targetPath],
          xmlPath: resolved.targetPath,
          sha256,
          fileHashes: { [resolved.targetPath]: resolved.hash }
        };
      }
      throw new Error(`File không đúng định dạng ZIP: ${err.message}`);
    }

    const entries = zip.getEntries();
    if (entries.length > this.MAX_ENTRIES) {
      throw new Error(`Số lượng tệp trong ZIP (${entries.length}) vượt quá giới hạn an toàn`);
    }

    const savedPaths: string[] = [];
    let xmlPath: string | undefined;
    let pdfPath: string | undefined;
    let allIdentical = true;
    let totalUncompressed = 0;
    const fileHashes: Record<string, string> = {};
    // Đếm tên file đích đã dùng trong lần giải nén này: 2 entry khác thư mục
    // trùng basename (a/x.xml, b/x.xml) trước đây GHI ĐÈ nhau im lặng
    const usedTargetNames = new Set<string>();

    for (const entry of entries) {
      if (entry.isDirectory) continue;

      const entryName = entry.entryName;

      // 🛡️ BẢO VỆ CHỐNG ZIP-SLIP
      if (!isSafeExtractionPath(destDir, entryName)) {
        throw new Error(`CẢNH BÁO BẢO MẬT: Phát hiện tấn công Zip-Slip trong file "${entryName}"`);
      }

      // 🛡️ CHỐNG ZIP BOMB: giới hạn kích thước SAU GIẢI NÉN (DEFLATE nén được >1000:1,
      // ZIP 100MB hợp lệ về mặt nén có thể bung ra hàng chục GB và làm OOM main process)
      const uncompressedSize = entry.header.size || 0;
      console.info(`[ZipExtractor] Entry diagnostic ${JSON.stringify({
        name: String(entryName).replace(/[A-Za-z0-9]{8,}/g, value => `${value.slice(0, 3)}***${value.slice(-2)}`),
        uncompressedSize
      })}`);
      if (uncompressedSize > ZipExtractor.MAX_UNCOMPRESSED_ENTRY) {
        throw new Error(`Tệp "${entryName}" sau giải nén vượt giới hạn an toàn 50MB`);
      }
      totalUncompressed += uncompressedSize;
      if (totalUncompressed > ZipExtractor.MAX_UNCOMPRESSED_TOTAL) {
        throw new Error('Tổng dung lượng sau giải nén của ZIP vượt giới hạn an toàn 200MB');
      }

      const ext = path.extname(entryName).toLowerCase();
      let originalBasename = path.basename(entryName, ext);
      
      // Khử lặp: nếu originalBasename chứa mã hồ sơ (ví dụ files_000.713..._0), làm sạch gọn
      if (filing.id && originalBasename.includes(filing.id)) {
        originalBasename = originalBasename.replace(new RegExp(`^files_${filing.id}_?`, 'i'), '')
          .replace(new RegExp(`^${filing.id}_?`, 'i'), '')
          .replace(/^_/, '');
      } else if (/^files_\d+$/i.test(originalBasename) || /^files$/i.test(originalBasename)) {
        originalBasename = '';
      }

      const nameParts = [
        prefixCode.replace(/-+$/, ''),
        cleanPeriod,
        filingSuffix,
        filingIdentity
      ];
      if (originalBasename) {
        nameParts.push(originalBasename);
      }

      let finalFileName = this.buildSafeFileName(
        nameParts.filter(Boolean).join('_'),
        ext
      );

      // Trùng tên trong cùng lần giải nén → thêm hậu tố _2, _3... thay vì ghi đè
      if (usedTargetNames.has(finalFileName.toLowerCase())) {
        let counter = 2;
        let candidate: string;
        do {
          candidate = this.buildSafeFileName(
            `${nameParts.filter(Boolean).join('_')}_${counter}`,
            ext
          );
          counter++;
        } while (usedTargetNames.has(candidate.toLowerCase()));
        finalFileName = candidate;
      }
      usedTargetNames.add(finalFileName.toLowerCase());

      const entryData = entry.getData();
      if (entryData.length === 0) {
        throw new Error(`Tệp "${entryName}" trong ZIP có kích thước 0 byte`);
      }
      const resolved = this.resolveCollisionSafePath(destDir, finalFileName, entryData);
      if (!resolved.isExisting) {
        allIdentical = false;
        fs.writeFileSync(resolved.targetPath, entryData);
      }
      if (fs.statSync(resolved.targetPath).size === 0) {
        throw new Error(`Tệp đã lưu "${path.basename(resolved.targetPath)}" có kích thước 0 byte`);
      }
      savedPaths.push(resolved.targetPath);
      fileHashes[resolved.targetPath] = resolved.hash;

      if (ext === '.xml') xmlPath = resolved.targetPath;
      if (ext === '.pdf') pdfPath = resolved.targetPath;
    }

    if (savedPaths.length === 0) {
      throw new Error('Tệp ZIP không chứa bất kỳ tệp dữ liệu hợp lệ nào');
    }

    return {
      isExisting: allIdentical && savedPaths.length > 0,
      savedPaths,
      xmlPath,
      pdfPath,
      sha256,
      fileHashes
    };
  }
}

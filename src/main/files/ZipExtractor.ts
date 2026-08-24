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
}

export class ZipExtractor {
  private static MAX_ZIP_SIZE = 100 * 1024 * 1024; // 100MB (nén)
  private static MAX_ENTRIES = 50;
  private static MAX_UNCOMPRESSED_TOTAL = 200 * 1024 * 1024; // 200MB (sau giải nén)
  private static MAX_UNCOMPRESSED_ENTRY = 50 * 1024 * 1024; // 50MB mỗi entry

  public static computeSha256(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
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

    // ─── 1. KIỂM TRA TỆP XML ĐƠN LẺ (Không nén trong ZIP) ──────────────
    const isDirectXml = this.isRealXmlContent(zipBuffer);

    if (isDirectXml) {
      const cleanId = sanitizeFilename(filing.id || 'hoso');
      const finalFileName = sanitizeFilename(`${prefixCode}_${cleanPeriod}_${filingSuffix}_${cleanId}.xml`);
      const targetPath = path.join(destDir, finalFileName);

      let isExisting = false;
      if (fs.existsSync(targetPath)) {
        const existingData = fs.readFileSync(targetPath);
        if (this.computeSha256(existingData) === sha256) {
          isExisting = true;
        }
      }
      if (!isExisting) {
        fs.writeFileSync(targetPath, zipBuffer);
      }

      return {
        isExisting,
        savedPaths: [targetPath],
        xmlPath: targetPath,
        sha256
      };
    }

    // ─── 2. KIỂM TRA TỆP PDF ĐƠN LẺ (Không nén trong ZIP) ──────────────
    const headerSlice = zipBuffer.slice(0, 5).toString('utf-8').trim();
    const isDirectPdf = headerSlice.startsWith('%PDF');
    if (isDirectPdf) {
      const cleanId = sanitizeFilename(filing.id || 'hoso');
      const finalFileName = sanitizeFilename(`${prefixCode}_${cleanPeriod}_${filingSuffix}_${cleanId}.pdf`);
      const targetPath = path.join(destDir, finalFileName);

      let isExisting = false;
      if (fs.existsSync(targetPath)) {
        const existingData = fs.readFileSync(targetPath);
        if (this.computeSha256(existingData) === sha256) {
          isExisting = true;
        }
      }
      if (!isExisting) {
        fs.writeFileSync(targetPath, zipBuffer);
      }

      return {
        isExisting,
        savedPaths: [targetPath],
        pdfPath: targetPath,
        sha256
      };
    }

    // ─── 3. GIẢI NÉN TỆP NÉN ZIP ──────────────────────────────────────
    let zip: AdmZip;
    try {
      zip = new AdmZip(zipBuffer);
    } catch (err: any) {
      // Fallback: nếu AdmZip thất bại nhưng buffer là XML hồ sơ hợp lệ
      if (this.isRealXmlContent(zipBuffer)) {
        const cleanId = sanitizeFilename(filing.id || 'hoso');
        const finalFileName = sanitizeFilename(`${prefixCode}_${cleanPeriod}_${filingSuffix}_${cleanId}.xml`);
        const targetPath = path.join(destDir, finalFileName);
        fs.writeFileSync(targetPath, zipBuffer);
        return {
          isExisting: false,
          savedPaths: [targetPath],
          xmlPath: targetPath,
          sha256
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
      if (uncompressedSize > ZipExtractor.MAX_UNCOMPRESSED_ENTRY) {
        throw new Error(`Tệp "${entryName}" sau giải nén vượt giới hạn an toàn 50MB`);
      }
      totalUncompressed += uncompressedSize;
      if (totalUncompressed > ZipExtractor.MAX_UNCOMPRESSED_TOTAL) {
        throw new Error('Tổng dung lượng sau giải nén của ZIP vượt giới hạn an toàn 200MB');
      }

      const ext = path.extname(entryName).toLowerCase();
      const originalBasename = path.basename(entryName, ext);

      const finalFileName = sanitizeFilename(
        `${prefixCode}_${cleanPeriod}_${filingSuffix}_${originalBasename}${ext}`
      );

      const targetPath = path.join(destDir, finalFileName);
      const entryData = entry.getData();

      // Kiểm tra tính toàn vẹn và trùng lặp qua hash
      if (fs.existsSync(targetPath)) {
        const existingData = fs.readFileSync(targetPath);
        const existingHash = this.computeSha256(existingData);
        const entryHash = this.computeSha256(entryData);

        if (existingHash === entryHash) {
          savedPaths.push(targetPath);
          if (ext === '.xml') xmlPath = targetPath;
          if (ext === '.pdf') pdfPath = targetPath;
          continue;
        }
      }

      allIdentical = false;
      fs.writeFileSync(targetPath, entryData);
      savedPaths.push(targetPath);

      if (ext === '.xml') xmlPath = targetPath;
      if (ext === '.pdf') pdfPath = targetPath;
    }

    return {
      isExisting: allIdentical && savedPaths.length > 0,
      savedPaths,
      xmlPath,
      pdfPath,
      sha256
    };
  }
}

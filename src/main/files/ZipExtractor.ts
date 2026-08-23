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

    let zip: AdmZip;
    try {
      zip = new AdmZip(zipBuffer);
    } catch (err: any) {
      throw new Error(`File không đúng định dạng ZIP: ${err.message}`);
    }

    const entries = zip.getEntries();
    if (entries.length > this.MAX_ENTRIES) {
      throw new Error(`Số lượng tệp trong ZIP (${entries.length}) vượt quá giới hạn an toàn`);
    }

    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
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

import AdmZip from 'adm-zip';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
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
   * Chuẩn hóa và bóc tách nội dung XML từ buffer bất kỳ (hỗ trợ UTF-8 BOM, UTF-16, leading comments).
   */
  public static cleanXmlBuffer(buffer: Buffer): { isXml: boolean; cleanBuffer: Buffer; text: string } {
    if (!buffer || buffer.length === 0) {
      return { isXml: false, cleanBuffer: buffer, text: '' };
    }

    let raw = '';
    if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
      raw = buffer.slice(3).toString('utf-8');
    } else if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
      raw = buffer.slice(2).toString('utf16le');
    } else if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
      raw = buffer.slice(2).swap16().toString('utf16le');
    } else {
      raw = buffer.toString('utf-8');
    }

    const trimmed = raw.replace(/^\uFEFF/, '').trimStart();
    if (!trimmed.startsWith('<')) {
      return { isXml: false, cleanBuffer: buffer, text: '' };
    }

    if (trimmed.startsWith('<?xml')) {
      const lower = trimmed.slice(0, 4096).toLowerCase();
      if (lower.includes('<!doctype html') || /<html[\s>]/i.test(lower)) {
        return { isXml: false, cleanBuffer: buffer, text: '' };
      }
      return { isXml: true, cleanBuffer: Buffer.from(trimmed, 'utf-8'), text: trimmed };
    }

    const lower = trimmed.slice(0, 4096).toLowerCase();
    if (/(?:<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<script[\s>]|<iframe[\s>])/i.test(lower)) {
      return { isXml: false, cleanBuffer: buffer, text: '' };
    }

    // Bỏ qua comment đầu (<!-- ... -->) nếu có
    const stripComments = trimmed.replace(/^<!--[\s\S]*?-->\s*/, '');
    const rootMatch = stripComments.match(/^<([A-Za-z][\w.:-]*)/);
    if (!rootMatch) {
      return { isXml: false, cleanBuffer: buffer, text: '' };
    }

    const rootTagLower = rootMatch[1].toLowerCase();
    if (ZipExtractor.HTML_ROOT_DENYLIST.has(rootTagLower)) {
      return { isXml: false, cleanBuffer: buffer, text: '' };
    }

    // Chấp nhận XML hợp lệ nếu có thẻ đóng hoặc là thẻ tự đóng hoặc thẻ gốc hồ sơ thuế
    const hasClosingTag = stripComments.includes(`</${rootMatch[1]}>`) || stripComments.includes(`</${rootMatch[1].split(':').pop()}>`);
    const isTaxRoot = /^(?:[a-zA-Z0-9]+:)?(?:HSoThue|HSoThueDTu|TKhai|HSo|ToKhai|TkhaiThue|BangKe|BKe)/i.test(rootMatch[1]);

    if (hasClosingTag || isTaxRoot) {
      return { isXml: true, cleanBuffer: Buffer.from(trimmed, 'utf-8'), text: trimmed };
    }

    return { isXml: false, cleanBuffer: buffer, text: '' };
  }

  /**
   * Kiểm tra buffer có phải XML hồ sơ thuế thật sự hay không.
   */
  private static isRealXmlContent(zipBuffer: Buffer): boolean {
    return this.cleanXmlBuffer(zipBuffer).isXml;
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
    const rawPeriodText = filing.period || filing.periodNormalized?.raw || 'KhongTheoKy';
    const cleanPeriod = rawPeriodText
      .replace(/[\/\s:]/g, '-')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd');

    const isExplicitKk = /0[256]\/kk|kk-tncn/i.test(filing.declarationCode || '') || (filing.title || '').toLowerCase().includes('khấu trừ');
    const isQuyetToan = !isExplicitKk && ((filing.title || '').toLowerCase().includes('quyết toán') || (filing.declarationCode || '').includes('03/TNDN') || (filing.declarationCode || '').includes('QTT'));
    const filingSuffix = filing.filingType === 'SUPPLEMENTAL'
      ? `BoSung-L${filing.supplementalNo || 1}`
      : (isQuyetToan ? 'QuyetToan' : 'ChinhThuc');
    const filingIdentity = this.buildFilingIdentity(filing, taxCode);

    // ─── 1. KIỂM TRA TỆP XML ĐƠN LẺ (Không nén trong ZIP, hỗ trợ BOM / Comments) ──
    const xmlCheck = this.cleanXmlBuffer(zipBuffer);

    if (xmlCheck.isXml) {
      const finalFileName = this.buildSafeFileName(
        `${prefixCode}_${cleanPeriod}_${filingSuffix}_${filingIdentity}`,
        '.xml'
      );
      const resolved = this.resolveCollisionSafePath(destDir, finalFileName, xmlCheck.cleanBuffer);
      if (!resolved.isExisting) {
        fs.writeFileSync(resolved.targetPath, xmlCheck.cleanBuffer);
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

    // ─── 3. KIỂM TRA GZIP / DEFLATE NÉN ĐƠN LẺ TRƯỚC KHI GỌI ADM-ZIP ───
    if (zipBuffer.length >= 2 && zipBuffer[0] === 0x1f && zipBuffer[1] === 0x8b) {
      try {
        const uncompressed = zlib.gunzipSync(zipBuffer);
        return this.extractBase64Zip(uncompressed.toString('base64'), destDir, filing, taxCode);
      } catch {}
    }
    if (zipBuffer.length >= 2 && zipBuffer[0] === 0x78 && (zipBuffer[1] === 0x9c || zipBuffer[1] === 0x01 || zipBuffer[1] === 0xda)) {
      try {
        const uncompressed = zlib.inflateSync(zipBuffer);
        return this.extractBase64Zip(uncompressed.toString('base64'), destDir, filing, taxCode);
      } catch {}
    }

    // ─── 4. GIẢI NÉN TỆP NÉN ZIP ──────────────────────────────────────
    const eocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
    let activeZipBuffer = zipBuffer;
    if (!zipBuffer.includes(eocdSig)) {
      const repaired = ZipExtractor.repairZipMissingEocd(zipBuffer);
      if (repaired) {
        activeZipBuffer = Buffer.from(repaired);
      }
    }

    let zip: AdmZip;
    try {
      zip = new AdmZip(activeZipBuffer);
    } catch (err: unknown) {
      // Fallback 1: Buffer là XML hồ sơ thuế (có thể do portal gửi raw XML thay vì ZIP)
      const fbXml = this.cleanXmlBuffer(zipBuffer);
      if (fbXml.isXml) {
        const finalFileName = this.buildSafeFileName(
          `${prefixCode}_${cleanPeriod}_${filingSuffix}_${filingIdentity}`,
          '.xml'
        );
        const resolved = this.resolveCollisionSafePath(destDir, finalFileName, fbXml.cleanBuffer);
        if (!resolved.isExisting) {
          fs.writeFileSync(resolved.targetPath, fbXml.cleanBuffer);
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

      // Fallback 2: Thử giải nén zlib unzip cho stream raw deflate
      try {
        const uncompressed = zlib.unzipSync(zipBuffer);
        const uncompressedXml = this.cleanXmlBuffer(uncompressed);
        if (uncompressedXml.isXml) {
          const finalFileName = this.buildSafeFileName(
            `${prefixCode}_${cleanPeriod}_${filingSuffix}_${filingIdentity}`,
            '.xml'
          );
          const resolved = this.resolveCollisionSafePath(destDir, finalFileName, uncompressedXml.cleanBuffer);
          if (!resolved.isExisting) {
            fs.writeFileSync(resolved.targetPath, uncompressedXml.cleanBuffer);
          }
          if (fs.statSync(resolved.targetPath).size === 0) {
            throw new Error(`Tệp XML đã lưu "${finalFileName}" có kích thước 0 byte (zlib fallback)`);
          }
          return {
            isExisting: resolved.isExisting,
            savedPaths: [resolved.targetPath],
            xmlPath: resolved.targetPath,
            sha256,
            fileHashes: { [resolved.targetPath]: resolved.hash }
          };
        }
      } catch {}

      // Fallback 3: Kiểm tra PDF
      if (zipBuffer.includes(Buffer.from('%PDF-'))) {
        const pdfStart = zipBuffer.indexOf(Buffer.from('%PDF-'));
        const pdfBuf = pdfStart > 0 ? zipBuffer.slice(pdfStart) : zipBuffer;
        const finalFileName = this.buildSafeFileName(
          `${prefixCode}_${cleanPeriod}_${filingSuffix}_${filingIdentity}`,
          '.pdf'
        );
        const resolved = this.resolveCollisionSafePath(destDir, finalFileName, pdfBuf);
        if (!resolved.isExisting) {
          fs.writeFileSync(resolved.targetPath, pdfBuf);
        }
        if (fs.statSync(resolved.targetPath).size === 0) {
          throw new Error(`Tệp PDF đã lưu "${finalFileName}" có kích thước 0 byte (PDF fallback)`);
        }
        return {
          isExisting: resolved.isExisting,
          savedPaths: [resolved.targetPath],
          pdfPath: resolved.targetPath,
          sha256,
          fileHashes: { [resolved.targetPath]: resolved.hash }
        };
      }
      // Duyệt tuần tự các Local File Header (PK\x03\x04) và giải nén bằng zlib.inflateRawSync.
      if (zipBuffer.includes(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
        try {
          const recovered = this.recoverTruncatedZip(
            zipBuffer,
            destDir,
            filing,
            taxCode,
            sha256,
            prefixCode,
            cleanPeriod,
            filingSuffix,
            filingIdentity
          );
          if (recovered && recovered.savedPaths.length > 0) {
            return recovered;
          }
        } catch {}
      }
      // Fallback 5: Cứu hộ tệp XML hồ sơ thuế nhúng trực tiếp trong buffer
      const embeddedXml = this.extractEmbeddedXml(
        zipBuffer,
        destDir,
        filing,
        taxCode,
        sha256,
        prefixCode,
        cleanPeriod,
        filingSuffix,
        filingIdentity
      );
      if (embeddedXml && embeddedXml.savedPaths.length > 0) {
        return embeddedXml;
      }

      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`File không đúng định dạng ZIP: ${msg}`);
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

      let entryData: Buffer;
      try {
        entryData = entry.getData();
      } catch (entryErr: unknown) {
        let rawCompressed: unknown = undefined;
        if (entry && typeof entry === 'object') {
          if ('getCompressedData' in entry && typeof entry.getCompressedData === 'function') {
            rawCompressed = entry.getCompressedData();
          } else if ('compressedData' in entry) {
            rawCompressed = entry.compressedData;
          }
        }
        if (Buffer.isBuffer(rawCompressed) && rawCompressed.length > 0) {
          try {
            entryData = zlib.inflateRawSync(rawCompressed);
          } catch {
            try {
              entryData = zlib.inflateSync(rawCompressed);
            } catch {
              throw entryErr;
            }
          }
        } else {
          throw entryErr;
        }
      }
      if (entryData.length === 0) {
        console.warn(`[ZipExtractor] Bỏ qua entry rỗng 0 byte: "${entryName}"`);
        continue;
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
      throw new Error('Tệp ZIP không chứa bất kỳ tệp dữ liệu hợp lệ nào (kích thước 0 byte)');
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

  /**
   * Phục hồi tệp ZIP bị thiếu EOCD (PK\x05\x06) khi Central Directory (PK\x01\x02) vẫn còn nguyên.
   * Tự động tính toán số entry, kích thước và offset của Central Directory để tổng hợp header EOCD chuẩn 22 byte.
   */
  public static repairZipMissingEocd(zipBuffer: Buffer): Buffer | null {
    const cdSig = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
    const cdOffset = zipBuffer.indexOf(cdSig);
    if (cdOffset === -1) return null;

    let cdEntriesCount = 0;
    let curOffset = cdOffset;
    while (curOffset !== -1 && curOffset + 46 <= zipBuffer.length) {
      const next = zipBuffer.indexOf(cdSig, curOffset);
      if (next === -1 || next + 46 > zipBuffer.length) break;
      cdEntriesCount++;
      const fnLen = zipBuffer.readUInt16LE(next + 28);
      const extraLen = zipBuffer.readUInt16LE(next + 30);
      const commentLen = zipBuffer.readUInt16LE(next + 32);
      curOffset = next + 46 + fnLen + extraLen + commentLen;
    }

    if (cdEntriesCount === 0) return null;
    const cdSize = Math.max(0, curOffset - cdOffset);

    const synthEocd = Buffer.alloc(22);
    synthEocd.write('PK\x05\x06', 0, 4, 'ascii');
    synthEocd.writeUInt16LE(0, 4); // disk number
    synthEocd.writeUInt16LE(0, 6); // disk with CD
    synthEocd.writeUInt16LE(cdEntriesCount, 8); // entries on this disk
    synthEocd.writeUInt16LE(cdEntriesCount, 10); // total entries
    synthEocd.writeUInt32LE(cdSize, 12); // size of CD
    synthEocd.writeUInt32LE(cdOffset, 16); // offset of CD
    synthEocd.writeUInt16LE(0, 20); // comment length

    return Buffer.concat([zipBuffer.subarray(0, curOffset), synthEocd]);
  }

  /**
   * Tìm vị trí header ZIP tiếp theo (PK\x03\x04, PK\x07\x08, PK\x01\x02, PK\x05\x06) để xác định
   * ranh giới chính xác của stream dữ liệu nén trong các tệp ZIP streaming (Data Descriptor).
   */
  private static findNextZipSignature(buf: Buffer, startOffset: number): number {
    for (let i = startOffset; i + 4 <= buf.length; i++) {
      if (buf[i] === 0x50 && buf[i + 1] === 0x4b) {
        const b2 = buf[i + 2];
        const b3 = buf[i + 3];
        if (
          (b2 === 0x03 && b3 === 0x04) ||
          (b2 === 0x07 && b3 === 0x08) ||
          (b2 === 0x01 && b3 === 0x02) ||
          (b2 === 0x05 && b3 === 0x06)
        ) {
          return i;
        }
      }
    }
    return buf.length;
  }

  /**
   * Tìm kiếm và giải cứu tệp XML hồ sơ thuế nhúng trực tiếp trong buffer (kể cả khi ZIP hỏng hoàn toàn)
   */
  private static extractEmbeddedXml(
    zipBuffer: Buffer,
    destDir: string,
    filing: TaxFiling,
    taxCode: string,
    sha256: string,
    prefixCode: string,
    cleanPeriod: string,
    filingSuffix: string,
    filingIdentity: string
  ): ExtractedZipResult | null {
    const xmlMarkers = ['<?xml', '<HSoThueDTu', '<HSoThue', '<TKhaiThue', '<HSoKhaiThue', '<HSo'];
    for (const marker of xmlMarkers) {
      const markerBuf = Buffer.from(marker, 'utf8');
      const idx = zipBuffer.indexOf(markerBuf);
      if (idx !== -1) {
        const candidate = zipBuffer.subarray(idx);
        const check = this.cleanXmlBuffer(candidate);
        if (check.isXml) {
          const finalFileName = this.buildSafeFileName(
            `${prefixCode}_${cleanPeriod}_${filingSuffix}_${filingIdentity}_recovered`,
            '.xml'
          );
          const resolved = this.resolveCollisionSafePath(destDir, finalFileName, check.cleanBuffer);
          if (!resolved.isExisting) {
            fs.writeFileSync(resolved.targetPath, check.cleanBuffer);
          }
          if (fs.existsSync(resolved.targetPath) && fs.statSync(resolved.targetPath).size > 0) {
            return {
              isExisting: resolved.isExisting,
              savedPaths: [resolved.targetPath],
              xmlPath: resolved.targetPath,
              sha256,
              fileHashes: { [resolved.targetPath]: resolved.hash }
            };
          }
        }
      }
    }
    return null;
  }

  /**
   * Phục hồi giải nén các tệp ZIP bị thiếu END header (No END header found do stream bị ngắt
   * hoặc server Cổng Thuế không ghi Central Directory).
   * Duyệt tuần tự các Local File Header (PK\x03\x04) từ đầu buffer và giải nén bằng zlib.inflateRawSync.
   */
  private static recoverTruncatedZip(
    zipBuffer: Buffer,
    destDir: string,
    filing: TaxFiling,
    taxCode: string,
    sha256: string,
    prefixCode: string,
    cleanPeriod: string,
    filingSuffix: string,
    filingIdentity: string
  ): ExtractedZipResult | null {
    const pkSig = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    let offset = 0;
    const savedPaths: string[] = [];
    let xmlPath: string | undefined;
    let pdfPath: string | undefined;
    const fileHashes: Record<string, string> = {};

    while (offset + 30 <= zipBuffer.length) {
      const idx = zipBuffer.indexOf(pkSig, offset);
      if (idx === -1 || idx + 30 > zipBuffer.length) break;

      const method = zipBuffer.readUInt16LE(idx + 8);
      const compressedSize = zipBuffer.readUInt32LE(idx + 18);
      const uncompressedSize = zipBuffer.readUInt32LE(idx + 22);
      const fnLen = zipBuffer.readUInt16LE(idx + 26);
      const extraLen = zipBuffer.readUInt16LE(idx + 28);

      const dataStart = idx + 30 + fnLen + extraLen;
      if (dataStart > zipBuffer.length) break;

      let entryName = zipBuffer.toString('utf8', idx + 30, idx + 30 + fnLen).trim();
      if (!entryName) {
        entryName = `entry_${savedPaths.length + 1}`;
      }

      let decompressedData: Buffer | null = null;
      let nextOffset = dataStart;

      // Bỏ qua entry là thư mục
      const isDirectory = entryName.endsWith('/') || entryName.endsWith('\\');
      if (isDirectory) {
        offset = Math.max(dataStart, idx + 4);
        continue;
      }

      if (method === 8) {
        // Raw Deflate
        const dataEnd = compressedSize > 0 && dataStart + compressedSize <= zipBuffer.length
          ? dataStart + compressedSize
          : this.findNextZipSignature(zipBuffer, dataStart);
        const slice = zipBuffer.subarray(dataStart, dataEnd);
        nextOffset = dataEnd;

        try {
          decompressedData = zlib.inflateRawSync(slice);
        } catch {
          try {
            decompressedData = zlib.inflateSync(slice);
          } catch {
            try {
              decompressedData = zlib.unzipSync(slice);
            } catch {}
          }
        }
      } else if (method === 0) {
        // Stored uncompressed
        const dataEnd = compressedSize > 0 && dataStart + compressedSize <= zipBuffer.length
          ? dataStart + compressedSize
          : (uncompressedSize > 0 && dataStart + uncompressedSize <= zipBuffer.length
            ? dataStart + uncompressedSize
            : this.findNextZipSignature(zipBuffer, dataStart));
        decompressedData = zipBuffer.subarray(dataStart, dataEnd);
        nextOffset = dataEnd;
      }

      if (decompressedData && decompressedData.length > 0) {
        const ext = path.extname(entryName).toLowerCase() || (
          decompressedData.slice(0, 5).toString('utf8').startsWith('%PDF') ? '.pdf' : '.xml'
        );
        const finalFileName = this.buildSafeFileName(
          `${prefixCode}_${cleanPeriod}_${filingSuffix}_${filingIdentity}_${savedPaths.length}`,
          ext
        );
        const resolved = this.resolveCollisionSafePath(destDir, finalFileName, decompressedData);
        if (!resolved.isExisting) {
          fs.writeFileSync(resolved.targetPath, decompressedData);
        }
        if (fs.existsSync(resolved.targetPath) && fs.statSync(resolved.targetPath).size > 0) {
          savedPaths.push(resolved.targetPath);
          fileHashes[resolved.targetPath] = resolved.hash;
          if (ext === '.xml' && !xmlPath) xmlPath = resolved.targetPath;
          if (ext === '.pdf' && !pdfPath) pdfPath = resolved.targetPath;
        }
      }

      offset = Math.max(nextOffset, idx + 4);
    }

    if (savedPaths.length > 0) {
      return {
        isExisting: false,
        savedPaths,
        xmlPath,
        pdfPath,
        sha256,
        fileHashes
      };
    }
    return null;
  }
}

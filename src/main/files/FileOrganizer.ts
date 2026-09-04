import fs from 'fs';
import path from 'path';
import { sanitizeFilename } from '../../shared/sanitizer';
import { TaxFiling } from '../../shared/types';
import { FileManifest } from './FileManifest';
import { ExtractedZipResult, ZipExtractor } from './ZipExtractor';

export interface SaveDownloadedFilingOptions {
  content: Buffer | string;
  fileName?: string;
  contentType?: string;
  filing: TaxFiling;
  taxCode: string;
  year: number;
}
export class FileOrganizer {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  public setBaseDir(newDir: string) {
    this.baseDir = newDir;
  }

  public getBaseDir(): string {
    return this.baseDir;
  }

  public getManifest(taxCode: string, year: number): FileManifest {
    return new FileManifest(this.baseDir, taxCode, year);
  }

  /**
   * Thư mục lưu trữ: GOM CHUNG 1 THƯ MỨC duy nhất (yêu cầu người dùng) —
   * không phân thư mục con theo MST/Năm. Tên file đã chứa mã tờ khai + kỳ +
   * ID hồ sơ nên không cần cây thư mục để phân biệt.
   */
  public getDestinationDir(taxCode: string, filing: TaxFiling, year: number): string {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    return this.baseDir;
  }

  /**
   * Tầng 1: Kiểm tra trước xem có thể bỏ qua download không
   */
  public checkPreDownloadStatus(
    taxCode: string,
    filing: TaxFiling,
    year: number
  ): {
    isAlreadyDownloaded: boolean;
    savedPaths?: string[];
    xmlPath?: string;
    pdfPath?: string;
    otherPaths?: string[];
  } {
    const manifest = this.getManifest(taxCode, year);
    const check = manifest.isAlreadyDownloaded(filing.id);
    if (check.exists && check.entry) {
      const savedPaths = check.entry.savedPaths || [];
      const xmlPath = check.entry.xmlPath || savedPaths.find(p => p.toLowerCase().endsWith('.xml'));
      const pdfPath = check.entry.pdfPath || savedPaths.find(p => p.toLowerCase().endsWith('.pdf'));
      const otherPaths = savedPaths.filter(p => p !== xmlPath && p !== pdfPath);
      return {
        isAlreadyDownloaded: true,
        savedPaths,
        xmlPath,
        pdfPath,
        otherPaths
      };
    }
    return { isAlreadyDownloaded: false };
  }

  /**
   * Tầng 2: Giải nén, lưu trữ và ghi nhận vào Manifest
   */
  /**
   * Tầng 2: Lưu trữ đa hình (ZIP, XML, PDF, phụ lục) và ghi nhận vào Manifest
   */
  public saveDownloadedFiling(options: SaveDownloadedFilingOptions): ExtractedZipResult {
    const { content, fileName, contentType, filing, taxCode, year } = options;
    const destDir = this.getDestinationDir(taxCode, filing, year);
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'base64');
    const result = ZipExtractor.extractBuffer(buffer, destDir, filing, taxCode, {
      originalFileName: fileName,
      contentType
    });

    // Xác nhận tệp thực sự tồn tại trên đĩa và có kích thước > 0 trước khi ghi manifest
    if (!result.savedPaths || result.savedPaths.length === 0) {
      throw new Error('Không có tệp nào được lưu sau khi xử lý tải về');
    }
    for (const p of result.savedPaths) {
      if (!fs.existsSync(p) || fs.statSync(p).size === 0) {
        throw new Error(`Tệp "${path.basename(p)}" không tồn tại hoặc có kích thước 0 byte`);
      }
    }

    // Ghi nhận vào Manifest
    const manifest = this.getManifest(taxCode, year);
    manifest.recordDownload({
      filingId: filing.id,
      procedureCode: filing.procedureCode,
      declarationCode: filing.declarationCode,
      period: filing.period,
      filingType: filing.filingType,
      supplementalNo: filing.supplementalNo,
      savedPaths: result.savedPaths,
      xmlPath: result.xmlPath,
      pdfPath: result.pdfPath,
      sha256: result.sha256,
      fileHashes: result.fileHashes,
      downloadedAt: new Date().toISOString()
    });

    return result;
  }

  /**
   * Tương thích ngược: giải nén ZIP từ Base64
   */
  public saveExtractedFiling(
    base64Content: string,
    filing: TaxFiling,
    taxCode: string,
    year: number
  ): ExtractedZipResult {
    return this.saveDownloadedFiling({
      content: base64Content,
      filing,
      taxCode,
      year
    });
  }
}

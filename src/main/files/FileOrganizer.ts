import fs from 'fs';
import path from 'path';
import { sanitizeFilename } from '../../shared/sanitizer';
import { TaxFiling } from '../../shared/types';
import { FileManifest } from './FileManifest';
import { ExtractedZipResult, ZipExtractor } from './ZipExtractor';

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
  public checkPreDownloadStatus(taxCode: string, filing: TaxFiling, year: number): { isAlreadyDownloaded: boolean; savedPaths?: string[] } {
    const manifest = this.getManifest(taxCode, year);
    const check = manifest.isAlreadyDownloaded(filing.id);
    if (check.exists && check.entry) {
      return {
        isAlreadyDownloaded: true,
        savedPaths: check.entry.savedPaths
      };
    }
    return { isAlreadyDownloaded: false };
  }

  /**
   * Tầng 2: Giải nén, lưu trữ và ghi nhận vào Manifest
   */
  public saveExtractedFiling(
    base64Content: string,
    filing: TaxFiling,
    taxCode: string,
    year: number
  ): ExtractedZipResult {
    const destDir = this.getDestinationDir(taxCode, filing, year);
    const result = ZipExtractor.extractBase64Zip(base64Content, destDir, filing, taxCode);

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
}

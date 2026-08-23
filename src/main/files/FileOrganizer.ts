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
   * Tính toán đường dẫn thư mục lưu trữ: Gom chung 1 thư mục cho cả MST/Năm: {baseDir}/{MST}_{Năm}/
   */
  public getDestinationDir(taxCode: string, filing: TaxFiling, year: number): string {
    const safeTaxCode = sanitizeFilename(taxCode || 'DEFAULT_MST');
    const safeYear = sanitizeFilename(String(year || new Date().getFullYear()));

    // Gom chung toàn bộ hồ sơ vào 1 thư mục duy nhất theo MST và Năm (không chia nhỏ thư mục con)
    const fullPath = path.join(this.baseDir, `${safeTaxCode}_${safeYear}`);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }

    return fullPath;
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
      downloadedAt: new Date().toISOString()
    });

    return result;
  }
}

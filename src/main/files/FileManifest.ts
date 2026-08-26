import fs from 'fs';
import path from 'path';
import { FilingType } from '../../shared/types';
import { atomicWriteJson } from '../persistence/atomicWrite';

export interface ManifestEntry {
  filingId: string;
  procedureCode?: string;
  declarationCode?: string;
  period?: string;
  filingType: FilingType;
  supplementalNo?: number;
  savedPaths: string[];
  xmlPath?: string;
  pdfPath?: string;
  sha256?: string;
  downloadedAt: string;
}

export class FileManifest {
  private manifestPath: string;
  private legacyManifestPath: string;
  private entries: Map<string, ManifestEntry> = new Map();

  constructor(targetDir: string, taxCode: string, year: number) {
    // Keep the manifest beside the files. The legacy nested path created a
    // second MST/year tree even though FileOrganizer uses MST_year.
    this.manifestPath = path.join(targetDir, `${taxCode}_${year}`, '.tax_manifest.json');
    this.legacyManifestPath = path.join(targetDir, taxCode, String(year), '.tax_manifest.json');
    this.load();
  }

  private load() {
    try {
      const sourcePath = fs.existsSync(this.manifestPath) ? this.manifestPath : this.legacyManifestPath;
      if (fs.existsSync(sourcePath)) {
        const raw = fs.readFileSync(sourcePath, 'utf-8');
        const data = JSON.parse(raw);
        if (typeof data === 'object' && data !== null) {
          for (const [key, val] of Object.entries(data)) {
            this.entries.set(key, val as ManifestEntry);
          }
        }
      }
    } catch {
      this.entries.clear();
    }
  }

  public save() {
    try {
      const obj: Record<string, ManifestEntry> = {};
      for (const [k, v] of this.entries.entries()) {
        obj[k] = v;
      }
      atomicWriteJson(this.manifestPath, obj, true);
    } catch (err) {
      console.error('Không thể ghi file manifest:', err);
    }
  }

  /**
   * Tầng 1: Logical Pre-Check
   * Kiểm tra xem hồ sơ đã được tải trước đó và các file thực tế trên ổ cứng còn nguyên vẹn hay không.
   * Nếu có -> Trả về true để bỏ qua request download trên mạng.
   */
  public isAlreadyDownloaded(filingId: string): { exists: boolean; entry?: ManifestEntry } {
    const entry = this.entries.get(filingId);
    if (!entry) return { exists: false };

    // Xác minh rằng các file đã ghi nhận trong manifest thực sự còn tồn tại trên đĩa
    if (entry.savedPaths && entry.savedPaths.length > 0) {
      const allFilesExist = entry.savedPaths.every(p => fs.existsSync(p));
      if (allFilesExist) {
        return { exists: true, entry };
      }
    }

    return { exists: false };
  }

  public recordDownload(entry: ManifestEntry) {
    this.entries.set(entry.filingId, entry);
    this.save();
  }

  public getRecord(filingId: string): ManifestEntry | undefined {
    return this.entries.get(filingId);
  }
}

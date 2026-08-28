import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { FilingType } from '../../shared/types';
import { atomicWriteJson } from '../persistence/atomicWrite';
import { safePathSegment } from '../persistence/pathConfinement';

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
  fileHashes?: Record<string, string>;
  downloadedAt: string;
}

export class FileManifest {
  private manifestPath: string;
  private legacyManifestPath: string;
  private entries: Map<string, ManifestEntry> = new Map();

  constructor(targetDir: string, taxCode: string, year: number) {
    const safeTaxCode = safePathSegment(taxCode);
    const safeYear = Math.trunc(Number(year)) || new Date().getFullYear();
    this.manifestPath = path.join(targetDir, `.tax_manifest_${safeTaxCode}.json`);
    this.legacyManifestPath = path.join(targetDir, `${safeTaxCode}_${safeYear}`, '.tax_manifest.json');
    this.load();
  }

  private load() {
    try {
      const candidatePaths = [
        this.manifestPath,
        path.join(path.dirname(this.manifestPath), '.tax_manifest.json'),
        this.legacyManifestPath
      ];
      for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
          const raw = fs.readFileSync(p, 'utf-8');
          const data = JSON.parse(raw);
          if (typeof data === 'object' && data !== null) {
            for (const [key, val] of Object.entries(data)) {
              if (!this.entries.has(key)) {
                this.entries.set(key, val as ManifestEntry);
              }
            }
          }
        }
      }
    } catch {
      // FIX mất dữ liệu: trước đây manifest hỏng → entries.clear() → lần
      // recordDownload kế tiếp GHI ĐÈ manifest chỉ còn entry mới, xóa sạch
      // lịch sử download. Giờ giữ nguyên entries đã nạp (nếu có) và KHÔNG ghi
      // đè manifest khi load lỗi — chỉ báo lỗi để điều tra.
      if (this.entries.size === 0) {
        console.warn('[FileManifest] Manifest hỏng/không đọc được — giữ nguyên file, không ghi đè cho tới khi có bản ghi mới được xác nhận.');
      }
    }
  }

  public save() {
    try {
      // Merge với nội dung trên đĩa: nếu load() lúc đầu hỏng (entries mất),
      // ghi đè thẳng sẽ xóa sạch lịch sử download. Đọc lại file hiện có và
      // overlay các entry mới/updated lên trên.
      const merged: Record<string, ManifestEntry> = {};
      try {
        if (fs.existsSync(this.manifestPath)) {
          const diskData = JSON.parse(fs.readFileSync(this.manifestPath, 'utf-8'));
          if (typeof diskData === 'object' && diskData !== null) {
            Object.assign(merged, diskData);
          }
        }
      } catch {
        // File đĩa hỏng — backup trước khi ghi đè để còn khôi phục thủ công
        try {
          fs.copyFileSync(this.manifestPath, `${this.manifestPath}.corrupt-${Date.now()}.bak`);
        } catch {}
      }
      for (const [k, v] of this.entries.entries()) {
        merged[k] = v;
      }
      atomicWriteJson(this.manifestPath, merged, true);
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
      const allHashesMatch = allFilesExist && entry.fileHashes
        ? entry.savedPaths.every(filePath => {
            const expectedHash = entry.fileHashes?.[filePath];
            if (!expectedHash) return false;
            const actualHash = crypto
              .createHash('sha256')
              .update(fs.readFileSync(filePath))
              .digest('hex');
            return actualHash === expectedHash;
          })
        : allFilesExist;
      if (allHashesMatch) {
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

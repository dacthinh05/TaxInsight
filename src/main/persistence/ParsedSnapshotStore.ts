import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export class ParsedSnapshotStore {
  private static getCacheDir(baseDir: string, taxCode: string): string {
    const cacheDir = path.join(baseDir, taxCode, '.cache_snapshots');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    return cacheDir;
  }

  private static getFilePath(baseDir: string, taxCode: string, submissionId: string): string {
    const safeId = submissionId.replace(/[^a-zA-Z0-9_\-\.]/g, '_');
    return path.join(this.getCacheDir(baseDir, taxCode), `${safeId}.json`);
  }

  /**
   * Đọc snapshot đã lưu từ ổ đĩa (0.1ms)
   */
  public static getSnapshot<T>(baseDir: string, taxCode: string, submissionId: string): T | null {
    try {
      const filePath = this.getFilePath(baseDir, taxCode, submissionId);
      if (!fs.existsSync(filePath)) return null;

      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw, (key, value) => {
        // Restore BigInt (hỗ trợ cả số dương và số âm: 100n, -100n)
        if (typeof value === 'string' && value.endsWith('n') && /^-?\d+n$/.test(value)) {
          return BigInt(value.slice(0, -1));
        }
        return value;
      });

      return parsed as T;
    } catch {
      return null;
    }
  }

  /**
   * Lưu snapshot xuống ổ đĩa an toàn (Atomic Write với Temp Cleanup)
   */
  public static saveSnapshot<T>(baseDir: string, taxCode: string, submissionId: string, data: T): void {
    const filePath = this.getFilePath(baseDir, taxCode, submissionId);
    const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

    try {
      const serialized = JSON.stringify(
        data,
        (key, value) => (typeof value === 'bigint' ? `${value.toString()}n` : value),
        2
      );

      fs.writeFileSync(tempPath, serialized, 'utf-8');
      fs.renameSync(tempPath, filePath);
    } catch (err) {
      console.warn(`[ParsedSnapshotStore] Failed to save snapshot ${submissionId}:`, err);
      // Dọn dẹp file temp nếu rename lỗi
      if (fs.existsSync(tempPath)) {
        try { fs.unlinkSync(tempPath); } catch {}
      }
    }
  }
}

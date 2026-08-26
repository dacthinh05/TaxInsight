import fs from 'fs';
import path from 'path';
import { safePathSegment } from './pathConfinement';

// Thẻ nhận diện BigInt khi serialize: dùng wrapper tường minh thay cho heuristic
// "chuỗi kết thúc bằng n" — heuristic cũ biến mọi string dạng "123n" (vd mã
// giao dịch) thành BigInt khi đọc.
const BIGINT_TAG = '__bigint__';

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return { [BIGINT_TAG]: value.toString() };
  }
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    BIGINT_TAG in (value as Record<string, unknown>) &&
    Object.keys(value as Record<string, unknown>).length === 1
  ) {
    const raw = (value as Record<string, unknown>)[BIGINT_TAG];
    if (typeof raw === 'string' && /^-?\d+$/.test(raw)) {
      try {
        return BigInt(raw);
      } catch {
        return value;
      }
    }
  }
  return value;
}

export class ParsedSnapshotStore {
  private static getCacheDir(baseDir: string, taxCode: string): string {
    // taxCode đến từ session/renderer — sanitize trước khi join path
    const cacheDir = path.join(baseDir, safePathSegment(taxCode), '.cache_snapshots');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    return cacheDir;
  }

  private static getFilePath(baseDir: string, taxCode: string, submissionId: string): string {
    const safeId = safePathSegment(submissionId, 'unknown_id');
    return path.join(this.getCacheDir(baseDir, taxCode), `${safeId}.json`);
  }

  /**
   * Đọc snapshot đã lưu từ ổ đĩa (0.1ms). Snapshot cũ (định dạng heuristic
   * "123n") vẫn đọc được: các trường BigInt sẽ về dạng chuỗi "123n" và được
   * parser tiền (parseMoneyToBigInt/GntMoneyParser) xử lý đúng khi dùng.
   */
  public static getSnapshot<T>(baseDir: string, taxCode: string, submissionId: string): T | null {
    try {
      const filePath = this.getFilePath(baseDir, taxCode, submissionId);
      if (!fs.existsSync(filePath)) return null;

      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw, reviver);
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
      const serialized = JSON.stringify(data, replacer, 2);

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

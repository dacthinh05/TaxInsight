import fs from 'fs';
import path from 'path';

/**
 * Ghi file JSON nguyên tử (atomic write): ghi ra file temp rồi rename đè file đích.
 * Nếu app crash / mất điện giữa chừng, file đích không bao giờ bị truncate —
 * tránh hỏng toàn bộ store (checkpoint, tài khoản đã lưu, coverage, manifest).
 */
export function atomicWriteJson(filePath: string, data: unknown, pretty = false): void {
  const serialized = JSON.stringify(data, null, pretty ? 2 : undefined);
  atomicWriteString(filePath, serialized);
}

/** Ghi nội dung bất kỳ (đã serialize/mã hóa) theo kiểu nguyên tử. */
export function atomicWriteString(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

  try {
    fs.writeFileSync(tempPath, content, 'utf-8');
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {}
    throw err;
  }
}

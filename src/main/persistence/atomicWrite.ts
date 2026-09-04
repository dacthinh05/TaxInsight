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

/** Ghi nội dung bất kỳ (đã serialize/mã hóa) theo kiểu nguyên tử và an toàn đa luồng trên Windows. */
export function atomicWriteString(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const tempPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

  // Retry loop xử lý Windows NTFS momentary lock (EPERM, EBUSY, EACCES)
  const MAX_RETRIES = 12;
  let lastErr: unknown;

  try {
    fs.writeFileSync(tempPath, content, 'utf-8');
  } catch (writeErr) {
    throw writeErr;
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      fs.renameSync(tempPath, filePath);
      return;
    } catch (renameErr: any) {
      lastErr = renameErr;
      const isWindowsLock =
        renameErr?.code === 'EPERM' ||
        renameErr?.code === 'EBUSY' ||
        renameErr?.code === 'EACCES';
      if (isWindowsLock && attempt < MAX_RETRIES) {
        // Jitter đồng bộ để nhả lock trên Windows
        const delay = 15 * attempt + Math.floor(Math.random() * 20);
        const start = Date.now();
        while (Date.now() - start < delay) {
          // Sync spin wait
        }
        continue;
      }
      break;
    }
  }

  // Nếu rename không thành công do lock kéo dài, thử copy đè an toàn
  try {
    fs.copyFileSync(tempPath, filePath);
    try { fs.unlinkSync(tempPath); } catch {}
    return;
  } catch {}

  try {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  } catch {}
  throw lastErr;
}

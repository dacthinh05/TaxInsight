import path from 'path';

/**
 * Kiểm tra `candidate` (tuyệt đối hoặc tương đối) nằm bên trong `baseDir`.
 * Dùng làm rào chắn defense-in-depth cho mọi chỗ đọc/ghi file theo path nhận
 * từ renderer hoặc từ dữ liệu portal — trước đây VatAnalyticsEngine/
 * PitAnalyticsEngine đọc `filing.downloadedFiles.xml` KHÔNG kiểm tra, biến
 * IPC `vat:analyze` thành arbitrary-file-read.
 */
export function isPathInsideBaseDir(baseDir: string, candidate: string): boolean {
  try {
    if (!baseDir || !candidate) return false;
    const resolvedBase = path.resolve(baseDir);
    const resolvedCandidate = path.resolve(candidate);
    const rel = path.relative(resolvedBase, resolvedCandidate);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  } catch {
    return false;
  }
}

/**
 * Chuẩn hóa định danh (MST, submissionId...) thành một đoạn path an toàn.
 * Ký tự lạ → '_', rỗng/'.'/'..' → fallback. Dùng nhất quán ở mọi store thay vì
 * mỗi nơi một kiểu sanitize (trước đây CoverageStore/FileManifest/ParsedSnapshotStore
 * bị sót so với CheckpointStore).
 */
export function safePathSegment(segment: unknown, fallback = 'UNKNOWN'): string {
  const s = String(segment ?? '').trim();
  if (!s) return fallback;
  const cleaned = s.replace(/[^0-9A-Za-z\-_.]/g, '_');
  if (!cleaned || cleaned === '.' || cleaned === '..') return fallback;
  return cleaned;
}

import type { CheerioAPI } from 'cheerio';

export interface AllocationColumnIndexes {
  stt: number;
  referenceDoc: number;
  taxPeriod: number;
  description: number;
  originalAmount: number;
  vndAmount: number;
  chapter: number;
  ndkt: number;
}

const DEFAULT_INDEXES: AllocationColumnIndexes = {
  stt: 0,
  referenceDoc: 1,
  taxPeriod: 2,
  description: 3,
  originalAmount: 4,
  vndAmount: 5,
  chapter: 6,
  ndkt: 7
};

/**
 * Xác định vị trí cột trong bảng khoản nộp (#chungtu_ctiet) của Mẫu C1-02/NS
 * dựa trên TEXT HEADER thay vì vị trí cố định. Nếu không tìm thấy header
 * (HTML khác biệt), giữ layout mặc định đã kiểm chứng.
 *
 * Chỉ tự động dò 2 cột phân loại quan trọng nhất (Chương, Tiểu mục NDKT)
 * để giảm rủi ro khớp nhầm; các cột còn lại dùng mặc định.
 */
export function resolveAllocationColumns($: CheerioAPI): AllocationColumnIndexes {
  const headers: string[] = [];
  $('#chungtu_ctiet th').each((_, th) => {
    headers.push($(th).text().trim());
  });

  // Cần ít nhất 8 cột header để tin rằng đây là bảng đúng layout mới
  if (headers.length < DEFAULT_INDEXES.ndkt + 1) return { ...DEFAULT_INDEXES };

  const indexes = { ...DEFAULT_INDEXES };

  const ndktIdx = headers.findIndex(h => /tiểu\s*mục|ndkt/i.test(h));
  if (ndktIdx >= 0) indexes.ndkt = ndktIdx;

  const chapterIdx = headers.findIndex(h => /chương/i.test(h));
  if (chapterIdx >= 0 && chapterIdx !== indexes.ndkt) indexes.chapter = chapterIdx;

  return indexes;
}

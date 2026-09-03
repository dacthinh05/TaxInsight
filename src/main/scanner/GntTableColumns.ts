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

export interface GntListColumnIndexes {
  stt: number;
  maGiaoDich: number;
  maGiaoDichChiTiet: number;
  lanNop: number;
  soGnt: number;
  soTien: number;
  loaiTien: number;
  trangThai: number;
  soChungTu: number;
  ngayLap: number;
  ngayGui: number;
  ngayNop: number;
  kenhNop: number;
  nganHang: number;
  soTk: number;
}

// Layout cố định đã kiểm chứng của bảng kết quả tra cứu GNT (#allResultTableBody).
// Chỉ dùng khi KHÔNG dò được header — bảng eTax thay đổi thứ tự cột là layout
// này ăn nhầm cột (vd số tiền nhận giá trị của cột khác).
export const GNT_LIST_DEFAULT_INDEXES: GntListColumnIndexes = {
  stt: 0,
  maGiaoDich: 1,
  maGiaoDichChiTiet: 2,
  lanNop: 3,
  soGnt: 4,
  soTien: 5,
  loaiTien: 6,
  trangThai: 7,
  soChungTu: 8,
  ngayLap: 9,
  ngayGui: 10,
  ngayNop: 11,
  kenhNop: 15,
  nganHang: 16,
  soTk: 17
};

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
  let headers: string[] = [];
  $('#chungtu_ctiet th').each((_, th) => {
    headers.push($(th).text().trim());
  });

  // eTax có thể dùng td thay vì th cho dòng tiêu đề bảng
  if (headers.length === 0) {
    $('#chungtu_ctiet tr').each((_, tr) => {
      const cells = $(tr).find('td').map((_, td) => $(td).text().trim()).get();
      if (cells.some(c => /^stt$/i.test(c)) && cells.some(c => /tiểu\s*mục|ndkt/i.test(c))) {
        headers = cells;
        return false;
      }
    });
  }

  // Cần ít nhất 8 cột header để tin rằng đây là bảng đúng layout mới
  if (headers.length < DEFAULT_INDEXES.ndkt + 1) return { ...DEFAULT_INDEXES };

  const indexes = { ...DEFAULT_INDEXES };

  const ndktIdx = headers.findIndex(h => /tiểu\s*mục|ndkt/i.test(h));
  if (ndktIdx >= 0) indexes.ndkt = ndktIdx;

  const chapterIdx = headers.findIndex(h => /chương/i.test(h));
  if (chapterIdx >= 0 && chapterIdx !== indexes.ndkt) indexes.chapter = chapterIdx;

  return indexes;
}

/**
 * Xác định vị trí cột trong BẢNG DANH SÁCH GNT (#allResultTableBody) dựa trên
 * text của dòng header thay vì vị trí cố định. eTax nhiều lần đổi thứ tự/cột,
 * khi đó layout cố định làm SỐ TIỀN nhận nhầm giá trị của cột khác.
 * Nếu header không nhận diện được (bố cục lạ), trả về layout mặc định.
 */
export function resolveGntListColumns(headerTexts: string[]): GntListColumnIndexes {
  const indexes = { ...GNT_LIST_DEFAULT_INDEXES };

  const findIdx = (pattern: RegExp, exclude?: RegExp): number =>
    headerTexts.findIndex(h => {
      const t = h.trim();
      if (!t) return false;
      if (!pattern.test(t)) return false;
      if (exclude && exclude.test(t)) return false;
      return true;
    });

  const stt = findIdx(/^stt\b|^tt$/i);
  const maGdct = findIdx(/chi\s*tiết/i, /không/i);
  const maGd = findIdx(/mã\s*giao\s*dịch/i);
  const lanNop = findIdx(/lần\s*nộp/i);
  const soGnt = findIdx(/giấy\s*nộp\s*tiền|số\s*gnt/i);
  const soTien = findIdx(/số\s*tiền/i, /nguyên\s*tệ|bằng\s*chữ/i);
  const loaiTien = findIdx(/loại\s*tiền/i);
  const trangThai = findIdx(/trạng\s*thái/i);
  const soChungTu = findIdx(/chứng\s*từ/i);
  const ngayLap = findIdx(/ngày\s*lập/i);
  const ngayGui = findIdx(/ngày\s*gửi/i);
  const ngayNop = findIdx(/ngày\s*nộp/i, /từ|đến/i);
  const kenhNop = findIdx(/kênh\s*nộp|hình\s*thức/i);
  const nganHang = findIdx(/ngân\s*hàng/i);
  const soTk = findIdx(/số\s*tk|tài\s*khoản/i);

  // Chỉ tin mapping khi tìm được ít nhất 2 cột sống còn: Số GNT + Số tiền
  if (soGnt < 0 || soTien < 0) {
    return indexes;
  }

  if (stt >= 0) indexes.stt = stt;
  if (maGdct >= 0) indexes.maGiaoDichChiTiet = maGdct;
  if (maGd >= 0) indexes.maGiaoDich = maGd;
  if (lanNop >= 0) indexes.lanNop = lanNop;
  indexes.soGnt = soGnt;
  indexes.soTien = soTien;
  if (loaiTien >= 0) indexes.loaiTien = loaiTien;
  if (trangThai >= 0) indexes.trangThai = trangThai;
  if (soChungTu >= 0) indexes.soChungTu = soChungTu;
  if (ngayLap >= 0) indexes.ngayLap = ngayLap;
  if (ngayGui >= 0) indexes.ngayGui = ngayGui;
  if (ngayNop >= 0) indexes.ngayNop = ngayNop;
  if (kenhNop >= 0) indexes.kenhNop = kenhNop;
  if (nganHang >= 0) indexes.nganHang = nganHang;
  if (soTk >= 0) indexes.soTk = soTk;

  return indexes;
}

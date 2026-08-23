/**
 * Chuẩn hóa trạng thái + đối chiếu cho Giấy Nộp Tiền (GNT).
 *
 * 1) State machine trạng thái thanh toán (nguồn eTax trả về chuỗi văn bản):
 *      Đã lập → Đã gửi → Nộp thành công / Không thành công
 *    normalizePaymentState() ánh xạ chuỗi nguồn sang enum, getSlipStatusView()
 *    sinh label + tooltip giải thích CHÍNH XÁC ngữ nghĩa (VD: "Đã lập GNT"
 *    không được hiểu mặc định là "chưa nộp thuế").
 *
 * 2) Trạng thái đối chiếu nghĩa vụ thuế ↔ GNT, suy ngược từ kết quả
 *    TaxPaymentMatcher (obligations[].matchedSlips):
 *      Khớp · Một phần · Chưa khớp · Nộp trùng? · Không xác định
 */
import { MatchedPaymentSlipItem, TaxObligation } from './obligationTypes';
import { PaymentSlipRecord } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// 1. TRẠNG THÁI THANH TOÁN
// ─────────────────────────────────────────────────────────────────────────────

export type SlipPaymentState = 'PAID_SUCCESS' | 'SENT' | 'CREATED' | 'FAILED' | 'UNKNOWN';

export const normalizePaymentState = (trangThai?: string | null): SlipPaymentState => {
  const st = (trangThai || '').toLowerCase().trim();
  if (!st) return 'UNKNOWN';
  if (st.includes('không thành công') || st.includes('thất bại')) return 'FAILED';
  if (st.includes('thành công') || st.startsWith('đã nộp')) return 'PAID_SUCCESS';
  if (st.includes('đã gửi') || st.includes('đã phát hành')) return 'SENT';
  if (st.includes('đã lập') || st.includes('khởi tạo') || st.includes('đã tạo')) return 'CREATED';
  return 'UNKNOWN';
};

export interface SlipStatusView {
  state: SlipPaymentState;
  label: string;
  badgeClass: string;
  tooltip: string;
}

/** Label + màu + tooltip giải thích đúng ngữ nghĩa trạng thái nguồn */
export const getSlipStatusView = (slip: Pick<PaymentSlipRecord, 'trangThai'>): SlipStatusView => {
  const state = normalizePaymentState(slip.trangThai);
  const raw = (slip.trangThai || '').trim() || '—';

  switch (state) {
    case 'PAID_SUCCESS':
      return {
        state,
        label: '✓ Thành công',
        badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        tooltip: `Trạng thái nguồn eTax: «${raw}». Ngân hàng đã trích nợ và KBNN tiếp nhận — khoản nộp có hiệu lực.`
      };
    case 'SENT':
      return {
        state,
        label: 'Đã gửi',
        badgeClass: 'bg-sky-50 text-sky-700 border-sky-200',
        tooltip: `Trạng thái nguồn eTax: «${raw}». Giấy nộp tiền đã được gửi đi nhưng CHƯA có xác nhận trích nợ — không kết luận là đã nộp thuế.`
      };
    case 'CREATED':
      return {
        state,
        label: 'Đã lập',
        badgeClass: 'bg-amber-50 text-amber-800 border-amber-200',
        tooltip: `Trạng thái nguồn eTax: «${raw}». Giấy nộp tiền mới được LẬP trên hệ thống, chưa chắc đã trừ tiền tài khoản. KHÔNG đồng nghĩa với đã nộp thuế.`
      };
    case 'FAILED':
      return {
        state,
        label: '✗ Không thành công',
        badgeClass: 'bg-red-50 text-red-700 border-red-200',
        tooltip: `Trạng thái nguồn eTax: «${raw}». Giao dịch không thành công — khoản này KHÔNG được tính vào tổng tiền đã nộp.`
      };
    default:
      return {
        state,
        label: 'Không rõ',
        badgeClass: 'bg-slate-100 text-slate-600 border-slate-200',
        tooltip: `Trạng thái nguồn eTax: «${raw}» không thuộc các mức chuẩn (Đã lập → Đã gửi → Thành công). Vui lòng đối chiếu trực tiếp trên eTax.`
      };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. KỲ THUẾ — HIỂN THỊ NGẮN GỌN
// ─────────────────────────────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, '0');
const DMY_RE = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;
const MY_RE = /^(\d{1,2})\/(\d{4})$/;

const parsePeriodPart = (part: string): { m: number; y: number } | null => {
  const dmy = part.trim().match(DMY_RE);
  if (dmy) return { m: parseInt(dmy[2], 10), y: parseInt(dmy[3], 10) };
  const my = part.trim().match(MY_RE);
  if (my) return { m: parseInt(my[1], 10), y: parseInt(my[2], 10) };
  return null;
};

/**
 * Rút gọn kỳ thuế về dạng người dùng quen đọc:
 *   "00/06/2026"                → "06/2026"   (bỏ tiền tố "00/" không mang ý nghĩa)
 *   "01/07/2026-31/07/2026"     → "07/2026"
 *   "01/01/2026-31/03/2026"     → "Q1/2026"
 *   "01/04/2026-31/05/2026"     → "04–05/2026"
 *   "01/12/2026-15/01/2027"     → "12/2026–01/2027"
 *   "Q2/2026" / "2026"          → giữ nguyên
 */
export const formatKyThueShort = (raw?: string | null): string => {
  const s = (raw || '').trim();
  if (!s) return '—';
  if (/^Q[1-4]\/\d{4}$/i.test(s)) return s.toUpperCase();
  if (/^\d{4}$/.test(s)) return s;
  if (/^\d{1,2}\/\d{4}$/.test(s)) return s;

  const parts = s.split(/\s*(?:-|–|—|→)\s*/).filter(Boolean);
  if (parts.length === 2) {
    const a = parsePeriodPart(parts[0]);
    const b = parsePeriodPart(parts[1]);
    if (a && b) {
      if (a.y === b.y) {
        if (a.m === b.m) return `${pad2(a.m)}/${a.y}`;
        if (b.m - a.m === 2 && [1, 4, 7, 10].includes(a.m)) return `Q${Math.ceil(a.m / 3)}/${a.y}`;
        return `${pad2(a.m)}–${pad2(b.m)}/${a.y}`;
      }
      return `${pad2(a.m)}/${a.y}–${pad2(b.m)}/${b.y}`;
    }
  }

  const single = parsePeriodPart(s);
  if (single) return `${pad2(single.m)}/${single.y}`;

  return s;
};

/** "17/01/2026 09:53:27" → "17/01/26" (dùng cho cột ngày trong bảng dày đặc) */
export const formatDateShort = (raw?: string | null): string => {
  const dateOnly = (raw || '').trim().split(/\s+/)[0] || '';
  const m = dateOnly.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return dateOnly || '—';
  const yy = m[3].length === 4 ? m[3].slice(2) : m[3];
  return `${pad2(parseInt(m[1], 10))}/${pad2(parseInt(m[2], 10))}/${yy}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. ĐỐI CHIẾU NGHĨA VỤ ↔ GNT (cột "Đối chiếu" + section trong drawer)
// ─────────────────────────────────────────────────────────────────────────────

export type SlipReconStatus = 'MATCHED' | 'PARTIAL' | 'UNMATCHED' | 'DUPLICATE_SUSPECT' | 'UNKNOWN';

export interface SlipReconObligationRef {
  id: string;
  title: string;
  periodLabel: string;
  payableAmount: bigint;
  allocatedAmount: bigint;
  confidence: MatchedPaymentSlipItem['confidence'];
}

export interface SlipReconInfo {
  status: SlipReconStatus;
  slipAmount: bigint;
  allocatedAmount: bigint;
  obligations: SlipReconObligationRef[];
  /** Các Số GNT khác cùng số tiền + loại thuế + kỳ thuế (dấu hiệu nộp trùng) */
  duplicateWith: string[];
  /** Lý do không thể đối chiếu (khi status = UNKNOWN) */
  reasonUnknown?: string;
}

export const SLIP_RECON_META: Record<SlipReconStatus, { label: string; badgeClass: string; dotClass: string }> = {
  MATCHED: {
    label: 'Khớp',
    badgeClass: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    dotClass: 'bg-emerald-500'
  },
  PARTIAL: {
    label: 'Một phần',
    badgeClass: 'text-amber-700 bg-amber-50 border-amber-200',
    dotClass: 'bg-amber-500'
  },
  UNMATCHED: {
    label: 'Chưa khớp',
    badgeClass: 'text-slate-600 bg-slate-100 border-slate-200',
    dotClass: 'bg-slate-400'
  },
  DUPLICATE_SUSPECT: {
    label: 'Nộp trùng?',
    badgeClass: 'text-orange-700 bg-orange-50 border-orange-300',
    dotClass: 'bg-orange-500'
  },
  UNKNOWN: {
    label: 'Không rõ',
    badgeClass: 'text-slate-400 bg-white border-dashed border-slate-300',
    dotClass: 'bg-slate-300'
  }
};

const fmtBig = (n: bigint): string => n.toLocaleString('vi-VN');

/** Tooltip nghiệp vụ đầy đủ cho ô "Đối chiếu" */
export const getSlipReconTooltip = (info: SlipReconInfo): string => {
  const amount = fmtBig(info.slipAmount);
  switch (info.status) {
    case 'MATCHED':
      return `Đã quy về ${info.obligations.length} nghĩa vụ thuế (${info.obligations.map(o => `${o.title} ${o.periodLabel}`).join('; ')}). Đối chiếu ${fmtBig(info.allocatedAmount)}/${amount} ₫.${info.allocatedAmount > info.slipAmount ? ` Nộp thừa ${fmtBig(info.allocatedAmount - info.slipAmount)} ₫.` : ''}`;
    case 'PARTIAL':
      return `Mới quy được ${fmtBig(info.allocatedAmount)}/${amount} ₫ vào nghĩa vụ thuế — còn ${fmtBig(info.slipAmount - info.allocatedAmount)} ₫ chưa tìm thấy nghĩa vụ tương ứng. Có thể nộp trước kỳ hoặc cần kiểm tra thủ công.`;
    case 'DUPLICATE_SUSPECT':
      return `Có ${info.duplicateWith.length + 1} GNT cùng số tiền ${amount} ₫, cùng loại thuế và kỳ thuế: ${[...info.duplicateWith].sort().join(', ')}. Nếu nghiệp vụ chỉ phát sinh một khoản phải nộp → khả năng nộp trùng, cần kiểm tra.`;
    case 'UNMATCHED':
      return `Không tìm thấy nghĩa vụ thuế nào khớp khoản ${amount} ₫ này (theo tiểu mục NDKT + kỳ thuế). Có thể: nộp thừa / nộp cho kỳ chưa kê khai / tờ khai chưa nằm trong dữ liệu đã quét.`;
    default:
      return info.reasonUnknown || 'Chưa đủ dữ liệu để đối chiếu.';
  }
};

type PaymentQueryStatus = 'CONNECTED_WITH_DATA' | 'CONNECTED_NO_DATA' | 'QUERY_FAILED' | 'NOT_QUERIED';

const dedupeSorted = (arr: string[]): string[] => [...new Set(arr)].sort();

/**
 * Dựng Map<slipId, SlipReconInfo> từ kết quả đối chiếu của TaxObligationEngine.
 * - UNKNOWN khi: chưa tra cứu GNT / tra cứu lỗi / chưa có nghĩa vụ nào để đối chiếu.
 * - DUPLICATE_SUSPECT: ≥2 GNT cùng (số tiền + loại thuế + kỳ thuế) và bản thân
 *   chưa được quy hết vào nghĩa vụ nào.
 */
export const buildSlipReconciliationIndex = (
  slips: PaymentSlipRecord[],
  obligations: TaxObligation[] | undefined,
  queryStatus: PaymentQueryStatus
): Map<string, SlipReconInfo> => {
  const index = new Map<string, SlipReconInfo>();

  // ── Không đủ điều kiện kết luận → UNKNOWN có lý do ──
  let unknownReason: string | undefined;
  if (queryStatus === 'NOT_QUERIED') {
    unknownReason = 'Chưa tra cứu danh sách Giấy nộp tiền từ eTax. Bấm «Tra cứu» để tải dữ liệu rồi đối chiếu.';
  } else if (queryStatus === 'QUERY_FAILED') {
    unknownReason = 'Tra cứu GNT thất bại hoặc chưa hoàn tất — không thể kết luận tình trạng đối chiếu.';
  } else if (queryStatus === 'CONNECTED_NO_DATA') {
    unknownReason = 'Kỳ tra cứu không có Giấy nộp tiền nào.';
  } else if (!obligations || obligations.length === 0) {
    unknownReason = 'Chưa có dữ liệu tờ khai / nghĩa vụ thuế để đối chiếu. Hãy quét hồ sơ ở tab «Tờ khai & Hồ sơ».';
  } else {
    const totalPayable = obligations.reduce((acc, ob) => acc + (ob.amountPayable > 0n ? ob.amountPayable : 0n), 0n);
    if (totalPayable <= 0n) {
      unknownReason = 'Các tờ khai đã quét không phát sinh số thuế phải nộp — không có nghĩa vụ để đối chiếu.';
    }
  }

  if (unknownReason) {
    for (const slip of slips) {
      index.set(slip.id, {
        status: 'UNKNOWN',
        slipAmount: BigInt(Math.round(slip.soTien || 0)),
        allocatedAmount: 0n,
        obligations: [],
        duplicateWith: [],
        reasonUnknown: unknownReason
      });
    }
    return index;
  }

  // ── Agregate allocation ngược: obligation.matchedSlips → theo slipId ──
  const allocBySlip = new Map<string, { allocated: bigint; refs: SlipReconObligationRef[] }>();
  for (const ob of obligations!) {
    if (!ob.matchedSlips || ob.matchedSlips.length === 0) continue;
    for (const ms of ob.matchedSlips) {
      const entry = allocBySlip.get(ms.paymentSlipId) || { allocated: 0n, refs: [] };
      entry.allocated += ms.allocatedAmount;
      entry.refs.push({
        id: ob.id,
        title: ob.title,
        periodLabel: ob.periodLabel,
        payableAmount: ob.amountPayable,
        allocatedAmount: ms.allocatedAmount,
        confidence: ms.confidence
      });
      allocBySlip.set(ms.paymentSlipId, entry);
    }
  }

  // ── Trạng thái cơ sở theo mức phân bổ ──
  for (const slip of slips) {
    const slipAmount = BigInt(Math.round(slip.soTien || 0));
    const alloc = allocBySlip.get(slip.id);

    let status: SlipReconStatus;
    if (!alloc || alloc.allocated <= 0n) {
      status = 'UNMATCHED';
    } else if (alloc.allocated >= slipAmount) {
      status = 'MATCHED';
    } else {
      status = 'PARTIAL';
    }

    index.set(slip.id, {
      status,
      slipAmount,
      allocatedAmount: alloc ? alloc.allocated : 0n,
      obligations: alloc ? alloc.refs : [],
      duplicateWith: []
    });
  }

  // ── Phát hiện dấu hiệu nộp trùng: cùng (tiền + loại thuế + kỳ thuế) ──
  const dupGroups = new Map<string, PaymentSlipRecord[]>();
  for (const slip of slips) {
    if (!slip.soTien || slip.soTien <= 0 || !slip.classification) continue;
    const key = [
      slip.soTien,
      dedupeSorted(slip.classification.taxTypes).join('+'),
      dedupeSorted(slip.classification.periods.map(formatKyThueShort)).join('+')
    ].join('|');
    const group = dupGroups.get(key) || [];
    group.push(slip);
    dupGroups.set(key, group);
  }

  for (const group of dupGroups.values()) {
    if (group.length < 2) continue;
    for (const member of group) {
      const info = index.get(member.id)!;
      // Chỉ nâng cấp các khoản CHƯA được quy hết — nhóm cùng khớp đủ là hợp lệ
      // (VD: 2 tờ khai nhà đất cùng kỳ, mỗi tờ một GNT riêng).
      if (info.status !== 'UNMATCHED') continue;
      index.set(member.id, {
        ...info,
        status: 'DUPLICATE_SUSPECT',
        duplicateWith: group.filter(g => g.id !== member.id).map(g => g.soGnt)
      });
    }
  }

  return index;
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. TÌM KIẾM / LỌC DANH SÁCH GNT
// ─────────────────────────────────────────────────────────────────────────────

export const filterPaymentSlips = (slips: PaymentSlipRecord[], query: string): PaymentSlipRecord[] => {
  const q = query.toLowerCase().trim();
  if (!q) return slips;
  return slips.filter(s => {
    const classText = s.classification
      ? `${s.classification.taxTypes.join(' ')} ${s.classification.periods.join(' ')} ${s.classification.ndktCodes.join(' ')}`.toLowerCase()
      : '';
    return (
      s.soGnt.toLowerCase().includes(q) ||
      s.maGiaoDich.toLowerCase().includes(q) ||
      (!!s.soChungTu && s.soChungTu.toLowerCase().includes(q)) ||
      (!!s.tenNganHang && s.tenNganHang.toLowerCase().includes(q)) ||
      (!!s.soTaiKhoan && s.soTaiKhoan.toLowerCase().includes(q)) ||
      s.soTienFormatted.toLowerCase().includes(q) ||
      s.trangThai.toLowerCase().includes(q) ||
      classText.includes(q)
    );
  });
};

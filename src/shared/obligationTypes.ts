import { DateRange, FilingType, TaxFiling, TaxType } from './types';

export type TaxObligationStatus =
  | 'NO_TAX_DUE'
  | 'NOT_DUE'
  | 'DUE_SOON'
  | 'DUE_TODAY'
  | 'PAST_DEADLINE_NO_MATCHED_PAYMENT'
  | 'PAID_MATCHED'
  | 'PARTIALLY_MATCHED'
  | 'PAYMENT_FOUND_NEEDS_REVIEW'
  | 'PAYMENT_DATA_UNAVAILABLE'
  | 'DEADLINE_UNKNOWN'
  | 'AMBIGUOUS_PAYMENT_MATCH';  // FIX 6: Khi có nhiều candidate cùng confidence, không tự động chọn

export type PaymentMatchConfidence = 'EXACT' | 'HIGH' | 'POSSIBLE' | 'NONE';

export interface LegalDocumentRef {
  id: string;
  documentNumber: string;
  documentTitle: string;
  article?: string;
  clause?: string;
  effectiveFrom: string; // ISO YYYY-MM-DD
  effectiveTo?: string;
  summary: string;
  reviewedAt: string;
}

export interface TaxDeadlineResult {
  baseFilingDeadline: string | null;     // dd/MM/yyyy
  basePaymentDeadline: string | null;    // dd/MM/yyyy
  effectiveFilingDeadline: string | null;  // dd/MM/yyyy (sau khi tính ngày nghỉ/lễ)
  effectivePaymentDeadline: string | null; // dd/MM/yyyy (sau khi tính gia hạn + ngày nghỉ/lễ)
  ruleId: string | null;
  legalBasis: LegalDocumentRef[];
  extensionApplied: boolean;
  extensionReason?: string;
  confidence: 'CONFIRMED' | 'NEEDS_REVIEW' | 'UNKNOWN';
  notes?: string[];
  isAdjustedForHoliday: boolean;
  originalDateBeforeHoliday?: string;
}

export interface MatchedPaymentSlipItem {
  paymentSlipId: string;
  soGnt: string;
  maGiaoDich: string;
  ngayNop: string; // dd/MM/yyyy HH:mm:ss
  ngayNopDateOnly: string; // dd/MM/yyyy
  subItemStt?: number;
  maNDKT?: string; // Tiểu mục (vd: 1701, 1001, 1052)
  noiDungKhoanNop?: string;
  allocatedAmount: bigint;
  confidence: PaymentMatchConfidence;
  matchReason: string;
  isPaidAfterDeadline: boolean;
  daysLate?: number;
}

export interface TaxObligation {
  id: string; // Unique key e.g. "MST_VAT_01/GTGT_2026-M07"
  taxCode: string;
  taxType: TaxType;
  declarationCode: string; // "01/GTGT", "05/KK-TNCN", "03/TNDN", "01/NTNN"
  title: string;
  periodKey: string; // e.g. "2026-M07", "2026-Q2", "2025-YEAR"
  periodLabel: string; // e.g. "07/2026", "Quý 2/2026"
  year: number;
  month?: number;
  quarter?: number;
  
  // Số thuế phải nộp của phiên bản hiện hành (BigInt VND)
  amountPayable: bigint;
  originalAmountPayable?: bigint;
  supplementalIncreaseAmount?: bigint; // Số thuế tăng thêm nếu có khai bổ sung
  hasSupplemental: boolean;
  supplementalCount: number;
  latestSubmissionDate?: string;
  isSupplementalAfterDeadline?: boolean;
  currentVersion: string; // "Chính thức", "BS lần 1", "BS lần 2"
  
  // Deadline & Căn cứ pháp lý
  deadline: TaxDeadlineResult;
  status: TaxObligationStatus;
  daysRemaining: number | null; // > 0: còn X ngày, 0: hôm nay, < 0: qua hạn X ngày
  
  // Đối chiếu Giấy nộp tiền (GNT)
  matchedPaymentAmount: bigint;
  matchedSlips: MatchedPaymentSlipItem[];
  discrepancy: bigint; // amountPayable - matchedPaymentAmount (dương = còn thiếu, 0 = đủ, âm = thừa)
  statusMessage: string;
}

export interface TaxObligationSummary {
  taxCode: string;
  totalObligationsCount: number;
  totalPayableAmount: bigint;
  totalMatchedPaidAmount: bigint;
  totalDiscrepancy: bigint;
  
  // Phân loại trạng thái theo mức độ ưu tiên nghiệp vụ
  pastDeadlineNoPaymentCount: number; // 🔴 Đã qua hạn chưa thấy GNT
  dueSoonCount: number;               // 🟠 Sắp đến hạn (<= 5 ngày)
  dueTodayCount: number;              // 🟡 Hạn hôm nay
  paymentNeedsReviewCount: number;     // 🔵 Có GNT cần kiểm tra
  paidMatchedCount: number;           // 🟢 Đã đối chiếu đủ
  partiallyMatchedCount: number;      // 🟣 Đối chiếu một phần
  paymentDataUnavailableCount: number;// ⚪ Chưa truy vấn được GNT
  notDueCount: number;                // ⚪ Chưa đến hạn
  noTaxDueCount: number;              // ⚪ Không phát sinh thuế
  paymentQueryStatus?: 'CONNECTED_WITH_DATA' | 'CONNECTED_NO_DATA' | 'QUERY_FAILED' | 'NOT_QUERIED';

  // Khoản nghĩa vụ cần chú ý nhất (ưu tiên Overdue -> Due Soon)
  nearestUrgentObligation?: TaxObligation | null;
  obligations?: TaxObligation[];
}

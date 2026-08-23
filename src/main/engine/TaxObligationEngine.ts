import { TaxObligation, TaxObligationSummary } from '../../shared/obligationTypes';
import { DateRange, PaymentSlipDetail, PaymentSlipRecord, TaxFiling } from '../../shared/types';
import { TaxObligationExtractor } from './TaxObligationExtractor';
import { TaxPaymentMatcher } from './TaxPaymentMatcher';

/**
 * Kiểm tra hạn nộp (dd/MM/yyyy) có nằm ngoài TẤT CẢ các phạm vi ngày GNT đã tra cứu hay không.
 * Chỉ khi nằm ngoài mọi khoảng thì mới coi là "chưa có dữ liệu phủ" — hỗ trợ tra cứu đa năm.
 */
function isDeadlineOutsideCoverage(
  deadlineStr: string | null,
  ranges: DateRange[] | DateRange | null | undefined
): boolean {
  const list = Array.isArray(ranges) ? ranges : ranges ? [ranges] : [];
  if (!deadlineStr || list.length === 0) return false;

  const toTime = (val: string): number | null => {
    const parts = val.trim().split(/[\s/:]+/);
    if (parts.length < 3) return null;
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const y = parseInt(parts[2], 10);
    if (!Number.isFinite(d) || !Number.isFinite(m) || !Number.isFinite(y)) return null;
    return new Date(y, m, d).getTime();
  };

  const deadlineTime = toTime(deadlineStr);
  if (deadlineTime === null) return false;

  for (const range of list) {
    const fromTime = toTime(range.fromDate || '');
    const toTimeEnd = toTime(range.toDate || '');
    if (fromTime === null || toTimeEnd === null) continue;
    if (deadlineTime >= fromTime && deadlineTime <= toTimeEnd) {
      return false; // nằm trong ít nhất một khoảng phủ
    }
  }
  return true;
}

export class TaxObligationEngine {
  /**
   * Tính toán toàn bộ Nghĩa vụ thuế, Hạn nộp và Đối chiếu Giấy nộp tiền
   */
  public static processObligations(
    filings: TaxFiling[],
    paymentSlips: PaymentSlipRecord[],
    taxCode: string,
    paymentDetails?: Map<string, PaymentSlipDetail>,
    referenceDate: Date = new Date(),
    paymentQueryStatus: 'CONNECTED_WITH_DATA' | 'CONNECTED_NO_DATA' | 'QUERY_FAILED' | 'NOT_QUERIED' = 'NOT_QUERIED',
    gntCoverageRange?: DateRange[] | DateRange | null
  ): TaxObligationSummary {
    // 1. Trích xuất Nghĩa vụ thuế từ hồ sơ kê khai
    const extractedObligations = TaxObligationExtractor.extractObligations(filings, taxCode, referenceDate);

    // 2. Đối chiếu với Giấy nộp tiền
    const rawMatchedObligations = TaxPaymentMatcher.matchPayments(extractedObligations, paymentSlips, paymentDetails);

    // 3. Nếu chưa truy vấn được GNT hoặc truy vấn bị lỗi -> KHÔNG ĐƯỢC KẾT LUẬN NỢ THUẾ.
    //    Tương tự: đã kết nối nhưng phạm vi ngày tra cứu KHÔNG PHỦ hạn nộp của nghĩa vụ
    //    (vd quét GNT năm 2026 trong khi nghĩa vụ hạn nộp 2024) — cấm kết luận "chưa nộp".
    const matchedObligations = rawMatchedObligations.map(ob => {
      if (ob.amountPayable > 0n && ob.matchedPaymentAmount === 0n) {
        const coverageList = gntCoverageRange
          ? (Array.isArray(gntCoverageRange) ? gntCoverageRange : [gntCoverageRange])
          : [];
        const outsideCoverage =
          paymentQueryStatus === 'CONNECTED_WITH_DATA' &&
          isDeadlineOutsideCoverage(ob.deadline.effectivePaymentDeadline, coverageList);

        if (outsideCoverage) {
          const rangeText = coverageList
            .map(r => `${r.fromDate} – ${r.toDate}`)
            .join(' ; ');
          return {
            ...ob,
            status: 'PAYMENT_DATA_UNAVAILABLE' as const,
            statusMessage: `Chưa tra cứu GNT phủ đến hạn nộp ${ob.deadline.effectivePaymentDeadline} (phạm vi hiện tại: ${rangeText}) — chưa xác minh thanh toán`
          };
        }

        if (paymentQueryStatus === 'QUERY_FAILED' || paymentQueryStatus === 'NOT_QUERIED') {
          return {
            ...ob,
            status: 'PAYMENT_DATA_UNAVAILABLE' as const,
            statusMessage: 'Chưa thể kết nối Cổng Thuế để lấy Giấy nộp tiền (Chưa xác minh thanh toán)'
          };
        }
      }
      return ob;
    });

    // 4. Tính toán các chỉ số thống kê & phân loại
    let totalPayable = 0n;
    let totalPaid = 0n;
    let pastDeadlineCount = 0;
    let dueSoonCount = 0;
    let dueTodayCount = 0;
    let paymentNeedsReviewCount = 0;
    let paidMatchedCount = 0;
    let partiallyMatchedCount = 0;
    let paymentDataUnavailableCount = 0;
    let notDueCount = 0;
    let noTaxDueCount = 0;

    let nearestUrgent: TaxObligation | null = null;

    for (const ob of matchedObligations) {
      totalPayable += ob.amountPayable;
      totalPaid += ob.matchedPaymentAmount;

      switch (ob.status) {
        case 'PAST_DEADLINE_NO_MATCHED_PAYMENT':
          pastDeadlineCount++;
          if (!nearestUrgent) nearestUrgent = ob;
          break;
        case 'DUE_TODAY':
          dueTodayCount++;
          if (!nearestUrgent || nearestUrgent.status !== 'PAST_DEADLINE_NO_MATCHED_PAYMENT') {
            nearestUrgent = ob;
          }
          break;
        case 'DUE_SOON':
          dueSoonCount++;
          if (!nearestUrgent || (nearestUrgent.status !== 'PAST_DEADLINE_NO_MATCHED_PAYMENT' && nearestUrgent.status !== 'DUE_TODAY')) {
            nearestUrgent = ob;
          }
          break;
        case 'PAYMENT_FOUND_NEEDS_REVIEW':
          paymentNeedsReviewCount++;
          break;
        case 'PAID_MATCHED':
          paidMatchedCount++;
          break;
        case 'PARTIALLY_MATCHED':
          partiallyMatchedCount++;
          break;
        case 'PAYMENT_DATA_UNAVAILABLE':
          paymentDataUnavailableCount++;
          break;
        case 'NOT_DUE':
          notDueCount++;
          break;
        case 'NO_TAX_DUE':
          noTaxDueCount++;
          break;
      }
    }

    const totalDiscrepancy = totalPayable > totalPaid ? totalPayable - totalPaid : 0n;

    return {
      taxCode,
      totalObligationsCount: matchedObligations.length,
      totalPayableAmount: totalPayable,
      totalMatchedPaidAmount: totalPaid,
      totalDiscrepancy,
      pastDeadlineNoPaymentCount: pastDeadlineCount,
      dueSoonCount,
      dueTodayCount,
      paymentNeedsReviewCount,
      paidMatchedCount,
      partiallyMatchedCount,
      paymentDataUnavailableCount,
      notDueCount,
      noTaxDueCount,
      paymentQueryStatus,
      nearestUrgentObligation: nearestUrgent,
      obligations: matchedObligations
    };
  }
}

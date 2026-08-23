import { isFilingRejected, normalizeVatPeriod } from '../../shared/dateUtils';
import { parseMoneyToBigInt } from '../../shared/moneyUtils';
import { TaxObligation, TaxObligationStatus } from '../../shared/obligationTypes';
import { TaxFiling } from '../../shared/types';
import { TaxDeadlineEngine } from './TaxDeadlineEngine';

export class TaxObligationExtractor {
  /**
   * Trích xuất danh sách Nghĩa vụ thuế từ danh sách hồ sơ khai thuế đã tải/quét được
   */
  public static extractObligations(
    filings: TaxFiling[],
    taxCode: string,
    referenceDate: Date = new Date()
  ): TaxObligation[] {
    // 1. Phân nhóm hồ sơ theo Chuỗi kê khai (Series Key = Sắc thuế + Mẫu biểu + Kỳ)
    const seriesMap = new Map<string, TaxFiling[]>();

    for (const f of filings) {
      // Chỉ xét các tờ khai có phát sinh nghĩa vụ thuế (bỏ qua hồ sơ hoàn thuế 01/HT, báo cáo hóa đơn, thủ tục hành chính)
      if (
        f.taxType === 'REPORT' ||
        f.taxType === 'OTHER' ||
        f.taxType === 'REFUND' ||
        f.declarationCode === '01/HT' ||
        f.procedureCode?.startsWith('01/HT')
      ) {
        continue;
      }

      const norm = f.periodNormalized || (f.period ? normalizeVatPeriod(f.period, f.submittedAt) : undefined);
      let periodKey = f.period || 'UNKNOWN';
      if (norm) {
        if (norm.type === 'MONTH' && norm.month) {
          periodKey = `${norm.year}-M${String(norm.month).padStart(2, '0')}`;
        } else if (norm.type === 'QUARTER' && norm.quarter) {
          periodKey = `${norm.year}-Q${norm.quarter}`;
        } else {
          periodKey = `${norm.year}-YEAR`;
        }
      }
      const declCode = f.declarationCode || (f.taxType === 'VAT' ? '01/GTGT' : (f.procedureCode || f.title));
      const seriesKey = `${f.taxType}_${declCode}_${periodKey}`;

      if (!seriesMap.has(seriesKey)) {
        seriesMap.set(seriesKey, []);
      }
      seriesMap.get(seriesKey)!.push(f);
    }

    const obligations: TaxObligation[] = [];

    // 2. Xử lý từng chuỗi kê khai: Xác định bản hiện hành và số thuế phải nộp
    for (const [seriesKey, seriesFilings] of seriesMap.entries()) {
      if (seriesFilings.length === 0) continue;

      // Ưu tiên chỉ xét các hồ sơ hợp lệ (không bị cơ quan thuế từ chối/không chấp nhận)
      const validFilings = seriesFilings.filter(f => !isFilingRejected(f));
      const targetSeries = validFilings.length > 0 ? validFilings : seriesFilings;

      // Sắp xếp thứ tự thời gian nộp (cũ nhất -> mới nhất)
      const sorted = [...targetSeries].sort((a, b) => {
        const timeA = a.submittedAt ? parseSubmitTime(a.submittedAt) : 0;
        const timeB = b.submittedAt ? parseSubmitTime(b.submittedAt) : 0;
        return timeA - timeB;
      });

      const originalFiling = sorted.find(f => f.filingType === 'ORIGINAL' || !f.supplementalNo) || sorted[0];
      const latestFiling = sorted[sorted.length - 1]; // Bản hiện hành có hiệu lực pháp lý cao nhất

      const norm = latestFiling.periodNormalized || (latestFiling.period ? normalizeVatPeriod(latestFiling.period, latestFiling.submittedAt) : undefined);
      const year = norm ? norm.year : new Date().getFullYear();
      const month = norm?.type === 'MONTH' ? norm.month : undefined;
      const quarter = norm?.type === 'QUARTER' ? norm.quarter : undefined;
      const periodType: 'MONTH' | 'QUARTER' | 'YEAR' | 'OTHER' =
        norm?.type === 'MONTH' || norm?.type === 'QUARTER' || norm?.type === 'YEAR' ? norm.type : 'MONTH';

      const declCode = latestFiling.declarationCode || (latestFiling.taxType === 'VAT' ? '01/GTGT' : latestFiling.taxType === 'PIT' ? '05/KK-TNCN' : latestFiling.taxType === 'HOUSE_LAND' ? 'Nhà đất' : '03/TNDN');
      const isFinalization = latestFiling.filingType === 'FINALIZATION' || declCode === '03/TNDN' || declCode === '05/QTT-TNCN';

      // Tính hạn nộp chuẩn xác theo kỳ gốc (kể cả khi nộp bổ sung, deadline vẫn theo kỳ gốc)
      const deadline = TaxDeadlineEngine.resolveDeadline({
        taxType: latestFiling.taxType,
        declarationCode: declCode,
        periodType,
        year,
        month,
        quarter,
        isFinalization
      });

      // Trích xuất số thuế phải nộp của bản hiện hành
      const amountPayable = this.extractAmountPayable(latestFiling);
      const originalAmount = this.extractAmountPayable(originalFiling);

      const hasSupplemental = sorted.length > 1 || latestFiling.filingType === 'SUPPLEMENTAL';
      const supplementalCount = sorted.filter(f => f.filingType === 'SUPPLEMENTAL' || (f.supplementalNo && f.supplementalNo > 0)).length;

      // Tính phần tăng thêm do khai bổ sung (nếu có)
      let supplementalIncreaseAmount: bigint | undefined = undefined;
      if (hasSupplemental && amountPayable > originalAmount) {
        supplementalIncreaseAmount = amountPayable - originalAmount;
      }

      // Kiểm tra xem việc nộp bổ sung có diễn ra sau deadline của kỳ hay không
      let isSupplementalAfterDeadline = false;
      if (hasSupplemental && deadline.effectivePaymentDeadline && latestFiling.submittedAt) {
        const deadlineDate = parseVnDate(deadline.effectivePaymentDeadline);
        const submitDate = parseSubmitDate(latestFiling.submittedAt);
        if (deadlineDate && submitDate && submitDate.getTime() > deadlineDate.getTime()) {
          isSupplementalAfterDeadline = true;
        }
      }

      // Tính số ngày còn lại đến hạn nộp
      const daysRemaining = this.calculateDaysRemaining(deadline.effectivePaymentDeadline, referenceDate);

      // Xác định trạng thái ban đầu (trước khi đối chiếu GNT)
      const initialStatus = this.determineInitialStatus(amountPayable, daysRemaining);

      const periodLabel = norm
        ? norm.type === 'MONTH' && norm.month
          ? `Tháng ${String(norm.month).padStart(2, '0')}/${norm.year}`
          : norm.type === 'QUARTER' && norm.quarter
          ? `Quý ${norm.quarter}/${norm.year}`
          : `Năm ${norm.year}`
        : latestFiling.period || '—';

      const obligation: TaxObligation = {
        id: `${taxCode}_${latestFiling.taxType}_${declCode}_${seriesKey}`,
        taxCode,
        taxType: latestFiling.taxType,
        declarationCode: declCode,
        title: latestFiling.title,
        periodKey: seriesKey,
        periodLabel,
        year,
        month,
        quarter,
        amountPayable,
        originalAmountPayable: originalAmount,
        supplementalIncreaseAmount,
        hasSupplemental,
        supplementalCount,
        latestSubmissionDate: latestFiling.submittedAt,
        isSupplementalAfterDeadline,
        currentVersion: latestFiling.filingType === 'SUPPLEMENTAL'
          ? `Bổ sung lần ${latestFiling.supplementalNo || 1}`
          : 'Chính thức',
        deadline,
        status: initialStatus,
        daysRemaining,
        matchedPaymentAmount: 0n,
        matchedSlips: [],
        discrepancy: amountPayable,
        statusMessage: this.generateStatusMessage(initialStatus, daysRemaining, isSupplementalAfterDeadline)
      };

      obligations.push(obligation);
    }

    // Sắp xếp nghĩa vụ: Kỳ mới nhất lên đầu
    return obligations.sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      if (a.quarter && b.quarter) return b.quarter - a.quarter;
      if (a.month && b.month) return b.month - a.month;
      return 0;
    });
  }

  /**
   * Trích xuất số thuế phải nộp (BigInt VND) từ thông tin hồ sơ
   */
  private static extractAmountPayable(filing: TaxFiling): bigint {
    if (filing.amountPayable !== undefined && filing.amountPayable !== null) {
      return parseMoneyToBigInt(filing.amountPayable);
    }
    return 0n;
  }

  private static calculateDaysRemaining(effectiveDeadlineStr: string | null, referenceDate: Date): number | null {
    if (!effectiveDeadlineStr) return null;
    const target = parseVnDate(effectiveDeadlineStr);
    if (!target) return null;

    // Chuẩn hóa về 00:00:00 của ngày
    const ref = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
    const dead = new Date(target.getFullYear(), target.getMonth(), target.getDate());

    const diffMs = dead.getTime() - ref.getTime();
    return Math.round(diffMs / (1000 * 60 * 60 * 24));
  }

  private static determineInitialStatus(amountPayable: bigint, daysRemaining: number | null): TaxObligationStatus {
    if (amountPayable <= 0n) {
      return 'NO_TAX_DUE';
    }
    if (daysRemaining === null) {
      return 'DEADLINE_UNKNOWN';
    }
    if (daysRemaining < 0) {
      return 'PAST_DEADLINE_NO_MATCHED_PAYMENT';
    }
    if (daysRemaining === 0) {
      return 'DUE_TODAY';
    }
    if (daysRemaining <= 5) {
      return 'DUE_SOON';
    }
    return 'NOT_DUE';
  }

  private static generateStatusMessage(
    status: TaxObligationStatus,
    daysRemaining: number | null,
    isSupplementalAfterDeadline: boolean
  ): string {
    if (status === 'NO_TAX_DUE') return 'Không phát sinh thuế phải nộp';
    if (status === 'DEADLINE_UNKNOWN') return 'Chưa đủ thông tin xác định hạn nộp';
    if (status === 'PAST_DEADLINE_NO_MATCHED_PAYMENT') {
      const days = Math.abs(daysRemaining || 0);
      return `Đã qua hạn theo kỳ (${days} ngày) · Chưa tìm thấy GNT đối chiếu`;
    }
    if (status === 'DUE_TODAY') return 'Hạn nộp hôm nay';
    if (status === 'DUE_SOON') return `Sắp đến hạn nộp (còn ${daysRemaining} ngày)`;
    if (status === 'NOT_DUE') return `Còn ${daysRemaining} ngày đến hạn nộp`;

    return '';
  }
}

function parseSubmitTime(val: string): number {
  // dd/MM/yyyy HH:mm:ss
  const parts = val.trim().split(/[\s/:]+/);
  if (parts.length >= 3) {
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const y = parseInt(parts[2], 10);
    const h = parts.length >= 4 ? parseInt(parts[3], 10) : 0;
    const min = parts.length >= 5 ? parseInt(parts[4], 10) : 0;
    return new Date(y, m, d, h, min).getTime();
  }
  return 0;
}

function parseSubmitDate(val: string): Date | null {
  const parts = val.trim().split(/[\s/:]+/);
  if (parts.length >= 3) {
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const y = parseInt(parts[2], 10);
    return new Date(y, m, d);
  }
  return null;
}

function parseVnDate(val: string): Date | null {
  const parts = val.trim().split(/[\s/]+/);
  if (parts.length >= 3) {
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const y = parseInt(parts[2], 10);
    return new Date(y, m, d);
  }
  return null;
}

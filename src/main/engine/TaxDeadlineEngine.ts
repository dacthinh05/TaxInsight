import { LegalDocumentRef, TaxDeadlineResult } from '../../shared/obligationTypes';
import { BusinessDayCalendar } from './BusinessDayCalendar';
import { LegalRuleRegistry } from './LegalRuleRegistry';

export interface ResolveDeadlineOptions {
  taxType: string;
  declarationCode?: string;
  periodType: 'MONTH' | 'QUARTER' | 'YEAR' | 'OTHER';
  year: number;
  month?: number;
  quarter?: number;
  isFinalization?: boolean;
}

export class TaxDeadlineEngine {
  /**
   * Tính toán thời hạn nộp hồ sơ và thời hạn nộp thuế chính xác theo luật định
   */
  public static resolveDeadline(options: ResolveDeadlineOptions): TaxDeadlineResult {
    const { taxType, declarationCode, periodType, year, month, quarter, isFinalization } = options;

    // 1. Xác định ngày deadline cơ sở (Base Date) trước khi tính ngày nghỉ
    let baseDate: Date | null = null;
    let rulePeriodType: 'MONTH' | 'QUARTER' | 'YEAR' | 'FINALIZATION_CIT' | 'FINALIZATION_PIT' = 'MONTH';

    const isIndividualPitFinalization = declarationCode === '02/QTT-TNCN';
    if (isIndividualPitFinalization) {
      rulePeriodType = 'FINALIZATION_PIT';
      baseDate = new Date(year + 1, 3, 30);
    } else if (isFinalization || declarationCode === '03/TNDN' || declarationCode === '05/QTT-TNCN' || periodType === 'YEAR') {
      rulePeriodType = 'FINALIZATION_CIT';
      // Quyết toán năm: Ngày cuối cùng của tháng thứ 3 năm tiếp theo (31/03/YYYY+1)
      baseDate = new Date(year + 1, 2, 31); // Month 2 = March in JS Date (0-indexed)
    } else if (periodType === 'QUARTER' && quarter) {
      rulePeriodType = 'QUARTER';
      // Khai quý: Ngày cuối cùng của tháng đầu tiên quý tiếp theo
      // Q1 (tháng 1,2,3) -> Ngày cuối tháng 4 (30/04)
      // Q2 (tháng 4,5,6) -> Ngày cuối tháng 7 (31/07)
      // Q3 (tháng 7,8,9) -> Ngày cuối tháng 10 (31/10)
      // Q4 (tháng 10,11,12) -> Ngày cuối tháng 1 năm sau (31/01/YYYY+1)
      if (quarter === 1) baseDate = new Date(year, 3, 30); // 30/04
      else if (quarter === 2) baseDate = new Date(year, 6, 31); // 31/07
      else if (quarter === 3) baseDate = new Date(year, 9, 31); // 31/10
      else if (quarter === 4) baseDate = new Date(year + 1, 0, 31); // 31/01 năm sau
    } else if (periodType === 'MONTH' && month) {
      rulePeriodType = 'MONTH';
      // Khai tháng: Ngày thứ 20 của tháng tiếp theo
      // Tháng 1 -> 20/02, Tháng 12 -> 20/01 năm sau
      if (month === 12) {
        baseDate = new Date(year + 1, 0, 20); // 20/01 năm sau
      } else {
        baseDate = new Date(year, month, 20); // Month is already +1 in 0-indexed terms
      }
    }

    // Nếu không xác định được baseDate
    if (!baseDate) {
      return {
        baseFilingDeadline: null,
        basePaymentDeadline: null,
        effectiveFilingDeadline: null,
        effectivePaymentDeadline: null,
        ruleId: null,
        legalBasis: [],
        extensionApplied: false,
        confidence: 'UNKNOWN',
        notes: ['Không đủ thông tin kỳ tính thuế để xác định thời hạn nộp'],
        isAdjustedForHoliday: false
      };
    }

    // 2. Tra cứu căn cứ pháp lý versioned tại thời điểm deadline
    const matchedRule = LegalRuleRegistry.resolveRule(rulePeriodType, taxType, baseDate);
    const legalBasis: LegalDocumentRef[] = matchedRule ? matchedRule.legalBasis : [];

    // 3. Tính toán điều chỉnh ngày nghỉ / ngày lễ theo Luật Quản lý thuế
    const holidayCheck = BusinessDayCalendar.adjustToNextBusinessDay(baseDate);
    const effectiveDate = holidayCheck.effectiveDate;

    // 4. Kiểm tra khả năng gia hạn theo chính sách từng năm (ví dụ NĐ 245/2026/NĐ-CP hoặc NĐ 64/2024/NĐ-CP)
    const extensionCheck = this.checkExtensionPossibility(taxType, year, month, quarter, isFinalization);

    const notes: string[] = [];
    if (holidayCheck.wasAdjusted && holidayCheck.adjustmentReason) {
      notes.push(holidayCheck.adjustmentReason);
    }
    if (extensionCheck.hasPossibleExtension) {
      notes.push(extensionCheck.reason);
    }
    const holidayCalendarCovered = BusinessDayCalendar.hasHolidayCoverage(baseDate.getFullYear());
    if (!holidayCalendarCovered) {
      notes.push(`Lịch nghỉ lễ năm ${baseDate.getFullYear()} chưa được cấu hình đầy đủ; chỉ điều chỉnh Thứ Bảy/Chủ Nhật.`);
    }

    return {
      baseFilingDeadline: this.formatDateVn(baseDate),
      basePaymentDeadline: this.formatDateVn(baseDate),
      effectiveFilingDeadline: this.formatDateVn(effectiveDate),
      effectivePaymentDeadline: this.formatDateVn(effectiveDate),
      ruleId: matchedRule ? matchedRule.id : null,
      legalBasis,
      extensionApplied: false, // Chưa tự ý khẳng định gia hạn nếu chưa có xác nhận điều kiện
      extensionReason: extensionCheck.hasPossibleExtension ? extensionCheck.reason : undefined,
      confidence: extensionCheck.hasPossibleExtension || !holidayCalendarCovered ? 'NEEDS_REVIEW' : 'CONFIRMED',
      notes: notes.length > 0 ? notes : undefined,
      isAdjustedForHoliday: holidayCheck.wasAdjusted,
      originalDateBeforeHoliday: holidayCheck.wasAdjusted ? this.formatDateVn(baseDate) : undefined
    };
  }

  /**
   * Kiểm tra khả năng thuộc diện gia hạn nộp thuế (Nghị định 245/2026 / NĐ 64/2024...)
   * Không tự động kết luận "Đã gia hạn" nếu chưa rà soát điều kiện ngành nghề / quy mô doanh nghiệp
   */
  private static checkExtensionPossibility(
    taxType: string,
    year: number,
    month?: number,
    quarter?: number,
    isFinalization?: boolean
  ): { hasPossibleExtension: boolean; reason: string } {
    if (year === 2026 && (taxType === 'VAT' || taxType === 'CIT' || taxType === 'PIT')) {
      if (taxType === 'VAT' && month && month >= 3 && month <= 8) {
        return {
          hasPossibleExtension: true,
          reason: 'Có thể thuộc diện gia hạn theo Nghị định 245/2026/NĐ-CP (Cần kiểm tra điều kiện ngành nghề & đối tượng áp dụng)'
        };
      }
      if (taxType === 'CIT' && (quarter === 1 || quarter === 2)) {
        return {
          hasPossibleExtension: true,
          reason: 'Có thể thuộc diện gia hạn thuế TNDN tạm nộp theo Nghị định 245/2026/NĐ-CP (Cần kiểm tra điều kiện)'
        };
      }
    }

    return { hasPossibleExtension: false, reason: '' };
  }

  private static formatDateVn(d: Date): string {
    const day = String(d.getDate()).padStart(2, '0');
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const y = d.getFullYear();
    return `${day}/${m}/${y}`;
  }
}

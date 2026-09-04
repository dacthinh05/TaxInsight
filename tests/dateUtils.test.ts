import { describe, expect, it } from 'vitest';
import {
  checkMissingPeriods,
  compareFilings,
  getFilingDisplayName,
  generateMonthRanges,
  generateQuarterRanges,
  generateYearRange,
  normalizeSearchText,
  parseFilingPeriod
} from '../src/shared/dateUtils';
import { TaxFiling } from '../src/shared/types';

describe('Date Utilities & Adaptive Range Generator', () => {
  it('should generate Level 1 Year Range (01/01/YYYY -> 31/12/YYYY)', () => {
    const yearRange = generateYearRange(2026);
    expect(yearRange.fromDate).toBe('01/01/2026');
    expect(yearRange.toDate).toBe('31/12/2026');
    expect(yearRange.level).toBe('YEAR');
  });

  it('should generate Level 2 Quarter Ranges (4 Quarters)', () => {
    const quarters = generateQuarterRanges(2026);
    expect(quarters).toHaveLength(4);
    expect(quarters[0]).toEqual({ fromDate: '01/01/2026', toDate: '31/03/2026', label: 'Quý 1/2026', level: 'QUARTER' });
    expect(quarters[1]).toEqual({ fromDate: '01/04/2026', toDate: '30/06/2026', label: 'Quý 2/2026', level: 'QUARTER' });
    expect(quarters[2]).toEqual({ fromDate: '01/07/2026', toDate: '30/09/2026', label: 'Quý 3/2026', level: 'QUARTER' });
    expect(quarters[3]).toEqual({ fromDate: '01/10/2026', toDate: '31/12/2026', label: 'Quý 4/2026', level: 'QUARTER' });
  });

  it('should generate Level 3 Month Ranges (12 Months)', () => {
    const months = generateMonthRanges(2026);
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ fromDate: '01/01/2026', toDate: '31/01/2026', label: 'Tháng 01/2026', level: 'MONTH' });
    expect(months[1]).toEqual({ fromDate: '01/02/2026', toDate: '28/02/2026', label: 'Tháng 02/2026', level: 'MONTH' });
    expect(months[11]).toEqual({ fromDate: '01/12/2026', toDate: '31/12/2026', label: 'Tháng 12/2026', level: 'MONTH' });
  });

  describe('parseFilingPeriod', () => {
    it('should correctly parse monthly periods', () => {
      const p1 = parseFilingPeriod('Kỳ tính thuế: Tháng 03/2026');
      expect(p1).toEqual({ raw: 'Tháng 03/2026', type: 'MONTH', month: 3, year: 2026 });

      const p2 = parseFilingPeriod('T01/2026 Khai GTGT');
      expect(p2).toEqual({ raw: 'Tháng 01/2026', type: 'MONTH', month: 1, year: 2026 });
    });

    it('should correctly parse quarterly periods', () => {
      const q1 = parseFilingPeriod('Tờ khai GTGT Quý 1/2026');
      expect(q1).toEqual({ raw: 'Quý 1/2026', type: 'QUARTER', quarter: 1, year: 2026 });

      const q2 = parseFilingPeriod('Tờ khai thuế Quý III/2026');
      expect(q2).toEqual({ raw: 'Quý 3/2026', type: 'QUARTER', quarter: 3, year: 2026 });
    });

    it('should correctly parse compact period formats (YYYYMM, YYYYQ)', () => {
      const p1 = parseFilingPeriod('202601');
      expect(p1).toEqual({ raw: 'Tháng 01/2026', type: 'MONTH', month: 1, year: 2026 });

      const p2 = parseFilingPeriod('202612');
      expect(p2).toEqual({ raw: 'Tháng 12/2026', type: 'MONTH', month: 12, year: 2026 });

      const p3 = parseFilingPeriod('2026Q1');
      expect(p3).toEqual({ raw: 'Quý 1/2026', type: 'QUARTER', quarter: 1, year: 2026 });

      const p4 = parseFilingPeriod('2026-Q4');
      expect(p4).toEqual({ raw: 'Quý 4/2026', type: 'QUARTER', quarter: 4, year: 2026 });
    });

    it('should correctly parse date range into Quarter or Month', () => {
      const q1 = parseFilingPeriod('01/01/2026 - 31/03/2026');
      expect(q1).toEqual({ raw: 'Quý 1/2026', type: 'QUARTER', quarter: 1, year: 2026 });

      const q2 = parseFilingPeriod('01/04/2026 → 30/06/2026');
      expect(q2).toEqual({ raw: 'Quý 2/2026', type: 'QUARTER', quarter: 2, year: 2026 });
    });

    it('should return undefined when no period exists (never fake or default to Kỳ trong năm)', () => {
      expect(parseFilingPeriod('Đăng ký thuế lần đầu cho người phụ thuộc')).toBeUndefined();
      expect(parseFilingPeriod('—')).toBeUndefined();
      expect(parseFilingPeriod('')).toBeUndefined();
      expect(parseFilingPeriod('Kỳ trong năm')).toBeUndefined();
    });
  });

  describe('normalizeSearchText', () => {
    it('should normalize Vietnamese diacritics and case safely', () => {
      expect(normalizeSearchText('GTGT Khấu trừ')).toBe('gtgt khau tru');
      expect(normalizeSearchText('Tờ khai thuế TNCN 01/2026')).toBe('to khai thue tncn 01/2026');
      expect(normalizeSearchText('Đăng ký lần đầu')).toBe('dang ky lan dau');
      expect(normalizeSearchText(null)).toBe('');
      expect(normalizeSearchText(undefined)).toBe('');
    });
  });

  describe('compareFilings (Multi-level Stable Sort)', () => {
    it('should sort same tax category and procedure by latest period first, with revisions grouped together', () => {

      const list: TaxFiling[] = [
        {
          id: '1',
          title: 'Khai thuế GTGT khấu trừ',
          taxType: 'VAT',
          procedureCode: '1.007014',
          periodNormalized: { raw: 'Tháng 05/2026', type: 'MONTH', month: 5, year: 2026 },
          filingType: 'ORIGINAL',
          downloadAvailable: true
        },
        {
          id: '2',
          title: 'Khai thuế TNCN',
          taxType: 'PIT',
          procedureCode: '1.008347',
          periodNormalized: { raw: 'Quý 1/2026', type: 'QUARTER', quarter: 1, year: 2026 },
          filingType: 'ORIGINAL',
          downloadAvailable: true
        },
        {
          id: '3',
          title: 'Khai thuế GTGT khấu trừ',
          taxType: 'VAT',
          procedureCode: '1.007014',
          periodNormalized: { raw: 'Tháng 07/2026', type: 'MONTH', month: 7, year: 2026 },
          filingType: 'ORIGINAL',
          downloadAvailable: true
        },
        {
          id: '4',
          title: 'Khai thuế GTGT khấu trừ',
          taxType: 'VAT',
          procedureCode: '1.007014',
          periodNormalized: { raw: 'Tháng 06/2026', type: 'MONTH', month: 6, year: 2026 },
          filingType: 'SUPPLEMENTAL',
          supplementalNo: 2,
          downloadAvailable: true
        },
        {
          id: '5',
          title: 'Khai thuế GTGT khấu trừ',
          taxType: 'VAT',
          procedureCode: '1.007014',
          periodNormalized: { raw: 'Tháng 06/2026', type: 'MONTH', month: 6, year: 2026 },
          filingType: 'ORIGINAL',
          downloadAvailable: true
        },
        {
          id: '6',
          title: 'Khai thuế GTGT khấu trừ',
          taxType: 'VAT',
          procedureCode: '1.007014',
          periodNormalized: { raw: 'Tháng 06/2026', type: 'MONTH', month: 6, year: 2026 },
          filingType: 'SUPPLEMENTAL',
          supplementalNo: 1,
          downloadAvailable: true
        }
      ];

      const sorted = [...list].sort(compareFilings);

      // VAT should come before PIT
      // Within VAT 1.007014: Month 7 -> Month 6 (Original -> BS 1 -> BS 2) -> Month 5
      expect(sorted[0].id).toBe('3'); // T07/2026
      expect(sorted[1].id).toBe('5'); // T06/2026 Original
      expect(sorted[2].id).toBe('6'); // T06/2026 BS 1
      expect(sorted[3].id).toBe('4'); // T06/2026 BS 2
      expect(sorted[4].id).toBe('1'); // T05/2026
      expect(sorted[5].id).toBe('2'); // PIT Q1/2026
    });
  });

  describe('checkMissingPeriods', () => {
    it('should identify missing months for monthly filers', () => {
      const mockFilings: TaxFiling[] = [
        {
          id: '1',
          title: '01/GTGT',
          taxType: 'VAT',
          periodNormalized: { type: 'MONTH', month: 1, year: 2025 },
          filingType: 'ORIGINAL',
          downloadAvailable: true
        },
        {
          id: '2',
          title: '01/GTGT',
          taxType: 'VAT',
          periodNormalized: { type: 'MONTH', month: 2, year: 2025 },
          filingType: 'ORIGINAL',
          downloadAvailable: true
        }
      ];

      const res = checkMissingPeriods(mockFilings, 2025, 'VAT');
      expect(res.periodType).toBe('MONTH');
      expect(res.foundPeriods).toEqual(['Tháng 01/2025', 'Tháng 02/2025']);
      expect(res.missingPeriods).toHaveLength(10);
      expect(res.missingPeriods).toContain('Tháng 03/2025');
    });
  });

  describe('Accounting Sort Pipeline', () => {
    it('should sort TaxType -> Period DESC -> Nature (Refund/Original before Supplemental) -> Revision ASC -> Date DESC', () => {
      const items: TaxFiling[] = [
        { id: '1', taxType: 'VAT', period: 'Tháng 08/2025', filingType: 'SUPPLEMENTAL', supplementalNo: 2, submittedAt: '25/11/2025', title: 'Khai bổ sung', downloadAvailable: true },
        { id: '2', taxType: 'VAT', period: 'Tháng 11/2025', filingType: 'ORIGINAL', submittedAt: '19/12/2025', title: 'Khai thuế GTGT', downloadAvailable: true },
        { id: '3', taxType: 'VAT', period: 'Tháng 08/2025', filingType: 'REFUND', submittedAt: '10/11/2025', title: 'Hoàn thuế GTGT', downloadAvailable: true },
        { id: '4', taxType: 'VAT', period: 'Tháng 08/2025', filingType: 'SUPPLEMENTAL', supplementalNo: 1, submittedAt: '19/11/2025', title: 'Khai bổ sung', downloadAvailable: true },
        { id: '5', taxType: 'VAT', period: 'Tháng 10/2025', filingType: 'ORIGINAL', submittedAt: '20/11/2025', title: 'Khai thuế GTGT', downloadAvailable: true },
        { id: '6', taxType: 'VAT', period: 'Tháng 07/2025', filingType: 'SUPPLEMENTAL', supplementalNo: 1, submittedAt: '19/11/2025', title: 'Khai bổ sung', downloadAvailable: true },
        { id: '7', taxType: 'PIT', period: 'Tháng 11/2025', filingType: 'ORIGINAL', submittedAt: '20/12/2025', title: 'Khai thuế TNCN', downloadAvailable: true },
        { id: '8', taxType: 'OTHER', period: undefined, filingType: 'PERIODIC', submittedAt: '26/02/2026', title: 'Đăng ký người phụ thuộc', downloadAvailable: true }
      ];

      const sorted = [...items].sort(compareFilings);
      const sortedIds = sorted.map(s => s.id);

      // Kỳ 11/2025 GTGT -> 10/2025 GTGT -> 08/2025 Hoàn thuế -> 08/2025 Bổ sung L1 -> 08/2025 Bổ sung L2 -> 07/2025 GTGT -> TNCN -> OTHER
      expect(sortedIds).toEqual(['2', '5', '3', '4', '1', '6', '7', '8']);
    });
  });

  describe('getFilingDisplayName: Phân biệt chính xác Khấu trừ vs Quyết toán TNCN', () => {
    it('định danh đúng tờ khai khấu trừ TNCN (05/KK-TNCN, thủ tục 1.008347), không nhầm thành quyết toán', () => {
      const kkFiling: TaxFiling = {
        id: 'KK_001',
        procedureCode: '1.008347',
        declarationCode: '05/KK-TNCN',
        title: '1.008347 - Khai thuế thu nhập cá nhân',
        taxType: 'PIT',
        period: 'Quý 1/2026',
        filingType: 'ORIGINAL',
        downloadAvailable: true
      };
      const formatted = getFilingDisplayName(kkFiling);
      expect(formatted.primaryTitle).toBe('Khai thuế TNCN');
      expect(formatted.primaryTitle).not.toBe('Quyết toán thuế TNCN');
      expect(formatted.detailText).toBe('Mẫu 05/KK-TNCN');
    });

    it('định danh đúng tờ khai quyết toán TNCN (05/QTT-TNCN, thủ tục 1.008309)', () => {
      const qttFiling: TaxFiling = {
        id: 'QTT_001',
        procedureCode: '1.008309',
        declarationCode: '05/QTT-TNCN',
        title: '1.008309 - Quyết toán thuế thu nhập cá nhân',
        taxType: 'PIT',
        period: 'Năm 2025',
        filingType: 'FINALIZATION',
        downloadAvailable: true
      };
      const formatted = getFilingDisplayName(qttFiling);
      expect(formatted.primaryTitle).toBe('Quyết toán thuế TNCN');
      expect(formatted.detailText).toBe('Mẫu 05/QTT-TNCN');
    });
  });
});

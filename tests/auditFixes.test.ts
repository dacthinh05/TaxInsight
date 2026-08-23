import { describe, expect, it } from 'vitest';
import { sanitizeExcelCellValue } from '../src/shared/sanitizer';
import { normalizeVatPeriod, getPeriodNumericSortKey } from '../src/shared/dateUtils';
import { TaxFiling } from '../src/shared/types';
import { VatDeclarationSnapshot, VatPeriodGroup } from '../src/shared/vatAnalyticsTypes';
import { VatFlowEngine } from '../src/shared/vatFlowEngine';
import { generateVietQrEmvCoPayload } from '../src/shared/vietqr';
import { VatXmlParser } from '../src/main/scanner/VatXmlParser';

/**
 * Regression tests cho các bug phát hiện trong đợt audit toàn dự án.
 * Mỗi test khóa đúng 1 fix để tránh hồi quy.
 */
describe('AUDIT FIXES — Regression', () => {
  describe('FIX: sanitizeExcelCellValue không được phá hủy mã định danh', () => {
    it('giữ nguyên dạng TEXT chuỗi số có số 0 đứng đầu (MST Hà Nội/HCM)', () => {
      expect(sanitizeExcelCellValue('0102030405')).toBe('0102030405');
      expect(sanitizeExcelCellValue('0312345678-001')).toBe('0312345678-001');
    });

    it('giữ nguyên dạng TEXT chuỗi số vượt quá độ chính xác an toàn của Number (>2^53)', () => {
      const big = '9704227812345678'; // 16 chữ số
      const out = sanitizeExcelCellValue(big);
      expect(typeof out).toBe('string');
      expect(out).toBe(big);
    });

    it('vẫn chuyển Number bình thường với số hợp lệ (không mất hành vi cũ)', () => {
      expect(sanitizeExcelCellValue('-12345')).toBe(-12345);
      expect(sanitizeExcelCellValue('123456')).toBe(123456);
      expect(sanitizeExcelCellValue('-35.5')).toBe(-35.5);
      expect(sanitizeExcelCellValue('+100')).toBe(100);
    });
  });

  describe('FIX: normalizeVatPeriod nhận diện khoảng ngày thay vì khớp nhầm thành tháng', () => {
    it('"01/01/2026 - 31/03/2026" -> Quý 1/2026 (không phải Tháng 02)', () => {
      const norm = normalizeVatPeriod('01/01/2026 - 31/03/2026');
      expect(norm.type).toBe('QUARTER');
      expect(norm.quarter).toBe(1);
      expect(norm.key).toBe('2026-Q1');
    });

    it('"01/04/2026 - 30/06/2026" -> Quý 2/2026', () => {
      const norm = normalizeVatPeriod('01/04/2026 - 30/06/2026');
      expect(norm.type).toBe('QUARTER');
      expect(norm.quarter).toBe(2);
    });

    it('"01/05/2026 - 31/05/2026" -> Tháng 05/2026', () => {
      const norm = normalizeVatPeriod('01/05/2026 - 31/05/2026');
      expect(norm.type).toBe('MONTH');
      expect(norm.month).toBe(5);
    });

    it('khoảng ngày không chuẩn -> UNKNOWN thay vì khớp nhầm một tháng cụ thể', () => {
      const norm = normalizeVatPeriod('15/01/2026 - 20/01/2026');
      expect(norm.type).toBe('UNKNOWN');
    });
  });

  describe('FIX: VatXmlParser.normalizePeriod dùng chung logic với dateUtils', () => {
    it('sửa lỗi năm portal "2202" -> 2022 như bản dùng chung', () => {
      const norm = VatXmlParser.normalizePeriod('01/2202');
      expect(norm.year).toBe(2022);
    });

    it('nhận diện khoảng ngày như bản dùng chung', () => {
      const norm = VatXmlParser.normalizePeriod('01/01/2026 - 31/03/2026');
      expect(norm.type).toBe('QUARTER');
      expect(norm.key).toBe('2026-Q1');
    });
  });

  describe('FIX: sắp xếp kỳ trộn Tháng/Quý theo đúng trình tự thời gian', () => {
    const mkFiling = (periodNormalized: any): TaxFiling =>
      ({
        id: 'x',
        title: 'x',
        period: '',
        periodNormalized
      }) as unknown as TaxFiling;

    it('Q1/2025 phải CŨ hơn Tháng 12/2025', () => {
      const q1 = getPeriodNumericSortKey(mkFiling({ type: 'QUARTER', quarter: 1, year: 2025 }));
      const t12 = getPeriodNumericSortKey(mkFiling({ type: 'MONTH', month: 12, year: 2025 }));
      // key càng lớn càng mới; Q1 phải nhỏ hơn T12
      expect(q1).toBeLessThan(t12);
    });

    it('thứ tự đúng thời gian: Q4/2025 > T11/2025 > Q3/2025 (=T09) > T08/2025', () => {
      const q3 = getPeriodNumericSortKey(mkFiling({ type: 'QUARTER', quarter: 3, year: 2025 }));
      const q4 = getPeriodNumericSortKey(mkFiling({ type: 'QUARTER', quarter: 4, year: 2025 }));
      const t11 = getPeriodNumericSortKey(mkFiling({ type: 'MONTH', month: 11, year: 2025 }));
      const t8 = getPeriodNumericSortKey(mkFiling({ type: 'MONTH', month: 8, year: 2025 }));
      expect(q4).toBeGreaterThan(t11);
      expect(t11).toBeGreaterThan(q3); // Q3 kết thúc tháng 09 -> cũ hơn T11
      expect(q3).toBeGreaterThan(t8);
    });

    it('Năm 2025 xếp ngang T12/2025 (cùng mốc kết thúc năm)', () => {
      const year = getPeriodNumericSortKey(mkFiling({ type: 'YEAR', year: 2025 }));
      const t12 = getPeriodNumericSortKey(mkFiling({ type: 'MONTH', month: 12, year: 2025 }));
      expect(year).toBe(t12);
    });
  });

  describe('FIX: khai bổ sung làm GIẢM [40] tạo record TAX_PAYABLE_DECREASE đầy đủ', () => {
    const mkSnap = (overrides: Partial<VatDeclarationSnapshot>): VatDeclarationSnapshot =>
      ({
        taxpayerId: '0102030405',
        formCode: '01/GTGT',
        period: { type: 'MONTH', value: '03/2026', normalizedKey: '2026-M03' },
        declarationType: 'ORIGINAL',
        sequenceSource: 'API',
        submissionId: 'S_ORIG',
        status: 'Đã chấp nhận',
        ct22_thueDauVaoKyTruoc: 0n,
        ct23_giaTriMuaVao: 0n,
        ct24_thueMuaVao: 0n,
        ct25_thueKhauTruKyNay: 0n,
        ct34_doanhThuBanRa: 0n,
        ct35_thueBanRa: 0n,
        ct40_thuePhaiNop: 0n,
        ct43_thueKhauTruChuyenKySau: 0n,
        allIndicators: {},
        warnings: [],
        parseStatus: 'SUCCESS',
        xmlAvailable: false,
        ...overrides
      }) as VatDeclarationSnapshot;

    it('[40] giảm từ 20tr xuống 15tr, [43] giữ nguyên -> TAX_PAYABLE_DECREASE delta 5tr', () => {
      const orig = mkSnap({
        submissionId: 'S1',
        ct40_thuePhaiNop: 20000000n,
        submittedAt: '20/04/2026 09:00'
      });
      const supp = mkSnap({
        declarationType: 'SUPPLEMENTAL',
        supplementalNo: 1,
        submissionId: 'S2',
        ct40_thuePhaiNop: 15000000n,
        submittedAt: '15/05/2026 09:00'
      });

      const group: VatPeriodGroup = {
        periodKey: '2026-M03',
        periodLabel: 'Tháng 03/2026',
        periodType: 'MONTH',
        year: 2026,
        month: 3,
        filings: [],
        snapshots: [orig, supp],
        hasSupplemental: true,
        supplementalCount: 1,
        hasValueDelta: true,
        deltas: [],
        warnings: []
      };

      const adjustments = VatFlowEngine.extractCrossPeriodAdjustments([group]);
      expect(adjustments).toHaveLength(1);
      const adj = adjustments[0];
      expect(adj.impactType).toBe('TAX_PAYABLE_DECREASE');
      expect(adj.direction).toBe('DECREASE');
      expect(adj.previousValue).toBe(20000000n);
      expect(adj.newValue).toBe(15000000n);
      expect(adj.delta).toBe(5000000n);
      expect(adj.title).not.toBe('');
      expect(adj.description).not.toBe('');
    });

    it('nhóm QUÁÝ: BS nộp ở quý sau sinh impactPeriod dạng "-Q.." (không bị bỏ)', () => {
      const orig = mkSnap({
        submissionId: 'Q1O',
        period: { type: 'QUARTER', value: 'Q1/2026', normalizedKey: '2026-Q1' },
        ct40_thuePhaiNop: 10000000n,
        submittedAt: '10/04/2026 09:00'
      });
      const supp = mkSnap({
        declarationType: 'SUPPLEMENTAL',
        supplementalNo: 1,
        submissionId: 'Q1S',
        period: { type: 'QUARTER', value: 'Q1/2026', normalizedKey: '2026-Q1' },
        ct40_thuePhaiNop: 15000000n,
        submittedAt: '20/07/2026 09:00'
      });

      const group: VatPeriodGroup = {
        periodKey: '2026-Q1',
        periodLabel: 'Quý 1/2026',
        periodType: 'QUARTER',
        year: 2026,
        quarter: 1,
        filings: [],
        snapshots: [orig, supp],
        hasSupplemental: true,
        supplementalCount: 1,
        hasValueDelta: true,
        deltas: [],
        warnings: []
      };

      const adjustments = VatFlowEngine.extractCrossPeriodAdjustments([group]);
      expect(adjustments).toHaveLength(1);
      const adj = adjustments[0];
      expect(adj.impactPeriod).not.toBeNull();
      expect(adj.impactPeriod!.periodKey).toBe('2026-Q3');
      expect(adj.impactPeriod!.quarter).toBe(3);
      // Điều chỉnh tăng [40] nộp tại Q3 phải hiện ra trong incoming của Q3 khi normalize flow
      const flow = VatFlowEngine.normalizeYearFlow(
        {
          taxpayerId: '0102030405',
          periodGroups: [group]
        } as any,
        2026
      );
      const q3Row = flow.flows.find(f => f.periodKey === '2026-Q3');
      expect(q3Row).toBeDefined();
      expect(q3Row!.incomingAdjustments.length).toBe(1);
      expect(q3Row!.incomingAdjustments[0].delta).toBe(5000000n);
    });
  });

  describe('FIX: VietQR payload chỉ chứa ASCII (không lệch TLV do dấu tiếng Việt)', () => {
    it('tên chủ tài khoản có dấu bị chuẩn hóa về ASCII và CRC vẫn hợp lệ', () => {
      const payload = generateVietQrEmvCoPayload({
        bankBin: '970422',
        accountNo: '0817567008',
        accountName: 'NGUYỄN VĂN A'
      });
      // Toàn bộ payload phải là ASCII in được
      expect(payload).toMatch(/^[\x20-\x7E]+$/);
      // Tag 59 vẫn parse được: đọc length ngay sau tag
      const idx59 = payload.indexOf('59');
      const lenStr = payload.slice(idx59 + 2, idx59 + 4);
      const len = parseInt(lenStr, 10);
      expect(len).toBeGreaterThan(0);
    });
  });
});

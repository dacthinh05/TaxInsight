import { describe, it, expect } from 'vitest';
import {
  normalizePaymentState,
  isPaidSuccessSlip,
  getSlipStatusView,
  formatKyThueShort,
  formatDateShort,
  getSlipReconTooltip,
  buildSlipReconciliationIndex,
  filterPaymentSlips,
  SlipReconInfo
} from '../src/shared/paymentSlipAudit';
import { PaymentSlipRecord } from '../src/shared/types';
import { TaxObligation } from '../src/shared/obligationTypes';

describe('paymentSlipAudit', () => {
  describe('normalizePaymentState and isPaidSuccessSlip', () => {
    it('normalizes various state strings correctly', () => {
      expect(normalizePaymentState('')).toBe('UNKNOWN');
      expect(normalizePaymentState(null)).toBe('UNKNOWN');
      expect(normalizePaymentState('Nộp thuế thành công')).toBe('PAID_SUCCESS');
      expect(normalizePaymentState('Đã nộp vào NSNN')).toBe('PAID_SUCCESS');
      expect(normalizePaymentState('Đã gửi thông báo')).toBe('SENT');
      expect(normalizePaymentState('Đã phát hành lệnh')).toBe('SENT');
      expect(normalizePaymentState('Đã lập GNT')).toBe('CREATED');
      expect(normalizePaymentState('Khởi tạo giao dịch')).toBe('CREATED');
      expect(normalizePaymentState('Đã tạo phiếu')).toBe('CREATED');
      expect(normalizePaymentState('Giao dịch không thành công')).toBe('FAILED');
      expect(normalizePaymentState('Thất bại khi trừ nợ')).toBe('FAILED');
      expect(normalizePaymentState('Chờ xử lý')).toBe('UNKNOWN');
    });

    it('identifies paid success slips', () => {
      expect(isPaidSuccessSlip({ trangThai: 'Nộp thành công' })).toBe(true);
      expect(isPaidSuccessSlip({ trangThai: 'Đã lập' })).toBe(false);
    });
  });

  describe('getSlipStatusView', () => {
    it('returns appropriate view properties for each state', () => {
      const success = getSlipStatusView({ trangThai: 'Thành công' });
      expect(success.state).toBe('PAID_SUCCESS');
      expect(success.label).toContain('Thành công');
      expect(success.badgeClass).toContain('emerald');

      const sent = getSlipStatusView({ trangThai: 'Đã gửi' });
      expect(sent.state).toBe('SENT');
      expect(sent.badgeClass).toContain('sky');

      const created = getSlipStatusView({ trangThai: 'Đã lập' });
      expect(created.state).toBe('CREATED');
      expect(created.badgeClass).toContain('amber');

      const failed = getSlipStatusView({ trangThai: 'Thất bại' });
      expect(failed.state).toBe('FAILED');
      expect(failed.badgeClass).toContain('red');

      const unknown = getSlipStatusView({ trangThai: 'Chờ duyệt' });
      expect(unknown.state).toBe('UNKNOWN');
      expect(unknown.badgeClass).toContain('slate');
    });
  });

  describe('formatKyThueShort and formatDateShort', () => {
    it('formats short periods correctly', () => {
      expect(formatKyThueShort('')).toBe('—');
      expect(formatKyThueShort('Q2/2026')).toBe('Q2/2026');
      expect(formatKyThueShort('2026')).toBe('2026');
      expect(formatKyThueShort('06/2026')).toBe('06/2026');
      expect(formatKyThueShort('01/07/2026-31/07/2026')).toBe('07/2026');
      expect(formatKyThueShort('01/01/2026-31/03/2026')).toBe('Q1/2026');
      expect(formatKyThueShort('01/04/2026-31/05/2026')).toBe('04–05/2026');
      expect(formatKyThueShort('01/12/2026-15/01/2027')).toBe('12/2026–01/2027');
    });

    it('formats short dates correctly', () => {
      expect(formatDateShort('')).toBe('—');
      expect(formatDateShort('17/01/2026 09:53:27')).toBe('17/01/26');
      expect(formatDateShort('5/9/2026')).toBe('05/09/26');
      expect(formatDateShort('invalid')).toBe('invalid');
    });
  });

  describe('getSlipReconTooltip', () => {
    it('generates accurate tooltips according to status', () => {
      const matched: SlipReconInfo = {
        status: 'MATCHED',
        slipAmount: 1000000n,
        allocatedAmount: 1000000n,
        obligations: [{
          id: 'ob_1',
          title: 'Thuế GTGT',
          periodLabel: 'Q1/2026',
          payableAmount: 1000000n,
          allocatedAmount: 1000000n,
          confidence: 'EXACT'
        }],
        duplicateWith: []
      };
      expect(getSlipReconTooltip(matched)).toContain('Đã quy về 1 nghĩa vụ');

      const partial: SlipReconInfo = {
        status: 'PARTIAL',
        slipAmount: 1000000n,
        allocatedAmount: 600000n,
        obligations: [],
        duplicateWith: []
      };
      expect(getSlipReconTooltip(partial)).toContain('Mới quy được 600.000/1.000.000 ₫');

      const duplicate: SlipReconInfo = {
        status: 'DUPLICATE_SUSPECT',
        slipAmount: 1000000n,
        allocatedAmount: 0n,
        obligations: [],
        duplicateWith: ['GNT_999']
      };
      expect(getSlipReconTooltip(duplicate)).toContain('Có 2 GNT cùng số tiền');

      const unmatched: SlipReconInfo = {
        status: 'UNMATCHED',
        slipAmount: 500000n,
        allocatedAmount: 0n,
        obligations: [],
        duplicateWith: []
      };
      expect(getSlipReconTooltip(unmatched)).toContain('Không tìm thấy nghĩa vụ thuế');

      const unknown: SlipReconInfo = {
        status: 'UNKNOWN',
        slipAmount: 0n,
        allocatedAmount: 0n,
        obligations: [],
        duplicateWith: [],
        reasonUnknown: 'Chưa đối chiếu'
      };
      expect(getSlipReconTooltip(unknown)).toBe('Chưa đối chiếu');
    });
  });

  describe('buildSlipReconciliationIndex', () => {
    const sampleSlip: PaymentSlipRecord = {
      id: 'slip_1',
      stt: 1,
      soGnt: 'GNT_001',
      ngayNopThue: '15/03/2026 10:00:00',
      soTien: 1000000,
      soTienFormatted: '1.000.000 ₫',
      loaiTien: 'VND',
      maGiaoDich: 'GD_001',
      soChungTu: 'CT_001',
      trangThai: 'Nộp thành công',
      tenNganHang: 'Vietcombank',
      soTaiKhoan: '1234567890',
      downloadAvailable: true,
      classification: {
        taxTypes: ['VAT'],
        periods: ['Q1/2026'],
        ndktCodes: ['1701']
      }
    };

    it('returns UNKNOWN with reasons when conditions are not met', () => {
      const resNotQueried = buildSlipReconciliationIndex([sampleSlip], [], 'NOT_QUERIED');
      expect(resNotQueried.get('slip_1')?.status).toBe('UNKNOWN');
      expect(resNotQueried.get('slip_1')?.reasonUnknown).toContain('Chưa tra cứu danh sách');

      const resFailed = buildSlipReconciliationIndex([sampleSlip], [], 'QUERY_FAILED');
      expect(resFailed.get('slip_1')?.status).toBe('UNKNOWN');

      const resNoObligations = buildSlipReconciliationIndex([sampleSlip], [], 'CONNECTED_WITH_DATA');
      expect(resNoObligations.get('slip_1')?.status).toBe('UNKNOWN');
      expect(resNoObligations.get('slip_1')?.reasonUnknown).toContain('Chưa có dữ liệu tờ khai');

      const zeroObligation = {
        id: 'ob_zero',
        title: 'Tờ khai 01/GTGT',
        amountPayable: 0n,
        matchedSlips: []
      } as unknown as TaxObligation;
      const resZero = buildSlipReconciliationIndex([sampleSlip], [zeroObligation], 'CONNECTED_WITH_DATA');
      expect(resZero.get('slip_1')?.status).toBe('UNKNOWN');
      expect(resZero.get('slip_1')?.reasonUnknown).toContain('không phát sinh số thuế phải nộp');
    });

    it('matches slips with obligations correctly', () => {
      const obligation = {
        id: 'ob_1',
        title: 'Thuế GTGT',
        periodLabel: 'Q1/2026',
        amountPayable: 1000000n,
        matchedSlips: [{
          paymentSlipId: 'slip_1',
          allocatedAmount: 1000000n,
          confidence: 'EXACT' as const
        }]
      } as unknown as TaxObligation;

      const index = buildSlipReconciliationIndex([sampleSlip], [obligation], 'CONNECTED_WITH_DATA');
      const info = index.get('slip_1');
      expect(info?.status).toBe('MATCHED');
      expect(info?.allocatedAmount).toBe(1000000n);
      expect(info?.obligations).toHaveLength(1);
    });

    it('sets PARTIAL status when allocatedAmount is positive but less than slipAmount', () => {
      const obligation = {
        id: 'ob_part',
        title: 'Thuế GTGT',
        amountPayable: 500000n,
        matchedSlips: [{
          paymentSlipId: 'slip_1',
          allocatedAmount: 400000n,
          confidence: 'HIGH' as const
        }]
      } as unknown as TaxObligation;

      const index = buildSlipReconciliationIndex([sampleSlip], [obligation], 'CONNECTED_WITH_DATA');
      const info = index.get('slip_1');
      expect(info?.status).toBe('PARTIAL');
      expect(info?.allocatedAmount).toBe(400000n);
    });

    it('identifies duplicate suspect slips when multiple unmatched slips share amount and period', () => {
      const slip2: PaymentSlipRecord = {
        ...sampleSlip,
        id: 'slip_2',
        soGnt: 'GNT_002'
      };

      const obligation = {
        id: 'ob_dummy',
        title: 'Thuế TNCN',
        periodLabel: '01/2026',
        amountPayable: 5000000n,
        matchedSlips: []
      } as unknown as TaxObligation;

      const index = buildSlipReconciliationIndex([sampleSlip, slip2], [obligation], 'CONNECTED_WITH_DATA');
      expect(index.get('slip_1')?.status).toBe('DUPLICATE_SUSPECT');
      expect(index.get('slip_1')?.duplicateWith).toEqual(['GNT_002']);
      expect(index.get('slip_2')?.status).toBe('DUPLICATE_SUSPECT');
      expect(index.get('slip_2')?.duplicateWith).toEqual(['GNT_001']);
    });
  });

  describe('filterPaymentSlips', () => {
    const sampleSlip: PaymentSlipRecord = {
      id: 'slip_1',
      stt: 1,
      soGnt: 'GNT_001',
      ngayNopThue: '15/03/2026 10:00:00',
      soTien: 1000000,
      soTienFormatted: '1.000.000 ₫',
      loaiTien: 'VND',
      maGiaoDich: 'GD_001',
      soChungTu: 'CT_001',
      trangThai: 'Nộp thành công',
      tenNganHang: 'Vietcombank',
      soTaiKhoan: '1234567890',
      downloadAvailable: true,
      classification: {
        taxTypes: ['VAT'],
        periods: ['Q1/2026'],
        ndktCodes: ['1701']
      }
    };

    const failedSlip: PaymentSlipRecord = {
      ...sampleSlip,
      id: 'slip_failed',
      trangThai: 'Thất bại'
    };

    it('filters out non-successful slips and matches search query', () => {
      const res = filterPaymentSlips([sampleSlip, failedSlip], 'vietcombank');
      expect(res).toHaveLength(1);
      expect(res[0].id).toBe('slip_1');

      const resNoMatch = filterPaymentSlips([sampleSlip], 'ACB');
      expect(resNoMatch).toHaveLength(0);

      const resEmpty = filterPaymentSlips([sampleSlip], '');
      expect(resEmpty).toHaveLength(1);

      const resClassNdkt = filterPaymentSlips([sampleSlip], '1701');
      expect(resClassNdkt).toHaveLength(1);

      const resClassPeriod = filterPaymentSlips([sampleSlip], 'Q1/2026');
      expect(resClassPeriod).toHaveLength(1);
    });
  });
});

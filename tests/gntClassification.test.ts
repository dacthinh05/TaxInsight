import { describe, expect, it } from 'vitest';
import { classifyPaymentSlip, enrichSlipWithClassification, SLIP_TAX_TYPE_LABELS } from '../src/shared/gntClassification';
import { PaymentSlipDetail, PaymentSlipRecord } from '../src/shared/types';

const mkDetail = (id: string, items: { ndkt?: string; kyThue?: string; desc?: string }[]): PaymentSlipDetail => ({
  id,
  soGnt: 'GNT' + id,
  hinhThucNopTien: 'CHUYEN_KHOAN',
  loaiTien: 'VND',
  nguoiNopThue: 'CTY TEST',
  maSoThue: '3700364103',
  loaiTaiKhoanThu: 'TK_THU_NSNN',
  items: items.map((it, i) => ({
    stt: i + 1,
    kyThueNgayQd: it.kyThue,
    noiDungKhoanNop: it.desc || 'Khoản nộp',
    soTienVND: '1,000,000',
    maNDKT: it.ndkt
  })),
  tongTienVND: (items.length * 1_000_000).toLocaleString('vi-VN'),
  signatures: []
});

const mkSlip = (id: string): PaymentSlipRecord => ({
  id,
  stt: 1,
  maGiaoDich: 'GD' + id,
  soGnt: 'GNT' + id,
  soTien: 1_000_000,
  soTienFormatted: '1,000,000',
  loaiTien: 'VND',
  trangThai: 'Nộp thuế thành công',
  ngayNopThue: '15/07/2026',
  downloadAvailable: false
});

describe('classifyPaymentSlip', () => {
  it('trả về null khi không có chi tiết C1-02', () => {
    expect(classifyPaymentSlip(undefined)).toBeNull();
    expect(classifyPaymentSlip(null)).toBeNull();
    expect(classifyPaymentSlip(mkDetail('x', []))).toBeNull();
  });

  it('phân loại theo mã tiểu mục NDKT chính xác', () => {
    const cls = classifyPaymentSlip(mkDetail('1', [
      { ndkt: '1701', kyThue: '01/07/2026-31/07/2026' },
      { ndkt: '1001', kyThue: '01/06/2026-30/06/2026' }
    ]))!;

    expect(cls.taxTypes.sort()).toEqual(['PIT', 'VAT']);
    expect(cls.ndktCodes.sort()).toEqual(['1001', '1701']);
    expect(cls.periods).toHaveLength(2);
  });

  it('fallback theo diễn giải khi thiếu mã NDKT', () => {
    const cls = classifyPaymentSlip(mkDetail('2', [
      { desc: 'Thuế giá trị gia tăng phải nộp', kyThue: 'Kỳ Q2/2026' }
    ]))!;
    expect(cls.taxTypes).toEqual(['VAT']);
  });

  it('mã lạ về OTHER nhưng vẫn giữ kỳ thuế & tiểu mục', () => {
    const cls = classifyPaymentSlip(mkDetail('3', [
      { ndkt: '9999', kyThue: '01/01/2026-31/01/2026', desc: 'Khoản thu khác' }
    ]))!;
    expect(cls.taxTypes).toEqual(['OTHER']);
    expect(cls.ndktCodes).toEqual(['9999']);
    expect(cls.periods).toEqual(['01/01/2026-31/01/2026']);
  });

  it('khử trùng lặp kỳ thuế và tiểu mục khi nhiều dòng cùng kỳ', () => {
    const cls = classifyPaymentSlip(mkDetail('4', [
      { ndkt: '1701', kyThue: '01/04/2026-30/04/2026' },
      { ndkt: '1701', kyThue: '01/04/2026-30/04/2026' },
      { ndkt: '1704', kyThue: '01/04/2026-30/04/2026' }
    ]))!;
    expect(cls.taxTypes).toEqual(['VAT']);
    expect(cls.ndktCodes.sort()).toEqual(['1701', '1704']);
    expect(cls.periods).toEqual(['01/04/2026-30/04/2026']);
  });

  it('nhãn tiếng Việt đầy đủ cho mọi sắc thuế', () => {
    expect(SLIP_TAX_TYPE_LABELS.HOUSE_LAND).toBe('Thuế Nhà đất');
    expect(SLIP_TAX_TYPE_LABELS.FCT).toBe('Thuế nhà thầu');
  });
});

describe('enrichSlipWithClassification', () => {
  it('gắn classification vào record từ detailMap', () => {
    const slip = mkSlip('9');
    const details = new Map([['9', mkDetail('9', [{ ndkt: '1052', kyThue: '2025-YEAR' }])]]);
    const enriched = enrichSlipWithClassification(slip, details);
    expect(enriched.classification?.taxTypes).toEqual(['CIT']);
    expect(enriched.classification?.periods).toEqual(['2025-YEAR']);
  });

  it('giữ nguyên record khi chưa có chi tiết', () => {
    const slip = mkSlip('10');
    expect(enrichSlipWithClassification(slip, new Map())).toBe(slip);
  });
});

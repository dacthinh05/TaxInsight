import { describe, expect, it } from 'vitest';
import { GntStatisticsEngine } from '../src/main/engine/GntStatisticsEngine';
import { PaymentSlipDetail, PaymentSlipRecord } from '../src/shared/types';

const mkSlip = (id: string, soTien: number, ngayNop?: string, trangThai = 'Nộp thuế thành công'): PaymentSlipRecord => ({
  id,
  stt: 1,
  maGiaoDich: 'GD' + id,
  soGnt: 'GNT' + id,
  soTien,
  soTienFormatted: soTien.toLocaleString('vi-VN'),
  loaiTien: 'VND',
  trangThai,
  ngayNopThue: ngayNop,
  downloadAvailable: false
});

const mkDetail = (id: string, items: { ndkt?: string; vnd: string; desc?: string }[], tong?: string): PaymentSlipDetail => ({
  id,
  soGnt: 'GNT' + id,
  hinhThucNopTien: 'CHUYEN_KHOAN',
  loaiTien: 'VND',
  nguoiNopThue: 'CTY TEST',
  maSoThue: '3700364103',
  loaiTaiKhoanThu: 'TK_THU_NSNN',
  items: items.map((it, i) => ({
    stt: i + 1,
    kyThueNgayQd: '00/12/2025',
    noiDungKhoanNop: it.desc || 'Khoản nộp',
    soTienVND: it.vnd,
    maNDKT: it.ndkt
  })),
  tongTienVND: tong || items.reduce((a, i) => a + Number(i.vnd.replace(/[^\d]/g, '')), 0).toLocaleString('vi-VN'),
  signatures: []
});

describe('GntStatisticsEngine', () => {
  it('phân rã đúng Tháng × Loại thuế từ chi tiết NDKT', () => {
    const slips = [mkSlip('1', 150_000_000, '15/01/2026')];
    const details = new Map([
      ['1', mkDetail('1', [
        { ndkt: '1701', vnd: '100,000,000' },
        { ndkt: '1001', vnd: '50,000,000' }
      ])]
    ]);
    const r = GntStatisticsEngine.build(slips, details);

    expect(r.paidCount).toBe(1);
    expect(r.monthKeys).toEqual(['01/2026']);
    expect(GntStatisticsEngine.amountOf(r, '01/2026', 'VAT')).toBe(100_000_000);
    expect(GntStatisticsEngine.amountOf(r, '01/2026', 'PIT')).toBe(50_000_000);
    expect(r.grandTotal).toBe(150_000_000);
  });

  it('bỏ qua GNT chưa nộp / thất bại và bảo toàn tổng tiền', () => {
    const slips = [
      mkSlip('1', 100_000, '10/02/2026'),
      mkSlip('2', 200_000), // không có ngày nộp
      mkSlip('3', 300_000, '05/02/2026', 'Xử lý không thành công')
    ];
    const details = new Map([['1', mkDetail('1', [{ ndkt: '1052', vnd: '100,000' }])]]);
    const r = GntStatisticsEngine.build(slips, details);

    expect(r.paidCount).toBe(1);
    expect(r.skippedUnpaidCount).toBe(2);
    expect(r.grandTotal).toBe(100_000);
    expect(GntStatisticsEngine.amountOf(r, '02/2026', 'CIT')).toBe(100_000);
  });

  it('không có chi tiết -> toàn bộ số tiền vào NO_DETAIL', () => {
    const slips = [mkSlip('9', 777_000, '20/03/2026')];
    const details = new Map<string, null>([['9', null]]);
    const r = GntStatisticsEngine.build(slips, details);

    expect(r.noDetailCount).toBe(1);
    expect(GntStatisticsEngine.amountOf(r, '03/2026', 'NO_DETAIL')).toBe(777_000);
    expect(r.activeBuckets).toEqual(['NO_DETAIL']);
  });

  it('NDKT lạ -> OTHER; chênh lệch chi tiết vs tổng -> bù vào NO_DETAIL', () => {
    const slips = [mkSlip('5', 1_000, '01/04/2026')];
    const details = new Map([
      ['5', mkDetail('5', [
        { ndkt: '9999', vnd: '600' },
        { ndkt: '1055', vnd: '300' }
      ], '1.000')]
    ]);
    const r = GntStatisticsEngine.build(slips, details);

    expect(GntStatisticsEngine.amountOf(r, '04/2026', 'OTHER')).toBe(600);
    expect(GntStatisticsEngine.amountOf(r, '04/2026', 'FCT')).toBe(300);
    expect(GntStatisticsEngine.amountOf(r, '04/2026', 'NO_DETAIL')).toBe(100);
    expect(r.grandTotal).toBe(1_000);
  });

  it('nhiều tháng sort tăng dần đúng', () => {
    const slips = [
      mkSlip('a', 1, '05/12/2025'),
      mkSlip('b', 2, '06/01/2026'),
      mkSlip('c', 3, '07/12/2024')
    ];
    const details = new Map();
    const r = GntStatisticsEngine.build(slips, details);
    expect(r.monthKeys).toEqual(['12/2024', '12/2025', '01/2026']);
    expect(r.grandTotal).toBe(6);
  });

  it('Thuế nhà đất (3802/3901 + diễn giải) vào bucket HOUSE_LAND riêng như GTGT', () => {
    const slips = [mkSlip('7', 5_500_000, '12/05/2026')];
    const details = new Map([
      ['7', mkDetail('7', [
        { ndkt: '3802', vnd: '2,000,000' },
        { ndkt: '3901', vnd: '1,500,000' },
        { ndkt: undefined, desc: 'Tiền thuê đất, thuê mặt nước', vnd: '2,000,000' }
      ])]
    ]);
    const r = GntStatisticsEngine.build(slips, details);

    expect(GntStatisticsEngine.amountOf(r, '05/2026', 'HOUSE_LAND')).toBe(5_500_000);
    expect(r.activeBuckets).toContain('HOUSE_LAND');
    expect(r.grandTotal).toBe(5_500_000);
  });

  it('chi tiết mismatch không được phân loại; toàn bộ tiền vào NO_DETAIL', () => {
    const slips = [mkSlip('mismatch', 1_000_000, '12/05/2026')];
    const detail = mkDetail('mismatch', [{ ndkt: '1701', vnd: '1,000,000' }]);
    detail.suspectedMismatch = true;
    detail.detailIntegrity = 'MISMATCH';

    const r = GntStatisticsEngine.build(slips, new Map([['mismatch', detail]]));
    expect(GntStatisticsEngine.amountOf(r, '05/2026', 'VAT')).toBe(0);
    expect(GntStatisticsEngine.amountOf(r, '05/2026', 'NO_DETAIL')).toBe(1_000_000);
    expect(r.noDetailCount).toBe(1);
  });
});

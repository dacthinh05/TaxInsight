import { describe, expect, it } from 'vitest';
import { classifyPaymentSlip, enrichSlipWithClassification, SLIP_TAX_TYPE_LABELS } from '../src/shared/gntClassification';
import { TaxNdktClassifier } from '../src/main/engine/TaxNdktClassifier';
import { filterPaymentSlips, isPaidSuccessSlip } from '../src/shared/paymentSlipAudit';
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

  it('mã lạ không tự gắn thành OTHER nhưng vẫn giữ kỳ thuế & tiểu mục', () => {
    const cls = classifyPaymentSlip(mkDetail('3', [
      { ndkt: '9999', kyThue: '01/01/2026-31/01/2026', desc: 'Khoản thu khác' }
    ]))!;
    expect(cls.taxTypes).toEqual([]);
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

describe('TaxNdktClassifier — bổ sung mã & fallback chương', () => {
  it('tiểu mục 1051 (TNDN SXKD) và 1002 (TNCN kinh doanh) được phân loại đúng', () => {
    expect(TaxNdktClassifier.classify('1051').taxType).toBe('CIT');
    expect(TaxNdktClassifier.classify('1002').taxType).toBe('PIT');
    expect(TaxNdktClassifier.classify('1051').confidence).toBe('EXACT_CODE');
  });

  it('fallback theo chương: 17xx -> VAT, 38xx/39xx -> Nhà đất, 28xx/74xx/75xx -> Lệ phí/Khác', () => {
    expect(TaxNdktClassifier.classify('1710')?.taxType).toBe('VAT');
    expect(TaxNdktClassifier.classify('1710')?.confidence).toBe('CHAPTER_MATCH');
    expect(TaxNdktClassifier.classify('3807')?.taxType).toBe('HOUSE_LAND');
    expect(TaxNdktClassifier.classify('3902')?.taxType).toBe('HOUSE_LAND');
    expect(TaxNdktClassifier.classify('2865')?.taxType).toBe('OTHER');
    expect(TaxNdktClassifier.classify('7501')?.taxType).toBe('OTHER');

    // Chương 10xx không đoán được PIT vs CIT -> phải UNKNOWN
    expect(TaxNdktClassifier.classify('1098', 'Khoản nộp lạ').taxType).toBe('UNKNOWN');
  });

  it('mã bẩn/không phải số không bị khớp chương', () => {
    expect(TaxNdktClassifier.classify('17A')?.taxType).toBe('UNKNOWN');
    expect(TaxNdktClassifier.classify('ab17')?.taxType).toBe('UNKNOWN');
  });

  it('diễn giải "Lệ phí môn bài" -> OTHER thay vì rơi UNKNOWN', () => {
    expect(TaxNdktClassifier.classify(null, 'Lệ phí môn bài cấp mới lần đầu')?.taxType).toBe('OTHER');
    expect(TaxNdktClassifier.classify(null, 'Lệ phí sử dụng cơ sở hạ tầng')?.taxType).toBe('OTHER');
  });
});

describe('lọc GNT theo trạng thái thanh toán', () => {
  it('chỉ giữ GNT Thành công, loại Đã lập/Đã gửi/Thất bại', () => {
    const success = mkSlip('success');
    const created = { ...mkSlip('created'), trangThai: 'Đã lập' };
    const sent = { ...mkSlip('sent'), trangThai: 'Đã gửi' };
    const failed = { ...mkSlip('failed'), trangThai: 'Nộp thuế không thành công' };

    expect([success, created, sent, failed].filter(isPaidSuccessSlip).map(s => s.id)).toEqual(['success']);
    expect(filterPaymentSlips([success, created, sent, failed], '').map(s => s.id)).toEqual(['success']);
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

/**
 * Test hồi quy cho các lỗi phát hiện trong audit toàn dự án (round 2):
 * - C8:  TỔNG TIỀN "0 đ" khi bảng chi tiết degenerate (0 dòng + #sum=0)
 * - C10: calculateCoverageSummary tính nhầm "không thành công" là thành công
 * - C11: classifyTaxType — 'vat' khớp nhầm 'vật' sau bỏ dấu
 * - C12: PitXmlParser.findTag — 'ct32' khớp nhầm <ct320>
 */
import { describe, expect, it } from 'vitest';
import { GntParser } from '../src/main/scanner/GntParser';
import { TaxFilingParser } from '../src/main/scanner/TaxFilingParser';
import { TaxPaymentMatcher } from '../src/main/engine/TaxPaymentMatcher';
import { PitXmlParser } from '../src/main/scanner/PitXmlParser';
import { PaymentSlipRecord, PaymentSlipDetail, TaxFiling } from '../src/shared/types';

// ── Fixture helpers (giữ format giống gntPhase3Fixes) ────────────────────────

function makeDetailHtml(rows: string, total: string): string {
  return `<div>
    <p>Người nộp thuế: <span style="text-transform:uppercase;">CÔNG TY TEST</span></p>
    <p>Mã số thuế: <span>3702735709</span></p>
    <table id="chungtu_ctiet"><tbody>
      ${rows}
      <tr><td colspan="4">Tổng tiền</td><td></td><td><span id="sum">${total}</span></td><td></td><td></td></tr>
    </tbody></table>
  </div>`;
}

function makeSlip(partial: Partial<PaymentSlipRecord>): PaymentSlipRecord {
  return {
    id: partial.id || 's1',
    soGnt: 'GNT001',
    maGiaoDich: '11220260357675749',
    soChungTu: '625256794',
    ngayNopThue: '17/01/2026',
    ngayGuiGnt: '17/01/2026',
    ngayLapGnt: '17/01/2026',
    trangThai: 'Nộp thuế thành công',
    soTien: 154446648,
    soTienFormatted: '154,446,648',
    loaiTien: 'VND',
    tenNganHang: 'BIDV',
    soTaiKhoan: '613704060119042',
    lanNop: '',
    ...partial
  } as PaymentSlipRecord;
}

function makeDetail(partial: Partial<PaymentSlipDetail>): PaymentSlipDetail {
  return {
    id: 's1',
    soGnt: 'GNT001',
    hinhThucNopTien: 'CHUYEN_KHOAN',
    loaiTien: 'VND',
    nguoiNopThue: 'CÔNG TY TEST',
    maSoThue: '3702735709',
    loaiTaiKhoanThu: 'TK_THU_NSNN',
    items: [],
    tongTienVND: '',
    signatures: [],
    ...partial
  };
}

// ── C8: TỔNG TIỀN degenerate ─────────────────────────────────────────────────

describe('C8: GntParser — tổng tiền degenerate phải là MISSING, không phải VALID 0', () => {
  it('0 dòng khoản nộp + #sum=0 → totalVndAmount.status = MISSING', () => {
    // Trang hỏng: bảng chi tiết không có dòng dữ liệu, #sum là placeholder "0"
    const html = makeDetailHtml('', '0');
    const r = GntParser.parseDetail(html, 'deg1');
    expect(r.allocations.length).toBe(0);
    expect(r.totalVndAmount.status).toBe('MISSING');
    expect(r.totalVndAmount.value).toBe(0n);
    // Integrity không được là VERIFIED khi không parse được gì
    expect(r.detailIntegrity).toBe('UNKNOWN');
  });

  it('0 dòng khoản nộp + #sum rỗng → MISSING', () => {
    const html = makeDetailHtml('', '');
    const r = GntParser.parseDetail(html, 'deg2');
    expect(r.totalVndAmount.status).toBe('MISSING');
  });

  it('CÓ dòng khoản nộp + #sum=0 → vẫn tự cộng các dòng (không hồi quy fix cũ)', () => {
    const html = makeDetailHtml(
      '<tr><td>1</td><td>TK001</td><td>00/12/2025</td><td>Thuế GTGT</td><td></td><td>154,446,648</td><td>557</td><td>1001</td></tr>',
      '0'
    );
    const r = GntParser.parseDetail(html, 'deg3');
    expect(r.allocations.length).toBe(1);
    expect(r.totalVndAmount.status).toBe('VALID');
    expect(r.totalVndAmount.value).toBe(154446648n);
  });

  it('Có dòng + tổng header khớp → VERIFIED (không hồi quy)', () => {
    const html = makeDetailHtml(
      '<tr><td>1</td><td>TK001</td><td>00/12/2025</td><td>Thuế GTGT</td><td></td><td>154,446,648</td><td>557</td><td>1001</td></tr>',
      '154,446,648'
    );
    const r = GntParser.parseDetail(html, 'deg4');
    expect(r.detailIntegrity).toBe('VERIFIED');
  });
});

// ── C10: matcher trạng thái ──────────────────────────────────────────────────

describe('C10: TaxPaymentMatcher.isPaidSuccessSlip — loại trừ trạng thái phủ định', () => {
  it('"Không thành công" KHÔNG được coi là thành công', () => {
    expect(TaxPaymentMatcher.isPaidSuccessSlip({ trangThai: 'Không thành công' })).toBe(false);
    expect(TaxPaymentMatcher.isPaidSuccessSlip({ trangThai: 'Nộp thuế không thành công' })).toBe(false);
  });
  it('"Thất bại" / "Hủy" không phải thành công', () => {
    expect(TaxPaymentMatcher.isPaidSuccessSlip({ trangThai: 'Thất bại' })).toBe(false);
    expect(TaxPaymentMatcher.isPaidSuccessSlip({ trangThai: 'Đã hủy' })).toBe(false);
  });
  it('"Nộp thuế thành công" / "Đã nộp" là thành công', () => {
    expect(TaxPaymentMatcher.isPaidSuccessSlip({ trangThai: 'Nộp thuế thành công' })).toBe(true);
    expect(TaxPaymentMatcher.isPaidSuccessSlip({ trangThai: 'Đã nộp qua ngân hàng' })).toBe(true);
  });
  it('Rỗng/undefined → false', () => {
    expect(TaxPaymentMatcher.isPaidSuccessSlip({ trangThai: '' })).toBe(false);
    expect(TaxPaymentMatcher.isPaidSuccessSlip({})).toBe(false);
  });

  it('calculateCoverageSummary: GNT thất bại không đội detailRequested/totalParsedAmount', () => {
    const slips = [
      makeSlip({ id: 'ok', trangThai: 'Nộp thuế thành công', soTien: 100000 }),
      makeSlip({ id: 'fail', trangThai: 'Không thành công', soTien: 200000 })
    ];
    const details = new Map<string, PaymentSlipDetail>([
      ['ok', makeDetail({ id: 'ok', items: [{ stt: 1, noiDungKhoanNop: 'Thuế GTGT', soTienVND: '100,000' }], tongTienVND: '100,000' })]
    ]);
    const summary = TaxPaymentMatcher.calculateCoverageSummary(slips, details);
    expect(summary.detailRequested).toBe(1); // 'fail' không được tính
    expect(summary.detailParsed).toBe(1);
    expect(summary.totalParsedAmount).toBe(100000n);
  });

  it('calculateCoverageSummary: tổng rỗng → tự cộng từ các dòng (không cộng 0)', () => {
    const slips = [makeSlip({ id: 'ok', soTien: 154446648 })];
    const details = new Map<string, PaymentSlipDetail>([
      ['ok', makeDetail({
        id: 'ok',
        items: [
          { stt: 1, noiDungKhoanNop: 'Thuế GTGT', soTienVND: '100,000,000' },
          { stt: 2, noiDungKhoanNop: 'Thuế TNCN', soTienVND: '54,446,648' }
        ],
        tongTienVND: '' // bảng degenerate — backend trả rỗng
      })]
    ]);
    const summary = TaxPaymentMatcher.calculateCoverageSummary(slips, details);
    expect(summary.totalParsedAmount).toBe(154446648n);
  });
});

// ── C11: classifyTaxType word boundary ───────────────────────────────────────

describe('C11: TaxFilingParser.classifyTaxType — từ "vật" không còn nhầm thành VAT', () => {
  const makeFiling = (title: string): TaxFiling =>
    ({ id: 'f1', title, filingType: 'PERIODIC', status: 'SUBMITTED' } as TaxFiling);

  it('"Mua vật tư, hàng hóa" KHÔNG bị classify thành VAT', () => {
    expect(TaxFilingParser.classifyTaxType(undefined, 'Báo cáo mua vật tư hàng hóa')).not.toBe('VAT');
  });
  it('"Nhân vật" / "đặc vật" không khớp VAT', () => {
    expect(TaxFilingParser.classifyTaxType(undefined, 'Danh mục nhân vật quản lý')).not.toBe('VAT');
  });
  it('"Thuế VAT" / "GTGT" vẫn là VAT', () => {
    expect(TaxFilingParser.classifyTaxType('1.007014', 'Khai thuế GTGT')).toBe('VAT');
    expect(TaxFilingParser.classifyTaxType(undefined, 'Thuế VAT kỳ 01/2026')).toBe('VAT');
    expect(TaxFilingParser.classifyTaxType(undefined, 'Tờ khai VAT')).toBe('VAT');
  });
});

// ── C12: PitXmlParser tag boundary ───────────────────────────────────────────

describe('C12: PitXmlParser.findTag — boundary chặt giữa các tag số gần nhau', () => {
  it('query ct32 KHÔNG khớp nhầm <ct320>', () => {
    const xml = '<ct320>999000</ct320>';
    // findTag private → kiểm tra gián tiếp qua parsePitXml là nặng; dùng any-cast
    const result = (PitXmlParser as any).findTag(xml, ['ct32']);
    expect(result).toBeUndefined();
  });
  it('query ct31 KHÔNG khớp nhầm <ct310> hay <ct315>', () => {
    expect((PitXmlParser as any).findTag('<ct310>111</ct310>', ['ct31'])).toBeUndefined();
    expect((PitXmlParser as any).findTag('<ct315>222</ct315>', ['ct31'])).toBeUndefined();
  });
  it('tag đúng vẫn khớp: thường, có namespace, có attribute, viết hoa', () => {
    expect((PitXmlParser as any).findTag('<ct32>500000</ct32>', ['ct32'])).toBe('500000');
    expect((PitXmlParser as any).findTag('<tns:ct32>500000</tns:ct32>', ['ct32'])).toBe('500000');
    expect((PitXmlParser as any).findTag('<ct32 id="x">77</ct32>', ['ct32'])).toBe('77');
    expect((PitXmlParser as any).findTag('<CT32>88</CT32>', ['ct32'])).toBe('88');
  });
  it('ct320 được truy vấn đúng tên của chính nó', () => {
    expect((PitXmlParser as any).findTag('<ct320>999000</ct320>', ['ct320'])).toBe('999000');
  });
});

import { describe, expect, it } from 'vitest';
import { formatDeclarationValue, getTaxTypeLabel } from '../src/shared/declarationFormatter';

describe('Declaration Formatter Presentation Layer', () => {
  it('1. Formats money in VND with dot separators and currency symbol', () => {
    const res1 = formatDeclarationValue({
      code: '[27]',
      label: 'Tổng thu nhập chịu thuế trả cho cá nhân',
      value: '6028107381',
      type: 'money'
    });
    expect(res1.formattedValue).toBe('6.028.107.381 ₫');
    expect(res1.isAnomaly).toBe(false);

    const res2 = formatDeclarationValue({
      code: '[31]',
      label: 'Tổng số thuế TNCN đã khấu trừ',
      value: '56000000',
      type: 'money'
    });
    expect(res2.formattedValue).toBe('56.000.000 ₫');
  });

  it('2. Formats personnel / quantity with unit and checks anomaly', () => {
    const normal = formatDeclarationValue({
      code: '[21]',
      label: 'Tổng số người lao động',
      value: '125',
      type: 'quantity',
      unit: 'người'
    });
    expect(normal.formattedValue).toBe('125 người');
    expect(normal.isAnomaly).toBe(false);

    // Bất thường số người quá lớn (dấu hiệu XML chứa số tiền thay vì số người)
    const abnormal = formatDeclarationValue({
      code: '[21]',
      label: 'Tổng số người lao động',
      value: '13342824749',
      type: 'quantity',
      unit: 'người'
    });
    expect(abnormal.formattedValue).toBe('13.342.824.749 người');
    expect(abnormal.isAnomaly).toBe(true);
    expect(abnormal.anomalyWarning).toBeDefined();
  });

  it('3. Keeps identifiers and raw text unchanged', () => {
    const idItem = formatDeclarationValue({
      label: 'Mã hồ sơ',
      value: '000.701.18.G12-260314-2711000036943',
      type: 'identifier'
    });
    expect(idItem.formattedValue).toBe('000.701.18.G12-260314-2711000036943');
  });
  it('3b. Không format nhầm Kỳ tính thuế, Mã thủ tục hoặc Ngày nộp thành tiền tệ', () => {
    const period = formatDeclarationValue({
      label: 'Kỳ tính thuế',
      value: '06/2026'
    });
    expect(period.type).toBe('text');
    expect(period.formattedValue).toBe('06/2026');

    const filingId = formatDeclarationValue({
      label: 'Mã số hồ sơ (ID)',
      value: 'G12.18-260720-00116072'
    });
    expect(filingId.type).toBe('text');
    expect(filingId.formattedValue).toBe('G12.18-260720-00116072');

    const procCode = formatDeclarationValue({
      label: 'Mã thủ tục hành chính',
      value: '1.007014'
    });
    expect(procCode.type).toBe('text');
    expect(procCode.formattedValue).toBe('1.007014');

    const submitDate = formatDeclarationValue({
      label: 'Thời điểm nộp',
      value: '20/07/2026 10:35'
    });
    expect(submitDate.type).toBe('text');
    expect(submitDate.formattedValue).toBe('20/07/2026 10:35');
  });

  it('4. Correctly infers groups for VAT and PIT indicators', () => {
    const pit1 = formatDeclarationValue({
      code: '[21]',
      label: 'Tổng số người lao động',
      value: '45'
    });
    expect(pit1.group).toBe('NHÂN SỰ');

    const pit2 = formatDeclarationValue({
      code: '[27]',
      label: 'Tổng thu nhập chịu thuế trả cho cá nhân',
      value: '500000000'
    });
    expect(pit2.group).toBe('THU NHẬP & THUẾ TNCN');

    const vat1 = formatDeclarationValue({
      code: '[25]',
      label: 'Thuế GTGT mua vào được khấu trừ',
      value: '20000000'
    });
    expect(vat1.group).toBe('HÀNG HÓA, DỊCH VỤ MUA VÀO (ĐẦU VÀO)');
  });

  it('5. Handles empty, null, or dash values gracefully', () => {
    expect(formatDeclarationValue({ label: 'Mục 1', value: '' }).formattedValue).toBe('—');
    expect(formatDeclarationValue({ label: 'Mục 2', value: '—' }).formattedValue).toBe('—');
    expect(formatDeclarationValue({ label: 'Mục 3', value: '-' }).formattedValue).toBe('—');
    expect(formatDeclarationValue({ label: 'Mục 4', value: undefined as unknown as string }).formattedValue).toBe('—');
  });

  it('6. Formats percentage values and checks anomaly (>100%)', () => {
    const normal = formatDeclarationValue({
      label: 'Tỷ lệ phân bổ',
      value: '10',
      unit: '%'
    });
    expect(normal.type).toBe('percentage');
    expect(normal.formattedValue).toBe('10%');
    expect(normal.isAnomaly).toBe(false);

    const anomaly = formatDeclarationValue({
      label: 'Tỷ lệ thuế',
      value: '150',
      type: 'percentage'
    });
    expect(anomaly.formattedValue).toBe('150%');
    expect(anomaly.isAnomaly).toBe(true);
  });

  it('7. Formats integer values with custom unit or default', () => {
    const intWithUnit = formatDeclarationValue({
      code: 'COUNT',
      label: 'Số lượng hóa đơn',
      value: '1250',
      type: 'integer',
      unit: 'tờ'
    });
    expect(intWithUnit.formattedValue).toBe('1.250 tờ');
    expect(intWithUnit.type).toBe('integer');
  });

  it('8. Infers groups for sales, tax obligations, and fallback', () => {
    const sales = formatDeclarationValue({
      code: '[34]',
      label: 'Hàng hóa bán ra chịu thuế 10%',
      value: '1000000'
    });
    expect(sales.group).toBe('HÀNG HÓA, DỊCH VỤ BÁN RA (ĐẦU RA)');

    const obligation = formatDeclarationValue({
      code: '[40]',
      label: 'Thuế GTGT còn phải nộp',
      value: '500000'
    });
    expect(obligation.group).toBe('NGHĨA VỤ THUẾ TRONG KỲ');

    const fallback = formatDeclarationValue({
      code: 'OTHER',
      label: 'Chỉ tiêu phụ',
      value: '123'
    });
    expect(fallback.group).toBe('CHỈ TIÊU KÊ KHAI CHÍNH');
  });

  it('9. Falls back to text type when label is unrecognized and value is not numeric', () => {
    const custom = formatDeclarationValue({
      code: 'CUSTOM_LABEL',
      label: 'Chỉ tiêu tự do',
      value: 'Non-numeric string'
    });
    expect(custom.type).toBe('text');
    expect(custom.formattedValue).toBe('Non-numeric string');
  });
});

describe('getTaxTypeLabel', () => {
  it('classifies refund taxes', () => {
    const refund = getTaxTypeLabel('REFUND', '01/HT-GTGT');
    expect(refund.vietnameseName).toBe('Hoàn thuế GTGT');
    expect(refund.shortLabel).toBe('Hoàn thuế');
    expect(refund.badgeClass).toContain('teal');
  });

  it('classifies VAT declarations', () => {
    const vat = getTaxTypeLabel('VAT', '01/GTGT');
    expect(vat.vietnameseName).toBe('Thuế GTGT');
    expect(vat.shortLabel).toBe('GTGT');
    expect(vat.badgeClass).toContain('emerald');
  });

  it('classifies PIT declarations', () => {
    const pit = getTaxTypeLabel('PIT', '05/KK-TNCN');
    expect(pit.vietnameseName).toBe('Thuế TNCN');
    expect(pit.shortLabel).toBe('TNCN');
    expect(pit.badgeClass).toContain('blue');
  });

  it('classifies CIT declarations', () => {
    const cit = getTaxTypeLabel('CIT', '03/TNDN');
    expect(cit.vietnameseName).toBe('Thuế TNDN');
    expect(cit.shortLabel).toBe('TNDN');
    expect(cit.badgeClass).toContain('purple');
  });

  it('classifies FCT declarations', () => {
    const fct = getTaxTypeLabel('FCT', '01/NTNN');
    expect(fct.vietnameseName).toBe('Thuế Nhà thầu');
    expect(fct.shortLabel).toBe('Nhà thầu');
    expect(fct.badgeClass).toContain('rose');
  });

  it('classifies house and land taxes', () => {
    const hl = getTaxTypeLabel('HOUSE_LAND', '01/SDĐPNN');
    expect(hl.vietnameseName).toBe('Thuế Nhà đất');
    expect(hl.shortLabel).toBe('Nhà đất');
    expect(hl.badgeClass).toContain('amber');
  });

  it('classifies reports and invoices', () => {
    const rpt = getTaxTypeLabel('REPORT', 'BC26/AC');
    expect(rpt.vietnameseName).toBe('Báo cáo / Hóa đơn');
    expect(rpt.shortLabel).toBe('Báo cáo');
  });

  it('falls back to default for unrecognized declaration', () => {
    const def = getTaxTypeLabel('UNKNOWN', 'XYZ');
    expect(def.vietnameseName).toBe('Thủ tục / Khác');
    expect(def.shortLabel).toBe('Khác');
  });
});

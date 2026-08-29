import { describe, expect, it } from 'vitest';
import { formatDeclarationValue } from '../src/shared/declarationFormatter';

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
});

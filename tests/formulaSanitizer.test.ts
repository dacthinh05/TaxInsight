import { describe, expect, it } from 'vitest';
import { sanitizeExcelCellValue } from '../src/shared/sanitizer';

describe('Excel Formula Injection vs Real Numbers Protection', () => {
  it('should preserve genuine negative and positive numbers as numbers', () => {
    expect(sanitizeExcelCellValue(-12345)).toBe(-12345);
    expect(sanitizeExcelCellValue(-120000.5)).toBe(-120000.5);
    expect(sanitizeExcelCellValue(0)).toBe(0);
    expect(sanitizeExcelCellValue(54321)).toBe(54321);
  });

  it('should convert valid numeric strings into proper numeric values', () => {
    expect(sanitizeExcelCellValue('-12345')).toBe(-12345);
    expect(sanitizeExcelCellValue('-35.5')).toBe(-35.5);
    expect(sanitizeExcelCellValue('+100')).toBe(100);
    expect(sanitizeExcelCellValue('  -999  ')).toBe(-999);
  });

  it('should NEUTRALIZE dangerous formula strings with single quote prefix', () => {
    expect(sanitizeExcelCellValue('-SUM(A1:A2)')).toBe("'-SUM(A1:A2)");
    expect(sanitizeExcelCellValue('+CMD(...)')).toBe("'+CMD(...)");
    expect(sanitizeExcelCellValue('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)");
    expect(sanitizeExcelCellValue('=HYPERLINK("evil.com")')).toBe("'=HYPERLINK(\"evil.com\")");
    expect(sanitizeExcelCellValue(' =SUM(A1:A2)')).toBe("' =SUM(A1:A2)");
    expect(sanitizeExcelCellValue('\t=SUM(A1:A2)')).toBe("'\t=SUM(A1:A2)");
    expect(sanitizeExcelCellValue('\r=SUM(A1:A2)')).toBe("'\r=SUM(A1:A2)");
    expect(sanitizeExcelCellValue('\n=SUM(A1:A2)')).toBe("'\n=SUM(A1:A2)");
  });

  it('should leave normal safe text untouched', () => {
    expect(sanitizeExcelCellValue('01/GTGT')).toBe('01/GTGT');
    expect(sanitizeExcelCellValue('Tờ khai quyết toán thuế TNDN')).toBe('Tờ khai quyết toán thuế TNDN');
    expect(sanitizeExcelCellValue('Đã chấp nhận')).toBe('Đã chấp nhận');
  });
});

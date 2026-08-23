import { describe, expect, it } from 'vitest';
import { isSafeExtractionPath, sanitizeExcelCellValue, sanitizeFilename } from '../src/shared/sanitizer';

describe('Sanitizer Utilities', () => {
  describe('sanitizeFilename', () => {
    it('should remove illegal Windows characters < > : " / \\ | ? *', () => {
      const input = '01/GTGT: Thang 03*2026? <Lan Dau>|test"';
      const output = sanitizeFilename(input);
      expect(output).not.toMatch(/[<>:"/\\|?*]/);
      expect(output).toBe('01_GTGT_ Thang 03_2026_ _Lan Dau__test_');
    });

    it('should trim trailing dots and spaces', () => {
      const input = 'Filename with dots...   ';
      const output = sanitizeFilename(input);
      expect(output).toBe('Filename with dots');
    });

    it('should fallback gracefully on empty/invalid input', () => {
      expect(sanitizeFilename('')).toBe('document');
      expect(sanitizeFilename(null as any)).toBe('document');
    });
  });

  describe('isSafeExtractionPath (Zip-Slip Protection)', () => {
    const targetDir = 'C:\\Downloads\\HoSoThue_GDT\\3702735709\\2026';

    it('should accept valid relative entries', () => {
      expect(isSafeExtractionPath(targetDir, 'subfolder/file.xml')).toBe(true);
      expect(isSafeExtractionPath(targetDir, 'file.pdf')).toBe(true);
    });

    it('should REJECT directory traversal attempts (Zip Slip attack)', () => {
      expect(isSafeExtractionPath(targetDir, '../../Windows/System32/calc.exe')).toBe(false);
      expect(isSafeExtractionPath(targetDir, '..\\..\\evil.bat')).toBe(false);
      expect(isSafeExtractionPath(targetDir, '/etc/passwd')).toBe(false);
      expect(isSafeExtractionPath(targetDir, 'C:\\Windows\\System32\\cmd.exe')).toBe(false);
    });
  });

  describe('sanitizeExcelCellValue (Formula Injection Protection)', () => {
    it('should escape dangerous formula prefix characters with a single quote', () => {
      expect(sanitizeExcelCellValue('=SUM(1+1)')).toBe("'=SUM(1+1)");
      expect(sanitizeExcelCellValue('+CMD(...)')).toBe("'+CMD(...)");
      expect(sanitizeExcelCellValue('-SUM(A1:A2)')).toBe("'-SUM(A1:A2)");
      expect(sanitizeExcelCellValue('@cmd|')).toBe("'@cmd|");
      expect(sanitizeExcelCellValue('\t=TAB_PREFIX')).toBe("'\t=TAB_PREFIX");
    });

    it('should preserve genuine numbers and leave normal safe text untouched', () => {
      expect(sanitizeExcelCellValue(-12345)).toBe(-12345);
      expect(sanitizeExcelCellValue('-12345')).toBe(-12345);
      expect(sanitizeExcelCellValue('01/GTGT')).toBe('01/GTGT');
      expect(sanitizeExcelCellValue('Tờ khai quyết toán thuế TNDN')).toBe('Tờ khai quyết toán thuế TNDN');
    });
  });
});

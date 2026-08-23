import AdmZip from 'adm-zip';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileOrganizer } from '../src/main/files/FileOrganizer';
import { TaxFiling } from '../src/shared/types';

describe('FileOrganizer', () => {
  let tempDir: string;
  let organizer: FileOrganizer;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tax_test_'));
    organizer = new FileOrganizer(tempDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Bỏ qua lỗi dọn dẹp temp
    }
  });

  it('should compute organized directory structure properly', () => {
    const filing: TaxFiling = {
      id: 'ID123',
      title: '01/GTGT',
      taxType: 'VAT',
      period: 'Tháng 03/2026',
      filingType: 'SUPPLEMENTAL',
      supplementalNo: 2,
      downloadAvailable: true
    };

    const destDir = organizer.getDestinationDir('3702735709', filing, 2026);
    expect(destDir).toContain('3702735709_2026');
    expect(fs.existsSync(destDir)).toBe(true);
  });

  it('should extract valid ZIP from base64, save files and compute SHA-256', () => {
    // Tạo file zip trong RAM
    const zip = new AdmZip();
    zip.addFile('files_01.xml', Buffer.from('<xml><data>Khai thue</data></xml>', 'utf-8'));
    zip.addFile('files_01.pdf', Buffer.from('%PDF-1.4 Mock PDF Content', 'utf-8'));
    const zipBuffer = zip.toBuffer();
    const base64 = zipBuffer.toString('base64');

    const filing: TaxFiling = {
      id: '000.701.18.G12-260328-27110000120307',
      procedureCode: '1.007014',
      declarationCode: '01/GTGT',
      title: 'Khai thuế GTGT',
      taxType: 'VAT',
      period: 'Tháng 01/2026',
      filingType: 'ORIGINAL',
      downloadAvailable: true
    };

    const result = organizer.saveExtractedFiling(base64, filing, '3702735709', 2026);

    expect(result.isExisting).toBe(false);
    expect(result.savedPaths.length).toBe(2);
    expect(result.xmlPath).toBeDefined();
    expect(result.pdfPath).toBeDefined();
    expect(result.sha256).toBeDefined();
    expect(fs.existsSync(result.xmlPath!)).toBe(true);
    expect(fs.existsSync(result.pdfPath!)).toBe(true);

    // Thử giải nén lại cùng nội dung -> Kiểm tra deduplication qua hash (isExisting = true)
    const secondResult = organizer.saveExtractedFiling(base64, filing, '3702735709', 2026);
    expect(secondResult.isExisting).toBe(true);
  });
});

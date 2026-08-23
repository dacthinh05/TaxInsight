import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FileManifest } from '../src/main/files/FileManifest';
import { FileOrganizer } from '../src/main/files/FileOrganizer';
import { TaxFiling } from '../src/shared/types';

describe('Two-Tier Deduplication & FileManifest', () => {
  let tempDir: string;
  const taxCode = '3702735709';
  const year = 2026;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tax_manifest_test_'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Dọn dẹp
    }
  });

  it('Tier 1: should return isAlreadyDownloaded = true ONLY when manifest entry and files both exist', () => {
    const organizer = new FileOrganizer(tempDir);
    const manifest = organizer.getManifest(taxCode, year);

    const filing: TaxFiling = {
      id: '000.701.18.G12-260328-27110000120307',
      procedureCode: '1.008346',
      title: 'Khai quyết toán TNDN',
      taxType: 'CIT',
      period: 'Năm 2025',
      filingType: 'ORIGINAL',
      downloadAvailable: true
    };

    // Khi chưa tải
    const preCheck1 = organizer.checkPreDownloadStatus(taxCode, filing, year);
    expect(preCheck1.isAlreadyDownloaded).toBe(false);

    // Giả lập tạo file thật trên ổ đĩa
    const destDir = organizer.getDestinationDir(taxCode, filing, year);
    const mockFilePath = path.join(destDir, 'sample_tkhai.xml');
    fs.writeFileSync(mockFilePath, '<xml>data</xml>');

    // Ghi nhận vào Manifest
    manifest.recordDownload({
      filingId: filing.id,
      procedureCode: filing.procedureCode,
      period: filing.period,
      filingType: filing.filingType,
      savedPaths: [mockFilePath],
      xmlPath: mockFilePath,
      sha256: 'mock_sha256_hash',
      downloadedAt: new Date().toISOString()
    });

    // Bây giờ kiểm tra lại pre-check
    const preCheck2 = organizer.checkPreDownloadStatus(taxCode, filing, year);
    expect(preCheck2.isAlreadyDownloaded).toBe(true);
    expect(preCheck2.savedPaths).toEqual([mockFilePath]);

    // Nếu người dùng lỡ tay xóa file khỏi ổ đĩa -> Pre-check phải tự động trả về false để cho phép tải lại
    fs.unlinkSync(mockFilePath);
    const preCheck3 = organizer.checkPreDownloadStatus(taxCode, filing, year);
    expect(preCheck3.isAlreadyDownloaded).toBe(false);
  });
});

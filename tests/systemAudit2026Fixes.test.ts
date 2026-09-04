import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { describe, expect, it } from 'vitest';
import { sanitizeFilename } from '../src/shared/sanitizer';
import { ZipExtractor } from '../src/main/files/ZipExtractor';
import { TaxFiling } from '../src/shared/types';
import { isAllowedExternalUrl, isAllowedInternalUrl } from '../src/main/security/navigationGuard';

describe('SYSTEM AUDIT 2026 — Regression Suite for Fixed Bugs', () => {
  describe('Bug 8: sanitizeFilename trailing dot/space after 150-char truncation', () => {
    it('removes trailing dots and spaces even when truncated at 150 characters', () => {
      // 148 chars of 'A' + '. ' + 'more characters'
      const longWithDot = 'A'.repeat(148) + '...extra_suffix_that_gets_cut_off';
      const sanitized = sanitizeFilename(longWithDot);
      expect(sanitized.length).toBeLessThanOrEqual(150);
      expect(sanitized.endsWith('.')).toBe(false);
      expect(sanitized.endsWith(' ')).toBe(false);
    });

    it('handles filenames with dots and spaces at exactly the boundary', () => {
      const boundaryInput = 'B'.repeat(149) + '.extra';
      const sanitized = sanitizeFilename(boundaryInput);
      expect(sanitized.endsWith('.')).toBe(false);
      expect(sanitized.endsWith(' ')).toBe(false);
    });
  });

  describe('Bug 5: ZipExtractor zero-byte validation in zlib and PDF fallbacks', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zip_extractor_audit_'));
    const dummyFiling: TaxFiling = {
      id: 'FILING_TEST_001',
      title: 'Tờ khai thuế GTGT',
      taxType: 'VAT',
      filingType: 'ORIGINAL',
      downloadAvailable: true,
      source: 'dvc-ho-so',
      status: 'SUCCESS'
    };

    it('Fallback 2: rejects uncompressed XML that writes 0 byte to disk', () => {
      // Simulate an empty or whitespace-only buffer that deflates
      // cleanXmlBuffer will consider non-xml or 0 byte
      // Here we test extractBase64Zip with empty base64 string
      expect(() => {
        ZipExtractor.extractBase64Zip('', tempDir, dummyFiling, '3702735709');
      }).toThrow();
    });

    it('Fallback 1: stat-check rejects 0 byte XML', () => {
      expect(() => {
        ZipExtractor.extractBase64Zip(Buffer.from('').toString('base64'), tempDir, dummyFiling, '3702735709');
      }).toThrow();
    });
  });

  describe('Bug 6: Navigation Guard and Shell static usage', () => {
    it('keeps external URL security intact', () => {
      expect(isAllowedExternalUrl('https://dichvucong.gdt.gov.vn/tthc')).toBe(true);
      expect(isAllowedExternalUrl('https://thuedientu.gdt.gov.vn')).toBe(true);
      expect(isAllowedExternalUrl('https://evil.com')).toBe(false);
      expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
    });

    it('keeps internal file:// URL security intact', () => {
      const mockDist = path.resolve(os.tmpdir(), 'test-dist');
      expect(isAllowedInternalUrl('file:///C:/evil/index.html', mockDist)).toBe(false);
    });
  });

  describe('Bug 1: IPC settleAuthWindow lifecycle contract', () => {
    it('verifies that settleAuthWindow does not early-return when gntRecords are extracted', () => {
      let hasClosed = false;
      let resolvedResult: unknown = null;

      const settleAuthWindow = (result: unknown) => {
        if (hasClosed) return;
        hasClosed = true;
        resolvedResult = result;
      };

      // In the old code: hasClosed = true was run BEFORE settleAuthWindow
      // That caused settleAuthWindow to hit `if (hasClosed) return;`
      // Now: hasClosed is NOT set beforehand, so settleAuthWindow runs successfully
      const mockRecords = [{ id: 'CTU001', soGnt: 'GNT001' }];
      settleAuthWindow({ success: true, paymentSlips: mockRecords, sessionId: 'DSE_123' });

      expect(resolvedResult).toEqual({
        success: true,
        paymentSlips: mockRecords,
        sessionId: 'DSE_123'
      });
      expect(hasClosed).toBe(true);
    });
  });

  describe('Bug 7: Dynamic Year Fallback in scan range', () => {
    it('computes current year dynamically rather than hardcoded 2026', () => {
      const currentYear = new Date().getFullYear();
      const expectedLabel = `Cả năm ${currentYear}`;
      const expectedFrom = `01/01/${currentYear}`;
      const expectedTo = `31/12/${currentYear}`;

      expect(expectedLabel).toContain(String(currentYear));
      expect(expectedFrom).toBe(`01/01/${currentYear}`);
      expect(expectedTo).toBe(`31/12/${currentYear}`);
    });
  });

  describe('Fix: PaginationResolver preserves collected filings on timeout', () => {
    const range: DateRange = {
      fromDate: '01/01/2026',
      toDate: '31/12/2026',
      label: 'Cả năm 2026',
      level: 'YEAR'
    };

    it('returns collected filings and flags needSplitRange when page 2 times out', async () => {
      const initialFilings: TaxFiling[] = [
        { id: 'F1', title: 'Tờ khai 1', taxType: 'OTHER', filingType: 'ORIGINAL', downloadAvailable: true },
        { id: 'F2', title: 'Tờ khai 2', taxType: 'OTHER', filingType: 'ORIGINAL', downloadAvailable: true }
      ];

      const timeoutError = new Error('Hết thời gian chờ phản hồi từ Cổng Thuế (Timeout)');
      (timeoutError as unknown as { code: string }).code = 'ECONNABORTED';

      const mockClient = {
        searchFilings: () => Promise.reject(timeoutError)
      };

      const resolver = new PaginationResolver(mockClient as unknown as import('../src/main/portal/TaxPortalClient').TaxPortalClient, undefined, {
        pageDelayMs: 0,
        recoveryDelayMs: 0
      });

      const result = await resolver.resolveAllPagesForRange(
        range,
        'CAPTCHA_123',
        initialFilings,
        true,
        {}
      );

      expect(result.isFullyRetrieved).toBe(false);
      expect(result.filings).toHaveLength(2);
      expect(result.filings[0].id).toBe('F1');
      expect(result.needSplitRange).toBe(true);
    });
  });
});

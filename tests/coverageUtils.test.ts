import { describe, it, expect } from 'vitest';
import {
  normalizeDateToIso,
  formatIsoToVnDate,
  mergeDateIntervals,
  subtractDateIntervals,
  evaluateYearScanCoverage
} from '../src/shared/coverageUtils';
import { ScanCoverageRecord } from '../src/shared/coverageTypes';

describe('coverageUtils', () => {
  describe('normalizeDateToIso', () => {
    it('returns empty string for empty or whitespace input', () => {
      expect(normalizeDateToIso('')).toBe('');
      expect(normalizeDateToIso('   ')).toBe('');
    });

    it('normalizes DD/MM/YYYY and DD-MM-YYYY to YYYY-MM-DD', () => {
      expect(normalizeDateToIso('05/09/2026')).toBe('2026-09-05');
      expect(normalizeDateToIso('5/9/2026')).toBe('2026-09-05');
      expect(normalizeDateToIso('15-12-2025')).toBe('2025-12-15');
      expect(normalizeDateToIso('1/1/2026 00:00:00')).toBe('2026-01-01');
    });

    it('normalizes YYYY-MM-DD and YYYY/MM/DD', () => {
      expect(normalizeDateToIso('2026-09-05')).toBe('2026-09-05');
      expect(normalizeDateToIso('2026/9/5')).toBe('2026-09-05');
    });

    it('returns raw clean string if no format matches', () => {
      expect(normalizeDateToIso('invalid-date')).toBe('invalid-date');
    });
  });

  describe('formatIsoToVnDate', () => {
    it('formats YYYY-MM-DD to DD/MM/YYYY', () => {
      expect(formatIsoToVnDate('2026-09-05')).toBe('05/09/2026');
      expect(formatIsoToVnDate('2025-01-15')).toBe('15/01/2025');
    });

    it('returns raw string if not 3-part iso string', () => {
      expect(formatIsoToVnDate('unknown')).toBe('unknown');
    });
  });

  describe('mergeDateIntervals', () => {
    it('returns empty array when given empty input or invalid intervals', () => {
      expect(mergeDateIntervals([])).toEqual([]);
      expect(mergeDateIntervals([{ from: '2026-10-01', to: '2026-09-01' }])).toEqual([]);
    });

    it('merges overlapping and adjacent intervals', () => {
      const intervals = [
        { from: '2026-01-01', to: '2026-01-15' },
        { from: '2026-01-10', to: '2026-01-20' },
        { from: '2026-01-21', to: '2026-01-31' },
        { from: '2026-03-01', to: '2026-03-10' }
      ];

      const merged = mergeDateIntervals(intervals);
      expect(merged).toEqual([
        { from: '2026-01-01', to: '2026-01-31' },
        { from: '2026-03-01', to: '2026-03-10' }
      ]);
    });
  });

  describe('subtractDateIntervals', () => {
    it('returns empty array for invalid targets', () => {
      expect(subtractDateIntervals({ from: '', to: '2026-12-31' }, [])).toEqual([]);
      expect(subtractDateIntervals({ from: '2026-12-31', to: '2026-01-01' }, [])).toEqual([]);
    });

    it('returns full target when covered is empty', () => {
      const target = { from: '2026-01-01', to: '2026-12-31' };
      expect(subtractDateIntervals(target, [])).toEqual([target]);
    });

    it('computes missing intervals between covered gaps', () => {
      const target = { from: '2026-01-01', to: '2026-01-31' };
      const covered = [
        { from: '2026-01-10', to: '2026-01-20' }
      ];

      const missing = subtractDateIntervals(target, covered);
      expect(missing).toEqual([
        { from: '2026-01-01', to: '2026-01-09' },
        { from: '2026-01-21', to: '2026-01-31' }
      ]);
    });
  });

  describe('evaluateYearScanCoverage', () => {
    const taxpayerId = '0101234567';
    const targetYear = 2026;

    it('returns NOT_SCANNED when no records exist and recordsFoundInYear is 0', () => {
      const evaluation = evaluateYearScanCoverage([], taxpayerId, targetYear, 0);
      expect(evaluation.status).toBe('NOT_SCANNED');
      expect(evaluation.ctaText).toBe('Quét dữ liệu 2026');
      expect(evaluation.lastScannedAt).toBeUndefined();
    });

    it('returns PARTIAL with scan cta when 0 days covered but records were found in year', () => {
      const evaluation = evaluateYearScanCoverage([], taxpayerId, targetYear, 5);
      expect(evaluation.status).toBe('PARTIAL');
      expect(evaluation.ctaText).toBe('Quét bổ sung dữ liệu 2026');
    });

    it('returns COMPLETE when entire year is covered', () => {
      const records: ScanCoverageRecord[] = [
        {
          coverageId: 'rec_1',
          taxpayerId,
          source: 'GDT_PORTAL',
          taxType: 'ALL',
          submissionDateFrom: '2026-01-01',
          submissionDateTo: '2026-12-31',
          scannedAt: '2026-09-01T10:00:00Z',
          status: 'SUCCESS',
          recordCount: 10,
          completedSuccessfully: true
        }
      ];

      const evaluation = evaluateYearScanCoverage(records, taxpayerId, targetYear, 10);
      expect(evaluation.status).toBe('COMPLETE');
      expect(evaluation.missingRanges).toHaveLength(0);
      expect(evaluation.lastScannedAt).toBe('2026-09-01T10:00:00Z');
    });

    it('returns PARTIAL with missing ranges when partially scanned', () => {
      const records: ScanCoverageRecord[] = [
        {
          coverageId: 'rec_2',
          taxpayerId,
          source: 'GDT_PORTAL',
          taxType: 'ALL',
          submissionDateFrom: '2026-01-01',
          submissionDateTo: '2026-06-30',
          scannedAt: '2026-07-01T10:00:00Z',
          status: 'SUCCESS',
          recordCount: 15,
          completedSuccessfully: true
        }
      ];

      const evaluation = evaluateYearScanCoverage(records, taxpayerId, targetYear, 15);
      expect(evaluation.status).toBe('PARTIAL');
      expect(evaluation.ctaText).toBe('Quét phần còn thiếu');
      expect(evaluation.missingRanges[0].from).toBe('2026-07-01');
      expect(evaluation.missingRanges[0].to).toBe('2026-12-31');
    });
  });
});

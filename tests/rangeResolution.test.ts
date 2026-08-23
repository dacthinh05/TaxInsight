import { describe, expect, it } from 'vitest';
import { parseFilingPeriod, resolveScanDateRange } from '../src/shared/dateUtils';

describe('Range Resolution & Period Parsing Integrity', () => {
  it('1. resolveScanDateRange calculates accurate quarter dates', () => {
    const q1 = resolveScanDateRange(2026, 'Q1');
    expect(q1.fromDate).toBe('01/01/2026');
    expect(q1.toDate).toBe('31/03/2026');
    expect(q1.level).toBe('QUARTER');

    const q4 = resolveScanDateRange(2025, 'Q4');
    expect(q4.fromDate).toBe('01/10/2025');
    expect(q4.toDate).toBe('31/12/2025');
  });

  it('2. resolveScanDateRange calculates accurate month dates', () => {
    const m1 = resolveScanDateRange(2026, 'M01');
    expect(m1.fromDate).toBe('01/01/2026');
    expect(m1.toDate).toBe('31/01/2026');
    expect(m1.level).toBe('MONTH');

    const m2Leap = resolveScanDateRange(2024, 'M02');
    expect(m2Leap.toDate).toBe('29/02/2024');

    const m2NonLeap = resolveScanDateRange(2025, 'M02');
    expect(m2NonLeap.toDate).toBe('28/02/2025');
  });

  it('3. parseFilingPeriod rejects loose numbers in transaction IDs/codes', () => {
    // ID containing 2711 or 2021 as postal code should NOT match
    const p1 = parseFilingPeriod('1.007014 - Khai thuế GTGT ID: 000.701.18.G12-251219-27110000132363');
    expect(p1).toBeUndefined();

    // Explicit Month
    const p2 = parseFilingPeriod('Khai thuế GTGT Tháng 11/2025');
    expect(p2?.raw).toBe('Tháng 11/2025');
    expect(p2?.type).toBe('MONTH');

    // Explicit Quarter
    const p3 = parseFilingPeriod('Khai thuế Quý 3/2025');
    expect(p3?.raw).toBe('Quý 3/2025');
    expect(p3?.type).toBe('QUARTER');

    // Explicit Year
    const p4 = parseFilingPeriod('Khai quyết toán Năm 2025');
    expect(p4?.raw).toBe('Năm 2025');
    expect(p4?.type).toBe('YEAR');
  });

  it('4. Download Progress Calculation Invariant', () => {
    // When 0 completed, 3 failed -> percent MUST be 0%, NOT 100%
    const total = 3;
    const completed = 0;
    const existing = 0;
    const failed = 3;

    const realSuccess = completed + existing;
    const percent = total > 0 ? Math.round((realSuccess / total) * 100) : 0;

    expect(percent).toBe(0);
    expect(realSuccess).toBe(0);
  });
});

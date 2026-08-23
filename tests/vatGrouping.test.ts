import { describe, expect, it } from 'vitest';
import { normalizeVatPeriod } from '../src/shared/dateUtils';
import { TaxFiling } from '../src/shared/types';
import { VatAnalyticsEngine } from '../src/main/scanner/VatAnalyticsEngine';

describe('VAT Period Grouping & Resolution Tests', () => {
  it('1. Group Chính thức + BS1 + BS2 cùng kỳ 01/2026 -> gom về đúng 1 group duy nhất', async () => {
    const filings: TaxFiling[] = [
      {
        id: 'F1',
        title: 'Khai thuế GTGT',
        taxType: 'VAT',
        declarationCode: '01/GTGT',
        period: '01/2026',
        submittedAt: '13/02/2026 09:00',
        filingType: 'ORIGINAL',
        downloadAvailable: false
      },
      {
        id: 'F2',
        title: 'Khai bổ sung GTGT',
        taxType: 'VAT',
        declarationCode: '01/GTGT',
        period: '01/2026',
        submittedAt: '19/03/2026 14:00',
        filingType: 'SUPPLEMENTAL',
        supplementalNo: 1,
        downloadAvailable: false
      },
      {
        id: 'F3',
        title: 'Khai bổ sung GTGT',
        taxType: 'VAT',
        declarationCode: '01/GTGT',
        period: '01/2026',
        submittedAt: '14/07/2026 08:20',
        filingType: 'SUPPLEMENTAL',
        supplementalNo: 2,
        downloadAvailable: false
      }
    ];

    const engine = new VatAnalyticsEngine({} as any);
    const summary = await engine.analyzeVatFilings(filings, '3702735709');

    expect(summary.totalPeriodsCount).toBe(1);
    const g1 = summary.periodGroups[0];
    expect(g1.periodLabel).toBe('01/2026');
    expect(g1.snapshots.length).toBe(3);
    expect(g1.hasSupplemental).toBe(true);
    expect(g1.supplementalCount).toBe(2);

    // Thứ tự trong chuỗi: Chính thức -> BS1 -> BS2
    expect(g1.snapshots[0].declarationType).toBe('ORIGINAL');
    expect(g1.snapshots[1].supplementalNo).toBe(1);
    expect(g1.snapshots[2].supplementalNo).toBe(2);
    expect(g1.finalSnapshot?.submissionId).toBe('F3');
  });

  it('2. Cross-Year: Kỳ 12/2025 và 01/2026 không bị group nhầm', async () => {
    const norm1 = normalizeVatPeriod('12/2025');
    const norm2 = normalizeVatPeriod('01/2026');

    expect(norm1.key).toBe('2025-M12');
    expect(norm2.key).toBe('2026-M01');
    expect(norm1.key).not.toBe(norm2.key);
  });

  it('3. Tờ khai bổ sung nộp muộn (01/2026 nộp ngày 14/07/2026) -> vẫn thuộc group 01/2026', () => {
    const norm = normalizeVatPeriod('01/2026', '14/07/2026');
    expect(norm.key).toBe('2026-M01');
    expect(norm.label).toBe('01/2026');
  });
});

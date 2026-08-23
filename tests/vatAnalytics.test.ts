import { describe, expect, it } from 'vitest';
import { VatAnalyticsEngine } from '../src/main/scanner/VatAnalyticsEngine';
import { TaxFiling } from '../src/shared/types';

describe('VAT Analytics Delta & Chain Warning Tests', () => {
  it('1. Cảnh báo MISSING_ORIGINAL khi có BS1 nhưng không có Chính thức', async () => {
    const filings: TaxFiling[] = [
      {
        id: 'BS_ONLY',
        title: 'Khai bổ sung GTGT',
        taxType: 'VAT',
        declarationCode: '01/GTGT',
        period: '02/2026',
        submittedAt: '20/04/2026 10:00',
        filingType: 'SUPPLEMENTAL',
        supplementalNo: 1,
        downloadAvailable: false
      }
    ];

    const engine = new VatAnalyticsEngine({} as any);
    const summary = await engine.analyzeVatFilings(filings, '3702735709');

    expect(summary.periodGroups.length).toBe(1);
    const g = summary.periodGroups[0];
    const hasMissingOrigWarn = g.warnings.some(w => w.code === 'MISSING_ORIGINAL');
    expect(hasMissingOrigWarn).toBe(true);
  });

  it('2. Cảnh báo MISSING_SUPPLEMENT_SEQUENCE khi có BS2 nhưng thiếu BS1', async () => {
    const filings: TaxFiling[] = [
      {
        id: 'ORIG',
        title: 'Khai thuế GTGT',
        taxType: 'VAT',
        declarationCode: '01/GTGT',
        period: '03/2026',
        submittedAt: '15/04/2026 10:00',
        filingType: 'ORIGINAL',
        downloadAvailable: false
      },
      {
        id: 'BS2',
        title: 'Khai bổ sung GTGT',
        taxType: 'VAT',
        declarationCode: '01/GTGT',
        period: '03/2026',
        submittedAt: '20/08/2026 10:00',
        filingType: 'SUPPLEMENTAL',
        supplementalNo: 2,
        downloadAvailable: false
      }
    ];

    const engine = new VatAnalyticsEngine({} as any);
    const summary = await engine.analyzeVatFilings(filings, '3702735709');

    const g = summary.periodGroups[0];
    const hasSeqWarn = g.warnings.some(w => w.code === 'MISSING_SUPPLEMENT_SEQUENCE');
    expect(hasSeqWarn).toBe(true);
  });
});

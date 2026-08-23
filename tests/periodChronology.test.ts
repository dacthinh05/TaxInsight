import { describe, expect, it } from 'vitest';
import {
  compareFilings,
  detectPeriodAnomalies,
  parseSubmissionTimestamp,
  resolvePeriodSupplementalSequences
} from '../src/shared/dateUtils';
import { TaxFiling } from '../src/shared/types';

describe('Period Chronology, Supplemental Sequence & Anomaly Detection', () => {
  it('chuyển đổi timestamp chính xác từ chuỗi ngày nộp tiếng Việt', () => {
    const t1 = parseSubmissionTimestamp('16/09/2025 14:48');
    const t2 = parseSubmissionTimestamp('24/09/2025 07:25');
    const t3 = parseSubmissionTimestamp('05/12/2025 09:05');

    expect(t1).toBeLessThan(t2);
    expect(t2).toBeLessThan(t3);
  });

  it('tự động phân giải và sắp xếp chuỗi bổ sung 08/2025 theo đúng chronology (Lần 1 -> Lần 4)', () => {
    const rawFilings: TaxFiling[] = [
      {
        id: 'f1',
        title: 'Khai thuế GTGT',
        taxType: 'VAT',
        period: '08/2025',
        submittedAt: '16/09/2025 14:48',
        filingType: 'ORIGINAL',
        downloadAvailable: true
      },
      {
        id: 'f2',
        title: 'Khai bổ sung GTGT',
        taxType: 'VAT',
        period: '08/2025',
        submittedAt: '05/12/2025 09:05',
        filingType: 'SUPPLEMENTAL',
        downloadAvailable: true
      },
      {
        id: 'f3',
        title: 'Khai bổ sung GTGT',
        taxType: 'VAT',
        period: '08/2025',
        submittedAt: '10/11/2025 10:14',
        filingType: 'SUPPLEMENTAL',
        downloadAvailable: true
      },
      {
        id: 'f4',
        title: 'Khai bổ sung GTGT',
        taxType: 'VAT',
        period: '08/2025',
        submittedAt: '19/11/2025 11:08',
        filingType: 'SUPPLEMENTAL',
        downloadAvailable: true
      },
      {
        id: 'f5',
        title: 'Khai bổ sung GTGT',
        taxType: 'VAT',
        period: '08/2025',
        submittedAt: '24/09/2025 07:25',
        filingType: 'SUPPLEMENTAL',
        downloadAvailable: true
      }
    ];

    const resolved = resolvePeriodSupplementalSequences(rawFilings);

    const f24Sep = resolved.find(f => f.id === 'f5')!;
    const f10Nov = resolved.find(f => f.id === 'f3')!;
    const f19Nov = resolved.find(f => f.id === 'f4')!;
    const f05Dec = resolved.find(f => f.id === 'f2')!;

    expect(f24Sep.supplementalNo).toBe(1);
    expect(f10Nov.supplementalNo).toBe(2);
    expect(f19Nov.supplementalNo).toBe(3);
    expect(f05Dec.supplementalNo).toBe(4);

    expect(f24Sep.isSequenceInferred).toBe(true);
  });

  it('phát hiện kỳ 06/2025 có bổ sung nhưng thiếu tờ khai chính thức (MISSING_OFFICIAL)', () => {
    const period06Filings: TaxFiling[] = [
      {
        id: 'f_06',
        title: 'Khai bổ sung GTGT',
        taxType: 'VAT',
        period: '06/2025',
        submittedAt: '16/08/2025 13:56',
        filingType: 'SUPPLEMENTAL',
        supplementalNo: 1,
        downloadAvailable: true
      }
    ];

    const anomalies = detectPeriodAnomalies(period06Filings);
    expect(anomalies).toContain('MISSING_OFFICIAL');
  });

  it('sắp xếp so sánh compareFilings theo timestamp số học và sequence ASC cho cùng kỳ', () => {
    const fOrig: TaxFiling = {
      id: 'f1',
      title: 'Khai thuế GTGT',
      taxType: 'VAT',
      period: '08/2025',
      submittedAt: '16/09/2025 14:48',
      filingType: 'ORIGINAL',
      downloadAvailable: true
    };
    const fBs1: TaxFiling = {
      id: 'f5',
      title: 'Khai bổ sung GTGT',
      taxType: 'VAT',
      period: '08/2025',
      submittedAt: '24/09/2025 07:25',
      filingType: 'SUPPLEMENTAL',
      supplementalNo: 1,
      downloadAvailable: true
    };
    const fBs2: TaxFiling = {
      id: 'f3',
      title: 'Khai bổ sung GTGT',
      taxType: 'VAT',
      period: '08/2025',
      submittedAt: '10/11/2025 10:14',
      filingType: 'SUPPLEMENTAL',
      supplementalNo: 2,
      downloadAvailable: true
    };

    expect(compareFilings(fOrig, fBs1)).toBeLessThan(0); // fOrig đứng trước fBs1
    expect(compareFilings(fBs1, fBs2)).toBeLessThan(0); // fBs1 đứng trước fBs2
  });
});

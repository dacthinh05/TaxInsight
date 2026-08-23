import { describe, expect, it, vi } from 'vitest';
import { PaginationResolver } from '../src/main/scanner/PaginationResolver';
import { DateRange, TaxFiling } from '../src/shared/types';

describe('PaginationResolver (Pagination First Logic)', () => {
  const range: DateRange = {
    fromDate: '01/01/2026',
    toDate: '31/12/2026',
    label: 'Cả năm 2026',
    level: 'YEAR'
  };

  it('should paginate across multiple pages when initialHasMore is true', async () => {
    const mockClient = {
      searchFilings: vi.fn().mockImplementation((_range, _captcha, options) => {
        if (options.page === 2) {
          return Promise.resolve({
            filings: [
              { id: 'F3', title: '01/GTGT T03', taxType: 'VAT', filingType: 'ORIGINAL', downloadAvailable: true } as TaxFiling
            ],
            hasMorePages: false
          });
        }
        return Promise.resolve({ filings: [], hasMorePages: false });
      })
    };

    const initialFilings: TaxFiling[] = [
      { id: 'F1', title: '01/GTGT T01', taxType: 'VAT', filingType: 'ORIGINAL', downloadAvailable: true },
      { id: 'F2', title: '01/GTGT T02', taxType: 'VAT', filingType: 'ORIGINAL', downloadAvailable: true }
    ];

    const resolver = new PaginationResolver(mockClient as any);
    const result = await resolver.resolveAllPagesForRange(range, 'TEST_CAPTCHA', initialFilings, true, {});

    expect(result.isFullyRetrieved).toBe(true);
    expect(result.filings).toHaveLength(3);
    expect(result.totalPages).toBe(2);
    expect(result.needSplitRange).toBe(false);
  });

  it('should detect suspicious hard server caps and flag needSplitRange = true', async () => {
    const mockClient = { searchFilings: vi.fn() };

    // Giả lập 100 kết quả không có cờ phân trang (nghi vấn bị cắt bớt bởi server)
    const suspiciousFilings = Array.from({ length: 100 }, (_, i) => ({
      id: `F_${i}`,
      title: `Hồ sơ ${i}`,
      taxType: 'VAT' as const,
      filingType: 'ORIGINAL' as const,
      downloadAvailable: true
    }));

    const resolver = new PaginationResolver(mockClient as any);
    const result = await resolver.resolveAllPagesForRange(range, 'TEST_CAPTCHA', suspiciousFilings, false, {});

    expect(result.isFullyRetrieved).toBe(false);
    expect(result.needSplitRange).toBe(true);
    expect(result.splitReason).toBe('HARD_RESULT_CAP_HIT');
  });
});

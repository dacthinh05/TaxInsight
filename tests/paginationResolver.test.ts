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

    const resolver = new PaginationResolver(mockClient as any, undefined, {
      pageDelayMs: 0,
      recoveryDelayMs: 0
    });
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

    const resolver = new PaginationResolver(mockClient as any, undefined, {
      pageDelayMs: 0,
      recoveryDelayMs: 0
    });
    const result = await resolver.resolveAllPagesForRange(range, 'TEST_CAPTCHA', suspiciousFilings, false, {});

    expect(result.isFullyRetrieved).toBe(false);
    expect(result.needSplitRange).toBe(true);
    expect(result.splitReason).toBe('HARD_RESULT_CAP_HIT');
  });

  it('waits and retries exactly once on 429, then propagates instead of returning partial data', async () => {
    const rateError = Object.assign(new Error('HTTP 429'), { code: 'RATE_LIMIT' });
    const mockClient = {
      searchFilings: vi.fn().mockRejectedValue(rateError)
    };
    const captchaManager = {
      requestCaptcha: vi.fn().mockResolvedValue('NEW_CAPTCHA')
    };
    const initialFilings: TaxFiling[] = [
      { id: 'F1', title: '01/GTGT T01', taxType: 'VAT', filingType: 'ORIGINAL', downloadAvailable: true }
    ];

    const resolver = new PaginationResolver(mockClient as any, captchaManager as any, {
      pageDelayMs: 0,
      recoveryDelayMs: 0
    });
    await expect(
      resolver.resolveAllPagesForRange(range, 'TEST_CAPTCHA', initialFilings, true, {})
    ).rejects.toMatchObject({ code: 'RATE_LIMIT' });
    expect(mockClient.searchFilings).toHaveBeenCalledTimes(2);
  });

  it('continues pagination when the one controlled post-cooldown retry succeeds', async () => {
    const rateError = Object.assign(new Error('HTTP 429'), {
      code: 'RATE_LIMIT',
      httpStatus: 429
    });
    const mockClient = {
      searchFilings: vi.fn()
        .mockRejectedValueOnce(rateError)
        .mockResolvedValueOnce({
          filings: [
            { id: 'F2', title: '01/GTGT T02', taxType: 'VAT', filingType: 'ORIGINAL', downloadAvailable: true }
          ],
          hasMorePages: false
        })
    };
    const initialFilings: TaxFiling[] = [
      { id: 'F1', title: '01/GTGT T01', taxType: 'VAT', filingType: 'ORIGINAL', downloadAvailable: true }
    ];
    const resolver = new PaginationResolver(mockClient as any, undefined, {
      pageDelayMs: 0,
      recoveryDelayMs: 0
    });

    const result = await resolver.resolveAllPagesForRange(
      range,
      'ACCEPTED_CAPTCHA',
      initialFilings,
      true,
      {}
    );

    expect(result.isFullyRetrieved).toBe(true);
    expect(result.filings.map(filing => filing.id)).toEqual(['F1', 'F2']);
    expect(mockClient.searchFilings).toHaveBeenCalledTimes(2);
  });

  it('reuses the accepted search CAPTCHA for pagination without showing another modal', async () => {
    const mockClient = {
      searchFilings: vi.fn().mockResolvedValue({
        filings: [
          { id: 'F2', title: '01/GTGT T02', taxType: 'VAT', filingType: 'ORIGINAL', downloadAvailable: true }
        ],
        hasMorePages: false
      })
    };
    const captchaManager = {
      requestCaptcha: vi.fn()
    };
    const initialFilings: TaxFiling[] = [
      { id: 'F1', title: '01/GTGT T01', taxType: 'VAT', filingType: 'ORIGINAL', downloadAvailable: true }
    ];
    const resolver = new PaginationResolver(mockClient as any, captchaManager as any, {
      pageDelayMs: 0,
      recoveryDelayMs: 0
    });

    const result = await resolver.resolveAllPagesForRange(
      range,
      'ACCEPTED_CAPTCHA',
      initialFilings,
      true,
      {}
    );

    expect(result.filings).toHaveLength(2);
    expect(captchaManager.requestCaptcha).not.toHaveBeenCalled();
    expect(mockClient.searchFilings).toHaveBeenCalledWith(
      range,
      'ACCEPTED_CAPTCHA',
      expect.objectContaining({ page: 2 })
    );
  });

  it('asks for a fresh CAPTCHA only after the server explicitly rejects the current one', async () => {
    const captchaInvalid = Object.assign(new Error('Sai CAPTCHA'), { code: 'CAPTCHA_INVALID' });
    const mockClient = {
      searchFilings: vi.fn()
        .mockRejectedValueOnce(captchaInvalid)
        .mockResolvedValueOnce({
          filings: [
            { id: 'F2', title: '01/GTGT T02', taxType: 'VAT', filingType: 'ORIGINAL', downloadAvailable: true }
          ],
          hasMorePages: false
        })
    };
    const captchaManager = {
      requestCaptcha: vi.fn().mockResolvedValue('FRESH_CAPTCHA')
    };
    const initialFilings: TaxFiling[] = [
      { id: 'F1', title: '01/GTGT T01', taxType: 'VAT', filingType: 'ORIGINAL', downloadAvailable: true }
    ];
    const resolver = new PaginationResolver(mockClient as any, captchaManager as any, {
      pageDelayMs: 0,
      recoveryDelayMs: 0
    });

    const result = await resolver.resolveAllPagesForRange(
      range,
      'USED_CAPTCHA',
      initialFilings,
      true,
      {}
    );

    expect(result.filings).toHaveLength(2);
    expect(captchaManager.requestCaptcha).toHaveBeenCalledTimes(1);
    expect(mockClient.searchFilings).toHaveBeenNthCalledWith(
      2,
      range,
      'FRESH_CAPTCHA',
      expect.objectContaining({ page: 2 })
    );
  });
});

import { PORTAL_CONFIG } from '../../shared/constants';
import { DateRange, TaxFiling } from '../../shared/types';
import { CaptchaManager } from '../portal/CaptchaManager';
import { TaxPortalClient } from '../portal/TaxPortalClient';

export interface PaginationResolutionResult {
  isFullyRetrieved: boolean;
  filings: TaxFiling[];
  totalPages: number;
  needSplitRange: boolean;
  splitReason?: 'DATE_RANGE_REJECTED' | 'HARD_RESULT_CAP_HIT' | 'PAGINATION_UNSUPPORTED';
}

export class PaginationResolver {
  private client: TaxPortalClient;
  private captchaManager?: CaptchaManager;

  constructor(client: TaxPortalClient, captchaManager?: CaptchaManager) {
    this.client = client;
    this.captchaManager = captchaManager;
  }

  /**
   * Duyệt qua toàn bộ các trang của một khoảng tìm kiếm (Pagination First).
   * Dam bao:
   *   1. Tự động lấy và giải CAPTCHA mới cho mỗi trang kế tiếp (do Cổng Thuế chỉ cho phép dùng CAPTCHA 1 lần).
   *   2. Dedup theo ID de tranh ho so bi nhan doi khi server tra overlap.
   */
  public async resolveAllPagesForRange(
    range: DateRange,
    initialCaptcha: string,
    initialFilings: TaxFiling[],
    initialHasMore: boolean,
    searchOptions: {
      maToKhai?: string;
      maTTHC?: string;
      scope?: string;
      mstUyQuyen?: string;
    },
    onPageFetched?: (page: number, count: number) => void
  ): Promise<PaginationResolutionResult> {
    const seenIds = new Set<string>(initialFilings.map(f => f.id));
    const allFilings = [...initialFilings];
    let currentPage = 1;
    let hasMore = initialHasMore || initialFilings.length >= PORTAL_CONFIG.DEFAULT_PAGE_SIZE;
    const maxPageLimit = 50;

    if (initialFilings.length === 0) {
      return {
        isFullyRetrieved: true,
        filings: [],
        totalPages: 1,
        needSplitRange: false
      };
    }

    if (initialFilings.length >= PORTAL_CONFIG.MAX_PAGE_RESULTS_SUSPICIOUS_THRESHOLD && !initialHasMore && !this.captchaManager) {
      return {
        isFullyRetrieved: false,
        filings: initialFilings,
        totalPages: 1,
        needSplitRange: true,
        splitReason: 'HARD_RESULT_CAP_HIT'
      };
    }

    while (hasMore && currentPage < maxPageLimit) {
      currentPage++;
      try {
        let pageCaptcha = initialCaptcha;
        if (this.captchaManager) {
          try {
            pageCaptcha = await this.captchaManager.requestCaptcha('SEARCH', range);
          } catch {
            pageCaptcha = initialCaptcha;
          }
        }

        const nextResult = await this.client.searchFilings(range, pageCaptcha, {
          ...searchOptions,
          page: currentPage
        });

        if (nextResult.filings.length === 0) {
          hasMore = false;
        } else {
          const newFilings = nextResult.filings.filter(f => !seenIds.has(f.id));
          for (const f of newFilings) seenIds.add(f.id);
          allFilings.push(...newFilings);
          hasMore = nextResult.filings.length >= PORTAL_CONFIG.DEFAULT_PAGE_SIZE || Boolean(nextResult.hasMorePages);
          if (onPageFetched) {
            onPageFetched(currentPage, newFilings.length);
          }
        }
      } catch (err: any) {
        hasMore = false;
        if (err.code === 'CAPTCHA_INVALID' || err.code === 'SESSION_EXPIRED') {
          return {
            isFullyRetrieved: false,
            filings: allFilings,
            totalPages: currentPage - 1,
            needSplitRange: true,
            splitReason: 'HARD_RESULT_CAP_HIT'
          };
        }
      }
    }

    return {
      isFullyRetrieved: true,
      filings: allFilings,
      totalPages: currentPage,
      needSplitRange: allFilings.length >= PORTAL_CONFIG.DEFAULT_PAGE_SIZE && hasMore
    };
  }
}

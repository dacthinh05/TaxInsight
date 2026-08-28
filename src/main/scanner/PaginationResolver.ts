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
  private pageDelayMs: number;
  private recoveryDelayMs: number;

  constructor(
    client: TaxPortalClient,
    captchaManager?: CaptchaManager,
    pacing: { pageDelayMs?: number; recoveryDelayMs?: number } = {}
  ) {
    this.client = client;
    this.captchaManager = captchaManager;
    this.pageDelayMs = Math.max(0, pacing.pageDelayMs ?? 2500);
    this.recoveryDelayMs = Math.max(0, pacing.recoveryDelayMs ?? 1000);
  }

  /**
   * Duyệt qua toàn bộ các trang của một khoảng tìm kiếm (Pagination First).
   * Dam bao:
   *   1. Giữ CAPTCHA/phiên đã được server chấp nhận khi phân trang; chỉ lấy
   *      CAPTCHA mới nếu server thực sự trả CAPTCHA_INVALID.
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
    let currentCaptcha = initialCaptcha;
    let serverRequiresFreshCaptchaPerPage = false;

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
        // Live production: trang 2 thành công nhưng trang 3 gửi sau khoảng
        // 1 giây bị HTTP 429. Giữ nhịp tối thiểu 2.5 giây giữa các trang,
        // độc lập với thời gian parse/render.
        if (this.pageDelayMs > 0) {
          await new Promise(resolve => setTimeout(resolve, this.pageDelayMs));
        }

        // Luồng portal cũ cho phép phân trang trong cùng phiên tìm kiếm mà
        // không bắt CAPTCHA mới. Bản 2.7.4 tự áp đặt "mỗi trang một CAPTCHA",
        // khiến 8 trang = 8 lần nhập dù server chưa hề từ chối mã hiện tại.
        // Chỉ yêu cầu ảnh mới sau khi server THỰC SỰ trả CAPTCHA_INVALID.
        if (serverRequiresFreshCaptchaPerPage && this.captchaManager) {
          currentCaptcha = await this.captchaManager.requestCaptcha(
            'SEARCH',
            range,
            false,
            { requestReason: 'NEXT_PAGE', page: currentPage }
          );
        }

        let nextResult;
        try {
          nextResult = await this.client.searchFilings(range, currentCaptcha, {
            ...searchOptions,
            page: currentPage
          });
        } catch (pageError: any) {
          if (pageError?.code === 'RATE_LIMIT' || Number(pageError?.httpStatus) === 429) {
            // Interceptor đã kích hoạt cooldown dùng Retry-After hoặc mặc định
            // 30 giây. Chờ tập trung rồi chỉ gửi lại ĐÚNG MỘT request cùng
            // trang/CAPTCHA; nếu vẫn 429 thì ném lỗi, tuyệt đối không lặp.
            await TaxPortalClient.waitForGlobalRateLimit();
            if (this.recoveryDelayMs > 0) {
              await new Promise(resolve => setTimeout(resolve, this.recoveryDelayMs));
            }
            try {
              nextResult = await this.client.searchFilings(range, currentCaptcha, {
                ...searchOptions,
                page: currentPage
              });
            } catch (retryError: any) {
              if (retryError?.code === 'RATE_LIMIT' || Number(retryError?.httpStatus) === 429) {
                const finalRateError = new Error(
                  'Cổng Thuế vẫn giới hạn truy cập sau thời gian chờ. Vui lòng đợi 1–2 phút rồi quét lại.'
                );
                Object.assign(finalRateError, {
                  code: 'RATE_LIMIT',
                  httpStatus: 429
                });
                throw finalRateError;
              }
              throw retryError;
            }
          } else if (pageError?.code !== 'CAPTCHA_INVALID' || !this.captchaManager) {
            throw pageError;
          } else {
            serverRequiresFreshCaptchaPerPage = true;
            currentCaptcha = await this.captchaManager.requestCaptcha(
              'SEARCH',
              range,
              false,
              { requestReason: 'NEXT_PAGE', page: currentPage }
            );
            nextResult = await this.client.searchFilings(range, currentCaptcha, {
              ...searchOptions,
              page: currentPage
            });
          }
        }

        if (nextResult.filings.length === 0) {
          hasMore = false;
        } else {
          const newFilings = nextResult.filings.filter(f => !seenIds.has(f.id));
          if (newFilings.length === 0) {
            return {
              isFullyRetrieved: false,
              filings: allFilings,
              totalPages: currentPage,
              needSplitRange: true,
              splitReason: 'PAGINATION_UNSUPPORTED'
            };
          }
          for (const f of newFilings) seenIds.add(f.id);
          allFilings.push(...newFilings);
          hasMore = nextResult.filings.length >= PORTAL_CONFIG.DEFAULT_PAGE_SIZE || Boolean(nextResult.hasMorePages);
          if (onPageFetched) {
            onPageFetched(currentPage, newFilings.length);
          }
        }
      } catch (err: any) {
        // Không được biến lỗi mạng/429/hết phiên thành "hết trang": làm vậy vừa
        // trả dữ liệu thiếu như thể đầy đủ, vừa khiến tầng trên phân rã khoảng
        // ngày và tạo Request Avalanche.
        throw err;
      }
    }

    return {
      isFullyRetrieved: !hasMore,
      filings: allFilings,
      totalPages: currentPage,
      needSplitRange: allFilings.length >= PORTAL_CONFIG.DEFAULT_PAGE_SIZE && hasMore
    };
  }
}

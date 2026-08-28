import { AxiosError } from 'axios';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { PORTAL_CONFIG } from '../../shared/constants';
import { DateRange, FilingPreviewData, PortalErrorCode, TaxFiling } from '../../shared/types';
import { FilingPreviewParser } from '../scanner/FilingPreviewParser';
import { TaxFilingParser } from '../scanner/TaxFilingParser';
import { PortalSession } from './PortalSession';
import { globalPortalRequestScheduler } from './PortalRequestScheduler';
import { DownloadAction, TthcDetailParser } from './TthcDetailParser';

export interface SearchResult {
  filings: TaxFiling[];
  totalRecords?: number;
  hasMorePages?: boolean;
  rawResponse?: string;
}

export interface DownloadResponsePayload {
  fileName: string;
  fileType: string;
  content: string; // Base64
}

interface DownloadAttemptRecord {
  label: string;
  url: string;
  status: number;
  ms: number;
  contentType: string;
  head: string;
}

interface DownloadAttemptContext {
  attempts: DownloadAttemptRecord[];
  maxNetworkAttempts: number;
}

interface FilingAttachment {
  maHso: string;
  maTep: string;
  maGdich?: string;
  tenTep?: string;
  dinhDangTep?: string;
}

export class TaxPortalClient {
  private session: PortalSession;
  private isSessionInitialized = false;
  private csrfToken = '';
  private sessionInitPromise: Promise<void> | null = null;
  /**
   * Chờ hết thời gian Rate Limit Cooloff trên toàn hệ thống trước khi gọi tiếp API
   */
  public static async waitForGlobalRateLimit(abortSignal?: AbortSignal): Promise<void> {
    await globalPortalRequestScheduler.waitForCooldown(PORTAL_CONFIG.BASE_URL, abortSignal);
  }

  /**
   * Kích hoạt cơ chế tạm dừng toàn bộ luồng gọi API khi gặp HTTP 429 từ Cổng Thuế
   */
  public static triggerGlobalRateLimit(cooldownMs = 3000): void {
    globalPortalRequestScheduler.triggerCooldown(PORTAL_CONFIG.BASE_URL, cooldownMs);
    console.warn(`[TaxPortalClient] Kích hoạt Global Rate Limit Cooloff: tạm dừng tất cả luồng gọi API đến Cổng Thuế trong ${cooldownMs}ms`);
  }

  constructor(session: PortalSession) {
    this.session = session;
  }

  private recordAttempt(
    context: DownloadAttemptContext,
    label: string,
    url: string,
    status: number | undefined,
    ms: number,
    contentType: string | undefined,
    data: any
  ): void {
    let head = '';
    try {
      if (Buffer.isBuffer(data)) head = data.subarray(0, 150).toString('utf-8').replace(/\s+/g, ' ').trim();
      else if (typeof data === 'string') head = data.slice(0, 150).replace(/\s+/g, ' ').trim();
      else if (data !== undefined) head = JSON.stringify(data).slice(0, 150).replace(/\s+/g, ' ').trim();
    } catch {}
    head = head
      .replace(
        /(password|matKhau|captcha|token|cookie|csrf|xsrf|sessionId|JSESSIONID)[=:]\s*[^&\s"'<>]+/gi,
        '$1=******'
      )
      .replace(/((?:Bearer|Basic)\s+)[a-z0-9._~+/=-]+/gi, '$1******');
    context.attempts.push({
      label,
      url: url.replace(PORTAL_CONFIG.BASE_URL, ''),
      status: status || 0,
      ms,
      contentType: contentType || '',
      head
    });
    if (context.attempts.length > 60) context.attempts.shift();
  }

  private async diagRequest(
    context: DownloadAttemptContext,
    label: string,
    url: string,
    doReq: () => Promise<any>,
    abortSignal?: AbortSignal
  ): Promise<any> {
    if (context.attempts.length >= context.maxNetworkAttempts) {
      const budgetError = new Error(`Đã dừng chuỗi fallback sau ${context.maxNetworkAttempts} request để tránh Request Avalanche`);
      Object.assign(budgetError, { code: 'DOWNLOAD_ATTEMPT_BUDGET' });
      throw budgetError;
    }
    await TaxPortalClient.waitForGlobalRateLimit(abortSignal);
    const t0 = Date.now();
    try {
      const res = await doReq();
      this.recordAttempt(context, label, url, res?.status, Date.now() - t0, res?.headers?.['content-type'], res?.data);
      return res;
    } catch (err: any) {
      const status = err?.response?.status;
      this.recordAttempt(context, label, url, status, Date.now() - t0, err?.response?.headers?.['content-type'], err?.response?.data);
      if (status === 429) {
        TaxPortalClient.triggerGlobalRateLimit(3000);
      }
      throw err;
    }
  }

  /**
   * Reset trạng thái phiên (gọi khi đăng xuất / đổi tài khoản):
   * nếu không reset, CSRF token của phiên cũ sẽ được gửi kèm cookie jar mới
   * khiến lần đăng nhập tiếp theo bị từ chối.
   */
  public reset() {
    this.isSessionInitialized = false;
    this.csrfToken = '';
    this.sessionInitPromise = null;
  }

  /**
   * Trích xuất CSRF/XSRF Token từ mọi định dạng HTML của Cổng Thuế
   */
  public extractCsrfFromHtml(html: string): string | null {
    if (!html || typeof html !== 'string') return null;
    const match =
      html.match(/name=["'](?:_csrf|csrf-token|csrf_token)["']\s+(?:value|content)=["']([^"']+)["']/i)?.[1] ||
      html.match(/(?:value|content)=["']([^"']+)["']\s+name=["'](?:_csrf|csrf-token|csrf_token)["']/i)?.[1] ||
      html.match(/meta\s+name=["'](?:_csrf|csrf-token|csrf_token)["']\s+content=["']([^"']+)["']/i)?.[1] ||
      html.match(/meta\s+content=["']([^"']+)["']\s+name=["'](?:_csrf|csrf-token|csrf_token)["']/i)?.[1] ||
      html.match(/id=["']csrfToken["']\s+value=["']([^"']+)["']/i)?.[1] ||
      html.match(/name=["']_csrf["']\s+value=["']([^"']+)["']/i)?.[1] ||
      html.match(/var\s+(?:token|_csrf)\s*=\s*["']([^"']+)["']/i)?.[1];
    return match ? match.trim() : null;
  }

  /**
   * Khởi tạo phiên làm việc và trích xuất CSRF Token từ Cổng Thuế
   */
  public async ensureSessionInitialized(forceRefresh = false): Promise<void> {
    if (this.isSessionInitialized && !forceRefresh) return;
    if (this.sessionInitPromise) return this.sessionInitPromise;

    const initPromise = (async () => {
      const response = await this.session.client.get(PORTAL_CONFIG.LOGIN_URL, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
        }
      });

      const html = typeof response.data === 'string' ? response.data : '';
      const token = this.extractCsrfFromHtml(html);
      if (token) {
        this.csrfToken = token;
      }

      this.isSessionInitialized = true;
    })();
    this.sessionInitPromise = initPromise;
    try {
      await initPromise;
    } catch (err: any) {
      throw this.handleAxiosError(err, 'Không thể khởi tạo phiên Cổng Thuế');
    } finally {
      if (this.sessionInitPromise === initPromise) {
        this.sessionInitPromise = null;
      }
    }
  }

  /**
   * Kiểm tra tính hợp lệ thực tế của phiên đăng nhập (Health Check dựa trên response thật)
   */
  public async checkSession(): Promise<boolean> {
    try {
      const response = await this.session.client.get(PORTAL_CONFIG.TCHS_URL, {
        headers: {
          'Referer': PORTAL_CONFIG.HOME_URL,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        maxRedirects: 5,
        validateStatus: () => true
      });

      if (response.status === 401 || response.status === 403) {
        return false;
      }
      if (response.status === 429 || response.status >= 500) {
        const statusError = new Error(`Health check Cổng Thuế thất bại (HTTP ${response.status})`);
        Object.assign(statusError, {
          response: {
            status: response.status,
            data: response.data,
            headers: response.headers
          }
        });
        throw statusError;
      }

      const resData = response.data;
      if (typeof resData === 'string') {
        // Trích xuất CSRF Token mới nhất trên trang tchs nếu có
        const token = this.extractCsrfFromHtml(resData);
        if (token) {
          this.csrfToken = token;
        }

        // Kiểm tra dấu hiệu của trang Login (unauthenticated)
        if (
          resData.includes('name="tenDN"') ||
          resData.includes('name="matKhau"') ||
          resData.includes('submitLDAP') ||
          resData.includes('loginLDAP') ||
          resData.includes('Hết phiên làm việc') ||
          resData.includes('Đăng nhập lại')
        ) {
          return false;
        }

        // Kiểm tra dấu hiệu authenticated
        if (
          /dangXuat\s*\(/i.test(resData) ||
          />\s*Đăng xuất\s*</i.test(resData) ||
          resData.includes('thongTinDoanhNghiep')
        ) {
          return true;
        }

        // HTTP 200 với HTML/trang rỗng không chứng minh đã đăng nhập. WAF hoặc
        // /homelogin có thể vẫn trả 200; coi trạng thái không nhận diện là
        // chưa xác thực để tránh tạo phiên giả trong ứng dụng.
        return false;
      }

      return response.status === 200;
    } catch (err: any) {
      if (err?.response?.status === 401 || err?.response?.status === 403) return false;
      throw this.handleAxiosError(err, 'Không thể kiểm tra trạng thái phiên Cổng Thuế');
    }
  }

  private mustStopDownloadFallback(err: any): boolean {
    const status = Number(err?.response?.status || err?.httpStatus || 0);
    const code = String(err?.code || '');
    if (code === 'FILING_PAYLOAD_REJECTED' || this.isRejectedDownloadVariant(err)) {
      return false;
    }
    if (status === 401 || status === 429) return true;
    if ([
      'SESSION_EXPIRED',
      'RATE_LIMIT',
      'CANCELLED',
      'DOWNLOAD_ATTEMPT_BUDGET'
    ].includes(code)) return true;
    return false;
  }

  private responseText(err: any): string {
    const data = err?.response?.data;
    try {
      if (Buffer.isBuffer(data)) return data.toString('utf8');
      if (typeof data === 'string') return data;
      if (data && typeof data === 'object') return JSON.stringify(data);
    } catch {}
    return '';
  }

  private isRejectedDownloadVariant(err: any): boolean {
    const status = Number(err?.response?.status || err?.httpStatus || 0);
    if (status < 400) return false;
    const body = this.responseText(err)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd');
    return (
      body.includes('ho so truyen len khong hop le') ||
      body.includes('ma ho so khong hop le') ||
      body.includes('id to khai khong hop le') ||
      body.includes('id tkhai khong hop le') ||
      body.includes('invalid filing') ||
      body.includes('invalid dossier')
    );
  }

  private stopDownloadFallbackIfNeeded(err: any, contextMessage: string): void {
    if (this.mustStopDownloadFallback(err)) {
      throw this.handleAxiosError(err, contextMessage);
    }
  }

  /**
   * Lấy ảnh CAPTCHA từ Cổng Thuế dưới dạng Base64 Data URL (Kèm Auto-Retry khi gặp Rate Limit 429)
   */
  public async getCaptchaImage(type: 'LOGIN' | 'SEARCH' = 'LOGIN'): Promise<string> {
    const maxAttempts = 3;
    const referer = type === 'SEARCH' ? PORTAL_CONFIG.TCHS_URL : PORTAL_CONFIG.LOGIN_URL;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.ensureSessionInitialized();

        const url = `${PORTAL_CONFIG.CAPTCHA_URL}?t=${Date.now()}`;

        let response = await this.session.client.get(url, {
          responseType: 'arraybuffer',
          headers: {
            'Referer': referer,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
            'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
          }
        });

        let contentType = String(response.headers['content-type'] || '').toLowerCase();

        // Nếu portal trả về HTML (chưa có cookie), refresh lại login rồi thử lại
        if (!contentType.includes('image')) {
          await this.ensureSessionInitialized(true);

          response = await this.session.client.get(url, {
            responseType: 'arraybuffer',
            headers: {
              'Referer': referer,
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
              'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
            }
          });
          contentType = String(response.headers['content-type'] || '').toLowerCase();
        }

        const buffer = Buffer.from(response.data);
        const mimeType = contentType.includes('image') ? contentType.split(';')[0] : 'image/png';
        const base64 = buffer.toString('base64');
        return `data:${mimeType};base64,${base64}`;
      } catch (err: any) {
        const normalized = this.handleAxiosError(err, 'Lấy ảnh CAPTCHA thất bại');
        const code = String((normalized as any).code || '');
        // 429/5xx/xác thực là tín hiệu dừng, không tự gửi thêm request. Retry
        // tự động chỉ dành cho lỗi kết nối/timeout và vẫn có backoff hữu hạn.
        if (
          attempt === maxAttempts ||
          !['NETWORK', 'TIMEOUT'].includes(code)
        ) {
          throw normalized;
        }
        const delay = 750 * attempt;
        console.warn(`[TaxPortalClient] Lỗi tạm thời khi lấy CAPTCHA, thử lại sau ${delay}ms (lần ${attempt}/${maxAttempts})...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
    throw new Error('Lấy ảnh CAPTCHA thất bại do máy chủ giới hạn tần suất yêu cầu (HTTP 429)');
  }

  /**
   * Đăng nhập Cổng Dịch vụ công Thuế Việt Nam với CSRF & UTF-8 Safe Base64 Password
   */
  public async login(
    tenDN: string,
    matKhau: string,
    captcha: string
  ): Promise<{
    success: boolean;
    message?: string;
    errorField?: 'CAPTCHA' | 'PASSWORD' | 'TAX_CODE' | 'SESSION' | 'GENERAL';
  }> {
    try {
      await this.ensureSessionInitialized();

      // Encode UTF-8 Base64 cho mật khẩu giống hệt logic Cổng Thuế: btoa(unescape(encodeURIComponent(matKhau)))
      const encodedPassword = Buffer.from(matKhau, 'utf-8').toString('base64');

      const params = new URLSearchParams();
      if (this.csrfToken) {
        params.append('_csrf', this.csrfToken);
      }
      params.append('tenDN', tenDN.trim());
      params.append('matKhau', encodedPassword);
      params.append('doiTuong', 'DN');
      params.append('captcha', captcha.trim());

      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': PORTAL_CONFIG.LOGIN_URL,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
      };

      if (this.csrfToken) {
        headers['X-CSRF-TOKEN'] = this.csrfToken;
      }

      const response = await this.session.client.post(PORTAL_CONFIG.LOGIN_API, params.toString(), {
        headers,
        validateStatus: () => true // Bắt toàn bộ status code kể cả 4xx/5xx để xử lý thông báo chi tiết
      });

      const resData = response.data;
      const resStr = typeof resData === 'string' ? resData : JSON.stringify(resData || '');

      // Chỉ nhận dấu hiệu thành công "chắc chắn":
      // - XML <status>200|201</status>
      // - Marker điều hướng sau đăng nhập (isChooseDgDinhKy)
      // - Body JSON object có status/code/success tường minh
      // - Body văn bản NGẮN đúng bằng 'home'/'200'/'201' (response thuần của API)
      // KHÔNG dùng includes('home')/includes('200') trên body dài: trang lỗi HTML
      // chứa link "/tthc/home" hoặc số 200 trong markup bị hiểu nhầm thành
      // đăng nhập thành công dù session chưa được thiết lập.
      const trimmedBody = resStr.trim().toLowerCase();
      const isTinySuccessBody = trimmedBody === 'home' || trimmedBody === '200' || trimmedBody === '201';

      const isSuccess =
        resStr.includes('<status>200</status>') ||
        resStr.includes('<status>201</status>') ||
        resStr.includes('isChooseDgDinhKy') ||
        isTinySuccessBody ||
        (typeof resData === 'object' &&
          resData !== null &&
          (resData.status === '200' ||
            resData.status === '201' ||
            resData.status === 200 ||
            resData.status === 201 ||
            resData.code === '00' ||
            resData.success === true));

      if (isSuccess) {
        try {
          // Thực hiện theo luồng thực tế của Cổng Thuế: truy cập home có tham số đánh giá định kỳ
          await this.session.client.get('https://dichvucong.gdt.gov.vn/tthc/home?isChooseDgDinhKy=Y', {
            headers: {
              'Referer': PORTAL_CONFIG.LOGIN_URL,
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
            },
            maxRedirects: 5
          });
          await this.session.client.get(PORTAL_CONFIG.TCHS_URL, {
            headers: {
              'Referer': 'https://dichvucong.gdt.gov.vn/tthc/home?isChooseDgDinhKy=Y',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
            },
            maxRedirects: 5
          });
        } catch {
          // Bỏ qua lỗi phụ khi tải trang chủ
        }

        this.session.setLoggedIn(tenDN);
        const sessionAlive = await this.checkSession();
        if (!sessionAlive) {
          this.session.clearSession();
          this.isSessionInitialized = false;
          this.csrfToken = '';
          return {
            success: false,
            message: 'Cổng Thuế phản hồi đăng nhập nhưng không thiết lập được phiên làm việc. Vui lòng lấy CAPTCHA mới và thử lại.',
            errorField: 'SESSION'
          };
        }
        return { success: true };
      }

      // Trích xuất thông báo lỗi chính xác từ Cổng Thuế và phân loại trường bị sai
      const { message: errMsg, errorField } = this.extractLoginError(resData, response.status);

      return { success: false, message: errMsg, errorField };
    } catch (err: any) {
      throw this.handleAxiosError(err, 'Đăng nhập thất bại');
    }
  }

  /**
   * Bóc tách và phân loại nguyên nhân lỗi đăng nhập (Sai mật khẩu vs Sai CAPTCHA vs Sai MST)
   */
  private extractLoginError(
    resData: any,
    httpStatus: number
  ): { message: string; errorField: 'CAPTCHA' | 'PASSWORD' | 'TAX_CODE' | 'SESSION' | 'GENERAL' } {
    let rawError = '';

    if (typeof resData === 'object' && resData !== null) {
      rawError = resData.desc || resData.message || resData.msg || resData.error || resData.detail || '';
    } else if (typeof resData === 'string') {
      // Bóc tách từ thẻ XML <desc>, <message>, <msg>, <error>
      const descMatch =
        resData.match(/<desc[^>]*>([^<]+)<\/desc>/i) ||
        resData.match(/<message[^>]*>([^<]+)<\/message>/i) ||
        resData.match(/<msg[^>]*>([^<]+)<\/msg>/i) ||
        resData.match(/<error[^>]*>([^<]+)<\/error>/i) ||
        resData.match(/<div class=["'][^"']*error[^"']*["']>([^<]+)<\/div>/i) ||
        resData.match(/<span class=["'][^"']*error[^"']*["']>([^<]+)<\/span>/i);

      if (descMatch) {
        rawError = descMatch[1].trim();
      } else if (resData.length > 0 && resData.length < 250 && !resData.includes('<html')) {
        rawError = resData.trim();
      }
    }

    const lower = rawError.toLowerCase();

    // 1. Phân loại lỗi Sai CAPTCHA
    if (
      lower.includes('mã xác nhận') ||
      lower.includes('ma xac nhan') ||
      lower.includes('mã xác thực') ||
      lower.includes('ma xac thuc') ||
      lower.includes('captcha') ||
      lower.includes('mã bảo vệ') ||
      lower.includes('mã kiểm tra') ||
      lower.includes('mã an toàn')
    ) {
      return {
        message: rawError || 'Mã xác thực (CAPTCHA) không chính xác hoặc đã hết hạn. Đã tự động tạo mã mới, vui lòng nhập lại.',
        errorField: 'CAPTCHA'
      };
    }

    // 2. Phân loại lỗi Sai Mật khẩu / Tên đăng nhập
    if (
      lower.includes('mật khẩu') ||
      lower.includes('mat khau') ||
      lower.includes('password') ||
      lower.includes('tên đăng nhập hoặc mật khẩu') ||
      lower.includes('sai mật khẩu') ||
      lower.includes('thông tin đăng nhập')
    ) {
      return {
        message: rawError || 'Tên đăng nhập hoặc Mật khẩu không chính xác. Vui lòng kiểm tra lại MST và Mật khẩu (chú ý phím CapsLock).',
        errorField: 'PASSWORD'
      };
    }

    // 3. Phân loại lỗi Tài khoản / MST chưa đăng ký hoặc bị khóa
    if (
      lower.includes('không tồn tại') ||
      lower.includes('chưa đăng ký') ||
      lower.includes('chưa được kích hoạt') ||
      lower.includes('bị khóa') ||
      lower.includes('người nộp thuế chưa')
    ) {
      return {
        message: rawError || 'Mã số thuế / Tài khoản chưa kích hoạt hoặc không tồn tại trên Cổng Thuế.',
        errorField: 'TAX_CODE'
      };
    }

    // 4. Phân loại lỗi Hết phiên / CSRF (HTTP 403)
    if (httpStatus === 403 || lower.includes('csrf') || lower.includes('xsrf') || lower.includes('hết phiên')) {
      return {
        message: 'Phiên làm việc bảo mật đã hết hạn (HTTP 403). Đã tự động làm mới mã CAPTCHA, vui lòng thử lại.',
        errorField: 'SESSION'
      };
    }

    // 5. Mặc định
    return {
      message: rawError || 'Đăng nhập không thành công, vui lòng kiểm tra lại Mã số thuế, Mật khẩu hoặc Mã CAPTCHA.',
      errorField: 'GENERAL'
    };
  }

  /**
   * Tra cứu hồ sơ theo khoảng ngày và CAPTCHA
   */
  public async searchFilings(
    range: DateRange,
    captcha: string,
    options: {
      maNghiepVu?: string;
      maTTHC?: string;
      maToKhai?: string;
      scope?: string;
      mstUyQuyen?: string;
      page?: number;
    } = {}
  ): Promise<SearchResult> {
    try {
      const PAGE_SIZE = PORTAL_CONFIG.DEFAULT_PAGE_SIZE;
      const currentPage = options.page || 1;
      const params = {
        maNghiepVu: options.maNghiepVu || '',
        maTTHC: options.maTTHC || '',
        maToKhai: options.maToKhai || '',
        maHoSo: '',
        tuNgay: range.fromDate,
        denNgay: range.toDate,
        scope_tdt1: options.scope || 'SELF',
        mstUyQuyen_tdt1: options.mstUyQuyen || '',
        captcha: captcha.trim(),
        maXacNhan: captcha.trim(),
        page: currentPage,
        pageIndex: currentPage,
        // Portal production dùng `size`, không dùng `pageSize`.
        size: PAGE_SIZE
      };

      const response = await this.session.client.get(PORTAL_CONFIG.SEARCH_API, {
        params,
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': PORTAL_CONFIG.TCHS_URL,
          // HTMX headers khớp với request thực tế của GDT portal
          'HX-Request': 'true',
          'HX-Target': 'table-container',
          'HX-Trigger': 'form-search-advanced',
          'Accept': 'text/html, text/html-partial, application/xhtml+xml, application/json, */*'
        }
      });

      const data = response.data;
      let filings: TaxFiling[] = [];

      // Dump trang kết quả tra cứu lần cuối ra userData — phục vụ chẩn đoán
      // cấu trúc bảng/nút tải của từng loại hồ sơ (GTGT/TNCN/...) ngoài đời thật
      if (
        process.env.TAXINSIGHT_DEBUG_DUMP === '1' &&
        typeof data === 'string' &&
        data.length > 1000
      ) {
        try {
          const dumpPath = path.join(app.getPath('userData'), 'debug_last_search.html');
          fs.promises.writeFile(dumpPath, data).catch(() => {});
        } catch {}
      }

      if (typeof data === 'string') {
        if (data.includes('Mã captcha không đúng') || data.includes('Captcha không chính xác') || data.includes('captcha sai')) {
          const err = new Error('Mã CAPTCHA không chính xác');
          (err as any).code = 'CAPTCHA_INVALID';
          throw err;
        }
        if (data.includes('login') || data.includes('Hết phiên làm việc') || data.includes('Đăng nhập lại')) {
          const err = new Error('Phiên đăng nhập đã hết hạn');
          (err as any).code = 'SESSION_EXPIRED';
          throw err;
        }

        filings = TaxFilingParser.parseHtmlSearchResults(data);
      } else if (typeof data === 'object') {
        if (data.status === 'ERROR' && (data.message?.includes('captcha') || data.code === 'CAPTCHA_INVALID')) {
          const err = new Error('Mã CAPTCHA không chính xác');
          (err as any).code = 'CAPTCHA_INVALID';
          throw err;
        }
        filings = TaxFilingParser.parseJsonSearchResults(data);
      }

      let totalRecords = filings.length;
      // Dự đoán còn trang kế khi số hồ sơ trả về bằng đúng PAGE_SIZE (server trả đủ trang)
      // Nếu trả ít hơn PAGE_SIZE → đây là trang cuối → không còn trang kế
      let hasMorePages = filings.length >= PAGE_SIZE;

      if (typeof data === 'string') {
        const pagInfo = TaxFilingParser.parseHtmlPaginationInfo(data);
        if (pagInfo.totalRecords > 0) {
          totalRecords = pagInfo.totalRecords;
          // Tính toán trực tiếp từ tổng số bản ghi: còn hồ sơ chưa fetch?
          const fetchedSoFar = (currentPage - 1) * PAGE_SIZE + filings.length;
          hasMorePages = fetchedSoFar < pagInfo.totalRecords;
        }
        if (pagInfo.totalPages > 1) {
          hasMorePages = currentPage < pagInfo.totalPages;
        } else if (pagInfo.totalPages === 1) {
          // Server cho biết chỉ có 1 trang → không cần fetch thêm
          hasMorePages = false;
        }
      }

      return {
        filings,
        totalRecords,
        hasMorePages,
        rawResponse: typeof data === 'string' ? data : JSON.stringify(data)
      };
    } catch (err: any) {
      throw this.handleAxiosError(err, 'Lỗi khi tra cứu hồ sơ');
    }
  }

  /**
   * Lấy XSRF token hợp lệ từ cookie jar để gửi trong header X-XSRF-TOKEN / field _csrf.
   * QUAN TRỌNG: Cookie XSRF-TOKEN của Spring (Cổng Thuế) bị URL-encode
   * (vd '+' -> '%2B', '/' -> '%2F', '=' -> '%3D'). Browser thật luôn
   * decodeURIComponent trước khi gửi header — nếu gửi giá trị raw thì server
   * so token lệch và trả HTTP 403 body rỗng, khiến TẤT CẢ các POST tải hồ sơ
   * thất bại trong khi các GET tra cứu vẫn hoạt động bình thường.
   */
  private async resolveXsrfToken(): Promise<string> {
    try {
      const cookies = await this.session.getCookieJar().getCookies(PORTAL_CONFIG.TCHS_URL);
      const xsrfCookie = cookies.find(c => c.key === 'XSRF-TOKEN' || c.key.toLowerCase() === 'xsrf-token')?.value;
      if (xsrfCookie) {
        try {
          return decodeURIComponent(xsrfCookie);
        } catch {
          return xsrfCookie;
        }
      }
    } catch {}
    return this.csrfToken;
  }

  private resolveTrustedPortalUrl(rawUrl: string, baseUrl: string): string | null {
    try {
      const url = new URL(rawUrl, baseUrl);
      if (
        url.protocol !== 'https:' ||
        url.hostname.toLowerCase() !== 'dichvucong.gdt.gov.vn'
      ) {
        return null;
      }
      return url.toString();
    } catch {
      return null;
    }
  }
  /**
   * Xác thực ID tờ khai trước khi tải
   */
  public async validateIdTkhai(idTKhai: string): Promise<boolean> {
    try {
      const cleanId = idTKhai.trim();
      if (!cleanId) return false;
      const activeToken = await this.resolveXsrfToken();
      const validateUrl = `${PORTAL_CONFIG.VALIDATE_TKHAI_API}?${new URLSearchParams({
        idTKhai: cleanId
      }).toString()}`;

      const headers: Record<string, string> = {
        'Accept': '*/*',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': `${PORTAL_CONFIG.DETAIL_FILE_URL}/${cleanId}?loai=`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
      };
      if (activeToken) {
        headers['X-XSRF-TOKEN'] = activeToken;
      }

      const response = await this.session.client.get(validateUrl, {
        headers,
        timeout: 8000
      });
      const responseText = Buffer.isBuffer(response.data)
        ? response.data.toString('utf8').trim()
        : String(response.data ?? '').trim();
      return response.status === 200 && responseText === '200';
    } catch (err: any) {
      throw this.handleAxiosError(err, `Không thể xác thực hồ sơ ID: ${idTKhai.trim()}`);
    }
  }

  /**
   * Phát hiện phản hồi HTML trang Đăng nhập / Hết phiên trong luồng tải file.
   */
  private throwIfLoginHtmlResponse(resData: any): void {
    try {
      let text = '';
      if (Buffer.isBuffer(resData)) {
        const header4 = resData.subarray(0, 4);
        if (header4.equals(Buffer.from('%PDF')) || header4.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return;
        text = resData.toString('utf-8');
      } else if (typeof resData === 'string') {
        text = resData;
      } else {
        return;
      }
      const trimmed = text.trim().toLowerCase();
      if (!trimmed.startsWith('<!doctype html') && !trimmed.startsWith('<html')) return;
      const loginMarkers = [
        'name="tendn"', "name='tendn'", 'name="matkhau"', "name='matkhau'",
        'submitldap', 'loginldap', 'hết phiên làm việc', 'đăng nhập lại'
      ];
      if (loginMarkers.some(marker => trimmed.includes(marker))) {
        const err = new Error('Phiên làm việc đã hết hạn khi tải hồ sơ. Vui lòng đăng nhập lại.');
        (err as any).code = 'SESSION_EXPIRED';
        throw err;
      }
    } catch (err: any) {
      if (err?.code === 'SESSION_EXPIRED') throw err;
    }
  }

  /**
   * Trích xuất nội dung file Base64 từ mọi biến thể phản hồi của máy chủ GDT
   */
  private buildValidatedDownloadPayload(
    rawBase64: string,
    defaultId: string,
    suggestedFileName?: string
  ): DownloadResponsePayload | null {
    const normalized = String(rawBase64 || '')
      .replace(/^data:[^;]+;base64,/i, '')
      .replace(/\s+/g, '')
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .trim();
    if (normalized.length < 8 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null;

    const padded = normalized.replace(/=+$/, '') +
      '='.repeat((4 - normalized.replace(/=+$/, '').length % 4) % 4);
    let buffer: Buffer;
    try {
      buffer = Buffer.from(padded, 'base64');
    } catch {
      return null;
    }
    if (buffer.length < 4) return null;

    const head4 = buffer.subarray(0, 4);
    if (head4.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
      return {
        fileName: suggestedFileName || `files_${defaultId}.zip`,
        fileType: 'application/zip',
        content: padded
      };
    }
    if (head4.equals(Buffer.from('%PDF'))) {
      const proposed = suggestedFileName || `files_${defaultId}.pdf`;
      return {
        fileName: proposed.toLowerCase().endsWith('.pdf') ? proposed : `files_${defaultId}.pdf`,
        fileType: 'application/pdf',
        content: padded
      };
    }

    const text = buffer.toString('utf8').replace(/^\uFEFF/, '').trim();
    if (
      text.startsWith('<?xml') ||
      (/^<[A-Za-z_][\s\S]*>/.test(text) &&
        !text.toLowerCase().startsWith('<html') &&
        !text.toLowerCase().startsWith('<!doctype'))
    ) {
      const proposed = suggestedFileName || `files_${defaultId}.xml`;
      return {
        fileName: proposed.toLowerCase().endsWith('.xml') ? proposed : `files_${defaultId}.xml`,
        fileType: 'application/xml',
        content: padded
      };
    }

    return null;
  }

  private extractPayloadContent(resData: any, defaultId: string): DownloadResponsePayload | null {
    if (!resData) return null;

    // 0. Chặn sớm phản hồi trang đăng nhập (hết phiên) để phân loại đúng lỗi
    this.throwIfLoginHtmlResponse(resData);

    // 1. Phản hồi dạng Buffer
    if (Buffer.isBuffer(resData)) {
      const header4 = resData.subarray(0, 4);
      const isPdf = header4.equals(Buffer.from('%PDF'));
      const isZip = header4.length >= 2 && header4[0] === 0x50 && header4[1] === 0x4b;
      if (isPdf || isZip) {
        return {
          fileName: `files_${defaultId}${isPdf ? '.pdf' : '.zip'}`,
          fileType: isPdf ? 'application/pdf' : 'application/zip',
          content: resData.toString('base64')
        };
      }

      const decoded = resData.toString('utf-8').trim();
      if (
        decoded.startsWith('<?xml') ||
        (/^<[A-Za-z_][\s\S]*>/.test(decoded) &&
          !decoded.toLowerCase().startsWith('<html') &&
          !decoded.toLowerCase().startsWith('<!doctype'))
      ) {
        return {
          fileName: `files_${defaultId}.xml`,
          fileType: 'application/xml',
          content: resData.toString('base64')
        };
      }
      if (decoded) {
        try {
          return this.extractPayloadContent(JSON.parse(decoded), defaultId);
        } catch {
          const decodedPayload = this.extractPayloadContent(decoded, defaultId);
          if (decodedPayload) return decodedPayload;
        }
      }
      return null;
    }

    // 2. Nếu phản hồi là String chứa Base64 hoặc JSON String
    if (typeof resData === 'string') {
      const str = resData.trim();
      if (str.startsWith('{') && str.endsWith('}')) {
        try {
          const parsed = JSON.parse(str);
          return this.extractPayloadContent(parsed, defaultId);
        } catch {}
      }

      // Một số response trả Base64 dưới dạng JSON string đã được quote hoặc
      // URL-encode dấu '+'/'/'. Chuẩn hóa trước khi kiểm tra để TNCN không rơi
      // xuống nhánh "không có nội dung".
      const payloadText = str
        .replace(/^(['"])([\s\S]*)\1$/, '$2')
        .replace(/%2B/gi, '+')
        .replace(/%2F/gi, '/')
        .replace(/%3D/gi, '=')
        .trim();

      const base64Match = payloadText.match(/data:[^;]+;base64,([A-Za-z0-9+/_=-\s]{20,})/) ||
        payloadText.match(/base64,([A-Za-z0-9+/_=-\s]{20,})/);
      if (base64Match) {
        return this.buildValidatedDownloadPayload(base64Match[1], defaultId);
      }

      // Chuỗi Base64 thuần
      const cleanStr = payloadText.replace(/\s+/g, '');
      if (cleanStr.length >= 20 && /^[A-Za-z0-9+/_=-]+$/.test(cleanStr)) {
        const normalized = cleanStr.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
        const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
        const canonical = Buffer.from(padded, 'base64').toString('base64').replace(/=+$/, '');
        if (canonical === normalized) {
          return this.buildValidatedDownloadPayload(padded, defaultId);
        }
      }
    }

    // 3. Nếu phản hồi là Object JSON
    if (typeof resData === 'object' && resData !== null) {
      const candidates = [
        resData.content,
        resData.noiDungTep,
        resData.fileContent,
        resData.fileBase64,
        resData.fileData,
        resData.base64,
        resData.base64Content,
        resData.file,
        resData.value,
        resData.rawContent
      ];

      for (const c of candidates) {
        if (typeof c === 'string' && c.length > 20) {
          const payload = this.buildValidatedDownloadPayload(
            c,
            defaultId,
            this.buildAttachmentFileName(resData) || resData.fileName || resData.name
          );
          if (payload) return payload;
        }
      }

      if (typeof resData.data === 'string' && resData.data.length > 20) {
        const payload = this.buildValidatedDownloadPayload(
          resData.data,
          defaultId,
          resData.fileName || resData.name
        );
        if (payload) return payload;
      }

      // Đệ quy bóc tách các cấp wrapper lồng nhau (data, result, response, body, obj)
      const wrapperKeys = ['data', 'result', 'response', 'body', 'obj', 'filing', 'hoso'];
      for (const key of wrapperKeys) {
        if (resData[key] && typeof resData[key] === 'object') {
          const nested = this.extractPayloadContent(resData[key], defaultId);
          if (nested) {
            if (resData.fileName && nested.fileName.startsWith('files_')) {
              nested.fileName = resData.fileName;
            }
            return nested;
          }
        }
      }
    }

    return null;
  }

  private buildAttachmentFileName(value: any): string | undefined {
    const rawName = String(value?.tenTep || value?.fileName || value?.name || '').trim();
    if (!rawName) return undefined;
    const rawExtension = String(value?.dinhDangTep || '').trim().replace(/^\./, '');
    if (!rawExtension || rawName.toLowerCase().endsWith(`.${rawExtension.toLowerCase()}`)) {
      return rawName;
    }
    return `${rawName}.${rawExtension}`;
  }

  private parseAttachmentList(value: any): FilingAttachment[] {
    let parsed = value;
    if (Buffer.isBuffer(parsed)) {
      try {
        parsed = JSON.parse(parsed.toString('utf8'));
      } catch {
        return [];
      }
    } else if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        return [];
      }
    }

    const candidates = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.data)
        ? parsed.data
        : Array.isArray(parsed?.result)
          ? parsed.result
          : [];

    return candidates
      .map((item: any) => ({
        maHso: String(item?.maHso || item?.maHSO || item?.maHoSo || '').trim(),
        maTep: String(item?.maTep || item?.idGiaoDichTthcFile || '').trim(),
        maGdich: String(item?.maGdich || item?.maGiaoDich || '').trim() || undefined,
        tenTep: String(item?.tenTep || item?.fileName || '').trim() || undefined,
        dinhDangTep: String(item?.dinhDangTep || item?.fileType || '').trim() || undefined
      }))
      .filter((item: FilingAttachment) => Boolean(item.maHso && item.maTep));
  }

  /**
   * Luồng mà nút "Tài liệu đính kèm" trên trang chi tiết GDT thực sự gọi.
   * Endpoint tải toàn bộ /downloadhoso có thể trả 500 với ID hiển thị G12.18-*,
   * trong khi từng XML/ZIP vẫn tải được qua hai API này.
   */
  private async downloadFilingAttachment(
    primaryId: string,
    detailHtml: string,
    detailUrl: string,
    baseHeaders: Record<string, string>,
    abortSignal: AbortSignal | undefined,
    attemptContext: DownloadAttemptContext
  ): Promise<DownloadResponsePayload | null> {
    const hasAttachmentMarker =
      detailHtml.includes('data-tai-lieu-dkem') ||
      detailHtml.includes('tai-lieu-dkem') ||
      detailHtml.includes('taiLieuDinhKem') ||
      detailHtml.includes('idGiaoDichTthcFile') ||
      detailHtml.includes('download-tai-lieu-dkem') ||
      /tai-lieu-dinh-kem/i.test(detailHtml);

    if (!hasAttachmentMarker) return null;

    await new Promise(resolve => setTimeout(resolve, 750));
    const listResponse = await this.diagRequest(
      attemptContext,
      'STD-attachment-list',
      PORTAL_CONFIG.ATTACHMENT_LIST_API,
      () => this.session.client.post(
        PORTAL_CONFIG.ATTACHMENT_LIST_API,
        { maHso: primaryId },
        {
          signal: abortSignal,
          headers: {
            ...baseHeaders,
            'Referer': detailUrl,
            'Content-Type': 'application/json;charset=UTF-8',
            'Accept': 'application/json, text/plain, */*'
          },
          timeout: 8000
        }
      ),
      abortSignal
    );

    const attachments = this.parseAttachmentList(listResponse?.data);
    if (attachments.length === 0) return null;

    const extensionPriority = (item: FilingAttachment): number => {
      const ext = String(item.dinhDangTep || item.tenTep?.split('.').pop() || '').toLowerCase();
      if (ext === 'xml') return 0;
      if (ext === 'zip') return 1;
      if (ext === 'pdf') return 2;
      return 3;
    };
    attachments.sort((a, b) => extensionPriority(a) - extensionPriority(b));

    const mst =
      detailHtml.match(/data-mst=["']([^"']+)["']/i)?.[1]?.trim() ||
      this.session.getSessionInfo().taxCode?.replace(/-ql$/i, '') ||
      '';

    for (const attachment of attachments.slice(0, 4)) {
      if (abortSignal?.aborted) break;
      await new Promise(resolve => setTimeout(resolve, 750));
      const fileResponse = await this.diagRequest(
        attemptContext,
        'STD-attachment-file',
        PORTAL_CONFIG.ATTACHMENT_DOWNLOAD_API,
        () => this.session.client.post(
          PORTAL_CONFIG.ATTACHMENT_DOWNLOAD_API,
          {
            maHso: attachment.maHso || primaryId,
            idGiaoDichTthcFile: attachment.maTep,
            mst,
            maGdich: attachment.maGdich || ''
          },
          {
            signal: abortSignal,
            headers: {
              ...baseHeaders,
              'Referer': detailUrl,
              'Content-Type': 'application/json;charset=UTF-8',
              'Accept': 'application/json, text/plain, */*'
            },
            timeout: 10000
          }
        ),
        abortSignal
      );

      const responseData = fileResponse?.data?.data ?? fileResponse?.data;
      const payload = this.extractPayloadContent(responseData, primaryId);
      if (payload) return payload;
    }

    return null;
  }

  /**
   * Tải file hồ sơ thuế (Base64 ZIP / XML / PDF) hỗ trợ tự động Retry khi gặp HTTP 429 Rate Limit.
   * Tự động chuyển đổi linh hoạt (Adaptive Dual Routing) giữa nhánh Standard và nhánh Thuế Điện Tử (TDT)
   * kèm Auto-Fallback nếu 1 nhánh bị lỗi.
   */
  private createDownloadWorkflowError(message: string, code: string, httpStatus?: number): Error {
    const err = new Error(message);
    Object.assign(err, {
      code,
      ...(httpStatus ? { httpStatus } : {})
    });
    return err;
  }

  private resolveDeterministicDownloadUrl(
    action: Extract<DownloadAction, { kind: 'filing' }>
  ): string {
    if (action.isThueDienTu === undefined) {
      throw this.createDownloadWorkflowError(
        'Trang chi tiết hồ sơ không cung cấp data-is-thue-dien-tu hợp lệ.',
        'DOWNLOAD_METADATA_INCOMPLETE'
      );
    }
    if (!action.isThueDienTu) return PORTAL_CONFIG.DOWNLOAD_API;
    if (!action.loaiTraCuu) {
      throw this.createDownloadWorkflowError(
        'Hồ sơ Thuế điện tử thiếu loaiTraCuu trên action tải của trang chi tiết.',
        'DOWNLOAD_METADATA_INCOMPLETE'
      );
    }
    return `${PORTAL_CONFIG.DOWNLOAD_TDT_API}?${new URLSearchParams({
      loaiTraCuu: action.loaiTraCuu
    }).toString()}`;
  }

  private async loadDeterministicDownloadContext(
    requestedId: string,
    abortSignal: AbortSignal | undefined,
    attemptContext: DownloadAttemptContext
  ): Promise<{
    detailUrl: string;
    action: Extract<DownloadAction, { kind: 'filing' }>;
    downloadUrl: string;
    csrfToken: string;
    csrfHeaderName: string;
  }> {
    const detailUrl = `${PORTAL_CONFIG.DETAIL_FILE_URL}/${encodeURIComponent(requestedId)}?loai=`;
    const response = await this.diagRequest(
      attemptContext,
      'DETAIL-download-contract',
      detailUrl,
      () => this.session.client.get(detailUrl, {
        signal: abortSignal,
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Referer': PORTAL_CONFIG.TCHS_URL,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
        },
        timeout: 8000
      }),
      abortSignal
    );
    this.throwIfLoginHtmlResponse(response?.data);
    if (typeof response?.data !== 'string') {
      throw this.createDownloadWorkflowError(
        'Trang chi tiết hồ sơ không trả về HTML để xác minh contract tải.',
        'DOWNLOAD_CONTRACT_UNVERIFIED'
      );
    }

    const parsed = TthcDetailParser.parse(response.data, detailUrl);
    if (!parsed.filingAction) {
      throw this.createDownloadWorkflowError(
        'Không tìm thấy action downloadHoSo(this) hợp lệ cùng data-mahoso trên trang chi tiết.',
        'DOWNLOAD_ACTION_NOT_FOUND'
      );
    }
    const csrfToken = parsed.csrf?.token || this.csrfToken;
    if (!csrfToken) {
      throw this.createDownloadWorkflowError(
        'Trang chi tiết không cung cấp CSRF token cho workflow tải hồ sơ.',
        'CSRF_CONTEXT_MISSING'
      );
    }
    const csrfHeaderName = /^[A-Za-z0-9-]+$/.test(parsed.csrf?.headerName || '')
      ? parsed.csrf!.headerName!
      : 'X-XSRF-TOKEN';
    const downloadUrl = this.resolveDeterministicDownloadUrl(parsed.filingAction);
    this.csrfToken = csrfToken;
    return {
      detailUrl,
      action: parsed.filingAction,
      downloadUrl,
      csrfToken,
      csrfHeaderName
    };
  }

  /**
   * Workflow tải đã xác minh từ HTML + downloadCommon-*.js của portal:
   * detail -> parse action/CSRF -> validate body "200" -> đúng một POST JSON
   * {maHoSo}. Không đoán idTKhai/form payload và không đổi Standard <-> TDT.
   */
  /**
   * Tải một ID hồ sơ duy nhất theo contract DVC đã xác minh.
   */
  private async downloadHoSoSingle(
    maHoSo: string,
    abortSignal?: AbortSignal,
    filingMeta?: { isThueDienTu?: boolean; loaiTraCuu?: string; maTkhai?: string; altIds?: string[] }
  ): Promise<DownloadResponsePayload> {
    const cleanId = String(maHoSo || '').trim();
    const attemptContext: DownloadAttemptContext = {
      attempts: [],
      maxNetworkAttempts: 6
    };
    if (!cleanId || !/^[A-Za-z0-9._-]+$/.test(cleanId)) {
      throw this.createDownloadWorkflowError(
        'Mã hồ sơ không hợp lệ; từ chối tạo URL tải từ JavaScript/onclick.',
        'INVALID_FILING_ID'
      );
    }
    void filingMeta;

    try {
      let context = await this.loadDeterministicDownloadContext(
        cleanId,
        abortSignal,
        attemptContext
      );

      const validateUrl = `${PORTAL_CONFIG.VALIDATE_TKHAI_API}?${new URLSearchParams({
        idTKhai: context.action.maHoSo
      }).toString()}`;
      const validateResponse = await this.diagRequest(
        attemptContext,
        'VALIDATE-idTKhai',
        validateUrl,
        () => this.session.client.get(validateUrl, {
          signal: abortSignal,
          headers: {
            'Accept': 'text/plain, application/json, */*',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': context.detailUrl,
            [context.csrfHeaderName]: context.csrfToken
          },
          timeout: 7000
        }),
        abortSignal
      );
      const validationResult = Buffer.isBuffer(validateResponse?.data)
        ? validateResponse.data.toString('utf8').trim()
        : String(validateResponse?.data ?? '').trim();
      if (validationResult === '400' || validationResult === '404' || validationResult === 'false') {
        const err = this.createDownloadWorkflowError(
          `Hồ sơ không vượt qua validateIdTkhai (kết quả nghiệp vụ: ${validationResult || 'rỗng'}).`,
          'FILING_VALIDATION_FAILED'
        );
        Object.assign(err, { validationResult });
        throw err;
      }

      let hasRetried = false;
      while (true) {
        try {
          const downloadResponse = await this.diagRequest(
            attemptContext,
            'DOWNLOAD-verified-contract',
            context.downloadUrl,
            () => this.session.client.post(
              context.downloadUrl,
              { maHoSo: context.action.maHoSo },
              {
                signal: abortSignal,
                timeout: 12000,
                responseType: 'arraybuffer',
                headers: {
                  'Accept': 'application/json, text/plain, */*',
                  'Content-Type': 'application/json',
                  'X-Requested-With': 'XMLHttpRequest',
                  'Referer': context.detailUrl,
                  [context.csrfHeaderName]: context.csrfToken
                }
              }
            ),
            abortSignal
          );
          const payload = this.extractPayloadContent(downloadResponse?.data, context.action.maHoSo);
          if (!payload) {
            throw this.createDownloadWorkflowError(
              'Cổng Thuế không trả file ZIP/XML/PDF hợp lệ theo contract đã xác minh.',
              'DOWNLOAD_INVALID_RESPONSE',
              Number(downloadResponse?.status || 0) || undefined
            );
          }
          return payload;
        } catch (err: any) {
          if (abortSignal?.aborted) {
            throw this.createDownloadWorkflowError(
              'Tác vụ tải đã bị dừng bởi người dùng.',
              'CANCELLED'
            );
          }
          const status = Number(err?.response?.status || err?.httpStatus || 0);
          if (status === 429 || err?.code === 'RATE_LIMIT') {
            TaxPortalClient.triggerGlobalRateLimit(3000);
            throw this.handleAxiosError(err, `Cổng Thuế giới hạn tải hồ sơ ID: ${cleanId}`);
          }
          if (status === 401) {
            throw this.handleAxiosError(err, `Phiên hết hạn khi tải hồ sơ ID: ${cleanId}`);
          }
          if (hasRetried || (status !== 403 && status < 500)) throw err;

          hasRetried = true;
          if (status === 403) {
            const refreshed = await this.loadDeterministicDownloadContext(
              cleanId,
              abortSignal,
              attemptContext
            );
            if (
              refreshed.action.maHoSo !== context.action.maHoSo ||
              refreshed.downloadUrl !== context.downloadUrl
            ) {
              throw this.createDownloadWorkflowError(
                'Metadata action tải thay đổi sau khi refresh CSRF; dừng để tránh gửi sai endpoint.',
                'DOWNLOAD_CONTRACT_CHANGED'
              );
            }
            context = refreshed;
          } else {
            await new Promise(resolve => setTimeout(resolve, 1200 + Math.random() * 400));
          }
        }
      }
    } catch (err: any) {
      (err as any).attempts = [...attemptContext.attempts];
      if (err?.code && typeof err?.code === 'string' && err.code !== 'UNKNOWN') {
        throw err;
      }
      throw this.handleAxiosError(err, `Lỗi khi tải hồ sơ ID: ${cleanId}`);
    }
  }

  /**
   * Tải hồ sơ trên DVC, thử ID chính rồi các ID thay thế mà parser đã phát hiện.
   * Một số dòng kết quả chứa mã tham chiếu dài và mã hồ sơ ngắn; endpoint detail
   * chỉ chấp nhận một trong hai. Chỉ fallback giữa các ID khi lỗi mang tính
   * định danh/contract, tuyệt đối không thử lại khi hết phiên hoặc bị rate-limit.
   */
  public async downloadHoSo(
    maHoSo: string,
    abortSignal?: AbortSignal,
    filingMeta?: { isThueDienTu?: boolean; loaiTraCuu?: string; maTkhai?: string; altIds?: string[] }
  ): Promise<DownloadResponsePayload> {
    const candidates = Array.from(new Set([
      String(maHoSo || '').trim(),
      ...(filingMeta?.altIds || []).map(value => String(value || '').trim())
    ].filter(Boolean))).slice(0, 5);

    if (!candidates.length) {
      throw this.createDownloadWorkflowError(
        'Mã hồ sơ không hợp lệ; không có ID để tải trên Cổng DVC.',
        'INVALID_FILING_ID'
      );
    }

    let lastError: any;
    const fallbackCodes = new Set([
      'INVALID_FILING_ID',
      'DOWNLOAD_ACTION_NOT_FOUND',
      'DOWNLOAD_CONTRACT_UNVERIFIED',
      'CSRF_CONTEXT_MISSING',
      'FILING_VALIDATION_FAILED',
      'DOWNLOAD_INVALID_RESPONSE',
      'DOWNLOAD_CONTRACT_CHANGED',
      'FILING_PAYLOAD_REJECTED'
    ]);

    for (const candidate of candidates) {
      try {
        return await this.downloadHoSoSingle(candidate, abortSignal, filingMeta);
      } catch (err: any) {
        lastError = err;
        if (abortSignal?.aborted) throw err;
        const code = String(err?.code || '');
        const status = Number(err?.httpStatus || err?.response?.status || 0);
        if (!fallbackCodes.has(code) || status === 401 || status === 429 || code === 'SESSION_EXPIRED' || code === 'RATE_LIMIT') {
          throw err;
        }
      }
    }

    throw lastError;
  }

  /**
   * Implementation adaptive cũ được giữ tạm thời để đối chiếu regression,
   * không còn được gọi bởi workflow production.
   */
  private async downloadHoSoAdaptiveLegacy(
    maHoSo: string,
    abortSignal?: AbortSignal,
    filingMeta?: { isThueDienTu?: boolean; loaiTraCuu?: string; maTkhai?: string; altIds?: string[] }
  ): Promise<DownloadResponsePayload> {
    const cleanId = maHoSo.trim();
    const isTdtPreferred = filingMeta?.isThueDienTu === true;
    const allAttempts: DownloadAttemptRecord[] = [];

    const idVariants = [cleanId, ...(filingMeta?.altIds || []).map(v => String(v).trim())]
      .filter((v, i, arr) => v && arr.indexOf(v) === i)
      .slice(0, 3);

    // Mỗi route có budget riêng. Trước đây Standard dùng hết 8 request thì lỗi
    // DOWNLOAD_ATTEMPT_BUDGET chặn luôn TDT, làm dual-routing chỉ tồn tại trên
    // danh nghĩa đối với các hồ sơ TNCN có detail/attachment/altIds phức tạp.
    const runStandard = async (): Promise<DownloadResponsePayload> => {
      const context: DownloadAttemptContext = { attempts: [], maxNetworkAttempts: 8 };
      try {
        return await this.downloadHoSoStandard(
          idVariants,
          filingMeta?.maTkhai,
          abortSignal,
          context
        );
      } finally {
        allAttempts.push(...context.attempts);
      }
    };
    const runTdt = async (): Promise<DownloadResponsePayload> => {
      const context: DownloadAttemptContext = { attempts: [], maxNetworkAttempts: 6 };
      try {
        return await this.downloadHoSoTdt(
          idVariants,
          filingMeta?.loaiTraCuu,
          filingMeta?.maTkhai,
          abortSignal,
          context
        );
      } finally {
        allAttempts.push(...context.attempts);
      }
    };

    try {
      try {
        return isTdtPreferred ? await runTdt() : await runStandard();
      } catch (primaryErr: any) {
        if (
          abortSignal?.aborted ||
          primaryErr.code === 'CANCELLED' ||
          primaryErr.code === 'SESSION_EXPIRED' ||
          primaryErr.code === 'FILING_VALIDATION_FAILED'
        ) {
          throw primaryErr;
        }

        if (primaryErr.code === 'RATE_LIMIT' || primaryErr.httpStatus === 429) {
          TaxPortalClient.triggerGlobalRateLimit(2500);
          throw primaryErr;
        }

        // Tự động chuyển nhánh (Adaptive Dual-Routing Fallback):
        // Nếu nhánh chính (TDT hoặc Standard) không tìm thấy hồ sơ hoặc trả lỗi payload/500,
        // tự động thử ngay nhánh còn lại trước khi kết luận thất bại.
        try {
          await new Promise(r => setTimeout(r, 200));
          if (isTdtPreferred) {
            console.warn(`[TaxPortalClient] Nhánh TDT thất bại cho ID ${cleanId}, tự động fallback sang nhánh Standard: ${primaryErr.message}`);
            return await runStandard();
          }
          console.warn(`[TaxPortalClient] Nhánh Standard thất bại cho ID ${cleanId}, tự động fallback sang nhánh TDT: ${primaryErr.message}`);
          return await runTdt();
        } catch (fallbackErr: any) {
          if (
            abortSignal?.aborted ||
            fallbackErr.code === 'CANCELLED' ||
            fallbackErr.code === 'SESSION_EXPIRED'
          ) {
            throw fallbackErr;
          }
          if (fallbackErr.code === 'RATE_LIMIT' || fallbackErr.httpStatus === 429) {
            TaxPortalClient.triggerGlobalRateLimit(2500);
            throw fallbackErr;
          }
          throw fallbackErr;
        }
      }
      throw new Error(`Không nhận được nội dung hồ sơ ID: ${maHoSo}`);
    } catch (err: any) {
      // Đính kèm toàn bộ chẩn đoán từng lần thử để audit log/UI chỉ ra chính xác
      // server trả gì ở từng bước thay vì một câu lỗi chung chung
      (err as any).attempts = [...allAttempts];
      throw err;
    }
  }

  /**
   * Nhánh Thuế Điện Tử: POST /tthc/tchs/downloadhoso-tdt?loaiTraCuu=<value>
   */
  private async downloadHoSoTdt(
    idVariants: string[],
    loaiTraCuu?: string,
    maTkhai?: string,
    abortSignal?: AbortSignal,
    attemptContext: DownloadAttemptContext = { attempts: [], maxNetworkAttempts: 8 }
  ): Promise<DownloadResponsePayload> {
    const primaryId = idVariants[0] || '';

    try {
      const activeToken = await this.resolveXsrfToken();

      const baseHeaders: Record<string, string> = {
        'Origin': 'https://dichvucong.gdt.gov.vn',
        'Referer': PORTAL_CONFIG.TCHS_URL,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/json;charset=UTF-8'
      };
      if (activeToken) {
        baseHeaders['X-XSRF-TOKEN'] = activeToken;
        baseHeaders['X-CSRF-TOKEN'] = activeToken;
      }

      const urlsToTry: string[] = [];
      if (loaiTraCuu) {
        urlsToTry.push(
          `${PORTAL_CONFIG.DOWNLOAD_TDT_API}?loaiTraCuu=${encodeURIComponent(loaiTraCuu)}`
        );
      } else {
        urlsToTry.push(PORTAL_CONFIG.DOWNLOAD_TDT_API);
      }

      let lastTdtError: any = null;

      outer:
      for (const tldUrl of urlsToTry) {
        if (abortSignal?.aborted) break;

        for (const variantId of idVariants) {
          if (abortSignal?.aborted) break outer;

          // Giãn cách nhẹ giữa các request tránh kích hoạt WAF Rate Limit
          await new Promise(r => setTimeout(r, 750));

          // CHIẾN LƯỢC TDT 1: JSON { maHoSo: <biến thể ID> }
          try {
            const response = await this.diagRequest(attemptContext, 'TDT-maHoSo', tldUrl, () => this.session.client.post(
              tldUrl,
              { maHoSo: variantId, ...(maTkhai ? { maTkhai } : {}) },
              { signal: abortSignal, headers: baseHeaders, timeout: 7000, responseType: 'arraybuffer' }
            ), abortSignal);
            const payload = this.extractPayloadContent(response?.data, variantId);
            if (payload) return payload;
          } catch (e1: any) {
            lastTdtError = e1;
            this.stopDownloadFallbackIfNeeded(e1, `Lỗi khi tải hồ sơ TDT ID: ${primaryId}`);
          }

          if (abortSignal?.aborted) break outer;

          // CHIẾN LƯỢC TDT 2: JSON { idTKhai: <biến thể ID> }
          try {
            const response2 = await this.diagRequest(attemptContext, 'TDT-idTKhai', tldUrl, () => this.session.client.post(
              tldUrl,
              { idTKhai: variantId, ...(maTkhai ? { maTkhai } : {}) },
              { signal: abortSignal, headers: baseHeaders, timeout: 5000, responseType: 'arraybuffer' }
            ), abortSignal);
            const payload2 = this.extractPayloadContent(response2?.data, variantId);
            if (payload2) return payload2;
          } catch (e2: any) {
            lastTdtError = e2;
            this.stopDownloadFallbackIfNeeded(e2, `Lỗi khi tải hồ sơ TDT ID: ${primaryId}`);
          }
        }
      }

      if (lastTdtError) {
        throw this.handleAxiosError(lastTdtError, `Lỗi khi tải hồ sơ TDT ID: ${primaryId}`);
      }
      throw new Error(`Nội dung file Base64 không tồn tại (downloadhoso-tdt) cho ID: ${primaryId}`);
    } catch (err: any) {
      if (abortSignal?.aborted) {
        const cancelErr = new Error('Tác vụ tải đã bị dừng bởi người dùng');
        (cancelErr as any).code = 'CANCELLED';
        throw cancelErr;
      }
      throw this.handleAxiosError(err, `Lỗi khi tải hồ sơ TDT ID: ${primaryId}`);
    }
  }

  /**
   * Nhánh Hồ Sơ Thường: POST /tthc/tchs/downloadhoso { maHoSo }
   * Tự động fallback qua các chiến lược payload khác nhau nếu cần.
   */
  private async downloadHoSoStandard(
    idVariants: string[],
    maTkhai?: string,
    abortSignal?: AbortSignal,
    attemptContext: DownloadAttemptContext = { attempts: [], maxNetworkAttempts: 8 }
  ): Promise<DownloadResponsePayload> {
    const primaryId = idVariants[0] || '';

    try {
      const activeToken = await this.resolveXsrfToken();

      const baseHeaders: Record<string, string> = {
        'Origin': 'https://dichvucong.gdt.gov.vn',
        'Referer': PORTAL_CONFIG.TCHS_URL,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'X-Requested-With': 'XMLHttpRequest'
      };

      if (activeToken) {
        baseHeaders['X-XSRF-TOKEN'] = activeToken;
        baseHeaders['X-CSRF-TOKEN'] = activeToken;
      }

      let lastError: any = null;
      let workingIdVariants = [...idVariants];
      let preloadedDetailResponse: any = null;
      let shortIdValidated = false;

      // Mở trang chi tiết trước để lấy mã tham chiếu dài 000.xxx... hoặc link
      // file thật từ API tài liệu đính kèm (/tthc/tchs/data-tai-lieu-dkem);
      // đây là luồng chính xác nhất mà Cổng DVC sử dụng.
      if (Boolean(primaryId)) {
        const detailUrl = `${PORTAL_CONFIG.DETAIL_FILE_URL}/${encodeURIComponent(primaryId)}?loai=`;
        try {
          await new Promise(r => setTimeout(r, 750));
          preloadedDetailResponse = await this.diagRequest(
            attemptContext,
            'STD-detail-preflight',
            detailUrl,
            () => this.session.client.get(detailUrl, {
              signal: abortSignal,
              headers: {
                ...baseHeaders,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
              },
              timeout: 8000
            }),
            abortSignal
          );
          const directPayload = this.extractPayloadContent(preloadedDetailResponse?.data, primaryId);
          if (directPayload) return directPayload;

          if (typeof preloadedDetailResponse?.data === 'string') {
            const html = preloadedDetailResponse.data;
            const freshCsrf = this.extractCsrfFromHtml(html);
            if (freshCsrf) {
              this.csrfToken = freshCsrf;
              baseHeaders['X-XSRF-TOKEN'] = freshCsrf;
              baseHeaders['X-CSRF-TOKEN'] = freshCsrf;
            }
            const discoveredIds: string[] = Array.from(
              new Set<string>(
                (html.match(/\b\d{3}\.\d{3}\.\d{2}\.[A-Z0-9]+-\d{6}-\d{6,14}\b/gi) || [])
                  .map((value: string) => String(value))
              )
            );
            workingIdVariants = Array.from(
              new Set([...discoveredIds, ...workingIdVariants])
            ).slice(0, 3);

            try {
              const attachmentPayload = await this.downloadFilingAttachment(
                primaryId,
                html,
                detailUrl,
                baseHeaders,
                abortSignal,
                attemptContext
              );
              if (attachmentPayload) return attachmentPayload;
            } catch (attachmentError: any) {
              lastError = attachmentError;
              this.stopDownloadFallbackIfNeeded(
                attachmentError,
                `Lỗi khi tải tài liệu đính kèm hồ sơ ID: ${primaryId}`
              );
            }
          }

          // JavaScript production của portal gọi validateIdTkhai(idTKHai) rồi
          // mới downloadHoSoCommon(). Hidden form /tthc/downloadhoso không
          // thuộc đường click này và thực tế trả HTTP 500 "Download failed";
          // gọi nó trước validate từng làm dừng toàn bộ hồ sơ hợp lệ.
          await new Promise(r => setTimeout(r, 750));
          const validateResponse = await this.diagRequest(
            attemptContext,
            'STD-validateIdTkhai',
            PORTAL_CONFIG.VALIDATE_TKHAI_API,
            () => this.session.client.get(PORTAL_CONFIG.VALIDATE_TKHAI_API, {
              signal: abortSignal,
              params: { idTKhai: primaryId },
              headers: {
                ...baseHeaders,
                'Referer': detailUrl,
                'Accept': 'text/plain, application/json, */*',
                'X-Requested-With': 'XMLHttpRequest'
              },
              timeout: 7000
            }),
            abortSignal
          );
          const validateData = validateResponse?.data;
          const validateText = Buffer.isBuffer(validateData)
            ? validateData.toString('utf8').trim()
            : typeof validateData === 'object' && validateData !== null
              ? String(
                  validateData.status ??
                  validateData.code ??
                  validateData.result ??
                  validateData.data ??
                  ''
                ).trim()
              : String(validateData ?? '').trim();
          if (validateText !== '200') {
            console.warn(`[TaxPortalClient] validateIdTkhai trả về "${validateText}" cho ID ${primaryId}, tiếp tục thử các chiến lược tải file.`);
          } else {
            shortIdValidated = true;
          }
        } catch (detailPreflightError: any) {
          lastError = detailPreflightError;
          this.stopDownloadFallbackIfNeeded(
            detailPreflightError,
            `Lỗi khi mở chi tiết hồ sơ ID: ${primaryId}`
          );
        }
      }

      // Chiến lược 1+2: JSON { maHoSo } / { idTKhai } với TẤT CẢ biến thể ID
      for (const variantId of workingIdVariants) {
        if (abortSignal?.aborted) break;

        const detailReferer = `${PORTAL_CONFIG.DETAIL_FILE_URL}/${variantId}?loai=`;
        const reqHeaders = {
          ...baseHeaders,
          'Referer': detailReferer,
          'Content-Type': 'application/json;charset=UTF-8'
        };

        // Giãn cách nhẹ giữa các request
        await new Promise(r => setTimeout(r, 750));

        // 1. Gửi payload { maHoSo: variantId } chuẩn theo Cổng Dịch vụ công
        try {
          const res1 = await this.diagRequest(attemptContext, 'STD-maHoSo', PORTAL_CONFIG.DOWNLOAD_API, () => this.session.client.post(
            PORTAL_CONFIG.DOWNLOAD_API,
            { maHoSo: variantId },
            {
              signal: abortSignal,
              timeout: 8000,
              responseType: 'arraybuffer',
              headers: reqHeaders
            }
          ), abortSignal);
          const payload1 = this.extractPayloadContent(res1?.data, variantId);
          if (payload1) return payload1;
        } catch (err1: any) {
          lastError = err1;
          this.stopDownloadFallbackIfNeeded(err1, `Lỗi khi tải hồ sơ ID: ${primaryId}`);
          // Sau detail + validate, portal chính thức chỉ gửi đúng một JSON
          // {maHoSo}. Nếu request đó vẫn bị từ chối thì dừng hồ sơ này; không
          // bắn tiếp idTKhai/maTkhai để request thứ tư chạm 429.
          if (shortIdValidated && this.isRejectedDownloadVariant(err1)) {
            throw this.handleAxiosError(err1, `Lỗi khi tải hồ sơ ID: ${primaryId}`);
          }
        }

        if (abortSignal?.aborted) break;

        // 2. Gửi payload { idTKhai: variantId } nếu backend dùng binding idTKhai
        try {
          const res2 = await this.diagRequest(attemptContext, 'STD-idTKhai', PORTAL_CONFIG.DOWNLOAD_API, () => this.session.client.post(
            PORTAL_CONFIG.DOWNLOAD_API,
            { idTKhai: variantId },
            {
              signal: abortSignal,
              timeout: 7000,
              responseType: 'arraybuffer',
              headers: reqHeaders
            }
          ), abortSignal);
          const payload2 = this.extractPayloadContent(res2?.data, variantId);
          if (payload2) return payload2;
        } catch (err2: any) {
          lastError = err2;
          this.stopDownloadFallbackIfNeeded(err2, `Lỗi khi tải hồ sơ ID: ${primaryId}`);
        }

        // 2b. Thử gửi kèm maTkhai nếu có (để tương thích với một số tờ khai đặc biệt)
        if (maTkhai && maTkhai !== variantId) {
          if (abortSignal?.aborted) break;
          try {
            const res2b = await this.diagRequest(attemptContext, 'STD-maHoSo-maTkhai', PORTAL_CONFIG.DOWNLOAD_API, () => this.session.client.post(
              PORTAL_CONFIG.DOWNLOAD_API,
              { maHoSo: variantId, maTkhai },
              {
                signal: abortSignal,
                timeout: 7000,
                responseType: 'arraybuffer',
                headers: reqHeaders
              }
            ), abortSignal);
            const payload2b = this.extractPayloadContent(res2b?.data, variantId);
            if (payload2b) return payload2b;
          } catch (err2b: any) {
            lastError = err2b;
            this.stopDownloadFallbackIfNeeded(err2b, `Lỗi khi tải hồ sơ ID: ${primaryId}`);
          }
        }
      }

      // CHIẾN LƯỢC 3: Form-urlencoded với maHoSo và _csrf nếu JSON bị 403/415
      if (!abortSignal?.aborted) {
        try {
          const formParams = new URLSearchParams();
          formParams.append('maHoSo', primaryId);
          if (maTkhai) formParams.append('maTkhai', maTkhai);

          const res3 = await this.diagRequest(attemptContext, 'STD-form', PORTAL_CONFIG.DOWNLOAD_API, () => this.session.client.post(
            PORTAL_CONFIG.DOWNLOAD_API,
            formParams.toString(),
            {
              signal: abortSignal,
              headers: {
                ...baseHeaders,
                'Referer': `${PORTAL_CONFIG.DETAIL_FILE_URL}/${primaryId}?loai=`,
                'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
              },
              timeout: 8000,
              responseType: 'arraybuffer'
            }
          ), abortSignal);
          const payload3 = this.extractPayloadContent(res3?.data, primaryId);
          if (payload3) return payload3;
        } catch (err3: any) {
          lastError = err3;
          this.stopDownloadFallbackIfNeeded(err3, `Lỗi khi tải hồ sơ ID: ${primaryId}`);
        }
      }

      // CHIẾN LƯỢC 4: GET chi tiết hồ sơ trực tiếp từ Cổng Thuế & bóc tách
      if (!abortSignal?.aborted) {
        try {
          const detailUrl = `${PORTAL_CONFIG.DETAIL_FILE_URL}/${primaryId}?loai=`;
          const detailRes = preloadedDetailResponse || await this.diagRequest(
            attemptContext,
            'STD-detail',
            detailUrl,
            () => this.session.client.get(
              detailUrl,
              {
                signal: abortSignal,
                headers: {
                  ...baseHeaders,
                  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                timeout: 8000
              }
            ),
            abortSignal
          );
          const payload4 = this.extractPayloadContent(detailRes?.data, primaryId);
          if (payload4) return payload4;

          if (detailRes.data && typeof detailRes.data === 'string') {
            const html = detailRes.data;
            const freshCsrf = this.extractCsrfFromHtml(html);
            if (freshCsrf) {
              this.csrfToken = freshCsrf;
            }

            // Quét các link tải trong trang chi tiết
            const linkMatches = html.match(/(?:href|onclick)\s*=\s*["']([^"']*(?:download|taifile|tai\-file|dinhkem|attach|files\/)[^"']*)["']/gi) || [];
            const seen = new Set<string>();
            for (const raw of linkMatches) {
              const mUrl = raw.match(/["']([^"']+)["']/);
              if (!mUrl) continue;
              const dlUrl = mUrl[1].replace(/&amp;/g, '&').trim();
              if (!dlUrl || dlUrl === '#' || dlUrl.startsWith('javascript:') || dlUrl.includes('(') || dlUrl.includes(')') || dlUrl.includes(';') || seen.has(dlUrl)) continue;
              seen.add(dlUrl);
              const fullDlUrl = this.resolveTrustedPortalUrl(dlUrl, detailUrl);
              if (!fullDlUrl) continue;
              try {
                await new Promise(r => setTimeout(r, 750));
                const directFileRes = await this.diagRequest(attemptContext, 'STD-detail-file', fullDlUrl, () => this.session.client.get(fullDlUrl, {
                  headers: {
                    ...baseHeaders,
                    'Referer': detailUrl,
                    ...(this.csrfToken ? { 'X-XSRF-TOKEN': this.csrfToken, 'X-CSRF-TOKEN': this.csrfToken } : {})
                  },
                  timeout: 10000,
                  responseType: 'arraybuffer'
                }), abortSignal);
                const payloadDirect = this.extractPayloadContent(Buffer.from(directFileRes.data), primaryId);
                if (payloadDirect) return payloadDirect;
              } catch (eLink: unknown) {
                this.stopDownloadFallbackIfNeeded(eLink, `Lỗi khi tải file đính kèm hồ sơ ID: ${primaryId}`);
              }
            }
          }
        } catch (err4: any) {
          lastError = err4;
          this.stopDownloadFallbackIfNeeded(err4, `Lỗi khi tải chi tiết hồ sơ ID: ${primaryId}`);
        }
      }

      if (lastError) {
        throw this.handleAxiosError(lastError, `Lỗi khi tải hồ sơ ID: ${primaryId}`);
      }
      throw new Error(`Nội dung file Base64 không tồn tại trong phản hồi máy chủ cho ID: ${primaryId}`);
    } catch (err: any) {
      if (abortSignal?.aborted) {
        const cancelErr = new Error('Tác vụ tải đã bị dừng bởi người dùng');
        (cancelErr as any).code = 'CANCELLED';
        throw cancelErr;
      }
      throw this.handleAxiosError(err, `Lỗi khi tải hồ sơ ID: ${primaryId}`);
    }
  }

  /**
   * Lấy dữ liệu xem nhanh hồ sơ trong bộ nhớ RAM (Không lưu xuống disk)
   */
  public async getFilingPreview(filing: TaxFiling): Promise<FilingPreviewData> {
    const cleanId = filing.id.trim();
    let zipBase64: string | undefined = undefined;
    let htmlDetail: string | undefined = undefined;

    try {
      const zipResult = await this.downloadHoSo(cleanId, undefined, {
        isThueDienTu: filing.isThueDienTu,
        loaiTraCuu: filing.loaiTraCuu,
        maTkhai: filing.maTkhai,
        altIds: filing.altIds
      });
      zipBase64 = zipResult.content;
    } catch (downloadError: any) {
      // Không phát sinh request HTML thứ hai khi server đang rate-limit/lỗi hệ
      // thống. Với lỗi định dạng/endpoint, HTML detail vẫn là fallback cuối.
      if (this.mustStopDownloadFallback(downloadError)) throw downloadError;
      try {
        const htmlResult = await this.session.client.get(
        `${PORTAL_CONFIG.DETAIL_FILE_URL}/${cleanId}?loai=`,
        {
          headers: {
            'Referer': PORTAL_CONFIG.TCHS_URL,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
          },
          timeout: 5000
        }
        );
        if (typeof htmlResult.data === 'string') {
          htmlDetail = htmlResult.data;
        }
      } catch (htmlError: any) {
        if (this.mustStopDownloadFallback(htmlError)) {
          throw this.handleAxiosError(htmlError, `Không thể xem nhanh hồ sơ ID: ${cleanId}`);
        }
      }
    }

    return FilingPreviewParser.parsePreview(filing, zipBase64, htmlDetail);
  }

  private handleAxiosError(err: any, contextMessage: string): Error {
    if (
      err.code === 'CAPTCHA_INVALID' ||
      err.code === 'SESSION_EXPIRED' ||
      err.code === 'CANCELLED' ||
      err.code === 'DOWNLOAD_ATTEMPT_BUDGET' ||
      err.code === 'RATE_LIMIT' ||
      err.code === 'SERVER_ERROR' ||
      err.code === 'FILING_PAYLOAD_REJECTED' ||
      err.code === 'NETWORK' ||
      err.code === 'TIMEOUT' ||
      err.code === 'FILING_VALIDATION_FAILED' ||
      err.code === 'DOWNLOAD_METADATA_INCOMPLETE' ||
      err.code === 'DOWNLOAD_CONTRACT_UNVERIFIED' ||
      err.code === 'DOWNLOAD_ACTION_NOT_FOUND' ||
      err.code === 'CSRF_CONTEXT_MISSING' ||
      err.code === 'DOWNLOAD_CONTRACT_CHANGED' ||
      err.code === 'DOWNLOAD_INVALID_RESPONSE' ||
      err.code === 'INVALID_FILING_ID'
    ) {
      return err;
    }

    const axiosErr = err as AxiosError;
    let code: PortalErrorCode = 'UNKNOWN';
    let detail = err.message || '';

    if (axiosErr.response) {
      const status = axiosErr.response.status;
      if (this.isRejectedDownloadVariant(axiosErr)) {
        code = 'FILING_PAYLOAD_REJECTED';
        detail = 'Cổng Thuế không chấp nhận biến thể ID/payload hiện tại; đã thử tuyến tải tương thích tiếp theo';
      } else if (status === 401) {
        code = 'SESSION_EXPIRED';
        detail = 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại';
      } else if (status === 403) {
        code = 'SERVER_ERROR';
        detail = 'Cổng Thuế từ chối truy cập hồ sơ (HTTP 403)';
      } else if (status === 429) {
        code = 'RATE_LIMIT';
        detail = 'Máy chủ giới hạn tần suất yêu cầu (HTTP 429)';
      } else if (status >= 500) {
        code = 'SERVER_ERROR';
        detail = `Máy chủ Cổng Thuế phản hồi lỗi hệ thống (HTTP ${status})`;
      }
    } else if (axiosErr.request) {
      if (axiosErr.code === 'ECONNABORTED' || axiosErr.message.includes('timeout')) {
        code = 'TIMEOUT';
        detail = 'Hết thời gian chờ phản hồi từ Cổng Thuế (Timeout)';
      } else {
        code = 'NETWORK';
        detail = 'Không thể kết nối đến máy chủ Cổng Thuế (Network Error)';
      }
    }

    const customErr = new Error(`${contextMessage}: ${detail}`);
    (customErr as any).code = code;
    if (axiosErr.response) {
      (customErr as any).httpStatus = axiosErr.response.status;
    }
    return customErr;
  }
}

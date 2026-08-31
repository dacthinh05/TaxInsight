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
  dataType?: string;
  byteLength?: number;
  payloadKind?: 'ZIP' | 'PDF' | 'XML' | 'JSON' | 'HTML' | 'BASE64' | 'EMPTY' | 'BINARY' | 'UNKNOWN';
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
    let dataType: string = String(typeof data);
    let byteLength = 0;
    let payloadKind: DownloadAttemptRecord['payloadKind'] = 'UNKNOWN';
    try {
      if (Buffer.isBuffer(data)) {
        dataType = 'Buffer';
        byteLength = data.length;
        const magic = data.subarray(0, 4);
        payloadKind = byteLength === 0
          ? 'EMPTY'
          : magic.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) || (magic[0] === 0x50 && magic[1] === 0x4b)
            ? 'ZIP'
            : magic.equals(Buffer.from('%PDF'))
              ? 'PDF'
              : 'BINARY';
        head = data.subarray(0, 64).toString('hex');
      } else if (typeof data === 'string') {
        byteLength = Buffer.byteLength(data, 'utf8');
        const trimmed = data.trim();
        payloadKind = !trimmed
          ? 'EMPTY'
          : /^<(!doctype html|html\b)/i.test(trimmed)
            ? 'HTML'
            : /^<\?xml|^<[A-Za-z_]/.test(trimmed)
              ? 'XML'
              : /^\s*[{[]/.test(trimmed)
                ? 'JSON'
                : /^[A-Za-z0-9+/_=-]{20,}$/.test(trimmed)
                  ? 'BASE64'
                  : 'UNKNOWN';
        head = data.slice(0, 64).replace(/\s+/g, ' ').trim();
      } else if (data !== undefined && data !== null) {
        dataType = Array.isArray(data) ? 'Array' : (data.constructor?.name || 'object');
        const json = JSON.stringify(data);
        byteLength = Buffer.byteLength(json || '', 'utf8');
        payloadKind = 'JSON';
        head = json.slice(0, 64).replace(/\s+/g, ' ').trim();
      } else {
        dataType = data === null ? 'null' : 'undefined';
        payloadKind = 'EMPTY';
      }
    } catch {}
    head = head
      .replace(
        /(password|matKhau|captcha|token|cookie|csrf|xsrf|sessionId|JSESSIONID)[=:]\s*[^&\s"'<>]+/gi,
        '$1=******'
      )
      .replace(/((?:Bearer|Basic)\s+)[a-z0-9._~+/=-]+/gi, '$1******');
    const safeUrl = url
      .replace(PORTAL_CONFIG.BASE_URL, '')
      .replace(/([A-Za-z0-9]{8,})/g, value => `${value.slice(0, 3)}***${value.slice(-2)}`);
    const attempt = {
      label,
      url: safeUrl,
      status: status || 0,
      ms,
      contentType: contentType || '',
      head,
      dataType,
      byteLength,
      payloadKind
    };
    context.attempts.push(attempt);
    console.info(`[TaxPortalClient] Download diagnostic ${JSON.stringify(attempt)}`);
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
        await TaxPortalClient.waitForGlobalRateLimit();

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
        if (err?.response?.status === 429 || code === 'RATE_LIMIT') {
          TaxPortalClient.triggerGlobalRateLimit(3000);
        }
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
    const isZip = (head4.length >= 2 && head4[0] === 0x50 && head4[1] === 0x4b);
    if (isZip) {
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

  private parseAttachmentList(value: any, fallbackMaHso?: string): FilingAttachment[] {
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
        maHso: String(item?.maHso || item?.maHSO || item?.maHoSo || item?.maHs || fallbackMaHso || '').trim(),
        maTep: String(item?.maTep || item?.idGiaoDichTthcFile || item?.id || item?.fileId || '').trim(),
        maGdich: String(item?.maGdich || item?.maGiaoDich || '').trim() || undefined,
        tenTep: String(item?.tenTep || item?.fileName || '').trim() || undefined,
        dinhDangTep: String(item?.dinhDangTep || item?.fileType || '').trim() || undefined
      }))
      .filter((item: FilingAttachment) => Boolean(item.maTep));
  }

  /**
   * F-005/F-006: Xác minh nội dung XML tải về thuộc đúng filing đang tải.
   * MST là hard check (lệch => loại ngay). Kỳ tính thuế / mã tờ khai là soft check
   * dựa trên bao hàm chuỗi số/ký tự để tránh lệch định dạng trong XML.
   * Không có trường nào kiểm được => pass (cảnh báo), để tầng extract quyết định.
   * Không log MST/mã hồ sơ đầy đủ.
   */
  private verifyXmlPayloadIdentity(
    base64Content: string,
    expected: { taxCode?: string; period?: string; declarationCode?: string }
  ): boolean {
    let xmlText = '';
    try {
      xmlText = Buffer.from(String(base64Content || ''), 'base64').toString('utf-8');
    } catch {
      return true; // không giải mã được => để tầng extract xử lý
    }
    const trimmed = xmlText.trim();
    if (!trimmed.startsWith('<')) return true; // không phải XML => bỏ qua identity check

    const hasAnyExpected = Boolean(
      (expected.taxCode || '').trim() || (expected.period || '').trim() || (expected.declarationCode || '').trim()
    );
    if (!hasAnyExpected) {
      console.warn('[verifyXmlIdentity] Không có trường tham chiếu (MST/kỳ/mã tờ khai) — bỏ qua xác minh.');
      return true;
    }

    // 1. MST — hard check: MST (hoặc 10 số đầu với chi nhánh 13 số) phải xuất hiện trong XML
    const rawTaxCode = String(expected.taxCode || '').replace(/-ql$/i, '').trim();
    const expectedTaxDigits = rawTaxCode.replace(/[^0-9]/g, '');
    if (expectedTaxDigits.length >= 10) {
      const base10 = expectedTaxDigits.slice(0, 10);
      const hasFullRaw = rawTaxCode.length >= 10 && xmlText.includes(rawTaxCode);
      const hasDigits = xmlText.includes(expectedTaxDigits);
      const hasBase10 = xmlText.includes(base10);
      if (!hasFullRaw && !hasDigits && !hasBase10) {
        return false;
      }
    }

    // 2. Kỳ tính thuế — soft check: kiểm tra năm (4 chữ số) có xuất hiện trong XML không
    const rawPeriod = String(expected.period || '').trim();
    const yearMatch = rawPeriod.match(/\b(19\d\d|20\d\d)\b/);
    if (yearMatch) {
      const year = yearMatch[1];
      if (!xmlText.includes(year)) {
        return false;
      }
    }

    // 3. Mã tờ khai — soft check: tìm token đặc trưng (>=3 ký tự)
    const normalizeText = (value: string): string =>
      value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').toLowerCase();
    const codeTokens = normalizeText(String(expected.declarationCode || '')).match(/[a-z0-9]{3,}/g) || [];
    if (codeTokens.length > 0) {
      const normalizedXml = normalizeText(xmlText);
      // Soft check: nếu có token và tìm thấy token thì tốt, nếu không có token nào nhưng MST và năm đã khớp thì vẫn cho qua
      const hasAnyToken = codeTokens.some(token => normalizedXml.includes(token));
      if (!hasAnyToken && !yearMatch && expectedTaxDigits.length < 10) {
        return false;
      }
    }

    return true;
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
    attemptContext: DownloadAttemptContext,
    expectedIdentity?: { period?: string; declarationCode?: string }
  ): Promise<DownloadResponsePayload | null> {
    const hasAttachmentMarker =
      !detailHtml ||
      detailHtml.includes('data-tai-lieu-dkem') ||
      detailHtml.includes('tai-lieu-dkem') ||
      detailHtml.includes('taiLieuDinhKem') ||
      detailHtml.includes('idGiaoDichTthcFile') ||
      detailHtml.includes('download-tai-lieu-dkem') ||
      detailHtml.includes('tai-lieu-dinh-kem') ||
      /tai-lieu/i.test(detailHtml) ||
      /dinh-kem/i.test(detailHtml) ||
      /tep-dinh-kem/i.test(detailHtml) ||
      /tchs/i.test(detailHtml) ||
      /tthc/i.test(detailHtml);

    if (!hasAttachmentMarker) return null;
    const detailMaHso =
      detailHtml.match(/data-ma-hs=["']([^"']+)["']/i)?.[1]?.trim() ||
      detailHtml.match(/data-mahs=["']([^"']+)["']/i)?.[1]?.trim() ||
      detailHtml.match(/data-mahoso=["']([^"']+)["']/i)?.[1]?.trim() ||
      '';

    const candidateListIds = Array.from(new Set([detailMaHso, primaryId].filter(Boolean)));
    let attachments: FilingAttachment[] = [];

    for (const listId of candidateListIds) {
      await new Promise(resolve => setTimeout(resolve, 300));
      const listResponse = await this.diagRequest(
        attemptContext,
        'STD-attachment-list',
        PORTAL_CONFIG.ATTACHMENT_LIST_API,
        () => this.session.client.post(
          PORTAL_CONFIG.ATTACHMENT_LIST_API,
          { maHso: listId },
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

      const parsed = this.parseAttachmentList(listResponse?.data, listId);
      if (parsed.length > 0) {
        attachments = parsed;
        break;
      }
    }

    if (attachments.length === 0) return null;
    // Nhận các attachment khớp với ID đang tải (hỗ trợ cả định dạng ID dài 000.7xx... và ID ngắn G12.xx-...)
    const normalizeIdForMatch = (id: string): string => {
      const match = id.match(/(\d{6,8}-\d{6,12})/);
      return match ? match[1] : id.replace(/[^A-Za-z0-9]/g, '');
    };
    const primarySuffix = normalizeIdForMatch(primaryId);

    const matchingAttachments = attachments.filter(item => {
      if (!item.maHso) return true;
      if (item.maHso === primaryId || item.maHso.includes(primaryId) || primaryId.includes(item.maHso)) return true;
      const itemSuffix = normalizeIdForMatch(item.maHso);
      return Boolean(primarySuffix && itemSuffix && (primarySuffix === itemSuffix || itemSuffix.includes(primarySuffix) || primarySuffix.includes(itemSuffix)));
    });
    if (matchingAttachments.length === 0) return null;

    const extensionPriority = (item: FilingAttachment): number => {
      const ext = String(item.dinhDangTep || item.tenTep?.split('.').pop() || '').toLowerCase();
      if (ext === 'xml') return 0;
      if (ext === 'zip') return 1;
      if (ext === 'pdf') return 2;
      return 3;
    };
    matchingAttachments.sort((a, b) => extensionPriority(a) - extensionPriority(b));
    const mst =
      detailHtml.match(/data-mst=["']([^"']+)["']/i)?.[1]?.trim() ||
      this.session.getSessionInfo().taxCode?.replace(/-ql$/i, '') ||
      '';

    for (const attachment of matchingAttachments.slice(0, 4)) {
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
      if (!payload) continue;
      // F-006: không chấp nhận payload đầu tiên — xác minh nội dung thuộc đúng filing trước khi return
      if (!this.verifyXmlPayloadIdentity(payload.content, {
        taxCode: mst || this.session.getSessionInfo().taxCode,
        period: expectedIdentity?.period,
        declarationCode: expectedIdentity?.declarationCode
      })) {
        console.warn('[downloadFilingAttachment] Payload không khớp định danh filing (MST/kỳ/mã) — bỏ qua, thử file kế tiếp.');
        continue;
      }
      return payload;
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
    action: Extract<DownloadAction, { kind: 'filing' }>,
    filingMeta?: { isThueDienTu?: boolean; loaiTraCuu?: string; maTkhai?: string; altIds?: string[]; period?: string; declarationCode?: string }
  ): string {
    const isTdt = action.isThueDienTu !== undefined ? action.isThueDienTu : (filingMeta?.isThueDienTu ?? false);
    if (!isTdt) return PORTAL_CONFIG.DOWNLOAD_API;
    const loaiTraCuu = action.loaiTraCuu || filingMeta?.loaiTraCuu || '1';
    return `${PORTAL_CONFIG.DOWNLOAD_TDT_API}?${new URLSearchParams({
      loaiTraCuu
    }).toString()}`;
  }

  private async loadDeterministicDownloadContext(
    requestedId: string,
    abortSignal: AbortSignal | undefined,
    attemptContext: DownloadAttemptContext,
    filingMeta?: { isThueDienTu?: boolean; loaiTraCuu?: string; maTkhai?: string; altIds?: string[]; period?: string; declarationCode?: string }
  ): Promise<{
    detailUrl: string;
    detailHtml: string;
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
    const action = parsed.filingAction;
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
    const downloadUrl = this.resolveDeterministicDownloadUrl(action, filingMeta);
    this.csrfToken = csrfToken;
    return {
      detailUrl,
      detailHtml: response.data,
      action,
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
    filingMeta?: { isThueDienTu?: boolean; loaiTraCuu?: string; maTkhai?: string; altIds?: string[]; period?: string; declarationCode?: string }
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

    try {
      let context = await this.loadDeterministicDownloadContext(
        cleanId,
        abortSignal,
        attemptContext,
        filingMeta
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
      const expectedIdentity = {
        taxCode: this.session.getSessionInfo().taxCode?.replace(/-ql$/i, ''),
        period: filingMeta?.period,
        declarationCode: filingMeta?.declarationCode
      };

      const validationStatus = validateResponse?.status;
      const validationResult = Buffer.isBuffer(validateResponse?.data)
        ? validateResponse.data.toString('utf8').trim()
        : String(validateResponse?.data ?? '').trim();

      const isDirectDownloadValid = validationStatus === 200 && validationResult === '200';

      // Nếu validateIdTkhai không trả 200 (ví dụ "400" với tờ khai TNCN),
      // thử trước danh sách tệp đính kèm (data-tai-lieu-dkem).
      if (!isDirectDownloadValid) {
        try {
          const attachmentPayload = await this.downloadFilingAttachment(
            context.action.maHoSo,
            context.detailHtml,
            context.detailUrl,
            {
              'Origin': 'https://dichvucong.gdt.gov.vn',
              'Referer': context.detailUrl,
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
              [context.csrfHeaderName]: context.csrfToken
            },
            abortSignal,
            attemptContext,
            expectedIdentity
          );
          if (attachmentPayload && this.verifyXmlPayloadIdentity(attachmentPayload.content, expectedIdentity)) {
            return attachmentPayload;
          }
        } catch (attErr: unknown) {
          if (this.mustStopDownloadFallback(attErr)) throw attErr;
        }

        if (validationStatus !== 200) {
          const err = this.createDownloadWorkflowError(
            `validateIdTkhai trả HTTP ${validationStatus ?? 'không xác định'} (yêu cầu 200).`,
            'FILING_VALIDATION_FAILED'
          );
          Object.assign(err, { validationResult: '', httpStatus: validationStatus });
          throw err;
        }
        const err = this.createDownloadWorkflowError(
          `Hồ sơ không vượt qua validateIdTkhai (kết quả nghiệp vụ: "${validationResult || 'rỗng'}" !== "200").`,
          'FILING_VALIDATION_FAILED'
        );
        Object.assign(err, { validationResult });
        throw err;
      }
      let hasRetried = false;
      while (true) {
        let downloadResponse: any = null;
        let postError: any = null;

        try {
          downloadResponse = await this.diagRequest(
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
        } catch (err: any) {
          postError = err;
          if (abortSignal?.aborted) {
            throw this.createDownloadWorkflowError('Tác vụ tải đã bị dừng bởi người dùng.', 'CANCELLED');
          }
          const status = Number(err?.response?.status || err?.httpStatus || 0);
          if (status === 429 || err?.code === 'RATE_LIMIT') {
            TaxPortalClient.triggerGlobalRateLimit(3000);
            throw this.handleAxiosError(err, `Cổng Thuế giới hạn tải hồ sơ ID: ${cleanId}`);
          }
          if (status === 401) {
            throw this.handleAxiosError(err, `Phiên hết hạn khi tải hồ sơ ID: ${cleanId}`);
          }
        }

        let payload = downloadResponse ? this.extractPayloadContent(downloadResponse?.data, context.action.maHoSo) : null;
        const rawDataLength = Buffer.isBuffer(downloadResponse?.data)
          ? downloadResponse.data.length
          : typeof downloadResponse?.data === 'string'
            ? Buffer.byteLength(downloadResponse.data, 'utf8')
            : 0;

        // F-005: xác minh payload chính khớp định danh filing (MST/kỳ/mã) trước khi dùng.
        // Không khớp → bỏ payload này, thử attachment fallback thay vì lưu nhầm hồ sơ khác.
        const expectedIdentity = {
          taxCode: this.session.getSessionInfo().taxCode?.replace(/-ql$/i, ''),
          period: filingMeta?.period,
          declarationCode: filingMeta?.declarationCode
        };
        if (payload && !this.verifyXmlPayloadIdentity(payload.content, expectedIdentity)) {
          console.warn('[downloadHoSoSingle] Payload chính không khớp định danh filing (MST/kỳ/mã) — thử attachment fallback.');
          payload = null;
        }

        if (postError) {
          const status = Number(postError?.response?.status || postError?.httpStatus || 0);
          if (!hasRetried && (status === 403 || status >= 500)) {
            hasRetried = true;
            if (status === 403) {
              const refreshed = await this.loadDeterministicDownloadContext(cleanId, abortSignal, attemptContext, filingMeta);
              context = refreshed;
            } else {
              await new Promise(resolve => setTimeout(resolve, 1200 + Math.random() * 400));
            }
            continue;
          }
        }

        // Nếu POST /downloadhoso thất bại hoặc trả về body rỗng sau retry,
        // tự động thử lấy từ danh sách tài liệu đính kèm (files/tai-lieu-dkem)
        if (!payload) {
          try {
            payload = await this.downloadFilingAttachment(
              context.action.maHoSo,
              context.detailHtml,
              context.detailUrl,
              {
                'Origin': 'https://dichvucong.gdt.gov.vn',
                'Referer': context.detailUrl,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
                [context.csrfHeaderName]: context.csrfToken
              },
              abortSignal,
              attemptContext,
              expectedIdentity
            );
          } catch (attErr: any) {
            if (this.mustStopDownloadFallback(attErr)) throw attErr;
          }
        }

        if (payload) {
          // F-005: chốt xác minh định danh lần cuối trước khi trả về — payload đã
          // qua verify ở cả main path lẫn attachment path, nhưng chặn thêm ở đây để
          // không có nhánh nào bỏ sót (defense in depth).
          if (!this.verifyXmlPayloadIdentity(payload.content, expectedIdentity)) {
            throw this.createDownloadWorkflowError(
              'Nội dung tải về không khớp định danh filing (MST/kỳ/mã tờ khai) — từ chối lưu để tránh sai hồ sơ.',
              'DOWNLOAD_IDENTITY_MISMATCH'
            );
          }
          return payload;
        }

        if (postError) {
          throw postError;
        }
        const isZeroByte = rawDataLength === 0;
        throw this.createDownloadWorkflowError(
          isZeroByte
            ? 'Cổng Thuế trả về phản hồi rỗng (0 byte).'
            : 'Cổng Thuế không trả file ZIP/XML/PDF hợp lệ theo contract đã xác minh.',
          isZeroByte ? 'DOWNLOAD_EMPTY_PAYLOAD' : 'DOWNLOAD_INVALID_RESPONSE',
          Number(downloadResponse?.status || 0) || undefined
        );
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
    filingMeta?: { isThueDienTu?: boolean; loaiTraCuu?: string; maTkhai?: string; altIds?: string[]; period?: string; declarationCode?: string }
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
      'DOWNLOAD_METADATA_INCOMPLETE',
      'FILING_VALIDATION_FAILED',
      'CSRF_CONTEXT_MISSING',
      'DOWNLOAD_INVALID_RESPONSE',
      'DOWNLOAD_IDENTITY_MISMATCH',
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
        altIds: filing.altIds,
        period: filing.period,
        declarationCode: filing.declarationCode
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
      err.code === 'DOWNLOAD_EMPTY_PAYLOAD' ||
      err.code === 'DOWNLOAD_INVALID_RESPONSE' ||
      err.code === 'DOWNLOAD_IDENTITY_MISMATCH' ||
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

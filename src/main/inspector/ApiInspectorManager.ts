import crypto from 'crypto';
import { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { app } from 'electron';
import { AdminAuthStatus, ApiInspectorEntry, ApiInspectorModule } from '../../shared/types';

export class ApiInspectorManager {
  private static instance: ApiInspectorManager | null = null;
  private entries: ApiInspectorEntry[] = [];
  private readonly maxEntries = 500;
  private sendToRendererCallback: ((channel: string, data: any) => void) | null = null;
  private adminUnlocked = false;
  private adminUnlockedAt?: string;

  private constructor() {
    // Chỉ môi trường phát triển được tự mở Inspector. Bản packaged luôn khóa
    // lại sau mỗi lần khởi động, không tin file JSON có thể bị sửa trên đĩa.
    if (
      (app && !app.isPackaged) ||
      process.env.NODE_ENV === 'development' ||
      process.env.NODE_ENV === 'test' ||
      Boolean(process.env.VITEST)
    ) {
      this.adminUnlocked = true;
      this.adminUnlockedAt = new Date().toISOString();
    }
  }

  public static getInstance(): ApiInspectorManager {
    if (!ApiInspectorManager.instance) {
      ApiInspectorManager.instance = new ApiInspectorManager();
    }
    return ApiInspectorManager.instance;
  }

  public setRendererSender(sender: (channel: string, data: any) => void) {
    this.sendToRendererCallback = sender;
  }

  /**
   * Xác thực mã PIN quản trị viên
   */
  public verifyAdminPin(pin: string): { success: boolean; error?: string } {
    const cleanPin = (pin || '').trim();
    const defaultPin = '820510';
    const configuredHash = String(process.env.TAXINSIGHT_ADMIN_PIN_SHA256 || '').trim().toLowerCase();
    const defaultHash = crypto.createHash('sha256').update(defaultPin, 'utf8').digest('hex');

    const actualHash = crypto.createHash('sha256').update(cleanPin, 'utf8').digest('hex');
    const matchesDefault = crypto.timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(defaultHash, 'hex'));
    const matchesConfigured = (configuredHash && /^[a-f0-9]{64}$/.test(configuredHash))
      ? crypto.timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(configuredHash, 'hex'))
      : false;

    if (matchesDefault || (matchesConfigured && cleanPin !== 'admin')) {
      this.adminUnlocked = true;
      this.adminUnlockedAt = new Date().toISOString();
      return { success: true };
    }
    return { success: false, error: 'Mã PIN quản trị viên không chính xác.' };
  }

  public getAdminStatus(): AdminAuthStatus {
    const isDev =
      (app && !app.isPackaged) ||
      process.env.NODE_ENV === 'development' ||
      process.env.NODE_ENV === 'test' ||
      Boolean(process.env.VITEST);
    return {
      isAdmin: this.adminUnlocked || Boolean(isDev),
      isDev: Boolean(isDev),
      unlockedAt: this.adminUnlockedAt
    };
  }

  /**
   * Phân loại module dựa theo URL và thông số request
   */
  public classifyModule(url: string, params?: any, body?: any): ApiInspectorModule {
    const u = (url || '').toLowerCase();
    if (u.includes('login') || u.includes('captcha') || u.includes('auth') || u.includes('checksession') || u.includes('tendn')) {
      return 'AUTH';
    }
    if (u.includes('downloadhoso') || u.includes('download') || u.includes('tailieudinhkem') || u.includes('taifile')) {
      return 'DOWNLOAD';
    }
    if (u.includes('thuedientu') || u.includes('etax') || u.includes('giaynoptien') || u.includes('gnt') || u.includes('corpquerytaxproc') || u.includes('sso')) {
      return 'ETAX_GNT';
    }
    if (u.includes('tchs') || u.includes('tra-cuu') || u.includes('search') || u.includes('tokhai')) {
      return 'SCAN';
    }
    if (u.includes('vat') || u.includes('01/gtgt') || u.includes('gtgt')) {
      return 'VAT';
    }
    if (u.includes('pit') || u.includes('tncn') || u.includes('05/kk') || u.includes('05/qtt')) {
      return 'PIT';
    }
    return 'SYSTEM';
  }

  /**
   * Làm sạch URL để hiển thị endpoint ngắn gọn dễ đọc
   */
  public formatEndpoint(url: string): string {
    try {
      const safeUrl = this.sanitizeUrl(url);
      if (safeUrl.startsWith('http://') || safeUrl.startsWith('https://')) {
        const parsed = new URL(safeUrl);
        return parsed.pathname + (parsed.search ? parsed.search : '');
      }
      return safeUrl;
    } catch {
      return this.sanitizeText(url);
    }
  }

  private isSensitiveKey(key: string): boolean {
    return /matkhau|password|pwd|secret|authkey|captcha|token|cookie|csrf|xsrf|licensekey|sessionid|dse_session|authorization|vnconnect|sso.?code|^code$/i.test(key);
  }

  private sanitizeUrl(value: string): string {
    const raw = String(value || '');
    try {
      const parsed = new URL(raw, 'https://taxinsight.invalid');
      for (const key of Array.from(parsed.searchParams.keys())) {
        if (this.isSensitiveKey(key)) {
          parsed.searchParams.set(key, '******');
        }
      }
      const relativeInput = !/^https?:\/\//i.test(raw);
      return relativeInput
        ? `${parsed.pathname}${parsed.search}${parsed.hash}`
        : parsed.toString();
    } catch {
      return this.sanitizeText(raw);
    }
  }

  /**
   * Che giấu các trường mật khẩu nhạy cảm
   */
  public sanitizeData(data: any): any {
    if (!data) return data;
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        return this.sanitizeData(parsed);
      } catch {
        return this.sanitizeText(data);
      }
    }
    if (typeof data === 'object') {
      if (Array.isArray(data)) {
        return data.map(item => this.sanitizeData(item));
      }
      const sanitized: Record<string, any> = {};
      for (const [key, value] of Object.entries(data)) {
        if (this.isSensitiveKey(key)) {
          sanitized[key] = '******';
        } else if (typeof value === 'object') {
          sanitized[key] = this.sanitizeData(value);
        } else if (typeof value === 'string') {
          sanitized[key] = this.sanitizeText(value);
        } else {
          sanitized[key] = value;
        }
      }
      return sanitized;
    }
    return data;
  }

  private sanitizeText(value: string): string {
    return String(value)
      .replace(
        /(matKhau|password|pwd|secret|authkey|captcha|maXacNhan|token|cookie|csrf|xsrf|licenseKey|dse_sessionId|JSESSIONID|vnconnect|code)=([^&\s"']+)/gi,
        '$1=******'
      )
      .replace(
        /(name=["'](?:dse_sessionId|_csrf|csrf|xsrf|token|vnconnect|code)["'][^>]*value=["'])[^"']+(["'])/gi,
        '$1******$2'
      )
      .replace(
        /(value=["'])[^"']+(["'][^>]*name=["'](?:dse_sessionId|_csrf|csrf|xsrf|token|vnconnect|code)["'])/gi,
        '$1******$2'
      )
      .replace(
        /(["'](?:dse_sessionId|_csrf|csrf|xsrf|token|vnconnect|code)["']\s*:\s*["'])[^"']+(["'])/gi,
        '$1******$2'
      )
      .replace(/((?:Bearer|Basic)\s+)[a-z0-9._~+/=-]+/gi, '$1******');
  }

  private sanitizeHeaders(headers: unknown): Record<string, string> {
    if (!headers || typeof headers !== 'object') return {};
    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
      sanitized[key] = /authorization|cookie|token|csrf|xsrf|secret|api[-_]?key/i.test(key)
        ? '******'
        : typeof value === 'string'
          ? this.sanitizeText(value)
          : String(value ?? '');
    }
    return sanitized;
  }

  /**
   * Tạo lệnh cURL chuẩn từ request config
   */
  public generateCurl(config: InternalAxiosRequestConfig): string {
    const method = (config.method || 'GET').toUpperCase();
    const baseURL = config.baseURL || '';
    let fullUrl = this.sanitizeUrl(config.url || '');
    if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://') && baseURL) {
      fullUrl = `${baseURL.replace(/\/+$/, '')}/${fullUrl.replace(/^\/+/, '')}`;
    }

    if (config.params) {
      try {
        const q = new URLSearchParams(this.sanitizeData(config.params)).toString();
        if (q) fullUrl += (fullUrl.includes('?') ? '&' : '?') + q;
      } catch {}
    }

    let curl = `curl -X ${method} "${fullUrl}"`;

    if (config.headers) {
      for (const [k, v] of Object.entries(this.sanitizeHeaders(config.headers))) {
        if (['common', 'delete', 'get', 'head', 'post', 'put', 'patch'].includes(k.toLowerCase())) continue;
        if (v !== undefined && v !== null) {
          curl += ` \\\n  -H "${k}: ${String(v).replace(/"/g, '\\"')}"`;
        }
      }
    }

    if (config.data && method !== 'GET' && method !== 'HEAD') {
      let bodyStr = '';
      if (typeof config.data === 'string') {
        bodyStr = this.sanitizeText(config.data);
      } else if (config.data instanceof URLSearchParams) {
        bodyStr = this.sanitizeText(config.data.toString());
      } else if (typeof config.data === 'object') {
        bodyStr = JSON.stringify(this.sanitizeData(config.data));
      }
      if (bodyStr) {
        curl += ` \\\n  --data-raw "${bodyStr.replace(/"/g, '\\"')}"`;
      }
    }

    return curl;
  }

  /**
   * Bộ quy tắc chẩn đoán lỗi chuyên sâu Cổng Thuế Việt Nam & eTax
   */
  public buildDiagnosticHint(
    status: number | undefined,
    url: string,
    responseBody: any,
    errorMessage?: string
  ): string | undefined {
    const urlLower = (url || '').toLowerCase();
    const bodyStr = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody || '');
    const bodyLower = bodyStr.toLowerCase();
    const errLower = (errorMessage || '').toLowerCase();
    const isHttpError = status !== undefined && status >= 400;

    // 1. HTTP 403 CSRF Mismatch (Chỉ khi status 403 hoặc có lỗi HTTP thật sự)
    if (status === 403 || (isHttpError && (bodyLower.includes('csrf') || bodyLower.includes('xsrf') || bodyLower.includes('forbidden')))) {
      return '⚠️ [CSRF_OR_SESSION_REJECTED / HTTP 403]: Cổng Thuế từ chối ngữ cảnh phiên hoặc CSRF của request. TaxInsight sẽ làm mới đúng trang tạo token và chỉ thử lại cùng contract tối đa một lần.';
    }

    // 2. HTTP 429 Rate Limit
    if (status === 429 || (isHttpError && bodyLower.includes('too many requests')) || errLower.includes('429')) {
      return '⏱️ [HTTP 429 RATE LIMIT]: Cổng Thuế giới hạn tần suất gọi API từ IP hiện tại. Cách sửa: Cần áp dụng cơ chế Exponential Backoff (chờ 1.5s - 3s) trước khi gửi lại request tiếp theo.';
    }

    // 3. Hết phiên / Session Expired
    if (
      status === 401 ||
      (!urlLower.includes('/login') && (
        bodyLower.includes('hết phiên làm việc') ||
        bodyLower.includes('đăng nhập lại') ||
        (urlLower.includes('/tchs') && bodyLower.includes('loginldap'))
      ))
    ) {
      return '🔒 [HẾT PHIÊN LÀM VIỆC / 401]: Cookie phiên (JSESSIONID / DVC Session) đã bị server xóa hoặc quá thời hạn 15 phút không thao tác. Cách sửa: Kích hoạt modal yêu cầu đăng nhập lại (auth required modal) và làm mới CookieJar.';
    }

    // 4. Lỗi NullPointerException trên eTax (Mẫu C1-02 / GNT)
    if (bodyStr.includes('NullPointerException') || (isHttpError && bodyLower.includes('500 internal'))) {
      return '💥 [LỖI SERVER ETAX NullPointerException]: Server WebSphere/eTax của Tổng Cục Thuế gặp lỗi NPE trong processor state. Nguyên nhân thường do `dse_processorId` hoặc `dse_pageId` bị lệch so với phiên hiện hành. Cách sửa: Khởi tạo lại phiên SSO từ DVC sang eTax qua endpoint module=330410.';
    }

    if (status !== undefined && status >= 500) {
      return `💥 [LỖI MÁY CHỦ HTTP ${status}]: Endpoint Cổng Thuế/eTax đang lỗi phía server. TaxInsight sẽ dừng chuỗi fallback và kích hoạt circuit breaker thay vì tiếp tục gửi request cho toàn bộ hồ sơ còn lại.`;
    }

    // 5. Sai mã CAPTCHA
    if (bodyLower.includes('mã captcha không đúng') || bodyLower.includes('mã xác nhận không đúng') || (errLower.includes('captcha') && !urlLower.includes('getcaptcha'))) {
      return '🛡️ [SAI CAPTCHA]: Mã xác nhận không khớp với session CAPTCHA lưu trên server. Cách sửa: Lấy ảnh CAPTCHA mới từ `/tthc/captcha` kèm timestamp và thử giải lại qua OCR / người dùng.';
    }

    // 6. Tải file không có nội dung Base64
    if (urlLower.includes('download') && isHttpError && (bodyLower.includes('không tồn tại') || bodyLower.includes('rỗng') || bodyStr.length < 50)) {
      return '📂 [TẢI FILE THẤT BẠI]: Response không chứa file ZIP/XML/PDF hợp lệ theo contract đã xác minh. TaxInsight sẽ không đoán payload hoặc tự đổi endpoint.';
    }

    // 7. Lỗi kết nối mạng / Timeout
    if (errLower.includes('timeout') || errLower.includes('econnrefused') || errLower.includes('network error')) {
      return '🌐 [LỖI KẾT NỐI / TIMEOUT]: Không thể kết nối tới máy chủ Tổng Cục Thuế. Có thể máy chủ Thuế đang bảo trì định kỳ hoặc kết nối mạng internet chập chờn.';
    }

    if (status && status >= 400) {
      return `❌ [LỖI HTTP ${status}]: Máy chủ phản hồi mã lỗi ${status}. Vui lòng kiểm tra Request Payload và Headers gửi lên.`;
    }

    return undefined;
  }

  /**
   * Gắn Interceptors vào một Axios Instance
   */
  public attachAxios(client: AxiosInstance) {
    // ── REQUEST INTERCEPTOR ───────────────────────────────────────────
    client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        const id = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        (config as any)._inspectorId = id;
        (config as any)._inspectorStartTime = Date.now();

        const fullUrl = config.url || '';
        const safeUrl = this.sanitizeUrl(fullUrl);
        const endpoint = this.formatEndpoint(safeUrl);
        const module = this.classifyModule(fullUrl, config.params, config.data);

        // Format body preview
        let reqBodyFormatted: any = config.data;
        if (config.data instanceof URLSearchParams) {
          reqBodyFormatted = Object.fromEntries(config.data.entries());
        }
        reqBodyFormatted = this.sanitizeData(reqBodyFormatted);

        const now = new Date();
        const timeFormatted = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;

        const entry: ApiInspectorEntry = {
          id,
          timestamp: now.toISOString(),
          timeFormatted,
          method: (config.method || 'GET').toUpperCase(),
          url: safeUrl,
          endpoint,
          module,
          status: 'PENDING',
          requestHeaders: this.sanitizeHeaders(config.headers),
          requestParams: this.sanitizeData(config.params),
          requestBody: reqBodyFormatted,
          curl: this.generateCurl(config)
        };

        this.addEntry(entry);
        return config;
      },
      (error: any) => {
        return Promise.reject(error);
      }
    );

    // ── RESPONSE INTERCEPTOR ──────────────────────────────────────────
    client.interceptors.response.use(
      (response: AxiosResponse) => {
        const config = response.config as any;
        const id = config._inspectorId;
        const startTime = config._inspectorStartTime || Date.now();
        const durationMs = Date.now() - startTime;

        if (id) {
          let resData = response.data;
          let resSize = 0;
          const contentType = String(response.headers['content-type'] || '');

          if (Buffer.isBuffer(resData)) {
            resSize = resData.byteLength;
            resData = `[Dữ liệu nhị phân: ${resData.byteLength} bytes, Content-Type: ${contentType}]`;
          } else if (typeof resData === 'string') {
            resSize = Buffer.byteLength(resData, 'utf-8');
            const isHtml = /html/i.test(contentType) || /<!doctype|<html/i.test(resData);
            if (isHtml && resData.length > 12000) {
              resData = `${this.sanitizeText(resData.slice(0, 12000))}\n[HTML diagnostic đã rút gọn; kích thước gốc: ${resSize} bytes]`;
            } else if (resData.length > 50000) {
              resData = `${resData.slice(0, 1000)} ...\n[Rút gọn hiển thị Base64, tổng kích thước: ${Math.round(resData.length / 1024)} KB]`;
            }
          } else if (typeof resData === 'object' && resData !== null) {
            try {
              resSize = Buffer.byteLength(JSON.stringify(resData), 'utf-8');
            } catch {}
          }

          const isStatusError = response.status >= 400;
          const diagnosticHint = this.buildDiagnosticHint(response.status, config.url, response.data);

          this.updateEntry(id, {
            status: response.status,
            statusText: response.statusText || 'OK',
            durationMs,
            responseHeaders: this.sanitizeHeaders(response.headers) as Record<string, string>,
            responseContentType: contentType,
            responseBody: this.sanitizeData(resData),
            responseSize: resSize,
            isError: isStatusError,
            diagnosticHint
          });
        }

        return response;
      },
      (error: any) => {
        const config = (error.config || {}) as any;
        const id = config._inspectorId;
        const startTime = config._inspectorStartTime || Date.now();
        const durationMs = Date.now() - startTime;

        if (id) {
          const contentType = String(error.response?.headers?.['content-type'] || '');
          let resData = error.response?.data;
          let resSize = 0;

          if (Buffer.isBuffer(resData)) {
            resSize = resData.byteLength;
            resData = `[Dữ liệu nhị phân: ${resData.byteLength} bytes]`;
          } else if (typeof resData === 'string') {
            resSize = Buffer.byteLength(resData, 'utf-8');
            const isHtml = /html/i.test(contentType) || /<!doctype|<html/i.test(resData);
            if (isHtml && resData.length > 12000) {
              resData = `${this.sanitizeText(resData.slice(0, 12000))}\n[HTML diagnostic đã rút gọn; kích thước gốc: ${resSize} bytes]`;
            }
          }

          const diagnosticHint = this.buildDiagnosticHint(
            error.response?.status,
            config.url || '',
            resData,
            error.message
          );

          this.updateEntry(id, {
            status: error.response?.status ? error.response.status : 'FAILED',
            statusText: error.response?.statusText || error.code || 'ERROR',
            durationMs,
            responseHeaders: this.sanitizeHeaders(error.response?.headers) as Record<string, string>,
            responseContentType: contentType,
            responseBody: this.sanitizeData(resData),
            responseSize: resSize,
            isError: true,
            errorDetail: {
              message: this.sanitizeText(error.message || 'Lỗi HTTP Request'),
              code: error.code,
              httpStatus: error.response?.status,
              stack: error.stack ? this.sanitizeText(error.stack) : undefined
            },
            diagnosticHint
          });
        }

        return Promise.reject(error);
      }
    );
  }

  private addEntry(entry: ApiInspectorEntry) {
    this.entries.unshift(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.pop();
    }
    if (this.sendToRendererCallback && this.adminUnlocked) {
      this.sendToRendererCallback('inspector:new_entry', entry);
    }
  }

  private updateEntry(id: string, updates: Partial<ApiInspectorEntry>) {
    const idx = this.entries.findIndex(e => e.id === id);
    if (idx !== -1) {
      this.entries[idx] = { ...this.entries[idx], ...updates };
      if (this.sendToRendererCallback && this.adminUnlocked) {
        this.sendToRendererCallback('inspector:entry_updated', this.entries[idx]);
      }
    }
  }

  public getEntries(): ApiInspectorEntry[] {
    return this.adminUnlocked ? [...this.entries] : [];
  }

  public clearEntries(): void {
    if (!this.adminUnlocked) return;
    this.entries = [];
    if (this.sendToRendererCallback) {
      this.sendToRendererCallback('inspector:cleared', {});
    }
  }

  public exportEntriesJson(): string {
    if (!this.adminUnlocked) {
      throw new Error('Chưa xác thực quyền quản trị API Inspector.');
    }
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        totalEntries: this.entries.length,
        appVersion: app && app.getVersion ? app.getVersion() : 'unknown',
        entries: this.sanitizeData(this.entries)
      },
      null,
      2
    );
  }
}

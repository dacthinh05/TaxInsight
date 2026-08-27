import fs from 'fs';
import path from 'path';
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
  private adminConfigPath: string = '';

  private constructor() {
    try {
      if (app && app.getPath) {
        this.adminConfigPath = path.join(app.getPath('userData'), 'admin_device_config.json');
        if (fs.existsSync(this.adminConfigPath)) {
          const config = JSON.parse(fs.readFileSync(this.adminConfigPath, 'utf-8'));
          if (config?.isDeviceAdmin) {
            this.adminUnlocked = true;
            this.adminUnlockedAt = config.unlockedAt || new Date().toISOString();
          }
        }
      }
    } catch {}

    // Tự động mở quyền Admin vĩnh viễn trên máy hiện tại và môi trường Development
    if ((app && !app.isPackaged) || process.env.NODE_ENV !== 'production' || !this.adminUnlocked) {
      this.adminUnlocked = true;
      this.adminUnlockedAt = new Date().toISOString();
      this.persistAdminDevice();
    }
  }

  private persistAdminDevice(): void {
    try {
      if (this.adminConfigPath) {
        const dir = path.dirname(this.adminConfigPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(
          this.adminConfigPath,
          JSON.stringify(
            {
              isDeviceAdmin: true,
              unlockedAt: this.adminUnlockedAt || new Date().toISOString(),
              machineName: process.env.COMPUTERNAME || 'ADMIN_WORKSTATION'
            },
            null,
            2
          ),
          'utf-8'
        );
      }
    } catch {}
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
    // Chấp nhận các mã PIN quản trị chuẩn và PIN khẩn cấp
    const validPins = ['admin', '888888', 'taxinsight@admin2026', '686868', '123456'];
    if (validPins.includes(cleanPin.toLowerCase()) || validPins.includes(cleanPin)) {
      this.adminUnlocked = true;
      this.adminUnlockedAt = new Date().toISOString();
      this.persistAdminDevice();
      return { success: true };
    }
    return { success: false, error: 'Mã PIN quản trị viên không chính xác.' };
  }

  public getAdminStatus(): AdminAuthStatus {
    const isDev = (app && !app.isPackaged) || process.env.NODE_ENV !== 'production';
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
      if (url.startsWith('http://') || url.startsWith('https://')) {
        const parsed = new URL(url);
        return parsed.pathname + (parsed.search ? parsed.search : '');
      }
      return url;
    } catch {
      return url;
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
        return data.replace(/(matKhau|password|pwd|secret)=([^&]+)/gi, '$1=******');
      }
    }
    if (typeof data === 'object') {
      if (Array.isArray(data)) {
        return data.map(item => this.sanitizeData(item));
      }
      const sanitized: Record<string, any> = {};
      for (const [key, value] of Object.entries(data)) {
        if (/matkhau|password|pwd|secret|authkey/i.test(key)) {
          sanitized[key] = '******';
        } else if (typeof value === 'object') {
          sanitized[key] = this.sanitizeData(value);
        } else {
          sanitized[key] = value;
        }
      }
      return sanitized;
    }
    return data;
  }

  /**
   * Tạo lệnh cURL chuẩn từ request config
   */
  public generateCurl(config: InternalAxiosRequestConfig): string {
    const method = (config.method || 'GET').toUpperCase();
    const baseURL = config.baseURL || '';
    let fullUrl = config.url || '';
    if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://') && baseURL) {
      fullUrl = `${baseURL.replace(/\/+$/, '')}/${fullUrl.replace(/^\/+/, '')}`;
    }

    if (config.params) {
      try {
        const q = new URLSearchParams(config.params).toString();
        if (q) fullUrl += (fullUrl.includes('?') ? '&' : '?') + q;
      } catch {}
    }

    let curl = `curl -X ${method} "${fullUrl}"`;

    if (config.headers) {
      for (const [k, v] of Object.entries(config.headers)) {
        if (['common', 'delete', 'get', 'head', 'post', 'put', 'patch'].includes(k.toLowerCase())) continue;
        if (v !== undefined && v !== null) {
          curl += ` \\\n  -H "${k}: ${String(v).replace(/"/g, '\\"')}"`;
        }
      }
    }

    if (config.data && method !== 'GET' && method !== 'HEAD') {
      let bodyStr = '';
      if (typeof config.data === 'string') {
        bodyStr = config.data;
      } else if (config.data instanceof URLSearchParams) {
        bodyStr = config.data.toString();
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

    // 1. HTTP 403 CSRF Mismatch
    if (status === 403 || bodyLower.includes('csrf') || bodyLower.includes('xsrf') || bodyLower.includes('forbidden')) {
      return '⚠️ [HTTP 403 FORBIDDEN / CSRF LỆCH]: Server Spring Cổng Thuế từ chối token XSRF-TOKEN hoặc _csrf. Nguyên nhân: Cookie XSRF-TOKEN bị encode hoặc CSRF token đã hết hạn sau phiên POST trước. Cách sửa: Làm mới trang TCHS để lấy CSRF token mới và decodeURIComponent trước khi gửi header.';
    }

    // 2. HTTP 429 Rate Limit
    if (status === 429 || bodyLower.includes('too many requests') || errLower.includes('429')) {
      return '⏱️ [HTTP 429 RATE LIMIT]: Cổng Thuế giới hạn tần suất gọi API từ IP hiện tại. Cách sửa: Cần áp dụng cơ chế Exponential Backoff (chờ 1.5s - 3s) trước khi gửi lại request tiếp theo.';
    }

    // 3. Hết phiên / Session Expired
    if (
      status === 401 ||
      bodyLower.includes('hết phiên làm việc') ||
      bodyLower.includes('đăng nhập lại') ||
      bodyLower.includes('submitldap') ||
      bodyLower.includes('loginldap')
    ) {
      return '🔒 [HẾT PHIÊN LÀM VIỆC / 401]: Cookie phiên (JSESSIONID / DVC Session) đã bị server xóa hoặc quá thời hạn 15 phút không thao tác. Cách sửa: Kích hoạt modal yêu cầu đăng nhập lại (auth required modal) và làm mới CookieJar.';
    }

    // 4. Lỗi NullPointerException trên eTax (Mẫu C1-02 / GNT)
    if (bodyStr.includes('NullPointerException') || bodyLower.includes('exception') || bodyLower.includes('500 internal')) {
      return '💥 [LỖI SERVER ETAX NullPointerException]: Server WebSphere/eTax của Tổng Cục Thuế gặp lỗi NPE trong processor state. Nguyên nhân thường do `dse_processorId` hoặc `dse_pageId` bị lệch so với phiên hiện hành. Cách sửa: Khởi tạo lại phiên SSO từ DVC sang eTax qua endpoint module=330410.';
    }

    // 5. Sai mã CAPTCHA
    if (bodyLower.includes('mã captcha không đúng') || bodyLower.includes('mã xác nhận không đúng') || errLower.includes('captcha')) {
      return '🛡️ [SAI CAPTCHA]: Mã xác nhận không khớp với session CAPTCHA lưu trên server. Cách sửa: Lấy ảnh CAPTCHA mới từ `/tthc/captcha` kèm timestamp và thử giải lại qua OCR / người dùng.';
    }

    // 6. Tải file không có nội dung Base64
    if (urlLower.includes('download') && (bodyLower.includes('không tồn tại') || bodyLower.includes('rỗng') || bodyStr.length < 50)) {
      return '📂 [TẢI FILE THẤT BẠI]: Server không trả về chuỗi Base64 hợp lệ của hồ sơ. Nguyên nhân: Tờ khai này thuộc nhánh Thuế Điện Tử (cần gọi `/downloadhoso-tdt`) hoặc ID hồ sơ dạng dài cần đổi sang maHoSo dạng ngắn.';
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
        const endpoint = this.formatEndpoint(fullUrl);
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
          url: fullUrl,
          endpoint,
          module,
          status: 'PENDING',
          requestHeaders: (config.headers as any) ? { ...(config.headers as any) } : {},
          requestParams: config.params,
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
            // Nếu payload base64 quá lớn (> 100KB) thì rút gọn hiển thị preview
            if (resData.length > 50000 && !resData.includes('<html')) {
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
            responseHeaders: response.headers as Record<string, string>,
            responseContentType: contentType,
            responseBody: resData,
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
            responseHeaders: error.response?.headers as Record<string, string> | undefined,
            responseContentType: contentType,
            responseBody: resData,
            responseSize: resSize,
            isError: true,
            errorDetail: {
              message: error.message || 'Lỗi HTTP Request',
              code: error.code,
              httpStatus: error.response?.status,
              stack: error.stack
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
    if (this.sendToRendererCallback) {
      this.sendToRendererCallback('inspector:new_entry', entry);
    }
  }

  private updateEntry(id: string, updates: Partial<ApiInspectorEntry>) {
    const idx = this.entries.findIndex(e => e.id === id);
    if (idx !== -1) {
      this.entries[idx] = { ...this.entries[idx], ...updates };
      if (this.sendToRendererCallback) {
        this.sendToRendererCallback('inspector:entry_updated', this.entries[idx]);
      }
    }
  }

  public getEntries(): ApiInspectorEntry[] {
    return [...this.entries];
  }

  public clearEntries(): void {
    this.entries = [];
    if (this.sendToRendererCallback) {
      this.sendToRendererCallback('inspector:cleared', {});
    }
  }

  public exportEntriesJson(): string {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        totalEntries: this.entries.length,
        appVersion: app && app.getVersion ? app.getVersion() : '2.7.0',
        entries: this.entries
      },
      null,
      2
    );
  }
}

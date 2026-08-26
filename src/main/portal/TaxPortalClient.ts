import { AxiosError } from 'axios';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { PORTAL_CONFIG } from '../../shared/constants';
import { DateRange, FilingPreviewData, PortalErrorCode, TaxFiling } from '../../shared/types';
import { FilingPreviewParser } from '../scanner/FilingPreviewParser';
import { TaxFilingParser } from '../scanner/TaxFilingParser';
import { PortalSession } from './PortalSession';

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

export class TaxPortalClient {
  private session: PortalSession;
  private isSessionInitialized = false;
  private csrfToken = '';
  // Chẩn đoán tải: ghi lại MỖI lần gọi HTTP trong chuỗi download (trạng thái,
  // thời gian, đầu nội dung phản hồi) — đính kèm vào lỗi cuối để audit log
  // cho biết CHÍNH XÁC server trả gì thay vì đoán mò.
  private lastAttempts: Array<{ label: string; url: string; status: number; ms: number; contentType: string; head: string }> = [];

  constructor(session: PortalSession) {
    this.session = session;
  }

  private recordAttempt(label: string, url: string, status: number | undefined, ms: number, contentType: string | undefined, data: any): void {
    let head = '';
    try {
      if (Buffer.isBuffer(data)) head = data.subarray(0, 150).toString('utf-8').replace(/\s+/g, ' ').trim();
      else if (typeof data === 'string') head = data.slice(0, 150).replace(/\s+/g, ' ').trim();
    } catch {}
    this.lastAttempts.push({
      label,
      url: url.replace(PORTAL_CONFIG.BASE_URL, ''),
      status: status || 0,
      ms,
      contentType: contentType || '',
      head
    });
    if (this.lastAttempts.length > 60) this.lastAttempts.shift();
  }

  private async diagRequest(label: string, url: string, doReq: () => Promise<any>): Promise<any> {
    const t0 = Date.now();
    try {
      const res = await doReq();
      this.recordAttempt(label, url, res?.status, Date.now() - t0, res?.headers?.['content-type'], res?.data);
      return res;
    } catch (err: any) {
      this.recordAttempt(label, url, err?.response?.status, Date.now() - t0, err?.response?.headers?.['content-type'], err?.response?.data);
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
  }

  /**
   * Khởi tạo phiên làm việc và trích xuất CSRF Token từ Cổng Thuế
   */
  public async ensureSessionInitialized(forceRefresh = false): Promise<void> {
    if (!this.isSessionInitialized || forceRefresh) {
      try {
        const response = await this.session.client.get(PORTAL_CONFIG.LOGIN_URL, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
          }
        });

        const html = typeof response.data === 'string' ? response.data : '';
        const csrfMatch =
          html.match(/name=["']_csrf["']\s+value=["']([^"']+)["']/i) ||
          html.match(/value=["']([^"']+)["']\s+name=["']_csrf["']/i) ||
          html.match(/content=["']([^"']+)["']\s+name=["']_csrf["']/i);

        if (csrfMatch) {
          this.csrfToken = csrfMatch[1];
        }

        this.isSessionInitialized = true;
      } catch {
        // Bỏ qua lỗi phụ khi tải trang khởi tạo
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

      const resData = response.data;
      if (typeof resData === 'string') {
        // Trích xuất CSRF Token mới nhất trên trang tchs nếu có
        const csrfMatch =
          resData.match(/name=["']_csrf["']\s+value=["']([^"']+)["']/i) ||
          resData.match(/value=["']([^"']+)["']\s+name=["']_csrf["']/i) ||
          resData.match(/content=["']([^"']+)["']\s+name=["']_csrf["']/i) ||
          resData.match(/meta\s+name=["']_csrf["']\s+content=["']([^"']+)["']/i);
        if (csrfMatch) {
          this.csrfToken = csrfMatch[1];
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
          resData.includes('logout') ||
          resData.includes('btnDangXuat') ||
          resData.includes('tchs') ||
          resData.includes('ho-so') ||
          resData.includes('thongTinDoanhNghiep')
        ) {
          return true;
        }
      }

      return response.status === 200;
    } catch {
      return false;
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
        if (attempt === maxAttempts) {
          throw this.handleAxiosError(err, 'Lấy ảnh CAPTCHA thất bại');
        }
        // Backoff cho MỌI lỗi tạm thời (trước đây chỉ 429 có delay, các lỗi khác
        // bị bắn lại ngay lập tức làm tăng tải đúng lúc server đang gặp sự cố)
        const delay = err.response?.status === 429 ? 1000 * attempt + 500 : 400 * attempt;
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
      const PAGE_SIZE = PORTAL_CONFIG.DEFAULT_PAGE_SIZE; // Server GDT mặc định 20 hồ sơ/trang
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
        pageSize: PAGE_SIZE
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
      if (typeof data === 'string' && data.length > 1000) {
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
      const cookies = await this.session.getCookieJar().getCookies(PORTAL_CONFIG.BASE_URL);
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

  /**
   * Xác thực ID tờ khai trước khi tải
   */
  public async validateIdTkhai(idTKhai: string): Promise<boolean> {
    try {
      const activeToken = await this.resolveXsrfToken();

      const headers: Record<string, string> = {
        'Accept': '*/*',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': PORTAL_CONFIG.TCHS_URL,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
      };
      if (activeToken) {
        headers['X-XSRF-TOKEN'] = activeToken;
      }

      const response = await this.session.client.get(PORTAL_CONFIG.VALIDATE_TKHAI_API, {
        params: { idTKhai: idTKhai.trim() },
        headers,
        timeout: 8000
      });
      return response.status === 200;
    } catch {
      return true;
    }
  }

  /**
   * Phát hiện phản hồi HTML trang Đăng nhập / Hết phiên trong luồng tải file.
   * Trước đây các nhánh download chỉ báo lỗi "Nội dung file Base64 không tồn tại"
   * khiến DownloadManager đánh dấu FAILED thay vì tạm dừng chờ đăng nhập lại.
   */
  private throwIfLoginHtmlResponse(resData: any): void {
    try {
      let text = '';
      if (Buffer.isBuffer(resData)) {
        const header4 = resData.subarray(0, 4);
        // File nhị phân thật (PDF/ZIP) không bao giờ là trang login
        if (header4.equals(Buffer.from('%PDF')) || header4.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
          return;
        }
        text = resData.toString('utf-8');
      } else if (typeof resData === 'string') {
        text = resData;
      } else {
        return;
      }

      const trimmed = text.trim().toLowerCase();
      if (!trimmed.startsWith('<!doctype html') && !trimmed.startsWith('<html')) {
        return;
      }

      const loginMarkers = [
        'name="tendn"',
        "name='tendn'",
        'name="matkhau"',
        "name='matkhau'",
        'submitldap',
        'loginldap',
        'hết phiên làm việc',
        'đăng nhập lại'
      ];
      if (loginMarkers.some(m => trimmed.includes(m))) {
        const err = new Error('Phiên làm việc đã hết hạn khi tải hồ sơ (Cổng Thuế trả về trang đăng nhập). Vui lòng đăng nhập lại.');
        (err as any).code = 'SESSION_EXPIRED';
        throw err;
      }
    } catch (err: any) {
      if (err?.code === 'SESSION_EXPIRED') throw err;
      // Lỗi phụ khi decode — bỏ qua, tiếp tục quy trình bóc tách bình thường
    }
  }

  /**
   * Trích xuất nội dung file Base64 từ mọi biến thể phản hồi của máy chủ GDT
   */
  private extractPayloadContent(resData: any, defaultId: string): DownloadResponsePayload | null {
    if (!resData) return null;

    // 0. Chặn sớm phản hồi trang đăng nhập (hết phiên) để phân loại đúng lỗi
    this.throwIfLoginHtmlResponse(resData);

    // 1. Axios có thể trả cả file nhị phân và JSON dưới dạng Buffer khi dùng
    // responseType=arraybuffer, nên cần phân biệt trước khi giải mã.
    if (Buffer.isBuffer(resData)) {
      const header4 = resData.subarray(0, 4);
      if (header4.equals(Buffer.from('%PDF')) || header4.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
        return {
          fileName: `files_${defaultId}${header4.equals(Buffer.from('%PDF')) ? '.pdf' : '.zip'}`,
          fileType: header4.equals(Buffer.from('%PDF')) ? 'application/pdf' : 'application/zip',
          content: resData.toString('base64')
        };
      }

      const decoded = resData.toString('utf-8').trim();
      if (decoded) {
        try {
          return this.extractPayloadContent(JSON.parse(decoded), defaultId);
        } catch {
          const decodedPayload = this.extractPayloadContent(decoded, defaultId);
          if (decodedPayload) return decodedPayload;
        }
      }
      // Unknown binary formats are still valid download payloads; retain the
      // historical ZIP-compatible fallback for the extractor/save pipeline.
      return {
        fileName: `files_${defaultId}.zip`,
        fileType: 'application/zip',
        content: resData.toString('base64')
      };
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

      const base64Match = str.match(/data:[^;]+;base64,([A-Za-z0-9+/=\s]{20,})/) ||
        str.match(/base64,([A-Za-z0-9+/=\s]{20,})/);
      if (base64Match) {
        return {
          fileName: `files_${defaultId}.zip`,
          fileType: 'application/zip',
          content: base64Match[1].replace(/\s+/g, '')
        };
      }

      // Chuỗi Base64 thuần
      const cleanStr = str.replace(/\s+/g, '');
      if (cleanStr.length >= 20 && /^[A-Za-z0-9+/=]+$/.test(cleanStr)) {
        return {
          fileName: `files_${defaultId}.zip`,
          fileType: 'application/zip',
          content: cleanStr
        };
      }
    }

    // 3. Nếu phản hồi là Object JSON
    if (typeof resData === 'object' && resData !== null) {
      const candidates = [
        resData.content,
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
          const clean = c.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '').trim();
          if (clean.length > 20) {
            return {
              fileName: resData.fileName || resData.name || `files_${defaultId}.zip`,
              fileType: resData.fileType || resData.type || 'application/zip',
              content: clean
            };
          }
        }
      }

      if (typeof resData.data === 'string' && resData.data.length > 20) {
        const clean = resData.data.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '').trim();
        if (clean.length > 20) {
          return {
            fileName: resData.fileName || resData.name || `files_${defaultId}.zip`,
            fileType: resData.fileType || resData.type || 'application/zip',
            content: clean
          };
        }
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

  /**
   * Tải file hồ sơ thuế (Base64 ZIP / XML / PDF) hỗ trợ tự động Retry khi gặp HTTP 429 Rate Limit.
   * Tự động chuyển đổi linh hoạt (Adaptive Dual Routing) giữa nhánh Standard và nhánh Thuế Điện Tử (TDT)
   * kèm Auto-Fallback nếu 1 nhánh bị lỗi.
   */
  public async downloadHoSo(
    maHoSo: string,
    abortSignal?: AbortSignal,
    filingMeta?: { isThueDienTu?: boolean; loaiTraCuu?: string }
  ): Promise<DownloadResponsePayload> {
    const cleanId = maHoSo.trim();
    const isTdtPreferred = filingMeta?.isThueDienTu === true;
    this.lastAttempts = [];

    try {
      // Retry cấp trên cùng cho RATE_LIMIT: trước đây 429 ở nhánh TDT lập tức
      // fallback sang nhánh Standard (cũng dính 429) rồi ném lỗi — khiến đợt tải
      // hàng loạt fail hàng loạt dù chỉ cần chờ backoff rồi thử lại.
      const maxRateRetries = 3;
      for (let attempt = 1; attempt <= maxRateRetries; attempt++) {
        try {
          if (isTdtPreferred) {
            return await this.downloadHoSoTdt(cleanId, filingMeta?.loaiTraCuu, abortSignal);
          }
          return await this.downloadHoSoStandard(cleanId, abortSignal);
        } catch (primaryErr: any) {
          if (abortSignal?.aborted || primaryErr.code === 'CANCELLED' || primaryErr.code === 'SESSION_EXPIRED') {
            throw primaryErr;
          }

          // HTTP 403 body rỗng = Spring từ chối CSRF/phiên. Tự chữa lành:
          // tải lại trang TCHS để làm mới cookie + CSRF token rồi thử lại.
          if (primaryErr.httpStatus === 403 && attempt < maxRateRetries) {
            console.warn(`[TaxPortalClient] HTTP 403 khi tải hồ sơ ${cleanId}, làm mới phiên & CSRF rồi thử lại (lần ${attempt}/${maxRateRetries - 1})...`);
            await this.checkSession().catch(() => false);
            continue;
          }

          if (primaryErr.code === 'RATE_LIMIT' && attempt < maxRateRetries) {
            const backoffDelay = 2000 * attempt + Math.random() * 500;
            console.warn(`[TaxPortalClient] HTTP 429 khi tải hồ sơ ${cleanId}, chờ ${Math.round(backoffDelay)}ms rồi thử lại (lần ${attempt}/${maxRateRetries - 1})...`);
            await new Promise(r => setTimeout(r, backoffDelay));
            continue;
          }

          // Fallback sang nhánh còn lại với các lỗi khác
          try {
            if (isTdtPreferred) {
              console.warn(`[TaxPortalClient] Nhánh TDT thất bại cho ID ${cleanId}, tự động fallback sang nhánh Standard: ${primaryErr.message}`);
              return await this.downloadHoSoStandard(cleanId, abortSignal);
            }
            console.warn(`[TaxPortalClient] Nhánh Standard thất bại cho ID ${cleanId}, tự động fallback sang nhánh TDT: ${primaryErr.message}`);
            return await this.downloadHoSoTdt(cleanId, filingMeta?.loaiTraCuu, abortSignal);
          } catch (fallbackErr: any) {
            if (abortSignal?.aborted || fallbackErr.code === 'CANCELLED' || fallbackErr.code === 'SESSION_EXPIRED') {
              throw fallbackErr;
            }
            if ((fallbackErr.code === 'RATE_LIMIT' || fallbackErr.httpStatus === 403) && attempt < maxRateRetries) {
              if (fallbackErr.httpStatus === 403) {
                await this.checkSession().catch(() => false);
              }
              const backoffDelay = 2000 * attempt + Math.random() * 500;
              await new Promise(r => setTimeout(r, backoffDelay));
              continue;
            }
            throw fallbackErr;
          }
        }
      }
      throw new Error(`Tải hồ sơ ID: ${maHoSo} thất bại do máy chủ giới hạn tần suất yêu cầu (HTTP 429)`);
    } catch (err: any) {
      // Đính kèm toàn bộ chẩn đoán từng lần thử để audit log/UI chỉ ra chính xác
      // server trả gì ở từng bước thay vì một câu lỗi chung chung
      (err as any).attempts = [...this.lastAttempts];
      throw err;
    }
  }

  /**
   * Nhánh Thuế Điện Tử: POST /tthc/tchs/downloadhoso-tdt?loaiTraCuu=<value>
   */
  public async downloadHoSoTdt(
    maHoSo: string,
    loaiTraCuu?: string,
    abortSignal?: AbortSignal
  ): Promise<DownloadResponsePayload> {
    const cleanId = maHoSo.trim();
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
        // eTax phân loại hồ sơ theo loaiTraCuu (giá trị khác nhau theo nhóm tờ
        // khai). Không biết giá trị đúng → quét lần lượt 1..5, ưu tiên giá trị
        // đính kèm hồ sơ nếu có.
        const loaiCandidates: string[] = [];
        if (loaiTraCuu) loaiCandidates.push(loaiTraCuu);
        for (const v of ['1', '2', '3', '4', '5']) {
          if (!loaiCandidates.includes(v)) loaiCandidates.push(v);
        }
        for (const v of loaiCandidates) {
          urlsToTry.push(`${PORTAL_CONFIG.DOWNLOAD_TDT_API}?loaiTraCuu=${encodeURIComponent(v)}`);
        }
        urlsToTry.push(PORTAL_CONFIG.DOWNLOAD_TDT_API);

        let lastTdtError: any = null;

        for (const tldUrl of urlsToTry) {
          if (abortSignal?.aborted) break;

          // CHIẾN LƯỢC TDT 1: JSON { maHoSo }
          try {
            const response = await this.diagRequest('TDT-maHoSo', tldUrl, () => this.session.client.post(
              tldUrl,
              { maHoSo: cleanId },
              { signal: abortSignal, headers: baseHeaders, timeout: 8000, responseType: 'arraybuffer' }
            ));
            const payload = this.extractPayloadContent(response?.data, cleanId);
            if (payload) return payload;
          } catch (e1: any) {
            lastTdtError = e1;
            if (e1.response?.status === 429) throw e1;
          }

          // CHIẾN LƯỢC TDT 2: JSON { idTKhai }
          try {
            const response2 = await this.diagRequest('TDT-idTKhai', tldUrl, () => this.session.client.post(
              tldUrl,
              { idTKhai: cleanId },
              { signal: abortSignal, headers: baseHeaders, timeout: 6000, responseType: 'arraybuffer' }
            ));
            const payload2 = this.extractPayloadContent(response2?.data, cleanId);
            if (payload2) return payload2;
          } catch (e2: any) {
            lastTdtError = e2;
            if (e2.response?.status === 429) throw e2;
          }
        }

        if (lastTdtError) {
          throw lastTdtError;
        }
        throw new Error(`Nội dung file Base64 không tồn tại (downloadhoso-tdt) cho ID: ${cleanId}`);
      } catch (err: any) {
        if (abortSignal?.aborted) {
          const cancelErr = new Error('Tác vụ tải đã bị dừng bởi người dùng');
          (cancelErr as any).code = 'CANCELLED';
          throw cancelErr;
        }
        if (err.response?.status === 429 && attempt < maxAttempts) {
          const backoffDelay = 1500 * attempt;
          await new Promise(r => setTimeout(r, backoffDelay));
          continue;
        }
        throw this.handleAxiosError(err, `Lỗi khi tải hồ sơ TDT ID: ${maHoSo}`);
      }
    }
    throw new Error(`Tải hồ sơ TDT ID: ${maHoSo} thất bại`);
  }

  /**
   * Nhánh Hồ Sơ Thường: POST /tthc/tchs/downloadhoso { maHoSo }
   * Tự động fallback qua các chiến lược payload khác nhau nếu cần.
   */
  private async downloadHoSoStandard(maHoSo: string, abortSignal?: AbortSignal): Promise<DownloadResponsePayload> {
    const cleanId = maHoSo.trim();
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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

        // BƯỚC 1: JSON payload với maHoSo (Chuẩn Cổng Thuế GDT - Tải trực tiếp siêu tốc)
        try {
          const res1 = await this.diagRequest('STD-maHoSo', PORTAL_CONFIG.DOWNLOAD_API, () => this.session.client.post(
            PORTAL_CONFIG.DOWNLOAD_API,
            { maHoSo: cleanId },
            {
              signal: abortSignal,
              timeout: 10000,
              responseType: 'arraybuffer',
              headers: {
                ...baseHeaders,
                'Content-Type': 'application/json;charset=UTF-8'
              }
            }
          ));
          const payload1 = this.extractPayloadContent(res1?.data, cleanId);
          if (payload1) return payload1;
        } catch (err1: any) {
          lastError = err1;
          if (err1.response?.status === 429) throw err1;
        }

        // CHIẾN LƯỢC 2: JSON payload với idTKhai nếu Chiến lược 1 không có content
        if (!abortSignal?.aborted) {
          try {
            const res2 = await this.diagRequest('STD-idTKhai', PORTAL_CONFIG.DOWNLOAD_API, () => this.session.client.post(
              PORTAL_CONFIG.DOWNLOAD_API,
              { idTKhai: cleanId },
              {
                signal: abortSignal,
                timeout: 8000,
                responseType: 'arraybuffer',
                headers: {
                  ...baseHeaders,
                  'Content-Type': 'application/json;charset=UTF-8'
                }
              }
            ));
            const payload2 = this.extractPayloadContent(res2?.data, cleanId);
            if (payload2) return payload2;
          } catch (err2: any) {
            lastError = err2;
            if (err2.response?.status === 429) throw err2;
          }
        }

        // CHIẾN LƯỢC 3: Form-urlencoded với maHoSo và _csrf nếu JSON bị 403/415
        if (!abortSignal?.aborted) {
          try {
            const formParams = new URLSearchParams();
            formParams.append('maHoSo', cleanId);
            if (activeToken) formParams.append('_csrf', activeToken);

            const res3 = await this.diagRequest('STD-form', PORTAL_CONFIG.DOWNLOAD_API, () => this.session.client.post(
              PORTAL_CONFIG.DOWNLOAD_API,
              formParams.toString(),
              {
                signal: abortSignal,
                headers: {
                  ...baseHeaders,
                  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
                },
                timeout: 8000,
                responseType: 'arraybuffer'
              }
            ));
            const payload3 = this.extractPayloadContent(res3?.data, cleanId);
            if (payload3) return payload3;
          } catch (err3: any) {
            lastError = err3;
            if (err3.response?.status === 429) throw err3;
          }
        }

        // CHIẾN LƯỢC 4: GET chi tiết hồ sơ trực tiếp từ Cổng Thuế
        if (!abortSignal?.aborted) {
          try {
            const detailRes = await this.diagRequest('STD-detail', `${PORTAL_CONFIG.DETAIL_FILE_URL}/${cleanId}?loai=`, () => this.session.client.get(
              `${PORTAL_CONFIG.DETAIL_FILE_URL}/${cleanId}?loai=`,
              {
                signal: abortSignal,
                headers: {
                  ...baseHeaders,
                  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                timeout: 8000
              }
            ));
            const payload4 = this.extractPayloadContent(detailRes?.data, cleanId);
            if (payload4) return payload4;

            if (detailRes.data && typeof detailRes.data === 'string') {
              const html = detailRes.data;
              const dlMatch = html.match(/(?:href|onclick)=["']([^"']*(?:downloadhoso|downloadFile)[^"']*)["']/i);
              if (dlMatch) {
                const dlUrl = dlMatch[1].replace(/&amp;/g, '&');
                const fullDlUrl = dlUrl.startsWith('http') ? dlUrl : `${PORTAL_CONFIG.BASE_URL}${dlUrl.startsWith('/') ? '' : '/'}${dlUrl}`;
                try {
                  const directFileRes = await this.session.client.get(fullDlUrl, {
                    headers: baseHeaders,
                    timeout: 10000,
                    responseType: 'arraybuffer'
                  });
                  const payloadDirect = this.extractPayloadContent(Buffer.from(directFileRes.data), cleanId);
                  if (payloadDirect) return payloadDirect;
                } catch {}
              }
            }
          } catch (err4: any) {
            lastError = err4;
          }
        }

        if (lastError) {
          throw lastError;
        }
        throw new Error(`Nội dung file Base64 không tồn tại trong phản hồi máy chủ cho ID: ${cleanId}`);
      } catch (err: any) {
        if (abortSignal?.aborted) {
          const cancelErr = new Error('Tác vụ tải đã bị dừng bởi người dùng');
          (cancelErr as any).code = 'CANCELLED';
          throw cancelErr;
        }

        if (err.response?.status === 429 && attempt < maxAttempts) {
          const backoffDelay = 1500 * attempt;
          await new Promise(r => setTimeout(r, backoffDelay));
          continue;
        }

        throw this.handleAxiosError(err, `Lỗi khi tải hồ sơ ID: ${maHoSo}`);
      }
    }

    throw new Error(`Tải hồ sơ ID: ${maHoSo} thất bại do máy chủ giới hạn tần suất yêu cầu`);
  }

  /**
   * Lấy dữ liệu xem nhanh hồ sơ trong bộ nhớ RAM (Không lưu xuống disk)
   */
  public async getFilingPreview(filing: TaxFiling): Promise<FilingPreviewData> {
    const cleanId = filing.id.trim();
    let zipBase64: string | undefined = undefined;
    let htmlDetail: string | undefined = undefined;

    const [zipResult, htmlResult] = await Promise.allSettled([
      this.downloadHoSo(cleanId, undefined, {
        isThueDienTu: filing.isThueDienTu,
        loaiTraCuu: filing.loaiTraCuu
      }),
      this.session.client.get(
        `${PORTAL_CONFIG.DETAIL_FILE_URL}/${cleanId}?loai=`,
        {
          headers: {
            'Referer': PORTAL_CONFIG.TCHS_URL,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
          },
          timeout: 5000
        }
      )
    ]);

    if (zipResult.status === 'fulfilled') {
      zipBase64 = zipResult.value.content;
    }
    if (htmlResult.status === 'fulfilled' && typeof htmlResult.value.data === 'string') {
      htmlDetail = htmlResult.value.data;
    }

    return FilingPreviewParser.parsePreview(filing, zipBase64, htmlDetail);
  }

  private handleAxiosError(err: any, contextMessage: string): Error {
    if (err.code === 'CAPTCHA_INVALID' || err.code === 'SESSION_EXPIRED' || err.code === 'CANCELLED') {
      return err;
    }

    const axiosErr = err as AxiosError;
    let code: PortalErrorCode = 'UNKNOWN';
    let detail = err.message || '';

    if (axiosErr.response) {
      const status = axiosErr.response.status;
      if (status === 401) {
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

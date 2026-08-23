import { AxiosError } from 'axios';
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

  constructor(session: PortalSession) {
    this.session = session;
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

      // Kiểm tra đăng nhập thành công cho cả định dạng XML String và JSON Object
      const isSuccess =
        resStr.includes('<status>200</status>') ||
        resStr.includes('<status>201</status>') ||
        resStr.includes('isChooseDgDinhKy') ||
        resStr.includes('home') ||
        (typeof resData === 'object' &&
          resData !== null &&
          (resData.status === '200' ||
            resData.status === '201' ||
            resData.status === 200 ||
            resData.status === 201 ||
            resData.code === '00' ||
            resData.success === true));

      if (isSuccess || response.status === 200 && (resStr.includes('home') || resStr.includes('201') || resStr.includes('200'))) {
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
   * Xác thực ID tờ khai trước khi tải
   */
  public async validateIdTkhai(idTKhai: string): Promise<boolean> {
    try {
      const cookies = await this.session.getCookieJar().getCookies(PORTAL_CONFIG.BASE_URL);
      const xsrfCookie = cookies.find(c => c.key === 'XSRF-TOKEN' || c.key.toLowerCase() === 'xsrf-token')?.value;
      const activeToken = xsrfCookie || this.csrfToken;

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
   * Tải file hồ sơ thuế (Base64 ZIP) hỗ trợ tự động Retry khi gặp HTTP 429 Rate Limit.
   * Tự động chọn đúng endpoint dựa trên isThueDienTu:
   *   false/undefined → POST /downloadhoso { maHoSo }
   *   true            → POST /downloadhoso-tdt?loaiTraCuu=<value>
   */
  public async downloadHoSo(
    maHoSo: string,
    abortSignal?: AbortSignal,
    filingMeta?: { isThueDienTu?: boolean; loaiTraCuu?: string }
  ): Promise<DownloadResponsePayload> {
    // Nếu isThueDienTu=true, route sang endpoint chuyên biệt
    if (filingMeta?.isThueDienTu === true) {
      return this.downloadHoSoTdt(maHoSo, filingMeta.loaiTraCuu, abortSignal);
    }
    return this.downloadHoSoStandard(maHoSo, abortSignal);
  }

  /**
   * Nhánh Thuế Điện Tử: POST /tthc/tchs/downloadhoso-tdt?loaiTraCuu=<value>
   * Phát hiện từ GDT portal source: if (isThueDienTu) url = base_url + "tchs/downloadhoso-tdt?loaiTraCuu=" + loaiTraCuu
   */
  public async downloadHoSoTdt(
    maHoSo: string,
    loaiTraCuu?: string,
    abortSignal?: AbortSignal
  ): Promise<DownloadResponsePayload> {
    const cleanId = maHoSo.trim();
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const cookies = await this.session.getCookieJar().getCookies(PORTAL_CONFIG.BASE_URL);
        const xsrfCookie = cookies.find(c => c.key === 'XSRF-TOKEN' || c.key.toLowerCase() === 'xsrf-token')?.value;
        const activeToken = xsrfCookie || this.csrfToken;

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

        // Xây URL với loaiTraCuu param
        const tldUrl = loaiTraCuu
          ? `${PORTAL_CONFIG.DOWNLOAD_TDT_API}?loaiTraCuu=${encodeURIComponent(loaiTraCuu)}`
          : PORTAL_CONFIG.DOWNLOAD_TDT_API;

        const response = await this.session.client.post(
          tldUrl,
          { maHoSo: cleanId },
          { signal: abortSignal, headers: baseHeaders, timeout: 15000 }
        );

        const resData = response?.data;
        if (!resData || typeof resData !== 'object' || !resData.content) {
          throw new Error(resData?.desc || resData?.message || 'Nội dung file Base64 không tồn tại (downloadhoso-tdt)');
        }

        return {
          fileName: resData.fileName || `files_${cleanId}.zip`,
          fileType: resData.fileType || 'application/zip',
          content: resData.content
        };
      } catch (err: any) {
        if (abortSignal?.aborted) {
          const cancelErr = new Error('Tác vụ tải đã bị dừng bởi người dùng');
          (cancelErr as any).code = 'CANCELLED';
          throw cancelErr;
        }
        if (err.response?.status === 429 && attempt < maxAttempts) {
          const backoffDelay = 2000 * attempt + Math.floor(Math.random() * 1000);
          await new Promise(r => setTimeout(r, backoffDelay));
          continue;
        }
        throw this.handleAxiosError(err, `Lỗi khi tải hồ sơ TDT ID: ${maHoSo}`);
      }
    }
    throw new Error(`Tải hồ sơ TDT ID: ${maHoSo} thất bại do máy chủ giới hạn tần suất`);
  }

  /**
   * Nhánh Hồ Sơ Thường: POST /tthc/tchs/downloadhoso { maHoSo }
   * Tự động fallback qua các chiến lược payload khác nhau nếu cần.
   */
  private async downloadHoSoStandard(maHoSo: string, abortSignal?: AbortSignal): Promise<DownloadResponsePayload> {
    const cleanId = maHoSo.trim();
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const cookies = await this.session.getCookieJar().getCookies(PORTAL_CONFIG.BASE_URL);
        const xsrfCookie = cookies.find(c => c.key === 'XSRF-TOKEN' || c.key.toLowerCase() === 'xsrf-token')?.value;
        const activeToken = xsrfCookie || this.csrfToken;

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

        let response: any;
        let lastError: any = null;

        // BƯỚC 1: JSON payload với maHoSo (Chuẩn Cổng Thuế GDT - Tải trực tiếp siêu tốc)
        try {
          response = await this.session.client.post(
            PORTAL_CONFIG.DOWNLOAD_API,
            { maHoSo: cleanId },
            {
              signal: abortSignal,
              timeout: 15000,
              headers: {
                ...baseHeaders,
                'Content-Type': 'application/json;charset=UTF-8'
              }
            }
          );
        } catch (err1: any) {
          lastError = err1;
          if (err1.response?.status === 429) throw err1;
        }

        // CHIẾN LƯỢC 2: JSON payload với idTKhai nếu Chiến lược 1 không có content
        if (!response?.data?.content && !abortSignal?.aborted) {
          try {
            response = await this.session.client.post(
              PORTAL_CONFIG.DOWNLOAD_API,
              { idTKhai: cleanId },
              {
                signal: abortSignal,
                timeout: 12000,
                headers: {
                  ...baseHeaders,
                  'Content-Type': 'application/json;charset=UTF-8'
                }
              }
            );
          } catch (err2: any) {
            lastError = err2;
            if (err2.response?.status === 429) throw err2;
          }
        }

        // CHIẾN LƯỢC 3: Form-urlencoded với maHoSo và _csrf nếu JSON bị 403/415
        if (!response?.data?.content && !abortSignal?.aborted) {
          try {
            const formParams = new URLSearchParams();
            formParams.append('maHoSo', cleanId);
            if (this.csrfToken) formParams.append('_csrf', this.csrfToken);

            response = await this.session.client.post(
              PORTAL_CONFIG.DOWNLOAD_API,
              formParams.toString(),
              {
                signal: abortSignal,
                headers: {
                  ...baseHeaders,
                  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
                }
              }
            );
          } catch (err3: any) {
            lastError = err3;
            if (err3.response?.status === 429) throw err3;
          }
        }

        // CHIẾN LƯỢC 4: GET chi tiết hồ sơ trực tiếp từ Cổng Thuế
        if (!response?.data?.content && !abortSignal?.aborted) {
          try {
            const detailRes = await this.session.client.get(
              `${PORTAL_CONFIG.DETAIL_FILE_URL}/${cleanId}?loai=`,
              {
                signal: abortSignal,
                headers: {
                  ...baseHeaders,
                  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                }
              }
            );
            if (detailRes.data && typeof detailRes.data === 'string') {
              // Trích xuất link tải hoặc file base64 từ trang chi tiết
              const base64Match = detailRes.data.match(/data:application\/zip;base64,([A-Za-z0-9+/=]+)/) ||
                detailRes.data.match(/base64,([A-Za-z0-9+/=]{100,})/);
              if (base64Match) {
                response = {
                  data: {
                    content: base64Match[1],
                    fileName: `files_${cleanId}.zip`,
                    fileType: 'application/zip'
                  }
                };
              }
            }
          } catch (err4: any) {
            lastError = err4;
          }
        }

        const resData = response?.data;
        if (!resData || typeof resData !== 'object' || !resData.content) {
          if (lastError) {
            throw lastError;
          }
          throw new Error(resData?.desc || resData?.message || 'Nội dung file Base64 không tồn tại trong phản hồi máy chủ');
        }

        return {
          fileName: resData.fileName || `files_${cleanId}.zip`,
          fileType: resData.fileType || 'application/zip',
          content: resData.content
        };
      } catch (err: any) {
        if (abortSignal?.aborted) {
          const cancelErr = new Error('Tác vụ tải đã bị dừng bởi người dùng');
          (cancelErr as any).code = 'CANCELLED';
          throw cancelErr;
        }

        // Nếu gặp lỗi HTTP 429 (Rate limit) -> Tự động backoff & retry
        if (err.response?.status === 429 && attempt < maxAttempts) {
          const backoffDelay = 2000 * attempt + Math.floor(Math.random() * 1000);
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
    return customErr;
  }
}

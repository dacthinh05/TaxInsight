import { PORTAL_CONFIG } from '../../shared/constants';
import { DateRange, PaymentSlipDetail, PaymentSlipRecord } from '../../shared/types';
import { PortalSession } from './PortalSession';
import { DseFormState, DseFormStateParser } from './DseFormStateParser';
import { GdtResponseClassifier } from './GdtResponseClassifier';
import { GntParser } from '../scanner/GntParser';
import { GntMoneyParser } from '../scanner/GntMoneyParser';

export type GntCheckpoint =
  | 'GNT_01_DVC_SESSION_VALID'
  | 'GNT_02_ETAX_ENTRY_TRIGGERED'
  | 'GNT_03_SSO_HANDOFF_DETECTED'
  | 'GNT_04_ETAX_ORIGIN_REACHED'
  | 'GNT_05_ETAX_AUTHENTICATED'
  | 'GNT_06_MODULE_330410_OPENED'
  | 'GNT_07_GNT_QUERY_READY';

export interface GntDiagnosticReport {
  checkpoints: Record<GntCheckpoint, { status: 'PASS' | 'FAIL' | 'SKIPPED'; detail?: string }>;
  ssoHandoffType?: 'HTTP_REDIRECT' | 'FORM_POST' | 'DIRECT_URL' | 'ALREADY_AT_ETAX' | 'UNKNOWN';
  lastError?: string;
}

export class PaymentSlipClient {
  private session: PortalSession;
  private currentDseState: DseFormState = { sessionId: '' };
  private isEtaxInitialized = false;
  private inFlightSessionInit: Promise<void> | null = null;
  private inFlightDetailRequests = new Map<string, Promise<PaymentSlipDetail | null>>();

  private detailCache = new Map<string, PaymentSlipDetail>();

  /** ctuId -> chi tiết trong cache đã được đối chiếu khớp với danh sách chưa */
  private detailCacheVerified = new Map<string, boolean>();
  private generation = 0;

  private latestDiagnostic: GntDiagnosticReport = {
    checkpoints: {
      GNT_01_DVC_SESSION_VALID: { status: 'SKIPPED' },
      GNT_02_ETAX_ENTRY_TRIGGERED: { status: 'SKIPPED' },
      GNT_03_SSO_HANDOFF_DETECTED: { status: 'SKIPPED' },
      GNT_04_ETAX_ORIGIN_REACHED: { status: 'SKIPPED' },
      GNT_05_ETAX_AUTHENTICATED: { status: 'SKIPPED' },
      GNT_06_MODULE_330410_OPENED: { status: 'SKIPPED' },
      GNT_07_GNT_QUERY_READY: { status: 'SKIPPED' }
    }
  };

  constructor(session: PortalSession) {
    this.session = session;
  }

  public getDiagnosticReport(): GntDiagnosticReport {
    return JSON.parse(JSON.stringify(this.latestDiagnostic));
  }

  /**
   * Reset toàn bộ trạng thái phiên eTax (gọi khi đăng xuất / đổi tài khoản):
   * nếu không reset, phiên DSE cũ sẽ được tái sử dụng với cookie jar mới
   * gây SESSION_EXPIRED, và cache chi tiết GNT rò rỉ dữ liệu giữa các tài khoản.
   */
  public reset() {
    this.generation++;
    this.currentDseState = { sessionId: '' };
    this.isEtaxInitialized = false;
    this.inFlightSessionInit = null;
    this.inFlightDetailRequests.clear();
    this.detailCache.clear();
    this.detailCacheVerified.clear();
    this.latestDiagnostic = {
      checkpoints: {
        GNT_01_DVC_SESSION_VALID: { status: 'SKIPPED' },
        GNT_02_ETAX_ENTRY_TRIGGERED: { status: 'SKIPPED' },
        GNT_03_SSO_HANDOFF_DETECTED: { status: 'SKIPPED' },
        GNT_04_ETAX_ORIGIN_REACHED: { status: 'SKIPPED' },
        GNT_05_ETAX_AUTHENTICATED: { status: 'SKIPPED' },
        GNT_06_MODULE_330410_OPENED: { status: 'SKIPPED' },
        GNT_07_GNT_QUERY_READY: { status: 'SKIPPED' }
      }
    };
  }

  public setManualSessionState(sessionId: string | DseFormState, pageId?: number, processorId?: string): boolean {
    if (typeof sessionId === 'object' && sessionId !== null) {
      this.currentDseState = { ...sessionId };
      this.isEtaxInitialized = this.isQueryStateReady(this.currentDseState);
      if (this.isEtaxInitialized) return true;
      if (
        Boolean(sessionId.sessionId && sessionId.processorId && sessionId.applicationId !== undefined && String(sessionId.applicationId).trim() !== '') &&
        ['corpIndexProc', 'corporateHomeProc', 'corpJumpProc'].includes(String(sessionId.operationName || ''))
      ) {
        return true;
      }
      return false;
    }
    const cleanId = String(sessionId || '').trim();
    this.currentDseState = {
      sessionId: cleanId,
      pageId: pageId ? String(pageId) : (this.currentDseState.pageId || '5'),
      processorId: processorId || this.currentDseState.processorId || 'EWIGIUJSBZEDBFCOGFDXGTASFMGGCEEQCRAGGADP',
      operationName: 'corpQueryTaxProc',
      processorState: 'viewQueryPage',
      errorPage: '/etax/query_tax_information.jsp'
    };
    this.isEtaxInitialized = Boolean(cleanId);
    return this.isEtaxInitialized;
  }
  private assertGeneration(generation: number) {
    if (generation !== this.generation) {
      const error = new Error('Tác vụ eTax đã bị hủy bởi phiên mới.');
      Object.assign(error, { code: 'CANCELLED', errorCode: 'CANCELLED' });
      throw error;
    }
  }

  /**
   * Dùng DSE state lấy từ cửa sổ Electron để backend tự mở form tra cứu GNT.
   * Không đoán page/processor và không giả lập Plugin Gate: chỉ điều hướng khi
   * state động từ eTax đã có đủ session/application.
   */
  public async activateManualSessionForQuery(): Promise<boolean> {
    if (this.isQueryStateReady(this.currentDseState)) {
      this.isEtaxInitialized = true;
      return true;
    }
    if (
      !this.currentDseState.sessionId ||
      this.currentDseState.applicationId === undefined ||
      String(this.currentDseState.applicationId).trim() === '' ||
      !['corpIndexProc', 'corporateHomeProc', 'corpJumpProc'].includes(
        String(this.currentDseState.operationName || '')
      )
    ) {
      return false;
    }

    await this.openQueryModule(this.generation);
    this.isEtaxInitialized = this.isQueryStateReady(this.currentDseState);
    return this.isEtaxInitialized;
  }

  private logCheckpoint(cp: GntCheckpoint, status: 'PASS' | 'FAIL', detail?: string) {
    this.latestDiagnostic.checkpoints[cp] = { status, detail };
    const safeDetail = String(detail || '')
      .replace(/(sessionId|processorId|token|code)[=:]\s*[^&\s]+/gi, '$1=******');
    console.log(`[PaymentSlipClient Checkpoint] ${cp}: ${status}${safeDetail ? ` - ${safeDetail}` : ''}`);
  }

  /**
   * Khởi tạo bắt tay SSO từ Cổng Dịch vụ công sang Thuế Điện Tử (eTax - etaxnnt)
   */
  public async ensureEtaxSession(forceRefresh = false): Promise<void> {
    if (this.isEtaxInitialized && !forceRefresh && this.isQueryStateReady(this.currentDseState)) {
      this.logCheckpoint('GNT_07_GNT_QUERY_READY', 'PASS', 'Sử dụng phiên eTax đã khởi tạo');
      return;
    }

    // Single-flight: scan, thống kê và prefetch chi tiết có thể cùng chạm eTax.
    // Chỉ cho phép một chuỗi SSO chạy tại một thời điểm để không nhân bản toàn bộ
    // các request EstablishSession/corpJumpProc/openQueryModule.
    if (this.inFlightSessionInit) {
      return this.inFlightSessionInit;
    }

    const initPromise = this.initializeEtaxSession(forceRefresh);
    this.inFlightSessionInit = initPromise;
    try {
      await initPromise;
    } finally {
      if (this.inFlightSessionInit === initPromise) {
        this.inFlightSessionInit = null;
      }
    }
  }

  private async initializeEtaxSession(forceRefresh = false): Promise<void> {
    const activeGeneration = this.generation;
    try {
      if (forceRefresh) {
        this.isEtaxInitialized = false;
        this.currentDseState = { sessionId: '' };
      }

      // Tái sử dụng phiên eTax hợp lệ từ AuthWindow để mở ngay phân hệ GNT mà không cần chạy lại toàn bộ SSO DVC
      if (!forceRefresh && this.currentDseState.sessionId && this.currentDseState.processorId) {
        try {
          await this.openQueryModule(activeGeneration);
          this.isEtaxInitialized = this.isQueryStateReady(this.currentDseState);
          if (this.isEtaxInitialized) {
            this.logCheckpoint('GNT_07_GNT_QUERY_READY', 'PASS', 'Đã chuyển tiếp vào form GNT từ session eTax hiện hữu');
            return;
          }
        } catch (e) {
          console.warn('[PaymentSlipClient] Tái kích hoạt form GNT từ session hiện hữu thất bại, khởi động lại chuỗi SSO DVC:', e);
        }
      }

      // ── CHECKPOINT 01: DVC Session Validation ────────────────────────
      const cookies = await this.session.getCookieJar().getCookies(PORTAL_CONFIG.TCHS_URL);
      const hasDvcCookie = cookies.some(c => c.key.toLowerCase().includes('session') || c.key.toLowerCase().includes('token'));
      if (!hasDvcCookie && !this.session.getSessionInfo().isLoggedIn) {
        this.logCheckpoint('GNT_01_DVC_SESSION_VALID', 'FAIL', 'Chưa có session DVC hợp lệ');
        throw new Error('Chưa đăng nhập hoặc phiên làm việc trên Cổng DVC đã hết hạn.');
      }
      this.logCheckpoint('GNT_01_DVC_SESSION_VALID', 'PASS', `Tìm thấy ${cookies.length} cookies DVC`);

      // ── CHECKPOINT 02: Kích hoạt SSO Entry ───────────────────────────
      let dvcEntryHtml = '';
      try {
        const entryRes = await this.session.client.get('https://dichvucong.gdt.gov.vn/tthc/dich-vu-khac', {
          headers: {
            'Referer': 'https://dichvucong.gdt.gov.vn/tthc/home',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
          }
        });
        dvcEntryHtml = String(entryRes.data || '');
      } catch (entryErr: any) {
        if (this.mustStopFallback(entryErr)) throw entryErr;
      }

      // Cổng mới nhúng CSRF token vào HTML (_csrf hidden input / meta csrf-token),
      // KHÔNG còn cấp qua cookie XSRF-TOKEN -> phải trích từ HTML
      const csrfFromHtml =
        dvcEntryHtml.match(/name=["']_csrf["']\s+value=["']([^"']+)["']/i)?.[1] ||
        dvcEntryHtml.match(/value=["']([^"']+)["']\s+name=["']_csrf["']/i)?.[1] ||
        dvcEntryHtml.match(/name=["']csrf-token["']\s+content=["']([^"']+)["']/i)?.[1] ||
        dvcEntryHtml.match(/content=["']([^"']+)["']\s+name=["']csrf-token["']/i)?.[1] ||
        '';
      const xsrfCookie = cookies.find(c => c.key === 'XSRF-TOKEN' || c.key.toLowerCase() === 'xsrf-token')?.value || '';
      const csrfToken = csrfFromHtml || decodeURIComponent(xsrfCookie);

      // Fallback: nếu trang dịch-vụ-khác có link trực tiếp sang thuedientu thì dùng luôn
      const directEtaxLink = dvcEntryHtml.match(/https?:\/\/[^"'\s<>]*thuedientu\.gdt\.gov\.vn[^"'\s<>]*/i)?.[0];

      const ssoHeaders: Record<string, string> = {
        'Origin': 'https://dichvucong.gdt.gov.vn',
        'Referer': 'https://dichvucong.gdt.gov.vn/tthc/dich-vu-khac',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      };
      if (csrfToken) {
        ssoHeaders['X-XSRF-TOKEN'] = csrfToken;
      }

      this.logCheckpoint('GNT_02_ETAX_ENTRY_TRIGGERED', 'PASS', csrfToken ? `Gửi request SSO module=330410 (CSRF: ${csrfToken.slice(0, 8)}***)` : 'Gửi request SSO module=330410 (KHÔNG có CSRF token!)');

      // ── CHECKPOINT 03: Phát hiện SSO Handoff Mechanism ───────────────
      let ssoResponseHtml = '';
      let redirectUrl = '';
      let handoffType: 'HTTP_REDIRECT' | 'FORM_POST' | 'DIRECT_URL' | 'ALREADY_AT_ETAX' | 'UNKNOWN' = 'UNKNOWN';

      try {
        const ssoBody = new URLSearchParams();
        if (csrfToken) ssoBody.append('_csrf', csrfToken);

        const ssoRes = await this.session.client.post(
          `${PORTAL_CONFIG.SSO_REDIRECT_API}?module=330410`,
          ssoBody.toString(),
          {
            headers: {
              ...ssoHeaders,
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
            },
            timeout: 15000,
            maxRedirects: 5
          }
        );

        const resData = ssoRes.data;
        const resDataStr = typeof resData === 'string' ? resData : JSON.stringify(resData || '');
        const finalUrl = (ssoRes.request as any)?.res?.responseUrl || '';

        if (finalUrl && finalUrl.includes('thuedientu.gdt.gov.vn')) {
          handoffType = 'ALREADY_AT_ETAX';
          ssoResponseHtml = resDataStr;
          redirectUrl = finalUrl;
        } else {
          const match = resDataStr.match(/https?:\/\/[^\s"'<>]+thuedientu\.gdt\.gov\.vn[^\s"'<>]+/i);
          if (match) {
            handoffType = 'DIRECT_URL';
            redirectUrl = match[0].replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
          } else if (typeof resData === 'string' && resData.startsWith('http')) {
            handoffType = 'DIRECT_URL';
            redirectUrl = resData.trim();
          }
        }
      } catch (postErr: any) {
        const status = postErr.response?.status;
        const errBody = String(postErr.response?.data || '').replace(/\s+/g, ' ').slice(0, 150);
        console.warn(`[PaymentSlipClient] Post SSO err: ${postErr.message}${status ? ` (HTTP ${status})` : ''}${errBody ? ` body="${errBody}"` : ''}`);
        if (this.mustStopFallback(postErr)) throw postErr;

        // Chỉ thử GET khi server xác nhận rõ endpoint/payload POST không phù hợp.
        // Lỗi mạng không rõ request đã tới server hay chưa tuyệt đối không được
        // gửi ngay request thứ hai.
        const mayTryGetFallback = [400, 404, 405, 415].includes(Number(status));
        if (!redirectUrl && mayTryGetFallback) {
          try {
            const getSso = await this.session.client.get(`${PORTAL_CONFIG.SSO_REDIRECT_API}?module=330410`, {
              headers: ssoHeaders,
              timeout: 15000,
              maxRedirects: 5
            });
            const getStr = typeof getSso.data === 'string' ? getSso.data : JSON.stringify(getSso.data || '');
            const finalUrlGet = (getSso.request as any)?.res?.responseUrl || '';
            if (finalUrlGet.includes('thuedientu.gdt.gov.vn')) {
              handoffType = 'ALREADY_AT_ETAX';
              redirectUrl = finalUrlGet;
            } else {
              const m2 = getStr.match(/https?:\/\/[^\s"'<>]+thuedientu\.gdt\.gov\.vn[^\s"'<>]+/i);
              if (m2) {
                handoffType = 'DIRECT_URL';
                redirectUrl = m2[0].replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
              }
            }
          } catch (getErr: any) {
            console.warn(`[PaymentSlipClient] Get SSO fallback err: ${getErr.message}`);
            if (this.mustStopFallback(getErr)) throw getErr;
          }
        }
      }

      // Fallback cuối: link thuedientu xuất hiện trực tiếp trong trang dich-vu-khac
      if (!redirectUrl && directEtaxLink) {
        handoffType = 'DIRECT_URL';
        redirectUrl = directEtaxLink.replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
        console.warn('[PaymentSlipClient] Dùng link eTax trực tiếp từ trang dich-vu-khac (fallback)');
      }

      this.latestDiagnostic.ssoHandoffType = handoffType;
      if (handoffType !== 'UNKNOWN') {
        this.logCheckpoint('GNT_03_SSO_HANDOFF_DETECTED', 'PASS', `Cơ chế handoff: ${handoffType}`);
      }

      let initHtml = ssoResponseHtml;

      if (handoffType === 'DIRECT_URL' && redirectUrl) {
        const etaxInitRes = await this.session.client.get(redirectUrl, {
          headers: {
            'Referer': 'https://dichvucong.gdt.gov.vn/',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
          },
          timeout: 20000,
          maxRedirects: 5
        });
        initHtml = String(etaxInitRes.data || '');
      }

      let dseState = DseFormStateParser.extractDseFormState(initHtml);
      if (dseState.sessionId) {
        this.currentDseState = dseState;
        this.logCheckpoint('GNT_04_ETAX_ORIGIN_REACHED', 'PASS', `Đã vào origin eTax (op=${dseState.operationName ?? '?'})`);

        // Đi theo chuỗi điều hướng như trình duyệt thật:
        // EstablishSession -> corpJumpProc -> corpUserLoginProc (auto-submit form) -> corpIndexProc
        if (this.currentDseState.operationName !== 'corpQueryTaxProc') {
          await this.followRedirectChain(
            initHtml,
            redirectUrl || `${PORTAL_CONFIG.ETAX_BASE_URL}/etaxnnt/EstablishSession`,
            activeGeneration
          );
        }
        this.assertGeneration(activeGeneration);

        this.isEtaxInitialized = Boolean(this.currentDseState.sessionId);
        this.logCheckpoint(
          'GNT_05_ETAX_AUTHENTICATED',
          'PASS',
          `Session suffix: ***${this.currentDseState.sessionId.slice(-4)}`
        );

        // Từ trang chính, mở phân hệ tra cứu (corpQueryTaxProc)
        if (this.currentDseState.operationName !== 'corpQueryTaxProc') {
          await this.openQueryModule(activeGeneration);
        }
      } else {
        // F-009: SSO đã chạy trọn chuỗi nhưng không parse được trạng thái DSE từ phản hồi eTax.
        // KHÔNG seed JSESSIONID/pageId/processorId hardcoded và KHÔNG log PASS (vi phạm
        // no-hardcode, tạo DSE state stale và đánh lừa caller). Log FAIL với NEEDS_FULL_SSO
        // và throw SESSION_EXPIRED để queryPaymentSlips retry đúng một lần với full SSO
        // (attempt 2, forceRefresh = true) — đúng semantics "đi thẳng full SSO".
        this.logCheckpoint(
          'GNT_05_ETAX_AUTHENTICATED',
          'FAIL',
          'NEEDS_FULL_SSO: không parse được trạng thái DSE từ phản hồi eTax sau chuỗi SSO'
        );
        const ssoError = new Error(
          'Không xác lập được phiên eTax sau SSO (thiếu trạng thái DSE) — phiên có thể đã hết hạn, cần xác thực lại.'
        );
        Object.assign(ssoError, { code: 'SESSION_EXPIRED', errorCode: 'SESSION_EXPIRED' });
        throw ssoError;
      }
    } catch (err: any) {
      this.latestDiagnostic.lastError = err.message;
      console.warn('[PaymentSlipClient] ensureEtaxSession notice:', err.message);
      throw err;
    }
  }

  /**
   * Các lỗi hạ tầng/xác thực phải dừng cả chuỗi fallback. Tiếp tục thử endpoint,
   * method hoặc navigation variant sau các lỗi này chỉ làm tăng tải và có thể
   * biến một lỗi đơn lẻ thành bão request.
   */
  private mustStopFallback(err: any): boolean {
    const status = Number(err?.response?.status || err?.httpStatus || 0);
    const code = String(err?.code || err?.errorCode || '');
    if (status === 401 || status === 403 || status === 429 || status >= 500) return true;
    if (['RATE_LIMIT', 'SESSION_EXPIRED', 'AUTH_REQUIRED', 'CANCELLED'].includes(code)) return true;
    if (!err?.response && (
      Boolean(err?.request) ||
      ['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'NETWORK'].includes(code)
    )) return true;
    return false;
  }

  /**
   * Đi theo chuỗi điều hướng của eTax như trình duyệt thật:
   * - JS redirect (window.location.href) / meta refresh
   * - Plugin Gate (retailIndexProc): giả lập kết quả kiểm tra plugin THÀNH CÔNG
   *   bằng cách nộp goProcForm với corporateHomeProc/startTTHC như fncInstalled()
   * - Form auto-submit trung gian (vd: corpUserLoginProc)
   */
  private async followRedirectChain(
    html: string,
    referer: string,
    activeGeneration: number
  ): Promise<void> {
    let currentHtml = html;
    let currentUrl = referer;
    const seenSteps = new Set<string>();

    for (let hop = 0; hop < 8; hop++) {
      this.assertGeneration(activeGeneration);
      // Trạng thái hiện tại của trang -> merge có bảo vệ
      this.mergeDseState(DseFormStateParser.extractDseFormState(currentHtml));

      const op = this.currentDseState.operationName;
      // Đã tới trang đích đáng tin -> dừng, KHÔNG auto-submit thêm gì nữa
      if (op === 'corpQueryTaxProc' || op === 'corpIndexProc' || op === 'corporateHomeProc') break;
      const clean = (u: string) => u.replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
      let nextUrl = '';
      let nextMethod: 'GET' | 'POST' = 'GET';
      let postBody = '';
      const observedGoProc = currentHtml.match(
        /goProc\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/i
      );
      const isPluginGate =
        op === 'retailIndexProc' ||
        (
          !observedGoProc &&
          (
            currentHtml.includes('Hệ thống đang thực hiện kiểm tra bản cập nhật') ||
            currentHtml.includes('Vui lòng cài đặt ứng dụng ký điện tử') ||
            (
              currentHtml.includes('checkInstall(8768)') &&
              /kiểm tra (?:plugin|ứng dụng|bản cập nhật)/i.test(currentHtml)
            )
          )
        );

      if (isPluginGate) {
        const authError = new Error(
          'eTax yêu cầu xác thực tương tác/plugin. Vui lòng dùng nút "Mở eTax để xác thực".'
        );
        Object.assign(authError, { errorCode: 'AUTH_REQUIRED' });
        throw authError;
      } else {
        const jsRedir =
          currentHtml.match(/window\.location\.href\s*=\s*["']([^"']+)["']/i) ||
          currentHtml.match(/location\.replace\(\s*["']([^"']+)["']\s*\)/i) ||
          currentHtml.match(/window\.location\s*=\s*["']([^"']+)["']/i);
        const metaRedir = currentHtml.match(/http-equiv=["']refresh["'][^>]*url=([^"'>]+)/i);

        const nextPath = ((jsRedir?.[1] || metaRedir?.[1]) || '').trim();
        if (nextPath && !nextPath.toLowerCase().startsWith('javascript')) {
          nextUrl = this.resolveEtaxUrl(clean(nextPath), currentUrl);
        } else {
          // Form auto-submit thuần DSE (chỉ hidden input, không có dữ liệu người dùng)
          const form = this.extractMainForm(currentHtml);
          if (form && form.autoSubmit && Object.keys(form.fields).length > 0 && form.fields['dse_sessionId']) {
            if (observedGoProc) {
              form.fields.dse_operationName = observedGoProc[1];
              form.fields.dse_nextEventName = observedGoProc[2];
            }
            nextUrl = this.resolveEtaxUrl(clean(form.action), currentUrl);
            nextMethod = 'POST';
            postBody = new URLSearchParams(form.fields).toString();
          }
        }
      }
      if (!nextUrl) {
        const formError = new Error(
          `Không xác định được bước điều hướng eTax tiếp theo (operation=${op || 'unknown'}).`
        );
        Object.assign(formError, { errorCode: 'ETAX_FORM_CHANGED' });
        throw formError;
      }
      const stepKey = `${nextMethod}:${nextUrl}:${postBody}`;
      if (seenSteps.has(stepKey)) {
        const loopError = new Error('Phát hiện vòng lặp điều hướng eTax.');
        Object.assign(loopError, { errorCode: 'ETAX_FORM_CHANGED' });
        throw loopError;
      }
      seenSteps.add(stepKey);

      try {
        await new Promise(resolve => setTimeout(resolve, 250 + Math.random() * 250));
        const res = nextMethod === 'POST'
          ? await this.session.client.post(nextUrl, postBody, {
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Origin': PORTAL_CONFIG.ETAX_BASE_URL,
                'Referer': currentUrl,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
              },
              timeout: 20000
            })
          : await this.session.client.get(nextUrl, {
              headers: {
                'Referer': currentUrl,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
              },
              timeout: 20000,
              maxRedirects: 5
            });
        currentHtml = String(res.data || '');
        currentUrl = this.resolveEtaxUrl((res.request as any)?.res?.responseUrl || nextUrl, nextUrl);
        this.debugDumpPage(hop + 1, currentHtml);
      } catch (err: any) {
        const status = err.response?.status;
        console.warn(`[PaymentSlipClient] Nav hop ${hop + 1} err: ${err.message}${status ? ` (HTTP ${status})` : ''}`);
        if (this.mustStopFallback(err)) throw err;
        break;
      }
    }
    this.assertGeneration(activeGeneration);
  }

  private extractMainForm(html: string): { name: string; action: string; fields: Record<string, string>; autoSubmit: boolean } | null {
    const formTag = html.match(/<form\b[^>]*>/i);
    if (!formTag) return null;
    const startIdx = formTag.index ?? 0;
    const endIdx = html.toLowerCase().indexOf('</form', startIdx);
    const formBody = endIdx === -1 ? html.slice(startIdx) : html.slice(startIdx, endIdx);

    const action = formTag[0].match(/action=["']([^"']*)["']/i)?.[1] || '/etaxnnt/Request';
    const name = formTag[0].match(/name=["']([^"']*)["']/i)?.[1]
      || formTag[0].match(/id=["']([^"']*)["']/i)?.[1]
      || '';

    const fields: Record<string, string> = {};
    const inputRe = /<input\b[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = inputRe.exec(formBody))) {
      const tag = m[0];
      const fieldName = tag.match(/\bname=["']([^"']+)["']/i)?.[1];
      if (!fieldName) continue;
      const type = tag.match(/\btype=["']([^"']+)["']/i)?.[1]?.toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        if (!/\bchecked\b/i.test(tag)) continue;
      }
      if (type === 'button' || type === 'submit') continue;
      fields[fieldName] = tag.match(/\bvalue=["']([^"']*)["']/i)?.[1]?.replace(/&amp;/g, '&') ?? '';
    }

    const autoSubmit = /\.submit\(\s*\)/i.test(html) || /forms\[0\]\.submit/i.test(html);
    return { name, action, fields, autoSubmit };
  }

  private debugDumpPage(hop: number, html: string): void {
    try {
      if (!process.env.GNT_DEBUG_DUMP) return;
      const fs = require('fs') as typeof import('fs');
      const osMod = require('os') as typeof import('os');
      const pathMod = require('path') as typeof import('path');
      const p = pathMod.join(osMod.tmpdir(), `gnt_nav_hop_${hop}_${Date.now()}.html`);
      fs.writeFileSync(p, html);
      console.log(`[PaymentSlipClient] Đã dump trang hop ${hop}: ${p}`);
    } catch {}
  }

  private mergeDseState(st: ReturnType<typeof DseFormStateParser.extractDseFormState>): void {
    if (!st.sessionId) return;
    // Bảo vệ trạng thái đích: đã đứng ở corpQueryTaxProc thì không cho trang rác kéo ngược lại
    if (this.currentDseState.operationName === 'corpQueryTaxProc' && st.operationName !== 'corpQueryTaxProc') {
      this.currentDseState = {
        ...this.currentDseState,
        sessionId: st.sessionId || this.currentDseState.sessionId
      };
      return;
    }
    const entries = Object.entries(st).filter(([, v]) => v !== undefined && v !== '');
    this.currentDseState = { ...this.currentDseState, ...Object.fromEntries(entries) } as typeof this.currentDseState;
  }
  private isQueryStateReady(state: DseFormState): boolean {
    return (
      state.operationName === 'corpQueryTaxProc' &&
      Boolean(
        state.sessionId &&
        state.applicationId !== undefined &&
        String(state.applicationId).trim() !== '' &&
        state.pageId &&
        state.processorState &&
        state.processorId
      )
    );
  }

  private assertQueryState(state: DseFormState): void {
    if (!this.isQueryStateReady(state)) {
      const error = new Error('Form tra cứu GNT thiếu DSE state bắt buộc.');
      Object.assign(error, { errorCode: 'ETAX_FORM_CHANGED' });
      throw error;
    }
  }

  private resolveEtaxUrl(rawUrl: string, baseUrl: string): string {
    let resolved: URL;
    try {
      resolved = new URL(rawUrl, baseUrl);
    } catch {
      const error = new Error('URL điều hướng eTax không hợp lệ.');
      Object.assign(error, { errorCode: 'ETAX_FORM_CHANGED' });
      throw error;
    }
    if (
      resolved.protocol !== 'https:' ||
      resolved.hostname.toLowerCase() !== 'thuedientu.gdt.gov.vn'
    ) {
      const error = new Error('eTax trả URL điều hướng ngoài miền cho phép.');
      Object.assign(error, { errorCode: 'ETAX_FORM_CHANGED' });
      throw error;
    }
    return resolved.toString();
  }

  /**
   * Từ trang chính corpIndexProc, mở phân hệ tra cứu GNT (corpQueryTaxProc).
   * Thử lần lượt các biến thể điều hướng đã biết cho tới khi server xác nhận op=corpQueryTaxProc.
   */
  private async openQueryModule(activeGeneration: number): Promise<void> {
    this.assertGeneration(activeGeneration);
    if (
      !this.currentDseState.sessionId ||
      this.currentDseState.applicationId === undefined ||
      String(this.currentDseState.applicationId).trim() === ''
    ) {
      const stateError = new Error('Thiếu DSE state để mở phân hệ tra cứu GNT.');
      Object.assign(stateError, { errorCode: 'ETAX_FORM_CHANGED' });
      throw stateError;
    }
    const sid = encodeURIComponent(this.currentDseState.sessionId || '');
    const variants: Array<{ label: string; url: string; post?: string }> = [
      {
        label: 'GET jump corpJumpProc->corpQueryTaxProc',
        url: `${PORTAL_CONFIG.ETAX_REQUEST_API}?dse_operationName=corpJumpProc&dse_nextEventName=start&toOpName=corpQueryTaxProc&dse_sessionId=${sid}&dse_applicationId=-1`
      },
      {
        label: 'GET direct corpQueryTaxProc initial',
        url: `${PORTAL_CONFIG.ETAX_REQUEST_API}?dse_operationName=corpQueryTaxProc&dse_processorState=initial&dse_nextEventName=start&dse_errorPage=/etax/query_tax_information.jsp&dse_sessionId=${sid}&dse_applicationId=-1&dse_pageId=1`
      },
      {
        label: 'POST jump corpJumpProc->corpQueryTaxProc',
        url: PORTAL_CONFIG.ETAX_REQUEST_API,
        post: `dse_sessionId=${sid}&dse_applicationId=-1&dse_operationName=corpJumpProc&dse_nextEventName=start&toOpName=corpQueryTaxProc`
      }
    ];

    for (const v of variants) {
      try {
        const res = v.post
          ? await this.session.client.post(v.url, v.post, {
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Origin': PORTAL_CONFIG.ETAX_BASE_URL,
                'Referer': PORTAL_CONFIG.ETAX_REQUEST_API,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
              },
              timeout: 20000
            })
          : await this.session.client.get(v.url, {
              headers: {
                'Referer': `${PORTAL_CONFIG.ETAX_BASE_URL}/etaxnnt/Request`,
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
              },
              timeout: 20000
            });

        const html = String(res.data || '');
        this.debugDumpPage(90 + variants.indexOf(v), html);

        const st = DseFormStateParser.extractDseFormState(html);
        this.mergeDseState(st);

        if (this.currentDseState.operationName === 'corpQueryTaxProc' && this.currentDseState.processorId) {
          this.logCheckpoint('GNT_06_MODULE_330410_OPENED', 'PASS',
            `Đã mở phân hệ tra cứu (${v.label}; pageId=${this.currentDseState.pageId ?? '?'}, procId=${this.currentDseState.processorId.slice(0, 8)}***)`);
          return;
        }

        await this.followRedirectChain(html, v.url, activeGeneration);

        if (this.currentDseState.operationName === 'corpQueryTaxProc' && this.currentDseState.processorId) {
          this.logCheckpoint('GNT_06_MODULE_330410_OPENED', 'PASS',
            `Đã mở phân hệ tra cứu (${v.label}; pageId=${this.currentDseState.pageId ?? '?'}, procId=${this.currentDseState.processorId.slice(0, 8)}***)`);
          return;
        }
      } catch (err: any) {
        if (this.mustStopFallback(err)) throw err;
      }
    }
    const moduleError = new Error('Không mở được phân hệ tra cứu Giấy nộp tiền trên eTax.');
    Object.assign(moduleError, { errorCode: 'ETAX_QUERY_BLOCKED' });
    throw moduleError;
  }

  /**
   * Tra cứu danh sách Giấy nộp tiền từ phân hệ eTax.
   *
   * Tự phục hồi khi phiên eTax chết phía server (hiện tượng "tra cứu vẫn thành
   * công nhưng 0 giấy"): server trả lại form truy vấn rỗng / trang lỗi thay vì
   * bảng kết quả. Ta phân loại response; nếu KHÔNG chứa bảng kết quả thì ép
   * làm mới toàn bộ phiên SSO -> eTax và gửi lại truy vấn đúng MỘT lần trước
   * khi báo lỗi thật về UI.
   */
  public async queryPaymentSlips(query: {
    startDate?: string;
    endDate?: string;
    range?: DateRange;
    page?: number;
  }): Promise<{ success: boolean; data: PaymentSlipRecord[]; error?: string; errorCode?: string }> {
    const startDate = query.startDate || query.range?.fromDate || `01/01/${new Date().getFullYear()}`;
    const endDate = query.endDate || query.range?.toDate || new Date().toLocaleDateString('en-GB');

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        if (attempt === 2) {
          // Ép thiết lập lại toàn bộ phiên eTax — phiên cũ đã bị server từ chối,
          // giữ lại sessionId/processorId cũ chỉ khiến lặp lại cùng trang lỗi.
          this.currentDseState = { sessionId: '' };
        }
        await this.ensureEtaxSession(attempt === 2);

        const st = this.currentDseState;
        this.assertQueryState(st);

        const params = new URLSearchParams();
        params.append('dse_sessionId', st.sessionId);
        params.append('dse_applicationId', st.applicationId!);
        params.append('dse_operationName', st.operationName!);
        params.append('dse_pageId', st.pageId!);
        params.append('dse_processorState', st.processorState!);
        params.append('dse_processorId', st.processorId!);
        if (st.errorPage) params.append('dse_errorPage', st.errorPage);
        // Ưu tiên event mà form sống công bố; chỉ dùng "query" khi form không
        // khai báo (tương thích với một số response cũ).
        params.append('dse_nextEventName', st.nextEventName || st.hiddenFields?.dse_nextEventName || 'query');
        params.append('pn', String(query.page || 1));
        params.append('sct', '');
        params.append('ctuId', '');
        params.append('soGnt', '');
        params.append('idBke', '');
        params.append('type_tax', PORTAL_CONFIG.GNT_TYPE_TAX);
        params.append('ma_giao_dich', '');
        params.append('so_ctu_nh', '');
        params.append('so_gnt', '');
        params.append('ngay_lap_tu_ngay', startDate);
        params.append('ngay_lap_den_ngay', endDate);
        params.append('ngay_gui_tu_ngay', '');
        params.append('ngay_gui_den_ngay', '');
        params.append('ngay_nop_tu_ngay', '');
        params.append('ngay_nop_den_ngay', '');
        params.append('ma_nhang', '');
        params.append('so_tk', '');
        params.append('nguyen_te', '');
        params.append('hthuc_nop', '');
        params.append('tong_tien_nt_tu', '');
        params.append('tong_tien_nt_den', '');
        params.append('trang_thai', '');

        const res = await this.session.client.post(PORTAL_CONFIG.ETAX_REQUEST_API, params.toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Origin': PORTAL_CONFIG.ETAX_BASE_URL,
            'Referer': PORTAL_CONFIG.ETAX_REQUEST_API,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
          },
          timeout: 25000
        });

        const html = String(res.data || '');
        const kind = GdtResponseClassifier.classify(html);
        this.debugDumpPage(99, html);

        if (kind === 'LOGIN_PAGE') {
          if (attempt === 1) {
            console.warn('[PaymentSlipClient] eTax tra ve trang dang nhap -> lam moi phien SSO roi thu lai');
            continue;
          }
          return {
            success: false,
            data: [],
            error: 'Phiên làm việc trên Cổng Thuế đã hết hạn.',
            errorCode: 'SESSION_EXPIRED'
          };
        }

        if (kind === 'PLUGIN_GATE') {
          if (attempt === 1) {
            console.warn('[PaymentSlipClient] eTax tra ve Plugin Gate -> lam moi phien SSO roi thu lai');
            continue;
          }
          return {
            success: false,
            data: [],
            error: 'eTax yêu cầu xác thực phiên đăng nhập (Plugin Gate). Vui lòng dùng nút "Mở eTax để xác thực".',
            errorCode: 'AUTH_REQUIRED'
          };
        }

        const nextDse = DseFormStateParser.extractDseFormState(html);
        if (nextDse.sessionId) {
          this.mergeDseState(nextDse);
        }

        const gntList = GntParser.parseList(html);

        // ── PHÁT HIỆN TRANG LỖI GIẢ MẠO "THÀNH CÔNG" ─────────────────────
        // Server xử lý query nhưng phiên đã chết: trả lại form truy vấn rỗng
        // (GNT_QUERY_PAGE), trang lỗi hệ thống hoặc trang lạ — không có bảng
        // kết quả. Trước đây bị ngầm hiểu là "0 giấy nộp tiền".
        const hasResultTable = kind === 'GNT_LIST' || kind === 'GNT_DETAIL' || gntList.length > 0;
        if (!hasResultTable) {
          const isNpe = html.includes('NullPointerException');
          this.logCheckpoint('GNT_07_GNT_QUERY_READY', 'FAIL', `Phản hồi không có bảng kết quả (kind=${kind}${isNpe ? ', NullPointerException' : ''})`);
          return {
            success: false,
            data: [],
            error: isNpe
              ? 'eTax đang trả trang lỗi hệ thống (NullPointerException). Vui lòng thử lại sau ít phút.'
              : 'eTax không trả về bảng kết quả tra cứu (phiên phân hệ tra cứu có thể đã đứt). Vui lòng thử lại hoặc dùng "Mở eTax để xác thực".',
            errorCode: isNpe ? 'ETAX_SYSTEM_ERROR' : 'ETAX_QUERY_BLOCKED'
          };
        }

        this.logCheckpoint('GNT_07_GNT_QUERY_READY', 'PASS', `Truy vấn thành công, nhận ${gntList.length} giấy nộp tiền`);

        const records: PaymentSlipRecord[] = gntList.map(item => ({
          id: item.ctuId,
          stt: item.raw?.cells[0] ? parseInt(item.raw.cells[0], 10) || 1 : 1,
          maGiaoDich: item.transactionRef || '',
          maGiaoDichChiTiet: item.detailTransactionRef,
          lanNop: item.submissionNo ? String(item.submissionNo) : undefined,
          soGnt: item.gntNo || item.ctuId,
          soTien: GntMoneyParser.toSafeNumber(item.amount.value),
          soTienFormatted: GntMoneyParser.formatVND(item.amount.value),
          loaiTien: item.currency || 'VND',
          trangThai: item.statusRaw || 'Nộp thuế thành công',
          soChungTu: item.bankDocumentNo,
          ngayLapGnt: item.createdAt,
          ngayGuiGnt: item.sentAt,
          ngayNopThue: item.paidAt,
          hinhThucNop: item.source === 'OTHER_CHANNEL' ? 'Nộp tại các kênh khác' : 'Nộp tại cổng eTax của TCT',
          tenNganHang: item.bankName,
          soTaiKhoan: item.bankAccount,
          downloadAvailable: item.canDownload
        }));

        return {
          success: true,
          data: records
        };
      } catch (err: any) {
        const status = err.response?.status;
        const explicitCode = String(err?.errorCode || err?.code || '');
        const body = String(err.response?.data || '').replace(/\s+/g, ' ').slice(0, 200);
        console.warn(`[PaymentSlipClient] Query err (lan ${attempt}): ${err.message}${status ? ` (HTTP ${status})` : ''}${body ? ` body="${body}"` : ''}`);
        if (status === 429 || explicitCode === 'RATE_LIMIT') {
          return {
            success: false,
            data: [],
            error: 'eTax đang giới hạn tần suất request. Hệ thống đã tạm dừng hàng đợi; vui lòng thử lại sau.',
            errorCode: 'RATE_LIMIT'
          };
        }
        if (status >= 500 || explicitCode === 'ETAX_SYSTEM_ERROR') {
          return {
            success: false,
            data: [],
            error: `eTax đang gặp lỗi máy chủ (HTTP ${status}). Không tự động gửi dồn request.`,
            errorCode: 'ETAX_SYSTEM_ERROR'
          };
        }
        const isAuthFailure =
          status === 401 ||
          explicitCode === 'SESSION_EXPIRED' ||
          /hết hạn|trang đăng nhập/i.test(String(err?.message || ''));
        const isTransportFailure =
          Boolean(err?.request) ||
          ['ECONNABORTED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(String(err?.code || ''));
        if (attempt === 1 && isAuthFailure) {
          // Chỉ khi server xác nhận rõ lỗi xác thực mới được phép làm mới phiên
          // đúng một lần. Lỗi transport là mơ hồ: request đầu có thể đã tới
          // eTax; gửi lại ngay sẽ tạo request trùng và góp phần gây HTTP 429.
          continue;
        }
        const msg = err.message || 'Lỗi kết nối khi gửi request tra cứu GNT sang eTax';
        const errorCode = explicitCode === 'AUTH_REQUIRED' || status === 403
          ? 'AUTH_REQUIRED'
          : (msg.includes('Chưa đăng nhập') || msg.includes('hết hạn'))
            ? 'SESSION_EXPIRED'
            : isTransportFailure
              ? 'CONNECTIVITY_ERROR'
              : 'ETAX_PARSE_ERROR';
        return {
          success: false,
          data: [],
          error: msg,
          errorCode
        };
      }
    }

    return {
      success: false,
      data: [],
      error: 'Tra cứu Giấy Nộp Tiền thất bại sau 2 lần thử.',
      errorCode: 'CONNECTIVITY_ERROR'
    };
  }

  /**
   * Lấy chi tiết Mẫu C1-02/NS của một GNT (có Single-Flight Deduplication & Caching).
   * verify: thông tin danh sách để ĐỐI CHIẾU chi tiết trả về — eTax nhiều lần
   * trả chi tiết của CHỨNG TỪ KHÁC (lệch trạng thái phiên DSE, tham số pn/sct
   * không khớp trang), trước đây bị cache vĩnh viễn và hiển thị sai số tiền.
   */
  public async getPaymentSlipDetail(
    ctuId: string,
    verify?: { soGnt?: string; maGiaoDich?: string }
  ): Promise<PaymentSlipDetail | null> {
    if (!ctuId) return null;

    // Cache chỉ được tin khi đã ĐỐI CHIẾU (verified) hoặc khi lần tải trước
    // không có tham số đối chiếu. Nếu caller lần này cung cấp verify params mà
    // entry trong cache CHƯA từng được đối chiếu → tải lại để kiểm chứng thay
    // vì trả dữ liệu chưa verify (tránh cache poisoning giữa prefetch không
    // verify và mở drawer có verify).
    const cached = this.detailCache.get(ctuId);
    if (cached) {
      const cacheVerified = this.detailCacheVerified.get(ctuId) === true;
      const needVerification = Boolean(verify?.maGiaoDich);
      if (cacheVerified || !needVerification) {
        return cached;
      }
      this.detailCache.delete(ctuId);
      this.detailCacheVerified.delete(ctuId);
    }

    if (this.inFlightDetailRequests.has(ctuId)) {
      return this.inFlightDetailRequests.get(ctuId)!;
    }

    const fetchOnce = async (forceRefreshSession: boolean): Promise<PaymentSlipDetail> => {
      await this.ensureEtaxSession(forceRefreshSession);
      this.assertQueryState(this.currentDseState);

      const params = new URLSearchParams();
      params.append('dse_sessionId', this.currentDseState.sessionId);
      params.append('dse_applicationId', this.currentDseState.applicationId!);
      params.append('dse_operationName', this.currentDseState.operationName!);
      params.append('dse_pageId', this.currentDseState.pageId!);
      params.append('dse_processorState', this.currentDseState.processorState!);
      params.append('dse_processorId', this.currentDseState.processorId!);
      if (this.currentDseState.errorPage) {
        params.append('dse_errorPage', this.currentDseState.errorPage);
      }
      params.append('dse_nextEventName', 'detail');
      params.append('pn', '1');
      params.append('sct', '');
      params.append('ctuId', ctuId);
      params.append('soGnt', verify?.soGnt || '');
      params.append('idBke', '');
      params.append('type_tax', PORTAL_CONFIG.GNT_TYPE_TAX);
      params.append('isReport', 'N');
      params.append('type', 'pdf');

      const res = await this.session.client.post(PORTAL_CONFIG.ETAX_REQUEST_API, params.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': PORTAL_CONFIG.ETAX_BASE_URL,
          'Referer': PORTAL_CONFIG.ETAX_REQUEST_API,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
        },
        timeout: 25000
      });

      const html = String(res.data || '');
      const responseKind = GdtResponseClassifier.classify(html);
      if (responseKind === 'LOGIN_PAGE') {
        const err = new Error('Phiên eTax đã hết hạn khi lấy chi tiết Giấy Nộp Tiền.');
        Object.assign(err, { code: 'SESSION_EXPIRED' });
        throw err;
      }
      if (responseKind !== 'GNT_DETAIL') {
        throw new Error(`eTax không trả về chứng từ GNT (response=${responseKind})`);
      }
      const parsed = GntParser.parseDetail(html, ctuId);
      return {
        id: parsed.id,
        soGnt: parsed.gntNo,
        maHieu: parsed.symbolCode,
        soChungTu: parsed.documentNo,
        soThamChieu: parsed.transactionRef,
        hinhThucNopTien: 'CHUYEN_KHOAN',
        loaiTien: parsed.currency || 'VND',
        nguoiNopThue: parsed.taxpayerName,
        maSoThue: parsed.taxpayerId,
        diaChi: parsed.address,
        tinhTp: parsed.province,
        nganHangTrichTk: parsed.debitBank,
        soTaiKhoanTrich: parsed.debitAccount,
        loaiTaiKhoanThu: 'TK_THU_NSNN',
        taiKhoanKbnn: parsed.treasuryAccount,
        tinhTpKbnn: parsed.treasuryProvince,
        nganHangUynhiemThu: parsed.collectingBank,
        coQuanQuanLyThu: parsed.collectionAgency,
        items: parsed.allocations.map(al => ({
          stt: al.sequence || 1,
          soToKhaiQuyetDinh: al.referenceDocumentNo,
          kyThueNgayQd: al.taxPeriodRaw,
          noiDungKhoanNop: al.description || '',
          soTienNguyenTe: al.originalAmount.raw || undefined,
          soTienVND: GntMoneyParser.formatVND(al.vndAmount.value),
          maChuong: al.chapterCode,
          maNDKT: al.ndktCode
        })),
        // Tổng tiền: chỉ điền khi parser xác định được GIÁ TRỊ THẬT. Khi bảng
        // chi tiết degenerate (0 dòng, #sum=0) tổng là MISSING → để RỖNG để UI
        // fallback về số tiền của bản ghi danh sách (trước đây "0" là chuỗi
        // truthy khiến mọi fallback || chết và UI hiển thị "TỔNG TIỀN: 0 đ").
        tongTienVND: parsed.totalVndAmount.status === 'VALID' ? GntMoneyParser.formatVND(parsed.totalVndAmount.value) : '',
        tongTienBangChu: parsed.totalTextVnd,
        signatures: parsed.signatures.map(s => ({
          signer: s.signerName,
          signedAt: s.signedAt || ''
        })),
        detailIntegrity: parsed.detailIntegrity,
        rawHtml: parsed.rawHtml
      };
    };

    // Đối chiếu chi tiết trả về với hồ sơ trên danh sách: Số tham chiếu (chi tiết) phải
    // trùng Mã giao dịch (danh sách). Cả hai phải có mặt mới coi là kiểm chứng được.
    const isVerifiedMatch = (d: PaymentSlipDetail): boolean | null => {
      if (!verify?.maGiaoDich) return null; // không đủ dữ liệu để kết luận
      const ref = (d.soThamChieu || '').trim();
      if (!ref) return null;
      return ref === verify.maGiaoDich.trim();
    };

    const detailPromise = (async () => {
      try {
        let detail = await fetchOnce(false);
        let match = isVerifiedMatch(detail);

        if (match === false) {
          // Lệch chứng từ → làm mới toàn bộ phiên eTax rồi tải lại ĐÚNG MỘT lần
          console.warn(`[PaymentSlipClient] Chi tiết GNT ${ctuId} LỆCH chứng từ (tham chiếu ${detail.soThamChieu} != maGD ${verify?.maGiaoDich}) -> làm mới phiên & tải lại`);
          this.currentDseState = { sessionId: '' };
          detail = await fetchOnce(true);
          match = isVerifiedMatch(detail);
        }

        if (match === false) {
          // Vẫn lệch: trả về kèm cờ cảnh báo, TUYỆT ĐỐI KHÔNG cache dữ liệu sai
          detail.suspectedMismatch = true;
          return detail;
        }

        // Chỉ cache khi (a) đã đối chiếu KHỚP, hoặc (b) không đủ dữ liệu đối
        // chiếu VÀ trang chi tiết không degenerate (có ít nhất 1 dòng khoản
        // nộp). Trang degenerate (0 dòng + tổng rỗng) là dấu hiệu parse hỏng —
        // không cache để lần gọi sau (có thể kèm verify) tải lại.
        const isDegenerate = detail.items.length === 0 && !detail.tongTienVND;
        if (match === true || (match === null && !isDegenerate)) {
          this.detailCache.set(ctuId, detail);
          this.detailCacheVerified.set(ctuId, match === true);
        }
        return detail;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[PaymentSlipClient] Lỗi khi lấy chi tiết GNT ${ctuId}: ${message}`);
        throw err;
      } finally {
        this.inFlightDetailRequests.delete(ctuId);
      }
    })();

    this.inFlightDetailRequests.set(ctuId, detailPromise);
    return detailPromise;
  }

  /**
   * Tra cứu toàn bộ Giấy nộp tiền theo dải ngày, tự động duyệt qua tất cả các trang kết quả (Auto-Pagination).
   * Lưu ý: khi tra cứu THẤT BẠI sẽ throw kèm errorCode thay vì trả mảng rỗng —
   * bảo vệ tính toàn vẹn dữ liệu, tránh nuốt lỗi thành "0 giấy nộp tiền".
   */
  public async searchPaymentSlips(
    range: DateRange,
    options: {
      maGiaoDich?: string;
      soGnt?: string;
      trangThai?: string;
      page?: number;
    } = {}
  ): Promise<PaymentSlipRecord[]> {
    // 1. Nếu chỉ định trang cụ thể, chỉ tra cứu 1 trang đơn lẻ
    if (options.page !== undefined && options.page > 0) {
      const res = await this.queryPaymentSlips({
        range,
        page: options.page
      });
      if (!res.success) {
        const err: any = new Error(res.error || 'Tra cứu Giấy Nộp Tiền thất bại');
        err.errorCode = res.errorCode;
        throw err;
      }
      return res.data;
    }

    // 2. Chế độ tra cứu toàn bộ: Tự động phân trang (Auto-Pagination Loop)
    const allRecords: PaymentSlipRecord[] = [];
    const seenIds = new Set<string>();

    const firstPageRes = await this.queryPaymentSlips({
      range,
      page: 1
    });

    if (!firstPageRes.success) {
      const err: any = new Error(firstPageRes.error || 'Tra cứu Giấy Nộp Tiền thất bại');
      err.errorCode = firstPageRes.errorCode;
      throw err;
    }

    for (const item of firstPageRes.data) {
      if (!seenIds.has(item.id)) {
        seenIds.add(item.id);
        allRecords.push(item);
      }
    }

    // KHÔNG đoán "trang cuối" theo số dòng/trang (server GDT giới hạn 20 dòng/trang
    // nhưng không cam kết cố định). Điều kiện dừng dựa trên dấu hiệu cấu trúc:
    // trang rỗng / không còn bản ghi mới / chạm trần MAX_PAGES.
    const MAX_PAGES = 50;
    for (let page = 2; page <= MAX_PAGES; page++) {
      let nextPageRes: { success: boolean; data: PaymentSlipRecord[]; error?: string; errorCode?: string };
      try {
        console.log(`[PaymentSlipClient] Tự động tải tiếp trang ${page} danh sách Giấy Nộp Tiền...`);
        nextPageRes = await this.queryPaymentSlips({ range, page });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[PaymentSlipClient] Lỗi phân trang tại trang ${page}: ${message}`);
        throw err;
      }

      if (!nextPageRes.success) {
        // BẤT KỂ lỗi gì giữa chừng phân trang (hết phiên, xác thực, mạng, NPE...),
        // dữ liệu thu được chắc chắn THIẾU — phải ném lỗi thay vì trả một phần
        // im lặng khiến đối chiếu/tổng hợp kết luận sai.
        const err: any = new Error(nextPageRes.error || 'Tra cứu Giấy Nộp Tiền thất bại giữa chừng phân trang');
        err.errorCode = nextPageRes.errorCode || 'CONNECTIVITY_ERROR';
        throw err;
      }

      if (!nextPageRes.data || nextPageRes.data.length === 0) {
        break; // Hết dữ liệu một cách chính đáng
      }

      let newRecordsCount = 0;
      for (const item of nextPageRes.data) {
        if (!seenIds.has(item.id)) {
          seenIds.add(item.id);
          allRecords.push(item);
          newRecordsCount++;
        }
      }

      // Trang không đem lại bản ghi mới nào -> đã hết dữ liệu hoặc server lặp trang
      if (newRecordsCount === 0) {
        break;
      }

      // Giãn cách nhẹ tránh nghẽn DSE
      await new Promise(r => setTimeout(r, 100));
    }

    console.log(`[PaymentSlipClient] Hoàn tất tra cứu: Đã thu thập tổng cộng ${allRecords.length} Giấy Nộp Tiền qua phân trang tự động`);
    return allRecords;
  }
}

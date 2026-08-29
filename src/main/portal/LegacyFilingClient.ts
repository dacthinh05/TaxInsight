import { PORTAL_CONFIG } from '../../shared/constants';
import { sanitizeFilename } from '../../shared/sanitizer';
import { TaxFiling } from '../../shared/types';
import fs from 'fs';
import path from 'path';
import { EtaxFormOption, EtaxFormState, EtaxFormStateParser } from './EtaxFormStateParser';
import { EtaxFilingResultParser, EtaxParseResult } from '../scanner/EtaxFilingResultParser';
import { PortalSession } from './PortalSession';
import { TaxPortalClient } from './TaxPortalClient';

export type LegacyFilingCheckpoint =
  | 'LEGACY_01_DVC_SESSION_VALID'
  | 'LEGACY_02_SSO_REQUESTED'
  | 'LEGACY_03_ETAX_ORIGIN_REACHED'
  | 'LEGACY_04_ETAX_AUTHENTICATED'
  | 'LEGACY_05_LOOKUP_SCREEN_OPENED'
  | 'LEGACY_06_QUERY_READY';

export interface LegacyFilingDiagnosticReport {
  checkpoints: Record<LegacyFilingCheckpoint, { status: 'PASS' | 'FAIL' | 'SKIPPED'; detail?: string }>;
  lastError?: string;
}

export class LegacyFilingClient {
  private session: PortalSession;
  private currentFormState: EtaxFormState = {
    actionUrl: '',
    dseSessionId: '',
    dseApplicationId: '',
    dsePageId: '',
    dseOperationName: '',
    dseProcessorState: '',
    hiddenFields: {},
    formValues: {}
  };
  private isEtaxInitialized = false;
  private inFlightInit: Promise<void> | null = null;
  private availableFormOptions: EtaxFormOption[] = [];
  private generation = 0;

  private latestDiagnostic: LegacyFilingDiagnosticReport = {
    checkpoints: {
      LEGACY_01_DVC_SESSION_VALID: { status: 'SKIPPED' },
      LEGACY_02_SSO_REQUESTED: { status: 'SKIPPED' },
      LEGACY_03_ETAX_ORIGIN_REACHED: { status: 'SKIPPED' },
      LEGACY_04_ETAX_AUTHENTICATED: { status: 'SKIPPED' },
      LEGACY_05_LOOKUP_SCREEN_OPENED: { status: 'SKIPPED' },
      LEGACY_06_QUERY_READY: { status: 'SKIPPED' }
    }
  };

  private etaxFilingsCache = new Map<number, TaxFiling[]>();

  constructor(session: PortalSession) {
    this.session = session;
  }

  public getDiagnosticReport(): LegacyFilingDiagnosticReport {
    return JSON.parse(JSON.stringify(this.latestDiagnostic));
  }

  public getAvailableFormOptions(): EtaxFormOption[] {
    return [...this.availableFormOptions];
  }

  public getFormState(): EtaxFormState {
    return { ...this.currentFormState };
  }

  private logCheckpoint(cp: LegacyFilingCheckpoint, status: 'PASS' | 'FAIL', detail?: string) {
    this.latestDiagnostic.checkpoints[cp] = { status, detail };
    const maskedDetail = detail ? detail.replace(/(sessionId|code|token)[=:]\s*[^&\s]+/gi, '$1=******') : '';
    console.log(`[LegacyFilingClient Checkpoint] ${cp}: ${status}${maskedDetail ? ` - ${maskedDetail}` : ''}`);
  }

  public reset() {
    this.generation++;
    this.etaxFilingsCache.clear();
    this.currentFormState = {
      actionUrl: '',
      dseSessionId: '',
      dseApplicationId: '',
      dsePageId: '',
      dseOperationName: '',
      dseProcessorState: '',
      hiddenFields: {},
      formValues: {}
    };
    this.isEtaxInitialized = false;
    this.inFlightInit = null;
    this.availableFormOptions = [];
    this.latestDiagnostic = {
      checkpoints: {
        LEGACY_01_DVC_SESSION_VALID: { status: 'SKIPPED' },
        LEGACY_02_SSO_REQUESTED: { status: 'SKIPPED' },
        LEGACY_03_ETAX_ORIGIN_REACHED: { status: 'SKIPPED' },
        LEGACY_04_ETAX_AUTHENTICATED: { status: 'SKIPPED' },
        LEGACY_05_LOOKUP_SCREEN_OPENED: { status: 'SKIPPED' },
        LEGACY_06_QUERY_READY: { status: 'SKIPPED' }
      }
    };
  }

  /**
   * Khởi tạo SSO từ Cổng Dịch vụ công sang màn hình Tra cứu tờ khai trên eTax
   */
  public async ensureEtaxSession(forceRefresh = false): Promise<void> {
    if (this.isEtaxInitialized && !forceRefresh && this.currentFormState.dseSessionId && this.currentFormState.dseOperationName === 'traCuuToKhaiProc') {
      this.logCheckpoint('LEGACY_06_QUERY_READY', 'PASS', 'Sử dụng phiên eTax tra cứu đã sẵn sàng');
      return;
    }

    if (this.inFlightInit) {
      return this.inFlightInit;
    }

    const initPromise = this.initializeEtaxSession(forceRefresh);
    this.inFlightInit = initPromise;
    try {
      await initPromise;
    } finally {
      if (this.inFlightInit === initPromise) {
        this.inFlightInit = null;
      }
    }
  }

  private async initializeEtaxSession(forceRefresh = false): Promise<void> {
    const activeGeneration = this.generation;
    try {
      if (forceRefresh) {
        this.isEtaxInitialized = false;
        this.currentFormState = {
          actionUrl: '',
          dseSessionId: '',
          dseApplicationId: '',
          dsePageId: '',
          dseOperationName: '',
          dseProcessorState: '',
          hiddenFields: {},
          formValues: {}
        };
      }
      // ── CHECKPOINT 01: DVC Session Validation ────────────────────────
      const cookies = await this.session.getCookieJar().getCookies(PORTAL_CONFIG.TCHS_URL);
      const hasDvcCookie = cookies.some(c => c.key.toLowerCase().includes('session') || c.key.toLowerCase().includes('token'));
      if (!hasDvcCookie && !this.session.getSessionInfo().isLoggedIn) {
        this.logCheckpoint('LEGACY_01_DVC_SESSION_VALID', 'FAIL', 'Chưa có session DVC hợp lệ');
        const authErr = new Error('Chưa đăng nhập hoặc phiên làm việc trên Cổng DVC đã hết hạn.');
        Object.assign(authErr, { code: 'AUTH_EXPIRED' });
        throw authErr;
      }
      this.logCheckpoint('LEGACY_01_DVC_SESSION_VALID', 'PASS', `Tìm thấy ${cookies.length} cookies DVC`);

      // ── CHECKPOINT 02: Lấy CSRF token và gửi SSO request ────────────
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

      const csrfFromHtml =
        dvcEntryHtml.match(/name=["']_csrf["']\s+value=["']([^"']+)["']/i)?.[1] ||
        dvcEntryHtml.match(/value=["']([^"']+)["']\s+name=["']_csrf["']/i)?.[1] ||
        dvcEntryHtml.match(/name=["']csrf-token["']\s+content=["']([^"']+)["']/i)?.[1] ||
        dvcEntryHtml.match(/content=["']([^"']+)["']\s+name=["']csrf-token["']/i)?.[1] ||
        '';
      const xsrfCookie = cookies.find(c => c.key === 'XSRF-TOKEN' || c.key.toLowerCase() === 'xsrf-token')?.value || '';
      const csrfToken = csrfFromHtml || decodeURIComponent(xsrfCookie);

      const ssoHeaders: Record<string, string> = {
        'Origin': 'https://dichvucong.gdt.gov.vn',
        'Referer': 'https://dichvucong.gdt.gov.vn/tthc/dich-vu-khac',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
        'X-Requested-With': 'XMLHttpRequest',
        'Accept': '*/*'
      };
      if (csrfToken) {
        ssoHeaders['X-XSRF-TOKEN'] = csrfToken;
      }

      this.logCheckpoint('LEGACY_02_SSO_REQUESTED', 'PASS', 'Gửi POST redirect-to-service?module=360103');

      // Module 360103: Tra cứu tờ khai trên eTax
      const ssoBody = new URLSearchParams();
      if (csrfToken) ssoBody.append('_csrf', csrfToken);

      const ssoRes = await this.session.client.post(
        `${PORTAL_CONFIG.SSO_REDIRECT_API}?module=360103`,
        ssoBody.toString(),
        {
          headers: {
            ...ssoHeaders,
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
          },
          timeout: 20000,
          maxRedirects: 5
        }
      );

      let redirectUrl = '';
      const resData = ssoRes.data;
      const resDataStr = typeof resData === 'string' ? resData : JSON.stringify(resData || '');
      const finalUrl = (ssoRes.request as any)?.res?.responseUrl || '';

      if (finalUrl && finalUrl.includes('thuedientu.gdt.gov.vn')) {
        redirectUrl = finalUrl;
      } else {
        const match = resDataStr.match(/https?:\/\/[^\s"'<>]+thuedientu\.gdt\.gov\.vn[^\s"'<>]+/i);
        if (match) {
          redirectUrl = match[0].replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
        } else if (typeof resData === 'string' && resData.startsWith('http')) {
          redirectUrl = resData.trim();
        }
      }

      if (!redirectUrl) {
        // Fallback kiểm tra link thuedientu trong trang dịch vụ khác
        const matchDirect = dvcEntryHtml.match(/https?:\/\/[^"'\s<>]*thuedientu\.gdt\.gov\.vn[^"'\s<>]*/i);
        if (matchDirect) {
          redirectUrl = matchDirect[0].replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
        }
      }

      if (!redirectUrl) {
        throw new Error('Không nhận được URL chuyển hướng eTax từ Cổng Dịch vụ công.');
      }

      this.logCheckpoint('LEGACY_03_ETAX_ORIGIN_REACHED', 'PASS', 'Nhận URL điều hướng eTax');

      // ── CHECKPOINT 03 & 04: Đi theo chuỗi điều hướng SSO của eTax ───────
      const etaxInitRes = await this.session.client.get(redirectUrl, {
        headers: {
          'Referer': 'https://dichvucong.gdt.gov.vn/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
        },
        timeout: 20000,
        maxRedirects: 5
      });

      const initHtml = String(etaxInitRes.data || '');
      await this.followRedirectChain(initHtml, redirectUrl, activeGeneration);
      this.assertGeneration(activeGeneration);

      if (!this.isLookupReady()) {
        const formError = new Error('Không khởi tạo được form tra cứu tờ khai eTax hợp lệ.');
        Object.assign(formError, { code: 'FORM_CHANGED' });
        throw formError;
      }
      this.isEtaxInitialized = true;
      const sessionSuffix = (this.currentFormState.dseSessionId || '').slice(-4);
      this.logCheckpoint('LEGACY_04_ETAX_AUTHENTICATED', 'PASS', `Session suffix: ***${sessionSuffix}`);

      // Nếu chưa ở màn hình tra cứu tờ khai thì kích hoạt mở traCuuToKhaiProc
      this.logCheckpoint('LEGACY_06_QUERY_READY', 'PASS', 'Sẵn sàng gửi form tra cứu');
    } catch (err: any) {
      this.latestDiagnostic.lastError = err.message;
      console.warn('[LegacyFilingClient] initializeEtaxSession error:', err.message);
      throw err;
    }
  }

  /**
   * Điều hướng theo chuỗi tự động của eTax như trình duyệt thật
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
      const parsedState = EtaxFormStateParser.parse(currentHtml);
      if (parsedState.isSessionExpired) {
        const authError = new Error('Phiên làm việc eTax đã hết hạn trong chuỗi SSO.');
        Object.assign(authError, { code: 'AUTH_EXPIRED' });
        throw authError;
      }
      if (parsedState.isErrorPage) {
        const serverError = new Error(parsedState.errorMessage || 'eTax trả về trang lỗi trong chuỗi SSO.');
        Object.assign(serverError, { code: 'SERVER_ERROR' });
        throw serverError;
      }
      this.mergeFormState(parsedState);

      const op = this.currentFormState.dseOperationName;
      if (this.isLookupReady()) {
        if (parsedState.formOptions?.length) {
          this.availableFormOptions = parsedState.formOptions;
        }
        this.logCheckpoint('LEGACY_05_LOOKUP_SCREEN_OPENED', 'PASS', 'Đã mở màn hình traCuuToKhaiProc');
        return;
      }

      const clean = (u: string) => u.replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
      let nextUrl = '';
      let nextMethod: 'GET' | 'POST' = 'GET';
      let postBody = '';

      const observedGoProc = currentHtml.match(
        /goProc\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/i
      );
      const isPluginGate =
        !observedGoProc &&
        (
          currentHtml.includes('Hệ thống đang thực hiện kiểm tra bản cập nhật') ||
          currentHtml.includes('Vui lòng cài đặt ứng dụng ký điện tử') ||
          (
            currentHtml.includes('checkInstall(8768)') &&
            /kiểm tra (?:plugin|ứng dụng|bản cập nhật)/i.test(currentHtml)
          )
        );

      if (isPluginGate) {
        // Không giả lập plugin/chữ ký số. Việc tự gửi corporateHomeProc với
        // page/state đoán từng gây request sai và có thể tạo bão request.
        const pluginError = new Error(
          'eTax yêu cầu xác thực tương tác/plugin. Vui lòng mở cửa sổ xác thực eTax trong ứng dụng rồi thử lại.'
        );
        Object.assign(pluginError, { code: 'SSO_INTERACTIVE_REQUIRED' });
        throw pluginError;
      } else {
        // Kiểm tra script auto-submit hoặc JS redirect
        const jsRedirect =
          currentHtml.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i) ||
          currentHtml.match(/location\.replace\(\s*["']([^"']+)["']\s*\)/i) ||
          currentHtml.match(/document\.location(?:\.href)?\s*=\s*["']([^"']+)["']/i);
        const metaRedirect = currentHtml.match(
          /<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["'][^"']*url=([^"'>]+)["'][^>]*>/i
        );
        const redirectTarget = (jsRedirect?.[1] || metaRedirect?.[1] || '').trim();
        if (redirectTarget && !redirectTarget.toLowerCase().startsWith('javascript')) {
          nextUrl = this.resolveEtaxUrl(clean(redirectTarget), currentUrl);
          nextMethod = 'GET';
        } else if (
          this.currentFormState.dseSessionId &&
          (this.currentFormState.actionUrl || Object.keys(this.currentFormState.hiddenFields).length > 0 || currentHtml.includes('dse_sessionId'))
        ) {
          // Form auto-submit
          const fields = { ...this.currentFormState.hiddenFields };
          // Kiểm tra xem script có đổi dse_operationName sang traCuuToKhaiProc không
          const scriptOp = currentHtml.match(/dse_operationName(?:\.value)?\s*=\s*["']([^"']+)["']/i);
          if (scriptOp) {
            fields['dse_operationName'] = scriptOp[1];
          }
          // Tìm sự kiện điều hướng tra cứu tờ khai từ link menu hoặc script
          const menuMatch = currentHtml.match(/goProc\s*\(\s*['"](traCuuToKhaiProc|corpTKhaiProc)['"]\s*,\s*['"]([^'"]+)['"]\s*\)/i) ||
            currentHtml.match(/dse_operationName=(traCuuToKhaiProc|corpTKhaiProc)[^&"'\s]*&dse_nextEventName=([^&"'\s]+)/i);
          if (observedGoProc) {
            fields['dse_operationName'] = observedGoProc[1];
            fields['dse_nextEventName'] = observedGoProc[2];
          } else if (menuMatch) {
            fields['dse_operationName'] = menuMatch[1];
            fields['dse_nextEventName'] = menuMatch[2];
          } else if (op === 'corpIndexProc' || op === 'corporateHomeProc' || op === 'corpJumpProc') {
            fields['dse_operationName'] = 'traCuuToKhaiProc';
            fields['dse_nextEventName'] = 'viewTraCuuTkhai';
          }
          nextUrl = this.resolveEtaxUrl(this.currentFormState.actionUrl || '/etaxnnt/Request', currentUrl);
          nextMethod = 'POST';
          postBody = new URLSearchParams(fields).toString();
        }
      }

      if (!nextUrl) {
        if (process.env.TAXINSIGHT_DEBUG_DUMP === '1') {
          try {
            const dumpPath = path.resolve(process.cwd(), 'data', 'legacy-form-changed.html');
            fs.mkdirSync(path.dirname(dumpPath), { recursive: true });
            fs.writeFileSync(dumpPath, currentHtml, 'utf-8');
          } catch {}
        }
        const formError = new Error(
          `Không xác định được bước điều hướng tiếp theo của eTax (operation=${op || 'unknown'}).`
        );
        Object.assign(formError, { code: 'FORM_CHANGED' });
        throw formError;
      }

      const stepKey = `${nextMethod}:${nextUrl}:${postBody}`;
      if (seenSteps.has(stepKey)) {
        if (this.currentFormState.dseSessionId) {
          // Phiên eTax đã mở và ổn định tại màn hình hiện tại
          this.isEtaxInitialized = true;
          return;
        }
        const loopError = new Error('Phát hiện vòng lặp điều hướng SSO eTax.');
        Object.assign(loopError, { code: 'FORM_CHANGED' });
        throw loopError;
      }
      seenSteps.add(stepKey);

      await this.sleep(250 + Math.random() * 250);

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
    }
    const hopError = new Error('Chuỗi điều hướng SSO eTax vượt giới hạn an toàn.');
    Object.assign(hopError, { code: 'FORM_CHANGED' });
    throw hopError;
  }

  /**
   * Thực hiện tra cứu tờ khai theo năm và trang
   */
  public async queryFilings(
    year: number,
    options: {
      maTKhai?: string;
      tenTKhai?: string;
      kieuKy?: string;
      ma_gd?: string;
      fromDate?: string; // 01/01/YYYY
      toDate?: string;   // 31/12/YYYY
      page?: number;
      signal?: AbortSignal;
    } = {}
  ): Promise<EtaxParseResult> {
    await this.ensureEtaxSession();
    await TaxPortalClient.waitForGlobalRateLimit(options.signal);

    const fromDate = options.fromDate || `01/01/${year}`;
    const toDate = options.toDate || `31/12/${year}`;
    const pageNum = options.page || 1;

    // `kieuKy` phải đến từ form HTML hiện hành hoặc mapping arrTKhai của chính
    // response đó. Không mặc định Q vì từng mẫu/năm có chu kỳ khác nhau.
    let kieuKy = options.kieuKy;
    const requestedFormCode = options.maTKhai || this.currentFormState.formValues.maTKhai || '00';
    if (!kieuKy && requestedFormCode !== '00') {
      const opt = this.availableFormOptions.find(o => o.value === requestedFormCode);
      if (opt?.kieuKy) kieuKy = opt.kieuKy;
    }
    if (!kieuKy) kieuKy = this.currentFormState.formValues.kieuKy;
    if (!kieuKy && requestedFormCode === '00') {
      // Trace xác nhận chế độ "Tất cả" gửi Q dù hidden kieuKy của form là
      // chuỗi rỗng. Chỉ áp dụng khi chính form sống hiện tại công bố Q trong
      // arrTKhai; nếu Q biến mất thì fail-closed thay vì đoán.
      const livePeriodTypes = new Set(
        this.availableFormOptions.map(option => option.kieuKy).filter(Boolean)
      );
      if (livePeriodTypes.has('Q')) kieuKy = 'Q';
    }

    const searchParams = EtaxFormStateParser.buildSearchParams(this.currentFormState, {
      maTKhai: requestedFormCode,
      tenTKhai: options.tenTKhai || '',
      kieuKy,
      ma_gd: options.ma_gd || '',
      qryFromDate: fromDate,
      qryToDate: toDate,
      pn: pageNum,
      nextEventName: 'query'
    });

    try {
      const actionUrl = this.resolveEtaxUrl(this.currentFormState.actionUrl, PORTAL_CONFIG.ETAX_REQUEST_API);
      const res = await this.session.client.post(actionUrl, searchParams.toString(), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Origin': PORTAL_CONFIG.ETAX_BASE_URL,
          'Referer': `${PORTAL_CONFIG.ETAX_BASE_URL}/etaxnnt/Request`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
        },
        signal: options.signal,
        timeout: 30000
      });

      const html = String(res.data || '');
      const parsedForm = EtaxFormStateParser.parse(html);

      if (parsedForm.isSessionExpired) {
        this.isEtaxInitialized = false;
        const err = new Error('Phiên làm việc eTax đã hết hạn.');
        Object.assign(err, { code: 'AUTH_EXPIRED' });
        throw err;
      }
      if (parsedForm.isErrorPage) {
        const err = new Error(parsedForm.errorMessage || 'eTax trả về trang lỗi khi tra cứu.');
        Object.assign(err, { code: 'SERVER_ERROR' });
        throw err;
      }
      this.mergeFormState(parsedForm);

      const parsedResults = EtaxFilingResultParser.parse(html);
      if (parsedResults.isFormChanged && parsedForm.isFormChanged) {
        const err = new Error(parsedResults.errorMessage || parsedForm.errorMessage || 'Cấu trúc bảng kết quả eTax đã thay đổi.');
        Object.assign(err, { code: 'FORM_CHANGED' });
        throw err;
      }
      return parsedResults;
    } catch (err: any) {
      if (err.response?.status === 429) {
        TaxPortalClient.triggerGlobalRateLimit(4000);
      }
      throw err;
    }
  }

  /**
   * Tải tệp tờ khai theo messageId
   */
  public async downloadFiling(
    messageId: string,
    signal?: AbortSignal
  ): Promise<{
    dataBuffer: Buffer;
    fileName: string;
    contentType: string;
  }> {
    await this.ensureEtaxSession();
    await TaxPortalClient.waitForGlobalRateLimit(signal);
    const safeMessageId = this.validateMessageId(messageId);
    this.assertLookupState();

    const params = new URLSearchParams();
    params.set('dse_sessionId', this.currentFormState.dseSessionId);
    params.set('dse_applicationId', this.currentFormState.dseApplicationId);
    params.set('dse_operationName', this.currentFormState.dseOperationName);
    params.set('dse_pageId', this.currentFormState.dsePageId);
    params.set('dse_processorState', this.currentFormState.dseProcessorState);
    params.set('dse_processorId', this.currentFormState.dseProcessorId!);
    if (this.currentFormState.dseErrorPage) {
      params.set('dse_errorPage', this.currentFormState.dseErrorPage);
    }
    params.set('dse_nextEventName', 'downTkhai');
    params.set('messageId', safeMessageId);

    const actionUrl = this.resolveEtaxUrl(this.currentFormState.actionUrl, PORTAL_CONFIG.ETAX_REQUEST_API);

    try {
      let res: any;
      try {
        res = await this.session.client.post(actionUrl, params.toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': `${PORTAL_CONFIG.ETAX_BASE_URL}/etaxnnt/Request`,
            'Origin': PORTAL_CONFIG.ETAX_BASE_URL,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
          },
          responseType: 'arraybuffer',
          signal,
          timeout: 45000
        });
        const testBuf = Buffer.from(res.data);
        const testHead = testBuf.subarray(0, 512).toString('utf-8').trimStart().toLowerCase();
        if (testHead.startsWith('<!doctype html') || testHead.startsWith('<html')) {
          // Nếu POST trả về HTML, thử tiếp GET
          throw new Error('POST trả về HTML, fallback GET');
        }
      } catch {
        res = await this.session.client.get(actionUrl, {
          params: Object.fromEntries(params.entries()),
          headers: {
            'Referer': `${PORTAL_CONFIG.ETAX_BASE_URL}/etaxnnt/Request`,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
          },
          responseType: 'arraybuffer',
          signal,
          timeout: 45000
        });
      }

      const buffer = Buffer.from(res.data);
      const contentType = String(res.headers?.['content-type'] || '');
      const disposition = String(res.headers?.['content-disposition'] || '');

      this.validateDownloadedBuffer(buffer, contentType);

      let fileName = `ETAX_${safeMessageId}.bin`;
      const fnMatch = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
      if (fnMatch && fnMatch[1]) {
        try {
          fileName = decodeURIComponent(fnMatch[1].trim());
        } catch {
          fileName = fnMatch[1].trim();
        }
      }
      fileName = sanitizeFilename(fileName, `ETAX_${safeMessageId}.bin`);

      return {
        dataBuffer: buffer,
        fileName,
        contentType
      };
    } catch (err: any) {
      if (err.response?.status === 429) {
        TaxPortalClient.triggerGlobalRateLimit(4000);
      }
      throw err;
    }
  }

  /**
   * Tự động tra cứu messageId trên eTax (nếu chưa có) và tải file XML/PDF gốc về máy
   */
  public async resolveAndDownloadFiling(
    taxCode: string,
    filing: TaxFiling,
    signal?: AbortSignal
  ): Promise<{
    dataBuffer: Buffer;
    fileName: string;
    contentType: string;
  }> {
    // 1. Nếu đã có messageId sẵn trong filing
    if (filing.messageId) {
      return await this.downloadFiling(filing.messageId, signal);
    }

    // 2. Xác định các năm cần tìm kiếm trên eTax (ưu tiên năm nộp thực tế vì eTax lọc theo Ngày nộp)
    const yearsToSearch: number[] = [];
    if (filing.submittedAt) {
      const subYearMatch = String(filing.submittedAt).match(/\b(20\d{2})\b/);
      if (subYearMatch) {
        const y = parseInt(subYearMatch[1], 10);
        if (!yearsToSearch.includes(y)) yearsToSearch.push(y);
      }
    }
    const periodText = String(filing.period || filing.periodNormalized?.raw || '');
    const periodYearMatch = periodText.match(/\b(20\d{2})\b/);
    if (periodYearMatch) {
      const y = parseInt(periodYearMatch[1], 10);
      if (!yearsToSearch.includes(y)) yearsToSearch.push(y);
    }
    if (yearsToSearch.length === 0) {
      yearsToSearch.push(new Date().getFullYear());
    }

    const cleanId = (filing.id || '').trim();
    const cleanPeriod = periodText.trim().toLowerCase().replace(/[\s\-_/]/g, '');
    const cleanPeriodDigits = periodText.match(/\b(20\d{2})\b/)?.[1] || '';
    const cleanCode = (filing.declarationCode || filing.procedureCode || filing.title || '').trim().toLowerCase().replace(/[\s\-_/]/g, '');
    const isQtt = cleanCode.includes('qtt') || cleanCode.includes('quyettoan') || cleanCode.includes('quyết toán') || (filing.title || '').toLowerCase().includes('quyết toán');

    // 3. Tìm kiếm lần lượt trong các năm
    for (const filingYear of yearsToSearch) {
      let etaxFilings = this.etaxFilingsCache.get(filingYear);
      if (!etaxFilings) {
        try {
          const queryResult = await this.queryFilings(filingYear, { signal });
          etaxFilings = queryResult.filings;
          this.etaxFilingsCache.set(filingYear, etaxFilings);
        } catch (queryErr: any) {
          console.warn(`[LegacyFilingClient] Tra cứu eTax năm ${filingYear} thất bại: ${queryErr?.message}`);
          continue;
        }
      }

      // 4. Khớp hồ sơ eTax với filing hiện tại
      let matched = etaxFilings.find(f => f.messageId && f.id === cleanId);
      if (!matched && filing.altIds && filing.altIds.length > 0) {
        matched = etaxFilings.find(f => f.messageId && filing.altIds?.some((alt: string) => alt === f.id || f.altIds?.includes(alt)));
      }
      if (!matched) {
        matched = etaxFilings.find(f => {
          if (!f.messageId) return false;
          const fPeriod = (f.period || f.periodNormalized?.raw || '').trim().toLowerCase().replace(/[\s\-_/]/g, '');
          const fPeriodDigits = (f.period || f.periodNormalized?.raw || '').match(/\b(20\d{2})\b/)?.[1] || '';
          const fCode = (f.declarationCode || f.procedureCode || f.title || '').trim().toLowerCase().replace(/[\s\-_/]/g, '');
          const fIsQtt = fCode.includes('qtt') || fCode.includes('quyettoan') || (f.title || '').toLowerCase().includes('quyết toán');

          // Khớp kỳ tính thuế
          let periodMatches = false;
          const keyA = (() => {
            const t = (f.period || f.periodNormalized?.raw || '').toLowerCase().replace(/[\s\-_/]/g, ' ');
            const mm = t.match(/(?:thang|tháng|t|m)?\s*0?(\d{1,2})\s*(?:nam|năm)?\s*(20\d{2})/i);
            if (mm && parseInt(mm[1], 10) >= 1 && parseInt(mm[1], 10) <= 12) return `M_${parseInt(mm[1], 10)}_${mm[2]}`;
            const qm = t.match(/(?:quy|quý|q)\s*0?([1-4])\s*(?:nam|năm)?\s*(20\d{2})/i);
            if (qm) return `Q_${qm[1]}_${qm[2]}`;
            const ym = t.match(/(20\d{2})/);
            return ym ? `Y_${ym[1]}` : t;
          })();
          const keyB = (() => {
            const t = periodText.toLowerCase().replace(/[\s\-_/]/g, ' ');
            const mm = t.match(/(?:thang|tháng|t|m)?\s*0?(\d{1,2})\s*(?:nam|năm)?\s*(20\d{2})/i);
            if (mm && parseInt(mm[1], 10) >= 1 && parseInt(mm[1], 10) <= 12) return `M_${parseInt(mm[1], 10)}_${mm[2]}`;
            const qm = t.match(/(?:quy|quý|q)\s*0?([1-4])\s*(?:nam|năm)?\s*(20\d{2})/i);
            if (qm) return `Q_${qm[1]}_${qm[2]}`;
            const ym = t.match(/(20\d{2})/);
            return ym ? `Y_${ym[1]}` : t;
          })();

          if (keyA && keyB && keyA === keyB) {
            periodMatches = true;
          } else if (fPeriod && cleanPeriod && (fPeriod === cleanPeriod || fPeriod.includes(cleanPeriod) || cleanPeriod.includes(fPeriod))) {
            periodMatches = true;
          } else if (cleanPeriodDigits && fPeriodDigits && cleanPeriodDigits === fPeriodDigits) {
            // Cùng năm quyết toán (ví dụ 'Năm 2025' vs '2025' vs '00/2025')
            if (isQtt || fIsQtt || cleanPeriod.includes('nam') || fPeriod.includes('nam')) {
              periodMatches = true;
            }
          }

          // Khớp loại tờ khai
          let codeMatches = false;
          if (isQtt && fIsQtt) {
            codeMatches = true;
          } else if (fCode && cleanCode && (
            fCode === cleanCode ||
            fCode.includes(cleanCode) ||
            cleanCode.includes(fCode) ||
            (fCode.includes('05') && cleanCode.includes('05')) ||
            (fCode.includes('tncn') && cleanCode.includes('tncn')) ||
            (fCode.includes('gtgt') && cleanCode.includes('gtgt')) ||
            (fCode.includes('01') && cleanCode.includes('01')) ||
            (fCode.includes('02') && cleanCode.includes('02')) ||
            (fCode.includes('03') && cleanCode.includes('03')) ||
            (fCode.includes('04') && cleanCode.includes('04')) ||
            (fCode.includes('tndn') && cleanCode.includes('tndn')) ||
            (fCode.includes('bc26') && cleanCode.includes('bc26')) ||
            (fCode.includes('hoa don') && cleanCode.includes('hoa don'))
          )) {
            codeMatches = true;
          } else if (f.taxType && filing.taxType && f.taxType === filing.taxType) {
            codeMatches = true;
          }

          const suppMatches = Number(f.supplementalNo || 0) === Number(filing.supplementalNo || 0);
          return periodMatches && codeMatches && suppMatches;
        });
      }

      if (matched && matched.messageId) {
        filing.messageId = matched.messageId;
        return await this.downloadFiling(matched.messageId, signal);
      }
    }

    throw new Error(`Không tìm thấy file tờ khai tương ứng trên eTax cho hồ sơ: ${filing.id} (${filing.declarationCode || filing.title})`);
  }

  /**
   * Tải tệp thông báo theo transaction / message ID
   */
  public async downloadNotice(
    messageId: string,
    signal?: AbortSignal
  ): Promise<{
    dataBuffer: Buffer;
    fileName: string;
    contentType: string;
  }> {
    await this.ensureEtaxSession();
    await TaxPortalClient.waitForGlobalRateLimit(signal);
    const safeMessageId = this.validateMessageId(messageId);
    this.assertLookupState();

    const params = new URLSearchParams();
    params.set('dse_sessionId', this.currentFormState.dseSessionId);
    params.set('dse_applicationId', this.currentFormState.dseApplicationId);
    params.set('dse_operationName', this.currentFormState.dseOperationName);
    params.set('dse_pageId', this.currentFormState.dsePageId);
    params.set('dse_processorState', this.currentFormState.dseProcessorState);
    params.set('dse_processorId', this.currentFormState.dseProcessorId!);
    if (this.currentFormState.dseErrorPage) {
      params.set('dse_errorPage', this.currentFormState.dseErrorPage);
    }
    params.set('dse_nextEventName', 'viewTBao');
    params.set('ctMaGDich', safeMessageId);

    const actionUrl = this.resolveEtaxUrl(this.currentFormState.actionUrl, PORTAL_CONFIG.ETAX_REQUEST_API);
    const res = await this.session.client.get(actionUrl, {
      params: Object.fromEntries(params.entries()),
      headers: {
        'Referer': `${PORTAL_CONFIG.ETAX_BASE_URL}/etaxnnt/Request`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
      },
      responseType: 'arraybuffer',
      signal,
      timeout: 45000
    });

    const buffer = Buffer.from(res.data);
    const contentType = String(res.headers?.['content-type'] || '');
    const disposition = String(res.headers?.['content-disposition'] || '');
    this.validateDownloadedBuffer(buffer, contentType);

    let fileName = `TBao_${safeMessageId}.bin`;
    const fnMatch = disposition.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i);
    if (fnMatch && fnMatch[1]) {
      try {
        fileName = decodeURIComponent(fnMatch[1].trim());
      } catch {
        fileName = fnMatch[1].trim();
      }
    }
    fileName = sanitizeFilename(fileName, `TBao_${safeMessageId}.bin`);

    return {
      dataBuffer: buffer,
      fileName,
      contentType
    };
  }

  private mergeFormState(newState: EtaxFormState) {
    if (newState.dseSessionId) this.currentFormState.dseSessionId = newState.dseSessionId;
    if (newState.dseApplicationId) this.currentFormState.dseApplicationId = newState.dseApplicationId;
    if (newState.dsePageId) this.currentFormState.dsePageId = newState.dsePageId;
    if (newState.dseOperationName) this.currentFormState.dseOperationName = newState.dseOperationName;
    if (newState.dseProcessorState) this.currentFormState.dseProcessorState = newState.dseProcessorState;
    if (newState.dseProcessorId) this.currentFormState.dseProcessorId = newState.dseProcessorId;
    if (newState.dseNextEventName) this.currentFormState.dseNextEventName = newState.dseNextEventName;
    if (newState.actionUrl) this.currentFormState.actionUrl = newState.actionUrl;

    this.currentFormState.hiddenFields = {
      ...this.currentFormState.hiddenFields,
      ...newState.hiddenFields
    };
    this.currentFormState.formValues = {
      ...this.currentFormState.formValues,
      ...newState.formValues
    };
    this.currentFormState.dseErrorPage = newState.dseErrorPage || this.currentFormState.dseErrorPage;
    this.currentFormState.pn = newState.pn || this.currentFormState.pn;
    this.currentFormState.isFormChanged = newState.isFormChanged;
    this.currentFormState.isSessionExpired = newState.isSessionExpired;
    this.currentFormState.isErrorPage = newState.isErrorPage;
  }

  private isLookupReady(): boolean {
    const validOp =
      this.currentFormState.dseOperationName === 'traCuuToKhaiProc' ||
      this.currentFormState.dseOperationName === 'corpQueryTaxProc';
    return (
      validOp &&
      Boolean(
        this.currentFormState.actionUrl &&
        this.currentFormState.dseSessionId &&
        this.currentFormState.dseApplicationId &&
        this.currentFormState.dsePageId &&
        this.currentFormState.dseProcessorId
      )
    );
  }

  private assertLookupState(): void {
    if (!this.isLookupReady()) {
      const error = new Error('Trạng thái form tra cứu eTax chưa đầy đủ hoặc đã thay đổi.');
      Object.assign(error, { code: 'FORM_CHANGED' });
      throw error;
    }
  }

  private assertGeneration(activeGeneration: number): void {
    if (activeGeneration !== this.generation) {
      const error = new Error('Chuỗi SSO cũ đã bị hủy do đăng xuất/đổi phiên.');
      Object.assign(error, { code: 'CANCELLED' });
      throw error;
    }
  }

  private resolveEtaxUrl(rawUrl: string, baseUrl: string): string {
    let resolved: URL;
    try {
      resolved = new URL(rawUrl, baseUrl);
    } catch {
      const error = new Error('URL điều hướng eTax không hợp lệ.');
      Object.assign(error, { code: 'FORM_CHANGED' });
      throw error;
    }
    const host = resolved.hostname.toLowerCase();
    if (
      resolved.protocol !== 'https:' ||
      (host !== 'thuedientu.gdt.gov.vn' && !host.endsWith('.gdt.gov.vn'))
    ) {
      const error = new Error('eTax trả về URL điều hướng ngoài miền GDT cho phép.');
      Object.assign(error, { code: 'FORM_CHANGED' });
      throw error;
    }
    return resolved.toString();
  }

  private validateMessageId(messageId: string): string {
    const value = String(messageId || '').trim();
    if (
      !value ||
      value.length > 256 ||
      !/^[^\s"'<>()[\]{}&=?#\\/]{1,256}$/.test(value)
    ) {
      const error = new Error('messageId tờ khai eTax không hợp lệ.');
      Object.assign(error, { code: 'DOWNLOAD_INVALID' });
      throw error;
    }
    return value;
  }

  private validateDownloadedBuffer(buffer: Buffer, contentType: string): void {
    if (!buffer.length) {
      const error = new Error('eTax trả về tệp rỗng.');
      Object.assign(error, { code: 'DOWNLOAD_INVALID' });
      throw error;
    }

    const headBuffer = buffer.subarray(0, Math.min(buffer.length, 8192));
    const head = headBuffer.toString('utf-8').replace(/^\uFEFF/, '').trimStart();
    const lowerHead = head.toLowerCase();
    const looksHtml =
      lowerHead.startsWith('<!doctype html') ||
      lowerHead.startsWith('<html') ||
      lowerHead.startsWith('<head') ||
      lowerHead.startsWith('<body') ||
      lowerHead.includes('modalcanbothuelogin') ||
      lowerHead.includes('hết phiên làm việc') ||
      lowerHead.includes('vui lòng đăng nhập');
    if (looksHtml || contentType.toLowerCase().includes('text/html')) {
      this.isEtaxInitialized = false;
      const error = new Error(
        /hết phiên|đăng nhập|modalcanbothuelogin/i.test(lowerHead)
          ? 'Phiên eTax đã hết hạn trong lúc tải hồ sơ.'
          : 'eTax trả về trang HTML thay vì tệp hồ sơ.'
      );
      Object.assign(error, {
        code: /hết phiên|đăng nhập|modalcanbothuelogin/i.test(lowerHead)
          ? 'AUTH_EXPIRED'
          : 'DOWNLOAD_INVALID'
      });
      throw error;
    }

    const isZip =
      buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
      buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x05, 0x06])) ||
      buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x07, 0x08]));
    const isPdf = buffer.subarray(0, 4).toString('ascii') === '%PDF';
    const isXml =
      head.startsWith('<?xml') ||
      /^<[A-Za-z_][\w.:-]*(?:\s|>)/.test(head);
    if (!isZip && !isPdf && !isXml) {
      const error = new Error('Định dạng tệp eTax không hợp lệ (không phải ZIP/XML/PDF).');
      Object.assign(error, { code: 'DOWNLOAD_INVALID' });
      throw error;
    }
  }

  private mustStopFallback(err: any): boolean {
    const status = Number(err?.response?.status || 0);
    const code = String(err?.code || '');
    if (status === 401 || status === 403 || status === 429 || status >= 500) return true;
    if (['RATE_LIMIT', 'SESSION_EXPIRED', 'AUTH_EXPIRED', 'CANCELLED'].includes(code)) return true;
    return false;
  }

  private sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { PORTAL_CONFIG } from '../../shared/constants';
import { sanitizeFilename } from '../../shared/sanitizer';
import { isValidTaxCode } from '../../shared/taxCodeUtils';
import { DateRange, PaymentSlipRecord, TaxFiling, TaxType } from '../../shared/types';
import { DownloadManager } from '../downloader/DownloadManager';
import { LegacyFilingDownloader } from '../downloader/LegacyFilingDownloader';
import { ExcelExporter } from '../exporter/ExcelExporter';
import { FileOrganizer } from '../files/FileOrganizer';
import { GntMoneyParser } from '../scanner/GntMoneyParser';
import { GntParser } from '../scanner/GntParser';
import { CaptchaManager } from '../portal/CaptchaManager';
import { PaymentSlipClient } from '../portal/PaymentSlipClient';
import { LegacyFilingClient } from '../portal/LegacyFilingClient';
import { PortalSession } from '../portal/PortalSession';
import { TaxPortalClient } from '../portal/TaxPortalClient';
import { CaptchaSolver } from '../scanner/CaptchaSolver';
import { TaxScanEngine } from '../scanner/TaxScanEngine';
import { LegacyFilingLookupWorkflow } from '../scanner/LegacyFilingLookupWorkflow';
import { VatAnalyticsEngine } from '../scanner/VatAnalyticsEngine';
import { PitAnalyticsEngine } from '../scanner/PitAnalyticsEngine';
import { ExcelVatReferenceExporter } from '../exporter/ExcelVatReferenceExporter';
import { ExcelPitReferenceExporter } from '../exporter/ExcelPitReferenceExporter';
import { buildC102Html, validateC102Detail } from '../exporter/C102PdfTemplate';
import {
  GntStatisticsEngine,
  GNT_BUCKET_LABELS,
  GntStatBucket,
  GntStatisticsResult
} from '../engine/GntStatisticsEngine';
import { AuditLogger } from '../persistence/AuditLogger';
import { CheckpointStore } from '../persistence/CheckpointStore';
import { GntCheckpointStore, GntCheckpointData } from '../persistence/GntCheckpointStore';
import { HistoricalCheckpointStore } from '../persistence/HistoricalCheckpointStore';
import { SettingsStore } from '../persistence/SettingsStore';
import { AccountStore } from '../persistence/AccountStore';
import { LicenseManager } from '../licensing/LicenseManager';
import { MachineIdProvider } from '../licensing/MachineIdProvider';
import { AppUpdater } from '../updater/AppUpdater';
import { ApiInspectorManager } from '../inspector/ApiInspectorManager';

export function setupIpcHandlers(
  session: PortalSession,
  client: TaxPortalClient,
  paymentSlipClient: PaymentSlipClient,
  legacyFilingClient: LegacyFilingClient,
  captchaManager: CaptchaManager,
  scanEngine: TaxScanEngine,
  downloadManager: DownloadManager,
  legacyFilingDownloader: LegacyFilingDownloader,
  legacyFilingWorkflow: LegacyFilingLookupWorkflow,
  fileOrganizer: FileOrganizer,
  checkpointStore: CheckpointStore,
  gntCheckpointStore: GntCheckpointStore,
  historicalCheckpointStore: HistoricalCheckpointStore,
  auditLogger: AuditLogger,
  sendToRenderer: (channel: string, data: any) => void
) {
  // Kết nối sender cho ApiInspector
  ApiInspectorManager.getInstance().setRendererSender(sendToRenderer);

  // ─── VALIDATOR INPUT TỪ RENDERER (chống path traversal qua taxCode/year) ──
  const normalizeYear = (v: unknown): number => {
    const n = typeof v === 'number' ? v : parseInt(String(v), 10);
    return Number.isFinite(n) && n >= 1900 && n <= 2200 ? n : new Date().getFullYear();
  };

  const normalizeHistoricalYear = (v: unknown): number => {
    const n = typeof v === 'number' ? Math.trunc(v) : parseInt(String(v), 10);
    if (!Number.isFinite(n) || n < 1900 || n > 2200) {
      throw new Error('Năm tra cứu tờ khai cũ không hợp lệ.');
    }
    return n;
  };

  const normalizeTaxType = (value: unknown): TaxType => {
    const allowed: TaxType[] = ['ALL', 'VAT', 'REFUND', 'PIT', 'CIT', 'FCT', 'HOUSE_LAND', 'REPORT', 'OTHER'];
    return allowed.includes(value as TaxType) ? value as TaxType : 'ALL';
  };

  const parsePortalDate = (value: unknown): Date => {
    const match = String(value || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!match) throw new Error('Ngày phải có định dạng dd/MM/yyyy.');
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day ||
      year < 1900 ||
      year > 2200
    ) {
      throw new Error('Khoảng ngày tra cứu không hợp lệ.');
    }
    return date;
  };

  const normalizeDateRange = (value: unknown): DateRange => {
    if (!value || typeof value !== 'object') throw new Error('Thiếu khoảng ngày tra cứu.');
    const input = value as Partial<DateRange>;
    const from = parsePortalDate(input.fromDate);
    const to = parsePortalDate(input.toDate);
    if (from.getTime() > to.getTime()) throw new Error('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');

    const maxSpanMs = 5 * 366 * 24 * 60 * 60 * 1000;
    if (to.getTime() - from.getTime() > maxSpanMs) {
      throw new Error('Một đợt quét chỉ được bao phủ tối đa 5 năm để tránh quá tải Cổng Thuế.');
    }

    const allowedLevels: DateRange['level'][] = ['YEAR', 'QUARTER', 'MONTH', 'MULTI_YEAR'];
    const level = allowedLevels.includes(input.level as DateRange['level'])
      ? input.level as DateRange['level']
      : 'YEAR';
    return {
      fromDate: String(input.fromDate),
      toDate: String(input.toDate),
      label: String(input.label || 'Khoảng tùy chọn').slice(0, 120),
      level
    };
  };

  const normalizeFilingList = (value: unknown): TaxFiling[] => {
    if (!Array.isArray(value)) throw new Error('Danh sách hồ sơ không hợp lệ.');
    if (value.length > 5000) throw new Error('Một lô chỉ được xử lý tối đa 5.000 hồ sơ.');
    return value.filter((filing): filing is TaxFiling =>
      Boolean(
        filing &&
        typeof filing === 'object' &&
        typeof filing.id === 'string' &&
        filing.id.trim() &&
        typeof filing.title === 'string'
      )
    );
  };

  const normalizeMstKey = (val: string): string => String(val || '').replace(/-ql$/i, '').trim().toLowerCase();

  const requireSessionTaxCode = (requested?: unknown): string => {
    const sessionTaxCode = String(session.getSessionInfo().taxCode || '').trim();
    if (!isValidTaxCode(sessionTaxCode)) {
      throw new Error('Phiên đăng nhập không có mã số thuế hợp lệ.');
    }
    const requestedTaxCode = String(requested || '').trim();
    if (requestedTaxCode && normalizeMstKey(requestedTaxCode) !== normalizeMstKey(sessionTaxCode)) {
      throw new Error('Mã số thuế yêu cầu không khớp phiên đăng nhập hiện tại.');
    }
    return sessionTaxCode;
  };

  const normalizeCtuId = (value: unknown): string => {
    const id = String(value || '').trim();
    if (!id || id.length > 128 || !/^[a-zA-Z0-9_.-]+$/.test(id)) {
      throw new Error('ID chứng từ GNT không hợp lệ.');
    }
    return id;
  };

  const normalizePaymentSlipList = (value: unknown): PaymentSlipRecord[] => {
    if (!Array.isArray(value)) throw new Error('Danh sách Giấy Nộp Tiền không hợp lệ.');
    if (value.length > 10000) throw new Error('Một lô chỉ được xử lý tối đa 10.000 Giấy Nộp Tiền.');
    return value.filter((slip): slip is PaymentSlipRecord =>
      Boolean(slip && typeof slip === 'object' && typeof slip.id === 'string' && slip.id.trim())
    );
  };

  const normalizeGntStatistics = (value: unknown): GntStatisticsResult => {
    if (!value || typeof value !== 'object') throw new Error('Dữ liệu thống kê GNT không hợp lệ.');
    const input = value as Partial<GntStatisticsResult>;
    if (!Array.isArray(input.cells) || input.cells.length > 10000) {
      throw new Error('Số ô thống kê GNT vượt giới hạn cho phép.');
    }
    const allowedBuckets: GntStatBucket[] = ['VAT', 'PIT', 'CIT', 'FCT', 'HOUSE_LAND', 'OTHER', 'NO_DETAIL'];
    const cells = input.cells.map(cell => {
      const monthKey = String(cell?.monthKey || '');
      const bucket = cell?.bucket as GntStatBucket;
      const totalAmount = Number(cell?.totalAmount);
      const slipCount = Number(cell?.slipCount);
      if (
        !/^(0[1-9]|1[0-2])\/\d{4}$/.test(monthKey) ||
        !allowedBuckets.includes(bucket) ||
        !Number.isSafeInteger(totalAmount) ||
        totalAmount < 0 ||
        !Number.isSafeInteger(slipCount) ||
        slipCount < 0
      ) {
        throw new Error('Một ô thống kê GNT có dữ liệu không hợp lệ.');
      }
      return { monthKey, bucket, totalAmount, slipCount };
    });
    const monthKeys = [...new Set(cells.map(cell => cell.monthKey))].sort((a, b) => {
      const [ma, ya] = a.split('/').map(Number);
      const [mb, yb] = b.split('/').map(Number);
      return ya - yb || ma - mb;
    });
    const activeBuckets = allowedBuckets.filter(bucket => cells.some(cell => cell.bucket === bucket));
    const grandTotal = cells.reduce((sum, cell) => {
      const next = sum + cell.totalAmount;
      if (!Number.isSafeInteger(next)) throw new Error('Tổng tiền GNT vượt giới hạn số nguyên an toàn.');
      return next;
    }, 0);
    const safeCount = (count: unknown) => {
      const n = Number(count);
      return Number.isSafeInteger(n) && n >= 0 ? n : 0;
    };
    return {
      cells,
      monthKeys,
      activeBuckets,
      grandTotal,
      paidCount: safeCount(input.paidCount),
      skippedUnpaidCount: safeCount(input.skippedUnpaidCount),
      noDetailCount: safeCount(input.noDetailCount)
    };
  };

  // ─── LẮNG NGHE SỰ KIỆN TỪ CORE ENGINE ĐỂ GỬI SANG RENDERER ───────────
  scanEngine.on('captcha_required', challenge => {
    auditLogger.log('INFO', 'Yêu cầu người dùng nhập mã CAPTCHA tra cứu', challenge.targetRange?.label);
    sendToRenderer('scan:captcha_required', challenge);
  });

  scanEngine.on('progress', state => {
    sendToRenderer('scan:progress', state);
  });

  scanEngine.on('log', ({ type, action }) => {
    auditLogger.log(type, action);
    sendToRenderer('audit:new_log', { type, action });
  });

  downloadManager.on('progress', data => {
    sendToRenderer('download:progress', data);
  });

  downloadManager.on('item_completed', ({ item, saveResult }) => {
    auditLogger.log('SUCCESS', `Tải thành công hồ sơ: ${item.filing.title}`, item.filing.id);
    // Checkpoint phải lưu theo (taxCode, year) CỦA ĐỢT TẢI, không phải năm hiện tại.
    // Merge trạng thái tải mới nhất của hàng đợi vào dữ liệu checkpoint sẵn có
    // để không làm mất các hồ sơ đã quét khác cùng năm.
    const { taxCode: ctxTaxCode, year: ctxYear } = downloadManager.getContext();
    if (isValidTaxCode(ctxTaxCode)) {
      const existing = checkpointStore.loadCheckpoint(ctxTaxCode, ctxYear);
      const merged: TaxFiling[] = [...(existing?.filings || [])];
      const indexById = new Map(merged.map((f, idx) => [f.id, idx]));

      for (const q of downloadManager.getQueue()) {
        const updatedFiling = q.filing;
        const existingIdx = indexById.get(updatedFiling.id);
        if (existingIdx !== undefined) {
          merged[existingIdx] = { ...merged[existingIdx], ...updatedFiling };
        } else {
          indexById.set(updatedFiling.id, merged.length);
          merged.push(updatedFiling);
        }
      }

      checkpointStore.saveCheckpoint(ctxTaxCode, ctxYear, merged);
    }
  });

  downloadManager.on('item_failed', ({ item, error }) => {
    auditLogger.log('ERROR', `Tải thất bại hồ sơ: ${item.filing.title}`, error);
  });

  downloadManager.on('completed', summary => {
    auditLogger.log('SUCCESS', `Hoàn thành đợt tải: ${summary.completed} thành công, ${summary.existing} có sẵn, ${summary.failed} lỗi`);
    sendToRenderer('download:completed', summary);
  });

  downloadManager.on('session_expired', () => {
    auditLogger.log('WARNING', 'Phiên làm việc hết hạn trong lúc tải hồ sơ');
    sendToRenderer('session:expired', {});
  });

  // ─── LEGACY FILING EVENT LISTENERS ──────────────────────────────────
  legacyFilingWorkflow.on('progress', data => {
    sendToRenderer('legacyFiling:progress', data);
  });

  legacyFilingWorkflow.on('state_change', ({ state, detail }) => {
    auditLogger.log('INFO', `Trạng thái tra cứu năm cũ: ${state}`, detail);
    sendToRenderer('legacyFiling:stateChange', { state, detail });
  });

  legacyFilingDownloader.on('progress', data => {
    sendToRenderer('legacyFiling:downloadProgress', data);
  });

  legacyFilingDownloader.on('completed', summary => {
    auditLogger.log('SUCCESS', `Hoàn thành tải tờ khai năm cũ: ${summary.completed} thành công, ${summary.existing} có sẵn, ${summary.failed} lỗi`);
    sendToRenderer('legacyFiling:downloadCompleted', summary);
  });

  legacyFilingDownloader.on('auth_expired', data => {
    auditLogger.log('WARNING', 'Phiên làm việc eTax hết hạn trong lúc tải hồ sơ năm cũ');
    sendToRenderer('legacyFiling:authExpired', data);
  });

  // ─── AUTH IPC HANDLERS ──────────────────────────────────────────────
  ipcMain.handle('auth:getCaptcha', async () => {
    try {
      const base64 = await client.getCaptchaImage('LOGIN');
      return { success: true, imageBase64: base64 };
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
        errorCode: err?.code || 'UNKNOWN',
        httpStatus: err?.httpStatus
      };
    }
  });

  ipcMain.handle('auth:solveCaptcha', async (_event, { imageBase64 }) => {
    try {
      // Cap kích thước đầu vào: chuỗi base64 khổng lồ từ renderer sẽ cấp phát
      // Buffer khổng lồ trong main process (memory DoS)
      const MAX_CAPTCHA_BASE64 = 10 * 1024 * 1024; // 10MB — captcha thật < 100KB
      if (typeof imageBase64 !== 'string' || imageBase64.length > MAX_CAPTCHA_BASE64) {
        return { success: false, error: 'Ảnh captcha không hợp lệ hoặc quá lớn.' };
      }
      const result = await CaptchaSolver.solveDetailed(imageBase64);
      const isAccepted = CaptchaSolver.isSafeForAutoSubmit(result);
      const recognizedText = (result.text && /^[a-z0-9]{4,6}$/i.test(result.text)) ? result.text.toLowerCase() : '';
      return {
        success: true,
        text: recognizedText,
        confidence: result.confidence,
        accepted: isAccepted
      };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('auth:login', async (_event, { taxCode, password, captcha }) => {
    try {
      const safeTaxCode = String(taxCode || '').trim();
      const safePassword = String(password || '');
      const safeCaptcha = String(captcha || '').trim();
      if (!isValidTaxCode(safeTaxCode)) {
        return { success: false, message: 'Mã số thuế không hợp lệ.', errorField: 'TAX_CODE' };
      }
      if (!safePassword || safePassword.length > 512) {
        return { success: false, message: 'Mật khẩu không hợp lệ.', errorField: 'PASSWORD' };
      }
      if (!/^[a-zA-Z0-9]{3,8}$/.test(safeCaptcha)) {
        return { success: false, message: 'Mã CAPTCHA không hợp lệ.', errorField: 'CAPTCHA' };
      }
      auditLogger.log('INFO', 'Bắt đầu đăng nhập Cổng Thuế', `MST: ${safeTaxCode}`);
      let res = await client.login(safeTaxCode, safePassword, safeCaptcha);
      if (!res.success && (res.errorField === 'PASSWORD' || (res.message && res.message.includes('mật khẩu không đúng'))) && /^\d{10}$/.test(safeTaxCode)) {
        // Tự động thử lại với hậu tố -ql nếu là MST 10 số doanh nghiệp
        try {
          const retryRes = await client.login(`${safeTaxCode}-ql`, safePassword, safeCaptcha);
          if (retryRes.success) {
            res = { ...retryRes, adjustedTaxCode: `${safeTaxCode}-ql` } as any;
          }
        } catch {}
      }
      if (res.success) {
        auditLogger.log('SUCCESS', 'Đăng nhập Cổng Thuế thành công', `MST: ${(res as any).adjustedTaxCode || safeTaxCode}`);
        // Tự động kích hoạt đồng bộ ngầm phiên eTax trong nền (show: false)
        triggerPaymentAuthWindow().catch(() => {});
      } else {
        auditLogger.log('WARNING', 'Đăng nhập không thành công', res.message);
      }
      return res;
    } catch (err: any) {
      auditLogger.log('ERROR', 'Lỗi ngoại lệ khi đăng nhập', err.message);
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('auth:loginSaved', async (_event, { taxCode, captcha }) => {
    try {
      const safeTaxCode = String(taxCode || '').trim();
      const safeCaptcha = String(captcha || '').trim();
      if (!isValidTaxCode(safeTaxCode)) {
        return { success: false, message: 'Mã số thuế không hợp lệ.', errorField: 'TAX_CODE' };
      }
      if (!/^[a-zA-Z0-9]{3,8}$/.test(safeCaptcha)) {
        return { success: false, message: 'Mã CAPTCHA không hợp lệ.', errorField: 'CAPTCHA' };
      }
      const credentials = AccountStore.getAccountCredentials(safeTaxCode);
      if (!credentials?.password) {
        return {
          success: false,
          message: 'Tài khoản này không có mật khẩu đã lưu hoặc không thể giải mã mật khẩu.',
          errorField: 'PASSWORD'
        };
      }

      auditLogger.log('INFO', 'Bắt đầu đăng nhập bằng thông tin đã lưu', `MST: ${safeTaxCode}`);
      const result = await client.login(safeTaxCode, credentials.password, safeCaptcha);
      if (result.success) {
        // Cập nhật lastUsedAt nhưng giữ nguyên ciphertext mật khẩu.
        AccountStore.saveAccount({
          taxCode: safeTaxCode,
          companyName: credentials.companyName
        });
        auditLogger.log('SUCCESS', 'Đăng nhập bằng thông tin đã lưu thành công', `MST: ${safeTaxCode}`);
        // Tự động kích hoạt đồng bộ ngầm phiên eTax trong nền (show: false)
        triggerPaymentAuthWindow().catch(() => {});
      } else {
        auditLogger.log('WARNING', 'Đăng nhập bằng thông tin đã lưu không thành công', result.message);
      }
      return result;
    } catch (err: any) {
      auditLogger.log('ERROR', 'Lỗi khi đăng nhập bằng thông tin đã lưu', err?.message);
      return { success: false, message: err?.message || 'Không thể đăng nhập bằng thông tin đã lưu.' };
    }
  });

  ipcMain.handle('auth:logout', async () => {
    scanEngine.cancelScan();
    downloadManager.cancel();
    legacyFilingWorkflow.cancel();
    legacyFilingDownloader.clearQueue();
    vatEngine.cancel();
    pitEngine.cancel();
    captchaManager.cancel('Phiên đã đăng xuất');
    session.clearSession();
    // Reset toàn bộ trạng thái phiên cũ: CSRF token, DSE session, cache chi tiết
    // — nếu không, lần đăng nhập tiếp theo (khác MST) sẽ dùng token/session của tài khoản trước
    client.reset();
    paymentSlipClient.reset();
    legacyFilingClient.reset();
    scanEngine.clearFilings();
    auditLogger.log('INFO', 'Người dùng đã đăng xuất');
    return { success: true };
  });

  ipcMain.handle('auth:getSession', async () => {
    return session.getSessionInfo();
  });

  ipcMain.handle('auth:checkSession', async () => {
    try {
      const isAlive = await client.checkSession();
      return { isAlive };
    } catch (err: any) {
      return {
        isAlive: false,
        transientError: true,
        error: err?.message || 'Không thể kiểm tra phiên Cổng Thuế'
      };
    }
  });

  // ─── SCAN IPC HANDLERS ──────────────────────────────────────────────
  ipcMain.handle('scan:start', async (_event, { year, taxType, scope, mstUyQuyen, limitToToday, customRange }) => {
    try {
      const safeYear = normalizeYear(year);
      const safeTaxType = normalizeTaxType(taxType);
      const safeCustomRange = customRange ? normalizeDateRange(customRange) : undefined;
      const safeAuthorizedTaxCode = mstUyQuyen ? String(mstUyQuyen).trim() : '';
      if (safeAuthorizedTaxCode && !isValidTaxCode(safeAuthorizedTaxCode)) {
        throw new Error('Mã số thuế ủy quyền không hợp lệ.');
      }
      const modeLabel = safeCustomRange ? safeCustomRange.label : limitToToday ? `đến ngày hiện tại` : `cả năm`;
      auditLogger.log('INFO', `Bắt đầu quét hồ sơ năm ${safeYear} (${modeLabel})`, `Loại thuế: ${safeTaxType}`);
      const result = await scanEngine.scanYear(safeYear, safeTaxType, {
        scope,
        mstUyQuyen: safeAuthorizedTaxCode || undefined,
        limitToToday: Boolean(limitToToday),
        customRange: safeCustomRange
      });

      auditLogger.log('SUCCESS', `Quét hoàn tất: Tìm thấy ${result.filings.length} hồ sơ năm ${safeYear}`);

      const sessionInfo = session.getSessionInfo();
      if (sessionInfo.taxCode) {
        checkpointStore.saveCheckpoint(sessionInfo.taxCode, safeYear, result.filings);
      }

      return { success: true, data: result };
    } catch (err: any) {
      auditLogger.log('ERROR', `Lỗi khi quét hồ sơ năm ${year}`, err.message);
      return {
        success: false,
        error: err.message,
        errorCode: err?.code || 'UNKNOWN',
        httpStatus: err?.httpStatus
      };
    }
  });

  ipcMain.handle('scan:submitCaptcha', async (_event, { captcha }) => {
    scanEngine.submitCaptcha(captcha);
    return { success: true };
  });

  ipcMain.handle('scan:cancel', async () => {
    scanEngine.cancelScan();
    auditLogger.log('WARNING', 'Người dùng đã hủy quá trình quét hồ sơ');
    return { success: true };
  });

  ipcMain.handle('filing:getPreview', async (_event, { filing }) => {
    try {
      const previewData = await client.getFilingPreview(filing);
      return { success: true, data: previewData };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ─── DOWNLOAD IPC HANDLERS ──────────────────────────────────────────
  ipcMain.handle('download:start', async (_event, { filings, taxCode, year }) => {
    try {
      const sessionTaxCode = String(session.getSessionInfo().taxCode || '').trim();
      const requestedTaxCode = String(taxCode || '').trim();
      if (!isValidTaxCode(sessionTaxCode)) {
        return { success: false, error: 'Phiên đăng nhập không có mã số thuế hợp lệ.' };
      }
      if (requestedTaxCode && normalizeMstKey(requestedTaxCode) !== normalizeMstKey(sessionTaxCode)) {
        return { success: false, error: 'Mã số thuế tải xuống không khớp phiên đăng nhập hiện tại.' };
      }
      const currentTaxCode = sessionTaxCode;
      if (!currentTaxCode) {
        return { success: false, error: 'Không xác định được mã số thuế hợp lệ để tải hồ sơ' };
      }
      const currentYear = normalizeYear(year ?? new Date().getFullYear());
      const safeFilings = normalizeFilingList(filings);
      if (!safeFilings.length) {
        return { success: false, error: 'Danh sách tải không có hồ sơ hợp lệ.' };
      }
      // Hỗ trợ tải mọi hồ sơ (kể cả hỗn hợp hiện hành và năm cũ)

      downloadManager.setContext(currentTaxCode, currentYear);
      downloadManager.enqueueFilings(safeFilings, currentTaxCode, currentYear);
      await downloadManager.start();

      auditLogger.log('INFO', `Bắt đầu tải hàng loạt ${safeFilings.length} hồ sơ`);
      return { success: true, summary: downloadManager.getSummary() };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('download:pause', async () => {
    downloadManager.pause();
    return { success: true };
  });

  ipcMain.handle('download:resume', async () => {
    try {
      await downloadManager.resume();
      auditLogger.log('INFO', 'Tiếp tục tiến trình tải hồ sơ');
      return { success: true, summary: downloadManager.getSummary() };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Không thể tiếp tục tải hồ sơ' };
    }
  });

  ipcMain.handle('download:cancel', async () => {
    downloadManager.cancel();
    auditLogger.log('WARNING', 'Người dùng đã hủy tiến trình tải hồ sơ');
    return { success: true };
  });

  ipcMain.handle('download:getSummary', async () => {
    return downloadManager.getSummary();
  });

  // ─── FILE & EXPORT IPC HANDLERS ─────────────────────────────────────
  ipcMain.handle('file:getBaseDir', async () => {
    return { success: true, path: fileOrganizer.getBaseDir() };
  });

  ipcMain.handle('file:selectDirectory', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Chọn thư mục lưu trữ hồ sơ thuế tải về',
      defaultPath: fileOrganizer.getBaseDir()
    });

    if (!res.canceled && res.filePaths.length > 0) {
      const selectedDir = res.filePaths[0];
      SettingsStore.setDownloadDir(selectedDir);
      fileOrganizer.setBaseDir(selectedDir);
      checkpointStore.setBaseDir(selectedDir);
      gntCheckpointStore.setBaseDir(selectedDir);
      historicalCheckpointStore.setBaseDir(selectedDir);
      auditLogger.setBaseDir(selectedDir);
      vatEngine.setBaseDir(selectedDir);
      pitEngine.setBaseDir(selectedDir);
      auditLogger.log('INFO', 'Đã thay đổi và lưu thư mục lưu trữ hồ sơ', selectedDir);
      return { success: true, path: selectedDir };
    }
    return { success: false };
  });

  ipcMain.handle('file:resetDirectory', async () => {
    const defaultDir = SettingsStore.resetDownloadDir();
    fileOrganizer.setBaseDir(defaultDir);
    checkpointStore.setBaseDir(defaultDir);
    gntCheckpointStore.setBaseDir(defaultDir);
    historicalCheckpointStore.setBaseDir(defaultDir);
    auditLogger.setBaseDir(defaultDir);
    vatEngine.setBaseDir(defaultDir);
    pitEngine.setBaseDir(defaultDir);
    auditLogger.log('INFO', 'Đã đặt lại thư mục lưu trữ về mặc định', defaultDir);
    return { success: true, path: defaultDir };
  });

  ipcMain.handle('file:setDirectory', async (_event, { customPath }: { customPath: string }) => {
    if (!customPath || typeof customPath !== 'string') {
      return { success: false, error: 'Đường dẫn không hợp lệ' };
    }
    try {
      // Hardening: thư mục lưu trữ phải là đường dẫn tuyệt đối, không nằm trong
      // các thư mục hệ thống — renderer bị chiếm không được redirect toàn bộ
      // bề mặt ghi file (download/export/checkpoint/audit log) vào Windows/Startup
      const resolved = path.resolve(customPath.trim());
      if (!path.isAbsolute(resolved)) {
        return { success: false, error: 'Thư mục lưu trữ phải là đường dẫn tuyệt đối.' };
      }
      const blockedPrefixes = [
        path.resolve(process.env.SystemRoot || 'C:\\Windows'),
        path.resolve(process.env.ProgramFiles || 'C:\\Program Files'),
        path.resolve(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)')
      ].map(p => p.toLowerCase());
      const resolvedLower = resolved.toLowerCase();
      if (blockedPrefixes.some(bp => resolvedLower === bp || resolvedLower.startsWith(bp + path.sep))) {
        return { success: false, error: 'Không được chọn thư mục hệ thống làm nơi lưu trữ hồ sơ.' };
      }

      SettingsStore.setDownloadDir(resolved);
      fileOrganizer.setBaseDir(resolved);
      checkpointStore.setBaseDir(resolved);
      gntCheckpointStore.setBaseDir(resolved);
      historicalCheckpointStore.setBaseDir(resolved);
      auditLogger.setBaseDir(resolved);
      vatEngine.setBaseDir(resolved);
      pitEngine.setBaseDir(resolved);
      auditLogger.log('INFO', 'Đã thiết lập thư mục lưu trữ hồ sơ', resolved);
      return { success: true, path: resolved };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('file:openPath', async (_event, { targetPath }) => {
    try {
      let finalPath = targetPath;
      if (!finalPath || typeof finalPath !== 'string' || finalPath.includes('Thư mục mặc định') || finalPath.includes('[object Object]')) {
        finalPath = fileOrganizer.getBaseDir();
      } else if (!path.isAbsolute(finalPath)) {
        // Làm sạch mọi chuỗi rác [object Object] hoặc dấu gạch dưới thừa
        const cleanSub = sanitizeFilename(finalPath)
          .replace(/\[object Object\]/gi, '')
          .replace(/_undefined/gi, '')
          .replace(/_+$/, '');
        finalPath = cleanSub ? path.join(fileOrganizer.getBaseDir(), cleanSub) : fileOrganizer.getBaseDir();
      }

      // Confinement: chỉ cho phép mở đường dẫn nằm trong thư mục lưu trữ của app
      // (chặn renderer bị chiếm quyền tạo thư mục / mở file tùy ý ngoài base dir)
      const resolvedBase = path.resolve(fileOrganizer.getBaseDir());
      if (!path.resolve(finalPath).startsWith(resolvedBase + path.sep) && path.resolve(finalPath) !== resolvedBase) {
        finalPath = resolvedBase;
      }

      if (!fs.existsSync(finalPath)) {
        fs.mkdirSync(finalPath, { recursive: true });
      }

      await shell.openPath(finalPath);
      return { success: true, path: finalPath };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('file:exportExcel', async (_event, { filings, year }) => {
    try {
      const taxCode = requireSessionTaxCode();
      const safeFilings = normalizeFilingList(filings);
      const outPath = await ExcelExporter.exportFilingsToExcel(
        safeFilings,
        fileOrganizer.getBaseDir(),
        taxCode,
        normalizeYear(year)
      );
      auditLogger.log('SUCCESS', 'Xuất danh sách hồ sơ ra file Excel thành công', outPath);
      return { success: true, filePath: outPath };
    } catch (err: any) {
      auditLogger.log('ERROR', 'Xuất Excel thất bại', err.message);
      return { success: false, error: err.message };
    }
  });

  // ─── PHÂN HỆ PHÂN TÍCH CHUYÊN SÂU GTGT (VAT ANALYTICS) ────────────
  const vatEngine = new VatAnalyticsEngine(client, fileOrganizer.getBaseDir(), legacyFilingClient);

  ipcMain.handle('vat:analyze', async (_event, { filings }) => {
    try {
      const taxCode = requireSessionTaxCode();
      const safeFilings = normalizeFilingList(filings);
      vatEngine.setBaseDir(fileOrganizer.getBaseDir());
      auditLogger.log('INFO', `Bắt đầu phân tích chuyên sâu ${safeFilings.length} tờ khai GTGT...`);
      const summary = await vatEngine.analyzeVatFilings(safeFilings, taxCode, (current, total, message) => {
        sendToRenderer('vat:progress', { current, total, message });
      });
      auditLogger.log(
        'SUCCESS',
        `Phân tích hoàn tất: ${summary.totalPeriodsCount} kỳ (${summary.periodsWithSupplementalCount} kỳ có bổ sung)` +
        (summary.failedXmlCount ? ` - CẢNH BÁO: ${summary.failedXmlCount}/${summary.totalFilingsCount} hồ sơ chưa tải được XML, số liệu đang trống` : ' - Đã có XML đầy đủ')
      );
      return { success: true, summary };
    } catch (err: any) {
      auditLogger.log('ERROR', 'Phân tích GTGT thất bại', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('vat:cancel', async () => {
    vatEngine.cancel();
    auditLogger.log('WARNING', 'Đã hủy tiến trình phân tích GTGT');
    return { success: true };
  });

  ipcMain.handle('vat:exportExcel', async (_event, { summary, year }) => {
    try {
      const taxCode = requireSessionTaxCode();
      const outPath = await ExcelVatReferenceExporter.exportVatReferenceToExcel(
        summary,
        fileOrganizer.getBaseDir(),
        taxCode,
        year
      );
      auditLogger.log('SUCCESS', 'Xuất Bảng đối chiếu GTGT ra file Excel thành công', outPath);
      return { success: true, filePath: outPath };
    } catch (err: any) {
      auditLogger.log('ERROR', 'Xuất Bảng đối chiếu GTGT ra Excel thất bại', err.message);
      return { success: false, error: err.message };
    }
  });

  // ─── PHÂN HỆ PHÂN TÍCH CHUYÊN SÂU TNCN (PIT ANALYTICS) ────────────
  const pitEngine = new PitAnalyticsEngine(client, fileOrganizer.getBaseDir(), legacyFilingClient);

  ipcMain.handle('pit:analyze', async (_event, { filings }) => {
    try {
      const taxCode = requireSessionTaxCode();
      const safeFilings = normalizeFilingList(filings);
      pitEngine.setBaseDir(fileOrganizer.getBaseDir());
      auditLogger.log('INFO', `Bắt đầu phân tích chuyên sâu ${safeFilings.length} tờ khai TNCN...`);
      const summary = await pitEngine.analyzePitFilings(safeFilings, taxCode, (current, total, message) => {
        sendToRenderer('pit:progress', { current, total, message });
      });
      auditLogger.log(
        'SUCCESS',
        `Phân tích TNCN hoàn tất: ${summary.totalFilingsAnalyzed} hồ sơ (${summary.periodGroups.length} kỳ)` +
        (summary.failedXmlCount ? ` - CẢNH BÁO: ${summary.failedXmlCount} hồ sơ chưa đọc được XML` : ' - Đã có XML đầy đủ')
      );
      return { success: true, summary };
    } catch (err: any) {
      auditLogger.log('ERROR', 'Phân tích TNCN thất bại', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('pit:cancel', async () => {
    pitEngine.cancel();
    auditLogger.log('WARNING', 'Đã hủy tiến trình phân tích TNCN');
    return { success: true };
  });

  ipcMain.handle('pit:exportExcel', async (_event, { summary, year }) => {
    try {
      requireSessionTaxCode();
      const res = await ExcelPitReferenceExporter.exportPitReference(
        summary,
        normalizeYear(year),
        fileOrganizer.getBaseDir()
      );
      if (res.success && res.filePath) {
        auditLogger.log('SUCCESS', 'Xuất Bảng đối chiếu TNCN ra file Excel thành công', res.filePath);
      }
      return res;
    } catch (err: any) {
      auditLogger.log('ERROR', 'Xuất Bảng đối chiếu TNCN ra Excel thất bại', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('app:openExternal', async (_event, { url }) => {
    try {
      if (!url || typeof url !== 'string') return { success: false, error: 'Invalid URL' };
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      const allowedHosts = new Set([
        'github.com',
        'www.github.com',
        'img.vietqr.io',
        'dichvucong.gdt.gov.vn',
        'thuedientu.gdt.gov.vn'
      ]);
      if (parsed.protocol === 'https:' && (allowedHosts.has(host) || host.endsWith('.gdt.gov.vn'))) {
        await shell.openExternal(url);
        return { success: true };
      }
      return { success: false, error: 'External host not allowed' };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ─── PHÂN HỆ GIẤY NỘP TIỀN (GNT - C1-02/NS) IPC HANDLERS ─────────
  ipcMain.handle('paymentSlips:getDiagnostics', async () => {
    return paymentSlipClient.getDiagnosticReport();
  });

  let paymentAuthWindow: BrowserWindow | null = null;
  let paymentAuthPromise: Promise<any> | null = null;

  const triggerPaymentAuthWindow = async (): Promise<any> => {
    if (paymentAuthPromise) {
      return paymentAuthPromise;
    }

    const authPromise = new Promise<any>(async (resolve) => {
      try {
        const authWin = new BrowserWindow({
          width: 1200,
          height: 800,
          show: true,
          center: true,
          autoHideMenuBar: true,
          title: 'Xác Thực Phiên Làm Việc eTax (Tra Cứu Giấy Nộp Tiền) - TaxInsight',
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
          }
        });

        authWin.webContents.setWindowOpenHandler(({ url }) => {
          // Chỉ điều hướng nội bộ trong hệ thống GDT/eTax.
          try {
            const target = new URL(url);
            if (
              target.protocol === 'https:' &&
              (target.hostname === 'gdt.gov.vn' || target.hostname.endsWith('.gdt.gov.vn'))
            ) {
              authWin.loadURL(target.toString()).catch(() => {});
            }
          } catch {}
          return { action: 'deny' };
        });

        // 1. Đồng bộ toàn bộ Cookie từ Axios Jar sang Electron Browser Session TRƯỚC KHI load URL
        const jar = session.getCookieJar();
        try {
          // Lấy theo URL nằm dưới /tthc để bao gồm cả cookie Path=/tthc.
          // Lấy theo origin trần từng làm mất cookie phiên khi copy sang Electron.
          const cookies = await jar.getCookies(PORTAL_CONFIG.TCHS_URL);
          for (const c of cookies) {
            const cookieDetails: Electron.CookiesSetDetails = {
              url: PORTAL_CONFIG.TCHS_URL,
              name: c.key,
              value: c.value,
              path: c.path || '/',
              secure: c.secure !== false,
              httpOnly: Boolean(c.httpOnly)
            };
            if (c.expires instanceof Date && Number.isFinite(c.expires.getTime())) {
              cookieDetails.expirationDate = c.expires.getTime() / 1000;
            }
            // Không truyền domain thủ công: Electron sẽ tạo host-only cookie
            // cho dichvucong.gdt.gov.vn. Domain lấy từ tough-cookie có thể là
            // parent domain và từng khiến BrowserWindow bị trả về /homelogin.
            await authWin.webContents.session.cookies.set(cookieDetails).catch(() => {});
          }
        } catch {}

        let hasClosed = false;
        let intervalId: ReturnType<typeof setInterval> | null = null;
        let authTimeoutId: ReturnType<typeof setTimeout> | null = null;
        let queryActivationPromise: Promise<boolean> | null = null;
        let isCheckingPage = false;

        const settleAuthWindow = (result: any, closeWindow = true) => {
          if (hasClosed) return;
          hasClosed = true;
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
          if (authTimeoutId) {
            clearTimeout(authTimeoutId);
            authTimeoutId = null;
          }
          if (closeWindow && !authWin.isDestroyed()) {
            authWin.close();
          }
          resolve(result);
        };

        const checkPageForEtaxSession = async () => {
          if (hasClosed || authWin.isDestroyed() || isCheckingPage) return;
          isCheckingPage = true;

          try {
            // A. Đồng bộ ngược cookie từ Browser Window vào Axios CookieJar
            const browserCookies = await authWin.webContents.session.cookies.get({});
            for (const bc of browserCookies) {
              const domain = bc.domain?.startsWith('.') ? bc.domain.slice(1) : bc.domain || 'gdt.gov.vn';
              const cookieUrl = `https://${domain}${bc.path || '/'}`;
              try {
                await jar.setCookie(`${bc.name}=${bc.value}; Domain=${bc.domain || domain}; Path=${bc.path || '/'}`, cookieUrl);
              } catch {}
            }

            // B. Phân tích DOM tìm Session ID eTax, GNT Form & Table Results
            const res = await authWin.webContents.executeJavaScript(`
              (() => {
                const currentUrl = window.location.href;
                const pageBody = document.body ? document.body.innerText : '';
                const isDvc = currentUrl.includes('dichvucong.gdt.gov.vn');
                const isEtax = currentUrl.includes('thuedientu.gdt.gov.vn');
                const isDvcLoginPage = /\/tthc\/(?:home)?login(?:[/?#]|$)/i.test(currentUrl);
                const isDvcSsoEndpoint = currentUrl.includes('/tthc/sso/redirect-to-service');

                // ─── 1. TỰ ĐỘNG CHUYỂN TIẾP SSO TỪ DVC SANG ETAX ────────────
                if (isDvc && !isDvcLoginPage && !isDvcSsoEndpoint) {
                  let banner = document.getElementById('taxinsight-sync-banner');
                  if (!banner) {
                    banner = document.createElement('div');
                    banner.id = 'taxinsight-sync-banner';
                    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999999;background:#0d9488;color:#fff;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 4px 16px rgba(0,0,0,0.3);font-family:system-ui,-apple-system,sans-serif;font-size:13px;font-weight:600;';
                    document.body.prepend(banner);
                  }
                  banner.innerHTML = '<span>⚡ TaxInsight: Đang chuyển tiếp sang phân hệ Tra cứu Giấy Nộp Tiền (eTax)...</span><button id="taxinsight-btn-sso" style="background:#fff;color:#0d9488;border:none;padding:6px 14px;border-radius:6px;font-weight:bold;cursor:pointer;">Chuyển ngay ↗</button>';
                  
                  const triggerSso = (manual = false) => {
                    const now = Date.now();
                    const attemptKey = 'taxinsight_sso_attempts';
                    const lastKey = 'taxinsight_sso_last_at';
                    const attempts = Number(sessionStorage.getItem(attemptKey) || '0');
                    const lastAt = Number(sessionStorage.getItem(lastKey) || '0');
                    if (now - lastAt < 5000 || (!manual && attempts >= 2)) {
                      banner.innerHTML = '<span>TaxInsight đã tạm dừng tự chuyển tiếp để tránh gửi lặp. Vui lòng chờ 5 giây rồi bấm Chuyển ngay.</span><button id="taxinsight-btn-sso" disabled style="background:#e2e8f0;color:#64748b;border:none;padding:6px 14px;border-radius:6px;font-weight:bold;">Đang chờ...</button>';
                      return;
                    }
                    sessionStorage.setItem(lastKey, String(now));
                    sessionStorage.setItem(attemptKey, String(attempts + 1));
                    const button = document.getElementById('taxinsight-btn-sso');
                    if (button) {
                      button.setAttribute('disabled', 'true');
                      button.textContent = 'Đang chuyển...';
                    }
                    // Điều hướng bằng đúng MỘT POST. Trước đây fetch trước rồi
                    // fallback form POST khi body không phải URL/lỗi mạng, khiến
                    // cùng một thao tác SSO có thể chạm server hai lần.
                    const f = document.createElement('form');
                    f.method = 'POST';
                    f.action = '/tthc/sso/redirect-to-service?module=330410';
                    f.target = '_self';
                    const csrfEl = document.querySelector('input[name="_csrf"]') || document.querySelector('meta[name="csrf-token"]') || document.querySelector('meta[name="_csrf"]');
                    const csrf = (csrfEl && (csrfEl.value || csrfEl.content)) || '';
                    if (csrf) {
                      const csrfInput = document.createElement('input');
                      csrfInput.type = 'hidden';
                      csrfInput.name = '_csrf';
                      csrfInput.value = csrf;
                      f.appendChild(csrfInput);
                    }
                    document.body.appendChild(f);
                    f.submit();
                  };

                  document.getElementById('taxinsight-btn-sso')?.addEventListener('click', () => triggerSso(true));

                  if (!window._taxinsight_sso_triggered) {
                    window._taxinsight_sso_triggered = true;
                    setTimeout(triggerSso, 600);
                  }
                }

                // ─── 2. TỰ ĐỘNG ĐIỀU HƯỚNG & TRA CỨU TRÊN ETAX ───────────────
                if (isEtax) {
                  let banner = document.getElementById('taxinsight-sync-banner');
                  if (!banner) {
                    banner = document.createElement('div');
                    banner.id = 'taxinsight-sync-banner';
                    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999999;background:#0d9488;color:#fff;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 4px 16px rgba(0,0,0,0.3);font-family:system-ui,-apple-system,sans-serif;font-size:13px;font-weight:600;';
                    document.body.prepend(banner);
                  }

                  const isGntForm = pageBody.includes('Tra cứu giấy nộp tiền') || Boolean(document.querySelector('input[name="ngay_lap_tu_ngay"], input[value="Tra cứu"], #btnSearch, .btn-search'));
                  
                  if (!isGntForm) {
                    banner.innerHTML = '<span>⚡ TaxInsight: Đang vào mục Tra cứu Giấy nộp tiền...</span>';
                    const menuItems = Array.from(document.querySelectorAll('a, td, span, div'));
                    const traCuuMenu = menuItems.find(el => el.textContent && el.textContent.trim().toLowerCase() === 'tra cứu' && el.getAttribute('href')?.includes('corpQueryTaxProc'));
                    if (traCuuMenu && typeof traCuuMenu.click === 'function') {
                      traCuuMenu.click();
                    }
                  } else {
                    banner.innerHTML = '<span>⚡ TaxInsight: Đã kết nối form Tra cứu! Đang tự động nạp dữ liệu...</span><button id="taxinsight-btn-search" style="background:#fff;color:#0d9488;border:none;padding:6px 14px;border-radius:6px;font-weight:bold;cursor:pointer;">Tra Cứu Ngay 🔍</button>';

                    const searchBtn = document.querySelector('input[value="Tra cứu"], input[value="Tra Cứu"], button.btn-search, #btnSearch') || 
                                      Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a')).find(el => el.textContent && el.textContent.trim().toLowerCase() === 'tra cứu');
                    
                    document.getElementById('taxinsight-btn-search')?.addEventListener('click', () => {
                      if (searchBtn && typeof searchBtn.click === 'function') searchBtn.click();
                    });

                    // Tự động điền ngày nếu trống và click tra cứu
                    if (!window._taxinsight_search_triggered) {
                      window._taxinsight_search_triggered = true;
                      
                      const fromDateInput = document.querySelector('input[name="ngay_lap_tu_ngay"], #ngay_lap_tu_ngay');
                      const toDateInput = document.querySelector('input[name="ngay_lap_den_ngay"], #ngay_lap_den_ngay');
                      if (fromDateInput && !fromDateInput.value) {
                        const currentYear = new Date().getFullYear();
                        fromDateInput.value = '01/01/' + (currentYear - 1);
                      }
                      if (toDateInput && !toDateInput.value) {
                        const now = new Date();
                        const dd = String(now.getDate()).padStart(2, '0');
                        const mm = String(now.getMonth() + 1).padStart(2, '0');
                        toDateInput.value = dd + '/' + mm + '/' + now.getFullYear();
                      }

                      setTimeout(() => {
                        if (searchBtn && typeof searchBtn.click === 'function') {
                          searchBtn.click();
                        }
                      }, 500);
                    }
                  }
                }

                // ─── 3. TRÍCH XUẤT BẢNG KẾT QUẢ VÀ DSE STATE ──────────────────
                const resultTable = document.querySelector('#allResultTableBody') || document.querySelector('table.table-result, table.table_data, table');
                let tableHtml = '';
                if (resultTable && (resultTable.innerHTML.includes('Giao dịch') || resultTable.innerHTML.includes('chiTietCT') || resultTable.innerHTML.includes('VND') || resultTable.querySelectorAll('tr').length > 1)) {
                  tableHtml = resultTable.outerHTML;
                }

                // Tìm kiếm dse_sessionId trong DOM & Iframes
                let sessInput = document.querySelector('input[name="dse_sessionId"]');
                let appInput = document.querySelector('input[name="dse_applicationId"]');
                let pageInput = document.querySelector('input[name="dse_pageId"]');
                let opInput = document.querySelector('input[name="dse_operationName"]');
                let stateInput = document.querySelector('input[name="dse_processorState"]');
                let procInput = document.querySelector('input[name="dse_processorId"]');
                let errorInput = document.querySelector('input[name="dse_errorPage"]');

                if (!sessInput) {
                  const iframes = document.querySelectorAll('iframe');
                  for (const iframe of iframes) {
                    try {
                      const idoc = iframe.contentDocument || iframe.contentWindow.document;
                      if (idoc) {
                        sessInput = sessInput || idoc.querySelector('input[name="dse_sessionId"]');
                        appInput = appInput || idoc.querySelector('input[name="dse_applicationId"]');
                        pageInput = pageInput || idoc.querySelector('input[name="dse_pageId"]');
                        opInput = opInput || idoc.querySelector('input[name="dse_operationName"]');
                        stateInput = stateInput || idoc.querySelector('input[name="dse_processorState"]');
                        procInput = procInput || idoc.querySelector('input[name="dse_processorId"]');
                        errorInput = errorInput || idoc.querySelector('input[name="dse_errorPage"]');
                        const iframeTable = idoc.querySelector('#allResultTableBody') || idoc.querySelector('table');
                        if (iframeTable && !tableHtml) tableHtml = iframeTable.outerHTML;
                      }
                    } catch (e) {}
                  }
                }

                let sessVal = sessInput ? (sessInput.value || '') : '';
                if (!sessVal) {
                  const match = document.documentElement.innerHTML.match(/dse_sessionId\\s*=\\s*["']([^"']+)["']/i) ||
                                document.documentElement.innerHTML.match(/name=["']dse_sessionId["']\\s+value=["']([^"']+)["']/i);
                  if (match) sessVal = match[1];
                }

                return {
                  sessionId: sessVal || '',
                  applicationId: appInput ? (appInput.value || '') : '',
                  pageId: pageInput ? (pageInput.value || '') : '',
                  operationName: opInput ? (opInput.value || '') : '',
                  processorState: stateInput ? (stateInput.value || '') : '',
                  processorId: procInput ? (procInput.value || '') : '',
                  errorPage: errorInput ? (errorInput.value || '') : '',
                  currentUrl,
                  isGntFormPresent: pageBody.includes('Tra cứu giấy nộp tiền'),
                  tableHtml,
                  isAtEtax: isEtax
                };
              })()
            `);
            const etaxCookies = await authWin.webContents.session.cookies.get({ domain: 'thuedientu.gdt.gov.vn' });

            // JSESSIONID chỉ là cookie phiên HTTP, không phải dse_sessionId.
            // Dùng nó làm DSE state khiến request query/detail gửi sai session,
            // đặc biệt với GNT/TNCN sau khi cửa sổ eTax vừa mở.
            const dseSessionId = res?.sessionId || '';
            const etaxJsession = etaxCookies.find(c => c.name.toLowerCase().includes('jsession'))?.value;

            const isManualStateAccepted = dseSessionId
              ? paymentSlipClient.setManualSessionState({
                  sessionId: dseSessionId,
                  applicationId: String(res?.applicationId || ''),
                  pageId: String(res?.pageId || ''),
                  operationName: String(res?.operationName || ''),
                  processorState: String(res?.processorState || ''),
                  processorId: String(res?.processorId || ''),
                  errorPage: String(res?.errorPage || ''),
                  actionUrl: res?.currentUrl
                })
              : false;
            let isManualStateReady = false;
            if (isManualStateAccepted) {
              if (!queryActivationPromise) {
                queryActivationPromise = paymentSlipClient.activateManualSessionForQuery();
              }
              try {
                isManualStateReady = await queryActivationPromise;
              } catch (activationError: any) {
                console.warn(
                  '[paymentSlips:openAuthWindow] Backend chưa mở được form GNT từ DSE state hiện tại:',
                  activationError?.message || activationError
                );
              } finally {
                queryActivationPromise = null;
              }
            }
            if (res?.isDvcLoginPage && !authWin.isDestroyed() && !authWin.isVisible()) {
              // Chỉ hiển thị cửa sổ khi Cổng Thuế thực sự yêu cầu nhập CAPTCHA/mật khẩu lại
              authWin.show();
              authWin.focus();
            }

            if (dseSessionId && !isManualStateAccepted) {
              console.log('[paymentSlips:openAuthWindow] Đã có dse_sessionId nhưng form GNT chưa đủ state; tiếp tục chờ.');
            } else if (isManualStateAccepted && !isManualStateReady) {
              console.log('[paymentSlips:openAuthWindow] Đã nhận DSE state; backend đang chờ form tra cứu GNT hợp lệ.');
            } else if (etaxJsession) {
              console.log('[paymentSlips:openAuthWindow] Đã vào eTax nhưng chưa có dse_sessionId; tiếp tục chờ trang truy vấn.');
            }

            if (isManualStateReady && res && res.tableHtml && (res.tableHtml.includes('Giao dịch') || res.tableHtml.includes('chiTietCT') || res.tableHtml.includes('VND'))) {
              const gntRecords = GntParser.parseList(res.tableHtml);
              if (gntRecords.length > 0) {
                hasClosed = true;
                const records: PaymentSlipRecord[] = gntRecords.map(item => ({
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
                auditLogger.log('SUCCESS', `Trích xuất ${records.length} GNT và đồng bộ phiên eTax thành công`);
                settleAuthWindow({ success: true, paymentSlips: records, sessionId: dseSessionId });
                return;
              }
            }

            if (isManualStateReady) {
              auditLogger.log('SUCCESS', 'Xác thực phiên eTax thành công qua cửa sổ trình duyệt', `Session: ${dseSessionId.slice(0, 6)}***`);
              settleAuthWindow({ success: true, sessionId: dseSessionId });
            }
          } catch {
          } finally {
            isCheckingPage = false;
          }
        };

        authWin.webContents.on('did-finish-load', checkPageForEtaxSession);
        authWin.webContents.on('did-navigate', checkPageForEtaxSession);
        authWin.webContents.on('did-navigate-in-page', checkPageForEtaxSession);
        authWin.webContents.on('dom-ready', checkPageForEtaxSession);

        // Lặp kiểm tra mỗi 1500ms
        intervalId = setInterval(async () => {
          if (authWin.isDestroyed() || hasClosed) {
            if (intervalId) {
              clearInterval(intervalId);
              intervalId = null;
            }
            return;
          }
          await checkPageForEtaxSession();
        }, 1500);

        // Không để IPC treo vô hạn khi eTax chỉ cấp JSESSIONID hoặc thay đổi DOM
        // khiến không thể lấy đủ DSE state. Người dùng có thể mở lại để thử tiếp.
        authTimeoutId = setTimeout(() => {
          auditLogger.log('WARNING', 'Cửa sổ xác thực eTax hết thời gian chờ', 'Không lấy được form GNT hợp lệ sau 90 giây');
          settleAuthWindow({
            success: false,
            errorCode: 'AUTH_TIMEOUT',
            error: 'Hết thời gian chờ xác thực eTax (90 giây). Vui lòng mở lại cửa sổ và thử lại.'
          });
        }, 90_000);

        authWin.on('closed', () => {
          if (paymentAuthWindow === authWin) paymentAuthWindow = null;
          if (!hasClosed) {
            settleAuthWindow({ success: false, message: 'Người dùng đã đóng cửa sổ xác thực.' }, false);
          }
        });

        // Bootstrap trang home để Electron nhận/refresh đầy đủ cookie phiên DVC.
        // Listener phía trên sẽ chờ portal rời /homelogin|/login rồi mới gửi
        // POST SSO từ trang DVC đã xác thực.
        authWin.loadURL('https://dichvucong.gdt.gov.vn/tthc/home?isChooseDgDinhKy=Y')
          .catch(err => {
            auditLogger.log('ERROR', 'Không thể tải trang xác thực eTax', err?.message || String(err));
            if (!authWin.isDestroyed() && !hasClosed) {
              settleAuthWindow({ success: false, error: `Không thể tải trang xác thực eTax: ${err?.message || err}` });
            }
          });
      } catch (err: any) {
        resolve({ success: false, error: err.message });
      }
    });
    paymentAuthPromise = authPromise;
    try {
      return await authPromise;
    } finally {
      if (paymentAuthPromise === authPromise) paymentAuthPromise = null;
      if (paymentAuthWindow?.isDestroyed()) paymentAuthWindow = null;
    }
  };

  ipcMain.handle('paymentSlips:openAuthWindow', async () => {
    return triggerPaymentAuthWindow();
  });

  ipcMain.handle('paymentSlips:scan', async (_event, { range, options }) => {
    try {
      const safeRange = normalizeDateRange(range);
      auditLogger.log('INFO', `Bắt đầu tra cứu Giấy Nộp Tiền (${safeRange.fromDate} → ${safeRange.toDate})`);
      const results = await paymentSlipClient.searchPaymentSlips(safeRange, options || {});
      auditLogger.log('SUCCESS', `Tìm thấy ${results.length} Giấy Nộp Tiền trên eTax`);
      return { success: true, paymentSlips: results };
    } catch (err: any) {
      // Tự động xác thực ngầm và retry nếu eTax yêu cầu phiên duyệt
      if (
        err?.errorCode === 'AUTH_REQUIRED' ||
        err?.code === 'SSO_INTERACTIVE_REQUIRED' ||
        err?.errorCode === 'ETAX_SESSION_EXPIRED' ||
        (err?.message && err.message.includes('xác thực tương tác'))
      ) {
        try {
          auditLogger.log('INFO', 'Tự động xác thực phiên eTax ngầm và thử lại tra cứu GNT...');
          const authRes = await triggerPaymentAuthWindow();
          if (authRes?.success) {
            const safeRange = normalizeDateRange(range);
            const retryResults = await paymentSlipClient.searchPaymentSlips(safeRange, options || {});
            auditLogger.log('SUCCESS', `Tìm thấy ${retryResults.length} Giấy Nộp Tiền sau khi tự động xác thực`);
            return { success: true, paymentSlips: retryResults };
          }
        } catch (autoErr: any) {
          console.warn('[paymentSlips:scan] Tự động xác thực ngầm thất bại:', autoErr?.message);
        }
      }

      const sessionInfo = session.getSessionInfo();
      auditLogger.log(
        'ERROR',
        `Tra cứu Giấy Nộp Tiền thất bại [MST: ${sessionInfo.taxCode || 'N/A'}]`,
        `${err.errorCode || 'UNKNOWN'} | ${err.message}`
      );
      return {
        success: false,
        error: err.message,
        errorCode: err.errorCode || 'ETAX_ERROR',
        paymentSlips: []
      };
    }
  });

  ipcMain.handle('paymentSlips:getDetail', async (_event, { ctuId, soGnt, maGiaoDich }) => {
    try {
      const safeCtuId = normalizeCtuId(ctuId);
      const detail = await paymentSlipClient.getPaymentSlipDetail(safeCtuId, {
        soGnt: String(soGnt || '').slice(0, 128),
        maGiaoDich: String(maGiaoDich || '').slice(0, 128)
      });
      if (detail?.suspectedMismatch || detail?.detailIntegrity === 'MISMATCH') {
        return {
          success: false,
          errorCode: 'GNT_DETAIL_MISMATCH',
          error: `Chi tiết eTax không khớp hoặc không cân với chứng từ ${soGnt || safeCtuId}; dữ liệu đã bị loại khỏi đối chiếu.`
        };
      }
      return detail
        ? { success: true, detail }
        : { success: false, error: `Không tìm thấy chi tiết Giấy Nộp Tiền ID ${safeCtuId}` };
    } catch (err: any) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        errorCode: err?.code || err?.errorCode
      };
    }
  });

  ipcMain.handle('paymentSlips:exportExcel', async (_event, { paymentSlips, year }) => {
    try {
      const taxCode = requireSessionTaxCode();
      const safePaymentSlips = normalizePaymentSlipList(paymentSlips);
      const outPath = await ExcelExporter.exportPaymentSlipsToExcel(
        safePaymentSlips,
        fileOrganizer.getBaseDir(),
        taxCode,
        normalizeYear(year)
      );
      auditLogger.log('SUCCESS', 'Xuất bảng kê Giấy Nộp Tiền ra file Excel thành công', outPath);
      return { success: true, filePath: outPath };
    } catch (err: any) {
      auditLogger.log('ERROR', 'Xuất Excel Giấy Nộp Tiền thất bại', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('paymentSlips:exportPdf', async (_event, { ctuId, soGnt, maGiaoDich, customFilename }) => {
    try {
      const safeCtuId = normalizeCtuId(ctuId);
      const detail = await paymentSlipClient.getPaymentSlipDetail(safeCtuId, {
        soGnt: String(soGnt || '').slice(0, 128),
        maGiaoDich: String(maGiaoDich || '').slice(0, 128)
      });
      const validation = validateC102Detail(detail);
      if (!detail || !validation.valid) {
        throw new Error(
          `Không thể xuất C1-02/NS cho chứng từ ${soGnt || safeCtuId}: ${validation.errors.join(' ')}`
        );
      }
      if (validation.warnings.length > 0) {
        auditLogger.log(
          'WARNING',
          `Xuất C1-02/NS có cảnh báo dữ liệu: ${soGnt || safeCtuId}`,
          validation.warnings.join(' ')
        );
      }
      const taxCode = requireSessionTaxCode();

      const baseDir = fileOrganizer.getBaseDir();
      const gntDir = baseDir;
      if (!fs.existsSync(gntDir)) {
        fs.mkdirSync(gntDir, { recursive: true });
      }

      let fileName = customFilename ? sanitizeFilename(path.basename(String(customFilename))) : '';
      if (!fileName) {
        const firstItem = detail.items[0];
        const taxLabel = firstItem?.noiDungKhoanNop?.toLowerCase().includes('giá trị gia tăng') ? 'GTGT'
          : firstItem?.noiDungKhoanNop?.toLowerCase().includes('doanh nghiệp') ? 'TNDN'
          : firstItem?.noiDungKhoanNop?.toLowerCase().includes('tiền lương') ? 'TNCN'
          : 'NSNN';
        const kyStr = (firstItem?.kyThueNgayQd || '').replace(/[\/\\]/g, '-');
        // Tổng tiền cho tên file: tổng chi tiết nếu hợp lệ, không thì tự cộng
        // các dòng, cuối cùng mới là '0' (tổng rỗng = bảng chi tiết parse hỏng)
        const parseVnd = (s?: string) => {
          const parsed = GntMoneyParser.parse(s);
          return parsed.status === 'VALID' ? parsed.value : 0n;
        };
        const totalFromDetail = parseVnd(detail.tongTienVND);
        const totalFromItems = detail.items.reduce((acc, it) => acc + parseVnd(it.soTienVND), 0n);
        const totalAmount = totalFromDetail > 0n ? totalFromDetail : (totalFromItems > 0n ? totalFromItems : 0n);
        const tienStr = String(totalAmount);
        const dateRaw = detail.signatures[0]?.signedAt?.split(' ')[0] || '';
        const dateStr = dateRaw ? dateRaw.split('/').reverse().join('') : '';
        // Gắn ctuId vào tên file: 2 GNT khác nhau trùng loại thuế/kỳ/số tiền/ngày
        // trước đây ghi đè PDF của nhau im lặng
        fileName = sanitizeFilename(`GNT_${taxLabel}_${kyStr}_${tienStr}_${dateStr || detail.soGnt}_${safeCtuId}.pdf`);
      }
      if (!fileName.toLowerCase().endsWith('.pdf')) {
        fileName += '.pdf';
      }
      const targetPath = path.join(gntDir, fileName);

      // Render nội dung Mẫu C1-02/NS bằng BrowserWindow ẩn (offscreen)
      const win = new BrowserWindow({
        show: false,
        width: 1024,
        height: 1400,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true
        }
      });

      try {
        const styledHtml = buildC102Html(detail);
        const base64Html = Buffer.from(styledHtml, 'utf-8').toString('base64');
        await win.loadURL(`data:text/html;charset=utf-8;base64,${base64Html}`);

        // Chờ hoàn tất load DOM, web fonts & layout
        await win.webContents.executeJavaScript(`
          (async () => {
            try {
              if (document.fonts) await document.fonts.ready;
            } catch(e) {}
            return new Promise(resolve => {
              if (document.readyState === 'complete') setTimeout(resolve, 150);
              else window.addEventListener('load', () => setTimeout(resolve, 150));
            });
          })()
        `);

        const pdfBuffer = await win.webContents.printToPDF({
          printBackground: true,
          preferCSSPageSize: true,
          pageSize: 'A4'
        });

        await fs.promises.writeFile(targetPath, pdfBuffer);
        auditLogger.log('SUCCESS', `Lưu file PDF Giấy Nộp Tiền thành công: ${fileName}`, targetPath);
        return { success: true, filePath: targetPath, fileName, folderPath: gntDir };
      } finally {
        if (!win.isDestroyed()) win.destroy();
      }
    } catch (err: any) {
      auditLogger.log('ERROR', 'Lỗi khi xuất PDF Giấy Nộp Tiền', err.message);
      return { success: false, error: err.message };
    }
  });

  // ─── THỐNG KÊ GNT: tổng hợp tiền ĐÃ NỘP theo Tháng × Loại thuế ───────────
  ipcMain.handle('paymentSlips:statistics', async (_event, { paymentSlips }) => {
    try {
      requireSessionTaxCode();
      const list = normalizePaymentSlipList(paymentSlips);
      if (list.length === 0) {
        return { success: false, error: 'Chưa có danh sách Giấy Nộp Tiền để thống kê' };
      }

      // Lấy chi tiết TẤT CẢ các GNT đã nộp (không cắt 200 — phần bị cắt sẽ làm
      // tiền rơi vào NO_DETAIL khiến cột loại thuế thiếu mà không rõ lý do).
      // Fetch song song có giới hạn (single-flight & cache vẫn hiệu lực trong client).
      const detailMap = new Map<string, Awaited<ReturnType<PaymentSlipClient['getPaymentSlipDetail']>>>();
      const paidCandidates = list.filter(s => s.ngayNopThue);
      const GNT_DETAIL_CONCURRENCY = 1;
      let cursor = 0;
      let stopDetailFetch = false;
      const workerCount = Math.min(GNT_DETAIL_CONCURRENCY, paidCandidates.length);
      await Promise.all(Array.from({ length: workerCount }, async () => {
        while (!stopDetailFetch && cursor < paidCandidates.length) {
          const slip = paidCandidates[cursor++];
          try {
            detailMap.set(
              slip.id,
              await paymentSlipClient.getPaymentSlipDetail(slip.id, {
                soGnt: slip.soGnt,
                maGiaoDich: slip.maGiaoDich
              })
            );
          } catch (detailError: unknown) {
            const err = detailError as any;
            const message = detailError instanceof Error ? detailError.message : String(detailError);
            auditLogger.log('WARNING', `Không đọc được chi tiết GNT ${slip.soGnt || slip.id}`, message);
            detailMap.set(slip.id, null);
            const status = Number(err?.response?.status || err?.httpStatus || 0);
            const code = String(err?.code || err?.errorCode || '');
            if (
              status === 429 ||
              status >= 500 ||
              ['RATE_LIMIT', 'ETAX_SYSTEM_ERROR', 'SESSION_EXPIRED', 'AUTH_REQUIRED'].includes(code)
            ) {
              stopDetailFetch = true;
              auditLogger.log(
                'WARNING',
                'Dừng tải chi tiết GNT còn lại để tránh Request Avalanche',
                `${code || `HTTP ${status}`} — ${paidCandidates.length - cursor} chứng từ chưa gọi`
              );
            }
          }
          if (!stopDetailFetch && cursor < paidCandidates.length) {
            await new Promise(resolve => setTimeout(resolve, 150));
          }
        }
      }));

      const stats = GntStatisticsEngine.build(list, detailMap);
      auditLogger.log('SUCCESS', `Thong ke GNT: ${stats.paidCount} da nop, tong ${stats.grandTotal} VND`);
      return { success: true, stats };
    } catch (err: any) {
      auditLogger.log('ERROR', 'Loi thong ke GNT', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('paymentSlips:exportStats', async (_event, { stats, year }) => {
    let ExcelJS: any;
    try {
      ExcelJS = require('exceljs');
    } catch {
      return { success: false, error: 'Thư viện Excel chưa sẵn sàng' };
    }
    try {
      const safeStats = normalizeGntStatistics(stats);
      if (safeStats.cells.length === 0) {
        throw new Error('Không có dữ liệu thống kê để xuất');
      }
      const taxCode = requireSessionTaxCode();
      const safeYear = normalizeYear(year);
      const baseDir = fileOrganizer.getBaseDir();
      const gntDir = baseDir;
      if (!fs.existsSync(gntDir)) fs.mkdirSync(gntDir, { recursive: true });

      const buckets: GntStatBucket[] = safeStats.activeBuckets;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'TaxInsight';
      const ws = wb.addWorksheet('Thong ke GNT');

      ws.mergeCells(1, 1, 1, 2 + buckets.length + 1);
      ws.getCell(1, 1).value = `THỐNG KÊ GIẤY NỘP TIỀN ĐÃ NỘP — THEO THÁNG & LOẠI THUẾ`;
      ws.getCell(1, 1).font = { bold: true, size: 13 };

      ws.mergeCells(2, 1, 2, 2 + buckets.length + 1);
      ws.getCell(2, 1).value = `MST: ${taxCode}   |   Năm dữ liệu: ${safeYear}   |   Xuất lúc: ${new Date().toLocaleString('vi-VN')}   |   Đơn vị: VND`;
      ws.getCell(2, 1).font = { size: 10, italic: true };

      // Header
      const headerRow = 4;
      ws.getCell(headerRow, 1).value = 'Tháng nộp';
      buckets.forEach((b, i) => { ws.getCell(headerRow, 2 + i).value = GNT_BUCKET_LABELS[b]; });
      ws.getCell(headerRow, 2 + buckets.length).value = 'Tổng tháng';
      ws.getRow(headerRow).font = { bold: true };
      ws.getRow(headerRow).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2F2F0' } };

      // Data rows
      let r = headerRow + 1;
      for (const mk of safeStats.monthKeys) {
        ws.getCell(r, 1).value = `Tháng ${mk}`;
        buckets.forEach((b, i) => {
          const v = GntStatisticsEngine.amountOf(safeStats, mk, b);
          const cell = ws.getCell(r, 2 + i);
          cell.value = v || null;
          cell.numFmt = '#,##0';
        });
        const tot = ws.getCell(r, 2 + buckets.length);
        tot.value = GntStatisticsEngine.rowTotal(safeStats, mk);
        tot.numFmt = '#,##0';
        tot.font = { bold: true };
        r++;
      }

      // Grand total row
      ws.getCell(r, 1).value = 'TỔNG CỘNG';
      ws.getCell(r, 1).font = { bold: true };
      buckets.forEach((b, i) => {
        const c = ws.getCell(r, 2 + i);
        c.value = GntStatisticsEngine.columnTotal(safeStats, b);
        c.numFmt = '#,##0';
        c.font = { bold: true };
      });
      const gt = ws.getCell(r, 2 + buckets.length);
      gt.value = safeStats.grandTotal;
      gt.numFmt = '#,##0';
      gt.font = { bold: true };
      gt.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };

      // Notes
      r += 2;
      ws.getCell(r, 1).value = `Ghi chú: chỉ tính GNT đã nộp thành công (${safeStats.paidCount} giấy); bỏ qua ${safeStats.skippedUnpaidCount} giấy chưa nộp/thất bại.`;
      if (safeStats.noDetailCount > 0) {
        ws.getCell(r + 1, 1).value = `${safeStats.noDetailCount} giấy không đọc được chi tiết C1-02/NS nên toàn bộ số tiền tạm xếp vào cột "Chưa phân loại".`;
      }

      ws.getColumn(1).width = 18;
      for (let i = 2; i <= 2 + buckets.length; i++) ws.getColumn(i).width = 16;

      const fileName = sanitizeFilename(`ThongKe_GNT_${safeYear}_${Date.now()}.xlsx`);
      const targetPath = path.join(gntDir, fileName);
      await wb.xlsx.writeFile(targetPath);
      auditLogger.log('SUCCESS', 'Xuat Excel thong ke GNT thanh cong', targetPath);
      return { success: true, filePath: targetPath, fileName };
    } catch (err: any) {
      auditLogger.log('ERROR', 'Xuat Excel thong ke GNT that bai', err.message);
      return { success: false, error: err.message };
    }
  });


  // ─── CHECKPOINT & AUDIT IPC HANDLERS ────────────────────────────────
  ipcMain.handle('checkpoint:get', async (_event, { taxCode, year }) => {
    try {
      const safeTaxCode = requireSessionTaxCode(taxCode);
      const data = checkpointStore.loadCheckpoint(safeTaxCode, normalizeYear(year));
      return { success: true, data };
    } catch (err: any) {
      return { success: false, data: null, error: err.message };
    }
  });

  ipcMain.handle('checkpoint:clear', async (_event, { taxCode, year }) => {
    try {
      checkpointStore.clearCheckpoint(requireSessionTaxCode(taxCode), normalizeYear(year));
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ─── GNT CHECKPOINT (PERSISTENCE GIẤY NỘP TIỀN THEO MST + NĂM) ──────
  ipcMain.handle('gntCheckpoint:get', async (_event, { taxCode, year }) => {
    try {
      const data = gntCheckpointStore.load(requireSessionTaxCode(taxCode), normalizeYear(year));
      return { success: true, data };
    } catch (err: any) {
      return { success: false, data: null as GntCheckpointData | null, error: err.message };
    }
  });

  ipcMain.handle('gntCheckpoint:save', async (_event, { taxCode, year, paymentSlips, dateRange }) => {
    try {
      const safeTaxCode = requireSessionTaxCode(taxCode);
      const safePaymentSlips = normalizePaymentSlipList(paymentSlips);
      const safeDateRange = dateRange ? normalizeDateRange(dateRange) : undefined;
      gntCheckpointStore.save(safeTaxCode, normalizeYear(year), safePaymentSlips, safeDateRange);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('gntCheckpoint:clear', async (_event, { taxCode, year }) => {
    try {
      gntCheckpointStore.clear(requireSessionTaxCode(taxCode), normalizeYear(year));
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ─── LEGACY FILING IPC HANDLERS (TRA CỨU & TẢI TỜ KHAI NĂM CŨ QUA ETAX/DVC) ───
  ipcMain.handle('legacyFiling:scan', async (_event, { yearFrom, yearTo, maTKhai, onlyMissing }) => {
    try {
      const safeTaxCode = requireSessionTaxCode();
      const from = normalizeHistoricalYear(yearFrom);
      const to = normalizeHistoricalYear(yearTo);
      if (Math.abs(to - from) > 20) {
        throw new Error('Mỗi đợt tra cứu năm cũ chỉ được tối đa 20 năm.');
      }
      const safeMaTKhai = String(maTKhai || '00').trim();
      if (!/^[0-9A-Za-z._/-]{1,32}$/.test(safeMaTKhai)) {
        throw new Error('Mã mẫu tờ khai không hợp lệ.');
      }
      auditLogger.log('INFO', `Bắt đầu tra cứu tờ khai năm cũ qua DVC/eTax (${from} - ${to})`);

      const result = await legacyFilingWorkflow.executeLookup({
        taxpayerId: safeTaxCode,
        yearFrom: from,
        yearTo: to,
        maTKhai: safeMaTKhai,
        onlyMissing: Boolean(onlyMissing)
      });

      auditLogger.log('SUCCESS', `Hoàn thành tra cứu năm cũ: tìm thấy ${result.filings.length} tờ khai`);
      return { success: true, filings: result.filings, historicalRecords: result.historicalRecords };
    } catch (err: any) {
      auditLogger.log('ERROR', 'Lỗi khi tra cứu tờ khai năm cũ', err.message);
      return { success: false, error: err.message, errorCode: err.code };
    }
  });

  ipcMain.handle('legacyFiling:cancel', async () => {
    legacyFilingWorkflow.cancel();
    legacyFilingDownloader.cancel();
    auditLogger.log('WARNING', 'Người dùng đã hủy tra cứu/tải tờ khai năm cũ');
    return { success: true };
  });

  ipcMain.handle('legacyFiling:download', async (_event, { filings, taxCode, year }) => {
    try {
      const safeTaxCode = requireSessionTaxCode(taxCode);
      const safeFilings = normalizeFilingList(filings).filter(
        filing => filing.source === 'dvc-etax-html' && Boolean(filing.messageId || filing.id)
      );
      if (!safeFilings.length) {
        throw new Error('Danh sách không có tờ khai eTax năm cũ hợp lệ.');
      }
      const safeYear = normalizeHistoricalYear(year);

      legacyFilingDownloader.setContext(safeTaxCode, safeYear);
      legacyFilingDownloader.enqueueFilings(safeFilings, safeTaxCode, safeYear);
      await legacyFilingDownloader.start();

      auditLogger.log('INFO', `Bắt đầu tải ${safeFilings.length} tờ khai năm cũ`);
      return { success: true, summary: legacyFilingDownloader.getSummary() };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('legacyFiling:pauseDownload', async () => {
    legacyFilingDownloader.pause();
    return { success: true };
  });

  ipcMain.handle('legacyFiling:resumeDownload', async () => {
    try {
      await legacyFilingDownloader.resume();
      auditLogger.log('INFO', 'Tiếp tục tải tờ khai năm cũ');
      return { success: true, summary: legacyFilingDownloader.getSummary() };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Không thể tiếp tục tải' };
    }
  });

  ipcMain.handle('legacyFiling:cancelDownload', async () => {
    legacyFilingDownloader.cancel();
    auditLogger.log('WARNING', 'Đã hủy tiến trình tải tờ khai năm cũ');
    return { success: true };
  });

  ipcMain.handle('legacyFiling:getDownloadSummary', async () => {
    return legacyFilingDownloader.getSummary();
  });

  ipcMain.handle('legacyFiling:getFormOptions', async () => {
    try {
      const options = legacyFilingClient.getAvailableFormOptions();
      return { success: true, options };
    } catch (err: any) {
      return { success: false, options: [], error: err.message };
    }
  });

  ipcMain.handle('legacyFiling:getCheckpoint', async (_event, { taxCode, yearFrom, yearTo }) => {
    try {
      const safeTaxCode = requireSessionTaxCode(taxCode);
      const data = historicalCheckpointStore.loadCheckpoint(
        safeTaxCode,
        normalizeHistoricalYear(yearFrom),
        normalizeHistoricalYear(yearTo)
      );
      return { success: true, data };
    } catch (err: any) {
      return { success: false, data: null, error: err.message };
    }
  });

  ipcMain.handle('legacyFiling:clearCheckpoint', async (_event, { taxCode, yearFrom, yearTo }) => {
    try {
      historicalCheckpointStore.clearCheckpoint(
        requireSessionTaxCode(taxCode),
        normalizeHistoricalYear(yearFrom),
        normalizeHistoricalYear(yearTo)
      );
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ─── APP INFO ───────────────────────────────────────────────────────
  ipcMain.handle('app:getVersion', async () => {
    try {
      return { success: true, version: app.getVersion() };
    } catch {
      return { success: false, version: '' };
    }
  });

  ipcMain.handle('audit:getLogs', async () => {
    return auditLogger.getLogs();
  });

  // ─── LICENSING IPC HANDLERS ─────────────────────────────────────────
  ipcMain.handle('license:getStatus', async () => {
    return LicenseManager.getLicenseStatus();
  });

  ipcMain.handle('license:activate', async (_event, { licenseKey }: { licenseKey: string }) => {
    if (typeof licenseKey !== 'string' || licenseKey.length > 8192) {
      return { success: false, error: 'Khóa bản quyền không hợp lệ.' };
    }
    const res = LicenseManager.activateLicense(licenseKey);
    if (res.success) {
      auditLogger.log('SUCCESS', 'Kích hoạt bản quyền TaxRecord thành công');
    } else {
      auditLogger.log('WARNING', 'Kích hoạt bản quyền thất bại', res.error);
    }
    return res;
  });

  ipcMain.handle('license:getMachineId', async () => {
    return MachineIdProvider.getMachineId();
  });

  // ─── SAVED ACCOUNTS & QUICK SWITCH IPC HANDLERS ─────────────────────
  ipcMain.handle('accounts:getSaved', async () => {
    return AccountStore.getSavedAccounts();
  });

  ipcMain.handle('accounts:save', async (_event, opts) => {
    if (!opts || !isValidTaxCode(String(opts.taxCode || '').trim())) return false;
    if (opts.password !== undefined && (typeof opts.password !== 'string' || opts.password.length > 512)) return false;
    return AccountStore.saveAccount({
      ...opts,
      taxCode: String(opts.taxCode).trim(),
      companyName: opts.companyName ? String(opts.companyName).slice(0, 256) : undefined
    });
  });

  ipcMain.handle('accounts:remove', async (_event, { taxCode }: { taxCode: string }) => {
    if (!isValidTaxCode(String(taxCode || '').trim())) return false;
    return AccountStore.removeAccount(String(taxCode).trim());
  });

  // ─── AUTO-UPDATER IPC HANDLERS ───────────────────────────────────────
  ipcMain.handle('updater:getStatus', async () => {
    return AppUpdater.getInstance().getStatus();
  });

  ipcMain.handle('updater:check', async () => {
    return AppUpdater.getInstance().checkForUpdates();
  });

  ipcMain.handle('updater:download', async () => {
    return AppUpdater.getInstance().downloadUpdate();
  });

  ipcMain.handle('updater:install', async () => {
    AppUpdater.getInstance().quitAndInstall();
    return { success: true };
  });

  // ─── API INSPECTOR (LOCAL SUPPORT DIAGNOSTICS) ───────────────────────
  // Dữ liệu đã được sanitize ngay tại interceptor. Người dùng cần xem được
  // request lỗi của chính ứng dụng mà không phụ thuộc một PIN build-time vốn
  // không được cấu hình trên bản phát hành.
  ipcMain.handle('inspector:getEntries', async () => {
    return ApiInspectorManager.getInstance().getEntries();
  });

  ipcMain.handle('inspector:clear', async () => {
    const inspector = ApiInspectorManager.getInstance();
    inspector.clearEntries();
    return { success: true };
  });

  ipcMain.handle('inspector:export', async () => {
    return ApiInspectorManager.getInstance().exportEntriesJson();
  });

  ipcMain.handle('inspector:verifyAdminPin', async (_event, { pin }: { pin: string }) => {
    if (typeof pin !== 'string' || pin.length > 256) {
      return { success: false, error: 'PIN không hợp lệ.' };
    }
    return ApiInspectorManager.getInstance().verifyAdminPin(pin);
  });

  ipcMain.handle('inspector:getAdminStatus', async () => {
    return ApiInspectorManager.getInstance().getAdminStatus();
  });
}

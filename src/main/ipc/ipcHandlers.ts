import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { PORTAL_CONFIG } from '../../shared/constants';
import { sanitizeFilename } from '../../shared/sanitizer';
import { isValidTaxCode } from '../../shared/taxCodeUtils';
import { PaymentSlipRecord, TaxFiling, TaxType } from '../../shared/types';
import { DownloadManager } from '../downloader/DownloadManager';
import { ExcelExporter } from '../exporter/ExcelExporter';
import { FileOrganizer } from '../files/FileOrganizer';
import { GntMoneyParser } from '../scanner/GntMoneyParser';
import { GntParser } from '../scanner/GntParser';
import { CaptchaManager } from '../portal/CaptchaManager';
import { PaymentSlipClient } from '../portal/PaymentSlipClient';
import { PortalSession } from '../portal/PortalSession';
import { TaxPortalClient } from '../portal/TaxPortalClient';
import { CaptchaSolver } from '../scanner/CaptchaSolver';
import { TaxScanEngine } from '../scanner/TaxScanEngine';
import { VatAnalyticsEngine } from '../scanner/VatAnalyticsEngine';
import { PitAnalyticsEngine } from '../scanner/PitAnalyticsEngine';
import { ExcelVatReferenceExporter } from '../exporter/ExcelVatReferenceExporter';
import { ExcelPitReferenceExporter } from '../exporter/ExcelPitReferenceExporter';
import { GntStatisticsEngine, GNT_BUCKET_LABELS, GntStatBucket } from '../engine/GntStatisticsEngine';
import { AuditLogger } from '../persistence/AuditLogger';
import { CheckpointStore } from '../persistence/CheckpointStore';
import { GntCheckpointStore, GntCheckpointData } from '../persistence/GntCheckpointStore';
import { SettingsStore } from '../persistence/SettingsStore';
import { AccountStore } from '../persistence/AccountStore';
import { LicenseManager } from '../licensing/LicenseManager';
import { MachineIdProvider } from '../licensing/MachineIdProvider';
import { AppUpdater } from '../updater/AppUpdater';

export function setupIpcHandlers(
  session: PortalSession,
  client: TaxPortalClient,
  paymentSlipClient: PaymentSlipClient,
  captchaManager: CaptchaManager,
  scanEngine: TaxScanEngine,
  downloadManager: DownloadManager,
  fileOrganizer: FileOrganizer,
  checkpointStore: CheckpointStore,
  gntCheckpointStore: GntCheckpointStore,
  auditLogger: AuditLogger,
  sendToRenderer: (channel: string, data: any) => void
) {
  // ─── VALIDATOR INPUT TỪ RENDERER (chống path traversal qua taxCode/year) ──
  const normalizeYear = (v: unknown): number => {
    const n = typeof v === 'number' ? v : parseInt(String(v), 10);
    return Number.isFinite(n) && n >= 1900 && n <= 2200 ? n : new Date().getFullYear();
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

  // ─── AUTH IPC HANDLERS ──────────────────────────────────────────────
  ipcMain.handle('auth:getCaptcha', async () => {
    try {
      const base64 = await client.getCaptchaImage('LOGIN');
      return { success: true, imageBase64: base64 };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('auth:solveCaptcha', async (_event, { imageBase64 }) => {
    try {
      const text = await CaptchaSolver.solve(imageBase64);
      return { success: true, text };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('auth:login', async (_event, { taxCode, password, captcha }) => {
    try {
      auditLogger.log('INFO', 'Bắt đầu đăng nhập Cổng Thuế', `MST: ${taxCode}`);
      const res = await client.login(taxCode, password, captcha);
      if (res.success) {
        auditLogger.log('SUCCESS', 'Đăng nhập Cổng Thuế thành công', `MST: ${taxCode}`);
      } else {
        auditLogger.log('WARNING', 'Đăng nhập không thành công', res.message);
      }
      return res;
    } catch (err: any) {
      auditLogger.log('ERROR', 'Lỗi ngoại lệ khi đăng nhập', err.message);
      return { success: false, message: err.message };
    }
  });

  ipcMain.handle('auth:logout', async () => {
    session.clearSession();
    // Reset toàn bộ trạng thái phiên cũ: CSRF token, DSE session, cache chi tiết
    // — nếu không, lần đăng nhập tiếp theo (khác MST) sẽ dùng token/session của tài khoản trước
    client.reset();
    paymentSlipClient.reset();
    scanEngine.clearFilings();
    auditLogger.log('INFO', 'Người dùng đã đăng xuất');
    return { success: true };
  });

  ipcMain.handle('auth:getSession', async () => {
    return session.getSessionInfo();
  });

  ipcMain.handle('auth:checkSession', async () => {
    const isAlive = await client.checkSession();
    return { isAlive };
  });

  // ─── SCAN IPC HANDLERS ──────────────────────────────────────────────
  ipcMain.handle('scan:start', async (_event, { year, taxType, scope, mstUyQuyen, limitToToday, customRange }) => {
    try {
      const modeLabel = customRange ? customRange.label : limitToToday ? `đến ngày hiện tại` : `cả năm`;
      auditLogger.log('INFO', `Bắt đầu quét hồ sơ năm ${year} (${modeLabel})`, `Loại thuế: ${taxType}`);
      const result = await scanEngine.scanYear(year, taxType, { scope, mstUyQuyen, limitToToday, customRange });

      auditLogger.log('SUCCESS', `Quét hoàn tất: Tìm thấy ${result.filings.length} hồ sơ năm ${year}`);

      const sessionInfo = session.getSessionInfo();
      if (sessionInfo.taxCode) {
        checkpointStore.saveCheckpoint(sessionInfo.taxCode, year, result.filings);
      }

      return { success: true, data: result };
    } catch (err: any) {
      auditLogger.log('ERROR', `Lỗi khi quét hồ sơ năm ${year}`, err.message);
      return { success: false, error: err.message };
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
      const currentTaxCode = [taxCode, session.getSessionInfo().taxCode]
        .map(value => typeof value === 'string' ? value.trim() : '')
        .find(isValidTaxCode);
      if (!currentTaxCode) {
        return { success: false, error: 'Không xác định được mã số thuế hợp lệ để tải hồ sơ' };
      }
      const currentYear = normalizeYear(year ?? new Date().getFullYear());

      downloadManager.setContext(currentTaxCode, currentYear);
      downloadManager.enqueueFilings(filings, currentTaxCode, currentYear);
      await downloadManager.start();

      auditLogger.log('INFO', `Bắt đầu tải hàng loạt ${filings.length} hồ sơ`);
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
    await downloadManager.resume();
    auditLogger.log('INFO', 'Tiếp tục tiến trình tải hồ sơ');
    return { success: true, summary: downloadManager.getSummary() };
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
      SettingsStore.setDownloadDir(customPath);
      fileOrganizer.setBaseDir(customPath);
      checkpointStore.setBaseDir(customPath);
      gntCheckpointStore.setBaseDir(customPath);
      auditLogger.setBaseDir(customPath);
      vatEngine.setBaseDir(customPath);
      pitEngine.setBaseDir(customPath);
      auditLogger.log('INFO', 'Đã thiết lập thư mục lưu trữ hồ sơ', customPath);
      return { success: true, path: customPath };
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
      const taxCode = session.getSessionInfo().taxCode || 'DEFAULT';
      const outPath = await ExcelExporter.exportFilingsToExcel(
        filings,
        fileOrganizer.getBaseDir(),
        taxCode,
        year
      );
      auditLogger.log('SUCCESS', 'Xuất danh sách hồ sơ ra file Excel thành công', outPath);
      return { success: true, filePath: outPath };
    } catch (err: any) {
      auditLogger.log('ERROR', 'Xuất Excel thất bại', err.message);
      return { success: false, error: err.message };
    }
  });

  // ─── PHÂN HỆ PHÂN TÍCH CHUYÊN SÂU GTGT (VAT ANALYTICS) ────────────
  const vatEngine = new VatAnalyticsEngine(client, fileOrganizer.getBaseDir());

  ipcMain.handle('vat:analyze', async (_event, { filings }) => {
    try {
      const taxCode = session.getSessionInfo().taxCode || 'DEFAULT';
      vatEngine.setBaseDir(fileOrganizer.getBaseDir());
      auditLogger.log('INFO', `Bắt đầu phân tích chuyên sâu ${filings.length} tờ khai GTGT...`);
      const summary = await vatEngine.analyzeVatFilings(filings, taxCode, (current, total, message) => {
        sendToRenderer('vat:progress', { current, total, message });
      });
      auditLogger.log('SUCCESS', `Phân tích hoàn tất: ${summary.totalPeriodsCount} kỳ (${summary.periodsWithSupplementalCount} kỳ có bổ sung)`);
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
      const taxCode = session.getSessionInfo().taxCode || 'DEFAULT';
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
  const pitEngine = new PitAnalyticsEngine(client, fileOrganizer.getBaseDir());

  ipcMain.handle('pit:analyze', async (_event, { filings }) => {
    try {
      const taxCode = session.getSessionInfo().taxCode || 'DEFAULT';
      pitEngine.setBaseDir(fileOrganizer.getBaseDir());
      auditLogger.log('INFO', `Bắt đầu phân tích chuyên sâu ${filings.length} tờ khai TNCN...`);
      const summary = await pitEngine.analyzePitFilings(filings, taxCode, (current, total, message) => {
        sendToRenderer('pit:progress', { current, total, message });
      });
      auditLogger.log('SUCCESS', `Phân tích TNCN hoàn tất: ${summary.totalFilingsAnalyzed} hồ sơ (${summary.periodGroups.length} kỳ)`);
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
      const res = await ExcelPitReferenceExporter.exportPitReference(
        summary,
        year,
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
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        await shell.openExternal(url);
        return { success: true };
      }
      return { success: false, error: 'Protocol not allowed' };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ─── PHÂN HỆ GIẤY NỘP TIỀN (GNT - C1-02/NS) IPC HANDLERS ─────────
  ipcMain.handle('paymentSlips:getDiagnostics', async () => {
    return paymentSlipClient.getDiagnosticReport();
  });

  ipcMain.handle('paymentSlips:openAuthWindow', async () => {
    return new Promise(async (resolve) => {
      try {
        const authWin = new BrowserWindow({
          width: 1150,
          height: 780,
          title: 'Xác Thực Phiên Làm Việc eTax (Tra Cứu Giấy Nộp Tiền) - TaxInsight',
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
          }
        });

        authWin.webContents.setWindowOpenHandler(({ url }) => {
          // Điều hướng ngay trong cửa sổ hiện tại, không mở tab mới rời rạc
          authWin.loadURL(url);
          return { action: 'deny' };
        });

        // 1. Đồng bộ toàn bộ Cookie từ Axios Jar sang Electron Browser Session TRƯỚC KHI load URL
        const jar = session.getCookieJar();
        try {
          const cookies = await jar.getCookies(PORTAL_CONFIG.BASE_URL);
          for (const c of cookies) {
            const domain = c.domain?.startsWith('.') ? c.domain.slice(1) : c.domain || 'dichvucong.gdt.gov.vn';
            await authWin.webContents.session.cookies.set({
              url: PORTAL_CONFIG.BASE_URL,
              name: c.key,
              value: c.value,
              domain,
              path: c.path || '/'
            }).catch(() => {});
          }
        } catch {}

        let hasClosed = false;

        const checkPageForEtaxSession = async () => {
          if (hasClosed || authWin.isDestroyed()) return;

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

                // ─── 1. TỰ ĐỘNG ĐIỀU HƯỚNG TRÊN CỔNG DỊCH VỤ CÔNG ─────────────
                if (isDvc) {
                  let banner = document.getElementById('taxinsight-sync-banner');
                  if (!banner) {
                    banner = document.createElement('div');
                    banner.id = 'taxinsight-sync-banner';
                    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999999;background:#0d9488;color:#fff;padding:12px 20px;display:flex;align-items:center;justify-content:space-between;box-shadow:0 4px 16px rgba(0,0,0,0.3);font-family:system-ui,-apple-system,sans-serif;font-size:13px;font-weight:600;';
                    document.body.prepend(banner);
                  }
                  banner.innerHTML = '<span>⚡ TaxInsight: Đang chuyển tiếp sang phân hệ Tra cứu Giấy Nộp Tiền (eTax)...</span><button id="taxinsight-btn-sso" style="background:#fff;color:#0d9488;border:none;padding:6px 14px;border-radius:6px;font-weight:bold;cursor:pointer;">Chuyển ngay ↗</button>';
                  
                  const triggerSso = () => {
                    fetch('/tthc/sso/redirect-to-service?module=330410', {
                      method: 'POST',
                      headers: {
                        'X-Requested-With': 'XMLHttpRequest',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                      }
                    })
                    .then(r => r.text())
                    .then(url => {
                      const cleanUrl = url.trim().replace(/^["']|["']$/g, '');
                      if (cleanUrl.startsWith('http://') || cleanUrl.startsWith('https://')) {
                        window.location.href = cleanUrl;
                      } else {
                        const f = document.createElement('form');
                        f.method = 'POST';
                        f.action = '/tthc/sso/redirect-to-service?module=330410';
                        f.target = '_self';
                        document.body.appendChild(f);
                        f.submit();
                      }
                    })
                    .catch(() => {
                      const f = document.createElement('form');
                      f.method = 'POST';
                      f.action = '/tthc/sso/redirect-to-service?module=330410';
                      f.target = '_self';
                      document.body.appendChild(f);
                      f.submit();
                    });
                  };

                  document.getElementById('taxinsight-btn-sso')?.addEventListener('click', triggerSso);

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
                      
                      const fromDateInput = document.querySelector('input[name="ngay_lap_tu_ngay"], #ngay_lap_tu_ngay') as HTMLInputElement;
                      const toDateInput = document.querySelector('input[name="ngay_lap_den_ngay"], #ngay_lap_den_ngay') as HTMLInputElement;
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
                let pageInput = document.querySelector('input[name="dse_pageId"]');
                let procInput = document.querySelector('input[name="dse_processorId"]');

                if (!sessInput) {
                  const iframes = document.querySelectorAll('iframe');
                  for (const iframe of iframes) {
                    try {
                      const idoc = iframe.contentDocument || iframe.contentWindow.document;
                      if (idoc) {
                        sessInput = sessInput || idoc.querySelector('input[name="dse_sessionId"]');
                        pageInput = pageInput || idoc.querySelector('input[name="dse_pageId"]');
                        procInput = procInput || idoc.querySelector('input[name="dse_processorId"]');
                        const iframeTable = idoc.querySelector('#allResultTableBody') || idoc.querySelector('table');
                        if (iframeTable && !tableHtml) tableHtml = iframeTable.outerHTML;
                      }
                    } catch (e) {}
                  }
                }

                let sessVal = sessInput ? (sessInput as HTMLInputElement).value : '';
                if (!sessVal) {
                  const match = document.documentElement.innerHTML.match(/dse_sessionId\\s*=\\s*["']([^"']+)["']/i) ||
                                document.documentElement.innerHTML.match(/name=["']dse_sessionId["']\\s+value=["']([^"']+)["']/i);
                  if (match) sessVal = match[1];
                }

                return {
                  sessionId: sessVal || '',
                  pageId: pageInput ? parseInt((pageInput as HTMLInputElement).value, 10) : 12,
                  processorId: procInput ? (procInput as HTMLInputElement).value : '',
                  currentUrl,
                  isGntFormPresent: pageBody.includes('Tra cứu giấy nộp tiền'),
                  tableHtml,
                  isAtEtax: isEtax
                };
              })()
            `);

            // Đảm bảo lấy JSESSIONID nếu có trong cookie
            const etaxCookies = await authWin.webContents.session.cookies.get({ domain: 'thuedientu.gdt.gov.vn' });
            const jsession = etaxCookies.find(c => c.name.toLowerCase().includes('jsession'))?.value;
            const finalSessionId = res?.sessionId || jsession || '';

            if (finalSessionId) {
              // KHÔNG fallback processorId bằng 'corpQueryTaxProc' — đó là operationName,
              // không phải processorId. Truyền sai khiến mọi query GNT sau đó gửi
              // dse_processorId không hợp lệ và server trả trang lỗi.
              // Bỏ trống để PaymentSlipClient tự dùng hằng processorId mặc định của eTax.
              paymentSlipClient.setManualSessionState(finalSessionId, res?.pageId || 12, res?.processorId || undefined);
            }

            if (res && res.tableHtml && (res.tableHtml.includes('Giao dịch') || res.tableHtml.includes('chiTietCT') || res.tableHtml.includes('VND'))) {
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
                  soTien: Number(item.amount.value),
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
                authWin.close();
                resolve({ success: true, paymentSlips: records, sessionId: finalSessionId || 'SESSION_SYNCED' });
                return;
              }
            }

            if (finalSessionId) {
              hasClosed = true;
              auditLogger.log('SUCCESS', 'Xác thực phiên eTax thành công qua cửa sổ trình duyệt', `Session: ${finalSessionId.slice(0, 6)}***`);
              authWin.close();
              resolve({ success: true, sessionId: finalSessionId });
            }
          } catch {}
        };

        authWin.webContents.on('did-finish-load', checkPageForEtaxSession);
        authWin.webContents.on('did-navigate', checkPageForEtaxSession);
        authWin.webContents.on('did-navigate-in-page', checkPageForEtaxSession);
        authWin.webContents.on('dom-ready', checkPageForEtaxSession);

        // Lặp kiểm tra mỗi 1500ms
        const intervalId = setInterval(async () => {
          if (authWin.isDestroyed() || hasClosed) {
            clearInterval(intervalId);
            return;
          }
          await checkPageForEtaxSession();
        }, 1500);

        authWin.on('closed', () => {
          clearInterval(intervalId);
          if (!hasClosed) {
            resolve({ success: false, message: 'Người dùng đã đóng cửa sổ xác thực.' });
          }
        });

        // Tải trang Dịch Vụ Khác sau khi đã gắn đầy đủ Cookie đăng nhập.
        // Bắt lỗi load (offline / DNS / portal 500) — nếu không Promise IPC sẽ treo vĩnh viễn.
        authWin.loadURL('https://dichvucong.gdt.gov.vn/tthc/dich-vu-khac').catch(err => {
          auditLogger.log('ERROR', 'Không thể tải trang xác thực eTax', err?.message || String(err));
          if (!authWin.isDestroyed() && !hasClosed) {
            hasClosed = true;
            clearInterval(intervalId);
            authWin.close();
            resolve({ success: false, error: `Không thể tải trang xác thực eTax: ${err?.message || err}` });
          }
        });
      } catch (err: any) {
        resolve({ success: false, error: err.message });
      }
    });
  });

  ipcMain.handle('paymentSlips:scan', async (_event, { range, options }) => {
    try {
      auditLogger.log('INFO', `Bắt đầu tra cứu Giấy Nộp Tiền (${range.fromDate} → ${range.toDate})`);
      const results = await paymentSlipClient.searchPaymentSlips(range, options || {});
      auditLogger.log('SUCCESS', `Tìm thấy ${results.length} Giấy Nộp Tiền trên eTax`);
      return { success: true, paymentSlips: results };
    } catch (err: any) {
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

  ipcMain.handle('paymentSlips:getDetail', async (_event, { ctuId }) => {
    try {
      const detail = await paymentSlipClient.getPaymentSlipDetail(ctuId);
      return { success: true, detail };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('paymentSlips:exportExcel', async (_event, { paymentSlips, year }) => {
    try {
      const taxCode = session.getSessionInfo().taxCode || 'DEFAULT';
      const outPath = await ExcelExporter.exportPaymentSlipsToExcel(
        paymentSlips,
        fileOrganizer.getBaseDir(),
        taxCode,
        year
      );
      auditLogger.log('SUCCESS', 'Xuất bảng kê Giấy Nộp Tiền ra file Excel thành công', outPath);
      return { success: true, filePath: outPath };
    } catch (err: any) {
      auditLogger.log('ERROR', 'Xuất Excel Giấy Nộp Tiền thất bại', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('paymentSlips:exportPdf', async (_event, { ctuId, customFilename }) => {
    try {
      const detail = await paymentSlipClient.getPaymentSlipDetail(ctuId);
      if (!detail) {
        throw new Error(`Không tìm thấy chi tiết Giấy Nộp Tiền ID ${ctuId}`);
      }
      const taxCode = session.getSessionInfo().taxCode || 'DEFAULT';

      const baseDir = fileOrganizer.getBaseDir();
      const gntDir = path.join(baseDir, taxCode, 'GiayNopTien');
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
        const tienStr = (detail.tongTienVND || '0').replace(/[,.]/g, '');
        const dateRaw = detail.signatures[0]?.signedAt?.split(' ')[0] || '';
        const dateStr = dateRaw ? dateRaw.split('/').reverse().join('') : '';
        // Gắn ctuId vào tên file: 2 GNT khác nhau trùng loại thuế/kỳ/số tiền/ngày
        // trước đây ghi đè PDF của nhau im lặng
        fileName = `GNT_${taxLabel}_${kyStr}_${tienStr}_${dateStr || detail.soGnt}_${ctuId}.pdf`;
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
        // Bọc HTML với CSS print-friendly và font tiếng Việt sắc nét
        const styledHtml = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="utf-8" />
            <style>
              @page { size: A4 portrait; margin: 10mm; }
              body { font-family: Arial, sans-serif; font-size: 11pt; color: #000; background: #fff; margin: 0; padding: 0; }
              table { width: 100%; border-collapse: collapse; }
              .button_area, .form_panel_table, #openPopupHSM, input[type="button"], button, script { display: none !important; }
            </style>
          </head>
          <body>
            ${detail.rawHtml || ''}
          </body>
          </html>
        `;

        await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(styledHtml)}`);

        // Chờ hoàn tất load DOM & layout
        await win.webContents.executeJavaScript(`
          new Promise(resolve => {
            if (document.readyState === 'complete') setTimeout(resolve, 300);
            else window.addEventListener('load', () => setTimeout(resolve, 300));
          })
        `);

        const pdfBuffer = await win.webContents.printToPDF({
          printBackground: true,
          preferCSSPageSize: true,
          pageSize: 'A4'
        });

        await fs.promises.writeFile(targetPath, pdfBuffer);
        auditLogger.log('SUCCESS', `Lưu file PDF Giấy Nộp Tiền thành công: ${fileName}`, targetPath);
        return { success: true, filePath: targetPath, fileName };
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
      const list: PaymentSlipRecord[] = Array.isArray(paymentSlips) ? paymentSlips : [];
      if (list.length === 0) {
        return { success: false, error: 'Chưa có danh sách Giấy Nộp Tiền để thống kê' };
      }

      // Lấy chi tiết TẤT CẢ các GNT đã nộp (không cắt 200 — phần bị cắt sẽ làm
      // tiền rơi vào NO_DETAIL khiến cột loại thuế thiếu mà không rõ lý do).
      // Fetch song song có giới hạn (single-flight & cache vẫn hiệu lực trong client).
      const detailMap = new Map<string, Awaited<ReturnType<PaymentSlipClient['getPaymentSlipDetail']>>>();
      const paidCandidates = list.filter(s => s.ngayNopThue);
      const GNT_DETAIL_CONCURRENCY = 4;
      let cursor = 0;
      const workerCount = Math.min(GNT_DETAIL_CONCURRENCY, paidCandidates.length);
      await Promise.all(Array.from({ length: workerCount }, async () => {
        while (cursor < paidCandidates.length) {
          const slip = paidCandidates[cursor++];
          detailMap.set(slip.id, await paymentSlipClient.getPaymentSlipDetail(slip.id));
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
      if (!stats || !stats.cells || stats.cells.length === 0) {
        throw new Error('Không có dữ liệu thống kê để xuất');
      }
      const taxCode = session.getSessionInfo().taxCode || 'DEFAULT';
      const baseDir = fileOrganizer.getBaseDir();
      const gntDir = path.join(baseDir, taxCode, 'GiayNopTien');
      if (!fs.existsSync(gntDir)) fs.mkdirSync(gntDir, { recursive: true });

      const buckets: GntStatBucket[] = stats.activeBuckets;
      const wb = new ExcelJS.Workbook();
      wb.creator = 'TaxInsight';
      const ws = wb.addWorksheet('Thong ke GNT');

      ws.mergeCells(1, 1, 1, 2 + buckets.length + 1);
      ws.getCell(1, 1).value = `THỐNG KÊ GIẤY NỘP TIỀN ĐÃ NỘP — THEO THÁNG & LOẠI THUẾ`;
      ws.getCell(1, 1).font = { bold: true, size: 13 };

      ws.mergeCells(2, 1, 2, 2 + buckets.length + 1);
      ws.getCell(2, 1).value = `MST: ${taxCode}   |   Năm dữ liệu: ${year}   |   Xuất lúc: ${new Date().toLocaleString('vi-VN')}   |   Đơn vị: VND`;
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
      for (const mk of stats.monthKeys) {
        ws.getCell(r, 1).value = `Tháng ${mk}`;
        buckets.forEach((b, i) => {
          const v = GntStatisticsEngine.amountOf(stats, mk, b);
          const cell = ws.getCell(r, 2 + i);
          cell.value = v || null;
          cell.numFmt = '#,##0';
        });
        const tot = ws.getCell(r, 2 + buckets.length);
        tot.value = GntStatisticsEngine.rowTotal(stats, mk);
        tot.numFmt = '#,##0';
        tot.font = { bold: true };
        r++;
      }

      // Grand total row
      ws.getCell(r, 1).value = 'TỔNG CỘNG';
      ws.getCell(r, 1).font = { bold: true };
      buckets.forEach((b, i) => {
        const c = ws.getCell(r, 2 + i);
        c.value = GntStatisticsEngine.columnTotal(stats, b);
        c.numFmt = '#,##0';
        c.font = { bold: true };
      });
      const gt = ws.getCell(r, 2 + buckets.length);
      gt.value = stats.grandTotal;
      gt.numFmt = '#,##0';
      gt.font = { bold: true };
      gt.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3CD' } };

      // Notes
      r += 2;
      ws.getCell(r, 1).value = `Ghi chú: chỉ tính GNT đã nộp thành công (${stats.paidCount} giấy); bỏ qua ${stats.skippedUnpaidCount} giấy chưa nộp/thất bại.`;
      if (stats.noDetailCount > 0) {
        ws.getCell(r + 1, 1).value = `${stats.noDetailCount} giấy không đọc được chi tiết C1-02/NS nên toàn bộ số tiền tạm xếp vào cột "Chưa phân loại".`;
      }

      ws.getColumn(1).width = 18;
      for (let i = 2; i <= 2 + buckets.length; i++) ws.getColumn(i).width = 16;

      const fileName = sanitizeFilename(`ThongKe_GNT_${year}_${Date.now()}.xlsx`);
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
    if (!isValidTaxCode(taxCode)) {
      return { success: false, data: null, error: 'Mã số thuế không hợp lệ' };
    }
    const data = checkpointStore.loadCheckpoint(taxCode.trim(), normalizeYear(year));
    return { success: true, data };
  });

  ipcMain.handle('checkpoint:clear', async (_event, { taxCode, year }) => {
    if (!isValidTaxCode(taxCode)) {
      return { success: false, error: 'Mã số thuế không hợp lệ' };
    }
    checkpointStore.clearCheckpoint(taxCode.trim(), normalizeYear(year));
    return { success: true };
  });

  // ─── GNT CHECKPOINT (PERSISTENCE GIẤY NỘP TIỀN THEO MST + NĂM) ──────
  ipcMain.handle('gntCheckpoint:get', async (_event, { taxCode, year }) => {
    if (!isValidTaxCode(taxCode)) {
      return { success: false, data: null as GntCheckpointData | null, error: 'Mã số thuế không hợp lệ' };
    }
    const data = gntCheckpointStore.load(taxCode.trim(), normalizeYear(year));
    return { success: true, data };
  });

  ipcMain.handle('gntCheckpoint:save', async (_event, { taxCode, year, paymentSlips, dateRange }) => {
    if (!isValidTaxCode(taxCode)) {
      return { success: false, error: 'Mã số thuế không hợp lệ' };
    }
    if (!Array.isArray(paymentSlips)) {
      return { success: false, error: 'Danh sách Giấy Nộp Tiền không hợp lệ' };
    }
    gntCheckpointStore.save(taxCode.trim(), normalizeYear(year), paymentSlips as PaymentSlipRecord[], dateRange);
    return { success: true };
  });

  ipcMain.handle('gntCheckpoint:clear', async (_event, { taxCode, year }) => {
    if (!isValidTaxCode(taxCode)) {
      return { success: false, error: 'Mã số thuế không hợp lệ' };
    }
    gntCheckpointStore.clear(taxCode.trim(), normalizeYear(year));
    return { success: true };
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
    return AccountStore.saveAccount(opts);
  });

  ipcMain.handle('accounts:getCredentials', async (_event, { taxCode }: { taxCode: string }) => {
    return AccountStore.getAccountCredentials(taxCode);
  });

  ipcMain.handle('accounts:remove', async (_event, { taxCode }: { taxCode: string }) => {
    return AccountStore.removeAccount(taxCode);
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
}

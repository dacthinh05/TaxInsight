import { app, BrowserWindow, nativeImage } from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DownloadManager } from './downloader/DownloadManager';
import { LegacyFilingDownloader } from './downloader/LegacyFilingDownloader';
import { FileOrganizer } from './files/FileOrganizer';
import { setupIpcHandlers } from './ipc/ipcHandlers';
import { AuditLogger } from './persistence/AuditLogger';
import { CheckpointStore } from './persistence/CheckpointStore';
import { GntCheckpointStore } from './persistence/GntCheckpointStore';
import { HistoricalCheckpointStore } from './persistence/HistoricalCheckpointStore';
import { SettingsStore } from './persistence/SettingsStore';
import { CaptchaManager } from './portal/CaptchaManager';
import { LegacyFilingClient } from './portal/LegacyFilingClient';
import { PaymentSlipClient } from './portal/PaymentSlipClient';
import { PortalSession } from './portal/PortalSession';
import { TaxPortalClient } from './portal/TaxPortalClient';
import { TaxScanEngine } from './scanner/TaxScanEngine';
import { LegacyFilingLookupWorkflow } from './scanner/LegacyFilingLookupWorkflow';
import { AppUpdater } from './updater/AppUpdater';
import { isAllowedExternalUrl, isAllowedInternalUrl } from './security/navigationGuard';

// Đảm bảo tên ứng dụng và thư mục userData luôn thống nhất trên mọi môi trường
app.setName('TaxInsight');

let mainWindow: BrowserWindow | null = null;

// ─── SINGLETON SERVICES (khởi tạo đúng MỘT lần cho toàn bộ vòng đời app) ───
// Trước đây createWindow() tạo lại toàn bộ service + đăng ký lại ~45 IPC handler
// mỗi lần gọi — trên macOS, activate sau khi đóng cửa sổ sẽ throw
// "Attempted to register a second handler" và để lại cửa sổ trắng + IPC chết.
type AppServices = {
  session: PortalSession;
  client: TaxPortalClient;
  paymentSlipClient: PaymentSlipClient;
  legacyFilingClient: LegacyFilingClient;
  captchaManager: CaptchaManager;
  fileOrganizer: FileOrganizer;
  scanEngine: TaxScanEngine;
  downloadManager: DownloadManager;
  legacyFilingDownloader: LegacyFilingDownloader;
  legacyFilingWorkflow: LegacyFilingLookupWorkflow;
  checkpointStore: CheckpointStore;
  gntCheckpointStore: GntCheckpointStore;
  historicalCheckpointStore: HistoricalCheckpointStore;
  auditLogger: AuditLogger;
};
const serviceContainer: Partial<AppServices> = {};
let ipcRegistered = false;
let updaterStarted = false;

function getOrCreateServices(initialDownloadDir: string): AppServices {
  if (!serviceContainer.session) {
    const session = new PortalSession();
    const client = new TaxPortalClient(session);
    const paymentSlipClient = new PaymentSlipClient(session);
    const legacyFilingClient = new LegacyFilingClient(session);
    const captchaManager = new CaptchaManager(client);
    const fileOrganizer = new FileOrganizer(initialDownloadDir);
    const historicalCheckpointStore = new HistoricalCheckpointStore(initialDownloadDir);

    Object.assign(serviceContainer, {
      session,
      client,
      paymentSlipClient,
      legacyFilingClient,
      captchaManager,
      fileOrganizer,
      scanEngine: new TaxScanEngine(client, captchaManager),
      downloadManager: new DownloadManager(client, fileOrganizer, legacyFilingClient),
      legacyFilingDownloader: new LegacyFilingDownloader(legacyFilingClient, fileOrganizer),
      legacyFilingWorkflow: new LegacyFilingLookupWorkflow(
        legacyFilingClient,
        historicalCheckpointStore,
        fileOrganizer
      ),
      checkpointStore: new CheckpointStore(initialDownloadDir),
      gntCheckpointStore: new GntCheckpointStore(initialDownloadDir),
      historicalCheckpointStore,
      auditLogger: new AuditLogger(initialDownloadDir)
    } satisfies AppServices);
  }
  return serviceContainer as AppServices;
}

function createWindow() {
  try {
    const initialDownloadDir = SettingsStore.getDownloadDir();
  const {
    session, client, paymentSlipClient, legacyFilingClient, captchaManager, fileOrganizer,
    scanEngine, downloadManager, legacyFilingDownloader, legacyFilingWorkflow,
    checkpointStore, gntCheckpointStore, historicalCheckpointStore, auditLogger
  } = getOrCreateServices(initialDownloadDir);

  // Tìm icon đa fallback đảm bảo luôn tải được icon trên mọi môi trường
  const possibleIconPaths = [
    path.join(__dirname, '../../build/icon.ico'),
    path.join(__dirname, '../../build/icon.png'),
    path.join(__dirname, '../../public/icon.png'),
    path.join(app.getAppPath(), 'build/icon.ico'),
    path.join(app.getAppPath(), 'build/icon.png'),
    path.join(process.resourcesPath, 'build/icon.ico'),
    path.join(process.resourcesPath, 'build/icon.png')
  ];

  let appIcon: any = undefined;
  for (const p of possibleIconPaths) {
    if (fs.existsSync(p)) {
      const img = nativeImage.createFromPath(p);
      if (!img.isEmpty()) {
        appIcon = img;
        break;
      }
    }
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    title: 'TaxInsight – Hệ Thống Soát Xét & Đối Chiếu Thuế',
    icon: appIcon || path.join(__dirname, '../../build/icon.ico'),
    backgroundColor: '#F4F7FA',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Preload chỉ dùng contextBridge + ipcRenderer — đều khả dụng trong sandbox.
      // Trước đây sandbox:false vô ích làm giảm isolation của renderer.
      sandbox: true,
      webSecurity: true
    },
    autoHideMenuBar: true
  });

  // ── TEMP DEBUG: ghi lỗi renderer ra file để chẩn đoán màn hình trắng ──
  // (giới hạn kích thước: rotate khi vượt 2MB thay vì append vô hạn)
  if (!app.isPackaged || process.env.TAXINSIGHT_RENDERER_DEBUG === '1') try {
    const dbgLogPath = path.join(app.getPath('temp'), 'taxrecord_renderer.log');
    const dbgLog = (m: string) => {
      try {
        try {
          const st = fs.statSync(dbgLogPath);
          if (st.size > 2 * 1024 * 1024) {
            fs.renameSync(dbgLogPath, `${dbgLogPath}.old`);
          }
        } catch {}
        fs.appendFileSync(dbgLogPath, `[${new Date().toISOString()}] ${m}\n`);
      } catch {}
    };
    dbgLog(`=== session start ===`);
    mainWindow.webContents.on('console-message', (_ev, _level, message, line, sourceId) => {
      dbgLog(`console: ${message} @${sourceId}:${line}`);
    });
    mainWindow.webContents.on('preload-error', (_ev, p, err) => {
      dbgLog(`PRELOAD-ERROR ${p}: ${err}`);
    });
    mainWindow.webContents.on('render-process-gone', (_ev, details) => {
      dbgLog(`RENDER-GONE: ${JSON.stringify(details)}`);
    });
  } catch {}

  if (appIcon && mainWindow) {
    mainWindow.setIcon(appIcon);
  }

  const sendToRenderer = (channel: string, data: any) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  };

  if (!ipcRegistered) {
    setupIpcHandlers(
      session,
      client,
      paymentSlipClient,
      legacyFilingClient,
      captchaManager,
      scanEngine,
      downloadManager,
      legacyFilingDownloader,
      legacyFilingWorkflow,
      fileOrganizer,
      checkpointStore,
      gntCheckpointStore,
      historicalCheckpointStore,
      auditLogger,
      sendToRenderer
    );
    ipcRegistered = true;
  }

  const updater = AppUpdater.getInstance();
  updater.setMainWindow(mainWindow);

  const isDev = !app.isPackaged && process.env.NODE_ENV !== 'production';

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[Electron] Failed to load URL: ${url}, Code: ${code}, Desc: ${desc}`);
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[Electron] Renderer process gone:`, details);
  });

  const indexPath = path.resolve(__dirname, '../../dist/index.html');

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(indexPath).catch(err => {
      console.error('[Electron] Failed to load index.html:', err);
    });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  } catch (err: any) {
    try {
      fs.appendFileSync(path.join(process.cwd(), 'startup_error.log'), `[CREATE_WINDOW_ERROR] ${err?.stack || err}\n`);
    } catch {}
    console.error('[Create Window Error]:', err);
  }
}

process.on('uncaughtException', err => {
  console.error('[Electron Process Error]:', err);
});

process.on('unhandledRejection', reason => {
  console.error('[Electron Unhandled Rejection]:', reason);
});

// ─── HARDENING TOÀN CỤC: chặn navigation/window.open trái phép ──────────────
// Áp dụng cho MỌI webContents (cửa sổ chính, auth popup, window in PDF ẩn...)
// để renderer bị chiếm (CDN hỏng, update poisoned) không điều hướng app sang
// nội dung tấn công và không spawn cửa sổ kế thừa webPreferences.

app.on('web-contents-created', (_event, contents) => {
  // Ứng dụng không cần camera/micro/vị trí/thông báo. Từ chối mặc định để nội
  // dung portal hoặc renderer bị chèn script không thể xin thêm quyền hệ thống.
  contents.session.setPermissionCheckHandler(() => false);
  contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  // Chặn điều hướng ra ngoài tập URL cho phép (window chính load dist/dev,
  // auth popup điều hướng gdt.gov.vn)
  contents.on('will-navigate', (event, url) => {
    if (!isAllowedInternalUrl(url)) {
      event.preventDefault();
      console.warn(`[Security] Blocked navigation to: ${url}`);
    }
  });

  // window.open / target=_blank: không mở cửa sổ kế thừa webPreferences;
  // URL http(s) hợp lệ mở bằng trình duyệt hệ thống, còn lại từ chối.
  contents.setWindowOpenHandler(({ url }) => {
    try {
      const u = new URL(url);
      if (isAllowedExternalUrl(url)) {
        const { shell } = require('electron') as typeof import('electron');
        shell.openExternal(url).catch(() => {});
      }
    } catch {
      // URL rác — bỏ qua
    }
    return { action: 'deny' };
  });
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

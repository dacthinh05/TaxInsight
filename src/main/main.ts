import { app, BrowserWindow, nativeImage } from 'electron';
import fs from 'fs';
import path from 'path';
import { DownloadManager } from './downloader/DownloadManager';
import { FileOrganizer } from './files/FileOrganizer';
import { setupIpcHandlers } from './ipc/ipcHandlers';
import { AuditLogger } from './persistence/AuditLogger';
import { CheckpointStore } from './persistence/CheckpointStore';
import { GntCheckpointStore } from './persistence/GntCheckpointStore';
import { SettingsStore } from './persistence/SettingsStore';
import { CaptchaManager } from './portal/CaptchaManager';
import { PaymentSlipClient } from './portal/PaymentSlipClient';
import { PortalSession } from './portal/PortalSession';
import { TaxPortalClient } from './portal/TaxPortalClient';
import { TaxScanEngine } from './scanner/TaxScanEngine';
import { AppUpdater } from './updater/AppUpdater';

// Đảm bảo tên ứng dụng và thư mục userData luôn thống nhất trên mọi môi trường
app.setName('TaxInsight');

let mainWindow: BrowserWindow | null = null;

// ─── SINGLETON SERVICES (khởi tạo đúng MỘT lần cho toàn bộ vòng đời app) ───
// Trước đây createWindow() tạo lại toàn bộ service + đăng ký lại ~45 IPC handler
// mỗi lần gọi — trên macOS, activate sau khi đóng cửa sổ sẽ throw
// "Attempted to register a second handler" và để lại cửa sổ trắng + IPC chết.
const serviceContainer: {
  session?: PortalSession;
  client?: TaxPortalClient;
  paymentSlipClient?: PaymentSlipClient;
  captchaManager?: CaptchaManager;
  fileOrganizer?: FileOrganizer;
  scanEngine?: TaxScanEngine;
  downloadManager?: DownloadManager;
  checkpointStore?: CheckpointStore;
  gntCheckpointStore?: GntCheckpointStore;
  auditLogger?: AuditLogger;
} = {};
let ipcRegistered = false;
let updaterStarted = false;

function getOrCreateServices(initialDownloadDir: string) {
  if (!serviceContainer.session) {
    serviceContainer.session = new PortalSession();
    serviceContainer.client = new TaxPortalClient(serviceContainer.session);
    serviceContainer.paymentSlipClient = new PaymentSlipClient(serviceContainer.session);
    serviceContainer.captchaManager = new CaptchaManager(serviceContainer.client);
    serviceContainer.fileOrganizer = new FileOrganizer(initialDownloadDir);
    serviceContainer.scanEngine = new TaxScanEngine(serviceContainer.client, serviceContainer.captchaManager);
    serviceContainer.downloadManager = new DownloadManager(serviceContainer.client, serviceContainer.fileOrganizer);
    serviceContainer.checkpointStore = new CheckpointStore(initialDownloadDir);
    serviceContainer.gntCheckpointStore = new GntCheckpointStore(initialDownloadDir);
    serviceContainer.auditLogger = new AuditLogger(initialDownloadDir);
  }
  return serviceContainer as Required<NonNullable<typeof serviceContainer>>;
}

function createWindow() {
  const initialDownloadDir = SettingsStore.getDownloadDir();
  const {
    session, client, paymentSlipClient, captchaManager, fileOrganizer,
    scanEngine, downloadManager, checkpointStore, gntCheckpointStore, auditLogger
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
      sandbox: false,
      webSecurity: true
    },
    autoHideMenuBar: true
  });

  // ── TEMP DEBUG: ghi lỗi renderer ra file để chẩn đoán màn hình trắng ──
  try {
    const dbgLogPath = path.join(app.getPath('temp'), 'taxrecord_renderer.log');
    const dbgLog = (m: string) => {
      try { fs.appendFileSync(dbgLogPath, `[${new Date().toISOString()}] ${m}\n`); } catch {}
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
      captchaManager,
      scanEngine,
      downloadManager,
      fileOrganizer,
      checkpointStore,
      gntCheckpointStore,
      auditLogger,
      sendToRenderer
    );
    ipcRegistered = true;
  }

  const updater = AppUpdater.getInstance();
  updater.setMainWindow(mainWindow);
  if (!updaterStarted) {
    updater.startAutoCheckTimer(4000);
    updaterStarted = true;
  }

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
}

process.on('uncaughtException', err => {
  console.error('[Electron Process Error]:', err);
});

process.on('unhandledRejection', reason => {
  console.error('[Electron Unhandled Rejection]:', reason);
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

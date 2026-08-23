import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import { UpdateInfo, UpdateState } from '../../shared/types';

export class AppUpdater {
  private static instance: AppUpdater | null = null;
  private currentStatus: UpdateInfo;
  private mainWindow: BrowserWindow | null = null;
  private autoCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private autoCheckInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.currentStatus = {
      state: 'IDLE',
      currentVersion: (app && typeof app.getVersion === 'function') ? app.getVersion() : '2.0.0'
    };

    this.configureUpdater();
  }

  public static getInstance(): AppUpdater {
    if (!AppUpdater.instance) {
      AppUpdater.instance = new AppUpdater();
    }
    return AppUpdater.instance;
  }

  public setMainWindow(window: BrowserWindow | null) {
    this.mainWindow = window;
  }

  private configureUpdater() {
    if (!app || typeof app.getVersion !== 'function') {
      return;
    }
    try {
      // Không tự ý tải ngầm mà để người dùng xem changelog và bấm xác nhận
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = true;

      autoUpdater.on('checking-for-update', () => {
        this.updateState('CHECKING');
      });

    autoUpdater.on('update-available', (info) => {
      let releaseNotes = '';
      if (typeof info.releaseNotes === 'string') {
        releaseNotes = info.releaseNotes;
      } else if (Array.isArray(info.releaseNotes)) {
        releaseNotes = info.releaseNotes.map(n => typeof n === 'string' ? n : (n as any).note || '').join('\n');
      }

      this.updateState('AVAILABLE', {
        latestVersion: info.version,
        releaseDate: info.releaseDate,
        releaseNotes: releaseNotes || 'Bản cập nhật tối ưu hóa hiệu năng và sửa lỗi hệ thống.'
      });
    });

    autoUpdater.on('update-not-available', () => {
      this.updateState('NOT_AVAILABLE');
    });

    autoUpdater.on('download-progress', (progressObj) => {
      this.updateState('DOWNLOADING', {
        downloadPercent: Math.round(progressObj.percent || 0),
        transferredBytes: progressObj.transferred,
        totalBytes: progressObj.total,
        downloadSpeed: `${Math.round((progressObj.bytesPerSecond || 0) / 1024)} KB/s`
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      this.updateState('DOWNLOADED', {
        latestVersion: info.version
      });
    });

    autoUpdater.on('error', (err) => {
      // Trong môi trường dev hoặc chưa upload release, bỏ qua lỗi mạng mà không làm crash app
      this.updateState('ERROR', {
        error: err.message || 'Không thể kết nối đến máy chủ cập nhật.'
      });
    });
    } catch {
      // Bỏ qua lỗi khởi tạo trong môi trường test/node thuần
    }
  }

  private updateState(state: UpdateState, extra?: Partial<UpdateInfo>) {
    this.currentStatus = {
      ...this.currentStatus,
      state,
      ...extra
    };

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('updater:status', this.currentStatus);
    }
  }

  public getStatus(): UpdateInfo {
    return {
      ...this.currentStatus,
      currentVersion: (app && typeof app.getVersion === 'function') ? app.getVersion() : '2.0.0'
    };
  }

  public async checkForUpdates(): Promise<UpdateInfo> {
    if (!app || typeof app.getVersion !== 'function') {
      this.updateState('NOT_AVAILABLE');
      return this.getStatus();
    }
    try {
      this.updateState('CHECKING');
      await autoUpdater.checkForUpdates();
    } catch (err: any) {
      this.updateState('ERROR', { error: err.message });
    }
    return this.getStatus();
  }

  public async downloadUpdate(): Promise<{ success: boolean; error?: string }> {
    try {
      this.updateState('DOWNLOADING', { downloadPercent: 0 });
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (err: any) {
      this.updateState('ERROR', { error: err.message });
      return { success: false, error: err.message };
    }
  }

  public quitAndInstall() {
    autoUpdater.quitAndInstall(false, true);
  }

  /**
   * Khởi động bộ đếm tự động kiểm tra bản cập nhật: check lần đầu sau delayMs
   * rồi lặp lại MỖI GIỜ (trước đây chỉ check đúng 1 lần duy nhất sau khi mở app)
   */
  public startAutoCheckTimer(delayMs = 4000) {
    if (this.autoCheckTimer) clearTimeout(this.autoCheckTimer);
    if (this.autoCheckInterval) clearInterval(this.autoCheckInterval);

    this.autoCheckTimer = setTimeout(() => {
      this.checkForUpdates().catch(() => {});
      this.autoCheckInterval = setInterval(() => {
        this.checkForUpdates().catch(() => {});
      }, 60 * 60 * 1000);
    }, delayMs);
  }
}

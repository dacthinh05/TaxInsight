import { app, BrowserWindow } from 'electron';
import { autoUpdater } from 'electron-updater';
import https from 'https';
import { UpdateInfo, UpdateState } from '../../shared/types';
import {
  compareVersions,
  friendlyUpdaterError,
  GithubLatestRelease,
  hasCompleteWindowsUpdateAssets,
  normalizeReleaseVersion
} from './UpdaterReleaseGuard';

const LATEST_RELEASE_API = 'https://api.github.com/repos/dacthinh05/TaxInsight/releases/latest';

export class AppUpdater {
  private static instance: AppUpdater | null = null;
  private currentStatus: UpdateInfo;
  private mainWindow: BrowserWindow | null = null;
  private autoCheckTimer: ReturnType<typeof setTimeout> | null = null;
  private autoCheckInterval: ReturnType<typeof setInterval> | null = null;
  private checkPromise: Promise<UpdateInfo> | null = null;

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
      // Không đẩy nguyên stack trace/URL nội bộ của electron-updater ra giao diện.
      this.updateState('ERROR', {
        error: friendlyUpdaterError(err)
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
    if (this.checkPromise) return this.checkPromise;
    if (!app || typeof app.getVersion !== 'function') {
      this.updateState('NOT_AVAILABLE');
      return this.getStatus();
    }
    const check = (async () => {
      try {
        this.updateState('CHECKING', { error: undefined });

        // electron-updater truy cập latest.yml ngay lập tức. Nếu release mới nhất
        // trên GitHub bị upload thiếu artifact, thư viện trả nguyên HttpError 404
        // rất dài. Kiểm tra metadata release trước để:
        // 1) không gọi feed khi bản đang cài đã mới hơn GitHub;
        // 2) báo lỗi ngắn gọn nếu release chưa đủ latest.yml + installer.
        const release = await this.fetchLatestGithubRelease().catch(() => null);
        if (release) {
          const latestVersion = normalizeReleaseVersion(release.tag_name);
          const currentVersion = app.getVersion();

          if (latestVersion && compareVersions(latestVersion, currentVersion) <= 0) {
            this.updateState('NOT_AVAILABLE', {
              latestVersion,
              error: undefined
            });
            return this.getStatus();
          }

          if (latestVersion && !hasCompleteWindowsUpdateAssets(release)) {
            this.updateState('ERROR', {
              latestVersion,
              error: `Bản phát hành v${latestVersion} chưa có đủ bộ cài cập nhật (latest.yml và file .exe). Phiên bản hiện tại v${currentVersion} vẫn dùng bình thường.`
            });
            return this.getStatus();
          }
        }

        await autoUpdater.checkForUpdates();
      } catch (err: any) {
        this.updateState('ERROR', { error: friendlyUpdaterError(err) });
      }
      return this.getStatus();
    })();
    this.checkPromise = check;
    try {
      return await check;
    } finally {
      if (this.checkPromise === check) this.checkPromise = null;
    }
  }

  public async downloadUpdate(): Promise<{ success: boolean; error?: string }> {
    try {
      this.updateState('DOWNLOADING', { downloadPercent: 0 });
      await autoUpdater.downloadUpdate();
      return { success: true };
    } catch (err: any) {
      const error = friendlyUpdaterError(err);
      this.updateState('ERROR', { error });
      return { success: false, error };
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

  private fetchLatestGithubRelease(): Promise<GithubLatestRelease> {
    return new Promise((resolve, reject) => {
      const request = https.get(
        LATEST_RELEASE_API,
        {
          headers: {
            'Accept': 'application/vnd.github+json',
            'User-Agent': `TaxInsight/${app.getVersion()}`,
            'X-GitHub-Api-Version': '2022-11-28'
          }
        },
        response => {
          const chunks: Buffer[] = [];
          let totalBytes = 0;
          const maxBytes = 1024 * 1024;

          response.on('data', (chunk: Buffer) => {
            totalBytes += chunk.length;
            if (totalBytes > maxBytes) {
              request.destroy(new Error('Phản hồi máy chủ cập nhật quá lớn'));
              return;
            }
            chunks.push(chunk);
          });

          response.on('end', () => {
            const statusCode = response.statusCode || 0;
            if (statusCode < 200 || statusCode >= 300) {
              reject(new Error(`GitHub Releases trả HTTP ${statusCode}`));
              return;
            }
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as GithubLatestRelease);
            } catch {
              reject(new Error('Metadata bản phát hành không hợp lệ'));
            }
          });
        }
      );

      request.setTimeout(7000, () => {
        request.destroy(new Error('Timeout khi kiểm tra metadata bản cập nhật'));
      });
      request.on('error', reject);
    });
  }
}

import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export interface AppSettings {
  downloadDir?: string;
  [key: string]: any;
}

export class SettingsStore {
  private static getUserDataPath(): string {
    if (app && typeof app.getPath === 'function') {
      try {
        return app.getPath('userData');
      } catch {}
    }
    const base = process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming');
    return path.join(base, 'TaxInsight');
  }

  private static getAppDataPath(): string {
    if (app && typeof app.getPath === 'function') {
      try {
        return app.getPath('appData');
      } catch {}
    }
    return process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming');
  }

  private static getStoreFilePath(): string {
    const userDataPath = this.getUserDataPath();
    const primaryPath = path.join(userDataPath, '.taxrecord_settings.json');
    if (fs.existsSync(primaryPath)) {
      return primaryPath;
    }

    try {
      const appData = this.getAppDataPath();
      const fallbackFolders = ['TaxInsight', 'tax-insight', 'tax-record', 'tax-record-downloader', 'taxinsight'];
      for (const folder of fallbackFolders) {
        const legacyPath = path.join(appData, folder, '.taxrecord_settings.json');
        if (fs.existsSync(legacyPath)) {
          if (!fs.existsSync(userDataPath)) {
            fs.mkdirSync(userDataPath, { recursive: true });
          }
          fs.copyFileSync(legacyPath, primaryPath);
          return primaryPath;
        }
      }
    } catch {
      // Bỏ qua lỗi migrate
    }

    return primaryPath;
  }

  public static getDefaultDownloadDir(): string {
    try {
      if (app && typeof app.getPath === 'function') {
        return path.join(app.getPath('downloads'), 'HoSoThue_GDT');
      }
    } catch {}
    const home = process.env.USERPROFILE || require('os').homedir();
    return path.join(home, 'Downloads', 'HoSoThue_GDT');
  }

  public static getSettings(): AppSettings {
    try {
      const filePath = this.getStoreFilePath();
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.downloadDir) {
          return parsed;
        }
      }

      // Check fallback folders nếu file chính chưa có downloadDir
      const appData = this.getAppDataPath();
      const fallbackFolders = ['TaxInsight', 'tax-insight', 'tax-record', 'tax-record-downloader', 'taxinsight'];
      for (const folder of fallbackFolders) {
        const legacyPath = path.join(appData, folder, '.taxrecord_settings.json');
        if (fs.existsSync(legacyPath)) {
          try {
            const raw = fs.readFileSync(legacyPath, 'utf-8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && parsed.downloadDir) {
              return parsed;
            }
          } catch {}
        }
      }

      return {};
    } catch (err) {
      console.error('[SettingsStore] Lỗi đọc cài đặt:', err);
      return {};
    }
  }

  public static saveSettings(settings: Partial<AppSettings>): AppSettings {
    try {
      const filePath = this.getStoreFilePath();
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const current = this.getSettings();
      const updated = { ...current, ...settings };
      const content = JSON.stringify(updated, null, 2);
      fs.writeFileSync(filePath, content, 'utf-8');

      // Đồng bộ tới tất cả thư mục AppData fallback để luôn giữ nguyên cài đặt
      try {
        const appData = this.getAppDataPath();
        const fallbackFolders = ['TaxInsight', 'tax-insight', 'tax-record', 'tax-record-downloader', 'taxinsight'];
        for (const folder of fallbackFolders) {
          const folderPath = path.join(appData, folder);
          if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
          }
          const targetFile = path.join(folderPath, '.taxrecord_settings.json');
          fs.writeFileSync(targetFile, content, 'utf-8');
        }
      } catch {}

      return updated;
    } catch (err) {
      console.error('[SettingsStore] Lỗi lưu cài đặt:', err);
      return this.getSettings();
    }
  }

  public static getDownloadDir(): string {
    const settings = this.getSettings();
    if (settings.downloadDir && typeof settings.downloadDir === 'string' && settings.downloadDir.trim().length > 0) {
      const candidateDir = path.resolve(settings.downloadDir.trim());
      try {
        if (!fs.existsSync(candidateDir)) {
          fs.mkdirSync(candidateDir, { recursive: true });
        }
        return candidateDir;
      } catch (err) {
        console.warn(`[SettingsStore] Không thể truy cập thư mục cài đặt "${candidateDir}", sử dụng thư mục mặc định.`, err);
      }
    }
    return this.getDefaultDownloadDir();
  }

  public static setDownloadDir(dir: string): void {
    if (!dir || typeof dir !== 'string') return;
    const cleanPath = path.resolve(dir.trim());
    try {
      if (!fs.existsSync(cleanPath)) {
        fs.mkdirSync(cleanPath, { recursive: true });
      }
    } catch (err) {
      console.error('[SettingsStore] Không thể tạo thư mục lưu trữ:', err);
    }
    this.saveSettings({ downloadDir: cleanPath });
  }

  public static resetDownloadDir(): string {
    const defaultDir = this.getDefaultDownloadDir();
    const settings = this.getSettings();
    delete settings.downloadDir;

    try {
      const content = JSON.stringify(settings, null, 2);
      const filePath = this.getStoreFilePath();
      fs.writeFileSync(filePath, content, 'utf-8');

      const appData = this.getAppDataPath();
      const fallbackFolders = ['TaxInsight', 'tax-insight', 'tax-record', 'tax-record-downloader', 'taxinsight'];
      for (const folder of fallbackFolders) {
        const targetFile = path.join(appData, folder, '.taxrecord_settings.json');
        if (fs.existsSync(targetFile)) {
          fs.writeFileSync(targetFile, content, 'utf-8');
        }
      }
    } catch (err) {
      console.error('[SettingsStore] Lỗi khi reset cài đặt:', err);
    }
    return defaultDir;
  }
}


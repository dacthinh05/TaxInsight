import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { MachineIdProvider } from '../licensing/MachineIdProvider';
import { atomicWriteString } from './atomicWrite';

export interface SavedAccountItem {
  taxCode: string;
  companyName?: string;
  passwordEncrypted?: string;
  hasPassword: boolean;
  savedAt: string;
  lastUsedAt: string;
}

export interface AccountCredentials {
  taxCode: string;
  password?: string;
  companyName?: string;
}

export class AccountStore {
  private static readonly MASTER_SALT = 'TR_2026_ACCOUNTS_STORAGE_SECURE_ENCRYPTION_KEY_SALT';

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
    const primaryPath = path.join(userDataPath, '.taxrecord_accounts.dat');
    if (fs.existsSync(primaryPath)) {
      return primaryPath;
    }

    try {
      const appData = this.getAppDataPath();
      const fallbackFolders = ['TaxInsight', 'tax-insight', 'tax-record', 'tax-record-downloader', 'taxinsight'];
      for (const folder of fallbackFolders) {
        const legacyPath = path.join(appData, folder, '.taxrecord_accounts.dat');
        if (fs.existsSync(legacyPath)) {
          if (!fs.existsSync(userDataPath)) {
            fs.mkdirSync(userDataPath, { recursive: true });
          }
          fs.copyFileSync(legacyPath, primaryPath);
          return primaryPath;
        }
      }
    } catch {
      // Bỏ qua
    }

    return primaryPath;
  }

  private static getEncryptionKey(machineIdOverride?: string): Buffer {
    const machineId = machineIdOverride || MachineIdProvider.getMachineId();
    return crypto
      .createHash('sha256')
      .update(`${machineId}:${this.MASTER_SALT}`)
      .digest();
  }

  private static encrypt(text: string): string {
    const key = this.getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf-8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${encrypted}`;
  }

  private static decrypt(encryptedText: string): string | null {
    try {
      const parts = encryptedText.split(':');
      if (parts.length !== 2) return null;
      const iv = Buffer.from(parts[0], 'hex');
      const data = parts[1];

      // Thử giải mã bằng Machine ID chuẩn trước
      try {
        const key = this.getEncryptionKey();
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let decrypted = decipher.update(data, 'hex', 'utf-8');
        decrypted += decipher.final('utf-8');
        if (decrypted) return decrypted;
      } catch {}

      // Nếu không được, thử giải mã bằng Machine ID Legacy (tương thích ngược)
      try {
        const legacyKey = this.getEncryptionKey(MachineIdProvider.getLegacyMachineId());
        const decipherLegacy = crypto.createDecipheriv('aes-256-cbc', legacyKey, iv);
        let decryptedLegacy = decipherLegacy.update(data, 'hex', 'utf-8');
        decryptedLegacy += decipherLegacy.final('utf-8');
        return decryptedLegacy || null;
      } catch {}

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Lấy toàn bộ danh sách tài khoản đã lưu (không kèm mật khẩu thô)
   */
  public static getSavedAccounts(): SavedAccountItem[] {
    const filePath = this.getStoreFilePath();
    if (!fs.existsSync(filePath)) return [];

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const decrypted = this.decrypt(raw);
      if (!decrypted) return [];
      const list: Array<{
        taxCode: string;
        companyName?: string;
        passwordEncrypted?: string;
        savedAt: string;
        lastUsedAt: string;
      }> = JSON.parse(decrypted);

      return list.map(item => ({
        taxCode: item.taxCode,
        companyName: item.companyName,
        hasPassword: Boolean(item.passwordEncrypted),
        savedAt: item.savedAt,
        lastUsedAt: item.lastUsedAt
      })).sort((a, b) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime());
    } catch {
      return [];
    }
  }

  /**
   * Lưu hoặc cập nhật tài khoản MST
   */
  public static saveAccount(opts: {
    taxCode: string;
    password?: string;
    companyName?: string;
    savePassword?: boolean;
  }): boolean {
    try {
      const taxCode = opts.taxCode.trim();
      if (!taxCode) return false;

      const filePath = this.getStoreFilePath();
      let list: Array<{
        taxCode: string;
        companyName?: string;
        passwordEncrypted?: string;
        savedAt: string;
        lastUsedAt: string;
      }> = [];
      let existingFileUnreadable = false;

      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const decrypted = this.decrypt(raw);
        if (decrypted) {
          try {
            list = JSON.parse(decrypted);
          } catch {}
        } else {
          // File tồn tại nhưng không giải mã được (hỏng dữ liệu / đổi máy):
          // đánh dấu để backup trước khi ghi, tránh XÓA SẠCH toàn bộ tài khoản đã lưu
          existingFileUnreadable = true;
        }
      }

      // Nếu file cũ không đọc được, giữ lại bản backup trước khi ghi đè
      if (existingFileUnreadable) {
        try {
          const raw = fs.readFileSync(filePath, 'utf-8');
          fs.writeFileSync(`${filePath}.unreadable.bak`, raw, 'utf-8');
        } catch {}
      }

      const now = new Date().toISOString();
      const existingIdx = list.findIndex(a => a.taxCode.toLowerCase() === taxCode.toLowerCase());

      let passwordEncrypted: string | undefined = undefined;
      if (opts.savePassword && opts.password) {
        passwordEncrypted = this.encrypt(opts.password);
      } else if (existingIdx >= 0 && opts.savePassword === undefined) {
        // Giữ nguyên mật khẩu cũ nếu không chỉ định
        passwordEncrypted = list[existingIdx].passwordEncrypted;
      }

      const accountData = {
        taxCode,
        companyName: opts.companyName || (existingIdx >= 0 ? list[existingIdx].companyName : undefined),
        passwordEncrypted,
        savedAt: existingIdx >= 0 ? list[existingIdx].savedAt : now,
        lastUsedAt: now
      };

      if (existingIdx >= 0) {
        list[existingIdx] = accountData;
      } else {
        list.push(accountData);
      }

      const jsonStr = JSON.stringify(list);
      const encData = this.encrypt(jsonStr);
      atomicWriteString(filePath, encData);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Lấy thông tin đăng nhập đã giải mã của một MST
   */
  public static getAccountCredentials(taxCode: string): AccountCredentials | null {
    const filePath = this.getStoreFilePath();
    if (!fs.existsSync(filePath)) return null;

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const decrypted = this.decrypt(raw);
      if (!decrypted) return null;
      const list: Array<{
        taxCode: string;
        companyName?: string;
        passwordEncrypted?: string;
      }> = JSON.parse(decrypted);

      const found = list.find(a => a.taxCode.toLowerCase() === taxCode.trim().toLowerCase());
      if (!found) return null;

      let password: string | undefined = undefined;
      if (found.passwordEncrypted) {
        password = this.decrypt(found.passwordEncrypted) || undefined;
      }

      return {
        taxCode: found.taxCode,
        companyName: found.companyName,
        password
      };
    } catch {
      return null;
    }
  }

  /**
   * Xóa một tài khoản khỏi danh sách
   */
  public static removeAccount(taxCode: string): boolean {
    const filePath = this.getStoreFilePath();
    if (!fs.existsSync(filePath)) return true;

    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const decrypted = this.decrypt(raw);
      if (!decrypted) return true;
      let list: Array<{ taxCode: string }> = JSON.parse(decrypted);

      list = list.filter(a => a.taxCode.toLowerCase() !== taxCode.trim().toLowerCase());
      const jsonStr = JSON.stringify(list);
      const encData = this.encrypt(jsonStr);
      atomicWriteString(filePath, encData);
      return true;
    } catch {
      return false;
    }
  }
}

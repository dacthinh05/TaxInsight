import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { MachineIdProvider } from './MachineIdProvider';

export type LicenseTier = 'TRIAL' | 'PERSONAL_1Y' | 'PRO_1Y' | 'LIFETIME';

export interface LicenseInfo {
  isActivated: boolean;
  tier: LicenseTier;
  tierLabel: string;
  machineId: string;
  isTrial: boolean;
  customerName?: string;
  expiryDate?: string; // YYYY-MM-DD hoặc 'LIFETIME'
  daysRemaining?: number;
  isExpired: boolean;
  activationDate?: string;
}

export interface LicensePayload {
  machineId: string;
  customerName: string;
  tier: LicenseTier;
  expiryDate: string; // 'YYYY-MM-DD' hoặc '2099-12-31' cho LIFETIME
  issuedAt: string;
  alg?: 'ED25519'; // Key mới: chữ ký bất đối xứng. Không có = định dạng HMAC cũ (deprecated)
  signature?: string;
}

/**
 * Khóa CÔNG KHAI Ed25519 — chỉ dùng để XÁC THỰC license key.
 * Khóa bí mật (ký) KHÔNG bao giờ nằm trong mã nguồn ứng dụng,
 * chỉ tồn tại ở máy developer: scripts/.license_ed25519_private.hex
 * Dùng scripts/keygen.ts để cấp key mới.
 */
const LICENSE_ED25519_PUBLIC_KEY_HEX =
  '302a300506032b6570032100515895ba21407af326ee4e2431b66973e273c798f4f37237b9523fd1b7cd3566';

// Secret HMAC chỉ còn phục vụ XÁC THỰC các key cũ đã cấp trước đây và mã hóa
// file license local (không còn dùng để cấp key mới).
const LEGACY_HMAC_SECRET = 'TR_2026_MASTER_SECRET_KEY_TAXRECORD_VIETNAM_SECURE_AUTH';
// Từ ngày này trở đi, key HMAC không còn được chấp nhận -> phải dùng keygen Ed25519.
const LEGACY_HMAC_ACCEPT_BEFORE_ISO = '2027-07-01T00:00:00.000Z';

export class LicenseManager {
  /** @internal Chỉ dành cho unit test: thay khóa công khai bằng cặp khóa test */
  public static _testOverrideEd25519PublicKey(hex: string | null): void {
    LicenseManager._testPublicKeyHex = hex;
  }
  private static _testPublicKeyHex: string | null = null;

  private static getUserDataPath(): string {
    if (app && typeof app.getPath === 'function') {
      return app.getPath('userData');
    }
    const base = process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming');
    return path.join(base, 'TaxInsight');
  }

  private static getAppDataPath(): string {
    if (app && typeof app.getPath === 'function') {
      return app.getPath('appData');
    }
    return process.env.APPDATA || path.join(require('os').homedir(), 'AppData', 'Roaming');
  }

  private static getLicenseFilePath(): string {
    const userDataPath = this.getUserDataPath();
    const primaryPath = path.join(userDataPath, '.taxrecord_license.dat');
    if (fs.existsSync(primaryPath)) {
      return primaryPath;
    }

    // Tự động tìm và di chuyển file bản quyền từ các thư mục phiên bản cũ (nếu có)
    try {
      const appData = this.getAppDataPath();
      const fallbackFolders = ['TaxInsight', 'tax-insight', 'tax-record', 'tax-record-downloader'];
      for (const folder of fallbackFolders) {
        const legacyPath = path.join(appData, folder, '.taxrecord_license.dat');
        if (fs.existsSync(legacyPath)) {
          if (!fs.existsSync(userDataPath)) {
            fs.mkdirSync(userDataPath, { recursive: true });
          }
          fs.copyFileSync(legacyPath, primaryPath);
          return primaryPath;
        }
      }
    } catch {
      // Bỏ qua lỗi migrate fallback
    }

    return primaryPath;
  }

  private static getTrialFilePath(): string {
    const userDataPath = this.getUserDataPath();
    const primaryPath = path.join(userDataPath, '.taxrecord_trial.dat');
    if (fs.existsSync(primaryPath)) {
      return primaryPath;
    }

    try {
      const appData = this.getAppDataPath();
      const fallbackFolders = ['TaxInsight', 'tax-insight', 'tax-record', 'tax-record-downloader'];
      for (const folder of fallbackFolders) {
        const legacyPath = path.join(appData, folder, '.taxrecord_trial.dat');
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

  /**
   * Lấy hoặc khởi tạo thời điểm dùng thử 7 ngày đầu tiên
   */
  private static getTrialStartDate(): Date {
    try {
      const trialFile = this.getTrialFilePath();
      if (fs.existsSync(trialFile)) {
        const raw = fs.readFileSync(trialFile, 'utf-8').trim();
        const d = new Date(raw);
        if (!isNaN(d.getTime())) return d;
      }
      const now = new Date();
      fs.writeFileSync(trialFile, now.toISOString(), 'utf-8');
      return now;
    } catch {
      return new Date();
    }
  }

  // ─── TIỆN ÍCH MẬT MÃ ────────────────────────────────────────────────────

  /** So sánh chuỗi nhạy cảm theo thời gian hằng số (chống timing attack) */
  private static safeEqualStr(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf-8');
    const bufB = Buffer.from(b, 'utf-8');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  private static canonicalSignString(payload: Omit<LicensePayload, 'signature'>): string {
    return `${payload.machineId.toUpperCase()}|${payload.customerName.trim()}|${payload.tier}|${payload.expiryDate}|${payload.issuedAt}`;
  }

  /**
   * Sinh License Key Ed25519 — CHỈ DÀNH CHO KEYGEN trên máy developer.
   * Ứng dụng không chứa khóa bí mật nên không thể tự cấp key qua hàm này.
   */
  public static generateLicenseKey(
    payload: Omit<LicensePayload, 'signature'>,
    ed25519PrivateKeyHex: string
  ): string {
    if (!ed25519PrivateKeyHex) {
      throw new Error(
        'Cần khóa bí mật Ed25519 (scripts/.license_ed25519_private.hex) để cấp license key.'
      );
    }
    const privateKey = crypto.createPrivateKey({
      key: Buffer.from(ed25519PrivateKeyHex.trim(), 'hex'),
      format: 'der',
      type: 'pkcs8'
    });
    const dataToSign = this.canonicalSignString(payload);
    const sig = crypto.sign(null, Buffer.from(dataToSign, 'utf-8'), privateKey);

    const fullPayload: LicensePayload = {
      ...payload,
      alg: 'ED25519',
      signature: sig.toString('hex').toUpperCase()
    };
    return Buffer.from(JSON.stringify(fullPayload), 'utf-8').toString('base64');
  }

  /** Xác thực chữ ký Ed25519 bằng khóa công khai nhúng trong app */
  private static verifyEd25519Signature(payload: LicensePayload): boolean {
    const pubHex = LicenseManager._testPublicKeyHex || LICENSE_ED25519_PUBLIC_KEY_HEX;
    let publicKey: crypto.KeyObject;
    try {
      publicKey = crypto.createPublicKey({
        key: Buffer.from(pubHex, 'hex'),
        format: 'der',
        type: 'spki'
      });
    } catch {
      return false;
    }
    const dataToSign = this.canonicalSignString({
      machineId: payload.machineId,
      customerName: payload.customerName || '',
      tier: payload.tier,
      expiryDate: payload.expiryDate,
      issuedAt: payload.issuedAt || ''
    });
    try {
      const sigBuf = Buffer.from(payload.signature || '', 'hex');
      return crypto.verify(null, Buffer.from(dataToSign, 'utf-8'), publicKey, sigBuf);
    } catch {
      return false;
    }
  }

  /** Xác thực chữ ký HMAC của key ĐỊNH DẠNG CŨ (chỉ đọc, không cấp mới) */
  private static verifyLegacyHmacSignature(payload: LicensePayload): { ok: boolean; error?: string } {
    if (payload.issuedAt && new Date(payload.issuedAt).getTime() >= new Date(LEGACY_HMAC_ACCEPT_BEFORE_ISO).getTime()) {
      return {
        ok: false,
        error: 'Đây là mã định dạng cũ đã ngừng cấp. Vui lòng liên hệ nhà cung cấp để nhận mã kích hoạt mới.'
      };
    }
    const dataToSign = this.canonicalSignString({
      machineId: payload.machineId,
      customerName: payload.customerName || '',
      tier: payload.tier,
      expiryDate: payload.expiryDate,
      issuedAt: payload.issuedAt || ''
    });
    const expectedSig = crypto.createHmac('sha256', LEGACY_HMAC_SECRET).update(dataToSign).digest('hex').toUpperCase();
    const ok = this.safeEqualStr((payload.signature || '').toUpperCase(), expectedSig);
    return ok ? { ok: true } : { ok: false, error: 'Chữ ký bản quyền không hợp lệ hoặc mã đã bị chỉnh sửa.' };
  }

  /** Machine ID hiện tại khớp payload? (chấp nhận cả định danh legacy ổn định hơn) */
  private static isMachineMatch(payloadMachineId: string): boolean {
    const candidates = [
      MachineIdProvider.getMachineId(),
      MachineIdProvider.getLegacyMachineId(),
      ...MachineIdProvider.getLegacyMachineIdCandidates()
    ].map(c => c.toUpperCase());

    const target = payloadMachineId.toUpperCase();
    return candidates.some(c => this.safeEqualStr(target, c));
  }

  /** Kiểm tra chữ ký + hạn sử dụng (KHÔNG kiểm tra máy) */
  private static verifySignatureAndExpiry(payload: LicensePayload): { success: boolean; payload?: LicensePayload; error?: string; errorCode?: 'MACHINE_MISMATCH' } {
    if (!payload.machineId || !payload.signature || !payload.tier || !payload.expiryDate) {
      return { success: false, error: 'Mã kích hoạt không đúng định dạng bản quyền.' };
    }

    // 1. Kiểm tra chữ ký số
    const sigResult =
      payload.alg === 'ED25519'
        ? this.verifyEd25519Signature(payload)
          ? { ok: true as const }
          : { ok: false as const, error: 'Chữ ký bản quyền không hợp lệ hoặc mã đã bị chỉnh sửa.' }
        : this.verifyLegacyHmacSignature(payload);

    if (!sigResult.ok) {
      return { success: false, error: sigResult.error };
    }

    // 2. Kiểm tra hạn sử dụng
    if (payload.tier !== 'LIFETIME') {
      const expDate = new Date(`${payload.expiryDate}T23:59:59`);
      if (isNaN(expDate.getTime()) || expDate.getTime() < Date.now()) {
        return { success: false, error: `Bản quyền đã hết hạn vào ngày ${payload.expiryDate}.` };
      }
    }

    return { success: true, payload };
  }

  /**
   * Xác thực và phân tích chuỗi License Key từ người dùng.
   * Hỗ trợ: (1) key Ed25519 mới, (2) key HMAC cũ trong thời hạn chuyển tiếp,
   * và khớp máy theo cả Machine ID chuẩn lẫn các biến thể Legacy ổn định.
   */
  public static verifyLicenseKey(keyStr: string): { success: boolean; payload?: LicensePayload; error?: string; errorCode?: 'MACHINE_MISMATCH' } {
    try {
      const cleanKey = keyStr.trim().replace(/\s+/g, '');
      const jsonStr = Buffer.from(cleanKey, 'base64').toString('utf-8');
      const payload: LicensePayload = JSON.parse(jsonStr);

      const sigExp = this.verifySignatureAndExpiry(payload);
      if (!sigExp.success) {
        return sigExp;
      }

      // 3. Kiểm tra khóa phần cứng (Machine ID mới + toàn bộ biến thể Legacy)
      if (!this.isMachineMatch(payload.machineId)) {
        return {
          success: false,
          errorCode: 'MACHINE_MISMATCH',
          error: `Mã bản quyền này được cấp cho máy [${payload.machineId}], không khớp với máy hiện tại [${MachineIdProvider.getMachineId()}].`
        };
      }

      return { success: true, payload };
    } catch {
      return { success: false, error: 'Mã kích hoạt không hợp lệ. Vui lòng kiểm tra lại.' };
    }
  }

  // ─── MÃ HÓA FILE LOCAL (V2: IV ngẫu nhiên, đọc được file V1 cũ) ─────────

  private static encryptLocalLicense(jsonStr: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      'aes-256-cbc',
      crypto.createHash('sha256').update(LEGACY_HMAC_SECRET).digest(),
      iv
    );
    let encrypted = cipher.update(jsonStr, 'utf-8', 'hex');
    encrypted += cipher.final('hex');
    return `V2:${iv.toString('hex')}:${encrypted}`;
  }

  /** Trả về JSON giải mã, hoặc null nếu không giải mã được */
  private static decryptLocalLicense(rawContent: string): { key: string; activatedAt?: string; activatedMachineId?: string } | null {
    // Định dạng V2: V2:<iv>:<cipher>
    if (rawContent.startsWith('V2:')) {
      try {
        const [, ivHex, cipherHex] = rawContent.split(':');
        const decipher = crypto.createDecipheriv(
          'aes-256-cbc',
          crypto.createHash('sha256').update(LEGACY_HMAC_SECRET).digest(),
          Buffer.from(ivHex, 'hex')
        );
        let decrypted = decipher.update(cipherHex, 'hex', 'utf-8');
        decrypted += decipher.final('utf-8');
        return JSON.parse(decrypted);
      } catch {
        return null;
      }
    }

    // Định dạng V1 cũ: IV = 0 tĩnh
    try {
      const decipher = crypto.createDecipheriv(
        'aes-256-cbc',
        crypto.createHash('sha256').update(LEGACY_HMAC_SECRET).digest(),
        Buffer.alloc(16, 0)
      );
      let decrypted = decipher.update(rawContent, 'hex', 'utf-8');
      decrypted += decipher.final('utf-8');
      return JSON.parse(decrypted);
    } catch {
      return null;
    }
  }

  /**
   * Kích hoạt và lưu trữ bản quyền vào máy
   */
  public static activateLicense(keyStr: string): { success: boolean; error?: string } {
    const verification = this.verifyLicenseKey(keyStr);
    if (!verification.success || !verification.payload) {
      return { success: false, error: verification.error };
    }

    try {
      const filePath = this.getLicenseFilePath();
      const licenseData = {
        key: keyStr.trim(),
        activatedAt: new Date().toISOString(),
        // Ghi lại Machine ID khớp lúc kích hoạt: nếu sau này phần cứng đổi
        // (cắm dock mạng, đổi hostname...), trạng thái kích hoạt vẫn được giữ
        activatedMachineId: verification.payload.machineId.toUpperCase(),
        payload: verification.payload
      };

      fs.writeFileSync(filePath, this.encryptLocalLicense(JSON.stringify(licenseData)), 'utf-8');
      return { success: true };
    } catch (err: any) {
      return { success: false, error: `Không thể lưu thông tin bản quyền: ${err.message}` };
    }
  }

  /**
   * Lấy trạng thái bản quyền hiện tại của phần mềm
   */
  public static getLicenseStatus(): LicenseInfo {
    const machineId = MachineIdProvider.getMachineId();
    const filePath = this.getLicenseFilePath();

    // 1. Chưa có file License Key -> Kiểm tra trạng thái Dùng Thử 7 Ngày
    if (!fs.existsSync(filePath)) {
      const trialStart = this.getTrialStartDate();
      const now = new Date();
      const diffMs = now.getTime() - trialStart.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const daysRemaining = Math.max(0, 7 - diffDays);
      const isTrialExpired = daysRemaining <= 0;

      return {
        isActivated: !isTrialExpired, // Trong 7 ngày trial ĐƯỢC PHÉP DÙNG ĐẦY ĐỦ TÍNH NĂNG
        tier: 'TRIAL',
        isTrial: true,
        tierLabel: isTrialExpired ? 'Hết hạn dùng thử' : `Dùng thử (${daysRemaining} ngày)`,
        machineId,
        isExpired: isTrialExpired,
        daysRemaining
      };
    }

    try {
      const rawContent = fs.readFileSync(filePath, 'utf-8').trim();
      let keyToVerify = '';
      let activatedAt: string | undefined = undefined;
      let activatedMachineId: string | undefined = undefined;

      const localData = this.decryptLocalLicense(rawContent);
      if (localData?.key) {
        keyToVerify = localData.key;
        activatedAt = localData.activatedAt ? localData.activatedAt.split('T')[0] : undefined;
        activatedMachineId = localData.activatedMachineId;
      } else {
        // Fallback: nếu file lưu trực tiếp chuỗi Base64 License Key (từ server keygen hoặc script ngoài)
        keyToVerify = rawContent;
      }

      let verification = this.verifyLicenseKey(keyToVerify);

      // Sticky activation: nếu phần cứng ĐỔI SAU KHI kích hoạt thành công
      // (signature & hạn vẫn hợp lệ, máy hiện tại khác máy lúc kích hoạt),
      // vẫn giữ nguyên hiệu lực dựa trên hồ sơ kích hoạt đã mã hóa trên chính máy này.
      if (!verification.success && verification.errorCode === 'MACHINE_MISMATCH' && activatedMachineId) {
        const reParsed = this.verifySignatureAndExpiry(this.parseKeyPayload(keyToVerify));
        if (
          reParsed.success &&
          reParsed.payload &&
          this.safeEqualStr(reParsed.payload.machineId.toUpperCase(), activatedMachineId)
        ) {
          verification = { ...reParsed, payload: reParsed.payload };
        }
      }

      if (!verification.success || !verification.payload) {
        return {
          isActivated: false,
          tier: 'TRIAL',
          isTrial: false,
          tierLabel: 'Bản quyền không hợp lệ',
          machineId,
          isExpired: true
        };
      }

      // Tự động chuẩn hóa file sang định dạng mã hóa chuẩn nếu đang là plain Base64
      if (!localData) {
        try {
          this.activateLicense(rawContent);
        } catch {}
      }

      const p = verification.payload;
      let isExpired = false;
      let daysRemaining: number | undefined;

      if (p.tier !== 'LIFETIME') {
        const expDate = new Date(`${p.expiryDate}T23:59:59`);
        const now = new Date();
        const diffMs = expDate.getTime() - now.getTime();
        daysRemaining = Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
        isExpired = diffMs <= 0;
      }

      const tierLabels: Record<LicenseTier, string> = {
        TRIAL: 'Dùng Thử',
        PERSONAL_1Y: 'Gói Cá Nhân (1 Năm)',
        PRO_1Y: 'Gói Dịch Vụ / Đại Lý (1 Năm)',
        LIFETIME: 'Gói Vĩnh Viễn (Lifetime VIP)'
      };

      return {
        isActivated: !isExpired,
        tier: p.tier,
        isTrial: false,
        tierLabel: tierLabels[p.tier] || p.tier,
        machineId,
        customerName: p.customerName,
        expiryDate: p.tier === 'LIFETIME' ? 'Vĩnh viễn' : p.expiryDate,
        daysRemaining,
        isExpired,
        activationDate: activatedAt || (p.issuedAt ? p.issuedAt.split('T')[0] : undefined)
      };
    } catch {
      return {
        isActivated: false,
        tier: 'TRIAL',
        isTrial: false,
        tierLabel: 'Lỗi đọc bản quyền',
        machineId,
        isExpired: false
      };
    }
  }

  /** Parse chuỗi key Base64 thành payload (dùng nội bộ cho sticky activation) */
  private static parseKeyPayload(keyStr: string): LicensePayload {
    const cleanKey = keyStr.trim().replace(/\s+/g, '');
    const jsonStr = Buffer.from(cleanKey, 'base64').toString('utf-8');
    return JSON.parse(jsonStr);
  }
}

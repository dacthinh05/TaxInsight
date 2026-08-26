import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { MachineIdProvider } from '../src/main/licensing/MachineIdProvider';
import { LicenseManager, LicensePayload } from '../src/main/licensing/LicenseManager';

/**
 * Bộ test Licensing sau khi gia cố:
 * - Key mới: Ed25519 (app chỉ nhúng PUBLIC key, không thể tự cấp key)
 * - Key cũ HMAC: chỉ còn được xác thực trong thời hạn chuyển tiếp
 * - So sánh timing-safe, khớp máy theo nhiều biến thể Legacy ID ổn định
 */

// Cặp khóa test dùng riêng cho unit test (khác cặp khóa production)
const TEST_KEY_PAIR = crypto.generateKeyPairSync('ed25519');
const TEST_PRIVATE_HEX = TEST_KEY_PAIR.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('hex');
const TEST_PUBLIC_HEX = TEST_KEY_PAIR.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');

const LEGACY_SECRET = 'TR_2026_MASTER_SECRET_KEY_TAXRECORD_VIETNAM_SECURE_AUTH';

function makeLegacyHmacKey(payload: Omit<LicensePayload, 'signature'>): string {
  const dataToSign = `${payload.machineId.toUpperCase()}|${payload.customerName.trim()}|${payload.tier}|${payload.expiryDate}|${payload.issuedAt}`;
  const signature = crypto.createHmac('sha256', LEGACY_SECRET).update(dataToSign).digest('hex').toUpperCase();
  return Buffer.from(JSON.stringify({ ...payload, signature }), 'utf-8').toString('base64');
}

describe('TaxRecord Licensing (Ed25519) & Machine ID Engine', () => {
  beforeEach(() => {
    LicenseManager._testOverrideEd25519PublicKey(TEST_PUBLIC_HEX);
  });

  afterEach(() => {
    LicenseManager._testOverrideEd25519PublicKey(null);
  });

  it('sinh mã phần cứng Machine ID chuẩn format TR-XXXX-XXXX-XXXX-XXXX', () => {
    const machineId = MachineIdProvider.getMachineId();
    expect(machineId).toMatch(/^TR-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);
  });

  it('Legacy candidates là mảng các ID hợp lệ và chứa biến thể đầy đủ', () => {
    const candidates = MachineIdProvider.getLegacyMachineIdCandidates();
    expect(Array.isArray(candidates)).toBe(true);
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c).toMatch(/^TR-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}-[A-F0-9]{4}$/);
    }
    expect(candidates).toContain(MachineIdProvider.getLegacyMachineId());
  });

  it('KHÔNG thể cấp key nếu thiếu khóa bí mật Ed25519 (app không chứa private key)', () => {
    const payload = {
      machineId: MachineIdProvider.getMachineId(),
      customerName: 'Ai đó',
      tier: 'LIFETIME' as const,
      expiryDate: '2099-12-31',
      issuedAt: new Date().toISOString()
    };
    expect(() => (LicenseManager as any).generateLicenseKey(payload)).toThrow();
  });

  it('sinh và xác thực License Key Ed25519 LIFETIME thành công cho máy hiện tại', () => {
    const currentMachineId = MachineIdProvider.getMachineId();
    const payload = {
      machineId: currentMachineId,
      customerName: 'Kế toán Minh Anh',
      tier: 'LIFETIME' as const,
      expiryDate: '2099-12-31',
      issuedAt: new Date().toISOString()
    };

    const key = LicenseManager.generateLicenseKey(payload, TEST_PRIVATE_HEX);
    expect(key).toBeTruthy();

    const verification = LicenseManager.verifyLicenseKey(key);
    expect(verification.success).toBe(true);
    expect(verification.payload?.customerName).toBe('Kế toán Minh Anh');
    expect(verification.payload?.tier).toBe('LIFETIME');
    expect(verification.payload?.alg).toBe('ED25519');
  });

  it('sinh và xác thực License Key PERSONAL_1Y có ngày hết hạn trong tương lai', () => {
    const currentMachineId = MachineIdProvider.getMachineId();
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);

    const payload = {
      machineId: currentMachineId,
      customerName: 'Công ty TNHH Thương Mại Dịch Vụ ABC',
      tier: 'PERSONAL_1Y' as const,
      expiryDate: nextYear.toISOString().split('T')[0],
      issuedAt: new Date().toISOString()
    };

    const key = LicenseManager.generateLicenseKey(payload, TEST_PRIVATE_HEX);
    const verification = LicenseManager.verifyLicenseKey(key);
    expect(verification.success).toBe(true);
    expect(verification.payload?.tier).toBe('PERSONAL_1Y');
  });

  it('từ chối key Ed25519 ký bằng cặp khóa KHÁC (public key nhúng không khớp)', () => {
    const otherPair = crypto.generateKeyPairSync('ed25519');
    const currentMachineId = MachineIdProvider.getMachineId();
    const payload = {
      machineId: currentMachineId,
      customerName: 'Kẻ giả mạo',
      tier: 'LIFETIME' as const,
      expiryDate: '2099-12-31',
      issuedAt: new Date().toISOString()
    };

    // Ký bằng khóa khác rồi thay signature thủ công bằng đúng thuật toán
    const dataToSign = `${payload.machineId.toUpperCase()}|${payload.customerName}|${payload.tier}|${payload.expiryDate}|${payload.issuedAt}`;
    const sig = crypto.sign(null, Buffer.from(dataToSign, 'utf-8'), otherPair.privateKey);
    const fullPayload = { ...payload, alg: 'ED25519', signature: sig.toString('hex').toUpperCase() };
    const forgedKey = Buffer.from(JSON.stringify(fullPayload), 'utf-8').toString('base64');

    const verification = LicenseManager.verifyLicenseKey(forgedKey);
    expect(verification.success).toBe(false);
    expect(verification.error).toContain('Chữ ký bản quyền không hợp lệ');
  });

  it('từ chối License Key nếu cấp cho Machine ID khác', () => {
    const payload = {
      machineId: 'TR-1111-2222-3333-4444',
      customerName: 'Khách hàng khác',
      tier: 'LIFETIME' as const,
      expiryDate: '2099-12-31',
      issuedAt: new Date().toISOString()
    };

    const key = LicenseManager.generateLicenseKey(payload, TEST_PRIVATE_HEX);
    const verification = LicenseManager.verifyLicenseKey(key);
    expect(verification.success).toBe(false);
    expect(verification.errorCode).toBe('MACHINE_MISMATCH');
    expect(verification.error).toContain('không khớp với máy hiện tại');
  });

  it('từ chối License Key nếu bị giả mạo chữ ký ngẫu nhiên', () => {
    const currentMachineId = MachineIdProvider.getMachineId();
    const payload: LicensePayload = {
      machineId: currentMachineId,
      customerName: 'Hacker',
      tier: 'LIFETIME',
      expiryDate: '2099-12-31',
      issuedAt: new Date(Date.UTC(2025, 0, 1)).toISOString(), // trước cutoff để đi vào nhánh HMAC legacy
      alg: undefined,
      signature: 'FAKE_SIGNATURE_FORGED_HEX_12345678'
    };

    const forgedKey = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');
    const verification = LicenseManager.verifyLicenseKey(forgedKey);
    expect(verification.success).toBe(false);
    expect(verification.error).toContain('Chữ ký bản quyền không hợp lệ');
  });

  it('từ chối License Key nếu đã quá hạn sử dụng', () => {
    const currentMachineId = MachineIdProvider.getMachineId();
    const payload = {
      machineId: currentMachineId,
      customerName: 'Khách hết hạn',
      tier: 'PERSONAL_1Y' as const,
      expiryDate: '2020-01-01',
      issuedAt: new Date().toISOString()
    };

    const key = LicenseManager.generateLicenseKey(payload, TEST_PRIVATE_HEX);
    const verification = LicenseManager.verifyLicenseKey(key);
    expect(verification.success).toBe(false);
    expect(verification.error).toContain('hết hạn');
  });

  it('KEY HMAC ĐỊNH DẠNG CŨ vẫn được chấp nhận trong thời hạn chuyển tiếp', () => {
    const currentMachineId = MachineIdProvider.getMachineId();
    const key = makeLegacyHmacKey({
      machineId: currentMachineId,
      customerName: 'Khách hàng cũ',
      tier: 'PRO_1Y',
      expiryDate: '2099-12-31',
      issuedAt: '2026-08-01T00:00:00.000Z' // trước cutoff 2027-07-01
    });
    const verification = LicenseManager.verifyLicenseKey(key);
    expect(verification.success).toBe(true);
    expect(verification.payload?.customerName).toBe('Khách hàng cũ');
  });

  it('KEY HMAC cấp SAU thời hạn chuyển tiếp bị từ chối (buộc chuyển sang Ed25519)', () => {
    const currentMachineId = MachineIdProvider.getMachineId();
    const key = makeLegacyHmacKey({
      machineId: currentMachineId,
      customerName: 'Khách hàng tương lai',
      tier: 'LIFETIME',
      expiryDate: '2099-12-31',
      issuedAt: '2027-08-01T00:00:00.000Z' // sau cutoff
    });
    const verification = LicenseManager.verifyLicenseKey(key);
    expect(verification.success).toBe(false);
    expect(verification.error).toContain('định dạng cũ đã ngừng cấp');
  });
});

describe('License hardening — chống forge & chống copy hồ sơ sang máy khác', () => {
  const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'taxrecord-lic-test-'));

  beforeEach(() => {
    LicenseManager._testOverrideEd25519PublicKey(TEST_PUBLIC_HEX);
    LicenseManager._testOverrideBaseDir(tmpBase);
    LicenseManager._testRemoveLicenseAndTrialFiles();
  });

  afterEach(() => {
    LicenseManager._testRemoveLicenseAndTrialFiles();
    LicenseManager._testOverrideBaseDir(null);
    LicenseManager._testOverrideEd25519PublicKey(null);
  });

  it('KEY HMAC KHÔNG CÓ issuedAt bị từ chối tuyệt đối (không còn bỏ qua cutoff)', () => {
    const currentMachineId = MachineIdProvider.getMachineId();
    const payload: any = {
      machineId: currentMachineId,
      customerName: 'Kẻ cố tình bỏ issuedAt',
      tier: 'LIFETIME',
      expiryDate: '2099-12-31',
      issuedAt: ''
    };
    // Ký đúng thuật toán legacy nhưng cố tình để issuedAt rỗng
    const dataToSign = `${payload.machineId.toUpperCase()}|${payload.customerName}|${payload.tier}|${payload.expiryDate}|`;
    const signature = crypto.createHmac('sha256', LEGACY_SECRET).update(dataToSign).digest('hex').toUpperCase();
    const forgedKey = Buffer.from(JSON.stringify({ ...payload, signature }), 'utf-8').toString('base64');

    const verification = LicenseManager.verifyLicenseKey(forgedKey);
    expect(verification.success).toBe(false);
    expect(verification.error).toContain('thiếu ngày cấp');
  });

  it('KEY HMAC issuedAt không parse được (garbage) bị từ chối', () => {
    const currentMachineId = MachineIdProvider.getMachineId();
    const payload: any = {
      machineId: currentMachineId,
      customerName: 'Issued At Rác',
      tier: 'LIFETIME',
      expiryDate: '2099-12-31',
      issuedAt: 'not-a-date'
    };
    const dataToSign = `${payload.machineId.toUpperCase()}|${payload.customerName}|${payload.tier}|${payload.expiryDate}|not-a-date`;
    const signature = crypto.createHmac('sha256', LEGACY_SECRET).update(dataToSign).digest('hex').toUpperCase();
    const forgedKey = Buffer.from(JSON.stringify({ ...payload, signature }), 'utf-8').toString('base64');

    const verification = LicenseManager.verifyLicenseKey(forgedKey);
    expect(verification.success).toBe(false);
    expect(verification.error).toContain('không hợp lệ');
  });

  it('STICKY: máy hiện tại = máy đã kích hoạt → giữ hiệu lực dù payload.machineId khác (đổi phần cứng)', () => {
    const currentMachineId = MachineIdProvider.getMachineId();
    // Key cấp cho machineId KHÁC máy hiện tại (giả lập payload cũ sau khi phần cứng đổi)
    const key = LicenseManager.generateLicenseKey(
      {
        machineId: 'TR-AAAA-BBBB-CCCC-DDDD',
        customerName: 'Khách đổi phần cứng',
        tier: 'LIFETIME',
        expiryDate: '2099-12-31',
        issuedAt: new Date().toISOString()
      },
      TEST_PRIVATE_HEX
    );
    // Hồ sơ kích hoạt ghi Machine ID của máy này lúc activate
    LicenseManager._testSeedLicenseFile(key, currentMachineId);

    const status = LicenseManager.getLicenseStatus();
    expect(status.isActivated).toBe(true);
    expect(status.tier).toBe('LIFETIME');
    expect(status.customerName).toBe('Khách đổi phần cứng');
  });

  it('CHỐNG COPY: hồ sơ kích hoạt của máy KHÁC copy sang máy này → mất hiệu lực', () => {
    // Key hợp lệ cho máy "gốc", hồ sơ kích hoạt cũng ghi máy "gốc"
    const key = LicenseManager.generateLicenseKey(
      {
        machineId: 'TR-AAAA-BBBB-CCCC-DDDD',
        customerName: 'Khách copy file sang máy lạ',
        tier: 'LIFETIME',
        expiryDate: '2099-12-31',
        issuedAt: new Date().toISOString()
      },
      TEST_PRIVATE_HEX
    );
    LicenseManager._testSeedLicenseFile(key, 'TR-FFFF-EEEE-DDDD-CCCC'); // ≠ máy hiện tại

    const status = LicenseManager.getLicenseStatus();
    expect(status.isActivated).toBe(false);
    expect(status.tierLabel).toBe('Bản quyền không hợp lệ');
  });

  it('TRIAL: file trial ghi dạng V2 có HMAC, tự khôi phục khi 1 file bị xóa', () => {
    // Lần gọi đầu: khởi tạo trial + ghi 2 file
    const first = LicenseManager.getLicenseStatus();
    expect(first.isTrial).toBe(true);

    const { primary, shadow } = LicenseManager._testGetTrialFilePaths();
    expect(fs.existsSync(primary)).toBe(true);
    expect(fs.existsSync(shadow)).toBe(true);
    expect(fs.readFileSync(primary, 'utf-8')).toMatch(/^V2:[0-9A-F]{64}:/);
    expect(fs.readFileSync(shadow, 'utf-8')).toMatch(/^V2:[0-9A-F]{64}:/);

    // Xóa file chính → shadow còn → trial KHÔNG reset
    fs.rmSync(primary, { force: true });
    const second = LicenseManager.getLicenseStatus();
    expect(second.isTrial).toBe(true);
    expect(fs.existsSync(primary)).toBe(true); // được khôi phục từ shadow
    expect(fs.readFileSync(primary, 'utf-8')).toBe(fs.readFileSync(shadow, 'utf-8'));
  });

  it('TRIAL: sửa date trong file (HMAC lệch) → bỏ qua bản giả mạo, dùng bản còn nguyên', () => {
    LicenseManager.getLicenseStatus(); // khởi tạo
    const { primary, shadow } = LicenseManager._testGetTrialFilePaths();

    // Giả mạo file chính: date lùi xa 100 ngày nhưng HMAC không khớp
    const fakeDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(primary, `V2:${'0'.repeat(64)}:${fakeDate}`, 'utf-8');

    const status = LicenseManager.getLicenseStatus();
    expect(status.isTrial).toBe(true);
    expect(status.daysRemaining).toBe(7); // không bị lợi 100 ngày
    // File giả mạo được ghi đè lại bằng bản chuẩn từ shadow
    expect(fs.readFileSync(primary, 'utf-8')).toBe(fs.readFileSync(shadow, 'utf-8'));
  });
});

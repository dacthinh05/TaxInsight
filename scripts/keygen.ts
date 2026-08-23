import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

type LicenseTier = 'PERSONAL_1Y' | 'PRO_1Y' | 'LIFETIME';

interface LicensePayload {
  machineId: string;
  customerName: string;
  tier: LicenseTier;
  expiryDate: string;
  issuedAt: string;
  alg?: 'ED25519';
  signature?: string;
}

// Khóa bí mật Ed25519 — KHÔNG nằm trong mã nguồn ứng dụng.
// Tạo cặp khóa mới: node scripts/generate-key.js genkey
const PRIVATE_KEY_FILE = path.join(__dirname, '.license_ed25519_private.hex');

function canonicalSignString(p: Omit<LicensePayload, 'signature'>): string {
  return `${p.machineId.toUpperCase()}|${p.customerName.trim()}|${p.tier}|${p.expiryDate}|${p.issuedAt}`;
}

function generateLicenseKey(payload: Omit<LicensePayload, 'signature'>): string {
  if (!fs.existsSync(PRIVATE_KEY_FILE)) {
    console.error(`\n[KEYGEN] Chưa có khóa bí mật Ed25519 tại: ${PRIVATE_KEY_FILE}`);
    console.error('[KEYGEN] Chạy trước tiên: node scripts/generate-key.js genkey\n');
    process.exit(1);
  }
  const privHex = fs.readFileSync(PRIVATE_KEY_FILE, 'utf-8').trim();
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(privHex, 'hex'),
    format: 'der',
    type: 'pkcs8'
  });

  const dataToSign = Buffer.from(canonicalSignString(payload), 'utf-8');
  const signature = crypto.sign(null, dataToSign, privateKey);

  const fullPayload: LicensePayload = {
    ...payload,
    alg: 'ED25519',
    signature: signature.toString('hex').toUpperCase()
  };
  return Buffer.from(JSON.stringify(fullPayload), 'utf-8').toString('base64');
}

// ── CLI PARSER ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let machineId = '';
let customerName = 'Khách Hàng TaxRecord';
let tier: LicenseTier = 'PERSONAL_1Y';
let expiryDate = '';

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg.startsWith('--machine=')) {
    machineId = arg.replace('--machine=', '').trim();
  } else if (arg === '--machine' && args[i + 1]) {
    machineId = args[++i].trim();
  } else if (arg.startsWith('--name=')) {
    customerName = arg.replace('--name=', '').trim();
  } else if (arg === '--name' && args[i + 1]) {
    customerName = args[++i].trim();
  } else if (arg.startsWith('--tier=')) {
    tier = arg.replace('--tier=', '').trim() as LicenseTier;
  } else if (arg === '--tier' && args[i + 1]) {
    tier = args[++i].trim() as LicenseTier;
  } else if (arg.startsWith('--expiry=')) {
    expiryDate = arg.replace('--expiry=', '').trim();
  }
}

if (!machineId) {
  console.log(`
 =============================================================================
             CÔNG CỤ TẠO MÃ BẢN QUYỀN TAXRECORD (KEYGEN - ED25519)
 =============================================================================
 Cách sử dụng:
   npx tsx scripts/keygen.ts --machine <MACHINE_ID> [--tier <TIER>] [--name <NAME>]

 Lưu ý: Cần file khóa bí mật scripts/.license_ed25519_private.hex
        (tạo bằng: node scripts/generate-key.js genkey)

 Các Gói (Tier):
   1. PERSONAL_1Y   : Gói Cá Nhân (1 Năm - 490.000 đ) [Mặc định]
   2. PRO_1Y        : Gói Dịch Vụ / Đại Lý 2 Máy (1 Năm - 890.000 đ)
   3. LIFETIME      : Gói Vĩnh Viễn Trọn Đời (1.290.000 đ)

 Ví dụ tạo key:
   npx tsx scripts/keygen.ts --machine TR-A1B2-C3D4-E5F6-7890 --tier LIFETIME --name "Ketoan Kim Thu"
 =============================================================================
   `);
  process.exit(1);
}

// Tính ngày hết hạn
if (!expiryDate) {
  if (tier === 'LIFETIME') {
    expiryDate = '2099-12-31';
  } else {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    expiryDate = d.toISOString().split('T')[0];
  }
}

const issuedAt = new Date().toISOString();
const licenseKey = generateLicenseKey({
  machineId: machineId.toUpperCase(),
  customerName,
  tier,
  expiryDate,
  issuedAt
});

const tierNames: Record<LicenseTier, string> = {
  PERSONAL_1Y: 'Gói Cá Nhân (1 Năm - 490.000 đ)',
  PRO_1Y: 'Gói Dịch Vụ / Đại Lý 2 Máy (1 Năm - 890.000 đ)',
  LIFETIME: 'Gói Vĩnh Viễn Trọn Đời (1.290.000 đ)'
};

console.log(`
 =============================================================================
                   THÔNG TIN BẢN QUYỀN TAXRECORD ĐÃ TẠO
 =============================================================================
 Khách hàng    : ${customerName}
 Mã máy tính   : ${machineId.toUpperCase()}
 Gói kích hoạt : ${tierNames[tier]}
 Hạn sử dụng   : ${tier === 'LIFETIME' ? 'Vĩnh viễn (Trọn đời)' : expiryDate}
 Ngày cấp      : ${issuedAt.split('T')[0]}

 --------------------------- MÃ KÍCH HOẠT (LICENSE KEY) ----------------------
 ${licenseKey}
 -----------------------------------------------------------------------------
 Hướng dẫn khách: Mở TaxRecord -> Bấm [Bản quyền] trên góc phải -> Dán mã trên.
 =============================================================================
 `);

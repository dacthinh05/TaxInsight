#!/usr/bin/env node
/**
 * TAXINSIGHT LICENSE KEYGEN (Ed25519)
 *
 * Khóa bí mật KHÔNG nằm trong mã nguồn ứng dụng — chỉ tồn tại trong
 * scripts/.license_ed25519_private.hex (đã .gitignore). App chỉ nhúng
 * khóa CÔNG KHAI để xác thực.
 *
 * Lệnh:
 *   node scripts/generate-key.js genkey
 *       -> Tạo cặp khóa mới: lưu private vào scripts/.license_ed25519_private.hex,
 *          in public hex để dán vào src/main/licensing/LicenseManager.ts
 *          (LICENSE_ED25519_PUBLIC_KEY_HEX)
 *
 *   node scripts/generate-key.js <MA_MAY> [TEN_KHACH] [GOI]
 *   node scripts/generate-key.js --machine TR-XXXX-... --name "..." --tier LIFETIME [--expiry YYYY-MM-DD]
 *       -> Cấp license key Ed25519 cho khách hàng
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PRIVATE_KEY_FILE = path.join(__dirname, '.license_ed25519_private.hex');

function loadPrivateKey() {
  if (!fs.existsSync(PRIVATE_KEY_FILE)) {
    console.error(`
========================================================================
CHUA CO KHOA BI MAT ED25519!
File khong ton tai: ${PRIVATE_KEY_FILE}
Chay tru tien: node scripts/generate-key.js genkey
========================================================================`);
    process.exit(1);
  }
  const privHex = fs.readFileSync(PRIVATE_KEY_FILE, 'utf-8').trim();
  return crypto.createPrivateKey({ key: Buffer.from(privHex, 'hex'), format: 'der', type: 'pkcs8' });
}

function canonicalSignString(p) {
  return `${p.machineId.toUpperCase()}|${p.customerName.trim()}|${p.tier}|${p.expiryDate}|${p.issuedAt}`;
}

function cmdGenKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync(PRIVATE_KEY_FILE, privateKey.export({ type: 'pkcs8', format: 'der' }).toString('hex') + '\n', 'utf-8');
  const pubHex = publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
  console.log(`
========================================================================
DA TAO CAP KHOA ED25519 MO!
========================================================================
- Private key da LUU TAI : ${PRIVATE_KEY_FILE}
  (KHONG commit file nay len git - da duoc .gitignore)

- Public key hex (SPKI):
  ${pubHex}

Viec can lam: mo src/main/licensing/LicenseManager.ts va cap nhat hang
  LICENSE_ED25519_PUBLIC_KEY_HEX = '${pubHex}';
sau do build lai ung dung. Key cu (HMAC/Ed25519 cu) van hoat dong neu
giu nguyen public key cu trong app.
========================================================================
`);
}

function issueLicense(machineId, customerName, tierArg, expiryArg) {
  const privateKey = loadPrivateKey();
  const tier = (tierArg || 'LIFETIME').toUpperCase();
  const validTiers = ['PERSONAL_1Y', 'PRO_1Y', 'LIFETIME'];
  if (!validTiers.includes(tier)) {
    console.error(`Goi ban quyen khong hop le: ${tier} (cho phep: ${validTiers.join(', ')})`);
    process.exit(1);
  }

  let expiryDate = expiryArg || '';
  if (!expiryDate) {
    if (tier === 'LIFETIME') {
      expiryDate = '2099-12-31';
    } else {
      const d = new Date();
      d.setFullYear(d.getFullYear() + 1);
      expiryDate = d.toISOString().split('T')[0];
    }
  }

  const payload = {
    machineId: machineId.trim().toUpperCase(),
    customerName: customerName.trim(),
    tier,
    expiryDate,
    issuedAt: new Date().toISOString()
  };

  const dataToSign = Buffer.from(canonicalSignString(payload), 'utf-8');
  const signature = crypto.sign(null, dataToSign, privateKey);

  const fullPayload = { ...payload, alg: 'ED25519', signature: signature.toString('hex').toUpperCase() };
  const licenseKey = Buffer.from(JSON.stringify(fullPayload), 'utf-8').toString('base64');

  console.log(`
========================================================================
TAO LICENSE KEY THANH CONG (Ed25519)!
========================================================================
- Ma may (Machine ID)  : ${payload.machineId}
- Khach hang           : ${payload.customerName}
- Goi ban quyen        : ${payload.tier}
- Han su dung          : ${payload.expiryDate}
- Ngay phat hanh       : ${payload.issuedAt}
------------------------------------------------------------------------
MA KICH HOAT (COPY GUI CHO KHACH HANG):

${licenseKey}

========================================================================
`);
}

// ─── CLI ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const VALID_TIERS = ['PERSONAL_1Y', 'PRO_1Y', 'LIFETIME'];

if (args[0] === 'genkey') {
  cmdGenKey();
  process.exit(0);
}

let machineId = '';
let customerName = 'Khach hang TaxInsight';
let tier = 'LIFETIME';
let expiry = '';

// 1. Parse các flag --key=value / --key value
const positionals = [];
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  const eqIdx = arg.indexOf('=');
  if (arg.startsWith('--machine')) {
    machineId = eqIdx >= 0 ? arg.slice(eqIdx + 1).trim() : (args[++i] || '').trim();
  } else if (arg.startsWith('--name')) {
    customerName = eqIdx >= 0 ? arg.slice(eqIdx + 1).trim() : (args[++i] || '').trim();
  } else if (arg.startsWith('--tier')) {
    tier = (eqIdx >= 0 ? arg.slice(eqIdx + 1) : (args[++i] || '')).trim().toUpperCase();
  } else if (arg.startsWith('--expiry')) {
    expiry = eqIdx >= 0 ? arg.slice(eqIdx + 1).trim() : (args[++i] || '').trim();
  } else if (!arg.startsWith('-')) {
    positionals.push(arg.trim());
  }
}

// 2. Positional theo thứ tự: <MA_MAY> [TEN_KHACH] [GOI]
if (!machineId && positionals.length > 0) machineId = positionals.shift();
const namePos = positionals.find(p => !VALID_TIERS.includes(p.toUpperCase()));
const tierPos = positionals.find(p => VALID_TIERS.includes(p.toUpperCase()));
if (namePos) customerName = namePos;
if (tierPos) tier = tierPos.toUpperCase();

if (!machineId) {
  console.log(`
========================================================================
TAXINSIGHT LICENSE KEY GENERATOR (Ed25519 KEYGEN)
========================================================================
Cach su dung:
  node scripts/generate-key.js genkey
      -> Tao cap khoa moi (lan dau tien)
  node scripts/generate-key.js <MA_MAY> [TEN_KHACH_HANG] [GOI_BAN_QUYEN]
  node scripts/generate-key.js --machine <MA_MAY> --name "..." --tier ... [--expiry YYYY-MM-DD]

Vi du:
  node scripts/generate-key.js TR-8A2F-9D10-4B1C-E377 "Cong ty ABC" LIFETIME
  node scripts/generate-key.js --machine TR-8A2F-9D10-4B1C-E377 --tier PRO_1Y --name "Dai ly Thue XYZ"
========================================================================
`);
  process.exit(0);
}

issueLicense(machineId, customerName, tier, expiry);

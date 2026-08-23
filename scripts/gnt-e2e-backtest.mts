/**
 * E2E BACKTEST: Giấy Nộp Tiền (GNT) - chạy TRỰC TIẾP code của app (không qua UI)
 *
 * Cách chạy:
 *   npx vite-node scripts/gnt-e2e-backtest.mts
 *
 * Luồng: đăng nhập DVC (nhập captcha từ ảnh mở tự động) -> SSO handoff sang eTax
 *        -> tra cứu danh sách GNT -> lấy chi tiết GNT đầu tiên -> báo cáo checkpoint GNT_01..07
 */
import readline from 'readline';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { PortalSession } from '../src/main/portal/PortalSession';
import { TaxPortalClient } from '../src/main/portal/TaxPortalClient';
import { PaymentSlipClient } from '../src/main/portal/PaymentSlipClient';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q: string) => new Promise<string>(res => rl.question(q, res));
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function openFileInViewer(p: string) {
  if (process.platform === 'win32') exec(`cmd /c start "" "${p}"`);
  else exec(`xdg-open "${p}"`);
}

function saveDataUrlPng(dataUrl: string): string {
  const b64 = dataUrl.split(',')[1] || '';
  const p = path.join(os.tmpdir(), `gnt_captcha_${Date.now()}.png`);
  fs.writeFileSync(p, Buffer.from(b64, 'base64'));
  return p;
}

function printCp(cp: string, d: { status: string; detail?: string }) {
  const icon = cp.startsWith('GNT') ? (d.status === 'PASS' ? 'PASS' : d.status === 'FAIL' ? 'FAIL' : ' -- ') : '';
  console.log(`  [${icon}] ${cp}${d.detail ? ` - ${d.detail}` : ''}`);
}

async function main() {
  console.log('=== TAXRECORD GNT E2E BACKTEST ===\n');
  const tenDN = (await ask('Tên đăng nhập DVC (MST/CCCD): ')).trim();
  const matKhau = await ask('Mật khẩu: ');
  if (!tenDN || !matKhau) {
    console.log('Thiếu thông tin đăng nhập. Thoát.');
    rl.close();
    return;
  }

  const session = new PortalSession();
  const portal = new TaxPortalClient(session);

  // ── Bước 1: CAPTCHA ──────────────────────────────────────
  console.log('\n[B1] Lấy ảnh CAPTCHA...');
  const dataUrl = await portal.getCaptchaImage('LOGIN');
  const imgPath = saveDataUrlPng(dataUrl);
  openFileInViewer(imgPath);
  const captcha = (await ask(`>> Đã mở ảnh captcha tại ${imgPath}\n>> Nhập mã captcha: `)).trim();
  if (!captcha) {
    console.log('Không nhập captcha. Thoát.');
    rl.close();
    return;
  }

  // ── Bước 2: Đăng nhập DVC ────────────────────────────────
  console.log('\n[B2] Đăng nhập Cổng Dịch vụ công...');
  await sleep(800);
  const loginRes = await portal.login(tenDN, matKhau, captcha);
  if (!loginRes.success) {
    console.log(`LOGIN FAIL: ${loginRes.message} (errorField=${loginRes.errorField})`);
    console.log('=> Kết luận: chặn ở tầng đăng nhập DVC, chưa tới được nhánh GNT.');
    rl.close();
    return;
  }
  console.log('LOGIN OK');

  // ── Bước 3: SSO handoff + tra cứu GNT ────────────────────
  const gnt = new PaymentSlipClient(session);
  const today = new Date();
  const from = new Date(today.getTime() - 180 * 86400_000);
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  console.log(`\n[B3] Tra cứu GNT từ ${fmt(from)} đến ${fmt(today)} qua eTax (SSO handoff)...`);
  await sleep(1000);
  const q = await gnt.queryPaymentSlips({ startDate: fmt(from), endDate: fmt(today) });

  // ── Bước 4: Báo cáo checkpoint ───────────────────────────
  const diag = gnt.getDiagnosticReport();
  console.log(`\n=== CHECKPOINT REPORT (handoffType=${diag.ssoHandoffType ?? '?'}${diag.lastError ? `, lastError=${diag.lastError}` : ''}) ===`);
  Object.entries(diag.checkpoints).forEach(([k, v]) => printCp(k, v));

  console.log(`\nQuery result: success=${q.success}, records=${q.data.length}${q.error ? `, error="${q.error}" (code=${q.errorCode})` : ''}`);

  if (!q.success) {
    console.log('=> Kết luận: đăng nhập DVC ok nhưng nhánh eTax/GNT lỗi. Xem checkpoint FAIL ở trên để xác định điểm đứt.');
    rl.close();
    return;
  }

  if (q.data.length > 0) {
    const first = q.data[0];
    console.log('\n--- Mẫu bản ghi đầu tiên ---');
    console.log(JSON.stringify({
      id: first.id, soGnt: first.soGnt, soTienFormatted: first.soTienFormatted,
      trangThai: first.trangThai, ngayLapGnt: first.ngayLapGnt, downloadAvailable: first.downloadAvailable
    }, null, 2));

    console.log('\n[B4] Lấy chi tiết GNT đầu tiên (Mẫu C1-02/NS)...');
    await sleep(1000);
    const detail = await gnt.getPaymentSlipDetail(first.id);
    if (detail) {
      console.log('DETAIL OK:');
      console.log(JSON.stringify({
        soGnt: detail.soGnt, nguoiNopThue: detail.nguoiNopThue, maSoThue: detail.maSoThue,
        tongTienVND: detail.tongTienVND, soKhoanNop: detail.items?.length,
        signatures: detail.signatures?.length, rawHtmlBytes: detail.rawHtml?.length
      }, null, 2));
      const out = path.join(process.cwd(), 'scripts', `gnt_detail_sample_${Date.now()}.html`);
      if (detail.rawHtml) {
        fs.writeFileSync(out, detail.rawHtml);
        console.log(`Đã lưu HTML chi tiết mẫu: ${out}`);
      }
    } else {
      console.log('DETAIL FAIL: không parse được chi tiết (xem log phía trên).');
    }
  } else {
    console.log('Không có bản ghi GNT trong khoảng thời gian trên (có thể doanh nghiệp không phát sinh).');
  }

  console.log('\n=== VERDICT ===');
  const cps = diag.checkpoints;
  const reachedEtaxAuth = cps.GNT_05_ETAX_AUTHENTICATED.status === 'PASS';
  const queryReady = cps.GNT_07_GNT_QUERY_READY.status === 'PASS';
  if (queryReady && q.success && q.data.length > 0) {
    console.log('=> CHUỖI GNT HOẠT ĐỘNG ĐẦY ĐỦ — CÓ THỂ CẤU HÌNH VÀO UI');
  } else if (!q.success || !reachedEtaxAuth) {
    console.log(`=> CHUỖI CHƯA HOÀN THÀNH: đứt ở checkpoint đầu tiên có trạng thái khác PASS.`);
    const firstBad = Object.entries(cps).find(([, v]) => v.status !== 'PASS' && v.detail);
    if (firstBad) console.log(`   Điểm đứt: ${firstBad[0]} - ${firstBad[1].detail}`);
    console.log('   Gửi lại toàn bộ output này để được phân tích và sửa tiếp.');
  } else {
    console.log('=> Kết nối eTax OK nhưng không có dữ liệu GNT trong khoảng thời gian đã chọn.');
  }
  rl.close();
}

main().catch(e => {
  console.error('BACKTEST CRASHED:', e.message);
  rl.close();
  process.exit(1);
});

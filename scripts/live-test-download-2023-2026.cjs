const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const { CaptchaSolver } = require('../dist-electron/main/scanner/CaptchaSolver');
const { PortalSession } = require('../dist-electron/main/portal/PortalSession');
const { TaxPortalClient } = require('../dist-electron/main/portal/TaxPortalClient');
const { TaxScanEngine } = require('../dist-electron/main/scanner/TaxScanEngine');
const { AccountStore } = require('../dist-electron/main/persistence/AccountStore');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  console.log('================================================================');
  console.log('  LIVE BACKTEST DOWNLOAD HỒ SƠ THUẾ (2023 - 2026)');
  console.log('================================================================');

  // 1. Đọc tài khoản đã lưu
  const accounts = AccountStore.getSavedAccounts();
  console.log(`Tìm thấy ${accounts.length} tài khoản đã lưu trong hệ thống:`);
  accounts.forEach(a => console.log(` - MST: ${a.taxCode} (${a.companyName || 'Doanh nghiệp'})`));

  if (accounts.length === 0) {
    console.error('Không tìm thấy tài khoản đã lưu nào trong AppData!');
    app.exit(1);
    return;
  }

  let targetAccount = accounts.find(a => a.taxCode === '3801157209-ql') || accounts[0];
  let creds = AccountStore.getAccountCredentials(targetAccount.taxCode);
  if (!creds || !creds.password) {
    for (const a of accounts) {
      const c = AccountStore.getAccountCredentials(a.taxCode);
      if (c && c.password) {
        targetAccount = a;
        creds = c;
        break;
      }
    }
  }

  if (!creds || !creds.password) {
    console.error('Không tìm thấy tài khoản nào có thể giải mã mật khẩu.');
    app.exit(1);
    return;
  }

  const taxCode = creds.taxCode;
  const password = creds.password;
  console.log(`\nĐang sử dụng tài khoản: MST ${taxCode} (${creds.companyName || 'Doanh nghiệp'})`);

  const session = new PortalSession();
  const client = new TaxPortalClient(session);

  // 2. Đăng nhập với Captcha Solver
  console.log('\n[1/4] Đang đăng nhập Cổng Dịch vụ công...');
  let loggedIn = false;
  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const captchaImg = await client.getCaptchaImage('LOGIN');
      const solved = await CaptchaSolver.solveDetailed(captchaImg);
      if (!solved.text || solved.text.length < 4) {
        console.log(` - Lần ${attempt}: Nhận diện Captcha không đủ độ tin cậy, thử lại...`);
        await sleep(600);
        continue;
      }
      console.log(` - Lần ${attempt}: Giải Captcha "${solved.text}" (Độ tin cậy: ${solved.confidence || 'OK'})...`);
      const loginRes = await client.login(taxCode, password, solved.text);
      if (loginRes.success) {
        console.log(' => ĐĂNG NHẬP THÀNH CÔNG!');
        loggedIn = true;
        break;
      } else {
        console.log(` => Đăng nhập thất bại: ${loginRes.error || 'Sai captcha hoặc thông tin'}`);
      }
    } catch (err) {
      console.log(` - Lỗi lần ${attempt}:`, err.message);
    }
    await sleep(800);
  }

  if (!loggedIn) {
    console.error('Không thể đăng nhập sau các lần thử.');
    app.exit(1);
    return;
  }

  const scanEngine = new TaxScanEngine(client, session);
  const years = [2023, 2024, 2025, 2026];
  const summaryReport = [];

  for (const year of years) {
    console.log(`\n================================================================`);
    console.log(`  QUÉT & TẢI HỒ SƠ NĂM ${year}`);
    console.log(`================================================================`);

    console.log(`[+] Đang quét danh sách tờ khai năm ${year}...`);
    let filings = [];
    try {
      const scanRes = await scanEngine.scanYear(year, () => {});
      filings = scanRes.filings || [];
      console.log(` => Tìm thấy ${filings.length} tờ khai trong năm ${year}`);
    } catch (scanErr) {
      console.error(` => Lỗi khi quét năm ${year}:`, scanErr.message);
      summaryReport.push({ year, total: 0, success: 0, failed: 0, note: `Quét lỗi: ${scanErr.message}` });
      continue;
    }

    if (filings.length === 0) {
      console.log(` => Không có hồ sơ nào trong năm ${year}.`);
      summaryReport.push({ year, total: 0, success: 0, failed: 0, note: 'Không có hồ sơ' });
      continue;
    }

    let successCount = 0;
    let failedCount = 0;
    const failedDetails = [];

    for (let i = 0; i < filings.length; i++) {
      const f = filings[i];
      const label = `${f.declarationCode || f.title || 'Tờ khai'} (${f.period || 'Kỳ N/A'}, ID: ${f.id})`;
      process.stdout.write(` [${i + 1}/${filings.length}] Tải: ${label}... `);

      try {
        const payload = await client.downloadHoSo(f.id, undefined, {
          isThueDienTu: f.isThueDienTu,
          loaiTraCuu: f.loaiTraCuu,
          maTkhai: f.maTkhai,
          altIds: f.altIds,
          period: f.period,
          declarationCode: f.declarationCode
        });

        if (payload && payload.content && payload.content.length > 0) {
          const byteLen = Buffer.from(payload.content, 'base64').length;
          console.log(`OK! (${payload.fileType || 'file'}, ${byteLen} bytes)`);
          successCount++;
        } else {
          console.log(`LỖI: Trả về payload rỗng`);
          failedCount++;
          failedDetails.push({ label, error: 'Payload rỗng' });
        }
      } catch (dlErr) {
        console.log(`THẤT BẠI: ${dlErr.message}`);
        failedCount++;
        failedDetails.push({ label, error: dlErr.message });
      }

      await sleep(250); // Khoảng dừng lịch sự giữa các request
    }

    summaryReport.push({
      year,
      total: filings.length,
      success: successCount,
      failed: failedCount,
      failedDetails
    });
  }

  console.log('\n================================================================');
  console.log('  TỔNG KẾT KẾT QUẢ KIỂM THỬ TẢI HỒ SƠ (2023 - 2026)');
  console.log('================================================================');
  console.table(summaryReport.map(r => ({
    'Năm': r.year,
    'Tổng số hồ sơ': r.total,
    'Tải thành công': r.success,
    'Thất bại': r.failed,
    'Tỷ lệ thành công': r.total > 0 ? `${Math.round((r.success / r.total) * 100)}%` : 'N/A',
    'Ghi chú': r.note || (r.failed === 0 ? 'Hoàn hảo 100%' : `${r.failed} lỗi`)
  })));

  app.exit(0);
}

app.whenReady().then(main).catch(err => {
  console.error('Fatal test error:', err);
  app.exit(1);
}).finally(async () => {
  await CaptchaSolver.terminate();
});

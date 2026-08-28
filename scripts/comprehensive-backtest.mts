import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { CaptchaSolver } from '../src/main/scanner/CaptchaSolver';
import { PitAnalyticsEngine } from '../src/main/scanner/PitAnalyticsEngine';
import { VatAnalyticsEngine } from '../src/main/scanner/VatAnalyticsEngine';
import { LegacyFilingClient } from '../src/main/portal/LegacyFilingClient';
import { PortalSession } from '../src/main/portal/PortalSession';
import { TaxPortalClient } from '../src/main/portal/TaxPortalClient';
import { TaxFiling } from '../src/shared/types';

const taxCode = '3801157216-ql';
const password = 'Leoch@1234';

const session = new PortalSession();
const client = new TaxPortalClient(session);
const legacyClient = new LegacyFilingClient(session);

const report: {
  login: boolean;
  legacySearch: Record<number, number>;
  downloads: { total: number; success: number; failed: number; items: any[] };
  vatAnalytics: { success: boolean; periods?: number; details?: any; error?: string };
  pitAnalytics: { success: boolean; periods?: number; details?: any; error?: string };
  errors: string[];
} = {
  login: false,
  legacySearch: {},
  downloads: { total: 0, success: 0, failed: 0, items: [] },
  vatAnalytics: { success: false },
  pitAnalytics: { success: false },
  errors: []
};

async function solveCaptchaWithRetry(type: 'LOGIN' | 'SEARCH', maxAttempts = 10): Promise<string> {
  for (let i = 1; i <= maxAttempts; i++) {
    const image = await client.getCaptchaImage(type);
    const solved = await CaptchaSolver.solveDetailed(image);
    const accepted = CaptchaSolver.isSafeForAutoSubmit(solved);
    console.log(`[CAPTCHA ${type}] Lần ${i}/${maxAttempts}: solved="${solved.text}" (conf=${solved.confidence}%, accepted=${accepted})`);
    if (accepted && solved.text && solved.text.length >= 4) {
      return solved.text;
    }
    await new Promise(r => setTimeout(r, 600));
  }
  const img = await client.getCaptchaImage(type);
  const s = await CaptchaSolver.solveDetailed(img);
  return s.text;
}

async function runLogin(): Promise<boolean> {
  console.log(`\n========================================`);
  console.log(`[1] ĐĂNG NHẬP CỔNG DỊCH VỤ CÔNG: ${taxCode}`);
  console.log(`========================================`);

  for (let attempt = 1; attempt <= 8; attempt++) {
    try {
      const captcha = await solveCaptchaWithRetry('LOGIN');
      console.log(`[LOGIN] Thử đăng nhập lần ${attempt} với captcha: ${captcha}...`);
      const res = await client.login(taxCode, password, captcha);
      if (res.success) {
        console.log(`[LOGIN OK] Đăng nhập thành công! Doanh nghiệp: ${res.user?.companyName || taxCode}`);
        report.login = true;
        return true;
      } else {
        console.log(`[LOGIN FAIL] ${res.message} (field=${res.errorField})`);
        if (String(res.errorField || '').toLowerCase() !== 'captcha') {
          report.errors.push(`Đăng nhập thất bại: ${res.message}`);
          return false;
        }
      }
    } catch (err: any) {
      console.log(`[LOGIN ERROR] ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 1200));
  }
  report.errors.push('Đăng nhập thất bại sau 8 lần giải captcha');
  return false;
}

async function main() {
  console.log(`=======================================================`);
  console.log(`🚀 BẮT ĐẦU BACKTEST TOÀN DIỆN HỆ THỐNG TAXINSIGHT`);
  console.log(`Tài khoản: ${taxCode}`);
  console.log(`Thời gian bắt đầu: ${new Date().toLocaleString('vi-VN')}`);
  console.log(`=======================================================`);

  const loggedIn = await runLogin();
  if (!loggedIn) {
    console.log(`\n❌ DỪNG TEST DO ĐĂNG NHẬP KHÔNG THÀNH CÔNG.`);
    return;
  }

  const outDir = path.resolve('data', 'backtest-downloads');
  fs.mkdirSync(outDir, { recursive: true });

  const allDownloadedFilings: TaxFiling[] = [];

  console.log(`\n========================================`);
  console.log(`[2] TRA CỨU & TẢI TỜ KHAI TỪNG NĂM (2025 -> 2022)`);
  console.log(`========================================`);

  try {
    await legacyClient.ensureEtaxSession();
    console.log(`[LEGACY SSO OK] Đã mở phân hệ eTax!`);

    const years = [2025, 2024, 2023, 2022];
    for (const y of years) {
      try {
        console.log(`\n--- TRA CỨU NĂM ${y} ---`);
        const queryRes = await legacyClient.queryFilings(y, {
          maTKhai: '00',
          fromDate: `01/01/${y}`,
          toDate: `31/12/${y}`,
          page: 1
        });

        const filings = queryRes.filings || [];
        report.legacySearch[y] = filings.length;
        console.log(`[Năm ${y}] Tìm thấy ${filings.length} tờ khai.`);

        // Tải các tờ khai của năm này ngay trong phiên tra cứu hiện tại
        for (const filing of filings.slice(0, 3)) { // Lấy mẫu 3 tờ khai mỗi năm để kiểm thử tốc độ & độ chính xác
          if (!filing.messageId) continue;
          report.downloads.total++;
          try {
            console.log(`[DOWNLOAD ${y}] ${filing.declarationCode || filing.title} | Kỳ: ${filing.period} (ID: ${filing.messageId})...`);
            const file = await legacyClient.downloadFiling(filing.messageId);
            const filePath = path.join(outDir, file.fileName);
            fs.writeFileSync(filePath, file.dataBuffer);

            console.log(`  -> OK: ${file.fileName} (${file.contentType}, ${(file.dataBuffer.length / 1024).toFixed(1)} KB)`);
            report.downloads.success++;

            const isXml = file.fileName.toLowerCase().endsWith('.xml') || file.contentType.includes('xml');
            allDownloadedFilings.push({
              ...filing,
              downloadedFiles: isXml ? { xml: filePath } : { zip: filePath }
            });

            report.downloads.items.push({
              year: y,
              code: filing.declarationCode,
              period: filing.period,
              fileName: file.fileName,
              size: file.dataBuffer.length
            });
          } catch (err: any) {
            console.log(`  -> FAIL: ${err.message}`);
            report.downloads.failed++;
            report.errors.push(`Tải ${filing.declarationCode} (${y}) lỗi: ${err.message}`);
          }
          await new Promise(r => setTimeout(r, 600));
        }
      } catch (err: any) {
        console.log(`[LỖI NĂM ${y}] ${err.message}`);
        report.errors.push(`Tra cứu năm ${y} lỗi: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 800));
    }
  } catch (err: any) {
    console.log(`[LEGACY SSO ERROR] ${err.message}`);
    report.errors.push(`Lỗi kết nối eTax: ${err.message}`);
  }

  // ── 3. PHÂN TÍCH THUẾ GTGT ──────────────────────────────────
  console.log(`\n========================================`);
  console.log(`[3] PHÂN TÍCH THUẾ GIÁ TRỊ GIA TĂNG (GTGT)`);
  console.log(`========================================`);
  const vatFilings = allDownloadedFilings.filter(f => f.taxType === 'VAT' || (f.declarationCode && f.declarationCode.includes('GTGT')));
  console.log(`Số tờ khai GTGT đã tải sẵn sàng phân tích: ${vatFilings.length}`);

  if (vatFilings.length > 0) {
    try {
      const vatEngine = new VatAnalyticsEngine(client, outDir, legacyClient);
      const vatSummary = await vatEngine.analyzeVatFilings(vatFilings, taxCode);
      report.vatAnalytics = {
        success: true,
        periods: vatSummary.totalPeriodsCount,
        details: {
          coverage: vatSummary.coverageStatus,
          totalDoanhThuBanRa: vatSummary.totals.tongDoanhThuBanRa.toString(),
          totalThueBanRa: vatSummary.totals.tongThueBanRa.toString(),
          totalThueMuaVao: vatSummary.totals.tongThueMuaVao.toString(),
          totalThuePhaiNop: vatSummary.totals.tongThuePhaiNop.toString(),
          totalThueKhauTruChuyenKySau: vatSummary.totals.tongThueConKhauTru.toString(),
          periodGroupsCount: vatSummary.periodGroups.length
        }
      };
      console.log(`[VAT ANALYTICS OK]`);
      console.log(`- Số kỳ phân tích: ${vatSummary.totalPeriodsCount}`);
      console.log(`- Tổng doanh thu bán ra: ${vatSummary.totals.tongDoanhThuBanRa.toLocaleString('vi-VN')} ₫`);
      console.log(`- Tổng thuế bán ra: ${vatSummary.totals.tongThueBanRa.toLocaleString('vi-VN')} ₫`);
      console.log(`- Tổng thuế mua vào: ${vatSummary.totals.tongThueMuaVao.toLocaleString('vi-VN')} ₫`);
      console.log(`- Tổng thuế phải nộp: ${vatSummary.totals.tongThuePhaiNop.toLocaleString('vi-VN')} ₫`);
    } catch (err: any) {
      console.log(`[VAT ANALYTICS FAIL] ${err.message}`);
      report.vatAnalytics = { success: false, error: err.message };
      report.errors.push(`Phân tích GTGT lỗi: ${err.message}`);
    }
  } else {
    console.log('Doanh nghiệp chưa phát sinh tờ khai 01/GTGT trong mẫu quét.');
  }

  // ── 4. PHÂN TÍCH THUẾ TNCN ──────────────────────────────────
  console.log(`\n========================================`);
  console.log(`[4] PHÂN TÍCH THUẾ THU NHẬP CÁ NHÂN (TNCN)`);
  console.log(`========================================`);
  const pitFilings = allDownloadedFilings.filter(f => f.taxType === 'PIT' || (f.declarationCode && (f.declarationCode.includes('05/KK') || f.declarationCode.includes('05/QTT') || f.declarationCode.includes('TNCN'))));
  console.log(`Số tờ khai TNCN đã tải sẵn sàng phân tích: ${pitFilings.length}`);

  if (pitFilings.length > 0) {
    try {
      const pitEngine = new PitAnalyticsEngine(client, outDir, legacyClient);
      const pitSummary = await pitEngine.analyzePitFilings(pitFilings, taxCode);
      
      let sumTnct = 0n;
      let sumTnctKhauTru = 0n;
      let sumThueKhauTru = 0n;
      for (const group of pitSummary.periodGroups) {
        if (group.finalSnapshot) {
          sumTnct += group.finalSnapshot.ct24_tongThuNhapChiuThue || 0n;
          sumTnctKhauTru += group.finalSnapshot.ct27_tongThuNhapChiuThueKhauTru || 0n;
          sumThueKhauTru += group.finalSnapshot.ct34_tongThueKhauTru || group.finalSnapshot.ct31_tongThueTncnDaKhauTru || 0n;
        }
      }

      report.pitAnalytics = {
        success: true,
        periods: pitSummary.periodGroups.length,
        details: {
          periodGroupsCount: pitSummary.periodGroups.length,
          totalXml: pitSummary.totalXmlAvailableCount,
          totalTnct: sumTnct.toString(),
          totalTnctKhauTru: sumTnctKhauTru.toString(),
          totalThueKhauTru: sumThueKhauTru.toString(),
          hasFinalization: Boolean(pitSummary.finalizationSnapshot)
        }
      };
      console.log(`[PIT ANALYTICS OK]`);
      console.log(`- Số kỳ phân tích: ${pitSummary.periodGroups.length}`);
      console.log(`- Tổng TNCT chi trả: ${sumTnct.toLocaleString('vi-VN')} ₫`);
      console.log(`- Tổng TNCT khấu trừ: ${sumTnctKhauTru.toLocaleString('vi-VN')} ₫`);
      console.log(`- Tổng thuế TNCN đã khấu trừ: ${sumThueKhauTru.toLocaleString('vi-VN')} ₫`);
      console.log(`- Tờ khai QTT năm: ${pitSummary.finalizationSnapshot ? 'Đã tìm thấy bản QTT' : 'Chưa có'}`);
    } catch (err: any) {
      console.log(`[PIT ANALYTICS FAIL] ${err.message}`);
      report.pitAnalytics = { success: false, error: err.message };
      report.errors.push(`Phân tích TNCN lỗi: ${err.message}`);
    }
  } else {
    console.log('Không có tờ khai TNCN trong danh sách đã tải.');
  }

  console.log(`\n=======================================================`);
  console.log(`📊 TỔNG KẾT KẾT QUẢ BACKTEST TOÀN DIỆN`);
  console.log(`=======================================================`);
  console.log(JSON.stringify(report, null, 2));

  const outPath = path.resolve('data', 'backtest-results.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`\nĐã lưu kết quả tại: ${outPath}`);
}

main()
  .catch(err => {
    console.error('CRITICAL BACKTEST ERROR:', err);
  })
  .finally(async () => {
    await CaptchaSolver.terminate();
  });

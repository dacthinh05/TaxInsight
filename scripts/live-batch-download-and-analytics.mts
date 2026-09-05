import fs from 'fs';
import path from 'path';
import { PortalSession } from '../src/main/portal/PortalSession';
import { TaxPortalClient } from '../src/main/portal/TaxPortalClient';
import { LegacyFilingClient } from '../src/main/portal/LegacyFilingClient';
import { FileOrganizer } from '../src/main/files/FileOrganizer';
import { CaptchaSolver } from '../src/main/scanner/CaptchaSolver';
import { VatAnalyticsEngine } from '../src/main/scanner/VatAnalyticsEngine';
import { PitAnalyticsEngine } from '../src/main/scanner/PitAnalyticsEngine';
import { TaxFiling } from '../src/shared/types';

const TAX_CODE = process.env.TAXINSIGHT_LIVE_TAX_CODE || '3700776724-ql';
const PASSWORD = process.env.TAXINSIGHT_LIVE_PASSWORD || '3700776724@@@';

const BASE_OUT_DIR = path.resolve('data', 'HoSoThue_2024_2026', TAX_CODE);
fs.mkdirSync(BASE_OUT_DIR, { recursive: true });

const session = new PortalSession();
const client = new TaxPortalClient(session);
const legacyClient = new LegacyFilingClient(session);
const fileOrganizer = new FileOrganizer(BASE_OUT_DIR);

async function solveCaptchaDirect(purpose: 'LOGIN' | 'SEARCH', maxAttempts = 15): Promise<string> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const img = await client.getCaptchaImage(purpose);
      const solved = await CaptchaSolver.solveDetailed(img);
      const text = (solved.text || '').trim();
      if (text && text.length === 5) {
        return text;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 400));
  }
  throw new Error(`Không thể giải CAPTCHA ${purpose} sau ${maxAttempts} lần thử.`);
}

async function loginWithRetry(maxAttempts = 10): Promise<boolean> {
  console.log(`[LOGIN] Đang thực hiện đăng nhập cho MST: ${TAX_CODE}...`);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const captchaText = await solveCaptchaDirect('LOGIN', 8);
      console.log(`[LOGIN] Lần ${attempt}: Thử đăng nhập với CAPTCHA = "${captchaText}"...`);
      const res = await client.login(TAX_CODE, PASSWORD, captchaText);
      if (res.success) {
        console.log(`[LOGIN] ĐĂNG NHẬP THÀNH CÔNG!`);
        return true;
      }
      console.log(`[LOGIN] Đăng nhập chưa thành công: ${res.message || res.errorField}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[LOGIN] Lỗi lần ${attempt}: ${msg}`);
    }
    await new Promise(r => setTimeout(r, 800));
  }
  return false;
}

async function scanYearDirect(year: number): Promise<TaxFiling[]> {
  console.log(`\n[SCAN] ─── BẮT ĐẦU QUÉT NĂM ${year} ───`);
  const allFilings: TaxFiling[] = [];
  const seenIds = new Set<string>();

  // 1. Quét Cổng eTax (Nguồn chính cho tờ khai thuế XML gốc)
  try {
    const etaxRes = await legacyClient.queryFilings(year, { page: 1 });
    const totalPages = Math.min(etaxRes?.pagination?.totalPages || 1, 10);
    console.log(`[SCAN] eTax năm ${year}: Trang 1/${totalPages}, tìm thấy ${etaxRes?.filings?.length || 0} hồ sơ.`);

    if (etaxRes?.filings) {
      for (const f of etaxRes.filings) {
        const id = f.messageId || f.id;
        if (id && !seenIds.has(id)) {
          seenIds.add(id);
          allFilings.push(f);
        }
      }
    }

    // Quét các trang tiếp theo nếu có
    for (let p = 2; p <= totalPages; p++) {
      try {
        await new Promise(r => setTimeout(r, 350));
        const nextPage = await legacyClient.queryFilings(year, { page: p });
        if (nextPage?.filings) {
          for (const f of nextPage.filings) {
            const id = f.messageId || f.id;
            if (id && !seenIds.has(id)) {
              seenIds.add(id);
              allFilings.push(f);
            }
          }
        }
      } catch (pErr) {
        console.warn(`[SCAN] eTax năm ${year} trang ${p} lỗi:`, pErr instanceof Error ? pErr.message : String(pErr));
      }
    }
    console.log(`[SCAN] Cổng eTax năm ${year}: Đã lấy được ${allFilings.length} hồ sơ.`);
  } catch (etaxErr: unknown) {
    const msg = etaxErr instanceof Error ? etaxErr.message : String(etaxErr);
    console.warn(`[SCAN] eTax năm ${year} lỗi: ${msg}`);
  }

  // 2. Quét Cổng DVC
  try {
    const searchCaptcha = await solveCaptchaDirect('SEARCH', 10);
    const range = {
      fromDate: `01/01/${year}`,
      toDate: `31/12/${year}`,
      label: `Năm ${year}`,
      level: 'YEAR' as const
    };
    const dvcRes = await client.searchFilings(range, searchCaptcha, { page: 1, limit: 50 });
    if (dvcRes?.success && dvcRes.filings) {
      let dvcAdded = 0;
      for (const df of dvcRes.filings) {
        const id = df.id || df.messageId;
        if (id && !seenIds.has(id)) {
          seenIds.add(id);
          allFilings.push(df);
          dvcAdded++;
        }
      }
      console.log(`[SCAN] Cổng DVC năm ${year}: Tìm thấy ${dvcRes.filings.length} hồ sơ (bổ sung mới ${dvcAdded} hồ sơ).`);
    }
  } catch (dvcErr: unknown) {
    const msg = dvcErr instanceof Error ? dvcErr.message : String(dvcErr);
    console.warn(`[SCAN] DVC năm ${year} lỗi: ${msg}`);
  }

  console.log(`[SCAN] Tổng cộng năm ${year}: ${allFilings.length} hồ sơ.`);
  return allFilings;
}

async function downloadSingleFiling(filing: TaxFiling, year: number): Promise<boolean> {
  const filingYear = filing.periodNormalized?.year || year;
  const preCheck = fileOrganizer.checkPreDownloadStatus(TAX_CODE, filing, filingYear);
  if (preCheck.isAlreadyDownloaded) {
    filing.downloadStatus = 'EXISTING';
    filing.downloadedFiles = {
      xml: preCheck.xmlPath,
      pdf: preCheck.pdfPath,
      other: preCheck.otherPaths
    };
    return true;
  }

  // Ưu tiên tải từ eTax nếu có messageId 17 số
  const hasValidMsgId = /^\d{17}$/.test(String(filing.messageId || filing.id || '').trim());
  const targetMsgId = hasValidMsgId ? String(filing.messageId || filing.id).trim() : undefined;

  if (targetMsgId) {
    try {
      const res = await legacyClient.downloadFiling(targetMsgId, undefined, filingYear);
      const saveRes = fileOrganizer.saveDownloadedFiling({
        content: res.dataBuffer,
        fileName: res.fileName,
        contentType: res.contentType,
        filing,
        taxCode: TAX_CODE,
        year: filingYear
      });
      filing.downloadStatus = 'COMPLETED';
      filing.downloadedFiles = {
        xml: saveRes.xmlPath,
        pdf: saveRes.pdfPath,
        other: saveRes.savedPaths
      };
      return true;
    } catch (etaxErr) {
      // Thử fallback sang DVC
    }
  }

  // Thử tải qua DVC
  try {
    const dvcPayload = await client.downloadHoSo(filing.id, undefined, {
      isThueDienTu: filing.isThueDienTu,
      loaiTraCuu: filing.loaiTraCuu,
      maTkhai: filing.maTkhai,
      altIds: filing.altIds,
      period: filing.period,
      declarationCode: filing.declarationCode
    });
    if (dvcPayload && dvcPayload.content) {
      const saveRes = fileOrganizer.saveDownloadedFiling({
        content: dvcPayload.content,
        fileName: dvcPayload.fileName,
        contentType: dvcPayload.fileType,
        filing,
        taxCode: TAX_CODE,
        year: filingYear
      });
      filing.downloadStatus = 'COMPLETED';
      filing.downloadedFiles = {
        xml: saveRes.xmlPath,
        pdf: saveRes.pdfPath,
        other: saveRes.savedPaths
      };
      return true;
    }
  } catch (dvcErr) {
    // Thử resolveAndDownloadFiling trên eTax
    try {
      const res = await legacyClient.resolveAndDownloadFiling(TAX_CODE, filing);
      if (res && res.dataBuffer) {
        const saveRes = fileOrganizer.saveDownloadedFiling({
          content: res.dataBuffer,
          fileName: res.fileName,
          contentType: res.contentType,
          filing,
          taxCode: TAX_CODE,
          year: filingYear
        });
        filing.downloadStatus = 'COMPLETED';
        filing.downloadedFiles = {
          xml: saveRes.xmlPath,
          pdf: saveRes.pdfPath,
          other: saveRes.savedPaths
        };
        return true;
      }
    } catch (resErr) {
      // Cả 3 cách đều thất bại
    }
  }

  return false;
}

async function main() {
  console.log('================================================================');
  console.log(`  TAXINSIGHT DIRECT SCAN, DOWNLOAD & DEEP ANALYTICS`);
  console.log(`  MST: ${TAX_CODE} | Giai đoạn: 2024 - 2026`);
  console.log('================================================================');

  const loggedIn = await loginWithRetry(12);
  if (!loggedIn) throw new Error('Không thể đăng nhập.');

  // Khởi tạo phiên eTax ngay từ đầu
  try {
    await legacyClient.ensureEtaxSession();
    console.log('[ETAX] Khởi tạo phiên eTax thành công!');
  } catch (e) {
    console.warn('[ETAX] Khởi tạo eTax chưa đạt:', e instanceof Error ? e.message : String(e));
  }

  const years = [2024, 2025, 2026];
  const allFilings: TaxFiling[] = [];

  for (const y of years) {
    const yFilings = await scanYearDirect(y);
    allFilings.push(...yFilings);
  }

  console.log(`\n================================================================`);
  console.log(`  TỔNG SỐ HỒ SƠ TÌM THẤY CHO 2024 - 2026: ${allFilings.length} HỒ SƠ`);
  console.log(`================================================================\n`);

  console.log(`[DOWNLOAD] Bắt đầu tải tệp về thư mục: ${BASE_OUT_DIR}...`);
  let successCount = 0;
  let existingCount = 0;
  let failCount = 0;

  for (let i = 0; i < allFilings.length; i++) {
    const f = allFilings[i];
    const year = f.periodNormalized?.year || 2026;
    const desc = `${f.declarationCode || f.title} (${f.period || 'Chưa rõ kỳ'}) [${f.id || f.messageId}]`;

    try {
      const ok = await downloadSingleFiling(f, year);
      if (ok) {
        if (f.downloadStatus === 'EXISTING') {
          existingCount++;
          console.log(`[DOWNLOAD] [${i + 1}/${allFilings.length}] [CÓ SẴN] ${desc}`);
        } else {
          successCount++;
          console.log(`[DOWNLOAD] [${i + 1}/${allFilings.length}] [TẢI MỚI] ${desc}`);
        }
      } else {
        failCount++;
        console.log(`[DOWNLOAD] [${i + 1}/${allFilings.length}] [THẤT BẠI] ${desc}`);
      }
    } catch (dlErr) {
      failCount++;
      console.warn(`[DOWNLOAD] [${i + 1}/${allFilings.length}] [LỖI] ${desc}:`, dlErr instanceof Error ? dlErr.message : String(dlErr));
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('\n================================================================');
  console.log(`  KẾT QUẢ TẢI TỆP HOÀN TẤT`);
  console.log(`  Tổng số: ${allFilings.length} | Tải mới: ${successCount} | Có sẵn: ${existingCount} | Thất bại: ${failCount}`);
  console.log('================================================================\n');

  // ─── PHÂN TÍCH THUẾ GTGT (VAT) ─────────────────────────────────────────
  console.log('[ANALYTICS] Bắt đầu phân tích chuyên sâu tờ khai thuế GTGT...');
  const vatFilings = allFilings.filter(f => f.taxType === 'VAT' || /01\/GTGT|02\/GTGT|GTGT/i.test(f.declarationCode || f.title));
  console.log(`[ANALYTICS] Tìm thấy ${vatFilings.length} tờ khai GTGT.`);

  const vatEngine = new VatAnalyticsEngine(client, BASE_OUT_DIR, legacyClient);
  const vatSummary = await vatEngine.analyzeVatFilings(vatFilings, TAX_CODE);

  // ─── PHÂN TÍCH THUẾ TNCN (PIT) ─────────────────────────────────────────
  console.log('[ANALYTICS] Bắt đầu phân tích chuyên sâu tờ khai thuế TNCN...');
  const pitFilings = allFilings.filter(f => f.taxType === 'PIT' || /TNCN|05\/KK|02\/KK|05\/QTT/i.test(f.declarationCode || f.title));
  console.log(`[ANALYTICS] Tìm thấy ${pitFilings.length} tờ khai TNCN.`);

  const pitEngine = new PitAnalyticsEngine(client, BASE_OUT_DIR, legacyClient);
  const pitSummary = await pitEngine.analyzePitFilings(pitFilings, TAX_CODE);

  // Lưu file JSON báo cáo
  const reportPath = path.resolve('data', `BaoCao_Thue_2024_2026_${TAX_CODE}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({
    taxCode: TAX_CODE,
    generatedAt: new Date().toISOString(),
    totalFilingsFound: allFilings.length,
    downloadStats: { total: allFilings.length, success: successCount, existing: existingCount, failed: failCount },
    vatAnalytics: vatSummary,
    pitAnalytics: pitSummary
  }, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2), 'utf-8');

  console.log(`[ANALYTICS] Đã lưu báo cáo JSON tại: ${reportPath}\n`);

  // In kết quả phân tích trực quan
  console.log('================================================================');
  console.log('  KẾT QUẢ PHÂN TÍCH CHUYÊN SÂU THUẾ GTGT & TNCN (2024 - 2026)');
  console.log('================================================================\n');

  console.log(`### 1. TỔNG QUAN HỒ SƠ KHAI THUẾ`);
  console.log(`- Tổng hồ sơ đã quét: ${allFilings.length}`);
  console.log(`- Hồ sơ GTGT: ${vatFilings.length}`);
  console.log(`- Hồ sơ TNCN: ${pitFilings.length}`);
  console.log(`- Thư mục lưu trữ XML/PDF: ${BASE_OUT_DIR}`);

  console.log(`\n### 2. PHÂN TÍCH THUẾ GIÁ TRỊ GIA TĂNG (GTGT)`);
  console.log(`- Tổng số nhóm kỳ GTGT: ${vatSummary.periodGroups?.length || 0}`);
  console.log(`- Tổng thuế GTGT phải nộp lũy kế: ${Number(vatSummary.totalPayable || 0).toLocaleString('vi-VN')} ₫`);
  if (vatSummary.chainWarnings && vatSummary.chainWarnings.length > 0) {
    console.log(`- Cảnh báo chuỗi kê khai (${vatSummary.chainWarnings.length} cảnh báo):`);
    for (const w of vatSummary.chainWarnings) {
      console.log(`  + [${w.period}] ${w.message}`);
    }
  } else {
    console.log(`- Chuỗi kê khai liên hoàn: LIÊN TỤC & ĐÚNG QUY ĐỊNH (Không có cảnh báo gãy chuỗi)`);
  }

  if (vatSummary.periodGroups && vatSummary.periodGroups.length > 0) {
    console.log(`\nChi tiết các kỳ GTGT:`);
    for (const g of vatSummary.periodGroups) {
      const active = g.activeSnapshot;
      if (active) {
        console.log(`  * Kỳ ${g.period}: Doanh thu bán ra = ${Number(active.taxableRevenue || 0).toLocaleString('vi-VN')} ₫ | Thuế đầu ra = ${Number(active.outputVat || 0).toLocaleString('vi-VN')} ₫ | Còn được khấu trừ [43] = ${Number(active.deductibleVatTransferred || 0).toLocaleString('vi-VN')} ₫ | Phải nộp [40] = ${Number(active.vatPayable || 0).toLocaleString('vi-VN')} ₫`);
      }
    }
  }

  console.log(`\n### 3. PHÂN TÍCH THUẾ THU NHẬP CÁ NHÂN (TNCN)`);
  console.log(`- Tổng số kỳ kê khai TNCN: ${pitSummary.periodGroups?.length || 0}`);
  console.log(`- Tổng thuế TNCN đã nộp / phải nộp: ${Number(pitSummary.totalPayable || 0).toLocaleString('vi-VN')} ₫`);
  if (pitSummary.periodGroups && pitSummary.periodGroups.length > 0) {
    console.log(`\nChi tiết các kỳ TNCN:`);
    for (const g of pitSummary.periodGroups) {
      const active = g.activeSnapshot;
      if (active) {
        console.log(`  * Kỳ ${g.period}: Tổng TNCT = ${Number(active.totalTaxableIncome || 0).toLocaleString('vi-VN')} ₫ | Số người lao động = ${active.totalEmployees || 0} | Thuế TNCN phải nộp = ${Number(active.pitPayable || 0).toLocaleString('vi-VN')} ₫`);
      }
    }
  }

  console.log('\n[DONE] Toàn bộ quá trình quét, tải và phân tích dữ liệu 2024 - 2026 đã hoàn tất 100%!');
}

main().catch(err => {
  console.error('[FATAL ERROR]:', err);
  process.exit(1);
});

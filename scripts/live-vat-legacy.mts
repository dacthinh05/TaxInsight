import fs from 'fs';
import path from 'path';
import readline from 'readline/promises';
import AdmZip from 'adm-zip';
import { CaptchaSolver } from '../src/main/scanner/CaptchaSolver';
import { VatAnalyticsEngine } from '../src/main/scanner/VatAnalyticsEngine';
import { LegacyFilingClient } from '../src/main/portal/LegacyFilingClient';
import { PortalSession } from '../src/main/portal/PortalSession';
import { TaxPortalClient } from '../src/main/portal/TaxPortalClient';

const taxCode = String(process.env.TAXINSIGHT_LIVE_TAX_CODE || '').trim();
const password = String(process.env.TAXINSIGHT_LIVE_PASSWORD || '');
if (!taxCode || !password) throw new Error('Thiếu credential live-test.');

const session = new PortalSession();
const portal = new TaxPortalClient(session);
const legacy = new LegacyFilingClient(session);

async function captcha(): Promise<string> {
  const image = await portal.getCaptchaImage('LOGIN');
  const solved = await CaptchaSolver.solveDetailed(image);
  if (CaptchaSolver.isSafeForAutoSubmit(solved)) return solved.text;
  const file = path.resolve('data', 'live-captcha-login.png');
  fs.writeFileSync(file, Buffer.from(image.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
  console.log(`[VAT-LIVE] CAPTCHA path=${file}`);
  console.log(`[VAT-LIVE] candidates=${solved.candidates.filter(c => c.text).map(c => c.text).join(',')}`);
  const input = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await input.question('[VAT-LIVE] Nhập CAPTCHA: ')).trim();
  } finally {
    input.close();
  }
}

function extractXml(buffer: Buffer): string {
  if (buffer.subarray(0, 2).toString('ascii') === 'PK') {
    const entry = new AdmZip(buffer).getEntries().find(item => item.entryName.toLowerCase().endsWith('.xml'));
    if (!entry) throw new Error('ZIP không có XML.');
    return entry.getData().toString('utf-8');
  }
  return buffer.toString('utf-8');
}

async function main() {
  const login = await portal.login(taxCode, password, await captcha());
  if (!login.success) throw new Error(login.message || 'Login failed');
  await legacy.ensureEtaxSession();
  const formOptions = legacy.getAvailableFormOptions();
  const vatOptions = formOptions.filter(option => /GTGT|gia trị gia tăng/i.test(option.text));
  if (!vatOptions.length) throw new Error('Form eTax hiện tại không công bố mã tờ khai GTGT.');
  console.log(
    `[VAT-LIVE] options=${vatOptions.map(option => `${option.value}:${option.kieuKy || ''}:${option.text}`).join(' | ')}`
  );

  let vatFiling: any;
  for (const vatOption of vatOptions) {
    for (const year of [2025, 2024, 2023, 2022]) {
      const result = await legacy.queryFilings(year, {
        maTKhai: vatOption.value,
        tenTKhai: vatOption.text,
        kieuKy: vatOption.kieuKy,
        fromDate: `01/01/${year}`,
        toDate: `31/12/${year}`,
        page: 1
      });
      vatFiling = result.filings.find(filing => filing.messageId);
      console.log(
        `[VAT-LIVE] form=${vatOption.value} year=${year} count=${result.filings.length} found=${Boolean(vatFiling)} declarations=${
          result.filings.map(filing => `${filing.declarationCode || '?'}:${filing.messageId ? 'download' : 'no-id'}`).join(',')
        }`
      );
      if (vatFiling) break;
      await new Promise(resolve => setTimeout(resolve, 350));
    }
    if (vatFiling) break;
  }
  if (!vatFiling?.messageId) throw new Error('Không tìm thấy tờ khai GTGT trong các trang đã kiểm tra.');

  vatFiling.taxType = 'VAT';
  const downloaded = await legacy.downloadFiling(vatFiling.messageId);
  const xml = extractXml(downloaded.dataBuffer);
  const auditDir = path.resolve('data', 'live-analytics');
  fs.mkdirSync(auditDir, { recursive: true });
  const xmlPath = path.join(auditDir, 'vat-sample.xml');
  fs.writeFileSync(xmlPath, xml, 'utf-8');
  vatFiling.downloadedFiles = { xml: xmlPath };
  const summary = await new VatAnalyticsEngine(portal, auditDir).analyzeVatFilings([vatFiling], taxCode);
  const snapshot = summary.periodGroups[0]?.finalSnapshot;
  if (!snapshot || snapshot.parseStatus !== 'SUCCESS') {
    throw new Error(snapshot?.errorMessage || 'VAT snapshot không hợp lệ.');
  }
  for (const indicator of Object.values(snapshot.allIndicators)) {
    if (indicator.numericValue === undefined) throw new Error(`Chỉ tiêu ${indicator.code} thiếu numericValue.`);
  }
  console.log(
    `[VAT-LIVE] PASS period=${snapshot.period.normalizedKey} indicators=${Object.keys(snapshot.allIndicators).length} ct34=${snapshot.ct34_doanhThuBanRa} ct35=${snapshot.ct35_thueBanRa} ct40=${snapshot.ct40_thuePhaiNop} ct43=${snapshot.ct43_thueKhauTruChuyenKySau}`
  );
}

main()
  .catch(error => {
    console.error(`[VAT-LIVE] FAIL ${error?.message || error}`);
    process.exitCode = 1;
  })
  .finally(() => CaptchaSolver.terminate());

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import readline from 'readline/promises';
import AdmZip from 'adm-zip';
import { CaptchaSolver } from '../src/main/scanner/CaptchaSolver';
import { PitAnalyticsEngine } from '../src/main/scanner/PitAnalyticsEngine';
import { VatAnalyticsEngine } from '../src/main/scanner/VatAnalyticsEngine';
import { LegacyFilingClient } from '../src/main/portal/LegacyFilingClient';
import { PaymentSlipClient } from '../src/main/portal/PaymentSlipClient';
import { PortalSession } from '../src/main/portal/PortalSession';
import { TaxPortalClient } from '../src/main/portal/TaxPortalClient';
import { parseMoneyToBigInt } from '../src/shared/moneyUtils';
import { TaxFiling } from '../src/shared/types';

const taxCode = String(process.env.TAXINSIGHT_LIVE_TAX_CODE || '').trim();
const password = String(process.env.TAXINSIGHT_LIVE_PASSWORD || '');

if (!taxCode || !password) {
  throw new Error('Thiếu TAXINSIGHT_LIVE_TAX_CODE/TAXINSIGHT_LIVE_PASSWORD.');
}

const session = new PortalSession();
const client = new TaxPortalClient(session);
const legacyClient = new LegacyFilingClient(session);
const paymentClient = new PaymentSlipClient(session);

async function getSafeCaptcha(type: 'LOGIN' | 'SEARCH'): Promise<string> {
  const image = await client.getCaptchaImage(type);
  const solved = await CaptchaSolver.solveDetailed(image);
  const accepted = CaptchaSolver.isSafeForAutoSubmit(solved);
  console.log(`[LIVE] CAPTCHA ${type}: accepted=${accepted} reason=${solved.reason}`);
  if (!accepted) {
    const candidates = solved.candidates
      .filter(candidate => candidate.text)
      .slice(0, 12)
      .map(candidate => `${candidate.text}:${Math.round(candidate.confidence)}@${candidate.source}`)
      .join(' | ');
    console.log(`[LIVE] CAPTCHA CANDIDATES ${type}: ${candidates}`);
  }
  if (accepted) return solved.text;

  const extension = image.startsWith('data:image/jpeg') ? 'jpg' : 'png';
  const imagePath = path.resolve('data', `live-captcha-${type.toLowerCase()}.${extension}`);
  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  fs.writeFileSync(imagePath, Buffer.from(image.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
  console.log(`[LIVE] CAPTCHA_MANUAL_REQUIRED path=${imagePath}`);

  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const manual = (await prompt.question(`[LIVE] Nhập CAPTCHA ${type}: `)).trim();
    if (!/^[a-z0-9]{5,6}$/i.test(manual)) {
      throw Object.assign(new Error(`CAPTCHA ${type} nhập tay không đúng định dạng.`), {
        code: 'CAPTCHA_MANUAL_INVALID'
      });
    }
    return manual;
  } finally {
    prompt.close();
  }
}

function describeFile(buffer: Buffer): string {
  const magic = buffer.subarray(0, 8).toString('hex');
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  return `bytes=${buffer.length} magic=${magic} sha256=${sha}`;
}

function extractXml(buffer: Buffer): string | null {
  const head = buffer.subarray(0, 256).toString('utf-8').trimStart().toLowerCase();
  if (head.startsWith('<?xml') || (head.startsWith('<') && !head.startsWith('<html') && !head.startsWith('<!doctype'))) {
    return buffer.toString('utf-8');
  }
  if (buffer.subarray(0, 2).toString('ascii') !== 'PK') return null;
  const zip = new AdmZip(buffer);
  const entry = zip.getEntries().find(item => item.entryName.toLowerCase().endsWith('.xml'));
  return entry ? entry.getData().toString('utf-8') : null;
}

function findTag(xml: string, aliases: string[]): string | undefined {
  for (const alias of aliases) {
    const match = xml.match(
      new RegExp(`<(?:[a-zA-Z0-9_]+:)?${alias}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${alias}\\s*>`, 'i')
    );
    if (match?.[1] !== undefined) return match[1].trim();
  }
  return undefined;
}

async function auditAnalyticsSample(filing: TaxFiling, buffer: Buffer) {
  const xml = extractXml(buffer);
  if (!xml) throw new Error(`Hồ sơ ${filing.taxType} không chứa XML để audit analytics.`);
  const auditDir = path.resolve('data', 'live-analytics');
  fs.mkdirSync(auditDir, { recursive: true });
  const xmlPath = path.join(auditDir, `${filing.taxType.toLowerCase()}-sample.xml`);
  fs.writeFileSync(xmlPath, xml, 'utf-8');
  const localFiling: TaxFiling = {
    ...filing,
    downloadedFiles: { xml: xmlPath }
  };

  if (filing.taxType === 'VAT') {
    const summary = await new VatAnalyticsEngine(client, auditDir).analyzeVatFilings([localFiling], taxCode);
    const snapshot = summary.periodGroups[0]?.finalSnapshot;
    if (!snapshot || snapshot.parseStatus !== 'SUCCESS') {
      throw new Error(`VAT analytics không tạo được snapshot SUCCESS: ${snapshot?.errorMessage || 'missing snapshot'}`);
    }
    const checks: Array<[string, string[]]> = [
      ['ct22_thueDauVaoKyTruoc', ['ct22', 'thueDauVaoKyTruoc', 'ct_22', 'ct22_thueDauVao']],
      ['ct23_giaTriMuaVao', ['ct23', 'giaTriHHDVMuaVao', 'ct_23', 'ct23_giaTriHHDVMuaVao']],
      ['ct24_thueMuaVao', ['ct24', 'thueHHDVMuaVao', 'ct_24', 'ct24_thueHHDVMuaVao']],
      ['ct25_thueKhauTruKyNay', ['ct25', 'thueKhauTruKyNay', 'ct_25', 'ct25_thueKhauTruKyNay']],
      ['ct34_doanhThuBanRa', ['ct34', 'tongDoanhThuBanRa', 'ct_34', 'ct34_tongDoanhThuBanRa']],
      ['ct35_thueBanRa', ['ct35', 'tongThueBanRa', 'ct_35', 'ct35_tongThueBanRa']],
      ['ct40_thuePhaiNop', ['ct40', 'thuePhaiNopKyNay', 'ct_40', 'ct40_thuePhaiNopKyNay']],
      ['ct43_thueKhauTruChuyenKySau', ['ct43', 'thueConDuocKhauTruChuyenKySau', 'ct_43']]
    ];
    const mismatches = checks.flatMap(([field, aliases]) => {
      const raw = findTag(xml, aliases);
      if (raw === undefined) return [];
      const actual = (snapshot as any)[field] as bigint;
      return actual === parseMoneyToBigInt(raw) ? [] : [`${field}:xml=${raw},analytics=${actual}`];
    });
    if (mismatches.length) throw new Error(`VAT analytics lệch XML: ${mismatches.join('; ')}`);
    console.log(
      `[LIVE] VAT ANALYTICS PASS period=${snapshot.period.normalizedKey} indicators=${Object.keys(snapshot.allIndicators).length} ct40=${snapshot.ct40_thuePhaiNop}`
    );
    return;
  }

  if (filing.taxType === 'PIT') {
    const summary = await new PitAnalyticsEngine(client, auditDir).analyzePitFilings([localFiling], taxCode);
    const snapshot = summary.periodGroups[0]?.finalSnapshot;
    if (!snapshot) throw new Error('PIT analytics không tạo được final snapshot từ XML.');
    const isTt80 = /<maTKhai>\s*(?:864|953)\s*<\/maTKhai>|TT80\s*\/\s*2021/i.test(xml);
    const checks: Array<[string, string[]]> = isTt80
      ? [
          ['ct21_tongSoNguoiLaoDong', ['ct16']],
          ['ct22_caNhanCuTru', ['ct17']],
          ['ct24_tongThuNhapChiuThue', [snapshot.isFinalization ? 'ct23' : 'ct21']],
          ['ct27_tongThuNhapChiuThueKhauTru', [snapshot.isFinalization ? 'ct28' : 'ct26']]
        ]
      : [
          ['ct21_tongSoNguoiLaoDong', ['ct21', 'soLaoDong', 'tongSoLaoDong', 'ct_21']],
          ['ct22_caNhanCuTru', ['ct22', 'caNhanCuTru', 'ct_22']],
          ['ct24_tongThuNhapChiuThue', ['ct24', 'tongTNCT', 'tongThuNhapChiuThue', 'ct_24']],
          ['ct27_tongThuNhapChiuThueKhauTru', ['ct27', 'tnctKhauTru', 'ct_27']]
        ];
    const mismatches = checks.flatMap(([field, aliases]) => {
      const raw = findTag(xml, aliases);
      if (raw === undefined) return [];
      const actual = (snapshot as any)[field] as bigint;
      return actual === parseMoneyToBigInt(raw) ? [] : [`${field}:xml=${raw},analytics=${actual}`];
    });
    const rawTotal = findTag(
      xml,
      isTt80
        ? [snapshot.isFinalization ? 'ct31' : 'ct29']
        : (snapshot.isFinalization ? ['ct30', 'ct36', 'ct_30', 'ct_36'] : ['ct30', 'ct34', 'ct_30', 'ct_34'])
    );
    const analyticsTotal = snapshot.isFinalization
      ? snapshot.ct36_qtt_tongThueDaKhauTruTrongNam
      : snapshot.ct34_tongThueKhauTru;
    if (rawTotal !== undefined && analyticsTotal !== parseMoneyToBigInt(rawTotal)) {
      mismatches.push(`tongThue:xml=${rawTotal},analytics=${analyticsTotal}`);
    }
    if (mismatches.length) throw new Error(`PIT analytics lệch XML: ${mismatches.join('; ')}`);
    console.log(
      `[LIVE] PIT ANALYTICS PASS period=${snapshot.periodKey} ct24=${snapshot.ct24_tongThuNhapChiuThue} totalTax=${snapshot.ct34_tongThueKhauTru}`
    );
  }
}

async function main() {
  const loginCaptcha = await getSafeCaptcha('LOGIN');
  const login = await client.login(taxCode, password, loginCaptcha);
  if (!login.success) {
    throw Object.assign(new Error(login.message || 'Đăng nhập thất bại'), {
      code: login.errorField || 'LOGIN_FAILED'
    });
  }
  console.log('[LIVE] LOGIN PASS');

  const sessionAlive = await client.checkSession();
  if (!sessionAlive) throw new Error('Session health check thất bại sau đăng nhập.');
  console.log('[LIVE] SESSION PASS');

  const searchCaptcha = await getSafeCaptcha('SEARCH');
  const currentSearch = await client.searchFilings(
    {
      fromDate: '01/01/2025',
      toDate: '31/12/2025',
      label: 'Năm 2025',
      level: 'YEAR'
    },
    searchCaptcha,
    { page: 1 }
  );
  console.log(`[LIVE] CURRENT SEARCH PASS count=${currentSearch.filings.length} hasMore=${currentSearch.hasMorePages}`);
  const counts = currentSearch.filings.reduce<Record<string, number>>((acc, filing) => {
    acc[filing.taxType] = (acc[filing.taxType] || 0) + 1;
    return acc;
  }, {});
  console.log(`[LIVE] CURRENT TYPES ${JSON.stringify(counts)}`);
  const currentDownloadTarget =
    currentSearch.filings.find(filing => filing.downloadAvailable && (filing.taxType === 'VAT' || filing.taxType === 'PIT')) ||
    currentSearch.filings.find(filing => filing.downloadAvailable);
  if (!currentDownloadTarget) throw new Error('Không có hồ sơ hiện tại cho phép tải.');
  const currentFile = await client.downloadHoSo(currentDownloadTarget.id, undefined, {
    isThueDienTu: currentDownloadTarget.isThueDienTu,
    loaiTraCuu: currentDownloadTarget.loaiTraCuu,
    maTkhai: currentDownloadTarget.maTkhai,
    altIds: currentDownloadTarget.altIds
  });
  const currentBuffer = Buffer.from(currentFile.content, 'base64');
  console.log(`[LIVE] CURRENT DOWNLOAD PASS ${describeFile(currentBuffer)}`);

  const analyticsTargets = ['VAT', 'PIT']
    .map(taxType => currentSearch.filings.find(filing => filing.downloadAvailable && filing.taxType === taxType))
    .filter((filing): filing is TaxFiling => Boolean(filing));
  for (const filing of analyticsTargets) {
    const buffer = filing.id === currentDownloadTarget.id
      ? currentBuffer
      : Buffer.from((await client.downloadHoSo(filing.id, undefined, {
          isThueDienTu: filing.isThueDienTu,
          loaiTraCuu: filing.loaiTraCuu,
          maTkhai: filing.maTkhai,
          altIds: filing.altIds
        })).content, 'base64');
    await auditAnalyticsSample(filing, buffer);
  }
  const auditedTaxTypes = new Set(analyticsTargets.map(filing => filing.taxType));

  try {
    await legacyClient.ensureEtaxSession();
    console.log(`[LIVE] LEGACY SSO PASS forms=${legacyClient.getAvailableFormOptions().length}`);
    let legacyTarget: { messageId?: string } | undefined;
    for (const year of [2025, 2024, 2023, 2022]) {
      let page = 1;
      let totalPages = 1;
      do {
        const legacySearch = await legacyClient.queryFilings(year, {
          maTKhai: '00',
          fromDate: `01/01/${year}`,
          toDate: `31/12/${year}`,
          page
        });
        totalPages = Math.min(legacySearch.pagination.totalPages, 10);
        const legacyCounts = legacySearch.filings.reduce<Record<string, number>>((acc, filing) => {
          acc[filing.taxType] = (acc[filing.taxType] || 0) + 1;
          return acc;
        }, {});
        console.log(
          `[LIVE] LEGACY SEARCH PASS year=${year} count=${legacySearch.filings.length} page=${legacySearch.pagination.currentPage}/${legacySearch.pagination.totalPages} types=${JSON.stringify(legacyCounts)}`
        );
        legacyTarget =
          legacySearch.filings.find(
            record =>
              record.messageId &&
              (record.taxType === 'VAT' || record.taxType === 'PIT') &&
              !auditedTaxTypes.has(record.taxType)
          ) ||
          legacyTarget;
        if (legacyTarget?.messageId) break;
        page++;
        if (page <= totalPages) await new Promise(resolve => setTimeout(resolve, 350));
      } while (page <= totalPages);
      if (legacyTarget?.messageId) break;
    }
    if (legacyTarget?.messageId) {
      const legacyFile = await legacyClient.downloadFiling(legacyTarget.messageId);
      console.log(`[LIVE] LEGACY DOWNLOAD PASS ${describeFile(legacyFile.dataBuffer)}`);
      const filing = legacyTarget as TaxFiling;
      if (
        (filing.taxType === 'VAT' || filing.taxType === 'PIT') &&
        !auditedTaxTypes.has(filing.taxType)
      ) {
        await auditAnalyticsSample(filing, legacyFile.dataBuffer);
        auditedTaxTypes.add(filing.taxType);
      }
    } else {
      console.log('[LIVE] LEGACY DOWNLOAD SKIPPED no-records-in-probed-years');
    }
  } catch (error: any) {
    console.log(`[LIVE] LEGACY BLOCKED code=${error?.code || ''} error=${error?.message || error}`);
  }

  try {
    const gnt = await paymentClient.queryPaymentSlips({
      startDate: '01/01/2025',
      endDate: '31/12/2025',
      page: 1
    });
    console.log(
      `[LIVE] GNT ${gnt.success ? 'PASS' : 'FAIL'} count=${gnt.data.length} code=${gnt.errorCode || ''} error=${gnt.error || ''}`
    );
  } catch (error: any) {
    console.log(`[LIVE] GNT BLOCKED code=${error?.code || error?.errorCode || ''} error=${error?.message || error}`);
  }
}

main()
  .catch(error => {
    console.error(`[LIVE] FAIL code=${error?.code || error?.errorCode || ''} message=${error?.message || error}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await CaptchaSolver.terminate();
  });

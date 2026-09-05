import { PortalSession } from '../src/main/portal/PortalSession';
import { TaxPortalClient } from '../src/main/portal/TaxPortalClient';
import { LegacyFilingClient } from '../src/main/portal/LegacyFilingClient';
import { CaptchaSolver } from '../src/main/scanner/CaptchaSolver';

const TAX_CODE = '3700776724-ql';
const PASSWORD = '3700776724@@@';
const FILING_ID = '000.701.18.G12-260331-27110000310611';

async function main() {
  const session = new PortalSession();
  const client = new TaxPortalClient(session);
  const legacyClient = new LegacyFilingClient(session);

  console.log('[DIAG] Logging in...');
  for (let i = 1; i <= 8; i++) {
    const img = await client.getCaptchaImage('LOGIN');
    const solved = await CaptchaSolver.solveDetailed(img);
    if (solved.text && solved.text.length === 5) {
      const res = await client.login(TAX_CODE, PASSWORD, solved.text);
      if (res.success) {
        console.log('[DIAG] Logged in successfully!');
        break;
      }
    }
    await new Promise(r => setTimeout(r, 600));
  }

  // 1. Thử các URL detail trên Cổng DVC
  const idVariants = [
    FILING_ID,
    '27110000310611',
    'G12-260331-27110000310611'
  ];

  for (const id of idVariants) {
    for (const loai of ['', '0', '1', '2']) {
      const url = `https://dichvucong.gdt.gov.vn/tthc/tchs/files/detail/${encodeURIComponent(id)}?loai=${loai}`;
      try {
        const res = await session.client.get(url, {
          headers: {
            Referer: 'https://dichvucong.gdt.gov.vn/tthc/tchs',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          },
          timeout: 10000
        });
        console.log(`[DVC DETAIL] id=${id}, loai=${loai} -> Status: ${res.status}, Length: ${String(res.data).length}`);
        const head = String(res.data).slice(0, 100).replace(/\s+/g, ' ');
        console.log(`  Head: ${head}`);
      } catch (err: any) {
        console.log(`[DVC DETAIL] id=${id}, loai=${loai} -> Error: ${err.response?.status || err.message}`);
      }
    }
  }

  // 2. Kiểm tra trên eTax
  console.log('\n[DIAG] Checking eTax...');
  try {
    await legacyClient.ensureEtaxSession();
    console.log('[eTax] Session ready!');

    // Tra cứu năm 2026 (vì nộp ngày 31/03/2026)
    console.log('[eTax] Querying year 2026 for QTT / 05...');
    const q2026 = await legacyClient.queryFilings(2026, { page: 1 });
    console.log(`[eTax 2026] Found ${q2026.filings.length} filings:`);
    for (const f of q2026.filings) {
      console.log(`  - [${f.messageId}] ${f.declarationCode || f.title} | ${f.period} | Nộp: ${f.submittedAt}`);
    }

    // Tra cứu năm 2025
    console.log('\n[eTax] Querying year 2025 for QTT / 05...');
    for (let p = 1; p <= 5; p++) {
      const q2025 = await legacyClient.queryFilings(2025, { page: p });
      const qttMatches = q2025.filings.filter(f => /QTT|quyết toán|05/i.test(f.declarationCode || f.title));
      if (qttMatches.length > 0) {
        console.log(`[eTax 2025 page ${p}] Matching filings:`);
        for (const f of qttMatches) {
          console.log(`  - [${f.messageId}] ${f.declarationCode || f.title} | ${f.period} | Nộp: ${f.submittedAt}`);
        }
      }
    }
  } catch (e: any) {
    console.error('[eTax Error]:', e.message);
  }
}

main().catch(console.error);

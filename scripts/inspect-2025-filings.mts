import { PortalSession } from '../src/main/portal/PortalSession';
import { TaxPortalClient } from '../src/main/portal/TaxPortalClient';
import { CaptchaSolver } from '../src/main/scanner/CaptchaSolver';

const TAX_CODE = '3700776724-ql';
const PASSWORD = '3700776724@@@';

async function main() {
  const session = new PortalSession();
  const client = new TaxPortalClient(session);

  for (let i = 1; i <= 6; i++) {
    const img = await client.getCaptchaImage('LOGIN');
    const solved = await CaptchaSolver.solveDetailed(img);
    if (solved.text && solved.text.length === 5) {
      const res = await client.login(TAX_CODE, PASSWORD, solved.text);
      if (res.success) break;
    }
  }

  const sImg = await client.getCaptchaImage('SEARCH');
  const sSolved = await CaptchaSolver.solveDetailed(sImg);

  const res = await client.searchFilings(
    { fromDate: '01/01/2025', toDate: '31/03/2026', label: '2025', level: 'YEAR' },
    sSolved.text || '12345',
    { page: 1 }
  );

  console.log(`Total filings found: ${res.filings.length}`);
  console.log(`Total records reported by pagination: ${res.totalRecords}, hasMore: ${res.hasMorePages}`);

  const vatFilings = res.filings.filter(f => /GTGT/i.test(f.declarationCode || f.title));
  console.log(`\nVAT Filings (${vatFilings.length}):`);
  for (const f of vatFilings) {
    console.log(`  - [${f.declarationCode}] Kỳ: "${f.period}" | Nộp: ${f.submittedAt} | ID: ${f.id}`);
  }
}

main().catch(console.error);

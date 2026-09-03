import fs from 'fs';
import { CaptchaSolver } from '../src/main/scanner/CaptchaSolver';
import { PortalSession } from '../src/main/portal/PortalSession';
import { TaxPortalClient } from '../src/main/portal/TaxPortalClient';

const TAX_CODE = '3700776724-ql';
const PASSWORD = '3700776724@@@';

const session = new PortalSession();
const client = new TaxPortalClient(session);

async function main() {
  console.log('Logging in...');
  for (let i = 1; i <= 5; i++) {
    const img = await client.getCaptchaImage('LOGIN');
    const s = await CaptchaSolver.solveDetailed(img);
    if (!s.text || s.text.length < 4) continue;
    const res = await client.login(TAX_CODE, PASSWORD, s.text);
    if (res.success) {
      console.log('Login OK');
      break;
    }
  }

  // Search 2026 page 1
  for (let attempt = 1; attempt <= 3; attempt++) {
    const captchaImg = await client.getCaptchaImage('SEARCH');
    const s = await CaptchaSolver.solveDetailed(captchaImg);
    if (!s.text || s.text.length < 4) continue;
    const res = await client.searchFilings({ fromDate: '01/01/2026', toDate: '31/12/2026', label: '2026' }, s.text, { page: 1 });
    if (res.filings && res.filings.length > 0) {
      console.log('Found filings count:', res.filings.length);
      for (const f of res.filings) {
        console.log({
          id: f.id,
          title: f.title,
          period: f.period,
          declarationCode: f.declarationCode,
          procedureCode: f.procedureCode,
          isThueDienTu: f.isThueDienTu,
          loaiTraCuu: f.loaiTraCuu,
          altIds: f.altIds,
          downloadAvailable: f.downloadAvailable
        });
      }
      break;
    }
  }
}

main().catch(console.error);

import fs from 'fs';
import path from 'path';
import { CaptchaSolver } from '../src/main/scanner/CaptchaSolver';
import { PortalSession } from '../src/main/portal/PortalSession';
import { TaxPortalClient } from '../src/main/portal/TaxPortalClient';

const taxCode = process.env.TAXINSIGHT_TEST_TAX_CODE || '';
const password = process.env.TAXINSIGHT_TEST_PASSWORD || '';

async function main() {
  const session = new PortalSession();
  const client = new TaxPortalClient(session);

  for (let i = 1; i <= 6; i++) {
    const img = await client.getCaptchaImage('LOGIN');
    const solved = await CaptchaSolver.solveDetailed(img);
    if (solved.text && solved.text.length >= 4) {
      const res = await client.login(taxCode, password, solved.text);
      if (res.success) break;
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  const filingId = '000.713.18.G12-251226-27070000009495';
  const dlRes = await session.client.post('https://dichvucong.gdt.gov.vn/tthc/tchs/downloadhoso', { maHoSo: filingId }, {
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'X-XSRF-TOKEN': (client as any).csrfToken || '',
      'Referer': `https://dichvucong.gdt.gov.vn/tthc/tchs/files/detail/${encodeURIComponent(filingId)}?loai=`
    },
    responseType: 'arraybuffer'
  });

  const buf = Buffer.from(dlRes.data);
  console.log(`Buffer length: ${buf.length}`);
  console.log(`Header hex: ${buf.subarray(0, 16).toString('hex')}`);
  console.log(`Text snippet (first 300 chars):\n${buf.subarray(0, 300).toString('utf8')}`);
}

main().finally(() => CaptchaSolver.terminate());

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

  console.log('--- ĐĂNG NHẬP ---');
  let loggedIn = false;
  for (let i = 1; i <= 6; i++) {
    const img = await client.getCaptchaImage('LOGIN');
    const solved = await CaptchaSolver.solveDetailed(img);
    console.log(`Captcha solve: ${solved.text} (conf: ${solved.confidence})`);
    if (solved.text && solved.text.length >= 4) {
      const res = await client.login(taxCode, password, solved.text);
      if (res.success) {
        console.log('LOGIN SUCCESS!');
        loggedIn = true;
        break;
      }
      console.log('Login failed:', res.message);
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  if (!loggedIn) return;

  // Search 2025
  let searchRes: any;
  for (let i = 1; i <= 6; i++) {
    const img = await client.getCaptchaImage('SEARCH');
    const solved = await CaptchaSolver.solveDetailed(img);
    if (solved.text && solved.text.length >= 4) {
      searchRes = await client.searchFilings(
        { fromDate: '01/01/2025', toDate: '31/12/2025', label: '2025', level: 'YEAR' },
        solved.text,
        { page: 1 }
      );
      if (searchRes.filings?.length) break;
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  const filings = searchRes?.filings || [];
  console.log(`Tìm thấy ${filings.length} tờ khai:`);
  for (const f of filings) {
    console.log(`- ID: ${f.id} | MaTKhai: ${f.maTkhai} | Code: ${f.declarationCode} | Title: ${f.title} | isThueDienTu: ${f.isThueDienTu} | loaiTraCuu: ${f.loaiTraCuu}`);
  }

  if (!filings.length) return;
  const target = filings[0];
  console.log(`\n--- CHẨN ĐOÁN CHI TIẾT TỜ KHAI: ${target.id} ---`);

  // 1. Fetch detail HTML
  const detailUrl = `https://dichvucong.gdt.gov.vn/tthc/tchs/files/detail/${encodeURIComponent(target.id)}?loai=`;
  console.log(`GET ${detailUrl}...`);
  try {
    const detailRes = await session.client.get(detailUrl);
    console.log(`Detail status: ${detailRes.status}, data length: ${String(detailRes.data).length}`);
    fs.writeFileSync(path.resolve('data', 'detail_dump.html'), String(detailRes.data), 'utf8');
    console.log('Đã lưu data/detail_dump.html');
  } catch (e: any) {
    console.log('Detail err:', e.message, e.response?.status);
  }

  // 2. Fetch data-tai-lieu-dkem
  const attachUrl = `https://dichvucong.gdt.gov.vn/tthc/tchs/data-tai-lieu-dkem`;
  console.log(`POST ${attachUrl} with maHso=${target.id}...`);
  try {
    const attachRes = await session.client.post(attachUrl, { maHso: target.id }, {
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'X-XSRF-TOKEN': (client as any).csrfToken || '',
        'Referer': detailUrl
      }
    });
    console.log(`Attach status: ${attachRes.status}, response data:`, JSON.stringify(attachRes.data, null, 2));
  } catch (e: any) {
    console.log('Attach err:', e.message, e.response?.status, e.response?.data);
  }

  // 3. Test POST downloadhoso
  const dlUrl = `https://dichvucong.gdt.gov.vn/tthc/tchs/downloadhoso`;
  console.log(`POST ${dlUrl} with maHoSo=${target.id}...`);
  try {
    const dlRes = await session.client.post(dlUrl, { maHoSo: target.id }, {
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'X-XSRF-TOKEN': (client as any).csrfToken || '',
        'Referer': detailUrl
      },
      responseType: 'arraybuffer'
    });
    console.log(`Download status: ${dlRes.status}, length: ${dlRes.data?.length}, contentType: ${dlRes.headers['content-type']}`);
  } catch (e: any) {
    console.log('Download err:', e.message, e.response?.status, e.response?.data ? Buffer.from(e.response.data).toString('utf8') : '');
  }

  // 4. Test POST downloadhoso-tdt
  const dlTdtUrl = `https://dichvucong.gdt.gov.vn/tthc/tchs/downloadhoso-tdt?loaiTraCuu=1`;
  console.log(`POST ${dlTdtUrl} with maHoSo=${target.id}...`);
  try {
    const tdtRes = await session.client.post(dlTdtUrl, { maHoSo: target.id }, {
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'X-XSRF-TOKEN': (client as any).csrfToken || '',
        'Referer': detailUrl
      },
      responseType: 'arraybuffer'
    });
    console.log(`TDT Download status: ${tdtRes.status}, length: ${tdtRes.data?.length}, contentType: ${tdtRes.headers['content-type']}`);
  } catch (e: any) {
    console.log('TDT Download err:', e.message, e.response?.status, e.response?.data ? Buffer.from(e.response.data).toString('utf8') : '');
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    await CaptchaSolver.terminate();
  });

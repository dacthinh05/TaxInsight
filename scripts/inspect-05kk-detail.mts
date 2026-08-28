import fs from 'fs';
import path from 'path';
import { CaptchaSolver } from '../src/main/scanner/CaptchaSolver';
import { PortalSession } from '../src/main/portal/PortalSession';
import { TaxPortalClient } from '../src/main/portal/TaxPortalClient';

const taxCode = '3801157216-ql';
const password = 'Leoch@1234';

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

  // Lấy trang chi tiết của 05/KK-TNCN: 000.713.18.G12-251210-27070000028859
  const filingId = '000.713.18.G12-251210-27070000028859';
  const detailUrl = `https://dichvucong.gdt.gov.vn/tthc/tchs/files/detail/${encodeURIComponent(filingId)}?loai=`;
  const res = await session.client.get(detailUrl);
  const html = String(res.data || '');
  console.log(`Detail HTML length: ${html.length}`);

  // Tìm tất cả các thẻ <input>, <button>, <form>, onclick, href trong trang chi tiết
  const forms = html.match(/<form[\s\S]*?<\/form>/gi) || [];
  console.log(`Forms count: ${forms.length}`);
  forms.forEach((f, idx) => console.log(`Form #${idx + 1}:\n${f}\n`));

  const buttons = html.match(/<button[\s\S]*?<\/button>/gi) || [];
  console.log(`Buttons count: ${buttons.length}`);
  buttons.forEach((b, idx) => console.log(`Button #${idx + 1}: ${b}`));

  const onClicks = html.match(/onclick=["'][^"']+["']/gi) || [];
  console.log(`Onclicks:`, onClicks);

  const scripts = html.match(/<script[\s\S]*?<\/script>/gi) || [];
  console.log(`Scripts count: ${scripts.length}`);
  scripts.forEach((s, idx) => {
    if (s.includes('download') || s.includes('tchs') || s.includes('hoso') || s.includes('file')) {
      console.log(`Relevant Script #${idx + 1}:\n${s}\n`);
    }
  });

  fs.writeFileSync(path.resolve('data', '05kk_detail.html'), html, 'utf8');
}

main().finally(() => CaptchaSolver.terminate());

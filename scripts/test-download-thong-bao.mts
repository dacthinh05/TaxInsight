import fs from 'fs';
import path from 'path';
import { CaptchaSolver } from '../src/main/scanner/CaptchaSolver';
import { PortalSession } from '../src/main/portal/PortalSession';
import { TaxPortalClient } from '../src/main/portal/TaxPortalClient';

async function solveCaptchaAuto(client: TaxPortalClient, maxAttempts = 15): Promise<string> {
  for (let i = 1; i <= maxAttempts; i++) {
    const image = await client.getCaptchaImage('LOGIN');
    const solved = await CaptchaSolver.solveDetailed(image);
    const accepted = CaptchaSolver.isSafeForAutoSubmit(solved);
    if (accepted && solved.text && solved.text.length >= 4) {
      return solved.text;
    }
    await new Promise(r => setTimeout(r, 250));
  }
  const img = await client.getCaptchaImage('LOGIN');
  const s = await CaptchaSolver.solveDetailed(img);
  return s.text;
}

async function testDownloadThongBao() {
  const session = new PortalSession();
  const client = new TaxPortalClient(session);

  console.log('Logging in...');
  const captcha = await solveCaptchaAuto(client);
  const loginRes = await client.login('3801157216-ql', 'Leoch@1234', captcha);
  if (!loginRes.success) {
    console.log('Login failed');
    return;
  }
  console.log('Login OK');

  const detailUrl = 'https://dichvucong.gdt.gov.vn/tthc/tchs/files/detail/G12.18-260504-00030575?loai=';
  const detailRes = await session.client.get(detailUrl);
  const html = String(detailRes.data || '');
  const csrf = html.match(/name=["']csrf-token["']\s+content=["']([^"']+)["']/i)?.[1] ||
    html.match(/content=["']([^"']+)["']\s+name=["']csrf-token["']/i)?.[1] || '';

  console.log('Testing downloadThongBao for idTbao: 10820260038526196...');
  const tbRes = await session.client.post(
    'https://dichvucong.gdt.gov.vn/tthc/tchs/downloadThongBao',
    {
      idTbao: '10820260038526196',
      loaiTBao: ''
    },
    {
      headers: {
        'Referer': detailUrl,
        'X-XSRF-TOKEN': csrf,
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*'
      }
    }
  );

  console.log('downloadThongBao status:', tbRes.status);
  console.log('downloadThongBao data keys:', Object.keys(tbRes.data || {}));
  if (tbRes.data?.content) {
    const buf = Buffer.from(tbRes.data.content, 'base64');
    console.log(`🎉 SUCCESS! Tải thành công Thông báo Thuế: ${tbRes.data.fileName} (${buf.length} bytes)`);
    fs.mkdirSync('data/test-thongbao', { recursive: true });
    fs.writeFileSync(`data/test-thongbao/${tbRes.data.fileName || 'thongbao.pdf'}`, buf);
  }
}

testDownloadThongBao().finally(() => CaptchaSolver.terminate());

import fs from 'fs';
import path from 'path';
import readline from 'readline/promises';
import { PortalSession } from '../src/main/portal/PortalSession';
import { TaxPortalClient } from '../src/main/portal/TaxPortalClient';
import { CaptchaSolver } from '../src/main/scanner/CaptchaSolver';

const taxCode = String(process.env.TAXINSIGHT_LIVE_TAX_CODE || '').trim();
const password = String(process.env.TAXINSIGHT_LIVE_PASSWORD || '');
if (!taxCode || !password) throw new Error('Thiếu thông tin đăng nhập live test.');

const session = new PortalSession();
const client = new TaxPortalClient(session);

async function loginCaptcha(): Promise<string> {
  const image = await client.getCaptchaImage('LOGIN');
  let solved = await CaptchaSolver.solveDetailed(image);
  if (!CaptchaSolver.isSafeForAutoSubmit(solved)) {
    // Tesseract đôi lúc có chênh lệch nhỏ ở lần warm-up đầu tiên; chạy lại
    // đúng cùng ảnh một lần, không tạo CAPTCHA/request mới.
    solved = await CaptchaSolver.solveDetailed(image);
  }
  if (CaptchaSolver.isSafeForAutoSubmit(solved)) {
    console.log(`[LIVE-DOWNLOAD] CAPTCHA OCR accepted: ${solved.reason}`);
    return solved.text;
  }
  console.log(
    `[LIVE-DOWNLOAD] CAPTCHA OCR candidates: ${
      solved.candidates
        .filter(candidate => candidate.text)
        .slice(0, 12)
        .map(candidate => `${candidate.text}:${Math.round(candidate.confidence)}@${candidate.source}`)
        .join(' | ')
    }`
  );

  const filePath = path.resolve('data', 'live-download-login-captcha.png');
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(image.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
  console.log(`[LIVE-DOWNLOAD] CAPTCHA_MANUAL_REQUIRED path=${filePath}`);
  const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await prompt.question('[LIVE-DOWNLOAD] Nhập CAPTCHA đăng nhập: ')).trim();
  } finally {
    prompt.close();
  }
}

async function main() {
  const captcha = await loginCaptcha();
  const login = await client.login(taxCode, password, captcha);
  if (!login.success) throw new Error(`Đăng nhập thất bại: ${login.message || login.errorField}`);
  console.log('[LIVE-DOWNLOAD] LOGIN PASS');

  const targets = [
    {
      id: 'G12.18-260701-00011511',
      meta: { isThueDienTu: false, maTkhai: '864' }
    },
    {
      id: 'G12.18-260720-00263029',
      meta: { isThueDienTu: false, maTkhai: '864' }
    }
  ];

  if (process.env.TAXINSIGHT_LIVE_MODE === 'DETAIL') {
    const target = targets[0];
    const detailUrl = `https://dichvucong.gdt.gov.vn/tthc/tchs/files/detail/${target.id}?loai=`;
    const response = await session.client.get(detailUrl, {
      headers: {
        Referer: 'https://dichvucong.gdt.gov.vn/tthc/tchs',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    const html = typeof response.data === 'string'
      ? response.data
      : Buffer.from(response.data).toString('utf8');
    const outPath = path.resolve('data', 'live-current-detail.html');
    fs.writeFileSync(outPath, html, 'utf8');
    console.log(
      `[LIVE-DOWNLOAD] DETAIL status=${response.status} type=${response.headers['content-type'] || ''} bytes=${Buffer.byteLength(html)} path=${outPath}`
    );
    const interesting = html
      .split(/\r?\n/)
      .filter(line => /download|taiHoSo|idTKhai|maHoSo|ma-ho-so|file|dinhkem|đính kèm/i.test(line))
      .slice(0, 120);
    for (const line of interesting) {
      console.log(`[LIVE-DOWNLOAD] DETAIL-LINE ${line.trim().slice(0, 500)}`);
    }
    return;
  }

  if (process.env.TAXINSIGHT_LIVE_MODE === 'MAIN') {
    const response = await session.client.get('https://dichvucong.gdt.gov.vn/tthc/tchs', {
      headers: {
        Referer: 'https://dichvucong.gdt.gov.vn/tthc/home',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    const html = typeof response.data === 'string'
      ? response.data
      : Buffer.from(response.data).toString('utf8');
    const outPath = path.resolve('data', 'live-current-main.html');
    fs.writeFileSync(outPath, html, 'utf8');
    console.log(
      `[LIVE-DOWNLOAD] MAIN status=${response.status} type=${response.headers['content-type'] || ''} bytes=${Buffer.byteLength(html)} path=${outPath}`
    );
    const interesting = html
      .split(/\r?\n/)
      .filter(line => /viewDetail|files\/detail|validateIdTkhai|downloadHoSo|script.+src/i.test(line))
      .slice(0, 160);
    for (const line of interesting) {
      console.log(`[LIVE-DOWNLOAD] MAIN-LINE ${line.trim().slice(0, 700)}`);
    }
    return;
  }

  for (const target of targets) {
    try {
      const file = await client.downloadHoSo(target.id, undefined, target.meta);
      const buffer = Buffer.from(file.content, 'base64');
      console.log(
        `[LIVE-DOWNLOAD] PASS id=${target.id} bytes=${buffer.length} magic=${buffer.subarray(0, 4).toString('hex')}`
      );
    } catch (error: any) {
      console.log(
        `[LIVE-DOWNLOAD] FAIL id=${target.id} code=${error?.code || ''} status=${error?.httpStatus || ''} message=${error?.message || error}`
      );
      if (Array.isArray(error?.attempts)) {
        for (const attempt of error.attempts) {
          console.log(
            `[LIVE-DOWNLOAD] ATTEMPT ${attempt.label} status=${attempt.status} ms=${attempt.ms} head=${attempt.head}`
          );
        }
      }
    }
  }
}

main()
  .catch(error => {
    console.error(`[LIVE-DOWNLOAD] FATAL ${error?.message || error}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await CaptchaSolver.terminate();
  });

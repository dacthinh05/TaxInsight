import fs from 'fs';
import path from 'path';
import { CaptchaSolver } from '../src/main/scanner/CaptchaSolver';
import { PortalSession } from '../src/main/portal/PortalSession';
import { TaxPortalClient } from '../src/main/portal/TaxPortalClient';
import { LegacyFilingClient } from '../src/main/portal/LegacyFilingClient';

const taxCode = '3801157216-ql';
const password = 'Leoch@1234';

async function main() {
  const session = new PortalSession();
  const client = new TaxPortalClient(session);
  const legacy = new LegacyFilingClient(session);

  console.log('--- 1. ĐĂNG NHẬP DVC ---');
  for (let i = 1; i <= 6; i++) {
    const img = await client.getCaptchaImage('LOGIN');
    const solved = await CaptchaSolver.solveDetailed(img);
    if (solved.text && solved.text.length >= 4) {
      const res = await client.login(taxCode, password, solved.text);
      if (res.success) {
        console.log('ĐĂNG NHẬP THÀNH CÔNG!');
        break;
      }
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  // Tải tờ khai 05/KK-TNCN trên DVC: 000.713.18.G12-251210-27070000028859
  console.log('\n--- 2. TẢI TỜ KHAI 05/KK-TNCN TRÊN DVC ---');
  const dvcId = '000.713.18.G12-251210-27070000028859';
  try {
    const dvcPayload = await client.downloadHoSo(dvcId, undefined, {
      isThueDienTu: false,
      maTkhai: '864'
    });
    console.log(`DVC DOWNLOAD SUCCESS! FileName: ${dvcPayload.fileName}, FileType: ${dvcPayload.fileType}, Size: ${dvcPayload.content.length}`);
    const buf = Buffer.from(dvcPayload.content, 'base64');
    fs.writeFileSync(path.resolve('data', 'dvc_05kk.xml'), buf);
    console.log('Đã lưu data/dvc_05kk.xml');
  } catch (err: any) {
    console.log('DVC DOWNLOAD FAILED:', err.message, err.attempts);
  }

  // Tra cứu và tải trên eTax
  console.log('\n--- 3. TRA CỨU & TẢI TỜ KHAI TRÊN ETAX (LEGACY) ---');
  try {
    await legacy.ensureEtaxSession();
    console.log('SSO eTax THÀNH CÔNG!');
    const q2024 = await legacy.queryFilings(2024, { maTKhai: '00' });
    console.log(`Năm 2024 trên eTax: ${q2024.filings.length} tờ khai:`);
    for (const f of q2024.filings) {
      console.log(`- ${f.declarationCode || f.title} | messageId: ${f.messageId} | Kỳ: ${f.period}`);
    }

    if (q2024.filings.length > 0) {
      const target = q2024.filings.find(f => f.messageId) || q2024.filings[0];
      console.log(`\nĐang tải tờ khai eTax: ${target.declarationCode} (messageId=${target.messageId})...`);
      const file = await legacy.downloadFiling(target.messageId!);
      console.log(`ETAX DOWNLOAD SUCCESS! FileName: ${file.fileName}, ContentType: ${file.contentType}, Size: ${file.dataBuffer.length} bytes`);
      fs.writeFileSync(path.resolve('data', file.fileName || 'etax_sample.xml'), file.dataBuffer);
    }
  } catch (err: any) {
    console.log('ETAX ERROR:', err.message);
  }
}

main().finally(() => CaptchaSolver.terminate());

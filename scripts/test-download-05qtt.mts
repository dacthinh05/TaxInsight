import { PortalSession } from '../src/main/portal/PortalSession';
import { TaxPortalClient } from '../src/main/portal/TaxPortalClient';
import { CaptchaSolver } from '../src/main/scanner/CaptchaSolver';

const TAX_CODE = '3700776724-ql';
const PASSWORD = '3700776724@@@';
const FILING_ID = '000.701.18.G12-260331-27110000310611';

async function main() {
  const session = new PortalSession();
  const client = new TaxPortalClient(session);

  console.log('[LOGIN] Logging in...');
  for (let i = 1; i <= 6; i++) {
    const img = await client.getCaptchaImage('LOGIN');
    const solved = await CaptchaSolver.solveDetailed(img);
    if (solved.text && solved.text.length === 5) {
      const res = await client.login(TAX_CODE, PASSWORD, solved.text);
      if (res.success) {
        console.log('[LOGIN] Success!');
        break;
      }
    }
    await new Promise(r => setTimeout(r, 600));
  }

  console.log(`[DOWNLOAD] Downloading ${FILING_ID}...`);
  try {
    const res = await client.downloadHoSo(FILING_ID);
    console.log('[DOWNLOAD SUCCESS!]:', {
      fileName: res.fileName,
      fileType: res.fileType,
      contentLength: res.content?.length
    });
  } catch (err: any) {
    console.error('[DOWNLOAD FAILED]:', err.message);
  }
}

main().catch(console.error);

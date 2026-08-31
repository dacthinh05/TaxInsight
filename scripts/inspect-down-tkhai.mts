import fs from 'fs';
import { CaptchaSolver } from '../src/main/scanner/CaptchaSolver';
import { PortalSession } from '../src/main/portal/PortalSession';
import { TaxPortalClient } from '../src/main/portal/TaxPortalClient';
import { LegacyFilingClient } from '../src/main/portal/LegacyFilingClient';

async function solveCaptchaAuto(client: TaxPortalClient): Promise<string> {
  for (let i = 1; i <= 10; i++) {
    const image = await client.getCaptchaImage('LOGIN');
    const solved = await CaptchaSolver.solveDetailed(image);
    if (CaptchaSolver.isSafeForAutoSubmit(solved) && solved.text && solved.text.length >= 4) {
      return solved.text;
    }
  }
  const img = await client.getCaptchaImage('LOGIN');
  const s = await CaptchaSolver.solveDetailed(img);
  return s.text;
}

async function inspectDownTkhaiHtml() {
  const session = new PortalSession();
  const client = new TaxPortalClient(session);
  const legacyClient = new LegacyFilingClient(session);

  const captcha = await solveCaptchaAuto(client);
  await client.login('3801157216-ql', 'Leoch@1234', captcha);
  await legacyClient.ensureEtaxSession();

  const res = await legacyClient.queryFilings(2025, { page: 1 });
  console.log(`Found ${res.filings.length} filings on page 1.`);

  // Let's inspect the download buttons/links in the result page
  const formState = legacyClient.getFormState();
  console.log("Current Form State after queryFilings:", formState);
}

inspectDownTkhaiHtml().finally(() => CaptchaSolver.terminate());

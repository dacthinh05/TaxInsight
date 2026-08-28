const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { CaptchaSolver } = require('../dist-electron/main/scanner/CaptchaSolver');
const { PortalSession } = require('../dist-electron/main/portal/PortalSession');
const { TaxPortalClient } = require('../dist-electron/main/portal/TaxPortalClient');
const { PaymentSlipClient } = require('../dist-electron/main/portal/PaymentSlipClient');
const { PORTAL_CONFIG } = require('../dist-electron/shared/constants');

const taxCode = String(process.env.TAXINSIGHT_LIVE_TAX_CODE || '').trim();
const password = String(process.env.TAXINSIGHT_LIVE_PASSWORD || '');
if (!taxCode || !password) throw new Error('Thiếu credential live-test.');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function captcha(client) {
  const image = await client.getCaptchaImage('LOGIN');
  const solved = await CaptchaSolver.solveDetailed(image);
  if (CaptchaSolver.isSafeForAutoSubmit(solved)) return solved.text;
  const file = path.resolve('data', 'live-gnt-login-captcha.png');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(image.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
  console.log(`[GNT-LIVE] CAPTCHA path=${file}`);
  console.log(`[GNT-LIVE] candidates=${solved.candidates.filter(c => c.text).slice(0, 12).map(c => c.text).join(',')}`);
  const answerFile = path.resolve('data', 'live-gnt-captcha-answer.txt');
  try { fs.unlinkSync(answerFile); } catch {}
  console.log(`[GNT-LIVE] CAPTCHA_WAIT answerFile=${answerFile}`);
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (fs.existsSync(answerFile)) {
      const answer = fs.readFileSync(answerFile, 'utf8').trim();
      try { fs.unlinkSync(answerFile); } catch {}
      if (/^[a-z0-9]{5,6}$/i.test(answer)) return answer;
      throw new Error('CAPTCHA trong answer file không đúng định dạng.');
    }
    await sleep(250);
  }
  throw new Error('Hết thời gian chờ CAPTCHA live.');
}

async function syncJarToBrowser(session, win) {
  const cookies = await session.getCookieJar().getCookies(PORTAL_CONFIG.TCHS_URL);
  for (const cookie of cookies) {
    const details = {
      url: PORTAL_CONFIG.TCHS_URL,
      name: cookie.key,
      value: cookie.value,
      path: cookie.path || '/',
      secure: cookie.secure !== false,
      httpOnly: Boolean(cookie.httpOnly)
    };
    if (cookie.expires instanceof Date && Number.isFinite(cookie.expires.getTime())) {
      details.expirationDate = cookie.expires.getTime() / 1000;
    }
    await win.webContents.session.cookies.set(details);
  }
  const browserCookies = await win.webContents.session.cookies.get({ url: PORTAL_CONFIG.TCHS_URL });
  console.log(`[GNT-LIVE] COOKIE_SYNC jar=${cookies.length} browser=${browserCookies.length} names=${browserCookies.map(c => c.name).join(',')}`);
}

async function syncBrowserToJar(session, win) {
  const jar = session.getCookieJar();
  const cookies = await win.webContents.session.cookies.get({});
  for (const cookie of cookies) {
    const domain = cookie.domain?.startsWith('.') ? cookie.domain.slice(1) : cookie.domain || 'gdt.gov.vn';
    const url = `https://${domain}${cookie.path || '/'}`;
    await jar.setCookie(
      `${cookie.name}=${cookie.value}; Domain=${cookie.domain || domain}; Path=${cookie.path || '/'}`,
      url
    ).catch(() => {});
  }
}

async function readPageState(win) {
  return win.webContents.executeJavaScript(`
    (() => {
      const get = name => document.querySelector('input[name="' + name + '"]')?.value || '';
      const body = document.body?.innerText || '';
      return {
        url: location.href,
        sessionId: get('dse_sessionId'),
        applicationId: get('dse_applicationId'),
        pageId: get('dse_pageId'),
        operationName: get('dse_operationName'),
        processorState: get('dse_processorState'),
        processorId: get('dse_processorId'),
        errorPage: get('dse_errorPage'),
        pluginGate: /kiểm tra bản cập nhật|cài đặt ứng dụng ký điện tử|checkInstall/i.test(body + document.documentElement.innerHTML)
      };
    })()
  `);
}

async function main() {
  const session = new PortalSession();
  const portal = new TaxPortalClient(session);
  const payment = new PaymentSlipClient(session);
  const login = await portal.login(taxCode, password, await captcha(portal));
  if (!login.success) throw new Error(login.message || 'Đăng nhập thất bại.');
  console.log('[GNT-LIVE] LOGIN PASS');

  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    show: true,
    title: 'TaxInsight Live GNT Authentication',
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  await syncJarToBrowser(session, win);
  await win.loadURL('https://dichvucong.gdt.gov.vn/tthc/home?isChooseDgDinhKy=Y');
  console.log(`[GNT-LIVE] BOOTSTRAP url=${win.webContents.getURL()}`);

  const deadline = Date.now() + 90_000;
  let lastOperation = '';
  let lastUrl = '';
  let lastSsoSourceUrl = '';
  let ssoAttempts = 0;
  let sawPluginGate = false;
  while (!win.isDestroyed() && Date.now() < deadline) {
    await sleep(1500);
    await syncBrowserToJar(session, win);
    let state;
    try {
      state = await readPageState(win);
    } catch {
      continue;
    }
    sawPluginGate ||= Boolean(state.pluginGate || state.operationName === 'retailIndexProc');
    if (state.url && state.url !== lastUrl) {
      lastUrl = state.url;
      console.log(`[GNT-LIVE] BROWSER url=${new URL(state.url).origin}${new URL(state.url).pathname}`);
    }
    if (
      state.url.includes('dichvucong.gdt.gov.vn') &&
      !/\/tthc\/(?:home)?login(?:[/?#]|$)/i.test(state.url) &&
      !state.url.includes('/tthc/sso/redirect-to-service') &&
      state.url !== lastSsoSourceUrl &&
      ssoAttempts < 2
    ) {
      lastSsoSourceUrl = state.url;
      ssoAttempts++;
      console.log(`[GNT-LIVE] SSO_POST attempt=${ssoAttempts}`);
      await win.webContents.executeJavaScript(`
        (() => {
          const form = document.createElement('form');
          form.method = 'POST';
          form.action = '/tthc/sso/redirect-to-service?module=330410';
          form.target = '_self';
          const csrf =
            document.querySelector('input[name="_csrf"]')?.value ||
            document.querySelector('meta[name="csrf-token"]')?.content ||
            document.querySelector('meta[name="_csrf"]')?.content ||
            '';
          if (csrf) {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = '_csrf';
            input.value = csrf;
            form.appendChild(input);
          }
          document.body.appendChild(form);
          form.submit();
        })()
      `);
      continue;
    }
    if (state.operationName && state.operationName !== lastOperation) {
      lastOperation = state.operationName;
      console.log(`[GNT-LIVE] BROWSER op=${state.operationName} pluginGate=${state.pluginGate}`);
    }
    if (!state.sessionId) continue;

    const accepted = payment.setManualSessionState({
      sessionId: state.sessionId,
      applicationId: state.applicationId,
      pageId: state.pageId,
      operationName: state.operationName,
      processorState: state.processorState,
      processorId: state.processorId,
      errorPage: state.errorPage,
      actionUrl: state.url
    });
    if (!accepted) continue;

    try {
      if (!await payment.activateManualSessionForQuery()) continue;
      const result = await payment.queryPaymentSlips({
        startDate: '01/01/2025',
        endDate: '31/12/2025',
        page: 1
      });
      console.log(
        `[GNT-LIVE] QUERY ${result.success ? 'PASS' : 'FAIL'} count=${result.data.length} code=${result.errorCode || ''} error=${result.error || ''}`
      );
      if (result.success && result.data[0]) {
        const detail = await payment.getPaymentSlipDetail(result.data[0].ctuId, {
          soGnt: result.data[0].gntNo,
          maGiaoDich: result.data[0].transactionRef
        });
        console.log(`[GNT-LIVE] DETAIL PASS items=${detail.items.length} integrity=${detail.detailIntegrity}`);
      }
      win.close();
      return;
    } catch (error) {
      console.log(`[GNT-LIVE] QUERY ERROR code=${error?.errorCode || error?.code || ''} message=${error?.message || error}`);
    }
  }

  if (!win.isDestroyed()) win.close();
  console.log(
    `[GNT-LIVE] BLOCKED code=${sawPluginGate ? 'PLUGIN_GATE' : 'AUTH_TIMEOUT'} operation=${lastOperation || 'unknown'} url=${lastUrl || 'unknown'}`
  );
}

app.whenReady()
  .then(main)
  .catch(error => {
    console.error(`[GNT-LIVE] FAIL code=${error?.code || error?.errorCode || ''} message=${error?.message || error}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await CaptchaSolver.terminate();
    app.quit();
  });

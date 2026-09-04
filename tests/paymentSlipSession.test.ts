import { describe, expect, it, vi } from 'vitest';
import { PaymentSlipClient } from '../src/main/portal/PaymentSlipClient';
import { PortalSession } from '../src/main/portal/PortalSession';

describe('BUGFIX F-009 — phiên eTax stale: openQueryModule thất bại phải kích hoạt full SSO, không log PASS giả', () => {
  const buildStaleSessionClient = () => {
    const session = new PortalSession();
    const client = new PaymentSlipClient(session);

    // Cookie jar có JSESSIONID hợp lệ phía DVC → CHECKPOINT 01 PASS
    (session as any).getCookieJar = () => ({
      getCookies: () => Promise.resolve([{ key: 'JSESSIONID', value: 'MOCK_DVC_SESSION' }])
    });

    session.client.get = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tthc/dich-vu-khac')) {
        // Trang entry không có CSRF token, không có link thuedientu trực tiếp
        return Promise.resolve({ status: 200, data: '<html><body>Trang dich vu khac</body></html>' });
      }
      // Mọi GET khác (kể cả endpoint eTax nếu bị gọi nhầm) đều thất bại dạng lỗi thường
      return Promise.reject(new Error('Unexpected GET in F-009 test'));
    });

    session.client.post = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tthc/sso/redirect-to-service')) {
        // Phản hồi SSO không chứa URL thuedientu và không parse được DSE state
        return Promise.resolve({ status: 200, data: '<html><body>Khong co handoff</body></html>' });
      }
      return Promise.reject(new Error('Unexpected POST in F-009 test'));
    });

    // Seed DSE state stale (có sessionId + processorId nhưng thiếu applicationId)
    // → nhánh tái sử dụng phiên hiện hữu sẽ được thử trước
    client.setManualSessionState('STALE_SESSION_ID');
    return { session, client };
  };

  it('openQueryModule throw ETAX_FORM_CHANGED → kích hoạt lại chuỗi SSO DVC đầy đủ', async () => {
    const { client } = buildStaleSessionClient();
    const openSpy = vi.spyOn(client as any, 'openQueryModule').mockRejectedValue(
      Object.assign(new Error('Thiếu DSE state để mở phân hệ tra cứu GNT.'), { errorCode: 'ETAX_FORM_CHANGED' })
    );
    await expect((client as any).initializeEtaxSession()).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(openSpy).toHaveBeenCalledTimes(1);
  });

  it('SSO không parse được DSE state → GNT_05 FAIL (NEEDS_FULL_SSO), throw SESSION_EXPIRED, không seed state giả và không log PASS', async () => {
    const { client } = buildStaleSessionClient();

    let caught: any = null;
    try {
      await (client as any).initializeEtaxSession();
    } catch (err) {
      caught = err;
    }

    // Lỗi phải là SESSION_EXPIRED với message chứa "hết hạn" để queryPaymentSlips retry full SSO đúng 1 lần
    expect(caught).toBeDefined();
    expect(caught.code).toBe('SESSION_EXPIRED');
    expect(caught.errorCode).toBe('SESSION_EXPIRED');
    expect(String(caught.message)).toMatch(/hết hạn/);

    // Diagnostic: GNT_01 PASS (có cookie DVC), GNT_05 FAIL tường minh — tuyệt đối không PASS
    const report = client.getDiagnosticReport();
    expect(report.checkpoints.GNT_01_DVC_SESSION_VALID.status).toBe('PASS');
    expect(report.checkpoints.GNT_05_ETAX_AUTHENTICATED.status).toBe('FAIL');
    expect(report.checkpoints.GNT_05_ETAX_AUTHENTICATED.detail || '').toContain('NEEDS_FULL_SSO');
    expect(report.ssoHandoffType).toBe('UNKNOWN');

    // F-009: không được seed DSE state giả — sessionId phải giữ nguyên giá trị stale, không bị thay bằng ID hardcode
    expect((client as any).currentDseState.sessionId).toBe('STALE_SESSION_ID');
  });
});

describe('BUGFIX F-010 — assertGeneration ném lỗi hủy phiên với code thống nhất cho caller', () => {
  it('reset() tăng generation → assertGeneration(generation cũ) ném lỗi có cả code và errorCode là CANCELLED', () => {
    const session = new PortalSession();
    const client = new PaymentSlipClient(session);
    client.reset(); // generation 0 → 1

    let caught: any = null;
    try {
      (client as any).assertGeneration(0);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    // Caller trong repo kiểm tra err.code là chính — cả hai trường phải thống nhất
    expect(caught.code).toBe('CANCELLED');
    expect(caught.errorCode).toBe('CANCELLED');
    expect(String(caught.message)).toMatch(/bị hủy/);
  });

  it('assertGeneration đúng generation hiện tại không ném lỗi', () => {
    const session = new PortalSession();
    const client = new PaymentSlipClient(session);
    client.reset();
    expect(() => (client as any).assertGeneration((client as any).generation)).not.toThrow();
  });
});

describe('SSO handoff FORM_POST from DVC to eTax', () => {
  it('submits HTML auto-submit form to eTax when DVC returns FORM_POST SSO payload', async () => {
    const session = new PortalSession();
    const client = new PaymentSlipClient(session);

    (session as any).getCookieJar = () => ({
      getCookies: () => Promise.resolve([{ key: 'JSESSIONID', value: 'MOCK_DVC_SESSION' }])
    });

    session.client.get = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tthc/dich-vu-khac')) {
        return Promise.resolve({
          status: 200,
          data: '<html><head><meta name="_csrf" content="token_123" /></head><body>Trang dich vu khac</body></html>'
        });
      }
      return Promise.reject(new Error(`Unexpected GET: ${url}`));
    });

    session.client.post = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tthc/sso/redirect-to-service')) {
        // DVC responds with an auto-submit HTML form pointing to eTax
        const formHtml = `
          <html>
            <body>
              <form action="https://thuedientu.gdt.gov.vn/etaxnnt/EstablishSession" method="POST">
                <input type="hidden" name="dse_sessionId" value="ETAX_SESSION_999" />
                <input type="hidden" name="dse_applicationId" value="-1" />
                <input type="hidden" name="dse_operationName" value="corpQueryTaxProc" />
                <input type="hidden" name="dse_pageId" value="1" />
                <input type="hidden" name="dse_processorState" value="initial" />
                <input type="hidden" name="dse_processorId" value="PROC_999" />
              </form>
            </body>
          </html>
        `;
        return Promise.resolve({ status: 200, data: formHtml });
      }
      if (url.includes('/etaxnnt/EstablishSession')) {
        // eTax returns query form state
        const etaxHtml = `
          <html>
            <body>
              <form action="/etaxnnt/Request" method="POST">
                <input type="hidden" name="dse_sessionId" value="ETAX_SESSION_999" />
                <input type="hidden" name="dse_applicationId" value="-1" />
                <input type="hidden" name="dse_operationName" value="corpQueryTaxProc" />
                <input type="hidden" name="dse_pageId" value="1" />
                <input type="hidden" name="dse_processorState" value="query" />
                <input type="hidden" name="dse_processorId" value="PROC_999" />
              </form>
            </body>
          </html>
        `;
        return Promise.resolve({
          status: 200,
          data: etaxHtml,
          request: { res: { responseUrl: 'https://thuedientu.gdt.gov.vn/etaxnnt/EstablishSession' } }
        });
      }
      return Promise.reject(new Error(`Unexpected POST: ${url}`));
    });

    await client.ensureEtaxSession(true);

    const report = client.getDiagnosticReport();
    expect(report.checkpoints.GNT_01_DVC_SESSION_VALID.status).toBe('PASS');
    expect(report.checkpoints.GNT_02_ETAX_ENTRY_TRIGGERED.status).toBe('PASS');
    expect(report.checkpoints.GNT_03_SSO_HANDOFF_DETECTED.status).toBe('PASS');
    expect(report.checkpoints.GNT_04_ETAX_ORIGIN_REACHED.status).toBe('PASS');
    expect(report.checkpoints.GNT_05_ETAX_AUTHENTICATED.status).toBe('PASS');
    expect(report.ssoHandoffType).toBe('FORM_POST');
  });
});

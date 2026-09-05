import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { PitAnalyticsEngine } from '../src/main/scanner/PitAnalyticsEngine';
import { VatAnalyticsEngine } from '../src/main/scanner/VatAnalyticsEngine';
import { TaxScanEngine } from '../src/main/scanner/TaxScanEngine';
import { TaxFiling } from '../src/shared/types';
import { PaymentSlipClient } from '../src/main/portal/PaymentSlipClient';
import { PortalSession } from '../src/main/portal/PortalSession';
import { TaxPortalClient } from '../src/main/portal/TaxPortalClient';

describe('Request avalanche and missing-XML regressions', () => {
  const createAnalyticsFilings = (taxType: 'VAT' | 'PIT'): TaxFiling[] =>
    Array.from({ length: 5 }, (_, index) => ({
      id: `${taxType}_${index + 1}`,
      title: taxType === 'VAT' ? 'Tờ khai thuế GTGT' : 'Tờ khai thuế TNCN',
      taxType,
      declarationCode: taxType === 'VAT' ? '01/GTGT' : '05/KK-TNCN',
      period: `${String(index + 1).padStart(2, '0')}/2026`,
      submittedAt: '15/08/2026 09:00',
      filingType: 'ORIGINAL',
      downloadAvailable: true
    }));

  it('stops a year scan after the first year-level 429 without splitting the date range', async () => {
    const rateLimitError = Object.assign(new Error('HTTP 429 Too Many Requests'), {
      code: 'RATE_LIMIT',
      status: 429
    });
    const client = {
      searchFilings: vi.fn().mockRejectedValue(rateLimitError)
    };
    const captchaManager = Object.assign(new EventEmitter(), {
      requestCaptcha: vi.fn().mockResolvedValue('VALID_CAPTCHA'),
      cancel: vi.fn(),
      submitCaptcha: vi.fn()
    });
    const engine = new TaxScanEngine(client as any, captchaManager as any);

    await expect(
      engine.scanYear(2026, 'ALL', {
        customRange: {
          fromDate: '01/01/2026',
          toDate: '31/12/2026',
          label: 'Năm 2026',
          level: 'YEAR'
        }
      })
    ).rejects.toMatchObject({ code: 'RATE_LIMIT' });

    expect(client.searchFilings).toHaveBeenCalledTimes(1);
    expect(captchaManager.requestCaptcha).toHaveBeenCalledTimes(1);
    expect(client.searchFilings.mock.calls[0][0]).toMatchObject({
      fromDate: '01/01/2026',
      toDate: '31/12/2026',
      level: 'YEAR'
    });
  });

  it('uses one year-range search and does not fan out into quarters when pagination is complete', async () => {
    const filing: TaxFiling = {
      id: 'YEAR_ONLY_1',
      title: 'Tờ khai thuế GTGT',
      taxType: 'VAT',
      declarationCode: '01/GTGT',
      period: '01/2026',
      filingType: 'ORIGINAL',
      downloadAvailable: true
    };
    const client = {
      searchFilings: vi.fn().mockResolvedValue({
        filings: [filing],
        hasMorePages: false
      })
    };
    const captchaManager = Object.assign(new EventEmitter(), {
      requestCaptcha: vi.fn().mockResolvedValue('VALID_CAPTCHA'),
      cancel: vi.fn(),
      submitCaptcha: vi.fn()
    });
    const engine = new TaxScanEngine(client as any, captchaManager as any);

    const result = await engine.scanYear(2026, 'ALL', {
      customRange: {
        fromDate: '01/01/2026',
        toDate: '31/12/2026',
        label: 'Năm 2026',
        level: 'YEAR'
      }
    });

    expect(result.filings).toEqual([filing]);
    expect(client.searchFilings).toHaveBeenCalledTimes(1);
    expect(captchaManager.requestCaptcha).toHaveBeenCalledTimes(1);
  });

  it('marks a failed PIT XML download unavailable and never selects it as the final snapshot', async () => {
    const rateLimitError = Object.assign(new Error('Cổng Thuế từ chối tải XML'), {
      code: 'RATE_LIMIT',
      status: 429
    });
    const client = {
      downloadHoSo: vi.fn().mockRejectedValue(rateLimitError)
    };
    const filing: TaxFiling = {
      id: 'PIT_QTT_FAILED_XML',
      title: 'Tờ khai quyết toán thuế TNCN',
      taxType: 'PIT',
      declarationCode: '05/QTT-TNCN',
      period: 'Năm 2025',
      submittedAt: '15/04/2026 09:00',
      filingType: 'FINALIZATION',
      downloadAvailable: true
    };
    const engine = new PitAnalyticsEngine(client as any);

    const summary = await engine.analyzePitFilings([filing], '3702735709');
    const failedSnapshot = summary.periodGroups[0].snapshots[0];

    expect(client.downloadHoSo).toHaveBeenCalledTimes(1);
    expect(failedSnapshot).toMatchObject({
      submissionId: filing.id,
      xmlAvailable: false,
      parseStatus: 'FAILED'
    });
    expect(summary.totalXmlAvailableCount).toBe(0);
    expect(summary.failedXmlCount).toBe(1);
    expect(summary.coverageStatus).toBe('UNAVAILABLE');
    expect(summary.failedXmlDetails).toEqual([
      expect.objectContaining({
        submissionId: filing.id,
        reason: 'Cổng Thuế từ chối tải XML'
      })
    ]);
    expect(summary.periodGroups[0].finalSnapshot).toBeNull();
    expect(summary.finalizationSnapshot).toBeNull();
  });

  it.each([
    ['VAT', VatAnalyticsEngine],
    ['PIT', PitAnalyticsEngine]
  ] as const)('stops later %s analytics batches after the first infrastructure 429', async (taxType, Engine) => {
    const rateLimitError = Object.assign(new Error('HTTP 429 Too Many Requests'), {
      code: 'RATE_LIMIT',
      httpStatus: 429
    });
    const client = {
      downloadHoSo: vi.fn().mockRejectedValue(rateLimitError)
    };
    const engine = new Engine(client as any);
    const filings = createAnalyticsFilings(taxType);

    if (taxType === 'VAT') {
      await (engine as VatAnalyticsEngine).analyzeVatFilings(filings, '3702735709');
    } else {
      await (engine as PitAnalyticsEngine).analyzePitFilings(filings, '3702735709');
    }

    // Tối đa hai request của batch đang chạy; ba hồ sơ ở các batch sau không
    // được phép tiếp tục bắn request khi một worker đã báo 429.
    expect(client.downloadHoSo).toHaveBeenCalledTimes(2);
    expect(client.downloadHoSo.mock.calls.map(call => call[0])).toEqual([
      `${taxType}_1`,
      `${taxType}_2`
    ]);
  });

  it.each([
    ['VAT', VatAnalyticsEngine],
    ['PIT', PitAnalyticsEngine]
  ] as const)('routes historical eTax %s filings through messageId instead of the current DVC downloader', async (taxType, Engine) => {
    const currentClient = {
      downloadHoSo: vi.fn()
    };
    const legacyBuffer = Buffer.from('<?xml version="1.0"?><HSoThueDTu><maTKhai>864</maTKhai></HSoThueDTu>');
    const legacyClient = {
      downloadFiling: vi.fn().mockResolvedValue({
        dataBuffer: legacyBuffer,
        fileName: 'legacy.xml',
        contentType: 'application/xml'
      })
    };
    const engine = new Engine(currentClient as any, '', legacyClient as any);
    const filing: TaxFiling = {
      id: 'LEGACY-MESSAGE-01',
      messageId: 'LEGACY-MESSAGE-01',
      source: 'dvc-etax-html',
      title: taxType === 'VAT' ? 'Tờ khai thuế GTGT' : 'Tờ khai thuế TNCN',
      taxType,
      declarationCode: taxType === 'VAT' ? '01/GTGT' : '05/KK-TNCN',
      filingType: 'ORIGINAL',
      downloadAvailable: true
    };

    const result = await (engine as any).downloadHoSoWithRetry(filing);

    expect(Buffer.from(result.content, 'base64')).toEqual(legacyBuffer);
    expect(legacyClient.downloadFiling).toHaveBeenCalledWith('LEGACY-MESSAGE-01', expect.anything());
    expect(currentClient.downloadHoSo).not.toHaveBeenCalled();
  });
  it.each([
    ['VAT', VatAnalyticsEngine],
    ['PIT', PitAnalyticsEngine]
  ] as const)('prefers DVC download first and falls back to eTax %s when DVC fails', async (taxType, Engine) => {
    const dvcBuffer = Buffer.from('<?xml version="1.0"?><HSoThueDTu><maTKhai>01</maTKhai></HSoThueDTu>');
    const currentClient = {
      downloadHoSo: vi.fn().mockRejectedValue(new Error('DVC validation 400'))
    };
    const legacyBuffer = Buffer.from('<?xml version="1.0"?><HSoThueDTu><maTKhai>01</maTKhai></HSoThueDTu>');
    const legacyClient = {
      resolveAndDownloadFiling: vi.fn().mockResolvedValue({
        dataBuffer: legacyBuffer,
        fileName: 'etax.xml',
        contentType: 'application/xml'
      })
    };
    const engine = new Engine(currentClient as any, '', legacyClient as any);
    const filing: TaxFiling = {
      id: `${taxType}_CURRENT_01`,
      title: taxType === 'VAT' ? 'Tờ khai thuế GTGT' : 'Tờ khai thuế TNCN',
      taxType,
      declarationCode: taxType === 'VAT' ? '01/GTGT' : '05/KK-TNCN',
      period: '01/2026',
      filingType: 'ORIGINAL',
      downloadAvailable: true
    };

    const result = await (engine as any).downloadHoSoWithRetry(filing);

    expect(Buffer.from(result.content, 'base64')).toEqual(legacyBuffer);
    expect(currentClient.downloadHoSo).toHaveBeenCalledTimes(1);
    expect(legacyClient.resolveAndDownloadFiling).toHaveBeenCalledWith('', filing, expect.anything());
  });
  it('keeps all PIT filings as explicit unavailable snapshots after a rate-limit stop', async () => {
    const rateLimitError = Object.assign(new Error('HTTP 429 Too Many Requests'), {
      code: 'RATE_LIMIT',
      httpStatus: 429
    });
    const client = {
      downloadHoSo: vi.fn().mockRejectedValue(rateLimitError)
    };
    const engine = new PitAnalyticsEngine(client as unknown as TaxPortalClient);

    const summary = await engine.analyzePitFilings(createAnalyticsFilings('PIT'), '3702735709');

    expect(summary.totalFilingsAnalyzed).toBe(5);
    expect(summary.totalXmlAvailableCount).toBe(0);
    expect(summary.failedXmlCount).toBe(5);
    expect(summary.coverageStatus).toBe('UNAVAILABLE');
    expect(summary.failedXmlDetails).toHaveLength(5);
    expect(client.downloadHoSo).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['VAT', VatAnalyticsEngine],
    ['PIT', PitAnalyticsEngine]
  ] as const)('does not repeat eTax fallback when eTax throws RATE_LIMIT or 429 after DVC failure', async (taxType, Engine) => {
    const currentClient = {
      downloadHoSo: vi.fn().mockRejectedValue(new Error('DVC 500 error'))
    };
    const rateLimitError = Object.assign(new Error('HTTP 429 Too Many Requests'), {
      code: 'RATE_LIMIT',
      status: 429
    });
    const legacyClient = {
      resolveAndDownloadFiling: vi.fn().mockRejectedValue(rateLimitError)
    };
    const engine = new Engine(currentClient as any, '', legacyClient as any);
    const filing: TaxFiling = {
      id: `${taxType}_RATE_LIMIT_01`,
      title: taxType === 'VAT' ? 'Tờ khai thuế GTGT' : 'Tờ khai thuế TNCN',
      taxType,
      declarationCode: taxType === 'VAT' ? '01/GTGT' : '05/KK-TNCN',
      period: '01/2026',
      filingType: 'ORIGINAL',
      downloadAvailable: true
    };

    await expect((engine as any).downloadHoSoWithRetry(filing)).rejects.toThrow('HTTP 429 Too Many Requests');
    expect(currentClient.downloadHoSo).toHaveBeenCalledTimes(1);
    expect(legacyClient.resolveAndDownloadFiling).toHaveBeenCalledWith('', filing, expect.anything());
  });

  it('VAT buildSummaryFromSnapshots picks the last valid XML snapshot as finalSnapshot when a supplemental filing failed', () => {
    const filings: TaxFiling[] = [
      { id: 'F1', title: 'Tờ khai GTGT', taxType: 'VAT', period: 'Q1/2026', filingType: 'ORIGINAL', downloadAvailable: true },
      { id: 'F2', title: 'Tờ khai GTGT', taxType: 'VAT', period: 'Q1/2026', filingType: 'SUPPLEMENTAL', supplementalNo: 1, downloadAvailable: true }
    ];
    const snapshots: any[] = [
      {
        period: { normalizedKey: '2026-Q1', raw: 'Q1/2026', year: 2026, quarter: 1 },
        declarationType: 'ORIGINAL',
        xmlAvailable: true,
        submittedAt: '2026-04-20T00:00:00Z',
        ct24_thueMuaVao: 100n,
        ct25_thueKhauTruKyNay: 100n,
        ct35_thueBanRa: 200n,
        ct40_thuePhaiNop: 100n,
        ct43_thueKhauTruChuyenKySau: 0n
      },
      {
        period: { normalizedKey: '2026-Q1', raw: 'Q1/2026', year: 2026, quarter: 1 },
        declarationType: 'SUPPLEMENTAL',
        supplementalNo: 1,
        xmlAvailable: false,
        submittedAt: '2026-05-20T00:00:00Z',
        ct24_thueMuaVao: 0n,
        ct25_thueKhauTruKyNay: 0n,
        ct35_thueBanRa: 0n,
        ct40_thuePhaiNop: 0n,
        ct43_thueKhauTruChuyenKySau: 0n
      }
    ];

    const summary = VatAnalyticsEngine.buildSummaryFromSnapshots(filings, snapshots, '3702735709');
    expect(summary.periodGroups).toHaveLength(1);
    expect(summary.periodGroups[0].finalSnapshot).toBeDefined();
    expect(summary.periodGroups[0].finalSnapshot?.xmlAvailable).toBe(true);
    expect(summary.periodGroups[0].finalSnapshot?.ct40_thuePhaiNop).toBe(100n);
  });

  const detailHtml = (
    maHoSo: string,
    isTdt: boolean,
    loaiTraCuu?: string,
    extraBody = ''
  ) => `
    <html>
      <head>
        <meta name="_csrf" content="fresh-token" />
        <meta name="_csrf_header" content="X-XSRF-TOKEN" />
      </head>
      <body>
        <a href="#"
           onclick="downloadHoSo(this); return false;"
           data-mahoso="${maHoSo}"
           data-is-thue-dien-tu="${String(isTdt)}"
           ${loaiTraCuu ? `data-loaitracuu="${loaiTraCuu}"` : ''}>Tải xuống</a>
        ${extraBody}
      </body>
    </html>
  `;

  it('retries the same Standard contract once on HTTP 500 and never switches to TDT', async () => {
    const session = new PortalSession();
    const serverError = Object.assign(new Error('HTTP 500'), {
      response: { status: 500, data: 'Internal Server Error', headers: {} }
    });
    const postMock = vi.fn().mockRejectedValue(serverError);
    session.client.post = postMock;
    session.client.get = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        data: detailHtml('VALID_FILING_ID', false),
        headers: { 'content-type': 'text/html' }
      })
      .mockResolvedValueOnce({
        status: 200,
        data: '200',
        headers: { 'content-type': 'text/plain' }
      });
    const client = new TaxPortalClient(session);

    await expect(client.downloadHoSo('VALID_FILING_ID')).rejects.toThrow();

    expect(postMock).toHaveBeenCalledTimes(2);
    expect(postMock.mock.calls.every(call => String(call[0]).includes('/tthc/tchs/downloadhoso'))).toBe(true);
    expect(postMock.mock.calls.every(call => !String(call[0]).includes('downloadhoso-tdt'))).toBe(true);
    expect(postMock.mock.calls.every(call => JSON.stringify(call[1]) === JSON.stringify({ maHoSo: 'VALID_FILING_ID' }))).toBe(true);
  });

  it('treats HTTP 200 with validation body 400 as failure and sends no download request', async () => {
    const session = new PortalSession();
    session.client.get = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        data: detailHtml('G12.18-260720-00263029', false),
        headers: { 'content-type': 'text/html' }
      })
      .mockResolvedValueOnce({
        status: 200,
        data: '400',
        headers: { 'content-type': 'text/plain' }
      });
    session.client.post = vi.fn().mockResolvedValue({ status: 200, data: [] });
    const client = new TaxPortalClient(session);

    await expect(
      client.downloadHoSo('G12.18-260720-00263029')
    ).rejects.toMatchObject({ code: 'FILING_VALIDATION_FAILED' });
  });

  it('puts idTKhai in the validation query before the single official Standard POST', async () => {
    const session = new PortalSession();
    const postMock = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        data: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02]),
        headers: { 'content-type': 'application/zip' }
      });
    session.client.post = postMock;
    const getMock = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        data: detailHtml('G12.18-260720-00263029', false),
        headers: { 'content-type': 'text/html' }
      })
      .mockResolvedValueOnce({
        status: 200,
        data: '200',
        headers: { 'content-type': 'text/plain' }
      });
    session.client.get = getMock;
    const client = new TaxPortalClient(session);

    const result = await client.downloadHoSo('G12.18-260720-00263029', undefined, {
      isThueDienTu: false,
      maTkhai: '864'
    });

    expect(result.fileType).toBe('application/zip');
    expect(session.client.post).toHaveBeenCalledTimes(1);
    expect(postMock.mock.calls[0][0]).toContain('/tthc/tchs/downloadhoso');
    expect(postMock.mock.calls[0][1]).toEqual({ maHoSo: 'G12.18-260720-00263029' });
    expect(getMock).toHaveBeenCalledTimes(2);
    const validateUrl = new URL(String(getMock.mock.calls[1][0]));
    expect(validateUrl.pathname).toContain('/tthc/tchs/validateIdTkhai');
    expect(validateUrl.searchParams.get('idTKhai')).toBe('G12.18-260720-00263029');
    expect(getMock.mock.calls[1][1]).not.toHaveProperty('params');
  });

  it('tries alternate DVC IDs when the primary search ID has no downloadable detail action', async () => {
    const session = new PortalSession();
    const postMock = vi.fn().mockResolvedValueOnce({
      status: 200,
      data: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02]),
      headers: { 'content-type': 'application/zip' }
    });
    session.client.post = postMock;
    session.client.get = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        data: '<html><head><meta name="_csrf" content="token"/></head><body>Không tìm thấy hồ sơ</body></html>',
        headers: { 'content-type': 'text/html' }
      })
      .mockResolvedValueOnce({
        status: 200,
        data: detailHtml('G12.18-260720-00263029', false),
        headers: { 'content-type': 'text/html' }
      })
      .mockResolvedValueOnce({
        status: 200,
        data: '200',
        headers: { 'content-type': 'text/plain' }
      });

    const client = new TaxPortalClient(session);
    const result = await client.downloadHoSo(
      '000.701.18.G12-260720-27110000999999',
      undefined,
      { altIds: ['G12.18-260720-00263029'] }
    );

    expect(result.fileType).toBe('application/zip');
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock.mock.calls[0][1]).toEqual({ maHoSo: 'G12.18-260720-00263029' });
  });

  it('does not confuse attachment metadata with the main filing download contract', async () => {
    const session = new PortalSession();
    const xml = '<?xml version="1.0"?><HSoThueDTu><maTKhai>864</maTKhai></HSoThueDTu>';
    const postMock = vi.fn().mockResolvedValueOnce({
        status: 200,
        data: {
          content: Buffer.from(xml).toString('base64'),
          fileName: '05-KK-TNCN.xml',
          fileType: 'application/xml'
        },
        headers: { 'content-type': 'application/json' }
      });
    session.client.post = postMock;
    session.client.get = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        data: detailHtml(
          'G12.18-260720-00263029',
          false,
          undefined,
          '<button data-mahs="G12.18-260720-00263029" data-matep="FILE-XML-01" data-mst="3801157216"></button>'
        ),
        headers: { 'content-type': 'text/html' }
      })
      .mockResolvedValueOnce({
        status: 200,
        data: '200',
        headers: { 'content-type': 'text/plain' }
      });
    const client = new TaxPortalClient(session);

    const result = await client.downloadHoSo('G12.18-260720-00263029');

    expect(result.fileType).toBe('application/xml');
    expect(result.fileName).toBe('05-KK-TNCN.xml');
    expect(Buffer.from(result.content, 'base64').toString('utf8')).toContain('<maTKhai>864</maTKhai>');
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock.mock.calls[0][0]).toContain('/tthc/tchs/downloadhoso');
    expect(postMock.mock.calls[0][1]).toEqual({ maHoSo: 'G12.18-260720-00263029' });
  });

  it('retries the same TDT contract once on HTTP 500 and never switches to Standard', async () => {
    const session = new PortalSession();
    const serverError = Object.assign(new Error('HTTP 500'), {
      response: { status: 500, data: 'Internal Server Error', headers: {} }
    });
    const postMock = vi.fn().mockRejectedValue(serverError);
    session.client.post = postMock;
    session.client.get = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        data: detailHtml('TDT_FILING_ID', true, '1'),
        headers: { 'content-type': 'text/html' }
      })
      .mockResolvedValueOnce({
        status: 200,
        data: '200',
        headers: { 'content-type': 'text/plain' }
      });
    const client = new TaxPortalClient(session);

    await expect(client.downloadHoSo('TDT_FILING_ID')).rejects.toThrow();

    expect(postMock).toHaveBeenCalledTimes(2);
    expect(postMock.mock.calls.every(call => String(call[0]).includes('/tthc/tchs/downloadhoso-tdt?'))).toBe(true);
    expect(postMock.mock.calls.every(call => !String(call[0]).endsWith('/tthc/tchs/downloadhoso'))).toBe(true);
    expect(postMock.mock.calls.every(call => JSON.stringify(call[1]) === JSON.stringify({ maHoSo: 'TDT_FILING_ID' }))).toBe(true);
  });

  it('stops the eTax SSO chain after the first HTTP 429 without GET/POST fallback', async () => {
    const session = new PortalSession();
    session.setLoggedIn('3702735709');
    const rateLimitError = Object.assign(new Error('HTTP 429'), {
      response: { status: 429, data: 'Too Many Requests', headers: {} }
    });
    session.client.get = vi.fn().mockRejectedValue(rateLimitError);
    session.client.post = vi.fn();
    const client = new PaymentSlipClient(session);

    await expect(client.ensureEtaxSession()).rejects.toMatchObject({
      response: { status: 429 }
    });

    expect(session.client.get).toHaveBeenCalledTimes(1);
    expect(session.client.post).not.toHaveBeenCalled();
  });

  it('deduplicates simultaneous eTax session initialization into one request chain', async () => {
    const session = new PortalSession();
    session.setLoggedIn('3702735709');
    let rejectEntry!: (reason: unknown) => void;
    const pendingEntry = new Promise((_resolve, reject) => {
      rejectEntry = reject;
    });
    session.client.get = vi.fn().mockReturnValue(pendingEntry);
    session.client.post = vi.fn();
    const client = new PaymentSlipClient(session);

    const first = client.ensureEtaxSession();
    const second = client.ensureEtaxSession();
    const rateLimitError = Object.assign(new Error('HTTP 429'), {
      response: { status: 429, data: 'Too Many Requests', headers: {} }
    });
    rejectEntry(rateLimitError);

    await expect(first).rejects.toMatchObject({ response: { status: 429 } });
    await expect(second).rejects.toMatchObject({ response: { status: 429 } });
    expect(session.client.get).toHaveBeenCalledTimes(1);
    expect(session.client.post).not.toHaveBeenCalled();
  });

  it('fails closed before posting GNT detail when the dynamic DSE query state is incomplete', async () => {
    const session = new PortalSession();
    session.client.post = vi.fn();
    const client = new PaymentSlipClient(session);

    expect(client.setManualSessionState({
      sessionId: 'runtime-session',
      applicationId: '-1',
      operationName: 'corpQueryTaxProc',
      pageId: 'runtime-page',
      processorState: 'runtime-state'
      // processorId intentionally missing
    })).toBe(false);

    // Isolate the invariant under test: even if session establishment returns,
    // query/detail must validate every dynamic field before the HTTP request.
    vi.spyOn(client, 'ensureEtaxSession').mockResolvedValue();

    await expect(client.getPaymentSlipDetail('CTU_001')).rejects.toMatchObject({
      errorCode: 'ETAX_FORM_CHANGED'
    });
    expect(session.client.post).not.toHaveBeenCalled();
  });

  it('promotes a valid corpIndexProc state to the GNT query form from the backend', async () => {
    const session = new PortalSession();
    const client = new PaymentSlipClient(session);
    client.setManualSessionState({
      sessionId: 'runtime-session',
      applicationId: '-1',
      operationName: 'corpIndexProc',
      pageId: 'runtime-page',
      processorState: 'runtime-state',
      processorId: 'runtime-processor'
    });
    session.client.get = vi.fn().mockResolvedValue({
      status: 200,
      data: `
        <form action="/etaxnnt/Request">
          <input name="dse_sessionId" value="runtime-session" />
          <input name="dse_applicationId" value="-1" />
          <input name="dse_operationName" value="corpQueryTaxProc" />
          <input name="dse_pageId" value="query-page" />
          <input name="dse_processorState" value="query-state" />
          <input name="dse_processorId" value="query-processor" />
        </form>
      `,
      headers: { 'content-type': 'text/html' }
    });

    await expect(client.activateManualSessionForQuery()).resolves.toBe(true);
    expect(session.client.get).toHaveBeenCalledTimes(1);
    expect(session.client.get).toHaveBeenCalledWith(
      expect.stringContaining('toOpName=corpQueryTaxProc'),
      expect.any(Object)
    );
  });

  it('does not navigate from an incomplete manual eTax state', async () => {
    const session = new PortalSession();
    const client = new PaymentSlipClient(session);
    session.client.get = vi.fn();
    client.setManualSessionState({
      sessionId: 'runtime-session',
      operationName: 'corpIndexProc'
    });

    await expect(client.activateManualSessionForQuery()).resolves.toBe(false);
    expect(session.client.get).not.toHaveBeenCalled();
  });

  it('does not repeat a GNT query after an ambiguous transport failure', async () => {
    const session = new PortalSession();
    const client = new PaymentSlipClient(session);
    client.setManualSessionState({
      sessionId: 'runtime-session',
      applicationId: '-1',
      operationName: 'corpQueryTaxProc',
      pageId: 'runtime-page',
      processorState: 'runtime-state',
      processorId: 'runtime-processor'
    });
    const networkError = Object.assign(new Error('socket hang up'), {
      code: 'ECONNRESET',
      request: {}
    });
    session.client.post = vi.fn().mockRejectedValue(networkError);

    const result = await client.queryPaymentSlips({
      startDate: '01/01/2026',
      endDate: '31/12/2026'
    });

    expect(result).toMatchObject({
      success: false,
      errorCode: 'CONNECTIVITY_ERROR'
    });
    expect(session.client.post).toHaveBeenCalledTimes(1);
  });

  it('classifies plugin gate as interactive auth and sends no guessed navigation request', async () => {
    const session = new PortalSession();
    session.client.get = vi.fn();
    session.client.post = vi.fn();
    const client = new PaymentSlipClient(session);
    const retailGateHtml = `
      <form action="/etaxnnt/Request">
        <input name="dse_sessionId" value="runtime-session" />
        <input name="dse_applicationId" value="-1" />
        <input name="dse_operationName" value="corpPluginProc" />
        <input name="dse_processorState" value="runtime-state" />
        <input name="dse_processorId" value="runtime-processor" />
      </form>
      <div>Hệ thống đang thực hiện kiểm tra bản cập nhật</div>
    `;

    await expect(
      (client as any).followRedirectChain(
        retailGateHtml,
        'https://thuedientu.gdt.gov.vn/etaxnnt/Request',
        0
      )
    ).rejects.toMatchObject({ errorCode: 'AUTH_REQUIRED' });

    expect(session.client.get).not.toHaveBeenCalled();
    expect(session.client.post).not.toHaveBeenCalled();
  });

  it('does not restart the whole SSO chain when interactive GNT auth is required', async () => {
    const session = new PortalSession();
    const client = new PaymentSlipClient(session);
    const authRequired = Object.assign(
      new Error('eTax yêu cầu xác thực tương tác/plugin.'),
      { errorCode: 'AUTH_REQUIRED' }
    );
    const ensureSpy = vi.spyOn(client, 'ensureEtaxSession').mockRejectedValue(authRequired);

    const result = await client.queryPaymentSlips({
      startDate: '01/01/2025',
      endDate: '31/12/2025',
      page: 1
    });

    expect(result).toMatchObject({
      success: false,
      errorCode: 'AUTH_REQUIRED'
    });
    expect(ensureSpy).toHaveBeenCalledTimes(1);
  });
});

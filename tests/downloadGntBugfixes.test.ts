import AdmZip from 'adm-zip';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadManager } from '../src/main/downloader/DownloadManager';
import { FileOrganizer } from '../src/main/files/FileOrganizer';
import { ZipExtractor } from '../src/main/files/ZipExtractor';
import { PortalSession } from '../src/main/portal/PortalSession';
import { TaxPortalClient } from '../src/main/portal/TaxPortalClient';
import { DseFormStateParser } from '../src/main/portal/DseFormStateParser';
import { TaxFiling } from '../src/shared/types';

const makeFiling = (id: string): TaxFiling => ({
  id,
  title: `Tờ khai ${id}`,
  taxType: 'VAT',
  procedureCode: '1.007014',
  declarationCode: '01/GTGT',
  period: 'Tháng 01/2026',
  filingType: 'ORIGINAL',
  downloadAvailable: true
});

describe('BUGFIX #1 — ZipExtractor không lưu nhầm HTML lỗi thành .xml', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bugfix_zip_'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('HTML error page (Hết phiên làm việc) phải bị TỪ CHỐI thay vì lưu thành .xml', () => {
    const htmlPage = `<!DOCTYPE html><html><head><title>ERROR</title></head>
<body><h3>Hết phiên làm việc</h3><p>width:200px</p></body></html>`;
    const base64 = Buffer.from(htmlPage, 'utf8').toString('base64');

    expect(() =>
      ZipExtractor.extractBase64Zip(base64, tempDir, makeFiling('ID1'), '3702735709')
    ).toThrow();

    // Không được sinh ra bất kỳ file rác nào trong thư mục đích
    const leftovers = fs.readdirSync(tempDir);
    expect(leftovers.length).toBe(0);
  });

  it('Trang HTML dạng fragment (<div>...</div>) không có thẻ đóng gốc hợp lệ cũng bị từ chối', () => {
    const fragment = `<div class="error">Có lỗi xảy ra khi xử lý</div>`;
    const base64 = Buffer.from(fragment, 'utf8').toString('base64');
    expect(() =>
      ZipExtractor.extractBase64Zip(base64, tempDir, makeFiling('ID2'), '3702735709')
    ).toThrow();
  });

  it('XML hồ sơ thuế thật vẫn được lưu bình thường (không hồi quy)', () => {
    const rawXml = '<?xml version="1.0" encoding="UTF-8"?><HSoThue><TKhai><maTKhai>01/GTGT</maTKhai></TKhai></HSoThue>';
    const base64 = Buffer.from(rawXml, 'utf8').toString('base64');

    const result = ZipExtractor.extractBase64Zip(base64, tempDir, makeFiling('ID3'), '3702735709');
    expect(result.savedPaths.length).toBe(1);
    expect(result.xmlPath).toBeDefined();
    expect(fs.readFileSync(result.xmlPath!, 'utf-8')).toContain('01/GTGT');
  });

  it('ZIP hợp lệ vẫn giải nén bình thường (không hồi quy)', () => {
    const zip = new AdmZip();
    zip.addFile('files_01.xml', Buffer.from('<TKhai><data>ok</data></TKhai>', 'utf-8'));
    zip.addFile('files_01.pdf', Buffer.from('%PDF-1.4 mock', 'utf-8'));
    const base64 = zip.toBuffer().toString('base64');

    const result = ZipExtractor.extractBase64Zip(base64, tempDir, makeFiling('ID4'), '3702735709');
    expect(result.savedPaths.length).toBe(2);
    expect(result.xmlPath).toBeDefined();
    expect(result.pdfPath).toBeDefined();
  });
  it('Từ chối tệp Base64 rỗng hoặc giải mã ra Buffer 0 byte', () => {
    expect(() =>
      ZipExtractor.extractBase64Zip('', tempDir, makeFiling('ID_ZERO_1'), '3702735709')
    ).toThrow(/rỗng/i);

    expect(() =>
      ZipExtractor.extractBase64Zip('====', tempDir, makeFiling('ID_ZERO_2'), '3702735709')
    ).toThrow(/0 byte/i);
  });
  it('Từ chối tệp ZIP có entry XML 0 byte', () => {
    const zip = new AdmZip();
    zip.addFile('empty.xml', Buffer.alloc(0));
    const base64 = zip.toBuffer().toString('base64');

    expect(() =>
      ZipExtractor.extractBase64Zip(base64, tempDir, makeFiling('ID_ZERO_ENTRY'), '3702735709')
    ).toThrow(/0 byte/i);
  });

  it('FileOrganizer và FileManifest không ghi nhận file rỗng 0 byte', () => {
    const organizer = new FileOrganizer(tempDir);
    const manifest = organizer.getManifest('3702735709', 2026);

    const emptyFilePath = path.join(tempDir, 'empty.xml');
    fs.writeFileSync(emptyFilePath, Buffer.alloc(0));

    expect(() =>
      manifest.recordDownload({
        filingId: 'F_ZERO',
        filingType: 'ORIGINAL',
        savedPaths: [emptyFilePath],
        downloadedAt: new Date().toISOString()
      })
    ).toThrow();

    // File 0 byte không được coi là đã tải
    expect(manifest.isAlreadyDownloaded('F_ZERO').exists).toBe(false);
  });
});
describe('BUGFIX #6 — inline validateIdTkhai trong downloadHoSoSingle kiểm tra nghiêm ngặt status 200 và body "200" (integration qua downloadHoSo)', () => {
  const detailHtml = `
      <html>
        <head><meta name="_csrf" content="mock-token"/></head>
        <body>
          <button onclick="downloadHoSo(this)" data-mahoso="G12.18-260720-00263029" data-is-tdt="N"></button>
          <div data-tai-lieu-dkem="true"></div>
        </body>
      </html>
    `;
  const validXml = '<?xml version="1.0"?><HSoThue><TKhai>01/GTGT</TKhai></HSoThue>';
  const validBase64 = Buffer.from(validXml, 'utf8').toString('base64');

  const buildClient = (validateResponse: { status: number; data: any }) => {
    const session = new PortalSession();
    const client = new TaxPortalClient(session);
    session.client.get = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/files/detail/')) {
        return Promise.resolve({ status: 200, data: detailHtml, headers: { 'content-type': 'text/html' } });
      }
      if (url.includes('/validateIdTkhai')) {
        return Promise.resolve({ status: validateResponse.status, data: validateResponse.data, headers: { 'content-type': 'text/plain' } });
      }
      return Promise.resolve({ status: 404, data: '' });
    });
    session.client.post = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tchs/downloadhoso')) {
        const err: any = new Error('Request failed with status code 500');
        err.response = { status: 500, data: { error: 'Hồ sơ truyền lên không hợp lệ' }, headers: {} };
        return Promise.reject(err);
      }
      if (url.includes('/data-tai-lieu-dkem')) {
        return Promise.resolve({
          status: 200,
          data: [{ maHso: 'G12.18-260720-00263029', maTep: 'FILE_01', fileName: 'to_khai.xml', dinhDangTep: 'xml' }]
        });
      }
      if (url.includes('/download-tai-lieu-dkem')) {
        return Promise.resolve({ status: 200, data: { content: validBase64, fileName: 'to_khai.xml' } });
      }
      return Promise.resolve({ status: 404, data: '' });
    });
    return client;
  };

  it('happy: HTTP 200 và body "200" → download tiếp tục qua attachment fallback', async () => {
    const client = buildClient({ status: 200, data: '200' });
    const payload = await client.downloadHoSo('G12.18-260720-00263029');
    expect(payload).toBeDefined();
    expect(payload.content).toBe(validBase64);
  });

  it.each([['400'], ['500'], [''], ['false']])('body "%s" bị từ chối với FILING_VALIDATION_FAILED', async (body) => {
    const client = buildClient({ status: 200, data: body });
    await expect(client.downloadHoSo('G12.18-260720-00263029')).rejects.toMatchObject({ code: 'FILING_VALIDATION_FAILED' });
  });

  it('status 204 (2xx khác 200) dù body "200" vẫn bị từ chối — guard tường minh chặn', async () => {
    const client = buildClient({ status: 204, data: '200' });
    await expect(client.downloadHoSo('G12.18-260720-00263029')).rejects.toMatchObject({ code: 'FILING_VALIDATION_FAILED' });
  });
});
describe('BUGFIX #7 — downloadHoSoSingle fallback tệp đính kèm khi POST /downloadhoso 500', () => {
  it('tải tệp đính kèm khi /downloadhoso lỗi 500 và xác thực ownership', async () => {
    const session = new PortalSession();
    const client = new TaxPortalClient(session);

    const validXml = '<?xml version="1.0"?><HSoThue><TKhai>01/GTGT</TKhai></HSoThue>';
    const validBase64 = Buffer.from(validXml, 'utf8').toString('base64');

    const detailHtml = `
      <html>
        <head><meta name="_csrf" content="mock-token"/></head>
        <body>
          <button onclick="downloadHoSo(this)" data-mahoso="G12.18-260720-00263029" data-is-tdt="N"></button>
          <div data-tai-lieu-dkem="true"></div>
        </body>
      </html>
    `;

    session.client.get = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/files/detail/')) {
        return Promise.resolve({ status: 200, data: detailHtml, headers: { 'content-type': 'text/html' } });
      }
      if (url.includes('/validateIdTkhai')) {
        return Promise.resolve({ status: 200, data: '200', headers: { 'content-type': 'text/plain' } });
      }
      return Promise.resolve({ status: 404, data: '' });
    });

    session.client.post = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tchs/downloadhoso')) {
        const err: any = new Error('Request failed with status code 500');
        err.response = { status: 500, data: { error: 'Hồ sơ truyền lên không hợp lệ' }, headers: {} };
        return Promise.reject(err);
      }
      if (url.includes('/data-tai-lieu-dkem')) {
        return Promise.resolve({
          status: 200,
          data: [
            { maHso: 'G12.18-260720-00263029', maTep: 'FILE_01', fileName: 'to_khai.xml', dinhDangTep: 'xml' }
          ]
        });
      }
      if (url.includes('/download-tai-lieu-dkem')) {
        return Promise.resolve({
          status: 200,
          data: { content: validBase64, fileName: 'to_khai.xml' }
        });
      }
      return Promise.resolve({ status: 404, data: '' });
    });

    const payload = await client.downloadHoSo('G12.18-260720-00263029');
    expect(payload).toBeDefined();
    expect(payload.content).toBe(validBase64);
  });

  it('từ chối tệp đính kèm nếu maHso không khớp ownership của hồ sơ', async () => {
    const session = new PortalSession();
    const client = new TaxPortalClient(session);

    const detailHtml = `
      <html>
        <head><meta name="_csrf" content="mock-token"/></head>
        <body>
          <button onclick="downloadHoSo(this)" data-mahoso="G12.18-260720-00263029" data-is-tdt="N"></button>
          <div data-tai-lieu-dkem="true"></div>
        </body>
      </html>
    `;

    session.client.get = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/files/detail/')) {
        return Promise.resolve({ status: 200, data: detailHtml, headers: { 'content-type': 'text/html' } });
      }
      if (url.includes('/validateIdTkhai')) {
        return Promise.resolve({ status: 200, data: '200', headers: { 'content-type': 'text/plain' } });
      }
      return Promise.resolve({ status: 404, data: '' });
    });

    session.client.post = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/tchs/downloadhoso')) {
        const err: any = new Error('500');
        err.response = { status: 500, data: { error: 'Invalid' }, headers: {} };
        return Promise.reject(err);
      }
      if (url.includes('/data-tai-lieu-dkem')) {
        return Promise.resolve({
          status: 200,
          data: [
            { maHso: 'OTHER_DIFFERENT_FILING_ID', maTep: 'FILE_02', fileName: 'wrong.xml', dinhDangTep: 'xml' }
          ]
        });
      }
      return Promise.resolve({ status: 404, data: '' });
    });

    await expect(client.downloadHoSo('G12.18-260720-00263029')).rejects.toThrow();
  });
});

describe('BUGFIX #2 — DownloadManager start lại sau cancel phải hoàn thành được', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bugfix_dm_'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('cancel() rồi start() lại: item CANCELLED được hồi phục → emit completed', async () => {
    const xmlPayload = Buffer.from('<?xml version="1.0"?><HSoThue><TKhai/></HSoThue>', 'utf-8').toString('base64');
    const fakeClient = {
      checkSession: async () => true,
      downloadHoSo: async () => ({ fileName: 'f.zip', fileType: 'application/zip', content: xmlPayload })
    } as unknown as TaxPortalClient;

    const dm = new DownloadManager(fakeClient, new FileOrganizer(tempDir));
    dm.setContext('3702735709', 2026);
    dm.enqueueFilings([makeFiling('A'), makeFiling('B')], '3702735709', 2026);

    dm.cancel();
    expect(dm.getSummary().isCancelled).toBe(true);
    expect(dm.getState()).toBe('CANCELLED');

    await dm.start();

    // Chờ hàng đợi chạy xong (tối đa ~4s)
    await vi.waitFor(
      () => {
        if (dm.getState() !== 'COMPLETED') throw new Error(`state=${dm.getState()}`);
      },
      { timeout: 4000, interval: 50 }
    );

    const summary = dm.getSummary();
    expect(summary.state).toBe('COMPLETED');
    expect(summary.completed + summary.existing).toBe(2);
    expect(summary.remaining).toBe(0);
  });
  it('passes maTkhai and alternate IDs required by the real GDT filing row', async () => {
    const xmlPayload = Buffer.from('<?xml version="1.0"?><HSoThue><TKhai/></HSoThue>', 'utf-8').toString('base64');
    let receivedMeta: unknown;
    const fakeClient = {
      checkSession: async () => true,
      downloadHoSo: async (_id: string, _signal: AbortSignal | undefined, meta: unknown) => {
        receivedMeta = meta;
        return { fileName: 'f.zip', fileType: 'application/zip', content: xmlPayload };
      }
    } as unknown as TaxPortalClient;

    const filing = {
      ...makeFiling('G12.18-260720-00118136'),
      taxType: 'PIT' as const,
      declarationCode: '05/KK-TNCN',
      maTkhai: '864',
      altIds: ['864']
    };
    const dm = new DownloadManager(fakeClient, new FileOrganizer(tempDir));
    dm.enqueueFilings([filing], '3702735709', 2026);
    await dm.start();
    await vi.waitFor(() => {
      if (dm.getState() !== 'COMPLETED') throw new Error(`state=${dm.getState()}`);
    }, { timeout: 4000, interval: 50 });

    expect(receivedMeta).toEqual({
      isThueDienTu: undefined,
      loaiTraCuu: undefined,
      maTkhai: '864',
      altIds: ['864'],
      period: 'Tháng 01/2026',
      declarationCode: '05/KK-TNCN'
    });
  });
});

describe('BUGFIX #5 — Điều khiển tải trong lúc pre-flight đang chờ', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bugfix_dm_preflight_'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it('bấm tạm dừng trong lúc checkSession chờ thì không tự chạy lại', async () => {
    let releaseCheck: (() => void) | undefined;
    const checkPromise = new Promise<boolean>(resolve => {
      releaseCheck = () => resolve(true);
    });
    const fakeClient = {
      checkSession: () => checkPromise,
      downloadHoSo: vi.fn()
    } as unknown as TaxPortalClient;
    const dm = new DownloadManager(fakeClient, new FileOrganizer(tempDir));
    dm.enqueueFilings([makeFiling('PAUSE')], '3702735709', 2026);

    const startPromise = dm.start();
    dm.pause();
    releaseCheck!();
    await startPromise;

    expect(dm.getState()).toBe('PAUSED');
    expect(dm.getSummary().pending).toBe(1);
    expect(fakeClient.downloadHoSo).not.toHaveBeenCalled();
  });

  it('bấm dừng trong lúc checkSession chờ thì giữ trạng thái đã dừng', async () => {
    let releaseCheck: (() => void) | undefined;
    const checkPromise = new Promise<boolean>(resolve => {
      releaseCheck = () => resolve(true);
    });
    const fakeClient = {
      checkSession: () => checkPromise,
      downloadHoSo: vi.fn()
    } as unknown as TaxPortalClient;
    const dm = new DownloadManager(fakeClient, new FileOrganizer(tempDir));
    dm.enqueueFilings([makeFiling('CANCEL')], '3702735709', 2026);

    const startPromise = dm.start();
    dm.cancel();
    releaseCheck!();
    await startPromise;

    expect(dm.getState()).toBe('CANCELLED');
    expect(dm.getSummary().isCancelled).toBe(true);
    expect(dm.getSummary().remaining).toBe(1);
    expect(fakeClient.downloadHoSo).not.toHaveBeenCalled();
  });
});

describe('BUGFIX #4 — login không false-positive trên trang lỗi HTML chứa "home"', () => {
  it('HTTP 200 + HTML lỗi chứa link /tthc/home phải trả success=false', async () => {
    const session = new PortalSession();
    const client = new TaxPortalClient(session);

    const fakeErrorPage = `<!DOCTYPE html><html><head>
      <style>.box{width:200px;height:200px}</style></head>
      <body><a href="/tthc/home">Trang chủ</a>
      <div class="error">Mật khẩu không đúng</div></body></html>`;

    vi.spyOn(session.client, 'get').mockResolvedValue({
      status: 200,
      data: '<html><body><a onclick="dangXuat()">Đăng xuất</a><div>tchs</div></body></html>'
    } as any);
    const postSpy = vi
      .spyOn(session.client, 'post')
      .mockResolvedValue({ status: 200, data: fakeErrorPage } as any);

    const res = await client.login('3702735709', 'wrongpass', '1234');

    expect(res.success).toBe(false);
    expect(res.errorField).toBe('PASSWORD');
    expect(postSpy).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();
  });

  it('Response XML <status>200</status> vẫn đăng nhập thành công (không hồi quy)', async () => {
    const session = new PortalSession();
    const client = new TaxPortalClient(session);

    vi.spyOn(session.client, 'get').mockResolvedValue({
      status: 200,
      data: '<html><body><a onclick="dangXuat()">Đăng xuất</a><div>tchs</div></body></html>'
    } as any);
    vi.spyOn(session.client, 'post').mockResolvedValue({
      status: 200,
      data: '<response><status>200</status><desc>OK</desc></response>'
    } as any);

    const res = await client.login('3702735709', 'pass', '1234');
    expect(res.success).toBe(true);

    vi.restoreAllMocks();
  });

  it('Response có marker thành công nhưng không tạo được session thật phải bị từ chối', async () => {
    const session = new PortalSession();
    const client = new TaxPortalClient(session);

    vi.spyOn(session.client, 'get').mockResolvedValue({
      status: 200,
      data: '<html><body><form><input name="tenDN"><input name="matKhau"></form></body></html>'
    } as any);
    vi.spyOn(session.client, 'post').mockResolvedValue({
      status: 200,
      data: '<response><status>200</status><desc>OK</desc></response>'
    } as any);

    const res = await client.login('3702735709', 'pass', '1234');

    expect(res).toMatchObject({ success: false, errorField: 'SESSION' });
    expect(session.getSessionInfo().isLoggedIn).toBe(false);
    vi.restoreAllMocks();
  });
});

describe('BUGFIX #8 — DseFormStateParser hỗ trợ trích xuất thuộc tính không có nháy (unquoted)', () => {
  it('trích xuất đúng dse_sessionId và dse_applicationId khi value không có dấu nháy', () => {

    const html = '<form><input type=hidden name=dse_sessionId value=SESSION12345><input type=hidden name=dse_applicationId value=-1><input name=dse_operationName value=corpQueryTaxProc></form>';
    const st = DseFormStateParser.extractDseFormState(html);
    expect(st.sessionId).toBe('SESSION12345');
    expect(st.applicationId).toBe('-1');
    expect(st.operationName).toBe('corpQueryTaxProc');
    expect(st.hiddenFields?.dse_applicationId).toBe('-1');
  });
});

describe('BUGFIX #9 — verifyXmlPayloadIdentity hỗ trợ MST 13 số chi nhánh và kỳ tính thuế Quý', () => {
  it('chấp nhận XML chứa MST 13 số có dấu gạch ngang (0101234567-001)', async () => {
    const session = new PortalSession();
    const client = new TaxPortalClient(session);
    const xml = '<?xml version="1.0"?><HSoThue><TKhai><mst>0101234567-001</mst><kyKKhai>01/2026</kyKKhai><maTKhai>01/GTGT</maTKhai></TKhai></HSoThue>';
    const base64 = Buffer.from(xml, 'utf8').toString('base64');

    const detailHtml = `
      <html>
        <head><meta name="_csrf" content="token"/></head>
        <body>
          <button onclick="downloadHoSo(this)" data-mahoso="G12.18-260720-00263029" data-is-tdt="N"></button>
        </body>
      </html>
    `;

    session.client.get = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/files/detail/')) return Promise.resolve({ status: 200, data: detailHtml, headers: { 'content-type': 'text/html' } });
      if (url.includes('/validateIdTkhai')) return Promise.resolve({ status: 200, data: '200', headers: { 'content-type': 'text/plain' } });
      return Promise.resolve({ status: 404, data: '' });
    });
    session.client.post = vi.fn().mockResolvedValue({
      status: 200,
      data: { content: base64, fileName: '01-GTGT.xml' },
      headers: { 'content-type': 'application/json' }
    });

    const payload = await client.downloadHoSo('G12.18-260720-00263029', undefined, {
      period: 'Tháng 01/2026',
      declarationCode: '01/GTGT'
    });
    expect(payload).toBeDefined();
    expect(payload.content).toBe(base64);
  });

  it('chấp nhận XML tờ khai Quý (Quý 1/2026) với định dạng Q1/2026 trong XML', async () => {
    const session = new PortalSession();
    const client = new TaxPortalClient(session);
    const xml = '<?xml version="1.0"?><HSoThue><TKhai><mst>3702735709</mst><kyKKhai>Q1/2026</kyKKhai><maTKhai>01/GTGT</maTKhai></TKhai></HSoThue>';
    const base64 = Buffer.from(xml, 'utf8').toString('base64');

    const detailHtml = `
      <html>
        <head><meta name="_csrf" content="token"/></head>
        <body>
          <button onclick="downloadHoSo(this)" data-mahoso="G12.18-260720-00263029" data-is-tdt="N"></button>
        </body>
      </html>
    `;

    session.client.get = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/files/detail/')) return Promise.resolve({ status: 200, data: detailHtml, headers: { 'content-type': 'text/html' } });
      if (url.includes('/validateIdTkhai')) return Promise.resolve({ status: 200, data: '200', headers: { 'content-type': 'text/plain' } });
      return Promise.resolve({ status: 404, data: '' });
    });
    session.client.post = vi.fn().mockResolvedValue({
      status: 200,
      data: { content: base64, fileName: '01-GTGT.xml' },
      headers: { 'content-type': 'application/json' }
    });

    const payload = await client.downloadHoSo('G12.18-260720-00263029', undefined, {
      period: 'Quý 1/2026',
      declarationCode: '01/GTGT'
    });
    expect(payload).toBeDefined();
    expect(payload.content).toBe(base64);
  });
});

describe('BUGFIX #10 — ipcHandlers executeJavaScript không chứa cú pháp TypeScript làm lỗi V8', () => {
  it('chuỗi executeJavaScript trong ipcHandlers không chứa "as HTMLInputElement"', () => {
    const ipcHandlersSource = fs.readFileSync(path.resolve(__dirname, '../src/main/ipc/ipcHandlers.ts'), 'utf-8');
    const executeJsMatch = ipcHandlersSource.match(/executeJavaScript\(`([\s\S]*?)`\)/g);
    expect(executeJsMatch).toBeDefined();
    for (const snippet of executeJsMatch || []) {
      expect(snippet).not.toContain('as HTMLInputElement');
      expect(snippet).not.toContain('as HTMLMetaElement');
    }
  });
});

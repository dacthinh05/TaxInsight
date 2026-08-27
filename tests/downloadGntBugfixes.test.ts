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
      altIds: ['864']
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

    vi.spyOn(session.client, 'get').mockResolvedValue({ status: 200, data: '' } as any);
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

    vi.spyOn(session.client, 'get').mockResolvedValue({ status: 200, data: '' } as any);
    vi.spyOn(session.client, 'post').mockResolvedValue({
      status: 200,
      data: '<response><status>200</status><desc>OK</desc></response>'
    } as any);

    const res = await client.login('3702735709', 'pass', '1234');
    expect(res.success).toBe(true);

    vi.restoreAllMocks();
  });
});

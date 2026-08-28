import { describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { HistoricalCheckpointStore } from '../src/main/persistence/HistoricalCheckpointStore';
import { FileOrganizer } from '../src/main/files/FileOrganizer';
import { LegacyFilingLookupWorkflow } from '../src/main/scanner/LegacyFilingLookupWorkflow';
import { LegacyFilingClient } from '../src/main/portal/LegacyFilingClient';
import { PortalSession } from '../src/main/portal/PortalSession';
import { TaxFiling } from '../src/shared/types';
import { ZipExtractor } from '../src/main/files/ZipExtractor';
import { LegacyFilingDownloader } from '../src/main/downloader/LegacyFilingDownloader';

describe('Legacy Filing: Downloader, Checkpoint & Workflow Suite', () => {
  const tempDir = path.join(os.tmpdir(), `taxrecord_legacy_test_${Date.now()}`);

  it('1. HistoricalCheckpointStore lưu, đọc và xóa checkpoint an toàn không chứa token', () => {
    const store = new HistoricalCheckpointStore(tempDir);
    const taxCode = '3702735709';

    store.saveCheckpoint({
      taxpayerId: taxCode,
      yearFrom: 2020,
      yearTo: 2023,
      currentYear: 2022,
      currentPage: 3,
      discoveredMessageIds: ['11320220168134306', '11320220160829999'],
      downloadedMessageIds: ['11320220168134306'],
      failedMessageIds: [],
      status: 'IN_PROGRESS',
      updatedAt: new Date().toISOString()
    });

    const loaded = store.loadCheckpoint(taxCode, 2020, 2023);
    expect(loaded).toBeDefined();
    expect(loaded?.taxpayerId).toBe(taxCode);
    expect(loaded?.currentYear).toBe(2022);
    expect(loaded?.currentPage).toBe(3);
    expect(loaded?.discoveredMessageIds).toHaveLength(2);
    expect(loaded?.downloadedMessageIds).toHaveLength(1);

    store.clearCheckpoint(taxCode, 2020, 2023);
    const afterClear = store.loadCheckpoint(taxCode, 2020, 2023);
    expect(afterClear).toBeNull();
  });

  it('2. ZipExtractor phân biệt chính xác XML thật vs HTML giả dạng XML', () => {
    const realXml = `<?xml version="1.0" encoding="UTF-8"?><HSoThueDTu><TTinChung><maTKhai>01/GTGT</maTKhai></TTinChung></HSoThueDTu>`;
    const htmlFakeXml = `<!DOCTYPE html><html><body><h1>Hết phiên làm việc</h1></body></html>`;
    const fragmentHtml = `<div><p>Vui lòng đăng nhập lại</p></div>`;

    const filing: TaxFiling = {
      id: '11320220160829999',
      declarationCode: '01/GTGT',
      title: '01/GTGT - Tờ khai thuế GTGT',
      taxType: 'VAT',
      period: 'Q3/2022',
      filingType: 'ORIGINAL',
      downloadAvailable: true
    };

    const destDir = path.join(tempDir, 'extracted_xml');
    const b64Real = Buffer.from(realXml).toString('base64');
    const resultReal = ZipExtractor.extractBase64Zip(b64Real, destDir, filing, '3702735709');

    expect(resultReal.savedPaths).toHaveLength(1);
    expect(resultReal.xmlPath).toBeDefined();
    expect(fs.existsSync(resultReal.xmlPath!)).toBe(true);

    const b64FakeHtml = Buffer.from(htmlFakeXml).toString('base64');
    expect(() => ZipExtractor.extractBase64Zip(b64FakeHtml, destDir, filing, '3702735709')).toThrow();

    const b64Fragment = Buffer.from(fragmentHtml).toString('base64');
    expect(() => ZipExtractor.extractBase64Zip(b64Fragment, destDir, filing, '3702735709')).toThrow();
  });

  it('3. LegacyFilingLookupWorkflow state machine điều phối quét đa năm tuần tự và deduplicate', async () => {
    const session = new PortalSession();
    const client = new LegacyFilingClient(session);
    const checkpointStore = new HistoricalCheckpointStore(tempDir);
    const fileOrganizer = new FileOrganizer(tempDir);

    // Mock queryFilings
    vi.spyOn(client, 'ensureEtaxSession').mockResolvedValue();
    vi.spyOn(client, 'queryFilings').mockImplementation(async (year, opts) => {
      const page = opts?.page || 1;
      if (year === 2021) {
        return {
          filings: [
            {
              id: `msg_2021_p${page}_1`,
              declarationCode: '01/GTGT',
              title: '01/GTGT - Tờ khai thuế GTGT',
              taxType: 'VAT',
              period: `Q4/${year}`,
              periodNormalized: { year: 2021, type: 'QUARTER', quarter: 4 },
              filingType: 'ORIGINAL',
              downloadAvailable: true,
              source: 'dvc-etax-html'
            }
          ],
          historicalRecords: [
            {
              source: 'dvc-etax-html',
              messageId: `msg_2021_p${page}_1`,
              formName: '01/GTGT',
              taxPeriodRaw: 'Q4/2021',
              downloadAvailable: true,
              noticeAvailable: false
            }
          ],
          pagination: {
            currentPage: page,
            totalPages: 2,
            totalRecords: 2,
            hasNextPage: page < 2,
            nextPageNumber: page < 2 ? page + 1 : undefined
          },
          isEmpty: false,
          isFormChanged: false
        };
      } else {
        return {
          filings: [
            {
              id: `msg_2022_1`,
              declarationCode: '03/TNDN',
              title: '03/TNDN - Tờ khai quyết toán thuế TNDN',
              taxType: 'CIT',
              period: `${year}`,
              periodNormalized: { year: 2022, type: 'YEAR' },
              filingType: 'FINALIZATION',
              downloadAvailable: true,
              source: 'dvc-etax-html'
            }
          ],
          historicalRecords: [
            {
              source: 'dvc-etax-html',
              messageId: `msg_2022_1`,
              formName: '03/TNDN',
              taxPeriodRaw: '2022',
              downloadAvailable: true,
              noticeAvailable: false
            }
          ],
          pagination: {
            currentPage: 1,
            totalPages: 1,
            totalRecords: 1,
            hasNextPage: false
          },
          isEmpty: false,
          isFormChanged: false
        };
      }
    });

    const workflow = new LegacyFilingLookupWorkflow(client, checkpointStore, fileOrganizer);
    const progressEvents: any[] = [];
    workflow.on('progress', p => progressEvents.push(p));

    const res = await workflow.executeLookup({
      taxpayerId: '3702735709',
      yearFrom: 2021,
      yearTo: 2022,
      maTKhai: '00'
    });

    expect(workflow.getState()).toBe('COMPLETED');
    expect(res.filings).toHaveLength(3); // 2 từ 2021 (2 trang) + 1 từ 2022 (1 trang)
    expect(progressEvents.length).toBeGreaterThan(0);
    expect(progressEvents[progressEvents.length - 1].status).toBe('COMPLETED');
  });

  it('4. LegacyFilingLookupWorkflow xử lý hủy (cancel) tức thì và dừng tiến trình', async () => {
    const session = new PortalSession();
    const client = new LegacyFilingClient(session);
    const checkpointStore = new HistoricalCheckpointStore(tempDir);
    const fileOrganizer = new FileOrganizer(tempDir);

    vi.spyOn(client, 'ensureEtaxSession').mockResolvedValue();
    vi.spyOn(client, 'queryFilings').mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 50));
      return {
        filings: [],
        historicalRecords: [],
        pagination: { currentPage: 1, totalPages: 10, totalRecords: 100, hasNextPage: true },
        isEmpty: false,
        isFormChanged: false
      };
    });

    const workflow = new LegacyFilingLookupWorkflow(client, checkpointStore, fileOrganizer);

    const scanPromise = workflow.executeLookup({
      taxpayerId: '3702735709',
      yearFrom: 2018,
      yearTo: 2024
    });

    // Cancel ngay sau 10ms
    setTimeout(() => workflow.cancel(), 10);
    await scanPromise;

    expect(workflow.getState()).toBe('CANCELLED');
  });

  it('5. Downloader dừng toàn bộ batch ngay ở HTTP 429 đầu tiên', async () => {
    const session = new PortalSession();
    const client = new LegacyFilingClient(session);
    const fileOrganizer = new FileOrganizer(tempDir);
    const downloader = new LegacyFilingDownloader(client, fileOrganizer);
    vi.spyOn(client, 'ensureEtaxSession').mockResolvedValue();
    const downloadSpy = vi.spyOn(client, 'downloadFiling').mockRejectedValue(
      Object.assign(new Error('Too Many Requests'), {
        code: 'RATE_LIMIT',
        response: { status: 429 }
      })
    );
    const filings: TaxFiling[] = ['msg-1', 'msg-2'].map(id => ({
      id,
      messageId: id,
      source: 'dvc-etax-html',
      title: '01/GTGT - Tờ khai GTGT',
      taxType: 'VAT',
      period: 'Q1/2022',
      periodNormalized: { year: 2022, type: 'QUARTER', quarter: 1 },
      filingType: 'ORIGINAL',
      downloadAvailable: true
    }));
    downloader.setContext('3702735709', 2022);
    downloader.enqueueFilings(filings);

    const paused = new Promise<void>(resolve => downloader.once('rate_limited', () => resolve()));
    await downloader.start();
    await paused;

    expect(downloadSpy).toHaveBeenCalledTimes(1);
    expect(downloader.getState()).toBe('PAUSED');
    expect(downloader.getSummary().pending).toBe(2);
  });

  it('6. Downloader ngắt mạch sau hai lỗi HTTP 500 liên tiếp', async () => {
    const session = new PortalSession();
    const client = new LegacyFilingClient(session);
    const downloader = new LegacyFilingDownloader(client, new FileOrganizer(tempDir));
    vi.spyOn(client, 'ensureEtaxSession').mockResolvedValue();
    const downloadSpy = vi.spyOn(client, 'downloadFiling').mockRejectedValue(
      Object.assign(new Error('Internal Server Error'), {
        code: 'SERVER_ERROR',
        response: { status: 500 }
      })
    );
    const filings: TaxFiling[] = ['msg-a', 'msg-b', 'msg-c'].map(id => ({
      id,
      messageId: id,
      source: 'dvc-etax-html',
      title: '01/GTGT - Tờ khai GTGT',
      taxType: 'VAT',
      period: 'Q1/2022',
      periodNormalized: { year: 2022, type: 'QUARTER', quarter: 1 },
      filingType: 'ORIGINAL',
      downloadAvailable: true
    }));
    downloader.setContext('3702735709', 2022);
    downloader.enqueueFilings(filings);

    const stopped = new Promise<void>(resolve => downloader.once('server_unavailable', () => resolve()));
    await downloader.start();
    await stopped;

    expect(downloadSpy).toHaveBeenCalledTimes(2);
    expect(downloader.getState()).toBe('PAUSED');
    expect(downloader.getSummary().failed).toBe(1);
    expect(downloader.getSummary().pending).toBe(2);
  });
});

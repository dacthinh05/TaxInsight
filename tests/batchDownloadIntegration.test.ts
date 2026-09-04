/**
 * BATCH DOWNLOAD INTEGRATION TEST
 * Kiểm tra tải hàng loạt toàn diện:
 *  1. Tải 20 tờ khai (mix EXISTING + PENDING)
 *  2. Kiểm tra invariant tổng: total = completed + existing + failed + downloading + pending
 *  3. Tải đa năm — multi-year queue switch
 *  4. Pause giữa chừng → resume → hoàn tất
 *  5. Hủy giữa batch lớn → item còn lại là CANCELLED
 *  6. Batch mới hoàn toàn thay thế batch cũ (không cộng dồn)
 *  7. Đồng thời: 2 worker không race condition với cùng filingId
 *  8. EXISTING items không được gọi downloadHoSo
 *  9. COMPLETED → EXISTING khi file đã có (idempotent)
 * 10. Tải cả tờ khai GTGT + TNCN + TNDN trong cùng batch
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DownloadManager } from '../src/main/downloader/DownloadManager';
import { FileOrganizer } from '../src/main/files/FileOrganizer';
import { LegacyFilingClient } from '../src/main/portal/LegacyFilingClient';
import { PortalSession } from '../src/main/portal/PortalSession';
import { TaxPortalClient } from '../src/main/portal/TaxPortalClient';
import { TaxFiling } from '../src/shared/types';

// ── Helper tạo tờ khai giả ─────────────────────────────────────────────────
const makeFiling = (
  id: string,
  opts: Partial<TaxFiling> = {}
): TaxFiling => ({
  id,
  title: `Tờ khai ${id}`,
  taxType: 'VAT',
  declarationCode: '01/GTGT',
  period: 'Tháng 01/2026',
  filingType: 'ORIGINAL',
  downloadAvailable: true,
  ...opts
});

// Payload XML giả hợp lệ (direct base64 XML, không ZIP)
const FAKE_XML_BASE64 = Buffer.from(
  '<?xml version="1.0" encoding="UTF-8"?><HSoThueDTu><TTinChung><maTKhai>01/GTGT</maTKhai></TTinChung></HSoThueDTu>',
  'utf-8'
).toString('base64');

// ── Helper tạo mock client ──────────────────────────────────────────────────
function makeClient(opts: {
  isAlive?: boolean;
  delayMs?: number;
  failIds?: string[];
  rateLimitIds?: string[];
}) {
  const session = new PortalSession();
  const client = new TaxPortalClient(session);

  client.checkSession = vi.fn().mockResolvedValue(opts.isAlive ?? true);
  client.downloadHoSo = vi.fn().mockImplementation(async (id: string) => {
    if (opts.rateLimitIds?.includes(id)) {
      const err = Object.assign(new Error('Too Many Requests'), { code: 'RATE_LIMIT', httpStatus: 429 });
      throw err;
    }
    if (opts.failIds?.includes(id)) {
      const err = Object.assign(new Error('Download failed: Hồ sơ truyền lên không hợp lệ'), {
        code: 'SERVER_ERROR',
        httpStatus: 500,
        attempts: [{ label: 'STD', status: 500, ms: 10, head: 'Download failed: id to khai khong hop le' }]
      });
      throw err;
    }
    if (opts.delayMs) {
      await new Promise(r => setTimeout(r, opts.delayMs));
    }
    return { fileName: `${id}.xml`, fileType: 'text/xml', content: FAKE_XML_BASE64 };
  });

  return client;
}

function makeOrganizer(tempDir: string, existingIds: string[] = []) {
  const org = new FileOrganizer(tempDir);
  org.checkPreDownloadStatus = vi.fn().mockImplementation((_tc: string, filing: TaxFiling) => ({
    isAlreadyDownloaded: existingIds.includes(filing.id),
    savedPaths: existingIds.includes(filing.id) ? [path.join(tempDir, `${filing.id}.xml`)] : []
  }));
  org.saveExtractedFiling = vi.fn().mockImplementation((_content: string, filing: TaxFiling) => ({
    isExisting: false,
    savedPaths: [path.join(tempDir, `${filing.id}.xml`)],
    xmlPath: path.join(tempDir, `${filing.id}.xml`),
    pdfPath: undefined
  }));
  return org;
}

// ── Chờ cho manager đến trạng thái mong đợi ─────────────────────────────────
async function waitForState(
  manager: DownloadManager,
  states: string[],
  timeoutMs = 5000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!states.includes(manager.getState()) && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 30));
  }
  if (!states.includes(manager.getState())) {
    throw new Error(`Timeout: state vẫn là "${manager.getState()}", mong đợi ${states.join('|')}`);
  }
}

// ────────────────────────────────────────────────────────────────────────────
describe('Batch Download Integration — Tải Hàng Loạt Toàn Diện', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch_dl_'));
  });

  afterEach(() => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  // ── 1. Tải 20 tờ khai thành công ─────────────────────────────────────────
  it('1. Tải hàng loạt 20 tờ khai → tất cả COMPLETED, invariant đúng', async () => {
    const filings = Array.from({ length: 20 }, (_, i) => makeFiling(`F${String(i + 1).padStart(2, '0')}`));
    const client = makeClient({});
    const organizer = makeOrganizer(tempDir);
    const dm = new DownloadManager(client, organizer);

    dm.enqueueFilings(filings, '3702735709', 2026);

    const completedPromise = new Promise<void>(resolve => dm.once('completed', resolve));
    await dm.start();
    await completedPromise;

    const s = dm.getSummary();
    expect(s.state).toBe('COMPLETED');
    expect(s.total).toBe(20);
    expect(s.completed).toBe(20);
    expect(s.failed).toBe(0);
    expect(s.pending).toBe(0);
    expect(s.remaining).toBe(0);
    // Invariant: total = completed + existing + failed + downloading + pending
    expect(s.total).toBe(s.completed + s.existing + s.failed + s.downloading + s.pending);
  });

  // ── 2. Mix EXISTING + PENDING ─────────────────────────────────────────────
  it('2. Mix EXISTING + PENDING: 8 đã có sẵn, 12 cần tải → không gọi API cho EXISTING', async () => {
    const allIds = Array.from({ length: 20 }, (_, i) => `MX${String(i + 1).padStart(2, '0')}`);
    const existingIds = allIds.slice(0, 8); // MX01..MX08 đã có
    const filings = allIds.map(id => makeFiling(id));

    const client = makeClient({});
    const organizer = makeOrganizer(tempDir, existingIds);
    const dm = new DownloadManager(client, organizer);

    dm.enqueueFilings(filings, '3702735709', 2026);

    const completedPromise = new Promise<void>(resolve => dm.once('completed', resolve));
    await dm.start();
    await completedPromise;

    const s = dm.getSummary();
    expect(s.state).toBe('COMPLETED');
    expect(s.total).toBe(20);
    expect(s.existing).toBe(8);
    expect(s.completed).toBe(12);
    expect(s.failed).toBe(0);
    // API chỉ được gọi cho 12 PENDING
    expect(vi.mocked(client.downloadHoSo).mock.calls.length).toBe(12);
    // Invariant
    expect(s.total).toBe(s.completed + s.existing + s.failed + s.downloading + s.pending);
  });

  // ── 3. Pause giữa batch → resume → hoàn tất ──────────────────────────────
  it('3. Pause giữa chừng → resume → batch hoàn tất đúng', async () => {
    let releaseCount = 0;
    let pendingReleasers: Array<() => void> = [];
    const client = makeClient({});
    // Giữ từng request lại cho đến khi được release
    client.downloadHoSo = vi.fn().mockImplementation(async () => {
      await new Promise<void>(resolve => pendingReleasers.push(resolve));
      releaseCount++;
      return { fileName: 'f.xml', fileType: 'text/xml', content: FAKE_XML_BASE64 };
    });

    const filings = Array.from({ length: 5 }, (_, i) => makeFiling(`PR${i + 1}`));
    const organizer = makeOrganizer(tempDir);
    const dm = new DownloadManager(client, organizer);
    dm.enqueueFilings(filings, '3702735709', 2026);

    const startedPromise = new Promise<void>(resolve => dm.once('started', resolve));
    dm.start();
    await startedPromise;

    // Chờ ít nhất 1 worker bắt đầu
    await new Promise(r => setTimeout(r, 150));
    dm.pause();

    // Release worker đang chờ (nếu có) - chúng sẽ bị abort do pause
    const releasesCopy = [...pendingReleasers];
    pendingReleasers = [];
    releasesCopy.forEach(r => r());

    await waitForState(dm, ['PAUSED']);
    expect(dm.getState()).toBe('PAUSED');
    const sPaused = dm.getSummary();
    expect(sPaused.total).toBe(5);
    // Invariant khi đang paused
    expect(sPaused.total).toBe(sPaused.completed + sPaused.existing + sPaused.failed + sPaused.downloading + sPaused.pending);

    // Resume: release tất cả các request còn lại
    client.downloadHoSo = vi.fn().mockResolvedValue({
      fileName: 'f.xml', fileType: 'text/xml', content: FAKE_XML_BASE64
    });
    const completedPromise = new Promise<void>(resolve => dm.once('completed', resolve));
    await dm.resume();
    await completedPromise;

    const sFinal = dm.getSummary();
    expect(sFinal.state).toBe('COMPLETED');
    expect(sFinal.remaining).toBe(0);
    expect(sFinal.total).toBe(sFinal.completed + sFinal.existing + sFinal.failed + sFinal.downloading + sFinal.pending);
  });

  // ── 4. Hủy giữa batch lớn ────────────────────────────────────────────────
  it('4. Cancel giữa batch 10 tờ khai → state CANCELLED, remaining items là CANCELLED', async () => {
    // Mỗi request mất 200ms — đủ lâu để cancel trước khi xong
    const client = makeClient({ delayMs: 200 });
    const organizer = makeOrganizer(tempDir);
    const dm = new DownloadManager(client, organizer);

    const filings = Array.from({ length: 10 }, (_, i) => makeFiling(`CC${i + 1}`));
    dm.enqueueFilings(filings, '3702735709', 2026);

    dm.start();
    // Chờ ít nhất 1 worker bắt đầu rồi cancel
    await new Promise(r => setTimeout(r, 100));
    dm.cancel();

    await waitForState(dm, ['CANCELLED']);

    const s = dm.getSummary();
    expect(s.state).toBe('CANCELLED');
    expect(s.isCancelled).toBe(true);
    expect(s.downloading).toBe(0);
    // Invariant: chỉ COMPLETED + EXISTING + FAILED + CANCELLED (mapped to pending=0 trong cancelled state)
    // Tổng của tất cả trạng thái phải bằng total
    const queue = dm.getQueue();
    const cancelledCount = queue.filter(q => q.status === 'CANCELLED').length;
    const completedCount = queue.filter(q => q.status === 'COMPLETED' || q.status === 'EXISTING').length;
    expect(cancelledCount + completedCount).toBe(10);
  });

  // ── 5. Batch mới thay thế batch cũ hoàn toàn ────────────────────────────
  it('5. enqueueFilings lần 2 thay thế hoàn toàn lần 1 — tổng đúng 3, không sống sót từ lô cũ', async () => {
    const client = makeClient({});
    const organizer = makeOrganizer(tempDir);
    const dm = new DownloadManager(client, organizer);

    // Lô cũ 10 hồ sơ
    const oldBatch = Array.from({ length: 10 }, (_, i) => makeFiling(`OLD${i + 1}`));
    dm.enqueueFilings(oldBatch, '3702735709', 2026);
    expect(dm.getSummary().total).toBe(10);

    // Lô mới 3 hồ sơ — phải thay thế hoàn toàn
    const newBatch = [makeFiling('NEW1'), makeFiling('NEW2'), makeFiling('NEW3')];
    dm.enqueueFilings(newBatch, '3702735709', 2026);

    const s = dm.getSummary();
    expect(s.total).toBe(3);
    expect(s.pending).toBe(3);

    const queueIds = dm.getQueue().map(q => q.filingId);
    expect(queueIds).toEqual(['NEW1', 'NEW2', 'NEW3']);
    // Không có ID nào của lô cũ còn sót lại
    expect(queueIds.some(id => id.startsWith('OLD'))).toBe(false);
  });

  // ── 6. Multi-year: đổi năm giữa 2 lô tải ────────────────────────────────
  it('6. Multi-year: setContext đổi năm giữa 2 lô → context lưu đúng cho từng lô', () => {
    const client = makeClient({});
    const organizer = makeOrganizer(tempDir);
    const dm = new DownloadManager(client, organizer);

    // Lô năm 2024
    const batch2024 = [makeFiling('Y24_01', { period: 'Tháng 01/2024' })];
    dm.enqueueFilings(batch2024, '3702735709', 2024);
    expect(dm.getContext()).toEqual({ taxCode: '3702735709', year: 2024 });

    // Lô năm 2025
    const batch2025 = [makeFiling('Y25_01', { period: 'Tháng 01/2025' })];
    dm.enqueueFilings(batch2025, '3702735709', 2025);
    expect(dm.getContext()).toEqual({ taxCode: '3702735709', year: 2025 });

    // Queue chỉ có lô mới nhất
    expect(dm.getSummary().total).toBe(1);
    expect(dm.getQueue()[0].filingId).toBe('Y25_01');
  });

  // ── 7. Mix nhiều loại thuế trong cùng batch ───────────────────────────────
  it('7. Batch gồm GTGT + TNCN + TNDN → tất cả được tải, đúng taxType truyền qua', async () => {
    const mixed = [
      makeFiling('VAT_01', { taxType: 'VAT', declarationCode: '01/GTGT' }),
      makeFiling('PIT_01', { taxType: 'PIT', declarationCode: '05/KK-TNCN' }),
      makeFiling('PIT_02', { taxType: 'PIT', declarationCode: '05/QTT-TNCN' }),
      makeFiling('CIT_01', { taxType: 'CIT', declarationCode: '03/TNDN' }),
      makeFiling('VAT_02', { taxType: 'VAT', declarationCode: '01/GTGT', filingType: 'SUPPLEMENTAL', supplementalNo: 1 })
    ];

    const client = makeClient({});
    const organizer = makeOrganizer(tempDir);
    const dm = new DownloadManager(client, organizer);

    dm.enqueueFilings(mixed, '3702735709', 2026);
    const completedPromise = new Promise<void>(resolve => dm.once('completed', resolve));
    await dm.start();
    await completedPromise;

    const s = dm.getSummary();
    expect(s.state).toBe('COMPLETED');
    expect(s.total).toBe(5);
    expect(s.completed).toBe(5);
    expect(vi.mocked(client.downloadHoSo).mock.calls.length).toBe(5);
  });

  // ── 8. Record-specific failure không cộng vào circuit breaker batch ───────
  it('8. Lỗi "id tkhai không hợp lệ" cho 1 hồ sơ không kích hoạt circuit breaker — các hồ sơ còn lại vẫn tải tiếp', async () => {
    // ID không có zero-padding: makeFiling(`RF${i+1}`) → 'RF1'..'RF5'
    const filings = Array.from({ length: 5 }, (_, i) => makeFiling(`RF${i + 1}`));
    // RF2 (không phải RF02) sẽ bị lỗi record-specific
    const client = makeClient({ failIds: ['RF2'] });
    const organizer = makeOrganizer(tempDir);
    const dm = new DownloadManager(client, organizer);

    dm.enqueueFilings(filings, '3702735709', 2026);
    const completedPromise = new Promise<void>(resolve => dm.once('completed', resolve));
    await dm.start();
    await completedPromise;

    const s = dm.getSummary();
    expect(s.state).toBe('COMPLETED');
    expect(s.completed).toBe(4);   // RF1, RF3, RF4, RF5
    expect(s.failed).toBe(1);      // RF2
    expect(s.pending).toBe(0);     // Không còn item chờ
    // Circuit breaker không kích hoạt → batch tiếp tục đến hết, state COMPLETED
    expect(s.total).toBe(s.completed + s.existing + s.failed + s.downloading + s.pending);
  });

  // ── 9. HTTP 429 dừng batch ngay ở request đầu tiên ───────────────────────
  it('9. HTTP 429 trên hồ sơ đầu tiên → PAUSED ngay, không gọi API cho hồ sơ còn lại', async () => {
    const filings = Array.from({ length: 5 }, (_, i) => makeFiling(`RL${i + 1}`));
    const client = makeClient({ rateLimitIds: ['RL1'] });
    const organizer = makeOrganizer(tempDir);
    const dm = new DownloadManager(client, organizer);

    dm.enqueueFilings(filings, '3702735709', 2026);
    await dm.start();
    await waitForState(dm, ['PAUSED']);

    expect(dm.getState()).toBe('PAUSED');
    // Tất cả item vẫn là PENDING (sẽ retry khi resume)
    expect(dm.getSummary().pending).toBe(5);
    // Chỉ ≤ 2 lần gọi API (tối đa concurrency=1 nên 1 lần)
    expect(vi.mocked(client.downloadHoSo).mock.calls.length).toBeLessThanOrEqual(2);
  });

  // ── 10. Invariant sau mỗi sự kiện progress ───────────────────────────────
  it('10. Invariant total=completed+existing+failed+downloading+pending đúng ở MỌI thời điểm', async () => {
    const filings = Array.from({ length: 8 }, (_, i) => makeFiling(`INV${i + 1}`));
    const client = makeClient({ delayMs: 30 });
    const organizer = makeOrganizer(tempDir, ['INV1', 'INV3']); // 2 EXISTING
    const dm = new DownloadManager(client, organizer);

    const violations: string[] = [];
    dm.on('progress', ({ summary: s }) => {
      const sum = s.completed + s.existing + s.failed + s.downloading + s.pending;
      if (sum !== s.total) {
        violations.push(`progress: total=${s.total} ≠ sum=${sum} (state=${s.state})`);
      }
    });

    dm.enqueueFilings(filings, '3702735709', 2026);
    const completedPromise = new Promise<void>(resolve => dm.once('completed', resolve));
    await dm.start();
    await completedPromise;

    expect(violations).toHaveLength(0);

    const s = dm.getSummary();
    expect(s.existing).toBe(2);
    expect(s.completed).toBe(6);
    expect(s.total).toBe(s.completed + s.existing + s.failed + s.downloading + s.pending);
  });

  // ── 11. Fallback sang eTax khi gói file từ DVC bị lỗi giải nén ZIP ────────
  it('11. Khi Cổng DVC trả file ZIP hỏng/không giải nén được → tự động fallback sang eTax và lưu file thành công', async () => {
    const filing = makeFiling('GTGT_CORRUPTED_DVC');
    const session = new PortalSession();
    const client = new TaxPortalClient(session);
    client.checkSession = vi.fn().mockResolvedValue(true);

    // DVC trả về payload có base64 là dữ liệu ZIP hỏng (không thể giải nén)
    client.downloadHoSo = vi.fn().mockResolvedValue({
      fileName: 'corrupted.zip',
      fileType: 'application/zip',
      content: Buffer.from([0x50, 0x4b, 0x99, 0x99, 0x00, 0x00]).toString('base64')
    });

    // Legacy Client (eTax) có sẵn tệp XML chuẩn
    const legacyClient = new LegacyFilingClient(session);
    legacyClient.resolveAndDownloadFiling = vi.fn().mockResolvedValue({
      fileName: '01_GTGT_eTax.xml',
      contentType: 'application/xml',
      dataBuffer: Buffer.from('<?xml version="1.0"?><HSoThueDTu><TKhai>01/GTGT</TKhai></HSoThueDTu>', 'utf8')
    });

    const organizer = new FileOrganizer(tempDir);
    const dm = new DownloadManager(client, organizer, legacyClient);

    dm.enqueueFilings([filing], '3702735709', 2026);
    const completedPromise = new Promise<void>(resolve => dm.once('completed', resolve));
    await dm.start();
    await completedPromise;

    expect(legacyClient.resolveAndDownloadFiling).toHaveBeenCalledTimes(1);
    const s = dm.getSummary();
    expect(s.completed).toBe(1);
    expect(s.failed).toBe(0);
  });

  // ── 12. HTTP 429 kích hoạt rate_limited event và tự động phục hồi (auto-resume) ──
  it('12. HTTP 429 kích hoạt rate_limited event và tự động phục hồi (auto-resume)', async () => {
    const filing = makeFiling('RL_AUTO');
    let attempts = 0;
    const client = {
      checkSession: vi.fn().mockResolvedValue(true),
      downloadHoSo: vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          const err = new Error('Rate limit 429');
          (err as any).code = 'RATE_LIMIT';
          (err as any).httpStatus = 429;
          throw err;
        }
        return {
          fileName: 'ok.zip',
          fileType: 'application/zip',
          content: FAKE_XML_BASE64,
          fileCount: 1
        };
      })
    } as unknown as TaxPortalClient;

    const organizer = new FileOrganizer(tempDir);
    const dm = new DownloadManager(client, organizer);
    dm.enqueueFilings([filing], '3702735709', 2026);

    let rateLimitedReceived = false;
    dm.once('rate_limited', data => {
      rateLimitedReceived = true;
      expect(data.cooldownMs).toBeDefined();
      expect(data.resumeAt).toBeGreaterThan(Date.now() - 100);
    });

    const completedPromise = new Promise<void>(resolve => dm.once('completed', resolve));
    await dm.start();
    await completedPromise;

    expect(rateLimitedReceived).toBe(true);
    expect(attempts).toBe(2);
    expect(dm.getSummary().completed).toBe(1);
    expect(dm.getSummary().failed).toBe(0);
  });

  // ── 13. Pre-check trong worker bỏ qua gọi mạng nếu file đã tồn tại trên đĩa ──
  it('13. Pre-check trong worker bỏ qua gọi mạng nếu file đã tồn tại trên đĩa', async () => {
    const filing = makeFiling('DISK_EXISTING');
    const client = {
      checkSession: vi.fn().mockResolvedValue(true),
      downloadHoSo: vi.fn().mockResolvedValue({
        fileName: 'dummy.zip',
        fileType: 'application/zip',
        content: FAKE_XML_BASE64,
        fileCount: 1
      })
    } as unknown as TaxPortalClient;

    const organizer = makeOrganizer(tempDir, ['DISK_EXISTING']);
    const dm = new DownloadManager(client, organizer);

    dm.enqueueFilings([filing], '3702735709', 2026);
    await dm.start();

    expect(client.downloadHoSo).not.toHaveBeenCalled();
    expect(dm.getSummary().existing).toBe(1);
    expect(dm.getSummary().completed).toBe(0);
  });

  // ── 14. DVC timeout/abort signal -> eTax fallback nhận signal mới hợp lệ ──
  it('14. DVC timeout/abort signal -> eTax fallback nhận signal mới hợp lệ', async () => {
    const filing = makeFiling('FALLBACK_SIGNAL_TEST');
    const session = new PortalSession();
    const client = new TaxPortalClient(session);
    client.checkSession = vi.fn().mockResolvedValue(true);

    client.downloadHoSo = vi.fn().mockImplementation(async (_id, signal) => {
      // Giả lập DVC timeout: signal bị abort
      const err = new Error('Timeout DVC');
      Object.assign(err, { code: 'TIMEOUT' });
      throw err;
    });

    const legacyClient = new LegacyFilingClient(session);
    let receivedSignalAborted: boolean | undefined;
    legacyClient.resolveAndDownloadFiling = vi.fn().mockImplementation(async (_tc, _f, signal) => {
      receivedSignalAborted = signal?.aborted;
      return {
        fileName: '01_GTGT_eTax.xml',
        contentType: 'application/xml',
        dataBuffer: Buffer.from('<?xml version="1.0"?><HSoThueDTu><TKhai>01/GTGT</TKhai></HSoThueDTu>', 'utf8')
      };
    });

    const organizer = new FileOrganizer(tempDir);
    const dm = new DownloadManager(client, organizer, legacyClient);

    dm.enqueueFilings([filing], '3702735709', 2026);
    const completedPromise = new Promise<void>(resolve => dm.once('completed', () => resolve()));
    await dm.start();
    await completedPromise;

    expect(legacyClient.resolveAndDownloadFiling).toHaveBeenCalledTimes(1);
    expect(receivedSignalAborted).toBe(false);
    expect(dm.getSummary().completed).toBe(1);
  });
});

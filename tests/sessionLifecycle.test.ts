import { describe, expect, it, vi } from 'vitest';
import { DownloadManager } from '../src/main/downloader/DownloadManager';
import { FileOrganizer } from '../src/main/files/FileOrganizer';
import { PortalSession } from '../src/main/portal/PortalSession';
import { TaxPortalClient } from '../src/main/portal/TaxPortalClient';
import { TaxFiling } from '../src/shared/types';

describe('HOTFIX — Session Lifecycle & Download Queue Invariants', () => {
  const createMockClient = (options: { isAlive: boolean; failOnIds?: string[] }) => {
    const session = new PortalSession();
    const client = new TaxPortalClient(session);

    client.checkSession = vi.fn().mockResolvedValue(options.isAlive);
    client.validateIdTkhai = vi.fn().mockResolvedValue(true);
    client.downloadHoSo = vi.fn().mockImplementation(async (id: string) => {
      if (options.failOnIds?.includes(id)) {
        const err = new Error('Session Expired');
        (err as any).code = 'SESSION_EXPIRED';
        throw err;
      }
      return {
        fileName: `file_${id}.zip`,
        fileType: 'application/zip',
        content: 'UEsDBBQAAAAIAA==' // Fake Base64 ZIP
      };
    });

    return client;
  };

  const createMockOrganizer = () => {
    const org = new FileOrganizer('./test_out');
    org.checkPreDownloadStatus = vi.fn().mockReturnValue({ isAlreadyDownloaded: false });
    org.saveExtractedFiling = vi.fn().mockReturnValue({ isExisting: false, savedPaths: ['a.xml'] });
    return org;
  };

  const sampleFilings: TaxFiling[] = [
    { id: 'F01', title: '01/GTGT T1', taxType: 'VAT', filingType: 'ORIGINAL', downloadAvailable: true },
    { id: 'F02', title: '01/GTGT T2', taxType: 'VAT', filingType: 'ORIGINAL', downloadAvailable: true },
    { id: 'F03', title: '01/GTGT T3', taxType: 'VAT', filingType: 'ORIGINAL', downloadAvailable: true },
    { id: 'F04', title: '01/GTGT T4', taxType: 'VAT', filingType: 'ORIGINAL', downloadAvailable: true },
    { id: 'F05', title: '01/GTGT T5', taxType: 'VAT', filingType: 'ORIGINAL', downloadAvailable: true }
  ];

  it('1. session expired trước download -> zero workers start, state AUTH_REQUIRED', async () => {
    const client = createMockClient({ isAlive: false });
    const organizer = createMockOrganizer();
    const manager = new DownloadManager(client, organizer);

    manager.enqueueFilings(sampleFilings, '3702735709', 2025);

    let expiredFired = false;
    manager.on('session_expired', () => {
      expiredFired = true;
    });

    await manager.start();

    const summary = manager.getSummary();
    expect(expiredFired).toBe(true);
    expect(summary.state).toBe('AUTH_REQUIRED');
    expect(summary.downloading).toBe(0);
    expect(summary.completed).toBe(0);
    expect(summary.pending).toBe(5);
    expect(summary.total).toBe(5);

    // Invariant: total === completed + existing + failed + downloading + pending
    expect(summary.total).toBe(summary.completed + summary.existing + summary.failed + summary.downloading + summary.pending);
  });

  it('2. session expires giữa chừng -> all workers aborted, queue paused once, items preserved in PENDING', async () => {
    // Các active workers đều gặp SESSION_EXPIRED
    const client = createMockClient({ isAlive: true, failOnIds: ['F01', 'F02', 'F03', 'F04', 'F05'] });
    const organizer = createMockOrganizer();
    const manager = new DownloadManager(client, organizer);

    manager.enqueueFilings(sampleFilings, '3702735709', 2025);

    let expiredCount = 0;
    manager.on('session_expired', () => {
      expiredCount++;
    });

    await manager.start();

    // Chờ workers dừng
    await new Promise(r => setTimeout(r, 400));

    const summary = manager.getSummary();
    expect(expiredCount).toBe(1); // Chỉ bắn sự kiện 1 lần duy nhất
    expect(summary.state).toBe('PAUSED_AUTH_REQUIRED');
    expect(summary.downloading).toBe(0);
    expect(summary.failed).toBe(0); // Không đánh dấu pending items thành failed
    expect(summary.pending).toBe(5); // F01 và các item khác trả về PENDING

    // Invariant
    expect(summary.total).toBe(summary.completed + summary.existing + summary.failed + summary.downloading + summary.pending);
  });

  it('3. 3 workers cùng gặp expired -> chỉ emit session_expired 1 lần', async () => {
    const client = createMockClient({ isAlive: true, failOnIds: ['F01', 'F02', 'F03'] });
    const organizer = createMockOrganizer();
    const manager = new DownloadManager(client, organizer);

    manager.enqueueFilings(sampleFilings, '3702735709', 2025);

    let expiredEvents = 0;
    manager.on('session_expired', () => {
      expiredEvents++;
    });

    await manager.start();
    await new Promise(r => setTimeout(r, 400));

    expect(expiredEvents).toBe(1);
    expect(manager.getState()).toBe('PAUSED_AUTH_REQUIRED');
  });

  it('4. login lại -> resume pending, completed files không tải lại, counter invariant luôn đúng', async () => {
    let isLive = false;
    const client = createMockClient({ isAlive: true });
    // Ban đầu giả sử session chết
    client.checkSession = vi.fn().mockImplementation(async () => isLive);
    client.downloadHoSo = vi.fn().mockResolvedValue({
      fileName: 'f.zip',
      fileType: 'application/zip',
      content: 'UEsDBBQAAAAIAA=='
    });

    const organizer = createMockOrganizer();
    const manager = new DownloadManager(client, organizer);

    manager.enqueueFilings(sampleFilings.slice(0, 3), '3702735709', 2025);

    // Bắt đầu khi session chết -> AUTH_REQUIRED
    await manager.start();
    expect(manager.getState()).toBe('AUTH_REQUIRED');
    expect(manager.getSummary().pending).toBe(3);

    // Người dùng đăng nhập lại thành công
    isLive = true;
    await manager.resume();

    // Đợi tải hoàn tất
    await new Promise(r => setTimeout(r, 600));

    const summary = manager.getSummary();
    expect(summary.completed).toBe(3);
    expect(summary.pending).toBe(0);
    expect(summary.failed).toBe(0);
    expect(client.validateIdTkhai).toHaveBeenCalled();
    expect(summary.state).toBe('COMPLETED');

    // Invariant
    expect(summary.total).toBe(summary.completed + summary.existing + summary.failed + summary.downloading + summary.pending);
  });

  it('5. cancel khi auth modal mở -> queue cancelled và active = 0', async () => {
    const client = createMockClient({ isAlive: false });
    const organizer = createMockOrganizer();
    const manager = new DownloadManager(client, organizer);

    manager.enqueueFilings(sampleFilings, '3702735709', 2025);
    await manager.start();

    expect(manager.getState()).toBe('AUTH_REQUIRED');

    manager.cancel();
    expect(manager.getState()).toBe('CANCELLED');

    const summary = manager.getSummary();
    expect(summary.isCancelled).toBe(true);
    expect(summary.downloading).toBe(0);
  });

  it('6. clearQueue abort worker cũ và không để worker cũ làm bẩn batch mới', async () => {
    let releaseDownload!: () => void;
    let capturedSignal: AbortSignal | undefined;
    const client = createMockClient({ isAlive: true });
    client.downloadHoSo = vi.fn().mockImplementation(async (_id: string, signal?: AbortSignal) => {
      capturedSignal = signal;
      await new Promise<void>(resolve => { releaseDownload = resolve; });
      return {
        fileName: 'stale.zip',
        fileType: 'application/zip',
        content: 'UEsDBBQAAAAIAA=='
      };
    });
    const organizer = createMockOrganizer();
    const manager = new DownloadManager(client, organizer);

    manager.enqueueFilings([sampleFilings[0]], '3702735709', 2025);
    await manager.start();
    await new Promise(r => setTimeout(r, 250));

    manager.clearQueue();
    expect(capturedSignal?.aborted).toBe(true);
    expect(manager.getSummary().total).toBe(0);

    releaseDownload();
    await new Promise(r => setTimeout(r, 100));
    expect(manager.getSummary().total).toBe(0);
    expect(organizer.saveExtractedFiling).not.toHaveBeenCalled();
  });
});

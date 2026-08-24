import { EventEmitter } from 'events';
import { PORTAL_CONFIG } from '../../shared/constants';
import { DownloadQueueItem, DownloadState, DownloadSummary, TaxFiling } from '../../shared/types';
import { FileOrganizer } from '../files/FileOrganizer';
import { TaxPortalClient } from '../portal/TaxPortalClient';

export class DownloadManager extends EventEmitter {
  private client: TaxPortalClient;
  private fileOrganizer: FileOrganizer;
  private queue: DownloadQueueItem[] = [];
  private activeDownloads = 0;
  private maxConcurrency = PORTAL_CONFIG.DOWNLOAD_CONCURRENCY; // 2
  private abortController: AbortController | null = null;
  private isPaused = false;
  private isCancelled = false;
  private state: DownloadState = 'IDLE';
  private hasEmittedAuthExpired = false;
  private taxCode = '';
  private year = new Date().getFullYear();

  constructor(client: TaxPortalClient, fileOrganizer: FileOrganizer) {
    super();
    this.client = client;
    this.fileOrganizer = fileOrganizer;
  }

  public setContext(taxCode: string, year: number) {
    this.taxCode = taxCode;
    this.year = year;
  }

  /** Nguồn sự thật cho (taxCode, year) hiện tại của đợt tải — dùng cho checkpoint */
  public getContext(): { taxCode: string; year: number } {
    return { taxCode: this.taxCode, year: this.year };
  }

  public getState(): DownloadState {
    return this.state;
  }

  /**
   * Tính toán Download Summary đảm bảo Invariant:
   * total === completed + existing + failed + downloading + pending
   */
  public getSummary(): DownloadSummary {
    let completed = 0;
    let existing = 0;
    let failed = 0;
    let downloading = 0;
    let pending = 0;

    for (const item of this.queue) {
      if (item.status === 'COMPLETED') completed++;
      else if (item.status === 'EXISTING') existing++;
      else if (item.status === 'FAILED') failed++;
      else if (item.status === 'DOWNLOADING') downloading++;
      else if (item.status === 'PENDING') pending++;
    }

    const total = this.queue.length;
    const remaining = total - completed - existing - failed;

    return {
      total,
      completed,
      existing,
      failed,
      downloading,
      pending,
      remaining: Math.max(0, remaining),
      isPaused: this.isPaused,
      isCancelled: this.isCancelled,
      isRunning: this.activeDownloads > 0,
      state: this.state
    };
  }

  public getQueue(): DownloadQueueItem[] {
    return [...this.queue];
  }

  public clearQueue() {
    this.queue = [];
    this.activeDownloads = 0;
    this.isPaused = false;
    this.isCancelled = false;
    this.state = 'IDLE';
    this.hasEmittedAuthExpired = false;
  }

  /**
   * Thêm danh sách hồ sơ vào hàng đợi tải
   */
  public enqueueFilings(filings: TaxFiling[], taxCode?: string, year?: number) {
    if (taxCode) this.taxCode = taxCode;
    if (year) this.year = year;

    for (const filing of filings) {
      const existingItem = this.queue.find(q => q.filingId === filing.id);
      if (!existingItem) {
        // 🎯 TẦNG 1: LOGICAL MANIFEST PRE-CHECK
        const preCheck = this.fileOrganizer.checkPreDownloadStatus(this.taxCode, filing, this.year);

        if (preCheck.isAlreadyDownloaded) {
          filing.downloadStatus = 'EXISTING';
          this.queue.push({
            filingId: filing.id,
            filing,
            status: 'EXISTING',
            retries: 0,
            progressPercent: 100,
            savedPaths: preCheck.savedPaths
          });
        } else {
          this.queue.push({
            filingId: filing.id,
            filing,
            status: 'PENDING',
            retries: 0,
            progressPercent: 0
          });
        }
      } else {
        // Hồ sơ đã có trong hàng đợi nhưng cần tải lại / thử lại (FAILED, CANCELLED, hoặc re-download)
        existingItem.status = 'PENDING';
        existingItem.retries = 0;
        existingItem.progressPercent = 0;
        existingItem.error = undefined;
        filing.downloadStatus = 'PENDING';
        filing.downloadError = undefined;
        existingItem.filing = filing;
      }
    }
  }

  /**
   * 1. SESSION PRE-FLIGHT TRƯỚC KHI DOWNLOAD
   * Nếu session invalid -> KHÔNG start queue, KHÔNG tạo worker, set state AUTH_REQUIRED
   */
  public async start(): Promise<void> {
    if (this.activeDownloads > 0 || this.state === 'RUNNING') {
      this.processQueue();
      return;
    }

    this.isPaused = false;
    this.isCancelled = false;
    this.hasEmittedAuthExpired = false;

    // Đợt trước đã bị HỦY mà người dùng bấm tải lại: các item CANCELLED phải
    // được hồi phục về PENDING. Nếu không, hàng đợi không còn item nào chạy được
    // nhưng remaining > 0 → state kẹt RUNNING vĩnh viễn, không bao giờ emit
    // 'completed' và UI treo ở màn hình tiến trình.
    const hasRunnableItem = this.queue.some(q => q.status === 'PENDING' || q.status === 'DOWNLOADING');
    if (!hasRunnableItem && this.queue.some(q => q.status === 'CANCELLED')) {
      for (const q of this.queue) {
        if (q.status === 'CANCELLED') {
          q.status = 'PENDING';
          q.retries = 0;
          q.progressPercent = 0;
          q.error = undefined;
          q.filing.downloadStatus = 'PENDING';
        }
      }
    }

    // PRE-FLIGHT HEALTH CHECK
    const isSessionAlive = await this.client.checkSession();
    if (!isSessionAlive) {
      this.state = 'AUTH_REQUIRED';
      this.isPaused = true;
      this.activeDownloads = 0;
      this.emit('session_expired');
      this.emitProgress();
      return;
    }

    this.state = 'RUNNING';
    if (!this.abortController || this.abortController.signal.aborted) {
      this.abortController = new AbortController();
    }

    this.emit('started', this.getSummary());
    this.emitProgress();
    this.processQueue();
  }

  /**
   * 3. RESUME DOWNLOAD SAU KHI ĐĂNG NHẬP LẠI
   */
  public async resume(): Promise<void> {
    this.hasEmittedAuthExpired = false;

    // Kiểm tra lại phiên mới
    const isSessionAlive = await this.client.checkSession();
    if (!isSessionAlive) {
      this.state = 'AUTH_REQUIRED';
      this.isPaused = true;
      this.emit('session_expired');
      return;
    }

    this.isPaused = false;
    this.isCancelled = false;
    this.state = 'RUNNING';
    if (!this.abortController || this.abortController.signal.aborted) {
      this.abortController = new AbortController();
    }

    this.emit('resumed', this.getSummary());
    this.emitProgress();
    this.processQueue();
  }

  public pause() {
    this.isPaused = true;
    this.state = 'PAUSED';
    if (this.abortController) {
      this.abortController.abort();
    }
    // Trả các item đang tải dở về lại PENDING
    for (const item of this.queue) {
      if (item.status === 'DOWNLOADING') {
        item.status = 'PENDING';
      }
    }
    this.activeDownloads = 0;
    this.emit('paused', this.getSummary());
  }

  public cancel() {
    this.isCancelled = true;
    this.isPaused = false;
    this.state = 'CANCELLED';

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    for (const item of this.queue) {
      if (item.status === 'PENDING' || item.status === 'DOWNLOADING') {
        item.status = 'CANCELLED';
      }
    }

    this.activeDownloads = 0;
    this.emit('cancelled', this.getSummary());
  }

  private async processQueue() {
    if (this.isPaused || this.isCancelled || this.state !== 'RUNNING') return;

    while (this.activeDownloads < this.maxConcurrency && !this.isPaused && !this.isCancelled && this.state === 'RUNNING') {
      const nextItem = this.queue.find(item => item.status === 'PENDING');
      if (!nextItem) break;

      this.activeDownloads++;
      this.downloadItemWithWorker(nextItem).finally(() => {
        this.activeDownloads = Math.max(0, this.activeDownloads - 1);
        if (this.state === 'RUNNING' && !this.isPaused && !this.isCancelled) {
          this.processQueue();
        }
      });
    }

    if (this.activeDownloads === 0 && this.state === 'RUNNING') {
      const summary = this.getSummary();
      if (summary.remaining === 0) {
        this.state = 'COMPLETED';
        this.emit('completed', summary);
      }
    }
  }

  /**
   * 2. XỬ LÝ WORKER TẢI VÀ SESSION EXPIRED GIỮA DOWNLOAD
   */
  private async downloadItemWithWorker(item: DownloadQueueItem): Promise<void> {
    if (item.status === 'EXISTING' || this.isPaused || this.isCancelled) {
      return;
    }

    item.status = 'DOWNLOADING';
    this.emitProgress(item);

    // Jitter nhẹ tránh xung đột đồng thời giữa các workers
    await new Promise(r => setTimeout(r, 50 + Math.random() * 100));

    if (this.isPaused || this.isCancelled) {
      if (item.status === 'DOWNLOADING') item.status = 'PENDING';
      return;
    }

    try {
      // 2. Tải Base64 ZIP — tự động route sang /downloadhoso-tdt nếu isThueDienTu=true
      const payload = await this.client.downloadHoSo(
        item.filingId,
        this.abortController?.signal,
        {
          isThueDienTu: item.filing.isThueDienTu,
          loaiTraCuu: item.filing.loaiTraCuu
        }
      );

      // 3. Tầng 2: Giải nén an toàn & kiểm tra integrity SHA-256
      const saveResult = this.fileOrganizer.saveExtractedFiling(
        payload.content,
        item.filing,
        this.taxCode,
        this.year
      );

      item.status = saveResult.isExisting ? 'EXISTING' : 'COMPLETED';
      item.progressPercent = 100;
      item.savedPaths = saveResult.savedPaths;
      item.filing.downloadStatus = saveResult.isExisting ? 'EXISTING' : 'COMPLETED';
      item.filing.downloadedFiles = {
        xml: saveResult.xmlPath,
        pdf: saveResult.pdfPath,
        other: saveResult.savedPaths.filter(p => p !== saveResult.xmlPath && p !== saveResult.pdfPath)
      };

      this.emit('item_completed', { item, saveResult });
      this.emitProgress(item);
    } catch (err: any) {
      // Hủy thật sự bởi người dùng (download:cancel)
      if (this.isCancelled) {
        item.status = 'CANCELLED';
        item.error = 'Đã hủy';
        return;
      }

      // Lỗi CANCELLED phát sinh khi AbortController bị hủy do PAUSE hoặc SESSION_EXPIRED.
      // Item đã được pause()/worker session-expired trả về PENDING — KHÔNG ĐƯỢC đánh dấu
      // CANCELLED ở đây (trước đây item bị kẹt trạng thái CANCELLED và mất khỏi resume).
      if (err.code === 'CANCELLED') {
        if (item.status === 'DOWNLOADING') {
          item.status = 'PENDING';
          item.progressPercent = 0;
        }
        this.emitProgress(item);
        return;
      }

      // XỬ LÝ KHI PHÁT HIỆN SESSION EXPIRED
      if (err.code === 'SESSION_EXPIRED') {
        // Trả item hiện tại về PENDING để retry sau khi đăng nhập lại
        item.status = 'PENDING';
        item.progressPercent = 0;

        // Dừng toàn bộ workers khác
        if (this.abortController) {
          this.abortController.abort();
        }

        // Đưa tất cả item DOWNLOADING về PENDING
        for (const q of this.queue) {
          if (q.status === 'DOWNLOADING') {
            q.status = 'PENDING';
          }
        }

        this.isPaused = true;
        this.state = 'PAUSED_AUTH_REQUIRED';
        this.activeDownloads = 0;

        // Chỉ bắn sự kiện expired 1 lần duy nhất cho toàn bộ batch
        if (!this.hasEmittedAuthExpired) {
          this.hasEmittedAuthExpired = true;
          this.emit('session_expired');
        }

        this.emitProgress(item);
        return;
      }

      // Xử lý retry đối với lỗi mạng / timeout thông thường
      if (item.retries < PORTAL_CONFIG.MAX_RETRIES && (err.code === 'NETWORK' || err.code === 'TIMEOUT' || err.code === 'RATE_LIMIT')) {
        item.retries++;
        const backoffMs = PORTAL_CONFIG.RETRY_BASE_DELAY_MS * Math.pow(2, item.retries);
        await new Promise(r => setTimeout(r, backoffMs));
        if (this.state === 'RUNNING' && !this.isPaused) {
          item.status = 'PENDING';
        }
      } else {
        item.status = 'FAILED';
        item.error = err.message || 'Lỗi khi tải';
        item.filing.downloadStatus = 'FAILED';
        item.filing.downloadError = item.error;
        this.emit('item_failed', { item, error: item.error });
      }

      this.emitProgress(item);
    }
  }

  private emitProgress(item?: DownloadQueueItem) {
    this.emit('progress', {
      item,
      summary: this.getSummary()
    });
  }
}

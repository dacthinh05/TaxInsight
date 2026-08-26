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
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  // Invalidates workers from a queue that has been cleared before their promises settle.
  private queueGeneration = 0;

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
    this.queueGeneration++;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.queue = [];
    this.activeDownloads = 0;
    this.isPaused = false;
    this.isCancelled = false;
    this.state = 'IDLE';
    this.hasEmittedAuthExpired = false;
    this.stopWatchdog();
  }

  /**
   * 🆙 WATCHDOG: tự chữa lành hàng đợi treo. Nếu state RUNNING nhưng không còn
   * worker nào hoạt động trong khi vẫn còn item PENDING (mất thức tỉnh do race
   * giữa pause/abort/resume) -> gọi lại processQueue. Đây là nguyên nhân UI
   * đứng hình "Đang tải đồng thời 0 hồ sơ" vĩnh viễn.
   */
  private startWatchdog() {
    this.stopWatchdog();
    this.watchdogTimer = setInterval(() => {
      if (this.state !== 'RUNNING' || this.isPaused || this.isCancelled) return;
      if (this.activeDownloads === 0 && this.queue.some(q => q.status === 'PENDING')) {
        console.warn('[DownloadManager] Watchdog: hàng đợi treo (0 worker, còn PENDING) -> tự khởi động lại processQueue');
        this.processQueue();
      }
    }, 2000);
  }

  private stopWatchdog() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  /**
   * Thêm danh sách hồ sơ vào hàng đợi tải.
   * Mỗi lô tải từ UI là DANH SÁCH ĐÍCH: thay thế toàn bộ hàng đợi thay vì
   * cộng dồn. Trước đây hàng đợi giữ lại item của các lô cũ (kể cả item đã
   * bị hủy, mà start() còn hồi phục về PENDING) khiến người dùng chọn 3 hồ sơ
   * nhưng modal hiện "Tổng số 10" và tải cả hồ sơ cũ không liên quan.
   */
  public enqueueFilings(filings: TaxFiling[], taxCode?: string, year?: number) {
    if (taxCode) this.taxCode = taxCode;
    if (year) this.year = year;

    // Vô hiệu hóa worker của lô cũ đang chạy: chúng tự thoát khi thấy
    // generation đổi (processQueue/downloadItemWithWorker đều kiểm tra).
    this.queueGeneration++;
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.activeDownloads = 0;
    this.isCancelled = false;
    this.isPaused = false;
    this.queue = [];

    for (const filing of filings) {
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

    // Người dùng có thể bấm Tạm dừng/Dừng trong lúc health check đang chờ mạng.
    // Không được để phần start tiếp tục ghi đè lại trạng thái điều khiển đó.
    if (this.isCancelled || this.isPaused || this.state === 'PAUSED') {
      this.emitProgress();
      return;
    }

    if (!isSessionAlive) {
      this.stopWatchdog();
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
    this.startWatchdog();
    this.processQueue();
  }

  /**
   * 3. RESUME DOWNLOAD SAU KHI ĐĂNG NHẬP LẠI
   */
  public async resume(): Promise<void> {
    this.hasEmittedAuthExpired = false;

    // Kiểm tra lại phiên mới
    const isSessionAlive = await this.client.checkSession();
    if (this.isCancelled || this.state === 'CANCELLED') {
      this.stopWatchdog();
      this.emitProgress();
      return;
    }
    if (!isSessionAlive) {
      this.stopWatchdog();
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
    this.startWatchdog();
    this.processQueue();
  }

  public pause() {
    this.stopWatchdog();
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
    this.emitProgress();
  }

  public cancel() {
    this.stopWatchdog();
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
    this.emitProgress();
  }

  private async processQueue(generation = this.queueGeneration) {
    if (generation !== this.queueGeneration || this.isPaused || this.isCancelled || this.state !== 'RUNNING') return;

    while (this.activeDownloads < this.maxConcurrency && !this.isPaused && !this.isCancelled && this.state === 'RUNNING') {
      const nextItem = this.queue.find(item => item.status === 'PENDING');
      if (!nextItem) break;

      this.activeDownloads++;
      this.downloadItemWithWorker(nextItem, generation).finally(() => {
        if (generation !== this.queueGeneration) return;
        this.activeDownloads = Math.max(0, this.activeDownloads - 1);
        if (this.state === 'RUNNING' && !this.isPaused && !this.isCancelled) {
          this.processQueue(generation);
        }
      });
    }

    if (this.activeDownloads === 0 && this.state === 'RUNNING') {
      const summary = this.getSummary();
      if (summary.remaining === 0) {
        this.stopWatchdog();
        this.state = 'COMPLETED';
        this.emit('completed', summary);
      }
    }
  }

  /**
   * 2. XỬ LÝ WORKER TẢI VÀ SESSION EXPIRED GIỮA DOWNLOAD
   */
  private async downloadItemWithWorker(item: DownloadQueueItem, generation: number): Promise<void> {
    if (generation !== this.queueGeneration || item.status === 'EXISTING' || this.isPaused || this.isCancelled) {
      return;
    }

    item.status = 'DOWNLOADING';
    this.emitProgress(item);

    // Jitter nhẹ tránh xung đột đồng thời giữa các workers
    await new Promise(r => setTimeout(r, 50 + Math.random() * 100));

    if (generation !== this.queueGeneration || this.isPaused || this.isCancelled) {
      if (item.status === 'DOWNLOADING') item.status = 'PENDING';
      return;
    }

    // Cờ deadline đặt NGOÀI khối try để khối catch nhìn thấy được
    let deadlineHit = false;

    try {
      // Deadline 60s/hồ sơ: trước đây 1 hồ sơ lỗi có thể treo nhiều phút qua
      // chuỗi chiến lược + retry khiến hàng đợi trông như đứng hình ở 0%.
      // Mỗi hồ sơ có AbortController riêng (vẫn bị hủy theo queue chung).
      const ITEM_DEADLINE_MS = 60000;
      const itemController = new AbortController();
      const onQueueAbort = () => itemController.abort();
      if (this.abortController) {
        if (this.abortController.signal.aborted) itemController.abort();
        else this.abortController.signal.addEventListener('abort', onQueueAbort);
      }
      const deadline = setTimeout(() => {
        deadlineHit = true;
        itemController.abort();
      }, ITEM_DEADLINE_MS);

      let payload;
      try {
        // Cổng Thuế yêu cầu/đồng bộ bước xác thực ID hồ sơ trước khi trả nội
        // dung ở endpoint downloadhoso. TNCN thường bị ảnh hưởng rõ nhất vì
        // các ID hồ sơ cũ/ID tham chiếu của nhóm này khác nhau.
        // validateIdTkhai() là best-effort: nếu endpoint kiểm tra lỗi tạm thời
        // thì vẫn để downloadHoSo tự thử các chiến lược và altIds như trước.
        if (typeof (this.client as any).validateIdTkhai === 'function') {
          await (this.client as any).validateIdTkhai(item.filingId);
        }

        // 2. Tải Base64 ZIP — tự động route sang /downloadhoso-tdt nếu isThueDienTu=true
        payload = await this.client.downloadHoSo(
          item.filingId,
          itemController.signal,
          {
            isThueDienTu: item.filing.isThueDienTu,
            loaiTraCuu: item.filing.loaiTraCuu,
            altIds: item.filing.altIds
          }
        );
      } finally {
        clearTimeout(deadline);
        if (this.abortController) {
          this.abortController.signal.removeEventListener('abort', onQueueAbort);
        }
      }

      // clearQueue() may have replaced the queue while the request was in flight.
      if (generation !== this.queueGeneration) return;

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
      if (generation !== this.queueGeneration) return;
      // Hủy thật sự bởi người dùng (download:cancel)
      if (this.isCancelled) {
        item.status = 'CANCELLED';
        item.error = 'Đã hủy';
        return;
      }

      // Lỗi CANCELLED phát sinh khi AbortController bị hủy do PAUSE hoặc SESSION_EXPIRED.
      // Item đã được pause()/worker session-expired trả về PENDING — KHÔNG ĐƯỢC đánh dấu
      // CANCELLED ở đây (trước đây item bị kẹt trạng thái CANCELLED và mất khỏi resume).
      // TRỪ khi CANCELLED do deadline 60s của chính hồ sơ → xử lý ở khối deadline dưới.
      if (err.code === 'CANCELLED' && !deadlineHit) {
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
        this.stopWatchdog();

        // Chỉ bắn sự kiện expired 1 lần duy nhất cho toàn bộ batch
        if (!this.hasEmittedAuthExpired) {
          this.hasEmittedAuthExpired = true;
          this.emit('session_expired');
        }

        this.emitProgress(item);
        return;
      }

      // Xử lý retry đối với lỗi mạng / timeout thông thường
      if (deadlineHit && !(this.isCancelled || this.isPaused)) {
        // Vượt deadline của chính hồ sơ này (không phải do user dừng) → FAILED
        // với lý do rõ ràng thay vì treo vô hạn
        item.status = 'FAILED';
        item.error = `Vượt 60s không tải được — ` + this.formatDownloadError(err);
        item.filing.downloadStatus = 'FAILED';
        item.filing.downloadError = item.error;
        this.emit('item_failed', { item, error: item.error });
      } else if (item.retries < PORTAL_CONFIG.MAX_RETRIES && (err.code === 'NETWORK' || err.code === 'TIMEOUT' || err.code === 'RATE_LIMIT')) {
        item.retries++;
        const backoffMs = PORTAL_CONFIG.RETRY_BASE_DELAY_MS * Math.pow(2, item.retries);
        await new Promise(r => setTimeout(r, backoffMs));
        if (this.state === 'RUNNING' && !this.isPaused) {
          item.status = 'PENDING';
        }
      } else {
        item.status = 'FAILED';
        item.error = this.formatDownloadError(err);
        item.filing.downloadStatus = 'FAILED';
        item.filing.downloadError = item.error;
        this.emit('item_failed', { item, error: item.error });
      }

      this.emitProgress(item);
    }
  }

  /**
   * Ghép chẩn đoán từng lần thử HTTP (do TaxPortalClient đính kèm trên err.attempts)
   * vào thông báo lỗi — audit log sẽ chỉ ra chính xác server trả gì ở từng bước.
   */
  private formatDownloadError(err: any): string {
    let base = err?.message || 'Lỗi khi tải';
    const attempts = err?.attempts;
    if (!Array.isArray(attempts) || attempts.length === 0) return base;
    if (base.includes('đã bị dừng bởi người dùng')) base = 'Không nhận được file từ Cổng Thuế';
    const parts = attempts.slice(-8).map(a =>
      `${a.label}=${a.status || 'khong-PT'}/${a.ms}ms${a.head ? `«${String(a.head).slice(0, 70)}»` : ''}`
    );
    return `${base} || Thu: ${parts.join(' ;; ')}`;
  }

  private emitProgress(item?: DownloadQueueItem) {
    this.emit('progress', {
      item,
      summary: this.getSummary()
    });
  }
}

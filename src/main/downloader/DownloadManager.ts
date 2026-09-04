import { EventEmitter } from 'events';
import { PORTAL_CONFIG } from '../../shared/constants';
import { isFilingRejected } from '../../shared/dateUtils';
import { DownloadQueueItem, DownloadState, DownloadSummary, TaxFiling } from '../../shared/types';
import { ExtractedZipResult } from '../files/ZipExtractor';
import { FileOrganizer } from '../files/FileOrganizer';
import { LegacyFilingClient } from '../portal/LegacyFilingClient';
import { TaxPortalClient } from '../portal/TaxPortalClient';

export class DownloadManager extends EventEmitter {
  private client: TaxPortalClient;
  private fileOrganizer: FileOrganizer;
  public legacyClient?: LegacyFilingClient;
  private queue: DownloadQueueItem[] = [];
  private activeDownloads = 0;
  private maxConcurrency = PORTAL_CONFIG.DOWNLOAD_CONCURRENCY; // 1
  private abortController: AbortController | null = null;
  private isPaused = false;
  private isCancelled = false;
  private state: DownloadState = 'IDLE';
  private hasEmittedAuthExpired = false;
  private taxCode = '';
  private year = new Date().getFullYear();
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private consecutiveInfrastructureFailures = 0;
  private queueGeneration = 0;
  private rateLimitCooldownTimer: NodeJS.Timeout | null = null;

  constructor(client: TaxPortalClient, fileOrganizer: FileOrganizer, legacyClient?: LegacyFilingClient) {
    super();
    this.client = client;
    this.fileOrganizer = fileOrganizer;
    this.legacyClient = legacyClient;
  }

  public setContext(taxCode: string, year: number) {
    this.taxCode = taxCode;
    this.year = year;
  }

  private clearRateLimitCooldown() {
    if (this.rateLimitCooldownTimer) {
      clearTimeout(this.rateLimitCooldownTimer);
      this.rateLimitCooldownTimer = null;
    }
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
    let cancelled = 0;

    for (const item of this.queue) {
      if (item.status === 'COMPLETED') completed++;
      else if (item.status === 'EXISTING') existing++;
      else if (item.status === 'FAILED') failed++;
      else if (item.status === 'DOWNLOADING') downloading++;
      else if (item.status === 'PENDING') pending++;
      else if (item.status === 'CANCELLED') cancelled++;
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
      cancelled,
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
    this.clearRateLimitCooldown();
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
    this.consecutiveInfrastructureFailures = 0;
    this.stopWatchdog();
  }

  private startWatchdog() {
    this.stopWatchdog();
    this.watchdogTimer = setInterval(() => {
      if (this.state !== 'RUNNING' || this.isPaused || this.isCancelled) return;
      if (this.activeDownloads === 0 && this.queue.some(q => q.status === 'PENDING')) {
        console.warn('[DownloadManager] Watchdog: hàng đợi treo (0 worker, còn PENDING) -> tự khởi động lại processQueue');
        this.processQueue();
      }
    }, 2000);
    if (typeof this.watchdogTimer.unref === 'function') {
      this.watchdogTimer.unref();
    }
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
    // DownloadManager tự động định tuyến: tờ khai hiện hành tải qua DVC,
    // tờ khai eTax năm cũ tải qua legacyClient nếu có.
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
    this.consecutiveInfrastructureFailures = 0;

    for (const filing of filings) {
      // 🎯 TẦNG 1: LOGICAL MANIFEST PRE-CHECK
      const preCheck = this.fileOrganizer.checkPreDownloadStatus(this.taxCode, filing, this.year);

      if (preCheck.isAlreadyDownloaded) {
        filing.downloadStatus = 'EXISTING';
        filing.downloadedFiles = {
          xml: preCheck.xmlPath,
          pdf: preCheck.pdfPath,
          other: preCheck.otherPaths
        };
        this.queue.push({
          filingId: filing.id,
          filing,
          status: 'EXISTING',
          retries: 0,
          progressPercent: 100,
          savedPaths: preCheck.savedPaths
        });
      } else {
        filing.downloadStatus = 'PENDING';
        filing.downloadError = undefined;
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
    // được hồi phục về PENDING.
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
    if (this.isCancelled || this.isPaused || this.state === 'PAUSED' || this.state === 'PAUSED_RATE_LIMIT') {
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
    this.clearRateLimitCooldown();
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
    this.activeDownloads = 0;
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
    this.clearRateLimitCooldown();
    this.queueGeneration++;
    this.isPaused = true;
    this.state = 'PAUSED';
    if (this.abortController) {
      this.abortController.abort();
    }
    // Trả các item đang tải dở về lại PENDING
    for (const item of this.queue) {
      if (item.status === 'DOWNLOADING') {
        item.status = 'PENDING';
        item.filing.downloadStatus = 'PENDING';
      }
    }
    this.activeDownloads = 0;
    this.emit('paused', this.getSummary());
    this.emitProgress();
  }

  public cancel() {
    this.stopWatchdog();
    this.queueGeneration++;
    this.clearRateLimitCooldown();
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
        item.filing.downloadStatus = 'CANCELLED';
        item.error = 'Đã hủy tiến trình tải hồ sơ';
        item.filing.downloadError = item.error;
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
      this.downloadItemWithWorker(nextItem, generation)
        .catch(err => {
          console.error('[DownloadManager] Lỗi không bắt được trong worker:', err);
          if (generation === this.queueGeneration && !this.isCancelled) {
            nextItem.status = 'FAILED';
            nextItem.error = err instanceof Error ? err.message : String(err);
            nextItem.filing.downloadStatus = 'FAILED';
            nextItem.filing.downloadError = nextItem.error;
            this.emit('item_failed', { item: nextItem, error: nextItem.error });
            this.emitProgress(nextItem);
          }
        })
        .finally(() => {
          this.activeDownloads = Math.max(0, this.activeDownloads - 1);
          if (generation !== this.queueGeneration) return;
          if (this.state === 'RUNNING' && !this.isPaused && !this.isCancelled) {
            this.processQueue(generation);
          }
        });
    }

    if (this.activeDownloads === 0 && this.state === 'RUNNING') {
      const summary = this.getSummary();
      if (summary.remaining === 0) {
        this.stopWatchdog();
        this.clearRateLimitCooldown();
        this.state = 'COMPLETED';
        this.emit('completed', this.getSummary());
        this.emitProgress();
      }
    }
  }

  private async downloadItemWithWorker(item: DownloadQueueItem, generation: number): Promise<void> {
    if (generation !== this.queueGeneration || item.status === 'EXISTING' || this.isPaused || this.isCancelled) {
      return;
    }

    // 🎯 Kiểm tra nhanh xem file đã tồn tại trên đĩa chưa trước khi gửi request lên Cổng
    const preCheck = this.fileOrganizer?.checkPreDownloadStatus?.(this.taxCode, item.filing, this.year);
    if (preCheck?.isAlreadyDownloaded) {
      item.status = 'EXISTING';
      item.progressPercent = 100;
      item.savedPaths = preCheck.savedPaths;
      item.filing.downloadStatus = 'EXISTING';
      item.filing.downloadedFiles = {
        xml: preCheck.savedPaths?.find((p: string) => p.toLowerCase().endsWith('.xml')),
        pdf: preCheck.savedPaths?.find((p: string) => p.toLowerCase().endsWith('.pdf')),
        other: (preCheck.savedPaths || []).filter((p: string) => !p.toLowerCase().endsWith('.xml') && !p.toLowerCase().endsWith('.pdf'))
      };
      this.emit('item_completed', {
        item,
        saveResult: {
          isExisting: true,
          savedPaths: preCheck.savedPaths || [],
          xmlPath: item.filing.downloadedFiles.xml,
          pdfPath: item.filing.downloadedFiles.pdf
        }
      });
      this.emitProgress(item);
      return;
    }
    if (isFilingRejected(item.filing)) {
      item.status = 'FAILED';
      item.error = `Hồ sơ bị Cơ quan Thuế từ chối tiếp nhận (${item.filing.status || 'Không chấp nhận'}) — Cổng DVC không cấp gói tệp tờ khai cho hồ sơ bị từ chối. Vui lòng chọn bản nộp lại được chấp nhận.`;
      item.filing.downloadStatus = 'FAILED';
      item.filing.downloadError = item.error;
      this.emit('item_failed', { item, error: item.error });
      this.emitProgress(item);
      return;
    }

    item.status = 'DOWNLOADING';
    item.filing.downloadStatus = 'DOWNLOADING';
    this.emitProgress(item);
    // 🎯 Pacing & Jitter an toàn để bảo vệ phiên và tránh bị Cổng Thuế chặn tần suất (HTTP 429)
    const pacingDelayMs = (PORTAL_CONFIG.DOWNLOAD_ITEM_DELAY_MS || 1500) + Math.floor(Math.random() * (PORTAL_CONFIG.DOWNLOAD_ITEM_JITTER_MS || 800));
    await new Promise<void>(resolve => setTimeout(resolve, pacingDelayMs));
    if (generation !== this.queueGeneration || this.isPaused || this.isCancelled) {
      if (!this.isCancelled && this.isPaused) {
        item.status = 'PENDING';
        item.filing.downloadStatus = 'PENDING';
      }
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

      let payload: any = null;
      const isDirectEtaxSource =
        item.filing.source === 'dvc-etax-html' ||
        Boolean(item.filing.messageId);

      try {
        // Ưu tiên tải từ Cổng DVC trước cho tất cả các hồ sơ.
        // Chỉ ưu tiên eTax trước khi hồ sơ đến trực tiếp từ nguồn tra cứu eTax hoặc đã có messageId sẵn.
        if (isDirectEtaxSource && this.legacyClient) {
          try {
            const legacyFile = item.filing.messageId
              ? await this.legacyClient.downloadFiling(item.filing.messageId, itemController.signal)
              : await this.legacyClient.resolveAndDownloadFiling(
                  this.taxCode,
                  item.filing,
                  itemController.signal
                );
            payload = {
              fileName: legacyFile.fileName,
              fileType: legacyFile.contentType,
              content: legacyFile.dataBuffer.toString('base64'),
              fileCount: 1
            };
          } catch (etaxErr: any) {
            const isRateLimit = etaxErr?.code === 'RATE_LIMIT' || etaxErr?.status === 429 || String(etaxErr?.message).includes('429');
            const isAuth = etaxErr?.code === 'SESSION_EXPIRED' || etaxErr?.code === 'AUTH_REQUIRED';
            if (isRateLimit || isAuth || etaxErr?.code === 'CANCELLED') {
              throw etaxErr;
            }
            console.warn(`[DownloadManager] Không tải được qua eTax (${etaxErr?.message}), chuyển sang Cổng DVC`);
          }
        }
        if (!payload) {
          try {
            payload = await this.client.downloadHoSo(
              item.filingId,
              itemController.signal,
              {
                isThueDienTu: item.filing.isThueDienTu,
                loaiTraCuu: item.filing.loaiTraCuu,
                maTkhai: item.filing.maTkhai,
                altIds: item.filing.altIds,
                period: item.filing.period,
                declarationCode: item.filing.declarationCode
              }
            );
          } catch (dvcErr: unknown) {
            // Khi Cổng DVC báo lỗi (ví dụ HTTP 500 hoặc validateIdTkhai "400" do hồ sơ nộp qua eTax),
            // tự động fallback sang phân hệ eTax để lấy tệp XML/PDF gốc.
            if (this.legacyClient && !isDirectEtaxSource) {
              try {
                const fallbackSignal = (itemController.signal.aborted && !this.isCancelled && !this.isPaused)
                  ? undefined
                  : itemController.signal;
                const legacyFile = await this.legacyClient.resolveAndDownloadFiling(
                  this.taxCode,
                  item.filing,
                  fallbackSignal
                );
                payload = {
                  fileName: legacyFile.fileName,
                  fileType: legacyFile.contentType,
                  content: legacyFile.dataBuffer.toString('base64'),
                  fileCount: 1
                };
              } catch (etaxFallbackErr: unknown) {
                const fallbackObj = etaxFallbackErr as { code?: string; status?: number; response?: { status?: number }; message?: string } | null | undefined;
                const isRateLimit = fallbackObj?.code === 'RATE_LIMIT' || fallbackObj?.status === 429 || fallbackObj?.response?.status === 429 || String(fallbackObj?.message).includes('429');
                const isAuth = fallbackObj?.code === 'SESSION_EXPIRED' || fallbackObj?.code === 'AUTH_REQUIRED';
                if (isRateLimit || isAuth || fallbackObj?.code === 'CANCELLED') {
                  throw etaxFallbackErr;
                }
                const dvcMsg = dvcErr instanceof Error ? dvcErr.message : String(dvcErr);
                const etaxMsg = etaxFallbackErr instanceof Error ? etaxFallbackErr.message : String(etaxFallbackErr);
                console.warn(`[DownloadManager] Fallback eTax thất bại cho ${item.filingId}: ${etaxMsg}`);
                const isFromDvc = item.filing.source !== 'dvc-etax-html';
                const combined = new Error(
                  isFromDvc
                    ? `Cổng DVC chưa mở gói tệp [${item.filingId}] (${dvcMsg}). Đã thử tìm dự phòng trên eTax nhưng không có (${etaxMsg}).`
                    : `${dvcMsg} (Fallback eTax: ${etaxMsg})`
                );
                Object.assign(combined, dvcErr);
                throw combined;
              }
            } else {
              throw dvcErr;
            }
          }
        }
      } finally {
        clearTimeout(deadline);
        if (this.abortController) {
          this.abortController.signal.removeEventListener('abort', onQueueAbort);
        }
      }

      // clearQueue() may have replaced the queue while the request was in flight.
      if (generation !== this.queueGeneration) return;
      this.consecutiveInfrastructureFailures = 0;

      // 3. Tầng 2: Giải nén an toàn & kiểm tra integrity SHA-256
      let saveResult: ExtractedZipResult;
      try {
        saveResult = this.fileOrganizer.saveDownloadedFiling({
          content: payload.content,
          fileName: payload.fileName,
          contentType: payload.fileType,
          filing: item.filing,
          taxCode: this.taxCode,
          year: this.year
        });
      } catch (extractErr: unknown) {
        // Nếu gói tệp từ DVC bị lỗi giải nén (ví dụ ZIP hỏng/thiếu header/không đúng định dạng),
        // và chưa thử nguồn eTax -> tự động fallback sang eTax để lấy tệp XML/PDF gốc từ CQT!
        if (this.legacyClient && !isDirectEtaxSource) {
          const extractMsg = extractErr instanceof Error ? extractErr.message : String(extractErr);
          console.warn(`[DownloadManager] Giải nén file DVC thất bại (${extractMsg}) -> tự động fallback sang eTax cho ${item.filingId}`);
          try {
            const fallbackSignal = (itemController.signal.aborted && !this.isCancelled && !this.isPaused)
              ? undefined
              : itemController.signal;
            const legacyFile = await this.legacyClient.resolveAndDownloadFiling(
              this.taxCode,
              item.filing,
              fallbackSignal
            );
            payload = {
              fileName: legacyFile.fileName,
              fileType: legacyFile.contentType,
              content: legacyFile.dataBuffer.toString('base64'),
              fileCount: 1
            };
            saveResult = this.fileOrganizer.saveDownloadedFiling({
              content: payload.content,
              fileName: payload.fileName,
              contentType: payload.fileType,
              filing: item.filing,
              taxCode: this.taxCode,
              year: this.year
            });
          } catch (etaxFallbackErr: unknown) {
            const etaxMsg = etaxFallbackErr instanceof Error ? etaxFallbackErr.message : String(etaxFallbackErr);
            const combinedErr = new Error(`Giải nén DVC thất bại (${extractMsg}) và fallback eTax thất bại: ${etaxMsg}`);
            Object.assign(combinedErr, extractErr);
            throw combinedErr;
          }
        } else {
          throw extractErr;
        }
      }

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
          item.filing.downloadStatus = 'PENDING';
        }
        this.emitProgress(item);
        return;
      }

      // XỬ LÝ KHI PHÁT HIỆN SESSION EXPIRED
      if (err.code === 'SESSION_EXPIRED') {
        // Trả item hiện tại về PENDING để retry sau khi đăng nhập lại
        item.status = 'PENDING';
        item.progressPercent = 0;
        item.filing.downloadStatus = 'PENDING';

        // Vô hiệu hóa toàn bộ worker của generation cũ trước khi abort. Nếu
        // response cũ về muộn sau khi đăng nhập lại, nó không được phép lưu
        // file hoặc ghi đè trạng thái batch mới.
        this.queueGeneration++;
        // Dừng toàn bộ workers khác
        if (this.abortController) {
          this.abortController.abort();
        }

        // Đưa tất cả item DOWNLOADING về PENDING
        for (const q of this.queue) {
          if (q.status === 'DOWNLOADING') {
            q.status = 'PENDING';
            q.filing.downloadStatus = 'PENDING';
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

      // Circuit breaker cấp batch:
      // - 429 đầu tiên: dừng ngay toàn bộ queue, không để mỗi item tự thử lại.
      // - Hai lỗi server 5xx liên tiếp: coi endpoint đang lỗi hệ thống và dừng
      //   phần còn lại thay vì tạo hàng chục response 500 như bản cũ.
      const errHttpStatus = Number(err?.response?.status || err?.httpStatus || err?.status || 0);
      const isRateLimited = err.code === 'RATE_LIMIT' || errHttpStatus === 429;
      const isRejectedPayload = err.code === 'FILING_PAYLOAD_REJECTED';
      const isRecordSpecificFailure = this.isRecordSpecificDownloadFailure(err);
      const isServerFailure = !isRejectedPayload && !isRecordSpecificFailure && (
        err.code === 'SERVER_ERROR' || Number(err.httpStatus) >= 500
      );
      if (isRateLimited || isServerFailure) {
        this.consecutiveInfrastructureFailures = isRateLimited
          ? this.consecutiveInfrastructureFailures
          : this.consecutiveInfrastructureFailures + 1;
        const mustPauseBatch = isRateLimited || this.consecutiveInfrastructureFailures >= 2;

        if (mustPauseBatch) {
          this.queueGeneration++;
          item.status = isRateLimited ? 'PENDING' : 'FAILED';
          item.filing.downloadStatus = isRateLimited ? 'PENDING' : 'FAILED';
          item.progressPercent = 0;
          item.error = this.formatDownloadError(err);
          if (!isRateLimited) {
            item.filing.downloadStatus = 'FAILED';
            item.filing.downloadError = item.error;
            this.emit('item_failed', { item, error: item.error });
          }

          if (this.abortController) this.abortController.abort();
          for (const queued of this.queue) {
            if (queued !== item && queued.status === 'DOWNLOADING') {
              queued.status = 'PENDING';
              queued.progressPercent = 0;
              queued.filing.downloadStatus = 'PENDING';
            }
          }
          this.isPaused = true;
          this.state = 'PAUSED';
          this.activeDownloads = 0;
          this.stopWatchdog();

          if (isRateLimited) {
            const cooldownMs = PORTAL_CONFIG.RATE_LIMIT_COOLDOWN_MS || 45000;
            const resumeAt = Date.now() + cooldownMs;
            this.emit('rate_limited', {
              cooldownMs,
              resumeAt,
              item,
              message: `Máy chủ Cổng Thuế giới hạn tần suất yêu cầu (HTTP 429). Tự động thử lại sau ${Math.round(cooldownMs / 1000)} giây...`
            });

            this.clearRateLimitCooldown();
            this.rateLimitCooldownTimer = setTimeout(async () => {
              if (this.isPaused && !this.isCancelled) {
                console.log(`[DownloadManager] Hết thời gian chờ 429 (${cooldownMs}ms) -> tự động resume queue`);
                await this.resume().catch(e => {
                  console.warn('[DownloadManager] Tự động resume sau 429 thất bại:', e);
                });
              }
            }, cooldownMs);
            if (typeof this.rateLimitCooldownTimer.unref === 'function') {
              this.rateLimitCooldownTimer.unref();
            }
          }
          this.emit('paused', this.getSummary());
          this.emitProgress(item);
          return;
        }
      } else {
        this.consecutiveInfrastructureFailures = 0;
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
      } else if (
        item.retries < PORTAL_CONFIG.MAX_RETRIES &&
        (err.code === 'NETWORK' || err.code === 'TIMEOUT')
      ) {
        item.retries++;
        const backoffMs = PORTAL_CONFIG.RETRY_BASE_DELAY_MS * Math.pow(2, item.retries);
        await new Promise(r => setTimeout(r, backoffMs));
        if (this.state === 'RUNNING' && !this.isPaused) {
          item.status = 'PENDING';
          item.filing.downloadStatus = 'PENDING';
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

  /**
   * Một số endpoint trả HTTP 500 cho ID/payload riêng lẻ dù hạ tầng vẫn sống.
   * Các lỗi này phải làm FAILED đúng hồ sơ hiện tại, không được cộng vào circuit
   * breaker cấp batch.
   */
  private isRecordSpecificDownloadFailure(err: any): boolean {
    const attempts = Array.isArray(err?.attempts) ? err.attempts : [];
    const diagnosticText = [
      err?.message,
      ...attempts.map((attempt: any) => attempt?.head)
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd');

    return [
      'ho so truyen len khong hop le',
      'ma ho so khong hop le',
      'id to khai khong hop le',
      'id tkhai khong hop le',
      'invalid filing',
      'invalid dossier',
      'download failed',
      'download_action_not_found',
      'filing_validation_failed',
      'download_invalid_response',
      'khong vuot qua validateidtkhai',
      'khong nhan duoc noi dung',
      'khong tim thay file',
      'khong tim thay action',
      'khong tim thay to khai'
    ].some(marker => diagnosticText.includes(marker));
  }

  private emitProgress(item?: DownloadQueueItem) {
    this.emit('progress', {
      item,
      summary: this.getSummary(),
      queue: this.getQueue()
    });
  }
}

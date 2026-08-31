import { EventEmitter } from 'events';
import { PORTAL_CONFIG } from '../../shared/constants';
import { DownloadQueueItem, DownloadState, DownloadSummary, TaxFiling } from '../../shared/types';
import { FileOrganizer } from '../files/FileOrganizer';
import { LegacyFilingClient } from '../portal/LegacyFilingClient';
import { TaxPortalClient } from '../portal/TaxPortalClient';

const ITEM_DEADLINE_MS = 60_000;
const MAX_TRANSIENT_RETRIES = 2;

export class LegacyFilingDownloader extends EventEmitter {
  private queue: DownloadQueueItem[] = [];
  private activeDownloads = 0;
  // Search/navigation và download eTax dùng chung form state mới nhất. Mặc
  // định tuần tự là lựa chọn an toàn nhất cho cổng thật.
  private readonly maxConcurrency = 1;
  private abortController: AbortController | null = null;
  private isPaused = false;
  private isCancelled = false;
  private state: DownloadState = 'IDLE';
  private taxCode = '';
  private year = new Date().getFullYear();
  private queueGeneration = 0;
  private consecutiveServerFailures = 0;

  constructor(
    private readonly client: LegacyFilingClient,
    private readonly fileOrganizer: FileOrganizer
  ) {
    super();
  }

  public setContext(taxCode: string, year: number) {
    this.taxCode = String(taxCode || '').trim();
    this.year = Math.trunc(Number(year)) || new Date().getFullYear();
  }

  public getState(): DownloadState {
    return this.state;
  }

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
    return {
      total,
      completed,
      existing,
      failed,
      downloading,
      pending,
      remaining: Math.max(0, total - completed - existing - failed),
      isPaused: this.isPaused,
      isCancelled: this.isCancelled,
      isRunning: this.state === 'RUNNING',
      state: this.state
    };
  }

  public getQueue(): DownloadQueueItem[] {
    return this.queue.map(item => ({ ...item, filing: { ...item.filing } }));
  }

  public clearQueue() {
    this.invalidateWorkers();
    this.queue = [];
    this.isPaused = false;
    this.isCancelled = false;
    this.state = 'IDLE';
    this.consecutiveServerFailures = 0;
  }

  public enqueueFilings(filings: TaxFiling[], taxCode?: string, year?: number) {
    if (taxCode) this.taxCode = String(taxCode).trim();
    if (year) this.year = Math.trunc(Number(year)) || this.year;
    this.invalidateWorkers();
    this.queue = [];
    this.isCancelled = false;
    this.isPaused = false;
    this.state = 'IDLE';
    this.consecutiveServerFailures = 0;

    const seenIds = new Set<string>();
    for (const filing of filings) {
      const messageId = String(filing.messageId || filing.id || '').trim();
      if (
        filing.source !== 'dvc-etax-html' ||
        !messageId ||
        seenIds.has(messageId)
      ) {
        continue;
      }
      seenIds.add(messageId);
      const normalizedFiling: TaxFiling = {
        ...filing,
        id: messageId,
        messageId,
        source: 'dvc-etax-html'
      };
      const filingYear = normalizedFiling.periodNormalized?.year || this.year;
      const check = this.fileOrganizer.checkPreDownloadStatus(
        this.taxCode,
        normalizedFiling,
        filingYear
      );
      if (check.isAlreadyDownloaded) {
        normalizedFiling.downloadStatus = 'EXISTING';
        normalizedFiling.downloadedFiles = {
          xml: check.savedPaths?.[0],
          other: check.savedPaths?.slice(1)
        };
        this.queue.push({
          filingId: messageId,
          filing: normalizedFiling,
          status: 'EXISTING',
          retries: 0,
          progressPercent: 100,
          savedPaths: check.savedPaths
        });
      } else {
        normalizedFiling.downloadStatus = 'PENDING';
        this.queue.push({
          filingId: messageId,
          filing: normalizedFiling,
          status: 'PENDING',
          retries: 0,
          progressPercent: 0
        });
      }
    }
  }

  public async start(): Promise<void> {
    if (this.state === 'RUNNING') return;
    if (!this.taxCode) throw new Error('Thiếu mã số thuế cho lô tải năm cũ.');
    if (!this.queue.length) throw new Error('Không có hồ sơ năm cũ hợp lệ để tải.');

    this.isCancelled = false;
    this.isPaused = false;
    this.state = 'RUNNING';
    this.abortController = new AbortController();
    const generation = this.queueGeneration;

    // Preflight một lần trước khi mở worker, tránh mỗi hồ sơ cùng phát hiện
    // session hỏng rồi bắn thêm request.
    try {
      await this.client.ensureEtaxSession();
    } catch (error: any) {
      this.pauseForAuthOrInfrastructure(error);
      throw error;
    }
    if (!this.isGenerationActive(generation)) return;

    this.emit('started', this.getSummary());
    this.emitProgress();
    this.processQueue(generation);
  }

  public pause() {
    if (this.state !== 'RUNNING') return;
    this.invalidateWorkers();
    this.isPaused = true;
    this.isCancelled = false;
    this.state = 'PAUSED';
    this.returnDownloadingToPending();
    this.emit('paused', this.getSummary());
    this.emitProgress();
  }

  public async resume(): Promise<void> {
    if (this.state === 'RUNNING') return;
    this.isPaused = false;
    this.isCancelled = false;
    this.state = 'RUNNING';
    this.abortController = new AbortController();
    const generation = this.queueGeneration;
    try {
      await this.client.ensureEtaxSession(true);
    } catch (error: any) {
      this.pauseForAuthOrInfrastructure(error);
      throw error;
    }
    if (!this.isGenerationActive(generation)) return;
    this.emit('resumed', this.getSummary());
    this.emitProgress();
    this.processQueue(generation);
  }

  public cancel() {
    this.invalidateWorkers();
    this.isCancelled = true;
    this.isPaused = false;
    this.state = 'CANCELLED';
    for (const item of this.queue) {
      if (item.status === 'PENDING' || item.status === 'DOWNLOADING') {
        item.status = 'CANCELLED';
        item.progressPercent = 0;
      }
    }
    this.emit('cancelled', this.getSummary());
    this.emitProgress();
  }

  private processQueue(generation: number) {
    if (!this.isGenerationActive(generation)) return;

    while (this.activeDownloads < this.maxConcurrency) {
      const nextItem = this.queue.find(item => item.status === 'PENDING');
      if (!nextItem) break;
      this.activeDownloads++;
      void this.downloadItem(nextItem, generation).finally(() => {
        if (generation !== this.queueGeneration) return;
        this.activeDownloads = Math.max(0, this.activeDownloads - 1);
        if (this.isGenerationActive(generation)) {
          this.processQueue(generation);
          this.finishIfDone();
        }
      });
    }
    this.finishIfDone();
  }

  private async downloadItem(item: DownloadQueueItem, generation: number): Promise<void> {
    if (!this.isGenerationActive(generation)) return;
    item.status = 'DOWNLOADING';
    item.filing.downloadStatus = 'DOWNLOADING';
    this.emitProgress(item);

    await this.delay(250 + Math.random() * 300);
    if (!this.isGenerationActive(generation)) return;

    const itemController = new AbortController();
    const queueAbort = () => itemController.abort();
    this.abortController?.signal.addEventListener('abort', queueAbort, { once: true });
    const deadline = setTimeout(() => itemController.abort(), ITEM_DEADLINE_MS);

    try {
      const result = await this.client.downloadFiling(
        item.filing.messageId || item.filing.id,
        itemController.signal
      );
      if (!this.isGenerationActive(generation)) return;

      const filingYear = item.filing.periodNormalized?.year || this.year;
      const saveResult = this.fileOrganizer.saveExtractedFiling(
        result.dataBuffer.toString('base64'),
        item.filing,
        this.taxCode,
        filingYear
      );
      if (!this.isGenerationActive(generation)) return;

      this.consecutiveServerFailures = 0;
      item.status = saveResult.isExisting ? 'EXISTING' : 'COMPLETED';
      item.savedPaths = saveResult.savedPaths;
      item.progressPercent = 100;
      item.error = undefined;
      item.filing.downloadStatus = item.status;
      item.filing.downloadError = undefined;
      item.filing.downloadedFiles = {
        xml: saveResult.xmlPath,
        pdf: saveResult.pdfPath,
        other: saveResult.savedPaths.filter(
          savedPath => savedPath !== saveResult.xmlPath && savedPath !== saveResult.pdfPath
        )
      };
      this.emit('file_downloaded', { item, summary: this.getSummary() });
      this.emitProgress(item);
    } catch (error: any) {
      if (!this.isGenerationActive(generation)) return;
      await this.handleItemError(item, error, generation);
    } finally {
      clearTimeout(deadline);
      this.abortController?.signal.removeEventListener('abort', queueAbort);
    }
  }

  private async handleItemError(
    item: DownloadQueueItem,
    error: any,
    generation: number
  ): Promise<void> {
    const status = Number(error?.response?.status || error?.httpStatus || 0);
    const code = String(error?.code || '');
    const message = error?.message || 'Lỗi khi tải hồ sơ năm cũ';
    const isAuth = ['AUTH_EXPIRED', 'SESSION_EXPIRED', 'SSO_INTERACTIVE_REQUIRED'].includes(code);
    const isRateLimited = code === 'RATE_LIMIT' || status === 429;
    const isServerFailure = code === 'SERVER_ERROR' || status >= 500;
    const isTransient = code === 'NETWORK' || code === 'TIMEOUT';

    if (isAuth) {
      item.status = 'PENDING';
      item.progressPercent = 0;
      this.pauseForAuthOrInfrastructure(error, true);
      this.emit('auth_expired', { item, message });
      this.emitProgress(item);
      return;
    }

    if (isRateLimited) {
      item.status = 'PENDING';
      item.progressPercent = 0;
      TaxPortalClient.triggerGlobalRateLimit(4_000);
      this.pauseForAuthOrInfrastructure(error);
      this.emit('rate_limited', { item, message });
      this.emitProgress(item);
      return;
    }

    if (isServerFailure) {
      this.consecutiveServerFailures++;
      if (this.consecutiveServerFailures >= 2) {
        item.status = 'PENDING';
        item.progressPercent = 0;
        this.pauseForAuthOrInfrastructure(error);
        this.emit('server_unavailable', { item, message });
        this.emitProgress(item);
        return;
      }
    } else {
      this.consecutiveServerFailures = 0;
    }

    if (isTransient && item.retries < MAX_TRANSIENT_RETRIES) {
      item.retries++;
      item.status = 'PENDING';
      item.progressPercent = 0;
      this.emitProgress(item);
      await this.delay(
        PORTAL_CONFIG.RETRY_BASE_DELAY_MS * 2 ** item.retries +
        Math.random() * 500
      );
      if (this.isGenerationActive(generation)) this.processQueue(generation);
      return;
    }

    item.status = 'FAILED';
    item.error = message;
    item.progressPercent = 0;
    item.filing.downloadStatus = 'FAILED';
    item.filing.downloadError = message;
    this.emit('file_failed', { item, error: message, summary: this.getSummary() });
    this.emitProgress(item);
  }

  private pauseForAuthOrInfrastructure(error: any, authRequired = false) {
    this.invalidateWorkers();
    this.returnDownloadingToPending();
    this.isPaused = true;
    this.isCancelled = false;
    this.state = authRequired ? 'AUTH_REQUIRED' : 'PAUSED';
    this.emit('paused', {
      ...this.getSummary(),
      errorCode: error?.code,
      httpStatus: error?.response?.status || error?.httpStatus
    });
  }

  private finishIfDone() {
    if (this.state !== 'RUNNING' || this.activeDownloads > 0) return;
    if (this.queue.some(item => item.status === 'PENDING' || item.status === 'DOWNLOADING')) return;
    this.state = 'COMPLETED';
    const summary = this.getSummary();
    this.emit('completed', summary);
    this.emitProgress();
  }

  private returnDownloadingToPending() {
    for (const item of this.queue) {
      if (item.status === 'DOWNLOADING') {
        item.status = 'PENDING';
        item.progressPercent = 0;
        item.filing.downloadStatus = 'PENDING';
      }
    }
  }

  private invalidateWorkers() {
    this.queueGeneration++;
    this.abortController?.abort();
    this.abortController = null;
    this.activeDownloads = 0;
  }

  private isGenerationActive(generation: number): boolean {
    return (
      generation === this.queueGeneration &&
      !this.isPaused &&
      !this.isCancelled &&
      this.state === 'RUNNING'
    );
  }

  private emitProgress(item?: DownloadQueueItem) {
    this.emit('progress', {
      summary: this.getSummary(),
      currentItem: item,
      item,
      queue: this.getQueue()
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

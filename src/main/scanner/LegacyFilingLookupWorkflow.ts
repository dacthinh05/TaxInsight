import { EventEmitter } from 'events';
import { HistoricalFilingRecord, LegacyFilingScanProgress, TaxFiling } from '../../shared/types';
import { HistoricalCheckpointStore } from '../persistence/HistoricalCheckpointStore';
import { FileOrganizer } from '../files/FileOrganizer';
import { LegacyFilingClient } from '../portal/LegacyFilingClient';

export type WorkflowState =
  | 'IDLE'
  | 'CHECK_DVC_SESSION'
  | 'OPEN_SERVICE_PAGE'
  | 'REQUEST_SSO_REDIRECT'
  | 'ENTER_ETAX'
  | 'INITIALIZE_CORPORATE_SESSION'
  | 'OPEN_FILING_LOOKUP'
  | 'SUBMIT_SEARCH'
  | 'PARSE_RESULTS'
  | 'FETCH_NEXT_PAGE'
  | 'DOWNLOAD_SELECTED_FILES'
  | 'VERIFY_FILES'
  | 'PARSE_AND_STORE'
  | 'COMPLETED'
  | 'AUTH_EXPIRED'
  | 'SESSION_INVALID'
  | 'SSO_FAILED'
  | 'FORM_CHANGED'
  | 'SEARCH_FAILED'
  | 'RATE_LIMITED'
  | 'DOWNLOAD_FAILED'
  | 'INVALID_FILE'
  | 'CANCELLED';

export class LegacyFilingLookupWorkflow extends EventEmitter {
  private client: LegacyFilingClient;
  private checkpointStore: HistoricalCheckpointStore;
  private fileOrganizer: FileOrganizer;
  private currentState: WorkflowState = 'IDLE';
  private isRunning = false;
  private isCancelled = false;
  private isPaused = false;
  private abortController: AbortController | null = null;
  private runGeneration = 0;

  private allDiscoveredFilings: TaxFiling[] = [];
  private allHistoricalRecords: HistoricalFilingRecord[] = [];

  constructor(
    client: LegacyFilingClient,
    checkpointStore: HistoricalCheckpointStore,
    fileOrganizer: FileOrganizer
  ) {
    super();
    this.client = client;
    this.checkpointStore = checkpointStore;
    this.fileOrganizer = fileOrganizer;
  }

  public getState(): WorkflowState {
    return this.currentState;
  }

  public getDiscoveredFilings(): TaxFiling[] {
    return [...this.allDiscoveredFilings];
  }

  public getHistoricalRecords(): HistoricalFilingRecord[] {
    return [...this.allHistoricalRecords];
  }

  public cancel() {
    this.runGeneration++;
    this.isCancelled = true;
    this.isRunning = false;
    this.transitionTo('CANCELLED');
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  private transitionTo(newState: WorkflowState, detail?: string) {
    this.currentState = newState;
    this.emit('state_change', { state: newState, detail });
    console.log(`[LegacyFilingLookupWorkflow] Transition -> ${newState}${detail ? ` (${detail})` : ''}`);
  }

  /**
   * Chạy quy trình tra cứu tuần tự từng năm từ yearFrom đến yearTo
   */
  public async executeLookup(params: {
    taxpayerId: string;
    yearFrom: number;
    yearTo: number;
    maTKhai?: string;
    onlyMissing?: boolean;
  }): Promise<{
    filings: TaxFiling[];
    historicalRecords: HistoricalFilingRecord[];
  }> {
    if (this.isRunning) {
      throw new Error('Đang có một tiến trình tra cứu năm cũ đang chạy.');
    }

    this.isRunning = true;
    this.isCancelled = false;
    this.isPaused = false;
    this.abortController = new AbortController();
    const activeGeneration = ++this.runGeneration;
    this.allDiscoveredFilings = [];
    this.allHistoricalRecords = [];

    const normalizedFrom = Math.trunc(Number(params.yearFrom));
    const normalizedTo = Math.trunc(Number(params.yearTo));
    if (
      !Number.isFinite(normalizedFrom) ||
      !Number.isFinite(normalizedTo) ||
      normalizedFrom < 1900 ||
      normalizedTo > 2200 ||
      Math.abs(normalizedTo - normalizedFrom) > 20
    ) {
      this.isRunning = false;
      throw new Error('Khoảng năm tra cứu không hợp lệ hoặc vượt quá 20 năm.');
    }
    const safeFrom = Math.min(normalizedFrom, normalizedTo);
    const safeTo = Math.max(normalizedFrom, normalizedTo);
    const totalYears = safeTo - safeFrom + 1;

    let discoveredIds = new Set<string>();
    let downloadedIds = new Set<string>();
    let failedIds = new Set<string>();
    let resumeYear = safeFrom;
    let resumePage = 1;
    let lastProcessedYear = safeFrom;
    let lastProcessedPage = 1;

    const checkpoint = this.checkpointStore.loadCheckpoint(
      params.taxpayerId,
      safeFrom,
      safeTo
    );
    if (checkpoint && checkpoint.status !== 'COMPLETED' && checkpoint.status !== 'CANCELLED') {
      discoveredIds = new Set(checkpoint.discoveredMessageIds);
      downloadedIds = new Set(checkpoint.downloadedMessageIds);
      failedIds = new Set(checkpoint.failedMessageIds);
      resumeYear = checkpoint.currentYear;
      resumePage = Math.min(10_000, checkpoint.currentPage + 1);
    }

    try {
      this.transitionTo('CHECK_DVC_SESSION');
      this.emitProgress({
        currentYear: resumeYear,
        yearFrom: safeFrom,
        yearTo: safeTo,
        currentPage: 1,
        totalPages: 1,
        totalRecordsInYear: 0,
        foundFilingsCount: discoveredIds.size,
        downloadedCount: downloadedIds.size,
        skippedCount: 0,
        errorCount: failedIds.size,
        status: 'SSO_INITIALIZING'
      });
      await this.client.ensureEtaxSession();
      this.assertActive(activeGeneration);

      this.transitionTo('OPEN_FILING_LOOKUP');

      // Vòng lặp tuần tự từng năm
      for (let y = resumeYear; y <= safeTo; y++) {
        if (!this.isActive(activeGeneration)) break;

        console.log(`[LegacyFilingLookupWorkflow] Bắt đầu tra cứu năm ${y} (${y - safeFrom + 1}/${totalYears})...`);

        let currentPage = y === resumeYear ? resumePage : 1;
        let totalPagesForYear = 1;
        let totalRecordsInYear = 0;
        const seenMessageIdsThisYear = new Set<string>();
        const seenPageFingerprints = new Set<string>();
        const MAX_PAGES_PER_YEAR = 1000;

        // Phân trang trong từng năm
        while (
          currentPage <= totalPagesForYear &&
          currentPage <= MAX_PAGES_PER_YEAR &&
          this.isActive(activeGeneration)
        ) {
          lastProcessedYear = y;
          lastProcessedPage = currentPage;
          this.transitionTo(currentPage === 1 ? 'SUBMIT_SEARCH' : 'FETCH_NEXT_PAGE', `Năm ${y}, Trang ${currentPage}`);

          this.emitProgress({
            currentYear: y,
            yearFrom: safeFrom,
            yearTo: safeTo,
            currentPage,
            totalPages: totalPagesForYear,
            totalRecordsInYear,
            foundFilingsCount: this.allDiscoveredFilings.length,
            downloadedCount: downloadedIds.size,
            skippedCount: 0,
            errorCount: failedIds.size,
            status: 'SCANNING'
          });

          // Jitter giữa các trang để tôn trọng cổng thuế
          await new Promise(r => setTimeout(r, 300 + Math.random() * 300));
          this.assertActive(activeGeneration);

          const pageResult = await this.client.queryFilings(y, {
            maTKhai: params.maTKhai || '00',
            page: currentPage,
            signal: this.abortController?.signal
          });
          this.assertActive(activeGeneration);

          this.transitionTo('PARSE_RESULTS', `Năm ${y}, Trang ${currentPage}: tìm thấy ${pageResult.filings.length} hồ sơ`);

          totalPagesForYear = Math.min(
            MAX_PAGES_PER_YEAR,
            Math.max(currentPage, pageResult.pagination.totalPages || 1)
          );
          totalRecordsInYear = pageResult.pagination.totalRecords || pageResult.filings.length;
          const fingerprint = pageResult.filings
            .map(filing => filing.messageId || filing.id)
            .sort()
            .join('|');
          if (fingerprint && seenPageFingerprints.has(fingerprint)) {
            const loopError = new Error(`eTax lặp lại nội dung trang ${currentPage}; đã dừng để tránh vòng lặp request.`);
            Object.assign(loopError, { code: 'FORM_CHANGED' });
            throw loopError;
          }
          if (fingerprint) seenPageFingerprints.add(fingerprint);

          // Dedupe và ghi nhận hồ sơ
          let newRecordsInPage = 0;
          for (const f of pageResult.filings) {
            if (!seenMessageIdsThisYear.has(f.id)) {
              seenMessageIdsThisYear.add(f.id);
              discoveredIds.add(f.id);

              // Kiểm tra cache đã tải hay chưa
              const preCheck = this.fileOrganizer.checkPreDownloadStatus(params.taxpayerId, f, y);
              if (preCheck.isAlreadyDownloaded) {
                f.downloadStatus = 'EXISTING';
                f.downloadedFiles = {
                  xml: preCheck.savedPaths?.[0],
                  other: preCheck.savedPaths?.slice(1)
                };
              }

              this.allDiscoveredFilings.push(f);
              newRecordsInPage++;
            }
          }

          for (const hr of pageResult.historicalRecords) {
            if (!this.allHistoricalRecords.some(r => r.messageId === hr.messageId)) {
              this.allHistoricalRecords.push(hr);
            }
          }

          // Lưu Checkpoint sau mỗi trang
          this.checkpointStore.saveCheckpoint({
            taxpayerId: params.taxpayerId,
            yearFrom: safeFrom,
            yearTo: safeTo,
            currentYear: y,
            currentPage,
            discoveredMessageIds: Array.from(discoveredIds),
            downloadedMessageIds: Array.from(downloadedIds),
            failedMessageIds: Array.from(failedIds),
            status: 'IN_PROGRESS',
            updatedAt: new Date().toISOString()
          });

          // Nếu trang rỗng hoặc không có bản ghi mới -> dừng phân trang năm này
          if (pageResult.isEmpty) {
            break;
          }

          if (!pageResult.pagination.hasNextPage) {
            break;
          }

          currentPage++;
        }
      }

      if (!this.isActive(activeGeneration)) {
        this.transitionTo('CANCELLED');
        this.checkpointStore.saveCheckpoint({
          taxpayerId: params.taxpayerId,
          yearFrom: safeFrom,
          yearTo: safeTo,
          currentYear: Math.min(safeTo, Math.max(safeFrom, lastProcessedYear)),
          currentPage: Math.max(1, lastProcessedPage),
          discoveredMessageIds: Array.from(discoveredIds),
          downloadedMessageIds: Array.from(downloadedIds),
          failedMessageIds: Array.from(failedIds),
          status: 'CANCELLED',
          updatedAt: new Date().toISOString()
        });
      } else {
        this.transitionTo('COMPLETED');
        this.checkpointStore.saveCheckpoint({
          taxpayerId: params.taxpayerId,
          yearFrom: safeFrom,
          yearTo: safeTo,
          currentYear: safeTo,
          currentPage: 1,
          discoveredMessageIds: Array.from(discoveredIds),
          downloadedMessageIds: Array.from(downloadedIds),
          failedMessageIds: Array.from(failedIds),
          status: 'COMPLETED',
          updatedAt: new Date().toISOString()
        });
        this.emitProgress({
          currentYear: safeTo,
          yearFrom: safeFrom,
          yearTo: safeTo,
          currentPage: 1,
          totalPages: 1,
          totalRecordsInYear: this.allDiscoveredFilings.length,
          foundFilingsCount: this.allDiscoveredFilings.length,
          downloadedCount: downloadedIds.size,
          skippedCount: 0,
          errorCount: failedIds.size,
          status: 'COMPLETED'
        });
      }

      return {
        filings: this.allDiscoveredFilings,
        historicalRecords: this.allHistoricalRecords
      };
    } catch (err: any) {
      if (err?.code === 'CANCELLED' || !this.isActive(activeGeneration)) {
        this.transitionTo('CANCELLED');
        return {
          filings: this.allDiscoveredFilings,
          historicalRecords: this.allHistoricalRecords
        };
      }
      const isAuthExpired = err?.code === 'AUTH_EXPIRED' || err?.message?.includes('hết hạn') || err?.message?.includes('đăng nhập');
      if (isAuthExpired) {
        this.transitionTo('AUTH_EXPIRED', err.message);
      } else if (err?.code === 'FORM_CHANGED') {
        this.transitionTo('FORM_CHANGED', err.message);
      } else if (err?.code === 'RATE_LIMIT' || err?.response?.status === 429) {
        this.transitionTo('RATE_LIMITED', err.message);
      } else {
        this.transitionTo('SEARCH_FAILED', err.message);
      }
      this.checkpointStore.saveCheckpoint({
        taxpayerId: params.taxpayerId,
        yearFrom: safeFrom,
        yearTo: safeTo,
        currentYear: Math.min(safeTo, Math.max(safeFrom, lastProcessedYear)),
        currentPage: Math.max(1, lastProcessedPage),
        discoveredMessageIds: Array.from(discoveredIds),
        downloadedMessageIds: Array.from(downloadedIds),
        failedMessageIds: Array.from(failedIds),
        status: isAuthExpired ? 'AUTH_EXPIRED' : 'FAILED',
        updatedAt: new Date().toISOString()
      });
      if (this.listenerCount('error') > 0) this.emit('error', err);
      throw err;
    } finally {
      this.isRunning = false;
    }
  }

  private emitProgress(progress: LegacyFilingScanProgress) {
    this.emit('progress', progress);
  }

  private isActive(generation: number): boolean {
    return generation === this.runGeneration && !this.isCancelled;
  }

  private assertActive(generation: number): void {
    if (!this.isActive(generation)) {
      const error = new Error('Tác vụ tra cứu năm cũ đã bị hủy.');
      Object.assign(error, { code: 'CANCELLED' });
      throw error;
    }
  }
}

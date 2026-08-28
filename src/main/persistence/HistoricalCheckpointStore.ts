import fs from 'fs';
import path from 'path';
import { HistoricalLookupCheckpoint } from '../../shared/types';
import { isValidTaxCode } from '../../shared/taxCodeUtils';
import { atomicWriteJson } from './atomicWrite';
import { safePathSegment } from './pathConfinement';

const MAX_CHECKPOINT_IDS = 50_000;
const VALID_STATUSES = new Set<HistoricalLookupCheckpoint['status']>([
  'IN_PROGRESS',
  'PAUSED',
  'AUTH_EXPIRED',
  'COMPLETED',
  'CANCELLED',
  'FAILED'
]);

export class HistoricalCheckpointStore {
  constructor(private baseDir: string) {}

  public setBaseDir(dir: string) {
    this.baseDir = dir;
  }

  private normalizeYear(value: unknown, fieldName: string): number {
    const year = Math.trunc(Number(value));
    if (!Number.isFinite(year) || year < 1900 || year > 2200) {
      throw new Error(`${fieldName} không hợp lệ.`);
    }
    return year;
  }

  private normalizeTaxpayerId(value: unknown): string {
    const taxpayerId = String(value || '').trim().toLowerCase();
    if (!isValidTaxCode(taxpayerId)) {
      throw new Error('Mã số thuế checkpoint không hợp lệ.');
    }
    return taxpayerId;
  }

  private normalizeIds(value: unknown, fieldName: string): string[] {
    if (!Array.isArray(value)) throw new Error(`${fieldName} không hợp lệ.`);
    if (value.length > MAX_CHECKPOINT_IDS) {
      throw new Error(`${fieldName} vượt giới hạn ${MAX_CHECKPOINT_IDS} phần tử.`);
    }
    const result = new Set<string>();
    for (const item of value) {
      const id = String(item || '').trim();
      if (!id || id.length > 256 || !/^[^\s"'<>()[\]{}&=?#\\/]{1,256}$/.test(id)) {
        continue;
      }
      result.add(id);
    }
    return [...result];
  }

  private normalizeCheckpoint(value: unknown): HistoricalLookupCheckpoint {
    if (!value || typeof value !== 'object') {
      throw new Error('Checkpoint năm cũ không phải object hợp lệ.');
    }
    const input = value as Partial<HistoricalLookupCheckpoint>;
    const taxpayerId = this.normalizeTaxpayerId(input.taxpayerId);
    const yearFrom = this.normalizeYear(input.yearFrom, 'Năm bắt đầu');
    const yearTo = this.normalizeYear(input.yearTo, 'Năm kết thúc');
    const minYear = Math.min(yearFrom, yearTo);
    const maxYear = Math.max(yearFrom, yearTo);
    const currentYear = this.normalizeYear(input.currentYear, 'Năm hiện tại');
    if (currentYear < minYear || currentYear > maxYear) {
      throw new Error('Năm hiện tại nằm ngoài khoảng checkpoint.');
    }
    const currentPage = Math.trunc(Number(input.currentPage));
    if (!Number.isFinite(currentPage) || currentPage < 1 || currentPage > 10_000) {
      throw new Error('Trang checkpoint không hợp lệ.');
    }
    const status = input.status as HistoricalLookupCheckpoint['status'];
    if (!VALID_STATUSES.has(status)) {
      throw new Error('Trạng thái checkpoint không hợp lệ.');
    }
    const updatedAt = String(input.updatedAt || '');
    if (!updatedAt || Number.isNaN(Date.parse(updatedAt))) {
      throw new Error('Thời điểm checkpoint không hợp lệ.');
    }

    return {
      taxpayerId,
      yearFrom: minYear,
      yearTo: maxYear,
      currentYear,
      currentPage,
      discoveredMessageIds: this.normalizeIds(input.discoveredMessageIds, 'Danh sách hồ sơ phát hiện'),
      downloadedMessageIds: this.normalizeIds(input.downloadedMessageIds, 'Danh sách hồ sơ đã tải'),
      failedMessageIds: this.normalizeIds(input.failedMessageIds, 'Danh sách hồ sơ lỗi'),
      status,
      updatedAt: new Date(updatedAt).toISOString()
    };
  }

  private getCheckpointFilePath(taxpayerId: string, yearFrom: number, yearTo: number): string {
    const safeTaxCode = safePathSegment(this.normalizeTaxpayerId(taxpayerId));
    const safeFrom = this.normalizeYear(yearFrom, 'Năm bắt đầu');
    const safeTo = this.normalizeYear(yearTo, 'Năm kết thúc');
    return path.join(
      this.baseDir,
      `.checkpoint_historical_${safeTaxCode}_${Math.min(safeFrom, safeTo)}_${Math.max(safeFrom, safeTo)}.json`
    );
  }

  public saveCheckpoint(checkpoint: HistoricalLookupCheckpoint): void {
    const safeData = this.normalizeCheckpoint({
      ...checkpoint,
      updatedAt: new Date().toISOString()
    });
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
    const targetPath = this.getCheckpointFilePath(
      safeData.taxpayerId,
      safeData.yearFrom,
      safeData.yearTo
    );
    // Không nuốt lỗi: workflow chỉ được báo tiến trình khi checkpoint thật sự
    // đã ghi bền vững xuống đĩa.
    atomicWriteJson(targetPath, safeData, true);
  }

  public loadCheckpoint(
    taxpayerId: string,
    yearFrom: number,
    yearTo: number
  ): HistoricalLookupCheckpoint | null {
    const filePath = this.getCheckpointFilePath(taxpayerId, yearFrom, yearTo);
    if (!fs.existsSync(filePath)) return null;
    try {
      return this.normalizeCheckpoint(JSON.parse(fs.readFileSync(filePath, 'utf-8')));
    } catch (error) {
      console.error('[HistoricalCheckpointStore] Checkpoint không hợp lệ:', error);
      return null;
    }
  }

  public clearCheckpoint(taxpayerId: string, yearFrom: number, yearTo: number): void {
    const filePath = this.getCheckpointFilePath(taxpayerId, yearFrom, yearTo);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}

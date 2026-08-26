import fs from 'fs';
import path from 'path';
import { ScanCoverageRecord } from '../../shared/coverageTypes';
import { atomicWriteJson } from './atomicWrite';
import { safePathSegment } from './pathConfinement';

export class CoverageStore {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  public setBaseDir(dir: string) {
    this.baseDir = dir;
  }

  private getCoverageFilePath(taxCode: string): string {
    // Defense-in-depth: taxpayerId đến từ portal/renderer — trước đây dùng
    // nguyên bản nên `..\` trong MST thoát được baseDir
    return path.join(this.baseDir, `.coverage_${safePathSegment(taxCode)}.json`);
  }

  public loadCoverage(taxCode: string): ScanCoverageRecord[] {
    try {
      const filePath = this.getCoverageFilePath(taxCode);
      if (!fs.existsSync(filePath)) return [];

      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content) as ScanCoverageRecord[];
      return Array.isArray(data) ? data : [];
    } catch (err) {
      console.error('Không thể đọc file coverage store:', err);
      return [];
    }
  }

  public saveCoverageRecord(record: ScanCoverageRecord): void {
    try {
      if (!fs.existsSync(this.baseDir)) {
        fs.mkdirSync(this.baseDir, { recursive: true });
      }

      const existing = this.loadCoverage(record.taxpayerId);
      // Dedupe theo coverageId hoặc cùng dải ngày + source
      const filtered = existing.filter(r => r.coverageId !== record.coverageId);
      filtered.push(record);

      const filePath = this.getCoverageFilePath(record.taxpayerId);
      atomicWriteJson(filePath, filtered, true);
    } catch (err) {
      console.error('Không thể lưu file coverage store:', err);
    }
  }

  public clearCoverage(taxCode: string): void {
    try {
      const filePath = this.getCoverageFilePath(taxCode);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.error('Không thể xóa coverage store:', err);
    }
  }
}

import fs from 'fs';
import path from 'path';
import { CheckpointData, TaxFiling } from '../../shared/types';
import { atomicWriteJson } from './atomicWrite';

export class CheckpointStore {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  public setBaseDir(dir: string) {
    this.baseDir = dir;
  }

  private getCheckpointFilePath(taxCode: string, year: number): string {
    // Defense-in-depth: chặn path traversal nếu caller quên validate
    const safeTaxCode = String(taxCode).replace(/[^0-9-]/g, '');
    const safeYear = Math.trunc(Number(year)) || new Date().getFullYear();
    return path.join(this.baseDir, `.checkpoint_${safeTaxCode}_${safeYear}.json`);
  }

  public saveCheckpoint(taxCode: string, year: number, filings: TaxFiling[]): void {
    try {
      if (!fs.existsSync(this.baseDir)) {
        fs.mkdirSync(this.baseDir, { recursive: true });
      }

      const states: CheckpointData['downloadStates'] = {};
      for (const f of filings) {
        states[f.id] = {
          status: f.downloadStatus || 'PENDING',
          savedPaths: [
            f.downloadedFiles?.xml,
            f.downloadedFiles?.pdf,
            ...(f.downloadedFiles?.other || [])
          ].filter(Boolean) as string[]
        };
      }

      const data: CheckpointData = {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        taxCode,
        year,
        targetDir: this.baseDir,
        filings,
        downloadStates: states
      };

      atomicWriteJson(this.getCheckpointFilePath(taxCode, year), data, true);
    } catch (err) {
      console.error('Không thể lưu file checkpoint:', err);
    }
  }

  public loadCheckpoint(taxCode: string, year: number): CheckpointData | null {
    try {
      const filePath = this.getCheckpointFilePath(taxCode, year);
      if (!fs.existsSync(filePath)) return null;

      const content = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content) as CheckpointData;
      return data;
    } catch (err) {
      console.error('Không thể đọc file checkpoint:', err);
      return null;
    }
  }

  public clearCheckpoint(taxCode: string, year: number): void {
    try {
      const filePath = this.getCheckpointFilePath(taxCode, year);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.error('Không thể xóa checkpoint:', err);
    }
  }
}

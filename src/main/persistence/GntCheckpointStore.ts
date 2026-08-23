import fs from 'fs';
import path from 'path';
import { DateRange, PaymentSlipRecord } from '../../shared/types';
import { atomicWriteJson } from './atomicWrite';

export interface GntCheckpointData {
  version: '1.0.0';
  timestamp: string;
  taxCode: string;
  year: number;
  /** Phạm vi ngày đã tra cứu GNT — phục vụ guard chống kết luận nợ thuế sai */
  dateRange?: DateRange;
  slips: PaymentSlipRecord[];
}

/**
 * Lưu trữ danh sách Giấy Nộp Tiền đã tra cứu theo (MST, năm) — đối xứng với
 * CheckpointStore của tờ khai. Nhờ đó nghĩa vụ thuế vẫn đối chiếu được ngay
 * sau khi khởi động lại app mà không cần gọi lại eTax.
 */
export class GntCheckpointStore {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  public setBaseDir(dir: string) {
    this.baseDir = dir;
  }

  private getFilePath(taxCode: string, year: number): string {
    // Defense-in-depth: chặn path traversal nếu caller quên validate
    const safeTaxCode = String(taxCode).replace(/[^0-9-]/g, '');
    const safeYear = Math.trunc(Number(year)) || new Date().getFullYear();
    return path.join(this.baseDir, `.gnt_${safeTaxCode}_${safeYear}.json`);
  }

  public save(taxCode: string, year: number, slips: PaymentSlipRecord[], dateRange?: DateRange): void {
    try {
      if (!fs.existsSync(this.baseDir)) {
        fs.mkdirSync(this.baseDir, { recursive: true });
      }

      const data: GntCheckpointData = {
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        taxCode,
        year,
        dateRange,
        slips
      };

      atomicWriteJson(this.getFilePath(taxCode, year), data, true);
    } catch (err) {
      console.error('Không thể lưu checkpoint Giấy Nộp Tiền:', err);
    }
  }

  public load(taxCode: string, year: number): GntCheckpointData | null {
    try {
      const filePath = this.getFilePath(taxCode, year);
      if (!fs.existsSync(filePath)) return null;

      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content) as GntCheckpointData;
    } catch (err) {
      console.error('Không thể đọc checkpoint Giấy Nộp Tiền:', err);
      return null;
    }
  }

  public clear(taxCode: string, year: number): void {
    try {
      const filePath = this.getFilePath(taxCode, year);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.error('Không thể xóa checkpoint Giấy Nộp Tiền:', err);
    }
  }
}

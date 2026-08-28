/**
 * GNT Statistics Engine — tổng hợp Giấy Nộp Tiền ĐÃ NỘP theo Tháng × Loại thuế.
 *
 * Nguồn dữ liệu:
 *  - PaymentSlipRecord (bảng danh sách): trạng thái + ngày nộp thuế
 *  - PaymentSlipDetail  (chi tiết C1-02/NS): từng khoản nộp có maNDKT + số tiền
 *
 * Phân loại lo?i thu?: qua Tiểu mục NDKT (TaxNdktClassifier):
 *  1001.. -> TNCN | 1701.. -> GTGT | 1052.. -> TNDN | 1055 -> Nhà thầu
 *  | 3801/3802/3805/3806/3901 -> Nhà đất | còn lại -> Khác
 * Khoản tiền khi KHÔNG lấy được chi tiết sẽ vào cột "Chưa phân loại" (giữ bảo toàn tiền).
 */
import { PaymentSlipDetail, PaymentSlipRecord } from '../../shared/types';
import { GntMoneyParser } from '../scanner/GntMoneyParser';
import { TaxNdktClassifier } from './TaxNdktClassifier';

export type GntStatBucket = 'VAT' | 'PIT' | 'CIT' | 'FCT' | 'HOUSE_LAND' | 'OTHER' | 'NO_DETAIL';

export const GNT_BUCKET_LABELS: Record<GntStatBucket, string> = {
  VAT: 'Thuế GTGT',
  PIT: 'Thuế TNCN',
  CIT: 'Thuế TNDN',
  FCT: 'Nhà thầu FCT',
  HOUSE_LAND: 'Thuế Nhà đất',
  OTHER: 'Lệ phí / Khác',
  NO_DETAIL: 'Chưa phân loại'
};

const BUCKET_ORDER: GntStatBucket[] = ['VAT', 'PIT', 'CIT', 'FCT', 'HOUSE_LAND', 'OTHER', 'NO_DETAIL'];

export interface GntStatsCell {
  monthKey: string;      // 'MM/yyyy' theo NGÀY NỘP THUẾ (fallback ngày lập)
  bucket: GntStatBucket;
  totalAmount: number;   // VND nguyên
  slipCount: number;     // số GNT đóng góp vào ô này
}

export interface GntStatisticsResult {
  cells: GntStatsCell[];
  monthKeys: string[];       // đã sort tăng dần
  activeBuckets: GntStatBucket[]; // chỉ các cột có số liệu (theo BUCKET_ORDER)
  paidCount: number;         // số GND tính vào thống kê (đã nộp thành công)
  skippedUnpaidCount: number;// bị loại vì chưa nộp/thất bại
  noDetailCount: number;     // trong paidCount, không fetch được chi tiết
  grandTotal: number;        // = tổng mọi cell (bảo toàn tiền)
}

function bucketOf(ndktCode?: string | null, description?: string | null): GntStatBucket {
  const t = TaxNdktClassifier.classify(ndktCode, description).taxType;
  if (t === 'VAT' || t === 'PIT' || t === 'CIT' || t === 'FCT' || t === 'HOUSE_LAND') return t;
  return 'OTHER';
}

/** Ngày nộp thuế ưu tiên; fallback ngày lập GNT. Trả về 'MM/yyyy' hoặc null nếu không parse được */
export function resolveMonthKey(record: Pick<PaymentSlipRecord, 'ngayNopThue' | 'ngayLapGnt'>): string | null {
  const raw = record.ngayNopThue || record.ngayLapGnt || '';
  const m = String(raw).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[2].padStart(2, '0')}/${m[3]}`;
}

function isPaidSuccess(record: PaymentSlipRecord): boolean {
  // Đủ điều kiện "đã nộp": có NGÀY NỘP THUẾ (đã ghi có tại KBNN/NH)
  if (!record.ngayNopThue) return false;
  const st = (record.trangThai || '').toLowerCase();
  // Loại rõ ràng thất bại/hủy; ngày nộp có mặt coi là dòng tiền thật
  return !(st.includes('không thành công') || st.includes('hủy') || st.includes('xoá') || st.includes('xóa'));
}

function parseVnd(formatted?: string): number {
  return GntMoneyParser.toSafeNumber(formatted ?? '');
}

export class GntStatisticsEngine {
  /**
   * @param slips danh sách GNT hiện đang hiển thị (đã lọc tìm kiếm của user)
   * @param detailMap chi tiết theo ctuId — thiếu phần tử => tiền cả giấy nộp vào NO_DETAIL
   */
  public static build(
    slips: PaymentSlipRecord[],
    detailMap: Map<string, PaymentSlipDetail | null>
  ): GntStatisticsResult {
    const acc = new Map<string, GntStatsCell>(); // key `${monthKey}|${bucket}`
    let paidCount = 0;
    let skippedUnpaidCount = 0;
    let noDetailCount = 0;
    let grandTotal = 0;

    const add = (monthKey: string, bucket: GntStatBucket, amount: number) => {
      const key = `${monthKey}|${bucket}`;
      const cell = acc.get(key);
      if (cell) {
        cell.totalAmount += amount;
        cell.slipCount += 1;
      } else {
        acc.set(key, { monthKey, bucket, totalAmount: amount, slipCount: 1 });
      }
      grandTotal += amount;
    };

    for (const slip of slips) {
      if (!isPaidSuccess(slip)) {
        skippedUnpaidCount++;
        continue;
      }
      const monthKey = resolveMonthKey(slip);
      if (!monthKey) {
        skippedUnpaidCount++;
        continue;
      }
      paidCount++;

      const detail = detailMap.get(slip.id);
      if (
        !detail ||
        !detail.items ||
        detail.items.length === 0 ||
        detail.suspectedMismatch ||
        detail.detailIntegrity === 'MISMATCH'
      ) {
        noDetailCount++;
        add(monthKey, 'NO_DETAIL', Math.round(slip.soTien || 0));
        continue;
      }

      // Phân rã từng khoản nộp theo NDKT; nếu tổng khoản lệch tổng giấy nộp
      // (dữ liệu lạ), phần chênh bù vào NO_DETAIL để luôn bảo toàn tiền.
      const allocations: Array<{ bucket: GntStatBucket; amount: number }> = [];
      let allocSum = 0;
      let allocationInvalid = false;
      for (const item of detail.items) {
        try {
          const amount = parseVnd(item.soTienVND);
          if (amount < 0) {
            allocationInvalid = true;
            break;
          }
          allocSum += amount;
          allocations.push({
            bucket: bucketOf(item.maNDKT, item.noiDungKhoanNop),
            amount
          });
        } catch {
          allocationInvalid = true;
          break;
        }
      }

      const listTotal = Math.round(slip.soTien || 0);
      let declaredTotal = listTotal;
      try {
        declaredTotal = parseVnd(detail.tongTienVND) || listTotal;
      } catch {}
      const targetTotal = listTotal > 0 ? listTotal : declaredTotal;
      if (allocationInvalid || allocSum > targetTotal) {
        noDetailCount++;
        add(monthKey, 'NO_DETAIL', targetTotal);
        continue;
      }

      for (const allocation of allocations) {
        add(monthKey, allocation.bucket, allocation.amount);
      }
      const diff = targetTotal - allocSum;
      if (diff > 0) add(monthKey, 'NO_DETAIL', diff);
    }

    const cells = [...acc.values()];
    const monthKeys = [...new Set(cells.map(c => c.monthKey))].sort((a, b) => {
      const [ma, ya] = a.split('/').map(Number);
      const [mb, yb] = b.split('/').map(Number);
      return ya - yb || ma - mb;
    });
    const activeBuckets = BUCKET_ORDER.filter(b => cells.some(c => c.bucket === b));

    return { cells, monthKeys, activeBuckets, paidCount, skippedUnpaidCount, noDetailCount, grandTotal };
  }

  /** Tổng một hàng tháng (mọi bucket) */
  public static rowTotal(result: GntStatisticsResult, monthKey: string): number {
    return result.cells.filter(c => c.monthKey === monthKey).reduce((a, c) => a + c.totalAmount, 0);
  }

  /** Tổng một cột loại thuế (mọi tháng) */
  public static columnTotal(result: GntStatisticsResult, bucket: GntStatBucket): number {
    return result.cells.filter(c => c.bucket === bucket).reduce((a, c) => a + c.totalAmount, 0);
  }

  public static amountOf(result: GntStatisticsResult, monthKey: string, bucket: GntStatBucket): number {
    return result.cells.find(c => c.monthKey === monthKey && c.bucket === bucket)?.totalAmount ?? 0;
  }
}

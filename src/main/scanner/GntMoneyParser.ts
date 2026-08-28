import { formatMoneyGroups, parseMoneyToBigInt } from '../../shared/moneyUtils';

export type MoneyParseStatus = 'VALID' | 'MISSING' | 'INVALID';

export interface MoneyParseResult {
  status: MoneyParseStatus;
  value: bigint;
  raw: string;
}

// Tập token coi là KHÔNG CÓ DỮ LIỆU — hợp của cả moneyUtils và các biến thể
// từng xuất hiện trên portal (trước đây 2 parser nhận diện khác nhau khiến
// cùng một ô trống bị xếp MISSING ở chỗ này, INVALID ở chỗ kia).
const MISSING_TOKENS = new Set([
  '', '-', '—', '--', 'blank', '&nbsp;', 'n/a', 'na', 'null', 'undefined'
]);

/**
 * Parse chuỗi tiền từ Cổng Thuế thành BigInt an toàn tuyệt đối.
 * Việc diễn giải số (dấu phân tách nghìn/thập phân, số âm trong ngoặc...) được
 * ỦY QUYỀN cho parseMoneyToBigInt (shared/moneyUtils) để TOÀN APP chỉ có MỘT
 * bộ quy tắc — trước đây nhánh else tự strip mọi dấu chấm/phẩy khiến "49.50"
 * thành 4950n trong khi moneyUtils cho 49n.
 */
export class GntMoneyParser {
  public static parse(rawInput?: string | number | bigint | null): MoneyParseResult {
    if (rawInput === undefined || rawInput === null) {
      return { status: 'MISSING', value: 0n, raw: '' };
    }

    if (typeof rawInput === 'bigint') {
      return { status: 'VALID', value: rawInput, raw: rawInput.toString() };
    }

    if (typeof rawInput === 'number') {
      if (isNaN(rawInput) || !isFinite(rawInput)) {
        return { status: 'INVALID', value: 0n, raw: String(rawInput) };
      }
      return { status: 'VALID', value: BigInt(Math.round(rawInput)), raw: String(rawInput) };
    }

    const rawStr = String(rawInput).trim();
    if (MISSING_TOKENS.has(rawStr.toLowerCase())) {
      return { status: 'MISSING', value: 0n, raw: rawStr };
    }

    // Không có chữ số nào → INVALID (giữ nguyên ngữ nghĩa cũ cho ô rác dữ liệu)
    if (!/\d/.test(rawStr)) {
      return { status: 'INVALID', value: 0n, raw: rawStr };
    }

    try {
      const value = parseMoneyToBigInt(rawStr);
      return { status: 'VALID', value, raw: rawStr };
    } catch {
      return { status: 'INVALID', value: 0n, raw: rawStr };
    }
  }

  public static formatVND(amount: bigint | number): string {
    return formatMoneyGroups(amount);
  }

  /**
   * Chỉ chuyển sang number tại biên tương thích UI/Excel khi còn chính xác.
   * Không âm thầm làm tròn bigint vượt Number.MAX_SAFE_INTEGER.
   */
  public static toSafeNumber(rawInput?: string | number | bigint | null): number {
    const parsed = this.parse(rawInput);
    if (parsed.status !== 'VALID') {
      throw new Error(`Giá trị tiền không hợp lệ: ${parsed.raw || '(trống)'}`);
    }
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    const min = BigInt(Number.MIN_SAFE_INTEGER);
    if (parsed.value > max || parsed.value < min) {
      throw new Error(`Giá trị tiền vượt giới hạn số nguyên an toàn: ${parsed.value}`);
    }
    return Number(parsed.value);
  }
}

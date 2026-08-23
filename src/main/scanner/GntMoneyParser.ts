export type MoneyParseStatus = 'VALID' | 'MISSING' | 'INVALID';

export interface MoneyParseResult {
  status: MoneyParseStatus;
  value: bigint;
  raw: string;
}

export class GntMoneyParser {
  /**
   * Parse chuỗi tiền từ Cổng Thuế thành BigInt an toàn tuyệt đối
   * Không dùng float Number() làm mất độ chính xác với số tiền lớn.
   */
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
    if (!rawStr || rawStr === '-' || rawStr === '—' || rawStr === 'blank' || rawStr === '&nbsp;') {
      return { status: 'MISSING', value: 0n, raw: rawStr };
    }

    // Xóa dấu phân tách hàng nghìn
    let cleaned = rawStr.replace(/[\s\t\r\n]/g, '');

    // Nếu có dạng 99,921,049.00 -> bỏ phần thập phân .00
    if (cleaned.includes('.') && cleaned.includes(',')) {
      if (cleaned.lastIndexOf('.') > cleaned.lastIndexOf(',')) {
        cleaned = cleaned.split('.')[0].replace(/,/g, '');
      } else {
        cleaned = cleaned.split(',')[0].replace(/\./g, '');
      }
    } else {
      cleaned = cleaned.replace(/[,.]/g, '');
    }

    const isNegative = cleaned.startsWith('-');
    const digitsOnly = isNegative ? cleaned.slice(1) : cleaned;

    if (!/^\d+$/.test(digitsOnly)) {
      return { status: 'INVALID', value: 0n, raw: rawStr };
    }

    try {
      const val = BigInt(digitsOnly);
      return {
        status: 'VALID',
        value: isNegative ? -val : val,
        raw: rawStr
      };
    } catch {
      return { status: 'INVALID', value: 0n, raw: rawStr };
    }
  }

  public static formatVND(amount: bigint | number): string {
    const val = typeof amount === 'bigint' ? amount : BigInt(Math.round(amount));
    const str = val.toString();
    const isNegative = str.startsWith('-');
    const absStr = isNegative ? str.slice(1) : str;
    const formatted = absStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return isNegative ? `-${formatted}` : formatted;
  }
}

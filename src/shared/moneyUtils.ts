/**
 * Safe Money Utilities sử dụng BigInt để đảm bảo 100% không bao giờ gặp lỗi mất độ chính xác Float
 */

export type MoneyParseStatus = 'VALID' | 'MISSING' | 'INVALID';

export interface MoneyParseResult {
  status: MoneyParseStatus;
  value: bigint;
  rawInput: unknown;
  isNegative: boolean;
}

/**
 * Phân tích số tiền nghiêm ngặt, phân biệt rõ ràng giữa MISSING (null/rỗng), INVALID (chuỗi lỗi) và VALID (kể cả 0n)
 */
export function parseMoneyStrict(val: unknown): MoneyParseResult {
  if (val === null || val === undefined) {
    return { status: 'MISSING', value: 0n, rawInput: val, isNegative: false };
  }
  if (typeof val === 'bigint') {
    return { status: 'VALID', value: val, rawInput: val, isNegative: val < 0n };
  }
  if (typeof val === 'number') {
    if (isNaN(val) || !isFinite(val)) {
      return { status: 'INVALID', value: 0n, rawInput: val, isNegative: false };
    }
    const b = BigInt(Math.round(val));
    return { status: 'VALID', value: b, rawInput: val, isNegative: b < 0n };
  }

  const rawStr = String(val).trim();
  if (!rawStr || rawStr === '—' || rawStr === '-' || rawStr === 'N/A' || rawStr === 'null' || rawStr === 'undefined') {
    return { status: 'MISSING', value: 0n, rawInput: val, isNegative: false };
  }

  // Kiểm tra xem có chứa ít nhất 1 chữ số hay không
  if (!/\d/.test(rawStr)) {
    return { status: 'INVALID', value: 0n, rawInput: val, isNegative: false };
  }

  const b = parseMoneyToBigInt(rawStr);
  return { status: 'VALID', value: b, rawInput: val, isNegative: b < 0n };
}

/**
 * Phân tích chuỗi số tiền bất kỳ sang BigInt (VND)
 * Xử lý được:
 * - "1.234.567.890" (Dấu chấm ngăn cách hàng nghìn)
 * - "1,234,567,890" (Dấu phẩy ngăn cách hàng nghìn)
 * - "-5000000" / "(5.000.000)" (Số âm)
 * - "0" / "" / null / undefined -> 0n
 */
export function parseMoneyToBigInt(val: unknown): bigint {
  if (val === null || val === undefined) return 0n;
  if (typeof val === 'bigint') return val;
  if (typeof val === 'number') {
    if (isNaN(val) || !isFinite(val)) return 0n;
    return BigInt(Math.round(val));
  }

  let str = String(val).trim();
  if (!str) return 0n;

  // Xử lý số âm trong ngoặc: (100.000) -> -100000
  let isNegative = false;
  if (str.startsWith('(') && str.endsWith(')')) {
    isNegative = true;
    str = str.slice(1, -1).trim();
  } else if (str.startsWith('-')) {
    isNegative = true;
    str = str.substring(1).trim();
  } else if (str.startsWith('+')) {
    str = str.substring(1).trim();
  }

  // Loại bỏ các ký tự chữ cái, đơn vị tiền tệ như "đ", "VND", "₫"
  str = str.replace(/[^\d.,]/g, '');
  if (!str) return 0n;

  // Xác định dấu phân cách hàng nghìn vs thập phân
  // Nếu có cả dấu . và , -> ví dụ "1.234.567,89" hoặc "1,234,567.89"
  if (str.includes('.') && str.includes(',')) {
    const lastDot = str.lastIndexOf('.');
    const lastComma = str.lastIndexOf(',');
    if (lastDot > lastComma) {
      // Dấu chấm là thập phân: 1,234,567.89 -> bỏ dấu phẩy, lấy phần nguyên trước dấu chấm
      str = str.replace(/,/g, '').split('.')[0];
    } else {
      // Dấu phẩy là thập phân: 1.234.567,89 -> bỏ dấu chấm, lấy phần nguyên trước dấu phẩy
      str = str.replace(/\./g, '').split(',')[0];
    }
  } else if (str.includes('.')) {
    // Chỉ có dấu chấm: nếu có từ 2 dấu chấm trở lên (1.000.000) -> chắc chắn là hàng nghìn
    const dots = str.split('.');
    if (dots.length > 2) {
      str = dots.join('');
    } else if (dots.length === 2) {
      // 1 dấu chấm: nếu phần sau có đúng 3 chữ số (100.000) -> hàng nghìn
      if (dots[1].length === 3) {
        str = dots.join('');
      } else {
        // phần sau khác 3 chữ số -> xem như phần thập phân, CẮT PHẦN LẺ
        // (hành vi được pin bởi tests: '100.50' -> 100n)
        str = dots[0];
      }
    }
  } else if (str.includes(',')) {
    // Chỉ có dấu phẩy: tương tự
    const commas = str.split(',');
    if (commas.length > 2) {
      str = commas.join('');
    } else if (commas.length === 2) {
      if (commas[1].length === 3) {
        str = commas.join('');
      } else {
        // Phần thập phân -> cắt phần lẻ (khớp hành vi nhánh dấu chấm)
        str = commas[0];
      }
    }
  }

  try {
    const result = BigInt(str);
    return isNegative ? -result : result;
  } catch {
    return 0n;
  }
}

/**
 * Format BigInt sang chuỗi hiển thị tiền tệ tiếng Việt
 * 1234567890n -> "1.234.567.890 ₫" (hoặc "1.234.567.890" nếu noUnit=true)
 */
export function formatMoneyVND(val: bigint | number | undefined, options?: { showUnit?: boolean; showSign?: boolean }): string {
  if (val === undefined || val === null) return '0 ₫';
  const bigVal = typeof val === 'bigint' ? val : BigInt(Math.round(val));
  const isNegative = bigVal < 0n;
  const absVal = isNegative ? -bigVal : bigVal;

  const str = absVal.toString();
  // Chèn dấu chấm ngăn cách 3 chữ số
  let formatted = '';
  for (let i = str.length - 1, count = 0; i >= 0; i--, count++) {
    if (count > 0 && count % 3 === 0) {
      formatted = '.' + formatted;
    }
    formatted = str[i] + formatted;
  }

  let sign = '';
  if (isNegative) {
    sign = '-';
  } else if (options?.showSign && bigVal > 0n) {
    sign = '+';
  }

  const unit = options?.showUnit === false ? '' : ' ₫';
  return `${sign}${formatted}${unit}`;
}

/**
 * Format số thành chuỗi nhóm 3 chữ số bằng dấu PHẨY (kiểu en-US, đúng định dạng
 * eTax phục vụ: 154446648n -> "154,446,648"), không kèm đơn vị.
 * Đây là implementation DUY NHẤT cho kiểu nhóm phẩy — trước đây GntMoneyParser
 * và các chỗ toLocaleString('vi-VN') tự render 2 định dạng khác nhau trong
 * cùng 1 màn hình (154,446,648 vs 154.446.648).
 */
export function formatMoneyGroups(val: bigint | number | undefined | null): string {
  if (val === undefined || val === null) return '0';
  const bigVal = typeof val === 'bigint' ? val : BigInt(Math.round(val));
  const str = bigVal.toString();
  const isNegative = str.startsWith('-');
  const absStr = isNegative ? str.slice(1) : str;
  const formatted = absStr.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return isNegative ? `-${formatted}` : formatted;
}

/**
 * Chuyển BigInt sang kiểu Number thuần túy cho Cell Excel (vẫn giữ đúng giá trị số)
 */
export function bigIntToExcelNumber(val: bigint | undefined): number {
  if (val === undefined || val === null) return 0;
  return Number(val);
}

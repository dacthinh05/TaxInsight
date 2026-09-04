import path from 'path';

/**
 * Xử lý chuỗi tên file an toàn cho hệ điều hành Windows & Linux
 * Loại bỏ các ký tự cấm: < > : " / \ | ? *
 * Rút gọn độ dài và xử lý khoảng trắng dư thừa.
 */
export function sanitizeFilename(input: string, fallback = 'document'): string {
  if (!input || typeof input !== 'string') {
    return fallback;
  }

  // Thay thế ký tự cấm trên Windows bằng dấu gạch dưới
  let sanitized = input.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');

  // Chuẩn hóa khoảng trắng
  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  // Loại bỏ dấu chấm hoặc khoảng trắng ở cuối (Windows không cho phép)
  sanitized = sanitized.replace(/[. ]+$/, '');

  // Kiểm tra tên thiết bị cấm trên Windows (CON, PRN, AUX, NUL, COM1..9, LPT1..9)
  const baseNameWithoutExt = sanitized.split('.')[0].toUpperCase();
  const WINDOWS_RESERVED_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
  if (WINDOWS_RESERVED_NAMES.test(baseNameWithoutExt)) {
    sanitized = `DOC_${sanitized}`;
  }

  // Giới hạn độ dài tên file (150 ký tự an toàn)
  if (sanitized.length > 150) {
    sanitized = sanitized.substring(0, 150).trim().replace(/[. ]+$/, '');
  }

  return sanitized || fallback;
}

/**
 * Kiểm tra tính an toàn của đường dẫn giải nén file ZIP (Zip Slip Protection)
 * Đảm bảo đường dẫn đích sau khi resolve nằm hoàn toàn bên trong thư mục giải nén chỉ định.
 */
export function isSafeExtractionPath(targetDir: string, entryName: string): boolean {
  if (!targetDir || !entryName) return false;

  const normalizedTargetDir = path.resolve(targetDir);
  const resolvedPath = path.resolve(targetDir, entryName);

  // Đường dẫn resolved phải bắt đầu bằng normalizedTargetDir + dấu phân cách
  return resolvedPath.startsWith(normalizedTargetDir + path.sep) || resolvedPath === normalizedTargetDir;
}

/**
 * Chống Formula Injection (CSV / Excel Injection) thông minh:
 * - Giữ nguyên các giá trị kiểu Number (kể cả số âm như -120000, -35.5)
 * - Phát hiện và khử độc chuỗi công thức:
 *   =..., +<formula>, -<formula>, @..., \t=..., \r=..., \n=...
 * - Không làm hỏng các số hợp lệ dạng chuỗi như "-12345", "-123.45", "+100"
 */
export function sanitizeExcelCellValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  // Nếu là số thuần túy (Number), giữ nguyên 100% kiểu Number
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value !== 'string') {
    return value;
  }

  // Kiểm tra xem chuỗi có phải là một số hợp lệ thuần túy không (vd: "-12345", "-35.5", "+100")
  // CHỈ chuyển đổi khi:
  //  - Phần nguyên KHÔNG có số 0 đứng đầu ("0102030405" là mã số thuế -> giữ nguyên dạng text)
  //  - Phần nguyên <= 15 chữ số (Number mất chính xác trên 2^53)
  const trimmed = value.trim();
  if (/^[+-]?(?:0|[1-9]\d{0,14})(?:\.\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (!isNaN(num)) {
      return num; // Chuyển đổi về Number để Excel hiểu đúng định dạng số
    }
  }

  // Phát hiện các tiền tố công thức nguy hiểm trong chuỗi: =, @, tab, newline, carriage return
  // Đối với dấu + hoặc - chỉ vô hiệu hóa nếu KHÔNG PHẢI là số hợp lệ
  const startsWithDangerousFormula =
    /^(?:[\t\r\n\s]*[=@]|[\t\r\n\s]*[+\-](?!\d+(?:\.\d+)?$))/.test(value);

  if (startsWithDangerousFormula) {
    return `'${value}`;
  }

  return value;
}

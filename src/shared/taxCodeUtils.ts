const TAX_CODE_PATTERN = /^\d{10}(?:-\d{3}|-[a-z][a-z0-9]{0,9})?$/i;

/**
 * Chấp nhận MST chuẩn, MST chi nhánh và hậu tố tài khoản eTax như "-q1".
 * Chỉ chữ/số được phép trong hậu tố để giá trị vẫn an toàn khi dùng làm tên thư mục.
 */
export function isValidTaxCode(value: unknown): value is string {
  return typeof value === 'string' && TAX_CODE_PATTERN.test(value.trim());
}


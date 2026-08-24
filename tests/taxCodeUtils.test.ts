import { describe, expect, it } from 'vitest';
import { isValidTaxCode } from '../src/shared/taxCodeUtils';

describe('isValidTaxCode', () => {
  it('chấp nhận MST chuẩn, chi nhánh và hậu tố tài khoản eTax', () => {
    expect(isValidTaxCode('3700364103')).toBe(true);
    expect(isValidTaxCode('3700364103-001')).toBe(true);
    expect(isValidTaxCode('3700364103-q1')).toBe(true);
    expect(isValidTaxCode(' 3700364103-QL ')).toBe(true);
  });

  it('từ chối ký tự có thể tạo đường dẫn hoặc MST sai cấu trúc', () => {
    expect(isValidTaxCode('../3700364103')).toBe(false);
    expect(isValidTaxCode('3700364103/q1')).toBe(false);
    expect(isValidTaxCode('3700364103-q_1')).toBe(false);
    expect(isValidTaxCode('370036410')).toBe(false);
  });
});


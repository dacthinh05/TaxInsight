/**
 * Phân loại Giấy Nộp Tiền theo Loại thuế + Kỳ thuế.
 *
 * Nguồn dữ liệu: PaymentSlipDetail.items (chi tiết Mẫu C1-02/NS — từng khoản nộp
 * có Tiểu mục NDKT, kỳ thuế, nội dung khoản nộp). Sắc thuế được suy ra qua
 * TaxNdktClassifier (mã tiểu mục chính thức theo Thông tư 324/2016/TT-BTC).
 */
import { PaymentSlipClassification, PaymentSlipDetail, PaymentSlipRecord } from './types';
import { TaxNdktClassifier } from '../main/engine/TaxNdktClassifier';

export type SlipTaxTypeKey = NonNullable<PaymentSlipClassification['taxTypes'][number]>;

/** Nhãn tiếng Việt dùng cho xuất Excel / hiển thị dạng text */
export const SLIP_TAX_TYPE_LABELS: Record<SlipTaxTypeKey, string> = {
  VAT: 'Thuế GTGT',
  PIT: 'Thuế TNCN',
  CIT: 'Thuế TNDN',
  FCT: 'Thuế nhà thầu',
  HOUSE_LAND: 'Thuế Nhà đất',
  OTHER: 'Lệ phí / Khác'
};

const normalizeTypeKey = (taxType: string): SlipTaxTypeKey => {
  switch (taxType) {
    case 'VAT':
    case 'PIT':
    case 'CIT':
    case 'FCT':
    case 'HOUSE_LAND':
      return taxType;
    default:
      return 'OTHER';
  }
};

/**
 * Rút phân loại từ chi tiết C1-02. Trả về null nếu chưa có chi tiết
 * (chưa tải hoặc GNT không đọc được bảng khoản nộp).
 */
export function classifyPaymentSlip(detail?: PaymentSlipDetail | null): PaymentSlipClassification | null {
  if (!detail || !detail.items || detail.items.length === 0) return null;

  const taxTypes = new Set<SlipTaxTypeKey>();
  const periods = new Set<string>();
  const ndktCodes = new Set<string>();

  for (const item of detail.items) {
    const result = TaxNdktClassifier.classify(item.maNDKT, item.noiDungKhoanNop);
    taxTypes.add(normalizeTypeKey(result.taxType));

    const period = (item.kyThueNgayQd || '').trim();
    if (period) periods.add(period);

    const code = (item.maNDKT || '').trim();
    if (code) ndktCodes.add(code);
  }

  if (taxTypes.size === 0 && periods.size === 0 && ndktCodes.size === 0) return null;

  return {
    taxTypes: [...taxTypes],
    periods: [...periods],
    ndktCodes: [...ndktCodes]
  };
}

/** Gắn classification vào record (bất biến — trả object mới nếu có phân loại mới) */
export function enrichSlipWithClassification(
  slip: PaymentSlipRecord,
  detailMap: Map<string, PaymentSlipDetail>
): PaymentSlipRecord {
  if (slip.classification) return slip;
  const classification = classifyPaymentSlip(detailMap.get(slip.id));
  return classification ? { ...slip, classification } : slip;
}

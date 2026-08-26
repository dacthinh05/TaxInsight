import { FilingMetricItem } from './types';
import { parseMoneyToBigInt } from './moneyUtils';

export interface FormattedDeclarationMetric {
  code?: string;
  label: string;
  formattedValue: string;
  rawValue: string;
  type: 'money' | 'quantity' | 'percentage' | 'integer' | 'decimal' | 'date' | 'identifier' | 'text';
  unit?: string;
  group: string;
  isHighlight?: boolean;
  isAnomaly: boolean;
  anomalyWarning?: string;
}

/**
 * Format giá trị chỉ tiêu kê khai tài chính / nhân sự theo chuẩn kế toán Việt Nam
 * Đảm bảo:
 * - Tiền: dấu chấm phân cách + đơn vị '₫' (vd: 6.028.107.381 ₫)
 * - Nhân sự: số nguyên format + 'người' (vd: 125 người)
 * - Tỷ lệ: số format + '%' (vd: 10%)
 * - Bất thường: cảnh báo nếu số lượng nhân sự > 100.000 (dấu hiệu sai lệch / nhầm trường)
 * - Identifier: giữ nguyên không thêm dấu phân cách
 */
export function formatDeclarationValue(item: FilingMetricItem): FormattedDeclarationMetric {
  const raw = String(item.value ?? '').trim();
  const label = item.label || '';
  const code = item.code || '';
  const group = item.group || inferDefaultGroup(code, label);

  if (!raw || raw === '—' || raw === '-') {
    return {
      code,
      label,
      formattedValue: '—',
      rawValue: raw,
      type: 'text',
      group,
      isHighlight: item.isHighlight,
      isAnomaly: false
    };
  }

  // Xác định data type nếu chưa truyền
  const inferredType = item.type || inferMetricType(code, label, raw);

  // 1. Text & Identifier
  if (inferredType === 'identifier' || inferredType === 'text' || inferredType === 'date') {
    return {
      code,
      label,
      formattedValue: raw,
      rawValue: raw,
      type: inferredType,
      group,
      isHighlight: item.isHighlight,
      isAnomaly: false
    };
  }

  // Parse số học — dùng parser tiền chuẩn của app: trước đây Number("1.234")
  // hiểu "1.234" là số thập phân 1.234 → làm tròn thành "1 ₫" (mất 3 bậc),
  // chuỗi nhiều dấu chấm thành NaN rồi bị ép thành text.
  if (!/\d/.test(raw)) {
    return {
      code,
      label,
      formattedValue: raw,
      rawValue: raw,
      type: 'text',
      group,
      isHighlight: item.isHighlight,
      isAnomaly: false
    };
  }
  const num = Number(parseMoneyToBigInt(raw));
  const isNaNNum = !Number.isFinite(num);

  if (isNaNNum) {
    return {
      code,
      label,
      formattedValue: raw,
      rawValue: raw,
      type: 'text',
      group,
      isHighlight: item.isHighlight,
      isAnomaly: false
    };
  }

  // 2. Quantity / Nhân sự (Số người lao động, số lượng...)
  if (inferredType === 'quantity' || item.unit === 'người' || isPersonnelCode(code)) {
    const formattedNum = new Intl.NumberFormat('vi-VN').format(Math.round(num));
    const unitStr = item.unit || 'người';
    // Nếu số người > 100.000 trong 1 tờ khai đơn lẻ -> Bất thường dữ liệu
    const isAnomaly = num > 100000;
    return {
      code,
      label,
      formattedValue: `${formattedNum} ${unitStr}`,
      rawValue: raw,
      type: 'quantity',
      unit: unitStr,
      group,
      isHighlight: item.isHighlight,
      isAnomaly,
      anomalyWarning: isAnomaly ? 'Giá trị bất thường (kiểm tra lại số tiền / số người)' : undefined
    };
  }

  // 3. Percentage (%)
  if (inferredType === 'percentage' || item.unit === '%') {
    const formattedNum = new Intl.NumberFormat('vi-VN').format(num);
    return {
      code,
      label,
      formattedValue: `${formattedNum}%`,
      rawValue: raw,
      type: 'percentage',
      unit: '%',
      group,
      isHighlight: item.isHighlight,
      isAnomaly: num > 100
    };
  }

  // 4. Money (VNĐ)
  if (inferredType === 'money' || item.unit === '₫' || item.unit === 'đ' || raw.includes('đ') || raw.includes('₫')) {
    const formattedNum = new Intl.NumberFormat('vi-VN').format(Math.round(num));
    return {
      code,
      label,
      formattedValue: `${formattedNum} ₫`,
      rawValue: raw,
      type: 'money',
      unit: '₫',
      group,
      isHighlight: item.isHighlight,
      isAnomaly: false
    };
  }

  // 5. Integer
  const formattedNum = new Intl.NumberFormat('vi-VN').format(Math.round(num));
  return {
    code,
    label,
    formattedValue: item.unit ? `${formattedNum} ${item.unit}` : formattedNum,
    rawValue: raw,
    type: 'integer',
    unit: item.unit,
    group,
    isHighlight: item.isHighlight,
    isAnomaly: false
  };
}

function isPersonnelCode(code?: string): boolean {
  if (!code) return false;
  const clean = code.replace(/[\[\]]/g, '').trim();
  return clean === '21' || clean === '22' || clean === '23';
}

function inferMetricType(code: string, label: string, raw: string): 'money' | 'quantity' | 'percentage' | 'integer' | 'text' {
  const l = label.toLowerCase();
  const c = code.toLowerCase();

  if (l.includes('người') || l.includes('lao động') || isPersonnelCode(code)) {
    return 'quantity';
  }
  if (l.includes('tỷ lệ') || l.includes('phần trăm') || raw.includes('%')) {
    return 'percentage';
  }
  if (
    l.includes('thuế') ||
    l.includes('doanh thu') ||
    l.includes('thu nhập') ||
    l.includes('tiền') ||
    l.includes('khấu trừ') ||
    l.includes('giá trị') ||
    l.includes('lợi nhuận') ||
    l.includes('chi phí') ||
    c.includes('27') ||
    c.includes('31') ||
    c.includes('34') ||
    c.includes('35') ||
    c.includes('40') ||
    c.includes('43')
  ) {
    return 'money';
  }
  if (/^-?\d+$/.test(raw.trim())) {
    return 'integer';
  }
  return 'text';
}

function inferDefaultGroup(code: string, label: string): string {
  const l = label.toLowerCase();
  const c = code.replace(/[\[\]]/g, '').trim();

  if (l.includes('người') || l.includes('lao động') || c === '21' || c === '22' || c === '23') {
    return 'NHÂN SỰ';
  }
  if (
    l.includes('thu nhập') ||
    l.includes('tiền lương') ||
    l.includes('khấu trừ thuế') ||
    l.includes('thuế tncn') ||
    c === '27' ||
    c === '28' ||
    c === '31' ||
    c === '32'
  ) {
    return 'THU NHẬP & THUẾ TNCN';
  }
  if (c === '22' || c === '23' || c === '24' || c === '25' || l.includes('mua vào')) {
    return 'HÀNG HÓA, DỊCH VỤ MUA VÀO (ĐẦU VÀO)';
  }
  if (c === '29' || c === '34' || c === '35' || l.includes('bán ra')) {
    return 'HÀNG HÓA, DỊCH VỤ BÁN RA (ĐẦU RA)';
  }
  if (c === '37' || c === '38' || c === '40' || c === '42' || c === '43' || l.includes('phải nộp')) {
    return 'NGHĨA VỤ THUẾ TRONG KỲ';
  }
  return 'CHỈ TIÊU KÊ KHAI CHÍNH';
}

/**
 * Lấy tên tiếng Việt, nhãn ngắn và style badge chuẩn cho từng sắc thuế
 */
export function getTaxTypeLabel(taxType?: string, declarationCode?: string): {
  vietnameseName: string;
  shortLabel: string;
  badgeClass: string;
} {
  const code = (declarationCode || '').toUpperCase();
  const type = (taxType || '').toUpperCase();

  if (code.includes('01/HT') || type === 'REFUND') {
    return {
      vietnameseName: 'Hoàn thuế GTGT',
      shortLabel: 'Hoàn thuế',
      badgeClass: 'bg-teal-50 text-teal-800 border-teal-200'
    };
  }

  if (code.includes('01/GTGT') || code.includes('04/GTGT') || type === 'VAT') {
    return {
      vietnameseName: 'Thuế GTGT',
      shortLabel: 'GTGT',
      badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-200'
    };
  }

  if (code.includes('TNCN') || code.includes('05/KK') || code.includes('05/QTT') || type === 'PIT') {
    return {
      vietnameseName: 'Thuế TNCN',
      shortLabel: 'TNCN',
      badgeClass: 'bg-blue-50 text-blue-800 border-blue-200'
    };
  }

  if (code.includes('TNDN') || code.includes('03/TNDN') || type === 'CIT') {
    return {
      vietnameseName: 'Thuế TNDN',
      shortLabel: 'TNDN',
      badgeClass: 'bg-purple-50 text-purple-800 border-purple-200'
    };
  }

  if (code.includes('NTNN') || code.includes('01/NTNN') || type === 'FCT') {
    return {
      vietnameseName: 'Thuế Nhà thầu',
      shortLabel: 'Nhà thầu',
      badgeClass: 'bg-rose-50 text-rose-800 border-rose-200'
    };
  }

  if (type === 'HOUSE_LAND' || code.includes('SDĐPNN') || code.includes('NHÀ ĐẤT')) {
    return {
      vietnameseName: 'Thuế Nhà đất',
      shortLabel: 'Nhà đất',
      badgeClass: 'bg-amber-50 text-amber-900 border-amber-200'
    };
  }

  if (code.includes('BC26') || code.includes('BCTC') || type === 'REPORT') {
    return {
      vietnameseName: 'Báo cáo / Hóa đơn',
      shortLabel: 'Báo cáo',
      badgeClass: 'bg-slate-100 text-slate-700 border-slate-200'
    };
  }

  return {
    vietnameseName: 'Thủ tục / Khác',
    shortLabel: 'Khác',
    badgeClass: 'bg-slate-100 text-slate-600 border-slate-200'
  };
}

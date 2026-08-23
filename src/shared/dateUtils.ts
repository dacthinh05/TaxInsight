import { DateRange, MissingPeriodCheck, PeriodNormalized, TaxFiling } from './types';

/**
 * Chuẩn hóa kỳ kê khai thuế GTGT và tạo normalized key
 */
export function normalizeVatPeriod(rawPeriod: string, fallbackDate?: string): {
  type: 'MONTH' | 'QUARTER' | 'YEAR' | 'UNKNOWN';
  label: string;
  key: string;
  year: number;
  month?: number;
  quarter?: number;
} {
  const clean = (rawPeriod || '').trim();

  // 0. Dạng khoảng ngày: 01/01/2026 - 31/03/2026 (phải kiểm tra TRƯỚC dạng Tháng,
  //    nếu không chuỗi range sẽ khớp nhầm "02/2026" thành Tháng 02)
  const rangeMatch = clean.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s*(?:-|–|—|→|->|đến)\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  if (rangeMatch) {
    const fromDay = parseInt(rangeMatch[1], 10);
    const fromMonth = parseInt(rangeMatch[2], 10);
    const fromYear = parseInt(rangeMatch[3], 10);
    const toMonth = parseInt(rangeMatch[5], 10);
    const toYear = parseInt(rangeMatch[6], 10);

    if (fromYear === toYear && fromDay === 1) {
      // Cả năm: 01/01 -> 31/12
      if (fromMonth === 1 && toMonth === 12) {
        return { type: 'YEAR', label: `Năm ${fromYear}`, key: `${fromYear}-YEAR`, year: fromYear };
      }
      // Đúng biên quý: Q1 01-03, Q2 04-06, Q3 07-09, Q4 10-12
      const quarterBounds: Array<[number, number, number]> = [[1, 3, 1], [4, 6, 2], [7, 9, 3], [10, 12, 4]];
      const qHit = quarterBounds.find(([fm, tm]) => fm === fromMonth && tm === toMonth);
      if (qHit) {
        return {
          type: 'QUARTER',
          label: `Quý ${qHit[2]}/${fromYear}`,
          key: `${fromYear}-Q${qHit[2]}`,
          year: fromYear,
          quarter: qHit[2]
        };
      }
      // Cả một tháng: 01/MM -> cuối MM
      if (fromMonth === toMonth && fromMonth >= 1 && fromMonth <= 12) {
        return {
          type: 'MONTH',
          label: `${pad2(fromMonth)}/${fromYear}`,
          key: `${fromYear}-M${pad2(fromMonth)}`,
          year: fromYear,
          month: fromMonth
        };
      }
    }

    // Khoảng ngày không chuẩn -> UNKNOWN (thay vì khớp nhầm thành một tháng cụ thể)
    return {
      type: 'UNKNOWN',
      label: clean || 'Kỳ chưa xác định',
      key: `UNKNOWN_${clean || 'NA'}`,
      year: 0
    };
  }

  // 1. Dạng Tháng MM/YYYY (vd: 01/2026, Tháng 01/2026, 1/2026)
  const mMatch = clean.match(/(?:Tháng\s*)?(\d{1,2})[\/\-](\d{4})/i);
  if (mMatch && !clean.toLowerCase().includes('quý') && !clean.toLowerCase().includes('q')) {
    const m = parseInt(mMatch[1], 10);
    const y = parseInt(mMatch[2], 10);
    if (m >= 1 && m <= 12) {
      let validYear = y;
      if (validYear < 1990 || validYear > 2099) {
        if (validYear === 2202) validYear = 2022;
        else if (fallbackDate) {
          const dm = fallbackDate.match(/\b(20\d{2})\b/);
          if (dm) validYear = parseInt(dm[1], 10);
        }
      }
      const padM = m < 10 ? `0${m}` : `${m}`;
      return {
        type: 'MONTH',
        label: `${padM}/${validYear}`,
        key: `${validYear}-M${padM}`,
        year: validYear,
        month: m
      };
    }
  }

  // 2. Dạng Quý Q/YYYY (vd: Quý 1/2026, Q1/2026)
  const qMatch = clean.match(/(?:Quý\s*|Q)(\d)[\/\-](\d{4})/i);
  if (qMatch) {
    const q = parseInt(qMatch[1], 10);
    const y = parseInt(qMatch[2], 10);
    if (q >= 1 && q <= 4) {
      return {
        type: 'QUARTER',
        label: `Quý ${q}/${y}`,
        key: `${y}-Q${q}`,
        year: y,
        quarter: q
      };
    }
  }

  // 3. Dạng Năm YYYY (vd: 2025, Năm 2025)
  const yMatch = clean.match(/(?:Năm\s*)?(\b\d{4}\b)/i);
  if (yMatch) {
    const y = parseInt(yMatch[1], 10);
    return {
      type: 'YEAR',
      label: `Năm ${y}`,
      key: `${y}-YEAR`,
      year: y
    };
  }

  return {
    type: 'UNKNOWN',
    label: clean || 'Kỳ chưa xác định',
    key: `UNKNOWN_${clean || 'NA'}`,
    year: 0
  };
}

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

export function formatVietnameseDate(d: Date): string {
  const day = pad2(d.getDate());
  const month = pad2(d.getMonth() + 1);
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export function getLastDayOfMonth(year: number, month1To12: number): number {
  return new Date(year, month1To12, 0).getDate();
}

/**
 * Tạo Range Level 1: Toàn bộ năm hoặc Đến ngày hiện tại
 */
export function generateYearRange(year: number, limitToToday = false): DateRange {
  const currentYear = new Date().getFullYear();
  let toDate = `31/12/${year}`;
  let label = `Cả năm ${year}`;

  if (limitToToday && year === currentYear) {
    toDate = formatVietnameseDate(new Date());
    label = `Từ 01/01 đến ${toDate}`;
  }

  return {
    fromDate: `01/01/${year}`,
    toDate,
    label,
    level: 'YEAR'
  };
}

/**
 * Tạo Range Level 2: 4 Quý trong năm
 */
export function generateQuarterRanges(year: number): DateRange[] {
  return [
    { fromDate: `01/01/${year}`, toDate: `31/03/${year}`, label: `Quý 1/${year}`, level: 'QUARTER' },
    { fromDate: `01/04/${year}`, toDate: `30/06/${year}`, label: `Quý 2/${year}`, level: 'QUARTER' },
    { fromDate: `01/07/${year}`, toDate: `30/09/${year}`, label: `Quý 3/${year}`, level: 'QUARTER' },
    { fromDate: `01/10/${year}`, toDate: `31/12/${year}`, label: `Quý 4/${year}`, level: 'QUARTER' }
  ];
}

/**
 * Tạo Range Level 3: 12 Tháng trong năm
 */
export function generateMonthRanges(year: number): DateRange[] {
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const lastDay = getLastDayOfMonth(year, month);
    return {
      fromDate: `01/${pad2(month)}/${year}`,
      toDate: `${pad2(lastDay)}/${pad2(month)}/${year}`,
      label: `Tháng ${pad2(month)}/${year}`,
      level: 'MONTH' as const
    };
  });
}

/**
 * Tạo Range Level 4: 3 khoảng 10 ngày trong tháng (01-10, 11-20, 21-cuối tháng)
 * Dùng khi một tháng có số lượng hồ sơ lớn chạm trần giới hạn Cổng Thuế
 */
export function generateSubMonthRanges(monthRange: DateRange): DateRange[] {
  const parts = monthRange.fromDate.split('/');
  if (parts.length !== 3) return [monthRange];
  const mm = parts[1];
  const yyyy = parts[2];
  const lastDay = monthRange.toDate.split('/')[0];

  return [
    {
      fromDate: `01/${mm}/${yyyy}`,
      toDate: `10/${mm}/${yyyy}`,
      label: `01-10/${mm}/${yyyy}`,
      level: 'MONTH'
    },
    {
      fromDate: `11/${mm}/${yyyy}`,
      toDate: `20/${mm}/${yyyy}`,
      label: `11-20/${mm}/${yyyy}`,
      level: 'MONTH'
    },
    {
      fromDate: `21/${mm}/${yyyy}`,
      toDate: `${lastDay}/${mm}/${yyyy}`,
      label: `21-${lastDay}/${mm}/${yyyy}`,
      level: 'MONTH'
    }
  ];
}

/**
 * Tạo Range Level 5: Chia 1 khoảng 10 ngày thành 2 khoảng 5 ngày
 */
export function generateSubDecadeRanges(tenDayRange: DateRange): DateRange[] {
  const [dFromStr, mm, yyyy] = tenDayRange.fromDate.split('/');
  const [dToStr] = tenDayRange.toDate.split('/');
  const dFrom = parseInt(dFromStr, 10);
  const dTo = parseInt(dToStr, 10);

  if (dTo - dFrom < 3) {
    return generateDailyRanges(tenDayRange);
  }

  const mid = Math.floor((dFrom + dTo) / 2);

  return [
    {
      fromDate: `${pad2(dFrom)}/${mm}/${yyyy}`,
      toDate: `${pad2(mid)}/${mm}/${yyyy}`,
      label: `${pad2(dFrom)}-${pad2(mid)}/${mm}/${yyyy}`,
      level: 'MONTH'
    },
    {
      fromDate: `${pad2(mid + 1)}/${mm}/${yyyy}`,
      toDate: `${pad2(dTo)}/${mm}/${yyyy}`,
      label: `${pad2(mid + 1)}-${pad2(dTo)}/${mm}/${yyyy}`,
      level: 'MONTH'
    }
  ];
}

/**
 * Tạo Range Level 6: Chia thành từng ngày đơn lẻ (Daily level)
 */
export function generateDailyRanges(range: DateRange): DateRange[] {
  const [dFromStr, mm, yyyy] = range.fromDate.split('/');
  const [dToStr] = range.toDate.split('/');
  const dFrom = parseInt(dFromStr, 10);
  const dTo = parseInt(dToStr, 10);

  const days: DateRange[] = [];
  for (let d = dFrom; d <= dTo; d++) {
    const padD = pad2(d);
    days.push({
      fromDate: `${padD}/${mm}/${yyyy}`,
      toDate: `${padD}/${mm}/${yyyy}`,
      label: `${padD}/${mm}/${yyyy}`,
      level: 'MONTH'
    });
  }
  return days;
}

/**
 * Phân giải mode quét (Năm / Quý / Tháng) thành đối tượng DateRange chính xác
 */
export function resolveScanDateRange(year: number, mode: string): DateRange {
  const currentYear = new Date().getFullYear();
  const todayStr = formatVietnameseDate(new Date());

  if (mode === 'MULTI_3_YEARS') {
    const startY = currentYear - 2;
    return {
      fromDate: `01/01/${startY}`,
      toDate: todayStr,
      label: `3 năm gần nhất (${startY} – ${currentYear})`,
      level: 'MULTI_YEAR'
    };
  }

  if (mode === 'MULTI_5_YEARS') {
    const startY = currentYear - 4;
    return {
      fromDate: `01/01/${startY}`,
      toDate: todayStr,
      label: `5 năm quyết toán (${startY} – ${currentYear})`,
      level: 'MULTI_YEAR'
    };
  }

  if (mode === 'YEAR_TO_DATE') {
    return {
      fromDate: `01/01/${year}`,
      toDate: year === currentYear ? todayStr : `31/12/${year}`,
      label: year === currentYear ? `Từ 01/01 đến ${todayStr}` : `Cả năm ${year}`,
      level: 'YEAR'
    };
  }

  if (mode === 'FULL_YEAR') {
    // Để bắt trọn tờ khai Tháng 12, Quý 4 và Quyết toán năm (nộp vào T01, T02, T03 năm sau):
    const toDate = year < currentYear ? `31/03/${year + 1}` : (year === currentYear ? todayStr : `31/12/${year}`);
    return {
      fromDate: `01/01/${year}`,
      toDate,
      label: year < currentYear ? `Cả năm ${year} (Bao gồm QTT T03/${year + 1})` : `Cả năm ${year}`,
      level: 'YEAR'
    };
  }

  // Quý
  if (mode === 'Q1') {
    return { fromDate: `01/01/${year}`, toDate: `31/03/${year}`, label: `Quý 1/${year}`, level: 'QUARTER' };
  }
  if (mode === 'Q2') {
    return { fromDate: `01/04/${year}`, toDate: `30/06/${year}`, label: `Quý 2/${year}`, level: 'QUARTER' };
  }
  if (mode === 'Q3') {
    return { fromDate: `01/07/${year}`, toDate: `30/09/${year}`, label: `Quý 3/${year}`, level: 'QUARTER' };
  }
  if (mode === 'Q4') {
    return { fromDate: `01/10/${year}`, toDate: `31/12/${year}`, label: `Quý 4/${year}`, level: 'QUARTER' };
  }

  // Tháng (M01 -> M12)
  const monthMatch = mode.match(/^M(0?[1-9]|1[0-2])$/);
  if (monthMatch) {
    const m = parseInt(monthMatch[1], 10);
    const lastDay = getLastDayOfMonth(year, m);
    return {
      fromDate: `01/${pad2(m)}/${year}`,
      toDate: `${pad2(lastDay)}/${pad2(m)}/${year}`,
      label: `Tháng ${pad2(m)}/${year}`,
      level: 'MONTH'
    };
  }

  // Mặc định fallback cả năm
  return generateYearRange(year, false);
}

/**
 * Phân tích chuỗi kỳ kê khai thành đối tượng PeriodNormalized
 * Hỗ trợ các định dạng:
 * - 202601 -> Tháng 01/2026, 202612 -> Tháng 12/2026
 * - 2026Q1, 2026-Q1, Quý 1/2026, Q1/2026, Quý I/2026
 * - Tháng 01/2026, T01/2026, 01/2026, kỳ 01/2026
 * - 01/01/2026 - 31/03/2026 (nhận diện thành Quý 1/2026)
 * - Năm 2025, 2025
 * - Fallback: undefined nếu không có kỳ
 */
export function parseFilingPeriod(text?: string): PeriodNormalized | undefined {
  if (!text || typeof text !== 'string') return undefined;

  const trimmed = text.trim();
  if (!trimmed || trimmed === '—' || trimmed === '-' || trimmed.toLowerCase() === 'kỳ trong năm' || trimmed.toLowerCase() === 'không xác định') {
    return undefined;
  }

  // 1. Khớp định dạng Range: 01/01/2026 - 31/03/2026 hoặc 01/01/2026 → 31/03/2026 hoặc đến
  const rangeMatch = trimmed.match(/(\d{1,2})\/(\d{1,2})\/(20\d{2}|19\d{2})\s*(?:-|–|—|→|->|đến)\s*(\d{1,2})\/(\d{1,2})\/(20\d{2}|19\d{2})/i);
  if (rangeMatch) {
    const fromDay = parseInt(rangeMatch[1], 10);
    const fromMonth = parseInt(rangeMatch[2], 10);
    const fromYear = parseInt(rangeMatch[3], 10);
    const toDay = parseInt(rangeMatch[4], 10);
    const toMonth = parseInt(rangeMatch[5], 10);
    const toYear = parseInt(rangeMatch[6], 10);

    if (fromYear === toYear) {
      // Quý 1: 01/01 -> 31/03
      if (fromMonth === 1 && toMonth === 3 && fromDay === 1) {
        return { raw: `Quý 1/${fromYear}`, type: 'QUARTER', quarter: 1, year: fromYear };
      }
      // Quý 2: 01/04 -> 30/06
      if (fromMonth === 4 && toMonth === 6 && fromDay === 1) {
        return { raw: `Quý 2/${fromYear}`, type: 'QUARTER', quarter: 2, year: fromYear };
      }
      // Quý 3: 01/07 -> 30/09
      if (fromMonth === 7 && toMonth === 9 && fromDay === 1) {
        return { raw: `Quý 3/${fromYear}`, type: 'QUARTER', quarter: 3, year: fromYear };
      }
      // Quý 4: 01/10 -> 31/12
      if (fromMonth === 10 && toMonth === 12 && fromDay === 1) {
        return { raw: `Quý 4/${fromYear}`, type: 'QUARTER', quarter: 4, year: fromYear };
      }
      // Cả tháng: 01/MM -> cuối tháng MM
      if (fromMonth === toMonth && fromDay === 1) {
        return { raw: `Tháng ${pad2(fromMonth)}/${fromYear}`, type: 'MONTH', month: fromMonth, year: fromYear };
      }
      // Cả năm: 01/01 -> 31/12
      if (fromMonth === 1 && toMonth === 12 && fromDay === 1 && toDay === 31) {
        return { raw: `Năm ${fromYear}`, type: 'YEAR', year: fromYear };
      }
      return {
        raw: `${pad2(fromDay)}/${pad2(fromMonth)}/${fromYear} → ${pad2(toDay)}/${pad2(toMonth)}/${toYear}`,
        type: 'OTHER',
        year: fromYear
      };
    }
  }

  // 2. Khớp định dạng YYYYQ[1-4] hoặc YYYY-Q[1-4] hoặc YYYY/Q[1-4] (vd: 2026Q1, 2026-Q1, 2026/Q4)
  const yyyyQuarterMatch = trimmed.match(/\b(20\d{2}|19\d{2})[-_\/]?Q([1-4])\b/i);
  if (yyyyQuarterMatch) {
    const y = parseInt(yyyyQuarterMatch[1], 10);
    const q = parseInt(yyyyQuarterMatch[2], 10);
    return {
      raw: `Quý ${q}/${y}`,
      type: 'QUARTER',
      quarter: q,
      year: y
    };
  }

  // 3. Khớp Quý dạng thông dụng: Quý 1/2026, Q1/2026, Quý I/2026
  const quarterMatch = trimmed.match(/(?:Quý\s*|Q)([1-4]|I|II|III|IV)[\/\-\s]+(20\d{2}|19\d{2})/i);
  if (quarterMatch) {
    let q = 1;
    const qStr = quarterMatch[1].toUpperCase();
    if (qStr === '1' || qStr === 'I') q = 1;
    else if (qStr === '2' || qStr === 'II') q = 2;
    else if (qStr === '3' || qStr === 'III') q = 3;
    else if (qStr === '4' || qStr === 'IV') q = 4;

    const y = parseInt(quarterMatch[2], 10);
    return {
      raw: `Quý ${q}/${y}`,
      type: 'QUARTER',
      quarter: q,
      year: y
    };
  }

  // 4. Khớp định dạng YYYYMM (vd: 202601 -> Tháng 01/2026, 202612 -> Tháng 12/2026)
  // Chỉ match khi chuỗi là 6 chữ số đơn lẻ hoặc được bao quanh bởi ranh giới từ
  const yyyyMmMatch = trimmed.match(/\b(20\d{2}|19\d{2})(0[1-9]|1[0-2])\b/);
  if (yyyyMmMatch && (trimmed.length === 6 || trimmed.match(/^(?:kỳ\s+|tháng\s+)?(20\d{2}|19\d{2})(0[1-9]|1[0-2])$/i))) {
    const y = parseInt(yyyyMmMatch[1], 10);
    const m = parseInt(yyyyMmMatch[2], 10);
    return {
      raw: `Tháng ${pad2(m)}/${y}`,
      type: 'MONTH',
      month: m,
      year: y
    };
  }

  // 5. Khớp Tháng dạng thông dụng: Tháng 03/2026, T03/2026, 03/2026, kỳ 03/2026
  const monthMatch =
    trimmed.match(/(?:Tháng\s*|T\s*|\bkỳ\s+)(\d{1,2})[\/\-\s]+(20\d{2}|19\d{2})/i) ||
    trimmed.match(/\b(0?[1-9]|1[0-2])\/(20\d{2}|19\d{2})\b/);

  if (monthMatch) {
    const m = parseInt(monthMatch[1], 10);
    const y = parseInt(monthMatch[2], 10);
    if (m >= 1 && m <= 12) {
      return {
        raw: `Tháng ${pad2(m)}/${y}`,
        type: 'MONTH',
        month: m,
        year: y
      };
    }
  }

  // 6. Khớp Năm: Năm 2026, kỳ 2026, hoặc chuỗi chỉ chứa đúng 4 chữ số năm 20xx
  const yearMatch =
    trimmed.match(/(?:Năm\s*|\bkỳ\s+năm\s*|\bkỳ\s+)(20\d{2}|19\d{2})\b/i) ||
    (trimmed.match(/^(20\d{2}|19\d{2})$/) ? trimmed.match(/^(20\d{2}|19\d{2})$/) : null);

  if (yearMatch) {
    const y = parseInt(yearMatch[1], 10);
    return {
      raw: `Năm ${y}`,
      type: 'YEAR',
      year: y
    };
  }

  return undefined;
}

/**
 * Chuẩn hóa chuỗi tìm kiếm (Unicode NFD, bỏ dấu tiếng Việt, chữ thường, an toàn khi null)
 */
export function normalizeSearchText(text?: string | null): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tạo chuỗi tìm kiếm tổng hợp toàn diện cho 1 hồ sơ
 */
export function buildFilingSearchString(f: TaxFiling): string {
  const parts = [
    f.title,
    f.procedureCode,
    f.declarationCode,
    f.id,
    f.taxType,
    f.period,
    f.periodNormalized?.raw,
    f.filingType === 'SUPPLEMENTAL'
      ? `bổ sung lần ${f.supplementalNo || 1} bs bo sung lan`
      : 'chính thức lần đầu chinh thuc lan dau',
    f.status,
    f.submittedAt
  ];
  return normalizeSearchText(parts.filter(Boolean).join(' '));
}

/**
 * Tính khóa số học sắp xếp kỳ (Numeric period sort key): LATEST first
 * Quy về THÁNG KẾT THÚC của kỳ để so sánh đúng thứ tự thời gian cả khi
 * dữ liệu trộn tần suất Tháng/Quý/Năm (vd Q1/2025 kết thúc tháng 03 phải
 * xếp TRƯỚC Tháng 12/2025, sau Tháng 02/2025):
 * - Tháng M: Year * 1000 + M * 10        (T12/2025 -> 2025120)
 * - Quý Q:   Year * 1000 + (Q*3) * 10    (Q1/2025 -> 2025030)
 * - Năm:     Year * 1000 + 120           (= T12 của năm đó)
 * - Không có kỳ / Thủ tục: -1
 */
export function getPeriodNumericSortKey(f: TaxFiling): number {
  const norm = f.periodNormalized || parseFilingPeriod(f.period);
  if (!norm) return -1;

  const y = norm.year || 0;
  if (norm.type === 'MONTH' && norm.month) {
    return y * 1000 + norm.month * 10;
  }
  if (norm.type === 'QUARTER' && norm.quarter) {
    return y * 1000 + norm.quarter * 3 * 10;
  }
  if (norm.type === 'YEAR') {
    return y * 1000 + 120;
  }
  return y * 1000;
}

/**
 * Trọng số nhóm loại thuế:
 * 1. GTGT (VAT)
 * 2. TNCN (PIT)
 * 3. TNDN (CIT)
 * 4. BÁO CÁO / HÓA ĐƠN (REPORT)
 * 5. KHÁC / THỦ TỤC / NHÀ THẦU (OTHER)
 */
export const TAX_TYPE_ORDER: Record<string, number> = {
  VAT: 1,
  REFUND: 2,
  PIT: 3,
  CIT: 4,
  FCT: 5,
  HOUSE_LAND: 6,
  REPORT: 7,
  OTHER: 8,
  ALL: 99
};

/**
 * Chuyển chuỗi ngày nộp tiếng Việt (dd/MM/yyyy HH:mm:ss hoặc dd/MM/yyyy) thành epoch timestamp
 */
export function parseSubmissionTimestamp(dateStr?: string): number {
  if (!dateStr || typeof dateStr !== 'string') return 0;
  const m = dateStr.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (!m) return 0;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  const hour = m[4] ? parseInt(m[4], 10) : 0;
  const minute = m[5] ? parseInt(m[5], 10) : 0;
  const second = m[6] ? parseInt(m[6], 10) : 0;
  return new Date(year, month - 1, day, hour, minute, second).getTime();
}

/**
 * Tự động phân giải lần bổ sung (supplementalNo) theo thứ tự nộp khi API không trả sequence riêng biệt
 * Ưu tiên: metadata/API chính thức -> nếu trùng lặp/thiếu -> sắp xếp chronology (ASC) và đánh dấu isSequenceInferred
 */
export function resolvePeriodSupplementalSequences(filings: TaxFiling[]): TaxFiling[] {
  const groups = new Map<string, TaxFiling[]>();
  for (const f of filings) {
    const raw = f.period || f.periodNormalized?.raw || '—';
    const norm = normalizeVatPeriod(raw, f.submittedAt);
    const key = `${f.taxType}_${f.declarationCode || 'ALL'}_${norm.key}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(f);
  }

  const result: TaxFiling[] = [];
  for (const group of groups.values()) {
    const supplementals = group.filter(f => f.filingType === 'SUPPLEMENTAL');
    if (supplementals.length <= 1) {
      for (const f of group) {
        if (f.filingType === 'SUPPLEMENTAL' && !f.supplementalNo) {
          result.push({ ...f, supplementalNo: 1 });
        } else {
          result.push(f);
        }
      }
      continue;
    }

    // Kiểm tra xem các bản bổ sung có số thứ tự riêng biệt không
    const seqSet = new Set<number>();
    let hasDuplicateOrMissingSeq = false;
    for (const s of supplementals) {
      if (s.supplementalNo && s.supplementalNo > 0 && !seqSet.has(s.supplementalNo)) {
        seqSet.add(s.supplementalNo);
      } else {
        hasDuplicateOrMissingSeq = true;
        break;
      }
    }

    if (hasDuplicateOrMissingSeq) {
      // Sắp xếp theo ngày nộp tăng dần (Chronology ASC)
      const sortedSupps = [...supplementals].sort((a, b) => {
        const tA = parseSubmissionTimestamp(a.submittedAt);
        const tB = parseSubmissionTimestamp(b.submittedAt);
        return tA - tB;
      });

      const suppMap = new Map<string, { no: number; inferred: boolean }>();
      sortedSupps.forEach((s, idx) => {
        suppMap.set(s.id, { no: idx + 1, inferred: true });
      });

      for (const f of group) {
        if (f.filingType === 'SUPPLEMENTAL' && suppMap.has(f.id)) {
          const info = suppMap.get(f.id)!;
          result.push({
            ...f,
            supplementalNo: info.no,
            isSequenceInferred: info.inferred
          });
        } else {
          result.push(f);
        }
      }
    } else {
      for (const f of group) result.push(f);
    }
  }

  return result;
}

/**
 * Kiểm tra hồ sơ có bị cơ quan thuế từ chối / không chấp nhận / lỗi không
 */
export function isFilingRejected(filing?: { status?: string | null } | null): boolean {
  if (!filing || !filing.status) return false;
  const s = filing.status.toLowerCase().trim();
  return (
    s.includes('không chấp nhận') ||
    s.includes('từ chối') ||
    s.includes('không hợp lệ') ||
    s.includes('bị từ chối') ||
    s.includes('lỗi')
  );
}

/**
 * Phát hiện bất thường cấu trúc hồ sơ theo kỳ (Anomaly Detection)
 * Phân tích độc lập theo từng chuỗi mẫu biểu / sắc thuế (ví dụ: chuỗi 01/GTGT riêng, 05/KK-TNCN riêng)
 */
export function detectPeriodAnomalies(periodFilings: TaxFiling[]): import('./types').PeriodAnomalyType[] {
  const anomaliesSet = new Set<import('./types').PeriodAnomalyType>();
  if (!periodFilings || periodFilings.length === 0) return [];

  // Bỏ qua kiểm tra anomaly nếu là nhóm Hồ sơ không theo kỳ
  const isNoPeriodGroup = periodFilings.every(
    f => !f.period || f.period === '—' || f.period === 'Không xác định' || f.period === 'Kỳ trong năm'
  );
  if (isNoPeriodGroup) return [];

  // Gom theo từng dòng mẫu biểu / sắc thuế chính xác trong cùng 1 kỳ (taxType + declarationCode/procedureCode)
  const seriesMap = new Map<string, TaxFiling[]>();
  for (const f of periodFilings) {
    const formCode = f.declarationCode || (f.taxType === 'VAT' ? '01/GTGT' : (f.procedureCode || f.title));
    const key = `${f.taxType}_${formCode}`;
    if (!seriesMap.has(key)) seriesMap.set(key, []);
    seriesMap.get(key)!.push(f);
  }

  for (const series of seriesMap.values()) {
    // Chỉ kiểm tra chuỗi tờ khai thuế thực sự (GTGT, TNCN, TNDN, FCT, Nhà đất...)
    const isTaxDeclaration = series.some(
      f => f.taxType === 'VAT' || f.taxType === 'PIT' || f.taxType === 'CIT' || f.taxType === 'FCT' || f.taxType === 'HOUSE_LAND'
    );
    if (!isTaxDeclaration) continue;

    // Loại trừ các hồ sơ bị CQT từ chối / không chấp nhận khỏi việc tính toán xung đột pháp lý chính thức
    const validSeries = series.filter(f => !isFilingRejected(f));

    const originalCount = validSeries.filter(
      f => f.filingType === 'ORIGINAL' || f.filingType === 'PERIODIC' || f.filingType === 'FINALIZATION'
    ).length;

    const supplementalCount = validSeries.filter(
      f => f.filingType === 'SUPPLEMENTAL'
    ).length;

    // 1. Có bổ sung nhưng thiếu tờ khai chính thức trong cùng mẫu biểu (trong số hồ sơ hợp lệ)
    if (supplementalCount > 0 && originalCount === 0) {
      anomaliesSet.add('MISSING_OFFICIAL');
    }

    // 2. Nhiều hơn 1 bản chính thức hợp lệ cho CÙNG 1 mẫu biểu trong cùng kỳ
    if (originalCount > 1) {
      anomaliesSet.add('MULTIPLE_OFFICIAL');
    }

    // 3. Chuỗi bổ sung của mẫu biểu bị nhảy cóc (chỉ xét các bản hợp lệ)
    if (supplementalCount > 1) {
      const sequences = validSeries
        .filter(f => f.filingType === 'SUPPLEMENTAL' && f.supplementalNo)
        .map(f => f.supplementalNo!)
        .sort((a, b) => a - b);

      if (sequences.length > 1) {
        for (let i = 0; i < sequences.length - 1; i++) {
          if (sequences[i + 1] - sequences[i] > 1) {
            anomaliesSet.add('DISCONTINUOUS_SEQUENCE');
            break;
          }
        }
      }
    }
  }

  return Array.from(anomaliesSet);
}

/**
 * Pipeline sắp xếp nghiệp vụ kế toán chuẩn xác (Accounting Sort Pipeline):
 * 1. Loại thuế (GTGT -> Hoàn thuế -> TNCN -> TNDN -> Nhà thầu -> Báo cáo -> Khác)
 * 2. Kỳ kê khai DESC (Mới nhất lên trước: 11/2025 > 10/2025 > 08/2025 > 07/2025...)
 * 3. Bản chất hồ sơ cùng kỳ (Hoàn thuế -> Tờ khai chính / Quyết toán -> Khai bổ sung)
 * 4. Lần bổ sung (Lần 1 -> Lần 2 -> Lần 3...)
 * 5. Ngày nộp DESC (Mới nhất lên trước theo timestamp số học thực sự)
 */
export function compareFilings(a: TaxFiling, b: TaxFiling): number {
  // 1. Nhóm loại thuế
  const orderA = TAX_TYPE_ORDER[a.taxType] ?? 5;
  const orderB = TAX_TYPE_ORDER[b.taxType] ?? 5;
  if (orderA !== orderB) {
    return orderA - orderB;
  }

  // 2. Kỳ kê khai (DESC: Kỳ mới hơn lên trước, vd: 11/2025 > 10/2025 > 08/2025 > 07/2025...)
  const keyA = getPeriodNumericSortKey(a);
  const keyB = getPeriodNumericSortKey(b);
  if (keyA !== keyB) {
    return keyB - keyA;
  }

  // 3. Tính chất hồ sơ cùng kỳ: Hoàn thuế (1) -> Chính thức / Quyết toán (2) -> Bổ sung (3)
  const getNationRank = (f: TaxFiling) => {
    if (f.filingType === 'REFUND' || f.procedureCode === '1.007037' || f.procedureCode === '1.007039') return 1;
    if (f.filingType === 'ORIGINAL' || f.filingType === 'PERIODIC' || f.filingType === 'FINALIZATION') return 2;
    if (f.filingType === 'SUPPLEMENTAL') return 3;
    return 4;
  };
  const rankA = getNationRank(a);
  const rankB = getNationRank(b);
  if (rankA !== rankB) {
    return rankA - rankB;
  }

  // 4. Lần bổ sung (Lần 1 -> Lần 2 -> Lần 3...)
  const supA = a.supplementalNo || 1;
  const supB = b.supplementalNo || 1;
  if (a.filingType === 'SUPPLEMENTAL' && b.filingType === 'SUPPLEMENTAL' && supA !== supB) {
    return supA - supB; // Ascending: Lần 1 trước Lần 2
  }

  // 5. Ngày nộp (DESC: Mới nhất lên trước dựa trên epoch timestamp số học)
  const timeA = parseSubmissionTimestamp(a.submittedAt);
  const timeB = parseSubmissionTimestamp(b.submittedAt);
  return timeB - timeA;
}

/**
 * Kiểm tra các kỳ chưa tìm thấy trong dữ liệu đã quét (giới hạn đến tháng/quý hiện tại nếu là năm hiện hành)
 */
export function checkMissingPeriods(
  filings: TaxFiling[],
  year: number,
  taxType: 'VAT' | 'PIT',
  isScanComplete = true
): MissingPeriodCheck {
  const filtered = filings.filter(f => f.taxType === taxType);

  if (!isScanComplete || filtered.length === 0) {
    return {
      isCompleteData: false,
      taxType,
      periodType: 'MONTH',
      expectedPeriods: [],
      foundPeriods: [],
      missingPeriods: [],
      note: 'Chưa đủ dữ liệu để đối chiếu kỳ kê khai.'
    };
  }

  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const isCurrentYear = year === currentYear;

  // Xem NNT khai theo Tháng hay theo Quý nhiều hơn
  let monthCount = 0;
  let quarterCount = 0;
  const foundMonths = new Set<number>();
  const foundQuarters = new Set<number>();

  for (const f of filtered) {
    if (f.periodNormalized?.year === year) {
      if (f.periodNormalized.type === 'MONTH' && f.periodNormalized.month) {
        monthCount++;
        foundMonths.add(f.periodNormalized.month);
      } else if (f.periodNormalized.type === 'QUARTER' && f.periodNormalized.quarter) {
        quarterCount++;
        foundQuarters.add(f.periodNormalized.quarter);
      }
    }
  }

  // Nếu không xác định được tần suất kê khai tháng/quý
  if (monthCount === 0 && quarterCount === 0) {
    return {
      isCompleteData: false,
      taxType,
      periodType: 'MONTH',
      expectedPeriods: [],
      foundPeriods: [],
      missingPeriods: [],
      note: 'Chưa đủ dữ liệu để đối chiếu kỳ kê khai.'
    };
  }

  const isQuarterly = quarterCount > monthCount;
  if (isQuarterly) {
    const maxQuarter = isCurrentYear ? Math.max(1, Math.ceil(currentMonth / 3)) : 4;
    const quartersToCheck = Array.from({ length: maxQuarter }, (_, i) => i + 1);

    const expected = quartersToCheck.map(q => `Quý ${q}/${year}`);
    const found = Array.from(foundQuarters).sort((a, b) => a - b).map(q => `Quý ${q}/${year}`);
    const missing = quartersToCheck
      .filter(q => !foundQuarters.has(q))
      .map(q => `Quý ${q}/${year}`);

    return {
      isCompleteData: true,
      taxType,
      periodType: 'QUARTER',
      expectedPeriods: expected,
      foundPeriods: found,
      missingPeriods: missing
    };
  } else {
    const maxMonth = isCurrentYear ? currentMonth : 12;
    const monthsToCheck = Array.from({ length: maxMonth }, (_, i) => i + 1);

    const expected = monthsToCheck.map(m => `Tháng ${pad2(m)}/${year}`);
    const found = Array.from(foundMonths).sort((a, b) => a - b).map(m => `Tháng ${pad2(m)}/${year}`);
    const missing = monthsToCheck
      .filter(m => !foundMonths.has(m))
      .map(m => `Tháng ${pad2(m)}/${year}`);

    return {
      isCompleteData: true,
      taxType,
      periodType: 'MONTH',
      expectedPeriods: expected,
      foundPeriods: found,
      missingPeriods: missing
    };
  }
}

export interface FilingDisplayName {
  primaryTitle: string;
  detailText?: string;
}

/**
 * Định dạng kỳ kê khai cực kỳ ngắn gọn, chuyên nghiệp cho kế toán scan:
 * 06/2026, 05/2026, Q2/2026, Năm 2025
 */
export function formatCompactPeriod(f: TaxFiling): string {
  const norm = f.periodNormalized;
  if (norm) {
    if (norm.type === 'MONTH' && norm.month) {
      return `${String(norm.month).padStart(2, '0')}/${norm.year}`;
    }
    if (norm.type === 'QUARTER' && norm.quarter) {
      return `Q${norm.quarter}/${norm.year}`;
    }
    if (norm.type === 'YEAR') {
      return `Năm ${norm.year}`;
    }
    if (norm.raw) return norm.raw;
  }
  if (!f.period || f.period === 'Không xác định' || f.period === '—') return '—';
  const mMatch = f.period.match(/(?:Tháng\s*|T)(\d{1,2})[\/\-\s]+(\d{4})/i);
  if (mMatch) return `${mMatch[1].padStart(2, '0')}/${mMatch[2]}`;
  const qMatch = f.period.match(/Quý\s*(\d)[\/\-\s]+(\d{4})/i);
  if (qMatch) return `Q${qMatch[1]}/${qMatch[2]}`;
  return f.period;
}

/**
 * Tạo tên hiển thị chuẩn 1 dòng cho kế toán (Single-Line Accounting Typography):
 * - Khai thuế GTGT
 * - Hoàn thuế GTGT
 * - Khai bổ sung GTGT · Lần 1
 * - Quyết toán thuế TNCN
 * - Quyết toán thuế TNDN
 * - Thuế nhà thầu
 * - Đăng ký người phụ thuộc
 * - Thay đổi thông tin ĐK thuế
 */
export function getFilingDisplayName(filing: TaxFiling): FilingDisplayName {
  const rawTitle = (filing.title || '').trim();
  const code = (filing.procedureCode || '').trim();
  const declCode = (filing.declarationCode || '').trim();
  const lower = `${rawTitle} ${code} ${declCode}`.toLowerCase();

  // 1. Hoàn thuế GTGT
  if (code === '1.007037' || code === '1.007039' || lower.includes('hoàn thuế') || filing.filingType === 'REFUND') {
    return {
      primaryTitle: 'Hoàn thuế GTGT',
      detailText: code === '1.007039' ? 'Hàng hóa, dịch vụ xuất khẩu' : 'Doanh nghiệp, tổ chức'
    };
  }

  // 2. Khai bổ sung (chỉ giữ · Lần X để scan cực nhanh)
  if (code === '1.008327' || lower.includes('bổ sung') || filing.filingType === 'SUPPLEMENTAL') {
    const supNo = filing.supplementalNo || 1;
    let taxName = 'GTGT';
    if (declCode.includes('TNCN') || lower.includes('tncn') || filing.taxType === 'PIT') {
      taxName = 'TNCN';
    } else if (declCode.includes('TNDN') || lower.includes('tndn') || filing.taxType === 'CIT') {
      taxName = 'TNDN';
    } else if (declCode.includes('NTNN') || lower.includes('nhà thầu') || lower.includes('ntnn') || filing.taxType === 'FCT') {
      taxName = 'Nhà thầu';
    } else if (declCode.includes('01/HT') || lower.includes('hoàn thuế') || filing.taxType === 'REFUND') {
      taxName = 'Hoàn thuế';
    } else if (declCode.includes('BC26') || filing.taxType === 'REPORT') {
      taxName = 'Báo cáo';
    }
    return {
      primaryTitle: `Khai bổ sung ${taxName} · Lần ${supNo}`,
      detailText: declCode ? `Mẫu ${declCode}` : `Bổ sung lần ${supNo}`
    };
  }

  // 3. Quyết toán thuế TNDN
  if (
    code === '1.008346' ||
    declCode.includes('03/TNDN') ||
    (filing.filingType === 'FINALIZATION' && filing.taxType === 'CIT') ||
    (lower.includes('quyết toán') && (filing.taxType === 'CIT' || lower.includes('tndn') || lower.includes('doanh nghiệp')))
  ) {
    return {
      primaryTitle: 'Quyết toán thuế TNDN',
      detailText: declCode ? `Mẫu ${declCode}` : 'Khai quyết toán năm'
    };
  }

  // 4. Quyết toán thuế TNCN
  if (
    code === '1.008347' ||
    code === '1.008309' ||
    code === '2.002233' ||
    declCode.includes('QTT') ||
    (filing.filingType === 'FINALIZATION' && filing.taxType === 'PIT') ||
    (lower.includes('quyết toán') && (filing.taxType === 'PIT' || lower.includes('tncn') || lower.includes('cá nhân')))
  ) {
    return {
      primaryTitle: 'Quyết toán thuế TNCN',
      detailText: declCode ? `Mẫu ${declCode}` : 'Tổ chức trả thu nhập'
    };
  }

  // 5. Đăng ký người phụ thuộc (1.008500 / 20-ĐK-TH-TCT)
  if (code === '1.008500' || declCode.includes('20-ĐK') || lower.includes('người phụ thuộc')) {
    return {
      primaryTitle: 'Đăng ký người phụ thuộc',
      detailText: 'Mẫu 20-ĐK-TH-TCT'
    };
  }

  // 6. Thay đổi thông tin đăng ký thuế (1.008503)
  if (code === '1.008503' || lower.includes('thay đổi thông tin')) {
    return {
      primaryTitle: 'Thay đổi thông tin ĐK thuế',
      detailText: 'Thủ tục hành chính'
    };
  }

  // 7. Đăng ký thuế lần đầu (1.008498)
  if (code === '1.008498' || lower.includes('đăng ký thuế lần đầu')) {
    return {
      primaryTitle: 'Đăng ký thuế lần đầu',
      detailText: 'Thủ tục hành chính'
    };
  }

  // 8. Khai thuế GTGT chính thức
  if (filing.taxType === 'VAT' || code === '1.007014' || code === '1.007015' || declCode === '01/GTGT' || declCode === '04/GTGT') {
    return {
      primaryTitle: 'Khai thuế GTGT',
      detailText: declCode ? `Mẫu ${declCode}` : 'Phương pháp khấu trừ'
    };
  }

  // 9. Khai thuế TNCN (2.002235 / 05/KK-TNCN)
  if (filing.taxType === 'PIT' || code === '2.002235' || declCode.includes('TNCN')) {
    return {
      primaryTitle: 'Khai thuế TNCN',
      detailText: declCode ? `Mẫu ${declCode}` : 'Tổ chức trả thu nhập'
    };
  }

  // 10. Thuế nhà thầu (FCT - 01/NTNN, 02/NTNN, 03/NTNN, 04/NTNN, 1.008344, 1.008333...)
  if (
    filing.taxType === 'FCT' ||
    code === '1.008333' ||
    code === '1.008344' ||
    declCode.includes('NTNN') ||
    lower.includes('nhà thầu') ||
    lower.includes('ntnn')
  ) {
    return {
      primaryTitle: 'Thuế nhà thầu',
      detailText: declCode ? `Mẫu ${declCode}` : 'Nhà thầu nước ngoài'
    };
  }

  // 11. Thuế nhà đất & các khoản thu về đất (SDĐPNN, tiền sử dụng/thuê đất)
  if (
    filing.taxType === 'HOUSE_LAND' ||
    declCode.includes('SDĐPNN') ||
    lower.includes('nhà đất') ||
    lower.includes('sử dụng đất') ||
    lower.includes('thuê đất')
  ) {
    return {
      primaryTitle: 'Thuế nhà đất',
      detailText: declCode && declCode !== 'Nhà đất' ? `Mẫu ${declCode}` : 'Nhà đất & đất phi nông nghiệp'
    };
  }

  // 12. Báo cáo sử dụng hóa đơn
  if (declCode === 'BC26/AC' || lower.includes('hóa đơn')) {
    return {
      primaryTitle: 'Báo cáo sử dụng hóa đơn',
      detailText: 'Mẫu BC26/AC'
    };
  }

  // 13. Báo cáo tài chính
  if (declCode === 'BCTC' || lower.includes('tài chính')) {
    return {
      primaryTitle: 'Báo cáo tài chính',
      detailText: 'Bảng cân đối & KQKD'
    };
  }

  // 14. Mặc định
  const cleanTitle = rawTitle.replace(/^(\d+\.\d+|\d+\/\w+)\s*-\s*/, '');
  return {
    primaryTitle: cleanTitle.length > 40 ? cleanTitle.slice(0, 38) + '…' : cleanTitle || 'Hồ sơ thuế',
    detailText: code ? `Thủ tục ${code}` : 'Chính thức'
  };
}


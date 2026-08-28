export interface HolidayEntry {
  date: string; // ISO YYYY-MM-DD
  name: string;
}

export class BusinessDayCalendar {
  // Danh mục ngày nghỉ lễ chính thức của Việt Nam (Bộ luật Lao động)
  private static holidays: Record<string, string> = {
    // ─── NĂM 2024 ───────────────────────────────────────────────
    '2024-01-01': 'Tết Dương Lịch',
    '2024-02-08': 'Nghỉ Tết Nguyên Đán (29 Tết)',
    '2024-02-09': 'Nghỉ Tết Nguyên Đán (30 Tết)',
    '2024-02-10': 'Mùng 1 Tết Giáp Thìn',
    '2024-02-11': 'Mùng 2 Tết Giáp Thìn',
    '2024-02-12': 'Mùng 3 Tết Giáp Thìn',
    '2024-02-13': 'Nghỉ bù Tết Nguyên Đán',
    '2024-02-14': 'Nghỉ bù Tết Nguyên Đán',
    '2024-04-18': 'Giỗ Tổ Hùng Vương (10/3 AL)',
    '2024-04-30': 'Ngày Giải phóng miền Nam 30/4',
    '2024-05-01': 'Ngày Quốc tế Lao động 1/5',
    '2024-09-02': 'Quốc khánh 2/9',
    '2024-09-03': 'Nghỉ liền kề Quốc khánh',

    // ─── NĂM 2025 ───────────────────────────────────────────────
    '2025-01-01': 'Tết Dương Lịch',
    '2025-01-27': 'Nghỉ Tết Nguyên Đán (28 Tết)',
    '2025-01-28': 'Nghỉ Tết Nguyên Đán (29 Tết)',
    '2025-01-29': 'Mùng 1 Tết Ất Tỵ',
    '2025-01-30': 'Mùng 2 Tết Ất Tỵ',
    '2025-01-31': 'Mùng 3 Tết Ất Tỵ',
    '2025-02-01': 'Mùng 4 Tết Ất Tỵ',
    '2025-02-02': 'Mùng 5 Tết Ất Tỵ',
    '2025-04-07': 'Giỗ Tổ Hùng Vương (10/3 AL)',
    '2025-04-30': 'Ngày Giải phóng miền Nam 30/4',
    '2025-05-01': 'Ngày Quốc tế Lao động 1/5',
    '2025-05-02': 'Nghỉ hoán đổi / liền kề 30/4 - 1/5',
    '2025-09-01': 'Nghỉ liền kề Quốc khánh',
    '2025-09-02': 'Quốc khánh 2/9',

    // ─── NĂM 2026 ───────────────────────────────────────────────
    '2026-01-01': 'Tết Dương Lịch',
    '2026-02-15': 'Nghỉ Tết Nguyên Đán (28 Tết)',
    '2026-02-16': 'Nghỉ Tết Nguyên Đán (29 Tết)',
    '2026-02-17': 'Mùng 1 Tết Bính Ngọ',
    '2026-02-18': 'Mùng 2 Tết Bính Ngọ',
    '2026-02-19': 'Mùng 3 Tết Bính Ngọ',
    '2026-02-20': 'Mùng 4 Tết Bính Ngọ',
    '2026-02-21': 'Mùng 5 Tết Bính Ngọ',
    '2026-04-26': 'Giỗ Tổ Hùng Vương (10/3 AL)',
    '2026-04-27': 'Nghỉ bù Giỗ Tổ Hùng Vương',
    '2026-04-30': 'Ngày Giải phóng miền Nam 30/4',
    '2026-05-01': 'Ngày Quốc tế Lao động 1/5',
    '2026-09-01': 'Nghỉ liền kề Quốc khánh',
    '2026-09-02': 'Quốc khánh 2/9'
  };

  public static hasHolidayCoverage(year: number): boolean {
    return Object.keys(this.holidays).some(date => date.startsWith(`${year}-`));
  }

  /**
   * Kiểm tra một ngày có phải ngày nghỉ (Thứ 7, Chủ Nhật, hoặc Ngày lễ) hay không
   */
  public static isNonWorkingDay(date: Date): { isNonWorking: boolean; reason?: string } {
    const dayOfWeek = date.getDay(); // 0 = Sunday, 6 = Saturday
    if (dayOfWeek === 0) {
      return { isNonWorking: true, reason: 'Chủ Nhật' };
    }
    if (dayOfWeek === 6) {
      return { isNonWorking: true, reason: 'Thứ Bảy' };
    }

    const isoStr = this.formatIso(date);
    if (this.holidays[isoStr]) {
      return { isNonWorking: true, reason: this.holidays[isoStr] };
    }

    return { isNonWorking: false };
  }

  /**
   * Chuyển deadline sang ngày làm việc tiếp theo nếu rơi vào ngày nghỉ/ngày lễ
   * Theo quy định tại Khoản 1 Điều 86 Luật Quản lý thuế & Điều 10 Nghị định 126/2020 / NĐ 252/2026
   */
  public static adjustToNextBusinessDay(date: Date): {
    effectiveDate: Date;
    wasAdjusted: boolean;
    originalDate: Date;
    adjustmentReason?: string;
  } {
    const original = new Date(date.getTime());
    let current = new Date(date.getTime());
    let adjusted = false;
    const reasons: string[] = [];

    while (true) {
      const check = this.isNonWorkingDay(current);
      if (!check.isNonWorking) {
        break;
      }
      adjusted = true;
      if (check.reason && !reasons.includes(check.reason)) {
        reasons.push(check.reason);
      }
      // Dịch sang ngày tiếp theo (+1 ngày)
      current.setDate(current.getDate() + 1);
    }

    return {
      effectiveDate: current,
      wasAdjusted: adjusted,
      originalDate: original,
      adjustmentReason: adjusted ? `Trùng ${reasons.join(', ')} -> Chuyển sang ngày làm việc tiếp theo` : undefined
    };
  }

  private static formatIso(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}

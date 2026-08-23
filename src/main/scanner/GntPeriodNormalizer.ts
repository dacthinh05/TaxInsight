export interface NormalizedTaxPeriod {
  type: 'MONTH' | 'QUARTER' | 'YEAR' | 'PERIOD' | 'UNKNOWN';
  year: number;
  month?: number;
  quarter?: number;
  raw: string;
  displayPeriod: string;
}

export class GntPeriodNormalizer {
  /**
   * Chuẩn hóa chuỗi kỳ thuế từ bảng phân bổ GNT hoặc tờ khai
   * Ví dụ:
   * - "00/12/2025" -> Tháng 12 năm 2025
   * - "00/Q4/2025" -> Quý 4 năm 2025
   * - "00/00/2025" hoặc "2025" -> Năm 2025
   * - "12/2025" -> Tháng 12 năm 2025
   * - "Q3/2025" hoặc "03/2025"
   */
  public static normalize(rawPeriod?: string | null): NormalizedTaxPeriod | null {
    if (!rawPeriod || typeof rawPeriod !== 'string') return null;

    const trimmed = rawPeriod.trim();
    if (!trimmed || trimmed === '-' || trimmed === '—') return null;

    // 1. Dạng 00/MM/YYYY (rất phổ biến trong Mẫu C1-02/NS eTax, ví dụ "00/12/2025")
    const m00Month = trimmed.match(/^00\/(\d{1,2})\/(\d{4})$/);
    if (m00Month) {
      const month = parseInt(m00Month[1], 10);
      const year = parseInt(m00Month[2], 10);
      if (month >= 1 && month <= 12) {
        return {
          type: 'MONTH',
          year,
          month,
          raw: trimmed,
          displayPeriod: `Tháng ${month.toString().padStart(2, '0')}/${year}`
        };
      }
      if (month === 0) {
        return {
          type: 'YEAR',
          year,
          raw: trimmed,
          displayPeriod: `Năm ${year}`
        };
      }
    }

    // 2. Dạng 00/QX/YYYY hoặc QX/YYYY (ví dụ "00/Q4/2025", "Q4/2025")
    const mQuarter = trimmed.match(/^(?:00\/)?Q([1-4])\/(\d{4})$/i) || trimmed.match(/^(?:00\/)?QUÝ\s*([1-4])\/(\d{4})$/i);
    if (mQuarter) {
      const quarter = parseInt(mQuarter[1], 10);
      const year = parseInt(mQuarter[2], 10);
      return {
        type: 'QUARTER',
        year,
        quarter,
        raw: trimmed,
        displayPeriod: `Quý ${quarter}/${year}`
      };
    }

    // 3. Dạng MM/YYYY (ví dụ "12/2025")
    const mStandardMonth = trimmed.match(/^(\d{1,2})\/(\d{4})$/);
    if (mStandardMonth) {
      const month = parseInt(mStandardMonth[1], 10);
      const year = parseInt(mStandardMonth[2], 10);
      if (month >= 1 && month <= 12) {
        return {
          type: 'MONTH',
          year,
          month,
          raw: trimmed,
          displayPeriod: `Tháng ${month.toString().padStart(2, '0')}/${year}`
        };
      }
    }

    // 4. Dạng năm thuần túy (ví dụ "2025" hoặc "Năm 2025")
    const mYearOnly = trimmed.match(/^(?:Năm\s*)?(\d{4})$/i);
    if (mYearOnly) {
      const year = parseInt(mYearOnly[1], 10);
      return {
        type: 'YEAR',
        year,
        raw: trimmed,
        displayPeriod: `Năm ${year}`
      };
    }

    // 5. Không nhận diện được rõ ràng -> trả về UNKNOWN có bảo toàn raw
    const anyYear = trimmed.match(/(\d{4})/);
    if (anyYear) {
      return {
        type: 'UNKNOWN',
        year: parseInt(anyYear[1], 10),
        raw: trimmed,
        displayPeriod: trimmed
      };
    }

    return {
      type: 'UNKNOWN',
      year: 0,
      raw: trimmed,
      displayPeriod: trimmed
    };
  }
}

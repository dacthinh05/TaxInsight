import { TaxType } from '../../shared/types';

export interface NdktClassificationResult {
  taxType: TaxType | 'UNKNOWN';
  confidence: 'EXACT_CODE' | 'DESCRIPTION_MATCH' | 'UNKNOWN';
  description?: string;
}

export class TaxNdktClassifier {
  /**
   * Bảng đối chiếu chính thức Mục lục Ngân sách Nhà nước (Tiểu mục NDKT)
   * Căn cứ Thông tư 324/2016/TT-BTC & quy định quản lý thu NSNN.
   */
  private static readonly NDKT_MAP: Record<string, { taxType: TaxType; name: string }> = {
    // ── THUẾ THU NHẬP CÁ NHÂN (PIT) ───────────────────────────────────────
    '1001': { taxType: 'PIT', name: 'Thuế TNCN từ tiền lương, tiền công' },
    '1003': { taxType: 'PIT', name: 'Thuế TNCN từ hoạt động sản xuất kinh doanh' },
    '1004': { taxType: 'PIT', name: 'Thuế TNCN từ đầu tư vốn' },
    '1005': { taxType: 'PIT', name: 'Thuế TNCN từ chuyển nhượng vốn' },
    '1006': { taxType: 'PIT', name: 'Thuế TNCN từ chuyển nhượng bất động sản' },
    '1007': { taxType: 'PIT', name: 'Thuế TNCN từ trúng thưởng' },
    '1008': { taxType: 'PIT', name: 'Thuế TNCN từ bản quyền' },
    '1011': { taxType: 'PIT', name: 'Thuế TNCN từ nhận thừa kế' },
    '1012': { taxType: 'PIT', name: 'Thuế TNCN từ nhận quà tặng' },
    '1049': { taxType: 'PIT', name: 'Thuế TNCN khác' },

    // ── THUẾ GIÁ TRỊ GIA TĂNG (VAT) ──────────────────────────────────────
    '1701': { taxType: 'VAT', name: 'Thuế GTGT hàng sản xuất kinh doanh trong nước' },
    '1702': { taxType: 'VAT', name: 'Thuế GTGT hàng nhập khẩu' },
    '1703': { taxType: 'VAT', name: 'Thuế GTGT từ hoạt động xây dựng, lắp đặt' },
    '1704': { taxType: 'VAT', name: 'Thuế GTGT từ hoạt động kinh doanh vãng lai' },
    '1705': { taxType: 'VAT', name: 'Thuế GTGT từ hoạt động chuyển nhượng BĐS' },
    '1749': { taxType: 'VAT', name: 'Thuế GTGT khác' },

    // ── THUẾ THU NHẬP DOANH NGHIỆP (CIT) ──────────────────────────────────
    '1052': { taxType: 'CIT', name: 'Thuế TNDN từ hoạt động SXKD' },
    '1053': { taxType: 'CIT', name: 'Thuế TNDN từ chuyển nhượng BĐS' },
    '1054': { taxType: 'CIT', name: 'Thuế TNDN từ hoạt động khác' },
    '1056': { taxType: 'CIT', name: 'Thuế TNDN từ chuyển nhượng vốn' },
    '1057': { taxType: 'CIT', name: 'Thuế TNDN từ hoạt động dầu khí' },
    '1099': { taxType: 'CIT', name: 'Thuế TNDN khác' },

    // ── THUẾ NHÀ THẦU (FCT) ───────────────────────────────────────────────
    '1055': { taxType: 'FCT', name: 'Thuế nhà thầu nước ngoài (NTNN)' },

    // ── THUẾ NHÀ ĐẤT & CÁC KHOẢN THU VỀ ĐẤT (HOUSE_LAND) ─────────────────
    '3801': { taxType: 'HOUSE_LAND', name: 'Thuế sử dụng đất nông nghiệp' },
    '3802': { taxType: 'HOUSE_LAND', name: 'Thuế sử dụng đất phi nông nghiệp' },
    '3805': { taxType: 'HOUSE_LAND', name: 'Tiền sử dụng đất' },
    '3806': { taxType: 'HOUSE_LAND', name: 'Tiền thuê đất, thuê mặt nước' },
    '3901': { taxType: 'HOUSE_LAND', name: 'Thuế nhà đất' },

    // ── LỆ PHÍ MÔN BÀI (OTHER/REPORT) ────────────────────────────────────
    '2862': { taxType: 'OTHER', name: 'Lệ phí môn bài bậc 1' },
    '2863': { taxType: 'OTHER', name: 'Lệ phí môn bài bậc 2' },
    '2864': { taxType: 'OTHER', name: 'Lệ phí môn bài bậc 3' },
    '2850': { taxType: 'OTHER', name: 'Lệ phí môn bài khác' }
  };

  /**
   * Phân loại sắc thuế từ mã NDKT và diễn giải nội dung
   */
  public static classify(ndktCode?: string | null, description?: string | null): NdktClassificationResult {
    // 1. Ưu tiên tra cứu chính xác theo mã NDKT
    if (ndktCode) {
      const cleanedCode = ndktCode.trim();
      const entry = this.NDKT_MAP[cleanedCode];
      if (entry) {
        return {
          taxType: entry.taxType,
          confidence: 'EXACT_CODE',
          description: entry.name
        };
      }
    }

    // 2. Tra cứu fallback theo nội dung diễn giải nếu không có mã NDKT
    if (description) {
      const descUpper = description.toUpperCase();
      if (descUpper.includes('TIỀN LƯƠNG') || descUpper.includes('TIỀN CÔNG') || descUpper.includes('TNCN') || descUpper.includes('THU NHẬP CÁ NHÂN')) {
        return {
          taxType: 'PIT',
          confidence: 'DESCRIPTION_MATCH',
          description: description.trim()
        };
      }
      if (descUpper.includes('GIÁ TRỊ GIA TĂNG') || descUpper.includes('GTGT')) {
        return {
          taxType: 'VAT',
          confidence: 'DESCRIPTION_MATCH',
          description: description.trim()
        };
      }
      if (descUpper.includes('THU NHẬP DOANH NGHIỆP') || descUpper.includes('TNDN') || descUpper.includes('TẠM NỘP TNDN')) {
        return {
          taxType: 'CIT',
          confidence: 'DESCRIPTION_MATCH',
          description: description.trim()
        };
      }
      if (descUpper.includes('NHÀ THẦU') || descUpper.includes('NTNN') || descUpper.includes('FCT')) {
        return {
          taxType: 'FCT',
          confidence: 'DESCRIPTION_MATCH',
          description: description.trim()
        };
      }
      if (descUpper.includes('NHÀ ĐẤT') || descUpper.includes('SỬ DỤNG ĐẤT') || descUpper.includes('THUÊ ĐẤT')) {
        return {
          taxType: 'HOUSE_LAND',
          confidence: 'DESCRIPTION_MATCH',
          description: description.trim()
        };
      }
    }

    return {
      taxType: 'UNKNOWN',
      confidence: 'UNKNOWN',
      description: description?.trim()
    };
  }

  /**
   * Kiểm tra xem có xung đột sắc thuế giữa khoản nộp GNT và tờ khai không.
   * Nếu có xung đột thực sự (ví dụ PIT != VAT), kết quả là true -> BẮT BUỘC TỪ CHỐI MATCH.
   */
  public static hasTaxTypeConflict(paymentTaxType: TaxType | 'UNKNOWN', declarationTaxType: TaxType): boolean {
    if (paymentTaxType === 'UNKNOWN') return false; // Không đủ bằng chứng -> không coi là conflict
    if (paymentTaxType === declarationTaxType) return false;

    // Các cặp sắc thuế loại trừ nhau tuyệt đối:
    const distinctTypes: TaxType[] = ['VAT', 'PIT', 'CIT', 'FCT', 'HOUSE_LAND'];
    if (distinctTypes.includes(paymentTaxType as TaxType) && distinctTypes.includes(declarationTaxType)) {
      return paymentTaxType !== declarationTaxType;
    }

    return false;
  }
}

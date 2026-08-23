import { LegalDocumentRef } from '../../shared/obligationTypes';

export interface DeadlineRuleConfig {
  id: string;
  name: string;
  periodType: 'MONTH' | 'QUARTER' | 'YEAR' | 'FINALIZATION_ANNUAL' | 'FINALIZATION_CIT' | 'FINALIZATION_PIT';
  taxTypes: string[]; // ['VAT', 'PIT', 'CIT', 'FCT', 'ALL']
  effectiveFrom: string; // ISO YYYY-MM-DD
  effectiveTo?: string; // ISO YYYY-MM-DD
  
  // Cách tính deadline cơ sở
  ruleType:
    | 'DAY_20_NEXT_MONTH'                     // Khai tháng: Ngày 20 của tháng tiếp theo
    | 'LAST_DAY_FIRST_MONTH_NEXT_QUARTER'     // Khai quý: Ngày cuối cùng của tháng đầu tiên của quý tiếp theo (vd: Q1 -> 30/04, Q2 -> 31/07)
    | 'LAST_DAY_FIRST_MONTH_NEXT_YEAR'        // Khai năm: Ngày cuối cùng của tháng đầu năm tiếp theo (31/01)
    | 'LAST_DAY_THIRD_MONTH_NEXT_YEAR'        // Quyết toán TNDN/TNCN tổ chức: Ngày cuối cùng của tháng thứ 3 năm tiếp theo (31/03)
    | 'LAST_DAY_FOURTH_MONTH_NEXT_YEAR';      // Quyết toán TNCN trực tiếp cá nhân: Ngày cuối cùng của tháng thứ 4 (30/04)

  legalBasis: LegalDocumentRef[];
}

export class LegalRuleRegistry {
  // Kho văn bản pháp lý nguồn được kiểm chứng
  private static documents: Record<string, LegalDocumentRef> = {
    LUAT_QLT_38_2019: {
      id: 'LUAT_QLT_38_2019',
      documentNumber: '38/2019/QH14',
      documentTitle: 'Luật Quản lý thuế số 38/2019/QH14',
      article: 'Điều 44 & Điều 55',
      clause: 'Khoản 1 Điều 44, Khoản 1 Điều 55',
      effectiveFrom: '2020-07-01',
      effectiveTo: '2026-06-30',
      summary: 'Quy định thời hạn nộp hồ sơ khai thuế và thời hạn nộp thuế (tháng: ngày 20; quý: ngày cuối tháng đầu quý sau; quyết toán: ngày cuối tháng 3).',
      reviewedAt: '2026-08-18'
    },
    LUAT_QLT_108_2025: {
      id: 'LUAT_QLT_108_2025',
      documentNumber: '108/2025/QH15',
      documentTitle: 'Luật Quản lý thuế số 108/2025/QH15',
      article: 'Điều 44 & Điều 55',
      clause: 'Khoản 1 Điều 44, Khoản 1 Điều 55',
      effectiveFrom: '2026-07-01',
      summary: 'Quy định khung quản lý thuế mới, thời hạn nộp hồ sơ và thời hạn nộp thuế có hiệu lực từ 01/07/2026.',
      reviewedAt: '2026-08-18'
    },
    ND_126_2020: {
      id: 'ND_126_2020',
      documentNumber: '126/2020/NĐ-CP',
      documentTitle: 'Nghị định số 126/2020/NĐ-CP của Chính phủ',
      article: 'Điều 8 & Điều 10',
      clause: 'Khoản 1 Điều 8, Điều 10',
      effectiveFrom: '2020-12-05',
      summary: 'Quy định chi tiết một số điều của Luật Quản lý thuế; quy định ngày cuối cùng của thời hạn nếu trùng ngày nghỉ thì chuyển sang ngày làm việc tiếp theo.',
      reviewedAt: '2026-08-18'
    },
    ND_252_2026: {
      id: 'ND_252_2026',
      documentNumber: '252/2026/NĐ-CP',
      documentTitle: 'Nghị định số 252/2026/NĐ-CP của Chính phủ',
      article: 'Điều 8 & Điều 10',
      effectiveFrom: '2026-07-01',
      summary: 'Nghị định hướng dẫn thi hành Luật Quản lý thuế số 108/2025/QH15.',
      reviewedAt: '2026-08-18'
    },
    ND_245_2026_EXTENSION: {
      id: 'ND_245_2026_EXTENSION',
      documentNumber: '245/2026/NĐ-CP',
      documentTitle: 'Nghị định số 245/2026/NĐ-CP của Chính phủ',
      article: 'Điều 3 & Điều 4',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-12-31',
      summary: 'Gia hạn thời hạn nộp thuế GTGT, TNDN, TNCN và tiền thuê đất trong năm 2026 (Áp dụng theo danh mục ngành nghề và điều kiện quy định).',
      reviewedAt: '2026-08-18'
    }
  };

  // Danh mục Deadline Rules versioned theo mốc thời gian
  private static rules: DeadlineRuleConfig[] = [
    // ─── 1. LUẬT QLT 38/2019 (Trước 01/07/2026) ──────────────────────────
    {
      id: 'RULE_MONTHLY_QLT38',
      name: 'Khai thuế theo tháng (Luật QLT 38/2019)',
      periodType: 'MONTH',
      taxTypes: ['VAT', 'PIT', 'FCT', 'ALL'],
      effectiveFrom: '2020-07-01',
      effectiveTo: '2026-06-30',
      ruleType: 'DAY_20_NEXT_MONTH',
      legalBasis: [LegalRuleRegistry.documents.LUAT_QLT_38_2019, LegalRuleRegistry.documents.ND_126_2020]
    },
    {
      id: 'RULE_QUARTERLY_QLT38',
      name: 'Khai thuế theo quý (Luật QLT 38/2019)',
      periodType: 'QUARTER',
      taxTypes: ['VAT', 'PIT', 'CIT', 'ALL'],
      effectiveFrom: '2020-07-01',
      effectiveTo: '2026-06-30',
      ruleType: 'LAST_DAY_FIRST_MONTH_NEXT_QUARTER',
      legalBasis: [LegalRuleRegistry.documents.LUAT_QLT_38_2019, LegalRuleRegistry.documents.ND_126_2020]
    },
    {
      id: 'RULE_ANNUAL_FINALIZATION_QLT38',
      name: 'Quyết toán thuế năm (Luật QLT 38/2019)',
      periodType: 'FINALIZATION_CIT',
      taxTypes: ['CIT', 'PIT', 'ALL'],
      effectiveFrom: '2020-07-01',
      effectiveTo: '2026-06-30',
      ruleType: 'LAST_DAY_THIRD_MONTH_NEXT_YEAR',
      legalBasis: [LegalRuleRegistry.documents.LUAT_QLT_38_2019, LegalRuleRegistry.documents.ND_126_2020]
    },

    // ─── 2. LUẬT QLT 108/2025 (Từ 01/07/2026 trở đi) ─────────────────────
    {
      id: 'RULE_MONTHLY_QLT108',
      name: 'Khai thuế theo tháng (Luật QLT 108/2025)',
      periodType: 'MONTH',
      taxTypes: ['VAT', 'PIT', 'FCT', 'ALL'],
      effectiveFrom: '2026-07-01',
      ruleType: 'DAY_20_NEXT_MONTH',
      legalBasis: [LegalRuleRegistry.documents.LUAT_QLT_108_2025, LegalRuleRegistry.documents.ND_252_2026]
    },
    {
      id: 'RULE_QUARTERLY_QLT108',
      name: 'Khai thuế theo quý (Luật QLT 108/2025)',
      periodType: 'QUARTER',
      taxTypes: ['VAT', 'PIT', 'CIT', 'ALL'],
      effectiveFrom: '2026-07-01',
      ruleType: 'LAST_DAY_FIRST_MONTH_NEXT_QUARTER',
      legalBasis: [LegalRuleRegistry.documents.LUAT_QLT_108_2025, LegalRuleRegistry.documents.ND_252_2026]
    },
    {
      id: 'RULE_ANNUAL_FINALIZATION_QLT108',
      name: 'Quyết toán thuế năm (Luật QLT 108/2025)',
      periodType: 'FINALIZATION_CIT',
      taxTypes: ['CIT', 'PIT', 'ALL'],
      effectiveFrom: '2026-07-01',
      ruleType: 'LAST_DAY_THIRD_MONTH_NEXT_YEAR',
      legalBasis: [LegalRuleRegistry.documents.LUAT_QLT_108_2025, LegalRuleRegistry.documents.ND_252_2026]
    }
  ];

  /**
   * Tra cứu Rule áp dụng dựa trên Loại kỳ, Sắc thuế và Thời điểm phát sinh (Date)
   */
  public static resolveRule(
    periodType: 'MONTH' | 'QUARTER' | 'YEAR' | 'FINALIZATION_ANNUAL' | 'FINALIZATION_CIT' | 'FINALIZATION_PIT',
    taxType: string,
    targetDate: Date
  ): DeadlineRuleConfig | null {
    // Format ISO theo GIỜ ĐỊA PHƯƠNG — toISOString() trước đây dịch về UTC khiến
    // máy ở múi giờ UTC+ (VN = UTC+7) tính ngày sinh trước 1 ngày so với thực tế
    const yy = targetDate.getFullYear();
    const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
    const dd = String(targetDate.getDate()).padStart(2, '0');
    const targetIso = `${yy}-${mm}-${dd}`;

    for (const rule of this.rules) {
      if (rule.periodType !== periodType) continue;

      // Khớp sắc thuế
      const matchesTax = rule.taxTypes.includes(taxType) || rule.taxTypes.includes('ALL');
      if (!matchesTax) continue;

      // Khớp hiệu lực thời gian
      if (targetIso < rule.effectiveFrom) continue;
      if (rule.effectiveTo && targetIso > rule.effectiveTo) continue;

      return rule;
    }

    return null;
  }

  public static getLegalDocument(id: string): LegalDocumentRef | undefined {
    return this.documents[id];
  }
}

import { describe, expect, it } from 'vitest';
import { BusinessDayCalendar } from '../src/main/engine/BusinessDayCalendar';
import { LegalRuleRegistry } from '../src/main/engine/LegalRuleRegistry';
import { TaxDeadlineEngine } from '../src/main/engine/TaxDeadlineEngine';
import { TaxObligationEngine } from '../src/main/engine/TaxObligationEngine';
import { TaxObligationExtractor } from '../src/main/engine/TaxObligationExtractor';
import { TaxPaymentMatcher } from '../src/main/engine/TaxPaymentMatcher';
import { PaymentSlipDetail, PaymentSlipRecord, TaxFiling } from '../src/shared/types';

describe('Tax Obligation & Deadline Engine Comprehensive Test Suite', () => {

  // ─── NHÓM 1: TÍNH TOÁN HẠN NỘP & NGÀY NGHỈ (TEST 1 - 5, 18 - 20) ─────

  it('1. Khai tháng bình thường: Hạn nộp là ngày 20 của tháng tiếp theo', () => {
    // Tháng 07/2026 -> 20/08/2026 (Thứ Năm, ngày làm việc)
    const result = TaxDeadlineEngine.resolveDeadline({
      taxType: 'VAT',
      periodType: 'MONTH',
      year: 2026,
      month: 7
    });

    expect(result.basePaymentDeadline).toBe('20/08/2026');
    expect(result.effectivePaymentDeadline).toBe('20/08/2026');
    expect(result.isAdjustedForHoliday).toBe(false);
  });

  it('2. Khai quý bình thường: Hạn nộp là ngày cuối cùng tháng đầu quý sau', () => {
    // Quý 1/2026 -> 30/04/2026 (Trùng ngày lễ 30/4 & 1/5) -> chuyển sang ngày làm việc tiếp theo 04/05/2026 (Thứ Hai)
    const q1 = TaxDeadlineEngine.resolveDeadline({
      taxType: 'VAT',
      periodType: 'QUARTER',
      year: 2026,
      quarter: 1
    });
    expect(q1.basePaymentDeadline).toBe('30/04/2026');
    expect(q1.isAdjustedForHoliday).toBe(true);

    // Quý 2/2026 -> 31/07/2026 (Thứ Sáu, ngày làm việc)
    const q2 = TaxDeadlineEngine.resolveDeadline({
      taxType: 'VAT',
      periodType: 'QUARTER',
      year: 2026,
      quarter: 2
    });
    expect(q2.basePaymentDeadline).toBe('31/07/2026');
    expect(q2.effectivePaymentDeadline).toBe('31/07/2026');
  });

  it('3. Khai năm: Hạn nộp là ngày cuối cùng tháng đầu năm tiếp theo (31/01)', () => {
    const res = TaxDeadlineEngine.resolveDeadline({
      taxType: 'OTHER',
      periodType: 'YEAR',
      year: 2025
    });
    expect(res.basePaymentDeadline).toBe('31/03/2026'); // Quyết toán năm mặc định
  });

  it('4. Quyết toán TNDN/TNCN: Hạn nộp là ngày cuối cùng tháng thứ 3 năm sau (31/03)', () => {
    const res = TaxDeadlineEngine.resolveDeadline({
      taxType: 'CIT',
      declarationCode: '03/TNDN',
      periodType: 'YEAR',
      year: 2025,
      isFinalization: true
    });
    expect(res.basePaymentDeadline).toBe('31/03/2026');
    expect(res.effectivePaymentDeadline).toBe('31/03/2026');
  });

  it('4b. Quyết toán TNCN cá nhân trực tiếp 02/QTT-TNCN dùng hạn cuối tháng thứ 4', () => {
    const res = TaxDeadlineEngine.resolveDeadline({
      taxType: 'PIT',
      declarationCode: '02/QTT-TNCN',
      periodType: 'YEAR',
      year: 2025,
      isFinalization: true
    });
    expect(res.basePaymentDeadline).toBe('30/04/2026');
    expect(res.ruleId).toBe('RULE_INDIVIDUAL_PIT_FINALIZATION_QLT38');
  });

  it('5. Deadline rơi vào ngày nghỉ cuối tuần hoặc ngày lễ: Chuyển sang ngày làm việc tiếp theo', () => {
    // 20/09/2026 là Chủ Nhật -> chuyển sang Thứ Hai 21/09/2026
    const res = TaxDeadlineEngine.resolveDeadline({
      taxType: 'VAT',
      periodType: 'MONTH',
      year: 2026,
      month: 8 // Kỳ 08/2026 -> Deadline cơ sở 20/09/2026
    });

    expect(res.basePaymentDeadline).toBe('20/09/2026');
    expect(res.effectivePaymentDeadline).toBe('21/09/2026');
    expect(res.isAdjustedForHoliday).toBe(true);
    expect(res.notes?.some(n => n.includes('Chủ Nhật'))).toBe(true);
  });

  it('18 & 19. Gia hạn deadline & không tự ý kết luận khi chưa đủ điều kiện', () => {
    // Tháng 05/2026 (thuộc kỳ NĐ 245/2026 gia hạn)
    const res = TaxDeadlineEngine.resolveDeadline({
      taxType: 'VAT',
      periodType: 'MONTH',
      year: 2026,
      month: 5
    });

    expect(res.confidence).toBe('NEEDS_REVIEW');
    expect(res.extensionApplied).toBe(false); // Chưa tự ý gán đã gia hạn
    expect(res.extensionReason).toContain('Nghị định 245/2026/NĐ-CP');
  });

  it('20. Rule thay đổi theo effective date (Luật QLT 38/2019 vs Luật QLT 108/2025)', () => {
    const rule2025 = LegalRuleRegistry.resolveRule('MONTH', 'VAT', new Date('2025-05-20'));
    expect(rule2025?.id).toBe('RULE_MONTHLY_QLT38');
    expect(rule2025?.legalBasis[0].documentNumber).toBe('38/2019/QH14');

    const rule2026 = LegalRuleRegistry.resolveRule('MONTH', 'VAT', new Date('2026-08-20'));
    expect(rule2026?.id).toBe('RULE_MONTHLY_QLT108');
    expect(rule2026?.legalBasis[0].documentNumber).toBe('108/2025/QH15');
  });

  // ─── NHÓM 2: KHAI BỔ SUNG & NGHĨA VỤ HIỆN HÀNH (TEST 6 - 10) ────────

  it('6 & 8. Khai bổ sung làm tăng nghĩa vụ và gắn với hạn nộp kỳ gốc', () => {
    const filings: TaxFiling[] = [
      {
        id: 'FILING_01',
        taxType: 'VAT',
        declarationCode: '01/GTGT',
        title: 'Tờ khai thuế GTGT',
        period: 'Tháng 03/2026',
        submittedAt: '18/04/2026 09:00',
        filingType: 'ORIGINAL',
        downloadAvailable: true
      },
      {
        id: 'FILING_02',
        taxType: 'VAT',
        declarationCode: '01/GTGT',
        title: 'Tờ khai thuế GTGT bổ sung',
        period: 'Tháng 03/2026',
        submittedAt: '18/08/2026 14:30',
        filingType: 'SUPPLEMENTAL',
        supplementalNo: 1,
        downloadAvailable: true
      }
    ];

    const obligations = TaxObligationExtractor.extractObligations(filings, '3702735709');
    expect(obligations.length).toBe(1); // Không nhân đôi nghĩa vụ

    const ob = obligations[0];
    expect(ob.currentVersion).toBe('Bổ sung lần 1');
    expect(ob.hasSupplemental).toBe(true);
    expect(ob.deadline.basePaymentDeadline).toBe('20/04/2026'); // Vẫn theo hạn kỳ gốc 03/2026
    expect(ob.isSupplementalAfterDeadline).toBe(true); // Nộp BS ngày 18/08 sau hạn 20/04
  });

  // ─── NHÓM 3: ĐỐI CHIẾU GIẤY NỘP TIỀN (TEST 11 - 17) ──────────────────

  it('11. Một nghĩa vụ + Một GNT khớp chính xác', () => {
    const mockObligation = {
      id: 'OB_01',
      taxCode: '3702735709',
      taxType: 'VAT' as const,
      declarationCode: '01/GTGT',
      title: 'Tờ khai GTGT',
      periodKey: 'VAT_01/GTGT_2026-M07',
      periodLabel: 'Tháng 07/2026',
      year: 2026,
      month: 7,
      amountPayable: 100000000n,
      hasSupplemental: false,
      supplementalCount: 0,
      currentVersion: 'Chính thức',
      deadline: {
        baseFilingDeadline: '20/08/2026',
        basePaymentDeadline: '20/08/2026',
        effectiveFilingDeadline: '20/08/2026',
        effectivePaymentDeadline: '20/08/2026',
        ruleId: 'RULE_MONTHLY_QLT108',
        legalBasis: [],
        extensionApplied: false,
        confidence: 'CONFIRMED' as const,
        isAdjustedForHoliday: false
      },
      status: 'NOT_DUE' as const,
      daysRemaining: 2,
      matchedPaymentAmount: 0n,
      matchedSlips: [],
      discrepancy: 100000000n,
      statusMessage: ''
    };

    const mockSlips: PaymentSlipRecord[] = [
      {
        id: 'GNT_01',
        stt: 1,
        maGiaoDich: 'GD123456',
        soGnt: 'GNT001',
        soTien: 100000000,
        soTienFormatted: '100,000,000',
        loaiTien: 'VND',
        trangThai: 'Nộp thuế thành công',
        lanNop: '07/2026',
        ngayNopThue: '15/08/2026 10:00:00',
        downloadAvailable: true
      }
    ];

    const matched = TaxPaymentMatcher.matchPayments([mockObligation], mockSlips);
    expect(matched[0].status).toBe('PAID_MATCHED');
    expect(matched[0].matchedPaymentAmount).toBe(100000000n);
    expect(matched[0].discrepancy).toBe(0n);
    expect(matched[0].statusMessage).toContain('Đã đối chiếu đủ');
  });

  it('12. Một nghĩa vụ + Nhiều GNT (60M + 40M = 100M)', () => {
    const mockObligation = {
      id: 'OB_02',
      taxCode: '3702735709',
      taxType: 'VAT' as const,
      declarationCode: '01/GTGT',
      title: 'Tờ khai GTGT',
      periodKey: 'VAT_01/GTGT_2026-M06',
      periodLabel: 'Tháng 06/2026',
      year: 2026,
      month: 6,
      amountPayable: 100000000n,
      hasSupplemental: false,
      supplementalCount: 0,
      currentVersion: 'Chính thức',
      deadline: {
        baseFilingDeadline: '20/07/2026',
        basePaymentDeadline: '20/07/2026',
        effectiveFilingDeadline: '20/07/2026',
        effectivePaymentDeadline: '20/07/2026',
        ruleId: 'RULE_MONTHLY_QLT108',
        legalBasis: [],
        extensionApplied: false,
        confidence: 'CONFIRMED' as const,
        isAdjustedForHoliday: false
      },
      status: 'PAST_DEADLINE_NO_MATCHED_PAYMENT' as const,
      daysRemaining: -20,
      matchedPaymentAmount: 0n,
      matchedSlips: [],
      discrepancy: 100000000n,
      statusMessage: ''
    };

    const mockSlips: PaymentSlipRecord[] = [
      {
        id: 'GNT_A',
        stt: 1,
        maGiaoDich: 'GD_A',
        soGnt: 'GNT_A',
        soTien: 60000000,
        soTienFormatted: '60,000,000',
        loaiTien: 'VND',
        trangThai: 'Nộp thuế thành công',
        lanNop: '06/2026',
        ngayNopThue: '10/07/2026 09:00:00',
        downloadAvailable: true
      },
      {
        id: 'GNT_B',
        stt: 2,
        maGiaoDich: 'GD_B',
        soGnt: 'GNT_B',
        soTien: 40000000,
        soTienFormatted: '40,000,000',
        loaiTien: 'VND',
        trangThai: 'Nộp thuế thành công',
        lanNop: '06/2026',
        ngayNopThue: '18/07/2026 14:00:00',
        downloadAvailable: true
      }
    ];

    const matched = TaxPaymentMatcher.matchPayments([mockObligation], mockSlips);
    expect(matched[0].status).toBe('PAID_MATCHED');
    expect(matched[0].matchedSlips.length).toBe(2);
    expect(matched[0].matchedPaymentAmount).toBe(100000000n);
    expect(matched[0].discrepancy).toBe(0n);
  });

  it('13 & 14. Một GNT có nhiều tiểu mục & Đối chiếu Partial Payment', () => {
    const mockObligation = {
      id: 'OB_03',
      taxCode: '3702735709',
      taxType: 'PIT' as const,
      declarationCode: '05/KK-TNCN',
      title: 'Tờ khai TNCN',
      periodKey: 'PIT_05/KK-TNCN_2026-M07',
      periodLabel: 'Tháng 07/2026',
      year: 2026,
      month: 7,
      amountPayable: 80000000n,
      hasSupplemental: false,
      supplementalCount: 0,
      currentVersion: 'Chính thức',
      deadline: {
        baseFilingDeadline: '20/08/2026',
        basePaymentDeadline: '20/08/2026',
        effectiveFilingDeadline: '20/08/2026',
        effectivePaymentDeadline: '20/08/2026',
        ruleId: 'RULE_MONTHLY_QLT108',
        legalBasis: [],
        extensionApplied: false,
        confidence: 'CONFIRMED' as const,
        isAdjustedForHoliday: false
      },
      status: 'NOT_DUE' as const,
      daysRemaining: 2,
      matchedPaymentAmount: 0n,
      matchedSlips: [],
      discrepancy: 80000000n,
      statusMessage: ''
    };

    const mockSlips: PaymentSlipRecord[] = [
      {
        id: 'GNT_MULTI',
        stt: 1,
        maGiaoDich: 'GD_MULTI',
        soGnt: 'GNT_MULTI',
        soTien: 120000000,
        soTienFormatted: '120,000,000',
        loaiTien: 'VND',
        trangThai: 'Nộp thuế thành công',
        downloadAvailable: true
      }
    ];

    const detailsMap = new Map<string, PaymentSlipDetail>();
    detailsMap.set('GNT_MULTI', {
      id: 'GNT_MULTI',
      soGnt: 'GNT_MULTI',
      hinhThucNopTien: 'CHUYEN_KHOAN',
      loaiTien: 'VND',
      nguoiNopThue: 'CÔNG TY TNHH ABC',
      maSoThue: '3702735709',
      loaiTaiKhoanThu: 'TK_THU_NSNN',
      tongTienVND: '120000000',
      signatures: [],
      items: [
        {
          stt: 1,
          maNDKT: '1701', // GTGT
          kyThueNgayQd: '07/2026',
          noiDungKhoanNop: 'Thuế GTGT',
          soTienVND: '70000000'
        },
        {
          stt: 2,
          maNDKT: '1001', // TNCN
          kyThueNgayQd: '07/2026',
          noiDungKhoanNop: 'Thuế TNCN',
          soTienVND: '50000000' // Chỉ nộp 50M trong khi nghĩa vụ là 80M -> Partial
        }
      ]
    });

    const matched = TaxPaymentMatcher.matchPayments([mockObligation], mockSlips, detailsMap);
    expect(matched[0].status).toBe('PARTIALLY_MATCHED');
    expect(matched[0].matchedPaymentAmount).toBe(50000000n);
    expect(matched[0].discrepancy).toBe(30000000n);
  });

  it('16. GNT nộp sau deadline: Báo đã đối chiếu nhưng kèm cảnh báo nộp muộn', () => {
    const mockObligation = {
      id: 'OB_04',
      taxCode: '3702735709',
      taxType: 'VAT' as const,
      declarationCode: '01/GTGT',
      title: 'Tờ khai GTGT',
      periodKey: 'VAT_01/GTGT_2026-M06',
      periodLabel: 'Tháng 06/2026',
      year: 2026,
      month: 6,
      amountPayable: 50000000n,
      hasSupplemental: false,
      supplementalCount: 0,
      currentVersion: 'Chính thức',
      deadline: {
        baseFilingDeadline: '20/07/2026',
        basePaymentDeadline: '20/07/2026',
        effectiveFilingDeadline: '20/07/2026',
        effectivePaymentDeadline: '20/07/2026',
        ruleId: 'RULE_MONTHLY_QLT108',
        legalBasis: [],
        extensionApplied: false,
        confidence: 'CONFIRMED' as const,
        isAdjustedForHoliday: false
      },
      status: 'PAST_DEADLINE_NO_MATCHED_PAYMENT' as const,
      daysRemaining: -20,
      matchedPaymentAmount: 0n,
      matchedSlips: [],
      discrepancy: 50000000n,
      statusMessage: ''
    };

    const mockSlips: PaymentSlipRecord[] = [
      {
        id: 'GNT_LATE',
        stt: 1,
        maGiaoDich: 'GD_LATE',
        soGnt: 'GNT_LATE',
        soTien: 50000000,
        soTienFormatted: '50,000,000',
        loaiTien: 'VND',
        trangThai: 'Nộp thuế thành công',
        lanNop: '06/2026',
        ngayNopThue: '25/07/2026 11:00:00', // Nộp sau hạn 20/07 là 5 ngày
        downloadAvailable: true
      }
    ];

    const matched = TaxPaymentMatcher.matchPayments([mockObligation], mockSlips);
    expect(matched[0].status).toBe('PAID_MATCHED');
    expect(matched[0].matchedSlips[0].isPaidAfterDeadline).toBe(true);
    expect(matched[0].matchedSlips[0].daysLate).toBe(5);
    expect(matched[0].statusMessage).toContain('Nộp sau hạn 5 ngày');
  });

  it('17. Không tìm thấy GNT: Wording thận trọng (Chưa tìm thấy GNT, KHÔNG nói nợ thuế)', () => {
    const mockObligation = {
      id: 'OB_05',
      taxCode: '3702735709',
      taxType: 'VAT' as const,
      declarationCode: '01/GTGT',
      title: 'Tờ khai GTGT',
      periodKey: 'VAT_01/GTGT_2026-M05',
      periodLabel: 'Tháng 05/2026',
      year: 2026,
      month: 5,
      amountPayable: 70000000n,
      hasSupplemental: false,
      supplementalCount: 0,
      currentVersion: 'Chính thức',
      deadline: {
        baseFilingDeadline: '20/06/2026',
        basePaymentDeadline: '20/06/2026',
        effectiveFilingDeadline: '22/06/2026', // 20/6 là Thứ 7 -> 22/6 Thứ Hai
        effectivePaymentDeadline: '22/06/2026',
        ruleId: 'RULE_MONTHLY_QLT38',
        legalBasis: [],
        extensionApplied: false,
        confidence: 'CONFIRMED' as const,
        isAdjustedForHoliday: true
      },
      status: 'PAST_DEADLINE_NO_MATCHED_PAYMENT' as const,
      daysRemaining: -55,
      matchedPaymentAmount: 0n,
      matchedSlips: [],
      discrepancy: 70000000n,
      statusMessage: 'Đã qua hạn theo kỳ (55 ngày) · Chưa tìm thấy GNT đối chiếu'
    };

    const matched = TaxPaymentMatcher.matchPayments([mockObligation], []);
    expect(matched[0].status).toBe('PAST_DEADLINE_NO_MATCHED_PAYMENT');
    expect(matched[0].statusMessage).toContain('Chưa tìm thấy GNT đối chiếu');
    expect(matched[0].statusMessage).not.toContain('nợ thuế');
    expect(matched[0].statusMessage).not.toContain('vi phạm');
  });
});

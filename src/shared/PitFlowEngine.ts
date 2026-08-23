import {
  PitAnalyticsSummary,
  PitDeclarationSnapshot,
  PitPeriodGroup
} from './pitAnalyticsTypes';

export interface PitPeriodFlowItem {
  periodKey: string;
  periodLabel: string;
  shortLabel: string;
  year: number;
  month?: number;
  quarter?: number;
  isQuarter: boolean;
  parentQuarter?: number; // Quý cha (1, 2, 3, 4)
  isSubMonth?: boolean;   // true nếu là dòng tháng con bên trong quý

  effectiveSnapshot: PitDeclarationSnapshot | null;
  versionLabel: string;
  supplementaryCount: number;
  hasSupplemental: boolean;

  // Indicators
  employeeCountCt21: bigint;      // Số người lao động (người)
  totalIncomeCt24: bigint;        // Tổng thu nhập chịu thuế (TNCT)
  taxableIncomeCt27: bigint;      // Tổng TNCT thuộc diện khấu trừ
  residentTaxCt32: bigint;        // Thuế TNCN khấu trừ - cá nhân cư trú
  nonResidentTaxCt33: bigint;     // Thuế TNCN khấu trừ - cá nhân không cư trú
  totalWithheldTaxCt34: bigint;   // Tổng số thuế TNCN đã khấu trừ
  taxPayableCt35: bigint;         // Thuế TNCN phải nộp

  notes?: string;
  evidence?: {
    formCode: string;
    submissionId: string;
    submittedAt?: string;
    status: string;
  };
}

export interface PitQuarterBlock {
  quarter: number;
  quarterLabel: string;
  quarterFiling: PitPeriodFlowItem | null; // Tờ khai nộp theo Quý (nếu có)
  monthFilings: PitPeriodFlowItem[];     // Các tờ khai nộp theo Tháng trong quý (nếu có)
  totalIncomeCt24: bigint;               // Tổng TNCT của Quý
  totalWithheldTax: bigint;              // Tổng phát sinh thuế khấu trừ của Quý
  hasHybridFiling: boolean;              // Vừa có tháng vừa có quý trong cùng 1 quý
}

export interface PitFlowSummaryYear {
  targetYear: number;
  quarterBlocks: PitQuarterBlock[];
  flatFlows: PitPeriodFlowItem[];

  // Tổng hợp cả năm
  totalEmployeeCount: bigint;
  totalIncomeCt24: bigint;
  totalTaxableIncomeCt27: bigint;
  totalResidentTax32: bigint;
  totalNonResidentTax33: bigint;
  totalWithheldTax34: bigint;
  totalTaxPayable35: bigint;

  // Quyết toán năm 05/QTT-TNCN
  finalizationSnapshot: PitDeclarationSnapshot | null;
  finalizationTotalIncome24: bigint | null;
  finalizationWithheldTax36: bigint | null;
  finalizationPayableTax41: bigint | null;
  finalizationOverpaidTax44: bigint | null;

  // Chênh lệch đối chiếu (Tổng kỳ vs Quyết toán năm)
  mismatchDelta: bigint | null; // = totalWithheldTax34 - finalizationWithheldTax36
  auditStatus: 'MATCHED' | 'MISMATCHED' | 'NO_FINALIZATION';
  periodsCount: number;
}

export class PitFlowEngine {
  /**
   * Chuẩn hóa dòng dữ liệu thuế TNCN cho một năm tài chính
   */
  public static normalizeYearFlow(
    summary: PitAnalyticsSummary | null,
    targetYear: number
  ): PitFlowSummaryYear {
    const allGroups = summary?.periodGroups || [];
    const yearGroups = allGroups.filter(g => g.year === targetYear && g.periodType !== 'YEAR');

    // Tạo 4 Quarter Blocks cho năm
    const quarterBlocks: PitQuarterBlock[] = [];
    const flatFlows: PitPeriodFlowItem[] = [];

    let totalIncomeCt24 = 0n;
    let totalTaxableIncomeCt27 = 0n;
    let totalResidentTax32 = 0n;
    let totalNonResidentTax33 = 0n;
    let totalWithheldTax34 = 0n;
    let totalTaxPayable35 = 0n;
    let maxEmployeeCount = 0n;
    let periodsCount = 0;

    for (let q = 1; q <= 4; q++) {
      const qLabel = `Quý ${q}/${targetYear}`;
      const qKey = `${targetYear}-Q${q}`;

      // Tìm tờ khai nộp theo Quý (nếu có)
      const qGroup = yearGroups.find(g => g.periodType === 'QUARTER' && (g.quarter === q || g.periodKey === qKey));
      let quarterFilingItem: PitPeriodFlowItem | null = null;

      if (qGroup && qGroup.finalSnapshot) {
        const snap = qGroup.finalSnapshot;
        quarterFilingItem = {
          periodKey: qKey,
          periodLabel: qLabel,
          shortLabel: `Q${q}`,
          year: targetYear,
          quarter: q,
          isQuarter: true,
          effectiveSnapshot: snap,
          versionLabel: qGroup.hasSupplemental ? `BS lần ${qGroup.supplementalCount}` : 'Chính thức',
          supplementaryCount: qGroup.supplementalCount,
          hasSupplemental: qGroup.hasSupplemental,
          employeeCountCt21: snap.ct21_tongSoNguoiLaoDong,
          totalIncomeCt24: snap.ct24_tongThuNhapChiuThue,
          taxableIncomeCt27: snap.ct27_tongThuNhapChiuThueKhauTru,
          residentTaxCt32: snap.ct32_khauTruCaNhanCuTru,
          nonResidentTaxCt33: snap.ct33_khauTruCaNhanKhongCuTru,
          totalWithheldTaxCt34: snap.ct34_tongThueKhauTru,
          taxPayableCt35: snap.ct35_tongThuePhaiNop,
          notes: 'Kê khai theo Quý',
          evidence: {
            formCode: snap.formCode,
            submissionId: snap.submissionId,
            submittedAt: snap.submittedAt,
            status: snap.status
          }
        };
        periodsCount++;
      }

      // Tìm các tờ khai nộp theo Tháng trong quý
      const startMonth = (q - 1) * 3 + 1;
      const endMonth = q * 3;
      const monthFilings: PitPeriodFlowItem[] = [];

      for (let m = startMonth; m <= endMonth; m++) {
        const mKey = `${targetYear}-M${String(m).padStart(2, '0')}`;
        const mLabel = `Tháng ${String(m).padStart(2, '0')}/${targetYear}`;
        const mGroup = yearGroups.find(g => g.periodType === 'MONTH' && (g.month === m || g.periodKey === mKey));

        if (mGroup && mGroup.finalSnapshot) {
          const snap = mGroup.finalSnapshot;
          const mItem: PitPeriodFlowItem = {
            periodKey: mKey,
            periodLabel: mLabel,
            shortLabel: `T${m}`,
            year: targetYear,
            month: m,
            isQuarter: false,
            parentQuarter: q,
            isSubMonth: true,
            effectiveSnapshot: snap,
            versionLabel: mGroup.hasSupplemental ? `BS lần ${mGroup.supplementalCount}` : 'Chính thức',
            supplementaryCount: mGroup.supplementalCount,
            hasSupplemental: mGroup.hasSupplemental,
            employeeCountCt21: snap.ct21_tongSoNguoiLaoDong,
            totalIncomeCt24: snap.ct24_tongThuNhapChiuThue,
            taxableIncomeCt27: snap.ct27_tongThuNhapChiuThueKhauTru,
            residentTaxCt32: snap.ct32_khauTruCaNhanCuTru,
            nonResidentTaxCt33: snap.ct33_khauTruCaNhanKhongCuTru,
            totalWithheldTaxCt34: snap.ct34_tongThueKhauTru,
            taxPayableCt35: snap.ct35_tongThuePhaiNop,
            notes: 'Kê khai theo Tháng',
            evidence: {
              formCode: snap.formCode,
              submissionId: snap.submissionId,
              submittedAt: snap.submittedAt,
              status: snap.status
            }
          };
          monthFilings.push(mItem);
          periodsCount++;
        }
      }

      const hasHybrid = quarterFilingItem !== null && monthFilings.length > 0;

      // Tính tổng Quý (chống double counting khi có cả tháng và quý)
      let qTotalIncome = 0n;
      let qTotalWithheld = 0n;

      if (quarterFilingItem) {
        qTotalIncome += quarterFilingItem.totalIncomeCt24;
        qTotalWithheld += quarterFilingItem.totalWithheldTaxCt34;
        totalIncomeCt24 += quarterFilingItem.totalIncomeCt24;
        totalTaxableIncomeCt27 += quarterFilingItem.taxableIncomeCt27;
        totalResidentTax32 += quarterFilingItem.residentTaxCt32;
        totalNonResidentTax33 += quarterFilingItem.nonResidentTaxCt33;
        totalTaxPayable35 += quarterFilingItem.taxPayableCt35;
        if (quarterFilingItem.employeeCountCt21 > maxEmployeeCount) {
          maxEmployeeCount = quarterFilingItem.employeeCountCt21;
        }
      }

      for (const mItem of monthFilings) {
        if (!quarterFilingItem) {
          qTotalIncome += mItem.totalIncomeCt24;
          qTotalWithheld += mItem.totalWithheldTaxCt34;
          totalIncomeCt24 += mItem.totalIncomeCt24;
          totalTaxableIncomeCt27 += mItem.taxableIncomeCt27;
          totalResidentTax32 += mItem.residentTaxCt32;
          totalNonResidentTax33 += mItem.nonResidentTaxCt33;
          totalTaxPayable35 += mItem.taxPayableCt35;
          if (mItem.employeeCountCt21 > maxEmployeeCount) {
            maxEmployeeCount = mItem.employeeCountCt21;
          }
        } else {
          // Có cả tháng và quý trong cùng quý (kỳ chuyển đổi)
          qTotalIncome += mItem.totalIncomeCt24;
          qTotalWithheld += mItem.totalWithheldTaxCt34;
          totalIncomeCt24 += mItem.totalIncomeCt24;
          totalTaxableIncomeCt27 += mItem.taxableIncomeCt27;
          totalResidentTax32 += mItem.residentTaxCt32;
          totalNonResidentTax33 += mItem.nonResidentTaxCt33;
          totalTaxPayable35 += mItem.taxPayableCt35;
        }
      }

      totalWithheldTax34 += qTotalWithheld;

      quarterBlocks.push({
        quarter: q,
        quarterLabel: qLabel,
        quarterFiling: quarterFilingItem,
        monthFilings,
        totalIncomeCt24: qTotalIncome,
        totalWithheldTax: qTotalWithheld,
        hasHybridFiling: hasHybrid
      });

      // Flat Flows
      if (monthFilings.length > 0) {
        flatFlows.push(...monthFilings);
      }
      if (quarterFilingItem) {
        flatFlows.push(quarterFilingItem);
      }
    }

    // ─── Quyết toán năm 05/QTT-TNCN ───────────────────────────
    const qtt = summary?.finalizationSnapshot || null;
    const finalizationTotalIncome24 = qtt?.ct24_tongThuNhapChiuThue ?? null;
    const finalizationWithheldTax36 = qtt?.ct36_qtt_tongThueDaKhauTruTrongNam ?? null;
    const finalizationPayableTax41 = qtt?.ct41_qtt_tongThuePhaiNopTrongNam ?? null;
    const finalizationOverpaidTax44 = qtt?.ct44_qtt_tongThueNopThua ?? null;

    let mismatchDelta: bigint | null = null;
    let auditStatus: 'MATCHED' | 'MISMATCHED' | 'NO_FINALIZATION' = 'NO_FINALIZATION';

    if (finalizationWithheldTax36 !== null) {
      mismatchDelta = totalWithheldTax34 - finalizationWithheldTax36;
      auditStatus = mismatchDelta === 0n ? 'MATCHED' : 'MISMATCHED';
    }

    return {
      targetYear,
      quarterBlocks,
      flatFlows,
      totalEmployeeCount: maxEmployeeCount,
      totalIncomeCt24,
      totalTaxableIncomeCt27,
      totalResidentTax32,
      totalNonResidentTax33,
      totalWithheldTax34,
      totalTaxPayable35,
      finalizationSnapshot: qtt,
      finalizationTotalIncome24,
      finalizationWithheldTax36,
      finalizationPayableTax41,
      finalizationOverpaidTax44,
      mismatchDelta,
      auditStatus,
      periodsCount
    };
  }
}

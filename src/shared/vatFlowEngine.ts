import {
  VatAnalyticsSummary,
  VatDeclarationSnapshot,
  VatPeriodGroup
} from './vatAnalyticsTypes';
import { formatMoneyVND } from './moneyUtils';
import { parseSubmissionTimestamp } from './dateUtils';

export type FlowSemanticState =
  | 'NORMAL'
  | 'TAX_PAYABLE'
  | 'REFUND'
  | 'SUPPLEMENTAL_CHANGED'
  | 'NEEDS_REVIEW'
  | 'MISSING'
  | 'UNVERIFIED'
  | 'UNKNOWN_VERSION';

export type FlowCheckStatus = 'CONFIRMED' | 'NEEDS_REVIEW' | 'NOT_CHECKABLE';

export type AdjustmentImpactType =
  | 'CARRY_FORWARD_INCREASE'
  | 'CARRY_FORWARD_DECREASE'
  | 'TAX_PAYABLE_INCREASE'
  | 'TAX_PAYABLE_DECREASE'
  | 'REFUND_IMPACT'
  | 'OTHER_CURRENT_PERIOD_ADJUSTMENT'
  | 'UNKNOWN';

export type AdjustmentConfidence = 'CONFIRMED' | 'NEEDS_REVIEW' | 'UNKNOWN';

export interface CrossPeriodTaxAdjustment {
  adjustmentId: string;
  sourcePeriod: {
    periodKey: string;
    periodLabel: string;
    year: number;
    month?: number;
    quarter?: number;
  };
  sourceRecordId: string;
  supplementarySequence: number;
  supplementaryFiledDate?: string;
  
  impactPeriod: {
    periodKey: string;
    periodLabel: string;
    year: number;
    month?: number;
    quarter?: number;
  } | null;

  impactType: AdjustmentImpactType;
  sourceIndicator?: string; // Vd: "[43]" cũ thay đổi
  targetIndicator?: string; // Vd: "[37]" hoặc "[38]" kỳ hiện tại
  
  previousValue: bigint;
  newValue: bigint;
  delta: bigint;
  
  direction: 'INCREASE' | 'DECREASE' | 'NEUTRAL';
  confidence: AdjustmentConfidence;
  title: string;
  description: string;
  
  evidence: {
    formCode: string;
    submissionId: string;
    submittedAt?: string;
    status: string;
  };
}

export interface TaxPeriodFlow {
  periodKey: string;
  periodLabel: string; // Vd: "Tháng 01/2026"
  shortLabel: string;  // Vd: "T1"
  year: number;
  month?: number;
  quarter?: number;
  isMonth: boolean;

  effectiveSnapshot: VatDeclarationSnapshot | null;
  versionLabel: string; // "Chính thức" | "BS lần 2" | "Chưa có hồ sơ" | "Chưa đến kỳ"
  supplementaryCount: number;
  hasSupplemental: boolean;
  hasIncompleteHistory?: boolean; // true nếu chỉ tìm thấy BS mà thiếu bản gốc trong dữ liệu quét

  // Indicators lấy từ effective snapshot
  openingCt22: bigint;
  inputVatCt25: bigint;
  outputVatCt35: bigint;
  adjustDecreaseCt37: bigint;
  adjustIncreaseCt38: bigint;
  taxPayableCt40: bigint;
  refundCt42: bigint;
  carryForwardCt43: bigint;

  semanticState: FlowSemanticState;
  
  // Kiểm tra tính liên tục của dòng chuyển kỳ (ct22 kỳ này vs ct43 kỳ trước)
  flowCheck: {
    status: FlowCheckStatus;
    previousCarryForward: bigint | null;
    currentOpening: bigint | null;
    discrepancy: bigint | null;
    note: string;
  };

  // Các điều chỉnh do khai bổ sung trong chính kỳ này (chỉ giữ field có biến động)
  supplementaryChanges: Array<{
    indicator: string;
    label: string;
    before: bigint;
    after: bigint;
    delta: bigint;
  }>;

  // Các điều chỉnh từ kỳ cũ nộp tác động tới kỳ này
  incomingAdjustments: CrossPeriodTaxAdjustment[];

  // Nếu kỳ này có nộp BS tạo tác động tới kỳ tương lai
  outgoingAdjustments: CrossPeriodTaxAdjustment[];

  narrative: string;

  evidence: {
    submissionId: string;
    formCode: string;
    submittedAt?: string;
    declarationType: string;
    supplementalNo?: number;
    status: string;
    xmlAvailable: boolean;
  } | null;

  warnings: Array<{ message: string; severity: string }>;
}

export interface VatFlowSummaryYear {
  targetYear: number;
  totalPeriodsInYear: number;
  periodsWithFiling: number;
  periodsWithSupplemental: number;
  periodsWithWarning: number;

  openingYearBalance: bigint; // [22] của kỳ đầu tiên
  closingYearBalance: bigint; // [43] của kỳ cuối cùng

  totalInputVat25: bigint;
  totalOutputVat35: bigint;
  totalAdjustDecrease37: bigint;
  totalAdjustIncrease38: bigint;
  totalTaxPayable40: bigint;
  totalRefund42: bigint;

  flows: TaxPeriodFlow[];
  crossPeriodAdjustmentsCount: number;
}

export class VatFlowEngine {
  /**
   * Trích xuất các sự kiện điều chỉnh xuyên kỳ (Cross-period Adjustments)
   */
  public static extractCrossPeriodAdjustments(
    periodGroups: VatPeriodGroup[]
  ): CrossPeriodTaxAdjustment[] {
    const adjustments: CrossPeriodTaxAdjustment[] = [];

    for (const g of periodGroups) {
      if (!g.hasSupplemental || g.snapshots.length < 2) continue;

      const orig = g.snapshots[0];
      const suppSnapshots = g.snapshots.slice(1);

      for (let i = 0; i < suppSnapshots.length; i++) {
        const snap = suppSnapshots[i];
        const prev = i === 0 ? orig : suppSnapshots[i - 1];

        // 1. Kiểm tra thay đổi ở chỉ tiêu [43]
        const deltaCt43 = snap.ct43_thueKhauTruChuyenKySau - prev.ct43_thueKhauTruChuyenKySau;
        // 2. Kiểm tra thay đổi ở chỉ tiêu [40]
        const deltaCt40 = snap.ct40_thuePhaiNop - prev.ct40_thuePhaiNop;

        if (deltaCt43 === 0n && deltaCt40 === 0n) continue;

        let impactType: AdjustmentImpactType = 'UNKNOWN';
        let targetInd = '';
        let sourceInd = '';
        let delta = 0n;
        let prevVal = 0n;
        let newVal = 0n;
        let title = '';
        let desc = '';
        let direction: 'INCREASE' | 'DECREASE' | 'NEUTRAL' = 'NEUTRAL';

        if (deltaCt43 < 0n) {
          impactType = 'CARRY_FORWARD_DECREASE';
          targetInd = '[37]';
          sourceInd = '[43]';
          delta = -deltaCt43;
          prevVal = prev.ct43_thueKhauTruChuyenKySau;
          newVal = snap.ct43_thueKhauTruChuyenKySau;
          direction = 'DECREASE';
          title = `Khai bổ sung ${g.periodLabel} làm giảm số thuế còn được khấu trừ`;
          desc = `Chỉ tiêu [43] giảm từ ${formatMoneyVND(prevVal)} xuống ${formatMoneyVND(newVal)} (chênh lệch ${formatMoneyVND(delta)}). Doanh nghiệp phải kê khai số giảm này vào chỉ tiêu [37] của kỳ nộp tờ khai bổ sung.`;
        } else if (deltaCt43 > 0n) {
          impactType = 'CARRY_FORWARD_INCREASE';
          targetInd = '[38]';
          sourceInd = '[43]';
          delta = deltaCt43;
          prevVal = prev.ct43_thueKhauTruChuyenKySau;
          newVal = snap.ct43_thueKhauTruChuyenKySau;
          direction = 'INCREASE';
          title = `Khai bổ sung ${g.periodLabel} làm tăng số thuế còn được khấu trừ`;
          desc = `Chỉ tiêu [43] tăng từ ${formatMoneyVND(prevVal)} lên ${formatMoneyVND(newVal)} (chênh lệch ${formatMoneyVND(delta)}). Doanh nghiệp kê khai số tăng này vào chỉ tiêu [38] của kỳ nộp tờ khai bổ sung.`;
        } else if (deltaCt40 > 0n) {
          impactType = 'TAX_PAYABLE_INCREASE';
          targetInd = '[40]';
          sourceInd = '[40]';
          delta = deltaCt40;
          prevVal = prev.ct40_thuePhaiNop;
          newVal = snap.ct40_thuePhaiNop;
          direction = 'INCREASE';
          title = `Khai bổ sung ${g.periodLabel} làm tăng số thuế GTGT phải nộp`;
          desc = `Chỉ tiêu [40] tăng thêm ${formatMoneyVND(delta)}. Doanh nghiệp phải nộp bổ sung tiền thuế và tiền chậm nộp tương ứng vào NSNN.`;
        } else if (deltaCt40 < 0n) {
          impactType = 'TAX_PAYABLE_DECREASE';
          targetInd = '[40]';
          sourceInd = '[40]';
          delta = -deltaCt40;
          prevVal = prev.ct40_thuePhaiNop;
          newVal = snap.ct40_thuePhaiNop;
          direction = 'DECREASE';
          title = `Khai bổ sung ${g.periodLabel} làm giảm số thuế GTGT phải nộp`;
          desc = `Chỉ tiêu [40] giảm từ ${formatMoneyVND(prevVal)} xuống ${formatMoneyVND(newVal)} (chênh lệch ${formatMoneyVND(delta)}). Doanh nghiệp được kê khai trừ số giảm này theo hướng dẫn của cơ quan thuế.`;
        }

        let impactYear = g.year;
        let impactMonth: number | undefined = g.month;
        let impactQuarter: number | undefined = g.quarter;
        let isCrossPeriod = false;

        if (snap.submittedAt) {
          const m = snap.submittedAt.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
          if (m) {
            const subMonth = parseInt(m[2], 10);
            const subYear = parseInt(m[3], 10);
            // Kỳ tác động = kỳ chứa tháng NỘP bổ sung, theo đúng tần suất của nhóm nguồn
            // (nhóm quý phải sinh key "-Q.." để khớp periodKey trong normalizeYearFlow,
            //  trước đây chỉ sinh "-M.." nên điều chỉnh cross-quarter bị lọc mất hoàn toàn)
            if (g.quarter && !g.month) {
              impactYear = subYear;
              impactMonth = undefined;
              impactQuarter = Math.floor((subMonth - 1) / 3) + 1;
              isCrossPeriod = subYear !== g.year || impactQuarter !== g.quarter;
            } else {
              impactYear = subYear;
              impactMonth = subMonth;
              impactQuarter = undefined;
              isCrossPeriod = subYear !== g.year || subMonth !== g.month;
            }
          }
        }

        const impactPeriodKey = g.month
          ? `${impactYear}-M${String(impactMonth).padStart(2, '0')}`
          : `${impactYear}-Q${impactQuarter}`;
        const impactPeriodLabel = g.month
          ? `Tháng ${String(impactMonth).padStart(2, '0')}/${impactYear}`
          : `Quý ${impactQuarter}/${impactYear}`;

        adjustments.push({
          adjustmentId: `ADJ_${snap.submissionId}_${i + 1}`,
          sourcePeriod: {
            periodKey: g.periodKey,
            periodLabel: g.periodLabel,
            year: g.year,
            month: g.month,
            quarter: g.quarter
          },
          sourceRecordId: snap.submissionId,
          supplementarySequence: snap.supplementalNo || (i + 1),
          supplementaryFiledDate: snap.submittedAt,
          impactPeriod: isCrossPeriod ? {
            periodKey: impactPeriodKey,
            periodLabel: impactPeriodLabel,
            year: impactYear,
            month: impactMonth,
            quarter: impactQuarter
          } : null,
          impactType,
          sourceIndicator: sourceInd,
          targetIndicator: targetInd,
          previousValue: prevVal,
          newValue: newVal,
          delta,
          direction,
          confidence: 'CONFIRMED',
          title,
          description: desc,
          evidence: {
            formCode: snap.formCode,
            submissionId: snap.submissionId,
            submittedAt: snap.submittedAt,
            status: snap.status
          }
        });
      }
    }

    return adjustments;
  }

  /**
   * Chuẩn hóa toàn bộ dòng chảy thuế GTGT cho 1 năm cụ thể (Single Source of Truth)
   */
  public static normalizeYearFlow(
    summary: VatAnalyticsSummary | null,
    targetYear: number,
    coverageStatus: 'COMPLETE' | 'PARTIAL' | 'NOT_SCANNED' | 'UNKNOWN' = 'COMPLETE',
    preferredViewMode: 'AUTO' | 'MONTH' | 'QUARTER' = 'AUTO'
  ): VatFlowSummaryYear {
    const allGroups = summary?.periodGroups || [];
    const crossAdjustments = this.extractCrossPeriodAdjustments(allGroups);

    // Lọc các kỳ thuộc năm đang chọn (dựa trên KỲ KÊ KHAI, không phải ngày nộp)
    const yearGroups = allGroups.filter(g => g.year === targetYear);
    // Xác định tần suất kê khai (tháng hay quý) dựa trên đa số kỳ có dữ liệu
    let quarterCount = 0;
    let monthCount = 0;
    for (const g of yearGroups) {
      if (g.periodType === 'QUARTER' || (g.quarter && g.quarter >= 1 && g.quarter <= 4)) quarterCount++;
      else if (g.periodType === 'MONTH' || (g.month && g.month >= 1 && g.month <= 12)) monthCount++;
    }
    const detectedQuarterMode = quarterCount >= monthCount && quarterCount > 0;
    const isQuarterMode = preferredViewMode === 'QUARTER'
      ? true
      : preferredViewMode === 'MONTH'
        ? false
        : detectedQuarterMode;

    const totalSlots = isQuarterMode ? 4 : 12;
    const flows: TaxPeriodFlow[] = [];

    const groupMap = new Map<number, VatPeriodGroup>();
    for (const g of yearGroups) {
      let idx = 0;
      if (isQuarterMode) {
        idx = g.quarter || (g.month ? Math.ceil(g.month / 3) : 0);
      } else {
        idx = g.month || (g.quarter ? g.quarter * 3 : 0);
      }
      if (idx >= 1 && idx <= totalSlots) {
        if (!groupMap.has(idx) || (g.finalSnapshot && !groupMap.get(idx)?.finalSnapshot)) {
          groupMap.set(idx, g);
        }
      }
    }
    let runningPrevCarryForward: bigint | null = null;

    let openingYearBalance = 0n;
    const sortedAvailable = [...yearGroups].sort((a, b) => {
      const aKey = (a.month || a.quarter || 0);
      const bKey = (b.month || b.quarter || 0);
      return aKey - bKey;
    });

    if (sortedAvailable.length > 0 && sortedAvailable[0].finalSnapshot) {
      openingYearBalance = sortedAvailable[0].finalSnapshot.ct22_thueDauVaoKyTruoc;
      runningPrevCarryForward = openingYearBalance;
    }

    // [22] đầu kỳ của năm phải nối với [43] cuối kỳ năm trước. Chỉ dùng
    // tháng 12/Q4 của năm trước để tránh lấy nhầm một kỳ giữa năm khi dữ
    // liệu lịch sử mới chỉ được quét một phần.
    const previousYearClosingGroups = allGroups
      .filter(g => g.year === targetYear - 1 &&
        ((g.periodType === 'MONTH' && g.month === 12) ||
         (g.periodType === 'QUARTER' && g.quarter === 4)) &&
        g.finalSnapshot)
      .sort((a, b) => {
        const aTime = a.finalSnapshot?.submittedAt ? parseSubmissionTimestamp(a.finalSnapshot.submittedAt) : 0;
        const bTime = b.finalSnapshot?.submittedAt ? parseSubmissionTimestamp(b.finalSnapshot.submittedAt) : 0;
        return bTime - aTime;
      });
    const previousYearClosing = previousYearClosingGroups[0]?.finalSnapshot;
    if (previousYearClosing) {
      openingYearBalance = previousYearClosing.ct43_thueKhauTruChuyenKySau;
      runningPrevCarryForward = openingYearBalance;
    }

    for (let slot = 1; slot <= totalSlots; slot++) {
      const g = groupMap.get(slot);
      const periodKey = isQuarterMode
        ? `${targetYear}-Q${slot}`
        : `${targetYear}-M${String(slot).padStart(2, '0')}`;
      const periodLabel = isQuarterMode
        ? `Quý ${slot}/${targetYear}`
        : `Tháng ${String(slot).padStart(2, '0')}/${targetYear}`;
      const shortLabel = isQuarterMode ? `Q${slot}` : `T${slot}`;

      const incomingAdj = crossAdjustments.filter(
        adj => adj.impactPeriod && adj.impactPeriod.periodKey === periodKey && adj.sourcePeriod.periodKey !== periodKey
      );

      const outgoingAdj = crossAdjustments.filter(
        adj => adj.sourcePeriod.periodKey === periodKey && adj.impactPeriod && adj.impactPeriod.periodKey !== periodKey
      );

      if (!g || !g.finalSnapshot) {
        const currentYear = new Date().getFullYear();
        const currentMonth = new Date().getMonth() + 1;
        // Chế độ quý: kỳ hiện tại = quý chứa tháng hiện tại
        const currentSlot = isQuarterMode ? Math.ceil(currentMonth / 3) : currentMonth;
        const isFuturePeriod = targetYear === currentYear && slot > currentSlot;

        let defaultVerLabel: string;
        let semanticState: FlowSemanticState;
        let note: string;
        let narrative: string;

        const isQuarterInterMonth = !isQuarterMode && detectedQuarterMode && (slot % 3 !== 0);

        if (isQuarterInterMonth) {
          defaultVerLabel = 'Kê khai quý';
          semanticState = 'NORMAL';
          note = `Doanh nghiệp kê khai quý (số liệu ở Tháng ${Math.ceil(slot / 3) * 3})`;
          narrative = `${periodLabel}: Doanh nghiệp thực hiện kê khai thuế theo quý. Toàn bộ số liệu quý ${Math.ceil(slot / 3)} được phản ánh tập trung tại kỳ Tháng ${String(Math.ceil(slot / 3) * 3).padStart(2, '0')}/${targetYear}.`;
        } else if (isFuturePeriod) {
          defaultVerLabel = 'Chưa đến kỳ';
          semanticState = 'NORMAL';
          note = 'Chưa đến kỳ kê khai';
          narrative = `${periodLabel} chưa đến thời điểm kê khai.`;
        } else if (coverageStatus === 'COMPLETE') {
          defaultVerLabel = 'Chưa tìm thấy hồ sơ';
          semanticState = 'MISSING';
          note = 'Chưa có dữ liệu hồ sơ để kiểm tra dòng chuyển kỳ';
          narrative = `${periodLabel} chưa tìm thấy hồ sơ tờ khai 01/GTGT trên cổng thuế sau khi đã quét.`;
        } else {
          defaultVerLabel = 'Chưa xác minh';
          semanticState = 'UNVERIFIED';
          note = 'Chưa quét đầy đủ dữ liệu ngày nộp của năm';
          narrative = `${periodLabel} chưa được xác minh do chưa quét đầy đủ phạm vi ngày nộp năm ${targetYear}.`;
        }
        flows.push({
          periodKey,
          periodLabel,
          shortLabel,
          year: targetYear,
          month: isQuarterMode ? undefined : slot,
          quarter: isQuarterMode ? slot : undefined,
          isMonth: !isQuarterMode,
          effectiveSnapshot: null,
          versionLabel: defaultVerLabel,
          supplementaryCount: 0,
          hasSupplemental: false,
          hasIncompleteHistory: false,
          openingCt22: 0n,
          inputVatCt25: 0n,
          outputVatCt35: 0n,
          adjustDecreaseCt37: 0n,
          adjustIncreaseCt38: 0n,
          taxPayableCt40: 0n,
          refundCt42: 0n,
          carryForwardCt43: 0n,
          semanticState,
          flowCheck: {
            status: 'NOT_CHECKABLE',
            previousCarryForward: runningPrevCarryForward,
            currentOpening: null,
            discrepancy: null,
            note
          },
          supplementaryChanges: [],
          incomingAdjustments: incomingAdj,
          outgoingAdjustments: outgoingAdj,
          narrative,
          evidence: null,
          warnings: []
        });
        continue;
      }

      const fin = g.finalSnapshot;
      const suppCount = g.supplementalCount || (g.snapshots.length > 1 ? g.snapshots.length - 1 : 0);
      const isSupp = fin.declarationType === 'SUPPLEMENTAL';
      const verLabel = isSupp ? `BS lần ${fin.supplementalNo || suppCount || 1}` : 'Chính thức';
      const hasIncompleteHistory = isSupp && (g.snapshots.length <= 1 || !g.snapshots.some(s => s.declarationType === 'ORIGINAL'));

      let semanticState: FlowSemanticState = 'NORMAL';
      if (fin.parseStatus === 'FAILED' || fin.parseStatus === 'WARNING') {
        semanticState = 'UNKNOWN_VERSION';
      } else if (fin.ct40_thuePhaiNop > 0n) {
        semanticState = 'TAX_PAYABLE';
      } else if (fin.ct42_thueDeNghiHoanKyNay && fin.ct42_thueDeNghiHoanKyNay > 0n) {
        semanticState = 'REFUND';
      } else if (g.hasValueDelta) {
        semanticState = 'SUPPLEMENTAL_CHANGED';
      }

      let flowStatus: FlowCheckStatus = 'NOT_CHECKABLE';
      let discrepancy: bigint | null = null;
      let flowNote = 'Dòng chuyển kỳ khớp đúng';

      const prevPeriodCarryForward = runningPrevCarryForward;
      if (runningPrevCarryForward !== null) {
        const diff = fin.ct22_thueDauVaoKyTruoc - runningPrevCarryForward;
        if (diff === 0n) {
          flowStatus = 'CONFIRMED';
          discrepancy = 0n;
        } else {
          flowStatus = 'NEEDS_REVIEW';
          discrepancy = diff;
          flowNote = `Chỉ tiêu [22] đầu kỳ (${formatMoneyVND(fin.ct22_thueDauVaoKyTruoc, { showUnit: true })}) chênh lệch ${formatMoneyVND(diff > 0n ? diff : -diff, { showUnit: true })} so với [43] cuối kỳ trước (${formatMoneyVND(runningPrevCarryForward, { showUnit: true })})`;
          if (semanticState === 'NORMAL') {
            semanticState = 'NEEDS_REVIEW';
          }
        }
      } else {
        flowStatus = 'CONFIRMED';
      }

      runningPrevCarryForward = fin.ct43_thueKhauTruChuyenKySau;
      const suppChanges: Array<{
        indicator: string;
        label: string;
        before: bigint;
        after: bigint;
        delta: bigint;
      }> = [];

      if (g.snapshots.length > 1) {
        const orig = g.snapshots[0];
        const latest = fin;

        const checkIndicator = (ind: string, label: string, vBefore: bigint, vAfter: bigint) => {
          const d = vAfter - vBefore;
          if (d !== 0n) {
            suppChanges.push({ indicator: ind, label, before: vBefore, after: vAfter, delta: d });
          }
        };

        checkIndicator('[25]', 'VAT đầu vào được khấu trừ', orig.ct25_thueKhauTruKyNay, latest.ct25_thueKhauTruKyNay);
        checkIndicator('[35]', 'VAT đầu ra phát sinh', orig.ct35_thueBanRa, latest.ct35_thueBanRa);
        checkIndicator('[37]', 'Điều chỉnh giảm thuế khấu trừ', orig.ct37_dChinhGiamThueKTru || 0n, latest.ct37_dChinhGiamThueKTru || 0n);
        checkIndicator('[38]', 'Điều chỉnh tăng thuế khấu trừ', orig.ct38_dChinhTangThueKTru || 0n, latest.ct38_dChinhTangThueKTru || 0n);
        checkIndicator('[40]', 'Thuế GTGT phải nộp', orig.ct40_thuePhaiNop, latest.ct40_thuePhaiNop);
        checkIndicator('[42]', 'Thuế đề nghị hoàn', orig.ct42_thueDeNghiHoanKyNay || 0n, latest.ct42_thueDeNghiHoanKyNay || 0n);
        checkIndicator('[43]', 'Còn được khấu trừ chuyển kỳ sau', orig.ct43_thueKhauTruChuyenKySau, latest.ct43_thueKhauTruChuyenKySau);
      }

      let narrative = '';
      if (fin.ct40_thuePhaiNop > 0n) {
        narrative = `${periodLabel} phát sinh thuế GTGT phải nộp: ${formatMoneyVND(fin.ct40_thuePhaiNop, { showUnit: true })}.`;
      } else if (fin.ct43_thueKhauTruChuyenKySau > 0n) {
        narrative = `${periodLabel} còn thuế GTGT được khấu trừ chuyển sang kỳ sau: ${formatMoneyVND(fin.ct43_thueKhauTruChuyenKySau, { showUnit: true })}.`;
      } else {
        narrative = `${periodLabel} không phát sinh thuế phải nộp hoặc số dư chuyển kỳ.`;
      }

      flows.push({
        periodKey,
        periodLabel,
        shortLabel,
        year: targetYear,
        month: isQuarterMode ? undefined : slot,
        quarter: isQuarterMode ? slot : undefined,
        isMonth: !isQuarterMode,
        effectiveSnapshot: fin,
        versionLabel: verLabel,
        supplementaryCount: suppCount,
        hasSupplemental: isSupp,
        hasIncompleteHistory,
        openingCt22: fin.ct22_thueDauVaoKyTruoc,
        inputVatCt25: fin.ct25_thueKhauTruKyNay,
        outputVatCt35: fin.ct35_thueBanRa,
        adjustDecreaseCt37: fin.ct37_dChinhGiamThueKTru || 0n,
        adjustIncreaseCt38: fin.ct38_dChinhTangThueKTru || 0n,
        taxPayableCt40: fin.ct40_thuePhaiNop,
        refundCt42: fin.ct42_thueDeNghiHoanKyNay || 0n,
        carryForwardCt43: fin.ct43_thueKhauTruChuyenKySau,
        semanticState,
        flowCheck: {
          status: flowStatus,
          previousCarryForward: prevPeriodCarryForward,
          currentOpening: fin.ct22_thueDauVaoKyTruoc,
          discrepancy,
          note: flowNote
        },
        supplementaryChanges: suppChanges,
        incomingAdjustments: incomingAdj,
        outgoingAdjustments: outgoingAdj,
        narrative,
        evidence: {
          submissionId: fin.submissionId,
          formCode: fin.formCode,
          submittedAt: fin.submittedAt,
          declarationType: fin.declarationType,
          supplementalNo: fin.supplementalNo,
          status: fin.status,
          xmlAvailable: fin.xmlAvailable
        },
        warnings: (g.warnings || []).map(w => ({ message: w.message, severity: w.severity }))
      });
    }

    const validFlows = flows.filter(f => f.effectiveSnapshot !== null);
    const totalInput25 = validFlows.reduce((sum, f) => sum + f.inputVatCt25, 0n);
    const totalOutput35 = validFlows.reduce((sum, f) => sum + f.outputVatCt35, 0n);
    const totalAdjDec37 = validFlows.reduce((sum, f) => sum + f.adjustDecreaseCt37, 0n);
    const totalAdjInc38 = validFlows.reduce((sum, f) => sum + f.adjustIncreaseCt38, 0n);
    const totalPayable40 = validFlows.reduce((sum, f) => sum + f.taxPayableCt40, 0n);
    const totalRefund42 = validFlows.reduce((sum, f) => sum + f.refundCt42, 0n);

    let closingYearBalance = 0n;
    const reversedValid = [...validFlows].reverse();
    if (reversedValid.length > 0) {
      closingYearBalance = reversedValid[0].carryForwardCt43;
    }

    return {
      targetYear,
      totalPeriodsInYear: totalSlots,
      periodsWithFiling: validFlows.length,
      periodsWithSupplemental: flows.filter(f => f.hasSupplemental).length,
      periodsWithWarning: flows.filter(f => f.warnings.length > 0).length,
      openingYearBalance,
      closingYearBalance,
      totalInputVat25: totalInput25,
      totalOutputVat35: totalOutput35,
      totalAdjustDecrease37: totalAdjDec37,
      totalAdjustIncrease38: totalAdjInc38,
      totalTaxPayable40: totalPayable40,
      totalRefund42: totalRefund42,
      flows,
      crossPeriodAdjustmentsCount: crossAdjustments.length
    };
  }
}

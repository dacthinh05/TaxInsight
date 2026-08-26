import { MatchedPaymentSlipItem, PaymentMatchConfidence, TaxObligation, TaxObligationStatus } from '../../shared/obligationTypes';
import { PaymentSlipDetail, PaymentSlipRecord } from '../../shared/types';
import { parseMoneyToBigInt } from '../../shared/moneyUtils';
import { TaxNdktClassifier } from './TaxNdktClassifier';
import { GntPeriodNormalizer } from '../scanner/GntPeriodNormalizer';

export interface PaymentLineAllocation {
  paymentSlipId: string;
  subItemStt?: number;
  totalLineAmount: bigint;
  allocatedAmount: bigint;
  remainingAmount: bigint;
}

export interface GntCoverageSummary {
  listCount: number;
  detailRequested: number;
  detailParsed: number;
  detailFailed: number;
  allocationCount: number;
  totalListAmount: bigint;
  totalParsedAmount: bigint;
  status: 'COMPLETE' | 'PARTIAL' | 'FAILED';
}

export class TaxPaymentMatcher {
  /**
   * Trạng thái GNT có phải là NỘP THÀNH CÔNG không.
   * Dùng khớp CHÍNH XÁC thay vì includes('thành công') — trước đây
   * 'không thành công'.includes('thành công') === true khiến GNT THẤT BẠI
   * bị tính nhầm là đã nộp, đội số liệu coverage và phân bổ nghĩa vụ.
   */
  public static isPaidSuccessSlip(slip: { trangThai?: string }): boolean {
    const s = (slip.trangThai || '').toLowerCase().trim();
    if (!s) return false;
    // Loại trừ rõ ràng các trạng thái phủ định trước khi khớp positive
    if (s.includes('không thành công') || s.includes('ko thành công') || s.includes('thất bại') || s.includes('hủy')) {
      return false;
    }
    return s.includes('thành công') || s.includes('đã nộp');
  }

  /**
   * Tính toán tóm tắt độ phủ và tính toàn vẹn của dữ liệu GNT
   */
  public static calculateCoverageSummary(
    slips: PaymentSlipRecord[],
    details?: Map<string, PaymentSlipDetail>
  ): GntCoverageSummary {
    const listCount = slips.length;
    let detailRequested = 0;
    let detailParsed = 0;
    let detailFailed = 0;
    let allocationCount = 0;
    let totalListAmount = 0n;
    let totalParsedAmount = 0n;

    for (const slip of slips) {
      totalListAmount += parseMoneyToBigInt(slip.soTien ?? slip.soTienFormatted);
      if (TaxPaymentMatcher.isPaidSuccessSlip(slip)) {
        detailRequested++;
        const detail = details?.get(slip.id);
        if (detail && detail.items && detail.items.length > 0) {
          detailParsed++;
          allocationCount += detail.items.length;
          // Tổng chi tiết rỗng (bảng parse degenerate) → cộng tổng từ các dòng
          const detailTotal = (detail.tongTienVND || '').trim();
          if (detailTotal && detailTotal !== '0') {
            totalParsedAmount += parseMoneyToBigInt(detailTotal);
          } else {
            for (const it of detail.items) {
              totalParsedAmount += parseMoneyToBigInt(it.soTienVND || '0');
            }
          }
        } else if (details?.has(slip.id)) {
          detailFailed++;
        }
      }
    }

    let status: 'COMPLETE' | 'PARTIAL' | 'FAILED' = 'COMPLETE';
    if (detailRequested > 0 && detailParsed === 0) {
      status = 'FAILED';
    } else if (detailParsed < detailRequested) {
      status = 'PARTIAL';
    }

    return {
      listCount,
      detailRequested,
      detailParsed,
      detailFailed,
      allocationCount,
      totalListAmount,
      totalParsedAmount,
      status
    };
  }

  /**
   * Đối chiếu danh sách Giấy nộp tiền (GNT) với các Nghĩa vụ thuế đã xác định
   */
  public static matchPayments(
    obligations: TaxObligation[],
    paymentSlips: PaymentSlipRecord[],
    paymentDetails?: Map<string, PaymentSlipDetail>
  ): TaxObligation[] {
    // Sắp xếp deterministic tuyệt đối
    const sortedObligations = [...obligations].sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      const periodA = (a.month || a.quarter || 0);
      const periodB = (b.month || b.quarter || 0);
      if (periodA !== periodB) return periodA - periodB;
      return a.id.localeCompare(b.id);
    });

    const sortedSlips = [...paymentSlips].sort((a, b) => {
      const dateA = a.ngayNopThue || a.ngayGuiGnt || a.ngayLapGnt || '';
      const dateB = b.ngayNopThue || b.ngayGuiGnt || b.ngayLapGnt || '';
      // So sánh theo thời gian thực (DD/MM/YYYY) — localeCompare trước đây so sánh
      // theo ngày-trước-tháng khiến '31/01' đứng sau '01/12', phân bổ sai thứ tự
      if (dateA !== dateB) {
        const tA = parseVnDate(dateA)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const tB = parseVnDate(dateB)?.getTime() ?? Number.MAX_SAFE_INTEGER;
        if (tA !== tB) return tA - tB;
        return dateA.localeCompare(dateB);
      }
      const gntA = a.soGnt || '';
      const gntB = b.soGnt || '';
      if (gntA !== gntB) return gntA.localeCompare(gntB);
      return a.id.localeCompare(b.id);
    });

    // Quản lý hạn mức đã phân bổ cho từng dòng con của GNT
    const allocationMap = new Map<string, bigint>();

    const updatedObligations: TaxObligation[] = [];

    for (const ob of sortedObligations) {
      if (ob.amountPayable <= 0n) {
        updatedObligations.push(ob);
        continue;
      }

      let remainingObligation = ob.amountPayable;
      const matchedSlips: MatchedPaymentSlipItem[] = [];

      // FIX 6: Thu thập tất cả candidates EXACT trong một pass đầu để detect ambiguity
      // Duyệt hai pha: pha 1 = EXACT match, pha 2 = HIGH, không bao giờ auto-assign POSSIBLE
      for (const phase of ['EXACT', 'HIGH'] as const) {
        if (remainingObligation <= 0n) break;

        // FIX 6: Candidate collector cho pha hiện tại để kiểm tra ambiguity
        const phaseEligibleLines: Array<{
          slip: PaymentSlipRecord;
          item?: PaymentSlipDetail['items'][0];
          lineKey: string;
          available: bigint;
          result: ReturnType<typeof TaxPaymentMatcher.evaluateMatch>;
        }> = [];

        for (const slip of sortedSlips) {
          // Chỉ đối chiếu các GNT đã nộp thành công (PAID_SUCCESS) — khớp chính
          // xác, loại trừ "không thành công" (tránh bug includes)
          if (!this.isPaidSuccessSlip(slip)) continue;

          const detail = paymentDetails?.get(slip.id);

          // 1. Trường hợp có chi tiết từng dòng tiểu mục (PaymentSlipDetail)
          if (detail && detail.items && detail.items.length > 0) {
            for (const item of detail.items) {
              const lineKey = `${slip.id}_${item.stt}`;
              const lineTotalAmount = parseMoneyToBigInt(item.soTienVND);
              const usedAmount = allocationMap.get(lineKey) || 0n;
              const availableAmount = lineTotalAmount > usedAmount ? lineTotalAmount - usedAmount : 0n;
              if (availableAmount <= 0n) continue;

              const matchResult = this.evaluateMatch(ob, {
                soGnt: slip.soGnt || '',
                kyThue: item.kyThueNgayQd || slip.lanNop || '',
                maNDKT: item.maNDKT,
                referenceDocumentNo: item.soToKhaiQuyetDinh,
                noiDung: item.noiDungKhoanNop || '',
                soTien: availableAmount,
                ngayNop: slip.ngayNopThue || slip.ngayGuiGnt || slip.ngayLapGnt || ''
              });

              if (matchResult.confidence === phase) {
                phaseEligibleLines.push({ slip, item, lineKey, available: availableAmount, result: matchResult });
              }
            }
          }
          // 2. FIX 3: Header-only mode — chỉ cho phép HIGH match, không POSSIBLE
          else if (phase === 'HIGH') {
            const slipKey = `${slip.id}_total`;
            const slipTotalAmount = parseMoneyToBigInt(slip.soTien ?? (slip as any).tongTienVND ?? slip.soTienFormatted);
            const usedAmount = allocationMap.get(slipKey) || 0n;
            const availableAmount = slipTotalAmount > usedAmount ? slipTotalAmount - usedAmount : 0n;
            if (availableAmount <= 0n) continue;

            const matchResult = this.evaluateMatch(ob, {
              soGnt: slip.soGnt || '',
              kyThue: slip.lanNop || '',
              noiDung: '',
              soTien: availableAmount,
              ngayNop: slip.ngayNopThue || slip.ngayGuiGnt || slip.ngayLapGnt || ''
            });

            // FIX 3: Header-only chỉ accept HIGH (không POSSIBLE, không EXACT vì không có referenceDocumentNo)
            if (matchResult.confidence === 'HIGH') {
              phaseEligibleLines.push({ slip, lineKey: slipKey, available: availableAmount, result: matchResult });
            }
          }
        }

        // FIX 6: Detect ambiguity — nếu 2+ candidates cùng phase/confidence cho cùng 1 obligation
        // và không có exact declaration reference để tiebreak → AMBIGUOUS
        if (phaseEligibleLines.length > 1 && phase === 'EXACT') {
          // Kiểm tra xem có candidate nào có declaration reference khớp chính xác không
          const exactRefCandidates = phaseEligibleLines.filter(c => c.result.hasExactDeclarationRef);
          if (exactRefCandidates.length === 0) {
            // Không có declaration reference để tiebreak → AMBIGUOUS
            updatedObligations.push({
              ...ob,
              matchedPaymentAmount: 0n,
              matchedSlips: [],
              discrepancy: ob.amountPayable,
              status: 'AMBIGUOUS_PAYMENT_MATCH',
              statusMessage: `Có ${phaseEligibleLines.length} GNT đủ điều kiện khớp nhưng không có số tờ khai để xác định. Cần kiểm tra thủ công.`
            });
            // Skip pha HIGH cho obligation này
            remainingObligation = -1n; // sentinel để break outer loop
            break;
          }
          // Có exact ref candidates → chỉ dùng những cái đó
          phaseEligibleLines.length = 0;
          phaseEligibleLines.push(...exactRefCandidates);
        }

        if (remainingObligation < 0n) break; // AMBIGUOUS sentinel

        // Allocate theo thứ tự phaseEligibleLines (đã được sort deterministic từ sortedSlips)
        for (const candidate of phaseEligibleLines) {
          if (remainingObligation <= 0n) break;
          const usedAmount = allocationMap.get(candidate.lineKey) || 0n;
          const availableNow = candidate.available - (allocationMap.get(candidate.lineKey) || 0n) + usedAmount;
          // Re-fetch available in case previous candidate consumed some
          const lineTotalAmount = candidate.item
            ? parseMoneyToBigInt(candidate.item.soTienVND)
            : parseMoneyToBigInt(candidate.slip.soTien ?? candidate.slip.soTienFormatted);
          const currentUsed = allocationMap.get(candidate.lineKey) || 0n;
          const currentAvailable = lineTotalAmount > currentUsed ? lineTotalAmount - currentUsed : 0n;
          if (currentAvailable <= 0n) continue;

          const allocate = currentAvailable >= remainingObligation ? remainingObligation : currentAvailable;
          allocationMap.set(candidate.lineKey, currentUsed + allocate);
          remainingObligation -= allocate;

          matchedSlips.push({
            paymentSlipId: candidate.slip.id,
            soGnt: candidate.slip.soGnt,
            maGiaoDich: candidate.slip.maGiaoDich,
            ngayNop: candidate.slip.ngayNopThue || candidate.slip.ngayGuiGnt || candidate.slip.ngayLapGnt || '',
            ngayNopDateOnly: (candidate.slip.ngayNopThue || candidate.slip.ngayGuiGnt || candidate.slip.ngayLapGnt || '').slice(0, 10),
            subItemStt: candidate.item?.stt,
            maNDKT: candidate.item?.maNDKT,
            noiDungKhoanNop: candidate.item?.noiDungKhoanNop,
            allocatedAmount: allocate,
            confidence: candidate.result.confidence,
            matchReason: candidate.result.reason,
            isPaidAfterDeadline: candidate.result.isLate,
            daysLate: candidate.result.daysLate
          });
        }
      }

      // Nếu đã đánh dấu AMBIGUOUS (sentinel), skip — đã push
      if (remainingObligation < 0n) continue;

      // FIX 3: Nếu không match được ở EXACT/HIGH, không auto-promote POSSIBLE lên PAID_MATCHED
      // POSSIBLE → PAYMENT_FOUND_NEEDS_REVIEW
      if (matchedSlips.length === 0) {
        // Kiểm tra xem có POSSIBLE candidate nào không để report NEEDS_REVIEW
        let hasPossibleCandidate = false;
        for (const slip of sortedSlips) {
          if (hasPossibleCandidate) break;
          if (!this.isPaidSuccessSlip(slip)) continue;
          const detail = paymentDetails?.get(slip.id);
          if (detail?.items?.length) {
            for (const item of detail.items) {
              const matchResult = this.evaluateMatch(ob, {
                soGnt: slip.soGnt || '',
                kyThue: item.kyThueNgayQd || '',
                maNDKT: item.maNDKT,
                referenceDocumentNo: item.soToKhaiQuyetDinh,
                noiDung: item.noiDungKhoanNop || '',
                soTien: parseMoneyToBigInt(item.soTienVND),
                ngayNop: slip.ngayNopThue || ''
              });
              if (matchResult.confidence === 'POSSIBLE') { hasPossibleCandidate = true; break; }
            }
          }
        }

        if (hasPossibleCandidate) {
          updatedObligations.push({
            ...ob,
            matchedPaymentAmount: 0n,
            matchedSlips: [],
            discrepancy: ob.amountPayable,
            status: 'PAYMENT_FOUND_NEEDS_REVIEW',
            statusMessage: 'Có GNT tiềm năng liên quan nhưng không đủ bằng chứng để đối chiếu tự động. Cần kiểm tra thủ công.'
          });
          continue;
        }
      }

      // Tổng hợp kết quả đối chiếu cho nghĩa vụ
      const totalMatched = matchedSlips.reduce((sum, s) => sum + s.allocatedAmount, 0n);
      const discrepancy = ob.amountPayable - totalMatched;

      const finalStatus = this.determineMatchedStatus(ob, totalMatched);
      const statusMessage = this.generateMatchedMessage(finalStatus, totalMatched, ob, matchedSlips);

      updatedObligations.push({
        ...ob,
        matchedPaymentAmount: totalMatched,
        matchedSlips,
        discrepancy,
        status: finalStatus,
        statusMessage
      });
    }

    return updatedObligations;
  }

  private static evaluateMatch(
    ob: TaxObligation,
    gnt: {
      soGnt: string;
      kyThue: string;
      maNDKT?: string;
      referenceDocumentNo?: string;
      noiDung?: string;
      soTien: bigint;
      ngayNop: string;
    }
  ): { confidence: PaymentMatchConfidence; reason: string; isLate: boolean; daysLate?: number; hasExactDeclarationRef: boolean } {
    // 1. Phân loại sắc thuế của dòng GNT bằng TaxNdktClassifier
    const classification = TaxNdktClassifier.classify(gnt.maNDKT, gnt.noiDung);

    // 2. HARD FILTER: Nếu sắc thuế bị xung đột (ví dụ GNT là TNCN nhưng tờ khai là GTGT) → CẤM MATCH
    if (TaxNdktClassifier.hasTaxTypeConflict(classification.taxType, ob.taxType)) {
      return {
        confidence: 'NONE',
        reason: `TAX_TYPE_CONFLICT: Sắc thuế khoản nộp [${classification.taxType}] không khớp với nghĩa vụ [${ob.taxType}]`,
        isLate: false,
        hasExactDeclarationRef: false
      };
    }

    let score = 0;
    const reasons: string[] = [];
    let hasExactDeclarationRef = false;

    // FIX 5: Declaration Reference là bằng chứng mạnh nhất (+50 điểm, thay vì không dùng)
    if (gnt.referenceDocumentNo && ob.declarationCode) {
      const refClean = gnt.referenceDocumentNo.trim().replace(/^0+/, '');
      const declCodeClean = ob.declarationCode.trim();
      // So sánh exact string hoặc suffix match (số tờ khai có thể có prefix dài)
      if (gnt.referenceDocumentNo.trim() === declCodeClean ||
          refClean === declCodeClean ||
          gnt.referenceDocumentNo.trim().endsWith(declCodeClean) ||
          declCodeClean.endsWith(refClean)) {
        score += 50;
        hasExactDeclarationRef = true;
        reasons.push(`Khớp số tờ khai [${gnt.referenceDocumentNo.trim()}]`);
      }
    }

    // 3. Khớp sắc thuế theo NDKT
    if (classification.taxType !== 'UNKNOWN' && classification.taxType === ob.taxType) {
      score += 35;
      reasons.push(classification.confidence === 'EXACT_CODE'
        ? `Khớp tiểu mục NDKT [${gnt.maNDKT}]`
        : 'Khớp nội dung sắc thuế');
    }
    // FIX 4: UNKNOWN NDKT không được cộng điểm taxType — và sẽ bị giới hạn max score
    // (không thể đạt EXACT/HIGH khi có NDKT tường minh nhưng không nhận ra)
    //
    // Header-only: khi không có NDKT (thiếu thông tin, không phải sai) → cho credit implicit nhỏ
    // để period+amount có thể đạt HIGH threshold khi không có detail
    const hasExplicitNdktEarly = Boolean(gnt.maNDKT && gnt.maNDKT.trim());
    if (!hasExplicitNdktEarly) {
      // Không có maNDKT → không thể xác nhận nhưng cũng không xung đột → cho 15 implicit credit
      score += 15;
      // Không push reason — implicit credit không hiển thị trừ khi match đủ điều kiện
    }

    // 4. Khớp Kỳ tính thuế (Dùng GntPeriodNormalizer)
    const normalizedPeriod = GntPeriodNormalizer.normalize(gnt.kyThue);
    if (normalizedPeriod && normalizedPeriod.year === ob.year) {
      if (ob.month && normalizedPeriod.month === ob.month) {
        score += 35;
        reasons.push(`Khớp kỳ tháng ${ob.month}/${ob.year}`);
      } else if (ob.quarter && normalizedPeriod.quarter === ob.quarter) {
        score += 35;
        reasons.push(`Khớp kỳ quý Q${ob.quarter}/${ob.year}`);
      } else if (normalizedPeriod.type === 'YEAR') {
        score += 15;
        reasons.push(`Khớp năm ${ob.year}`);
      }
    } else {
      // Fallback text match
      const kyClean = gnt.kyThue.replace(/[^0-9/]/g, '');
      if (ob.month && ob.year) {
        const monthStr = `${String(ob.month).padStart(2, '0')}/${ob.year}`;
        if (gnt.kyThue.includes(monthStr) || kyClean.includes(`${ob.month}${ob.year}`)) {
          score += 35;
          reasons.push(`Khớp kỳ tháng ${monthStr}`);
        }
      } else if (ob.quarter && ob.year) {
        const qStr = `Q${ob.quarter}/${ob.year}`;
        if (gnt.kyThue.toUpperCase().includes(qStr) || gnt.kyThue.includes(`${ob.quarter}/${ob.year}`)) {
          score += 35;
          reasons.push(`Khớp kỳ quý ${qStr}`);
        }
      }
    }

    // 5. Khớp Số tiền (supporting evidence, không phải identity)
    if (gnt.soTien === ob.amountPayable) {
      score += 15;
      reasons.push('Khớp chính xác số tiền nghĩa vụ');
    }

    // FIX 4: Nếu có NDKT code tường minh nhưng không nhận ra (UNKNOWN) + không có declaration ref
    // → giới hạn max score để không auto-match sai sắc thuế.
    // KHÔNG áp dụng khi NDKT vắng mặt (header-only mode) — thiếu thông tin ≠ sai thông tin.
    const hasExplicitNdkt = Boolean(gnt.maNDKT && gnt.maNDKT.trim());
    if (hasExplicitNdkt && classification.taxType === 'UNKNOWN' && !hasExactDeclarationRef) {
      score = Math.min(score, 29); // Cap dưới threshold POSSIBLE (30) → NONE
      if (score > 0) reasons.push('[NDKT không xác định — cần kiểm tra thủ công]');
    }

    // 6. Kiểm tra nộp sau hạn (Late Payment)
    let isLate = false;
    let daysLate: number | undefined = undefined;
    if (ob.deadline.effectivePaymentDeadline && gnt.ngayNop) {
      const deadlineDate = parseVnDate(ob.deadline.effectivePaymentDeadline);
      const payDate = parseVnDate(gnt.ngayNop);
      if (deadlineDate && payDate && payDate.getTime() > deadlineDate.getTime()) {
        isLate = true;
        const diffMs = payDate.getTime() - deadlineDate.getTime();
        daysLate = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      }
    }

    // Thresholds:
    // >= 85: EXACT  (declaration ref + taxType + period)
    // >= 50: HIGH   (taxType + period, hoặc declaration ref + period/taxType)
    // >= 30: POSSIBLE (partial match)
    // < 30: NONE
    if (score >= 85) {
      return { confidence: 'EXACT', reason: reasons.join(' · '), isLate, daysLate, hasExactDeclarationRef };
    }
    if (score >= 50) {
      return { confidence: 'HIGH', reason: reasons.join(' · '), isLate, daysLate, hasExactDeclarationRef };
    }
    if (score >= 30) {
      return { confidence: 'POSSIBLE', reason: reasons.join(' · '), isLate, daysLate, hasExactDeclarationRef };
    }

    return { confidence: 'NONE', reason: 'Không đủ điều kiện khớp', isLate: false, hasExactDeclarationRef: false };
  }

  private static determineMatchedStatus(ob: TaxObligation, totalMatched: bigint): TaxObligationStatus {
    if (ob.amountPayable <= 0n) return 'NO_TAX_DUE';

    if (totalMatched >= ob.amountPayable) {
      return 'PAID_MATCHED';
    }

    if (totalMatched > 0n && totalMatched < ob.amountPayable) {
      return 'PARTIALLY_MATCHED';
    }

    return ob.status;
  }

  private static generateMatchedMessage(
    status: TaxObligationStatus,
    totalMatched: bigint,
    ob: TaxObligation,
    matchedSlips: MatchedPaymentSlipItem[]
  ): string {
    if (status === 'PAID_MATCHED') {
      const slipCount = matchedSlips.length;
      const latestSlip = matchedSlips[matchedSlips.length - 1];
      if (latestSlip?.isPaidAfterDeadline) {
        return `Đã đối chiếu đủ (${slipCount} GNT) · Nộp sau hạn ${latestSlip.daysLate} ngày (Cần kiểm tra tiền chậm nộp)`;
      }
      return `Đã đối chiếu đủ (${slipCount} GNT) · Ngày nộp ${latestSlip?.ngayNopDateOnly || ''}`;
    }

    if (status === 'PARTIALLY_MATCHED') {
      return `GNT đối chiếu thấp hơn nghĩa vụ kê khai (Đã đối chiếu: ${formatMoneyVi(totalMatched)} / ${formatMoneyVi(ob.amountPayable)})`;
    }

    return ob.statusMessage;
  }
}

function parseVnDate(val: string): Date | null {
  const parts = val.trim().split(/[\s/:]+/);
  if (parts.length >= 3) {
    const d = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10) - 1;
    const y = parseInt(parts[2], 10);
    return new Date(y, m, d);
  }
  return null;
}

function formatMoneyVi(num: bigint): string {
  return new Intl.NumberFormat('vi-VN').format(num) + ' ₫';
}

import {
  CoverageStatus,
  DateInterval,
  ScanCoverageRecord,
  YearCoverageEvaluation
} from './coverageTypes';

/**
 * Chuẩn hóa chuỗi ngày DD/MM/YYYY hoặc YYYY-MM-DD sang YYYY-MM-DD
 */
export function normalizeDateToIso(dateStr: string): string {
  const clean = dateStr.trim().split(' ')[0];
  if (!clean) return '';

  // Dạng DD/MM/YYYY
  const vnMatch = clean.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (vnMatch) {
    const d = vnMatch[1].padStart(2, '0');
    const m = vnMatch[2].padStart(2, '0');
    const y = vnMatch[3];
    return `${y}-${m}-${d}`;
  }

  // Dạng YYYY-MM-DD
  const isoMatch = clean.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (isoMatch) {
    const y = isoMatch[1];
    const m = isoMatch[2].padStart(2, '0');
    const d = isoMatch[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return clean;
}

/**
 * Format YYYY-MM-DD sang DD/MM/YYYY để hiển thị cho người dùng
 */
export function formatIsoToVnDate(isoStr: string): string {
  const parts = isoStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return isoStr;
}

/**
 * Hợp nhất (Merge) các khoảng ngày nộp liên tiếp hoặc chồng lấn
 */
export function mergeDateIntervals(intervals: DateInterval[]): DateInterval[] {
  if (intervals.length === 0) return [];

  // Chuẩn hóa và sort theo from ASC
  const valid = intervals
    .map(inv => ({ from: normalizeDateToIso(inv.from), to: normalizeDateToIso(inv.to) }))
    .filter(inv => inv.from && inv.to && inv.from <= inv.to)
    .sort((a, b) => a.from.localeCompare(b.from));

  if (valid.length === 0) return [];

  const merged: DateInterval[] = [valid[0]];

  for (let i = 1; i < valid.length; i++) {
    const current = valid[i];
    const last = merged[merged.length - 1];

    // Tính ngày tiếp theo của last.to để kiểm tra xem có liền kề không
    const lastToDate = new Date(last.to);
    lastToDate.setDate(lastToDate.getDate() + 1);
    const nextDayStr = lastToDate.toISOString().split('T')[0];

    if (current.from <= last.to || current.from <= nextDayStr) {
      // Chồng lấn hoặc liền kề -> Mở rộng last.to
      if (current.to > last.to) {
        last.to = current.to;
      }
    } else {
      merged.push(current);
    }
  }

  return merged;
}

/**
 * Tính các khoảng ngày còn thiếu (Missing Ranges = Target Range - Covered Intervals)
 */
export function subtractDateIntervals(target: DateInterval, covered: DateInterval[]): DateInterval[] {
  const targetFrom = normalizeDateToIso(target.from);
  const targetTo = normalizeDateToIso(target.to);
  if (!targetFrom || !targetTo || targetFrom > targetTo) return [];

  const mergedCovered = mergeDateIntervals(covered);
  const missing: DateInterval[] = [];

  let currentPointer = targetFrom;

  for (const cov of mergedCovered) {
    if (cov.to < currentPointer) continue;
    if (cov.from > targetTo) break;

    if (cov.from > currentPointer) {
      // Có khoảng trống từ currentPointer đến trước cov.from
      const gapToDate = new Date(cov.from);
      gapToDate.setDate(gapToDate.getDate() - 1);
      const gapToStr = gapToDate.toISOString().split('T')[0];

      if (gapToStr >= currentPointer) {
        missing.push({
          from: currentPointer,
          to: gapToStr > targetTo ? targetTo : gapToStr
        });
      }
    }

    // Nhảy con trỏ tới sau cov.to
    const nextDate = new Date(cov.to);
    nextDate.setDate(nextDate.getDate() + 1);
    currentPointer = nextDate.toISOString().split('T')[0];

    if (currentPointer > targetTo) break;
  }

  if (currentPointer <= targetTo) {
    missing.push({
      from: currentPointer,
      to: targetTo
    });
  }

  return missing;
}

/**
 * Đánh giá trạng thái Data Coverage cho một năm cụ thể
 */
export function evaluateYearScanCoverage(
  coverageRecords: ScanCoverageRecord[],
  taxpayerId: string,
  targetYear: number,
  recordsFoundInYear: number
): YearCoverageEvaluation {
  // Lọc các bản ghi scan thành công của chính MST này
  const mstRecords = coverageRecords.filter(
    r => r.taxpayerId === taxpayerId && r.completedSuccessfully
  );

  const fullYearTarget: DateInterval = {
    from: `${targetYear}-01-01`,
    to: `${targetYear}-12-31`
  };

  const coveredIntervals: DateInterval[] = mstRecords.map(r => ({
    from: r.submissionDateFrom,
    to: r.submissionDateTo
  }));

  const mergedCovered = mergeDateIntervals(coveredIntervals);
  const missing = subtractDateIntervals(fullYearTarget, mergedCovered);

  let status: CoverageStatus = 'UNKNOWN';
  let message = '';
  let ctaText: string | undefined = undefined;

  if (missing.length === 0) {
    status = 'COMPLETE';
    message = `Dữ liệu đã được quét đầy đủ phạm vi ngày nộp năm ${targetYear}`;
  } else if (missing.length === 1 && missing[0].from === fullYearTarget.from && missing[0].to === fullYearTarget.to) {
    // Toàn bộ năm chưa được quét
    if (recordsFoundInYear > 0) {
      status = 'PARTIAL';
      message = `Đã tìm thấy ${recordsFoundInYear} hồ sơ kỳ ${targetYear} từ các lần quét khác, nhưng chưa quét ngày nộp năm ${targetYear}.`;
      ctaText = `Quét bổ sung dữ liệu ${targetYear}`;
    } else {
      status = 'NOT_SCANNED';
      message = `Chưa quét dữ liệu ngày nộp năm ${targetYear}.`;
      ctaText = `Quét dữ liệu ${targetYear}`;
    }
  } else {
    // Đã quét một phần
    status = 'PARTIAL';
    const missingDesc = missing
      .map(m => `${formatIsoToVnDate(m.from)} → ${formatIsoToVnDate(m.to)}`)
      .join(', ');
    message = `Dữ liệu năm ${targetYear} mới được quét một phần (chưa quét: ${missingDesc}).`;
    ctaText = `Quét phần còn thiếu`;
  }

  // Tìm thời điểm scan gần nhất
  let lastScannedAt: string | undefined = undefined;
  if (mstRecords.length > 0) {
    const sorted = [...mstRecords].sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
    lastScannedAt = sorted[0].scannedAt;
  }

  return {
    targetYear,
    taxpayerId,
    status,
    coveredRanges: mergedCovered,
    missingRanges: missing,
    recordsFoundInYear,
    lastScannedAt,
    message,
    ctaText
  };
}

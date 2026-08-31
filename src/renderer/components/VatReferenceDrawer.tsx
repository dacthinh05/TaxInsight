import React, { useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Printer,
  SlidersHorizontal,
  X,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  ArrowRight,
  Layers,
  History,
  Info,
  CheckCircle2,
  Table as TableIcon,
  RefreshCw
} from 'lucide-react';
import { YearSelector } from './YearSelector';
import {
  VatAnalyticsSummary
} from '../../shared/vatAnalyticsTypes';
import {
  CrossPeriodTaxAdjustment,
  TaxPeriodFlow,
  VatFlowNormalizer
} from '../utils/VatFlowNormalizer';

interface VatReferenceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  summary: VatAnalyticsSummary | null;
  isLoading: boolean;
  progressMessage?: string;
  onExportExcel: () => void;
  onRefreshAnalytics: () => void;
  onScanSupplementalYear?: (year: number) => void;
  onOpenFilingPreview?: (submissionId: string, initialShowXml?: boolean) => void;
  targetYear?: number;
  availableYears?: number[];
  onSelectYear?: (year: number) => void;
}
type TabMode = 'RECONCILIATION' | 'TAX_FLOW' | 'SUPPLEMENTAL_HISTORY';

// Helper format tiền tệ chuẩn kế toán: số dương "1.234.567", số âm "(250.000.000)", zero/null là "-"
function formatWorkingPaperMoney(
  amount: bigint | number | undefined | null,
  options: { isNegativeParenthesis?: boolean; showDashForZero?: boolean } = {
    isNegativeParenthesis: true,
    showDashForZero: true
  }
): string {
  if (amount === undefined || amount === null) return '-';
  const val = typeof amount === 'bigint' ? amount : BigInt(amount);
  if (val === 0n) return options.showDashForZero ? '-' : '0';

  if (val < 0n) {
    const absStr = (-val).toLocaleString('vi-VN');
    return options.isNegativeParenthesis ? `(${absStr})` : `-${absStr}`;
  }
  return val.toLocaleString('vi-VN');
}

export const VatReferenceDrawer: React.FC<VatReferenceDrawerProps> = ({
  isOpen,
  onClose,
  summary,
  isLoading,
  progressMessage,
  onExportExcel,
  onRefreshAnalytics,
  onScanSupplementalYear,
  onOpenFilingPreview,
  targetYear = 2026,
  availableYears,
  onSelectYear
}) => {
  const [activeTab, setActiveTab] = useState<TabMode>('RECONCILIATION');
  const [selectedYear, setSelectedYear] = useState<number>(targetYear);

  React.useEffect(() => {
    if (targetYear) setSelectedYear(targetYear);
  }, [targetYear]);

  const yearsList = React.useMemo(() => {
    if (availableYears && availableYears.length > 0) {
      const set = new Set<number>([selectedYear, ...availableYears]);
      return Array.from(set).sort((a, b) => b - a);
    }
    const current = new Date().getFullYear();
    const set = new Set<number>([selectedYear, current, current - 1, current - 2, current - 3, current - 4]);
    return Array.from(set).sort((a, b) => b - a);
  }, [availableYears, selectedYear]);

  const handleYearChange = (newYear: number) => {
    setSelectedYear(newYear);
    setExpandedPeriodKey(null);
    setActiveInspectorItem(null);
    setShowCoveragePopover(false);
    if (onSelectYear) {
      onSelectYear(newYear);
    }
  };
  const [expandedPeriodKey, setExpandedPeriodKey] = useState<string | null>(null);
  
  // Single-target Evidence Inspector (Chỉ hiển thị chứng cứ cho chính con số hoặc dòng được click)
  const [activeInspectorItem, setActiveInspectorItem] = useState<{
    title: string;
    indicatorCode: string;
    amount: bigint;
    periodLabel: string;
    versionLabel: string;
    submissionId: string;
    submittedAt?: string;
    formCode: string;
    isCrossPeriod?: boolean;
    sourcePeriodLabel?: string;
    sourceVersionLabel?: string;
    sourceSubmittedAt?: string;
    sourceSubmissionId?: string;
    impactPeriodLabel?: string;
  } | null>(null);

  // Popover xem chi tiết Data Coverage
  const [showCoveragePopover, setShowCoveragePopover] = useState(false);

  // Popover xem quan hệ khai bổ sung (Bổ sung cho tờ khai nào, chuỗi phiên bản, deep links)
  const [activeBsPopoverPeriodKey, setActiveBsPopoverPeriodKey] = useState<string | null>(null);

  // ── Đánh giá Data Coverage của năm đang chọn ─────────────────────────
  const coverageEvaluation = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const yearGroups = (summary?.periodGroups || []).filter(g => g.year === selectedYear);
    const allSnapshots = yearGroups.flatMap(g => g.snapshots || []);

    // Đếm số lượng hồ sơ thực sự có ngày nộp nằm trong năm selectedYear
    const filedInSelectedYearCount = allSnapshots.filter(s => {
      if (!s.submittedAt) return false;
      return s.submittedAt.includes(`/${selectedYear}`) || s.submittedAt.startsWith(`${selectedYear}-`);
    }).length;

    const hasAnyOriginal = yearGroups.some(g => g.snapshots.some(s => s.declarationType === 'ORIGINAL'));

    let status: 'COMPLETE' | 'PARTIAL' | 'NOT_SCANNED' = 'COMPLETE';
    let message = '';

    if (yearGroups.length === 0) {
      status = selectedYear <= currentYear ? 'NOT_SCANNED' : 'COMPLETE';
      message = `Chưa quét dữ liệu ngày nộp năm ${selectedYear}.`;
    } else if (filedInSelectedYearCount === 0) {
      // 100% hồ sơ của năm này đều nộp ở năm khác (ví dụ: quét 2026 bắt được hồ sơ bổ sung của 2025)
      status = 'PARTIAL';
      message = `TaxRecord chỉ tìm thấy ${yearGroups.length} kỳ có hồ sơ bổ sung nộp trong năm khác. Phạm vi ngày nộp năm ${selectedYear} chưa được quét.`;
    } else if (selectedYear === currentYear) {
      // Năm hiện tại (2026) -> Đã quét đến ngày hiện tại
      status = 'COMPLETE';
      message = `Dữ liệu năm ${selectedYear} đã được cập nhật đến thời điểm hiện tại.`;
    } else {
      // Năm quá khứ (ví dụ 2025)
      if (yearGroups.length < 10 || !hasAnyOriginal) {
        status = 'PARTIAL';
        message = `Dữ liệu năm ${selectedYear} mới có ${yearGroups.length}/12 kỳ (thiếu tờ khai chính thức hoặc chưa quét đủ trọn năm).`;
      } else {
        status = 'COMPLETE';
        message = `Dữ liệu đã được quét đầy đủ phạm vi ngày nộp năm ${selectedYear}.`;
      }
    }

    return {
      status,
      recordsCount: yearGroups.length,
      filedInSelectedYearCount,
      message
    };
  }, [summary, selectedYear]);

  // ── Normalize Dữ Liệu Thuế Chuẩn Hóa Theo Năm ─────────────────────────
  const yearFlowSummary = useMemo(() => {
    return VatFlowNormalizer.normalizeYearFlow(summary, selectedYear, coverageEvaluation.status);
  }, [summary, selectedYear, coverageEvaluation.status]);

  if (!isOpen) return null;

  const handlePrevYear = () => {
    setSelectedYear(prev => prev - 1);
    setExpandedPeriodKey(null);
    setActiveInspectorItem(null);
    setShowCoveragePopover(false);
  };
  
  const handleNextYear = () => {
    setSelectedYear(prev => prev + 1);
    setExpandedPeriodKey(null);
    setActiveInspectorItem(null);
    setShowCoveragePopover(false);
  };

  const toggleRowExpand = (periodKey: string) => {
    if (expandedPeriodKey === periodKey) {
      setExpandedPeriodKey(null);
    } else {
      setExpandedPeriodKey(periodKey);
    }
  };

  const prevYear = selectedYear - 1;
  const nextYear = selectedYear + 1;

  // Đếm tổng số phiên bản BS trong năm
  const totalBsVersionsCount = yearFlowSummary.flows.reduce((sum, f) => sum + f.supplementaryCount, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs select-none animate-fadeIn">
      <div className="w-[98vw] max-w-[1580px] h-[95vh] bg-white rounded-2xl flex flex-col shadow-2xl border border-slate-200 overflow-hidden relative font-sans text-slate-800">
        
        {/* ─── 1. TOP HEADER (CHUẨN FORM KIỂM TOÁN) ──────────────────── */}
        <div className="px-6 py-3 bg-white border-b border-slate-200 flex items-center justify-between z-10">
          <div className="flex items-center space-x-3">
            <h2 className="font-bold text-slate-900 text-base tracking-tight">
              ĐỐI CHIẾU KÊ KHAI THUẾ & SỔ KẾ TOÁN (GTGT)
            </h2>
            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-300 font-mono">
              Mẫu 01/GTGT
            </span>
          </div>

          {/* Bộ chọn năm ở giữa: Quick Year Switcher + Type-in + Grid */}
          <div className="flex items-center space-x-1.5 bg-slate-100/90 p-1 rounded-xl border border-slate-200 shadow-2xs">
            <button
              type="button"
              onClick={() => handleYearChange(selectedYear - 1)}
              className="p-1 hover:bg-white rounded-lg text-slate-600 hover:text-slate-900 transition-all cursor-pointer"
              title={`Xem năm ${selectedYear - 1}`}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center space-x-1">
              {yearsList.slice(0, 4).map(y => (
                <button
                  key={y}
                  type="button"
                  onClick={() => handleYearChange(y)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold transition-all cursor-pointer ${
                    y === selectedYear
                      ? 'bg-teal-700 text-white shadow-xs'
                      : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
                  }`}
                >
                  {y}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => handleYearChange(selectedYear + 1)}
              className="p-1 hover:bg-white rounded-lg text-slate-600 hover:text-slate-900 transition-all cursor-pointer"
              title={`Xem năm ${selectedYear + 1}`}
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            <YearSelector
              selectedYear={selectedYear}
              onYearChange={handleYearChange}
              availableYears={availableYears}
              size="sm"
            />
          </div>
          {/* Actions bên phải */}
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onExportExcel}
              disabled={isLoading || !summary}
              className="h-8 px-3 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow-2xs transition-colors disabled:opacity-50 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-teal-700" />
              <span>Xuất Excel</span>
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="h-8 px-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-medium flex items-center space-x-1 shadow-2xs transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5 text-slate-500" />
              <span>In</span>
            </button>

            <button
              type="button"
              className="h-8 px-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-medium flex items-center space-x-1 shadow-2xs transition-colors cursor-pointer"
            >
              <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
              <span>Bộ lọc</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-colors cursor-pointer ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ─── 2. TABS & SUMMARY LINE ────────────────────────────────── */}
        <div className="px-6 bg-white border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center space-x-6 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab('RECONCILIATION')}
              className={`py-2.5 border-b-2 transition-colors cursor-pointer flex items-center space-x-1.5 ${
                activeTab === 'RECONCILIATION'
                  ? 'border-teal-700 text-teal-800 font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <TableIcon className="w-3.5 h-3.5" />
              <span>Bảng đối chiếu</span>
            </button>
            
            <button
              type="button"
              onClick={() => setActiveTab('TAX_FLOW')}
              className={`py-2.5 border-b-2 transition-colors cursor-pointer flex items-center space-x-1.5 ${
                activeTab === 'TAX_FLOW'
                  ? 'border-teal-700 text-teal-800 font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Dòng thuế</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('SUPPLEMENTAL_HISTORY')}
              className={`py-2.5 border-b-2 transition-colors cursor-pointer flex items-center space-x-1.5 ${
                activeTab === 'SUPPLEMENTAL_HISTORY'
                  ? 'border-teal-700 text-teal-800 font-bold'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <History className="w-3.5 h-3.5 text-amber-700" />
              <span>Lịch sử bổ sung</span>
              {yearFlowSummary.periodsWithSupplemental > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-100 text-amber-900 font-bold">
                  {yearFlowSummary.periodsWithSupplemental}
                </span>
              )}
            </button>
          </div>

          <div className="text-[11px] text-slate-400 italic">
            Đơn vị: đồng
          </div>
        </div>

        {/* ─── SUMMARY LINE THỐNG KÊ RÕ RÀNG + DATA COVERAGE STATUS ─── */}
        <div className="px-6 py-2 bg-slate-50 border-b border-slate-200 text-xs text-slate-600 flex items-center justify-between relative">
          <div className="flex items-center space-x-2 font-medium">
            <span className="font-bold text-slate-800">{selectedYear}</span>
            <span>•</span>
            <span>{yearFlowSummary.totalPeriodsInYear} kỳ ({yearFlowSummary.periodsWithFiling} kỳ có hồ sơ)</span>
            <span>•</span>
            <span className="text-amber-800 font-semibold">{yearFlowSummary.periodsWithSupplemental} kỳ có bổ sung</span>
            <span>•</span>
            <span className="text-slate-600">{totalBsVersionsCount} phiên bản BS</span>

            {/* Trạng thái Data Coverage */}
            <span>•</span>
            {coverageEvaluation.status === 'COMPLETE' ? (
              <span className="text-emerald-700 font-semibold flex items-center space-x-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Dữ liệu đã quét đầy đủ</span>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setShowCoveragePopover(!showCoveragePopover)}
                className="text-amber-900 bg-amber-100/90 hover:bg-amber-200 px-2 py-0.5 rounded border border-amber-300 font-bold flex items-center space-x-1 cursor-pointer transition-colors"
                title="Nhấn để xem chi tiết phạm vi dữ liệu"
              >
                <span>◐ Dữ liệu một phần</span>
                <ChevronDown className="w-3 h-3 text-amber-800" />
              </button>
            )}

            {yearFlowSummary.crossPeriodAdjustmentsCount > 0 && (
              <>
                <span>•</span>
                <span className="text-teal-800 font-semibold bg-teal-50 px-1.5 py-0.5 rounded border border-teal-200">
                  {yearFlowSummary.crossPeriodAdjustmentsCount} điều chỉnh từ kỳ trước
                </span>
              </>
            )}
          </div>

          {/* Action CTA quét bổ sung dữ liệu khi PARTIAL */}
          <div className="flex items-center space-x-2">
            {coverageEvaluation.status !== 'COMPLETE' && onScanSupplementalYear && (
              <button
                type="button"
                onClick={() => onScanSupplementalYear(selectedYear)}
                disabled={isLoading}
                className="h-7 px-2.5 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white rounded-md text-[11px] font-semibold flex items-center space-x-1.5 shadow-2xs transition-all cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-3 h-3 ${isLoading ? 'animate-spin' : ''}`} />
                <span>{isLoading ? `Đang quét bổ sung dữ liệu ${selectedYear}...` : `Quét bổ sung dữ liệu ${selectedYear}`}</span>
              </button>
            )}

            <div className="text-[11px] text-slate-400">
              Nhấp dòng để bung chi tiết đối chiếu • Nhấp số tiền để xem nguồn chứng cứ
            </div>
          </div>

          {/* ── Popover giải thích Data Coverage ── */}
          {showCoveragePopover && (
            <div className="absolute left-96 top-9 z-30 w-96 bg-white rounded-xl shadow-xl border border-slate-200 p-4 animate-in fade-in zoom-in-95 duration-100">
              <div className="flex items-start justify-between border-b border-slate-100 pb-2 mb-2.5">
                <div className="flex items-center space-x-1.5">
                  <span className="font-bold text-xs text-slate-900 uppercase">Phạm Vi Dữ Liệu Năm {selectedYear}</span>
                  <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-100 text-amber-900">
                    ◐ PARTIAL
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCoveragePopover(false)}
                  className="text-slate-400 hover:text-slate-700"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <p className="text-xs text-slate-600 leading-relaxed mb-3">
                {coverageEvaluation.message}
              </p>

              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-xs space-y-1 mb-3">
                <div className="text-slate-700"><strong>Đã phát hiện:</strong> {coverageEvaluation.recordsCount} hồ sơ thuộc kỳ {selectedYear}</div>
                <div className="text-amber-900"><strong>Chưa quét:</strong> Dải ngày nộp 01/01/{selectedYear} → 31/12/{selectedYear}</div>
              </div>

              {onScanSupplementalYear && (
                <button
                  type="button"
                  onClick={() => {
                    setShowCoveragePopover(false);
                    onScanSupplementalYear(selectedYear);
                  }}
                  className="w-full h-8 bg-teal-700 hover:bg-teal-800 text-white rounded-lg text-xs font-semibold flex items-center justify-center space-x-1 transition-colors cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Quét bổ sung toàn bộ năm {selectedYear}</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* ─── CẢNH BÁO XML THIẾU: số liệu trống do không tải được file từ Cổng Thuế ─── */}
        {!isLoading && (summary?.failedXmlCount ?? 0) > 0 && (
          <div className="px-6 py-2 bg-rose-50 border-b border-rose-200 text-xs text-rose-800 flex items-center justify-between gap-3">
            <div className="flex items-start space-x-2 min-w-0">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <span className="font-bold">
                  {summary!.failedXmlCount}/{summary!.totalFilingsCount} tờ khai GTGT chưa tải được file XML từ Cổng Thuế
                </span>
                <span> — số liệu các kỳ liên quan đang hiển thị TRỐNG (chỉ có metadata), không phải số liệu thật. Ảnh hưởng tới: </span>
                <span className="font-semibold">
                  {[...new Set((summary!.failedXmlDetails || []).map(d => d.periodLabel).filter(Boolean))].join(', ')}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={onRefreshAnalytics}
              className="shrink-0 h-7 px-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-md text-[11px] font-semibold flex items-center space-x-1.5 shadow-2xs transition-all cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Tải lại XML</span>
            </button>
          </div>
        )}

        {/* ─── 3. MAIN WORKSPACE (BẢNG TRÁI + EVIDENCE INSPECTOR PHẢI) ─── */}
        <div className="flex-1 flex overflow-hidden bg-slate-50/40">
          
          {/* CỘT TRÁI: BẢNG WORKING PAPER KIỂM TOÁN */}
          <div className="flex-1 flex flex-col overflow-auto bg-white border-r border-slate-200">
            {isLoading ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-4">
                <div className="w-10 h-10 rounded-full border-3 border-teal-200 border-t-teal-700 animate-spin" />
                <p className="text-xs text-slate-500">{progressMessage || 'Đang kết xuất working paper kiểm toán…'}</p>
              </div>
            ) : activeTab === 'RECONCILIATION' ? (
              <table className="w-full min-w-[1240px] text-left border-collapse text-[13px] tabular-nums table-fixed">
                {/* 2-Tier Header chuẩn working paper kiểm toán */}
                <thead className="sticky top-0 bg-[#F8FAFC] text-slate-700 font-bold border-b border-slate-300 z-20 shadow-2xs text-[11.5px] select-none">
                  <tr>
                    <th rowSpan={2} className="px-2 py-2 border-r border-slate-200 w-[100px] text-center font-bold">
                      KỲ
                    </th>
                    <th rowSpan={2} className="px-3 py-2 border-r border-slate-200 text-right w-[150px] font-bold">
                      VAT ĐẦU VÀO
                    </th>
                    <th rowSpan={2} className="px-3 py-2 border-r border-slate-200 text-right w-[150px] font-bold">
                      VAT ĐẦU RA
                    </th>
                    <th colSpan={2} className="px-2 py-1 border-r border-slate-200 text-center border-b border-slate-200 bg-slate-100/80 font-bold text-[11px] w-[210px]">
                      ĐIỀU CHỈNH KHẤU TRỪ
                    </th>
                    <th rowSpan={2} className="px-3 py-2 border-r border-slate-200 text-right w-[145px] font-bold">
                      ĐỀ NGHỊ HOÀN
                    </th>
                    <th rowSpan={2} className="px-3 py-2 border-r border-slate-200 text-right w-[145px] font-bold">
                      PHẢI NỘP <span className="font-mono text-[10px] text-slate-400 font-normal">[40]</span>
                    </th>
                    <th rowSpan={2} className="px-3 py-2 border-r border-slate-200 text-right w-[175px] font-bold">
                      CÒN KHẤU TRỪ <span className="font-mono text-[10px] text-slate-400 font-normal">[43]</span>
                    </th>
                    <th rowSpan={2} className="px-3.5 py-2 text-left min-w-[260px] font-bold">
                      HỒ SƠ HIỆU LỰC
                    </th>
                  </tr>
                  <tr className="bg-[#F8FAFC]">
                    <th className="px-2 py-0.5 text-right border-r border-slate-200 font-medium text-[11px] w-[105px]">
                      Giảm <span className="font-mono text-[10px] text-slate-400">[37]</span>
                    </th>
                    <th className="px-2 py-0.5 text-right border-r border-slate-200 font-medium text-[11px] w-[105px]">
                      Tăng <span className="font-mono text-[10px] text-slate-400">[38]</span>
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-200 font-sans">
                  
                  {/* ── ROW ĐẦU KỲ ────────────────────────────────────── */}
                  <tr className="bg-slate-50/80 text-slate-700 font-medium h-[46px]">
                    <td colSpan={3} className="px-3 py-2 border-r border-slate-200 font-semibold text-slate-800">
                      Đầu kỳ <span className="font-normal text-slate-500 text-xs">(chuyển từ 12/{prevYear})</span>
                    </td>
                    <td className="px-3 py-2 border-r border-slate-200 text-right text-slate-400 font-mono">-</td>
                    <td className="px-3 py-2 border-r border-slate-200 text-right text-slate-400 font-mono">-</td>
                    <td className="px-3 py-2 border-r border-slate-200 text-right text-slate-400 font-mono">-</td>
                    <td className="px-3 py-2 border-r border-slate-200 text-right text-slate-400 font-mono">-</td>
                    <td
                      onClick={() => {
                        setActiveInspectorItem({
                          title: 'Thuế GTGT còn được khấu trừ kỳ trước chuyển sang',
                          indicatorCode: '[22] (tương ứng [43] 12/' + prevYear + ')',
                          amount: yearFlowSummary.openingYearBalance,
                          periodLabel: `12/${prevYear}`,
                          versionLabel: 'Chính thức',
                          submissionId: `01GTGT_${prevYear}_M12`,
                          formCode: '01/GTGT'
                        });
                      }}
                      className="px-3 py-2 border-r border-slate-200 text-right font-bold text-slate-900 font-mono hover:underline hover:text-teal-700 cursor-pointer"
                      title="Nhấn để xem nguồn số dư đầu năm"
                    >
                      {formatWorkingPaperMoney(yearFlowSummary.openingYearBalance)}
                    </td>
                    <td className="px-3.5 py-2 text-xs whitespace-nowrap min-w-[260px]">
                      <div className="flex items-center justify-between group">
                        <div className="flex items-center space-x-2">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 shrink-0">
                            Chính thức
                          </span>
                          <span className="font-mono text-[11.5px] text-slate-600">01/GTGT · 12/{prevYear}</span>
                        </div>
                        <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-teal-700 opacity-60 group-hover:opacity-100 transition-opacity shrink-0 ml-1.5" />
                      </div>
                    </td>
                  </tr>

                  {/* ── CÁC DÒNG THÁNG 1..12 (HOẶC QUÝ) ────────────────── */}
                  {yearFlowSummary.flows.map(flow => {
                    const isSelected = expandedPeriodKey === flow.periodKey;
                    const hasFiling = flow.effectiveSnapshot !== null;
                    const hasIncomingAdj = flow.incomingAdjustments.length > 0;
                    const rowHeightClass = 'h-[46px]';

                    return (
                      <React.Fragment key={flow.periodKey}>
                        <tr
                          onClick={() => hasFiling && toggleRowExpand(flow.periodKey)}
                          className={`${rowHeightClass} transition-colors ${
                            !hasFiling
                              ? 'bg-slate-50/40 text-slate-400'
                              : isSelected
                              ? 'bg-teal-50/40 border-l-2 border-l-teal-700 font-medium cursor-pointer'
                              : 'hover:bg-slate-50/80 bg-white cursor-pointer'
                          }`}
                        >
                          {/* 1. Kỳ (100px) */}
                          <td className="px-2 py-2 border-r border-slate-200 text-center font-bold text-slate-900 font-mono w-[100px]">
                            <div className="flex items-center justify-center space-x-1">
                              {hasFiling && (
                                <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isSelected ? 'rotate-180 text-teal-700' : ''}`} />
                              )}
                              <span>{flow.isMonth ? `${String(flow.month).padStart(2, '0')}/${flow.year}` : flow.periodLabel}</span>
                            </div>
                          </td>

                          {/* 2. VAT Đầu vào (150px) */}
                          <td
                            onClick={(e) => {
                              if (!hasFiling) return;
                              e.stopPropagation();
                              setActiveInspectorItem({
                                title: 'VAT đầu vào được khấu trừ',
                                indicatorCode: '[25]',
                                amount: flow.inputVatCt25,
                                periodLabel: flow.periodLabel,
                                versionLabel: flow.versionLabel,
                                submissionId: flow.evidence?.submissionId || '',
                                submittedAt: flow.evidence?.submittedAt,
                                formCode: flow.evidence?.formCode || '01/GTGT'
                              });
                            }}
                            className={`px-3 py-2 border-r border-slate-200 text-right font-mono text-slate-800 w-[150px] ${
                              hasFiling ? 'hover:underline hover:text-teal-700 cursor-pointer' : ''
                            }`}
                          >
                            {hasFiling ? formatWorkingPaperMoney(flow.inputVatCt25) : '-'}
                          </td>

                          {/* 3. VAT Đầu ra (150px) */}
                          <td
                            onClick={(e) => {
                              if (!hasFiling) return;
                              e.stopPropagation();
                              setActiveInspectorItem({
                                title: 'VAT đầu ra phát sinh trong kỳ',
                                indicatorCode: '[35]',
                                amount: flow.outputVatCt35,
                                periodLabel: flow.periodLabel,
                                versionLabel: flow.versionLabel,
                                submissionId: flow.evidence?.submissionId || '',
                                submittedAt: flow.evidence?.submittedAt,
                                formCode: flow.evidence?.formCode || '01/GTGT'
                              });
                            }}
                            className={`px-3 py-2 border-r border-slate-200 text-right font-mono text-slate-800 w-[150px] ${
                              hasFiling ? 'hover:underline hover:text-teal-700 cursor-pointer' : ''
                            }`}
                          >
                            {hasFiling ? formatWorkingPaperMoney(flow.outputVatCt35) : '-'}
                          </td>

                          {/* 4. Điều chỉnh Giảm [37] (125px) */}
                          <td
                            onClick={(e) => {
                              if (!hasFiling || flow.adjustDecreaseCt37 === 0n) return;
                              e.stopPropagation();
                              if (hasIncomingAdj) {
                                const adj = flow.incomingAdjustments[0];
                                setActiveInspectorItem({
                                  title: 'Chi tiết điều chỉnh giảm khấu trừ [37] từ kỳ trước',
                                  indicatorCode: '[37]',
                                  amount: -adj.delta,
                                  periodLabel: flow.periodLabel,
                                  versionLabel: flow.versionLabel,
                                  submissionId: flow.evidence?.submissionId || '',
                                  formCode: '01/GTGT',
                                  isCrossPeriod: true,
                                  sourcePeriodLabel: adj.sourcePeriod.periodLabel,
                                  sourceVersionLabel: `BS lần ${adj.supplementarySequence}`,
                                  sourceSubmittedAt: adj.supplementaryFiledDate,
                                  sourceSubmissionId: adj.sourceRecordId,
                                  impactPeriodLabel: flow.periodLabel
                                });
                              } else {
                                setActiveInspectorItem({
                                  title: 'Điều chỉnh giảm thuế GTGT còn được khấu trừ',
                                  indicatorCode: '[37]',
                                  amount: flow.adjustDecreaseCt37,
                                  periodLabel: flow.periodLabel,
                                  versionLabel: flow.versionLabel,
                                  submissionId: flow.evidence?.submissionId || '',
                                  submittedAt: flow.evidence?.submittedAt,
                                  formCode: '01/GTGT'
                                });
                              }
                            }}
                            className={`px-2.5 py-2 border-r border-slate-200 text-right font-mono min-w-[125px] ${
                              flow.adjustDecreaseCt37 > 0n
                                ? 'text-red-700 font-semibold hover:underline cursor-pointer'
                                : 'text-slate-400'
                            }`}
                          >
                            {hasFiling && flow.adjustDecreaseCt37 > 0n ? (
                              <div className="flex flex-col items-end leading-tight">
                                <span className="tabular-nums">{formatWorkingPaperMoney(flow.adjustDecreaseCt37)}</span>
                                {hasIncomingAdj && (
                                  <span className="text-[9.5px] font-sans text-amber-800 font-normal mt-0.5 whitespace-nowrap">
                                    (từ {flow.incomingAdjustments[0].sourcePeriod.periodLabel.replace('Tháng ', '')})
                                  </span>
                                )}
                              </div>
                            ) : '-'}
                          </td>

                          {/* 5. Điều chỉnh Tăng [38] (125px) */}
                          <td
                            onClick={(e) => {
                              if (!hasFiling || flow.adjustIncreaseCt38 === 0n) return;
                              e.stopPropagation();
                              setActiveInspectorItem({
                                title: 'Điều chỉnh tăng thuế GTGT còn được khấu trừ',
                                indicatorCode: '[38]',
                                amount: flow.adjustIncreaseCt38,
                                periodLabel: flow.periodLabel,
                                versionLabel: flow.versionLabel,
                                submissionId: flow.evidence?.submissionId || '',
                                submittedAt: flow.evidence?.submittedAt,
                                formCode: '01/GTGT'
                              });
                            }}
                            className={`px-2.5 py-2 border-r border-slate-200 text-right font-mono min-w-[125px] ${
                              flow.adjustIncreaseCt38 > 0n
                                ? 'text-teal-700 font-semibold hover:underline cursor-pointer'
                                : 'text-slate-400'
                            }`}
                          >
                            {hasFiling && flow.adjustIncreaseCt38 > 0n
                              ? formatWorkingPaperMoney(flow.adjustIncreaseCt38)
                              : '-'}
                          </td>

                          {/* 6. Đề nghị hoàn (145px) */}
                          <td
                            onClick={(e) => {
                              if (!hasFiling || flow.refundCt42 === 0n) return;
                              e.stopPropagation();
                              setActiveInspectorItem({
                                title: 'Thuế GTGT đề nghị hoàn trong kỳ',
                                indicatorCode: '[42]',
                                amount: flow.refundCt42,
                                periodLabel: flow.periodLabel,
                                versionLabel: flow.versionLabel,
                                submissionId: flow.evidence?.submissionId || '',
                                submittedAt: flow.evidence?.submittedAt,
                                formCode: '01/GTGT'
                              });
                            }}
                            className={`px-3 py-2 border-r border-slate-200 text-right font-mono text-slate-700 w-[145px] ${
                              hasFiling && flow.refundCt42 > 0n ? 'hover:underline hover:text-teal-700 cursor-pointer font-semibold' : ''
                            }`}
                          >
                            {hasFiling && flow.refundCt42 > 0n ? formatWorkingPaperMoney(flow.refundCt42) : '-'}
                          </td>

                          {/* 7. Thuế Phải nộp [40] (145px) */}
                          <td
                            onClick={(e) => {
                              if (!hasFiling || flow.taxPayableCt40 === 0n) return;
                              e.stopPropagation();
                              setActiveInspectorItem({
                                title: 'Thuế GTGT phải nộp trong kỳ',
                                indicatorCode: '[40]',
                                amount: flow.taxPayableCt40,
                                periodLabel: flow.periodLabel,
                                versionLabel: flow.versionLabel,
                                submissionId: flow.evidence?.submissionId || '',
                                submittedAt: flow.evidence?.submittedAt,
                                formCode: '01/GTGT'
                              });
                            }}
                            className={`px-3 py-2 border-r border-slate-200 text-right font-mono font-semibold text-slate-900 w-[145px] ${
                              hasFiling && flow.taxPayableCt40 > 0n ? 'hover:underline hover:text-teal-700 cursor-pointer' : 'text-slate-400 font-normal'
                            }`}
                          >
                            {hasFiling && flow.taxPayableCt40 > 0n
                              ? formatWorkingPaperMoney(flow.taxPayableCt40, { isNegativeParenthesis: false, showDashForZero: false })
                              : '-'}
                          </td>

                          {/* 8. Số dư còn khấu trừ [43] (175px) */}
                          <td
                            onClick={(e) => {
                              if (!hasFiling || flow.carryForwardCt43 === 0n) return;
                              e.stopPropagation();
                              setActiveInspectorItem({
                                title: 'Thuế GTGT còn được khấu trừ chuyển kỳ sau',
                                indicatorCode: '[43]',
                                amount: flow.carryForwardCt43,
                                periodLabel: flow.periodLabel,
                                versionLabel: flow.versionLabel,
                                submissionId: flow.evidence?.submissionId || '',
                                submittedAt: flow.evidence?.submittedAt,
                                formCode: '01/GTGT'
                              });
                            }}
                            className={`px-3 py-2 border-r border-slate-200 text-right font-mono font-bold text-slate-900 w-[175px] ${
                              hasFiling && flow.carryForwardCt43 > 0n ? 'hover:underline hover:text-teal-700 cursor-pointer' : 'text-slate-400 font-normal'
                            }`}
                          >
                            {hasFiling ? formatWorkingPaperMoney(flow.carryForwardCt43) : '-'}
                          </td>

                          {/* 9. HỒ SƠ HIỆU LỰC (1 DÒNG DUY NHẤT NGANG) */}
                          <td className="px-3.5 py-2 font-sans relative min-w-[260px] whitespace-nowrap">
                            {hasFiling ? (
                              <div className="flex items-center justify-between group">
                                <div className="flex items-center space-x-2">
                                  {flow.hasSupplemental ? (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setActiveBsPopoverPeriodKey(
                                          activeBsPopoverPeriodKey === flow.periodKey ? null : flow.periodKey
                                        );
                                      }}
                                      className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100 transition-colors cursor-pointer shrink-0"
                                      title="Xem chi tiết chuỗi bổ sung"
                                    >
                                      <span>{flow.versionLabel}</span>
                                      <ChevronDown className="w-3 h-3 ml-1 text-amber-700" />
                                    </button>
                                  ) : (
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 shrink-0">
                                      Chính thức
                                    </span>
                                  )}
                                  <span className="text-[11.5px] text-slate-600 font-mono flex items-center space-x-1">
                                    <span>{flow.evidence?.formCode || '01/GTGT'}</span>
                                    <span>·</span>
                                    <span>{flow.evidence?.submittedAt ? flow.evidence.submittedAt.split(' ')[0] : '—'}</span>
                                  </span>
                                </div>

                                <button
                                  type="button"
                                  title="Mở chi tiết chứng cứ & tờ khai"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setActiveInspectorItem({
                                      title: `Tờ khai ${flow.evidence?.formCode || '01/GTGT'} – Kỳ ${flow.periodLabel}`,
                                      indicatorCode: 'TỔNG HỢP',
                                      amount: flow.carryForwardCt43 > 0n ? flow.carryForwardCt43 : flow.taxPayableCt40,
                                      periodLabel: flow.periodLabel,
                                      versionLabel: flow.versionLabel,
                                      submissionId: flow.evidence?.submissionId || '',
                                      submittedAt: flow.evidence?.submittedAt,
                                      formCode: flow.evidence?.formCode || '01/GTGT'
                                    });
                                  }}
                                  className="p-1 hover:bg-teal-50 rounded-md text-slate-400 hover:text-teal-700 opacity-60 group-hover:opacity-100 transition-all cursor-pointer shrink-0 ml-1.5"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center space-x-2 text-xs">
                                <span className="text-slate-400 italic">
                                  Chưa tìm thấy hồ sơ
                                </span>
                                {flow.month === 12 && onScanSupplementalYear && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onScanSupplementalYear(flow.year + 1);
                                    }}
                                    className="px-2 py-0.5 bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-300 rounded text-[10.5px] font-semibold transition-colors cursor-pointer"
                                    title={`Tờ khai 12/${flow.year} thường được nộp vào tháng 01/${flow.year + 1}. Bấm để quét tìm trong năm ${flow.year + 1}.`}
                                  >
                                    + Quét tìm trong {flow.year + 1}
                                  </button>
                                )}
                              </div>
                            )}

                            {/* ── Compact Popover Khai Bổ Sung ── */}
                            {hasFiling && flow.hasSupplemental && activeBsPopoverPeriodKey === flow.periodKey && (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="absolute right-3 top-12 z-40 w-80 bg-white rounded-xl shadow-2xl border border-slate-200 p-4 text-left animate-in fade-in zoom-in-95 duration-100"
                              >
                                <div className="flex items-start justify-between border-b border-slate-100 pb-2 mb-2.5">
                                  <div className="flex items-center space-x-1.5">
                                    <span className="font-bold text-xs text-amber-900 uppercase">KHAI BỔ SUNG</span>
                                    <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-100 text-amber-900">
                                      {flow.versionLabel}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setActiveBsPopoverPeriodKey(null)}
                                    className="text-slate-400 hover:text-slate-700"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                                <div className="space-y-2.5 text-xs text-slate-700">
                                  <div>
                                    <div className="text-slate-400 text-[10.5px]">Tờ khai được bổ sung:</div>
                                    <div className="font-bold text-slate-900">
                                      01/GTGT · Kỳ {flow.isMonth ? `${String(flow.month).padStart(2, '0')}/${flow.year}` : flow.periodLabel}
                                    </div>
                                  </div>

                                  <div>
                                    <div className="text-slate-400 text-[10.5px]">Phiên bản hiện hành:</div>
                                    <div className="font-semibold text-slate-800">
                                      {flow.versionLabel} {flow.evidence?.submittedAt ? `· ${flow.evidence.submittedAt}` : ''}
                                    </div>
                                  </div>

                                  {/* Chuỗi hồ sơ */}
                                  <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 space-y-1">
                                    <div className="font-bold text-[10.5px] uppercase text-slate-500">Chuỗi hồ sơ:</div>
                                    {!flow.hasIncompleteHistory ? (
                                      <div className="space-y-0.5 font-mono text-[11px] text-slate-700">
                                        <div>✓ Chính thức</div>
                                        {flow.supplementaryCount > 1 && (
                                          <div>→ BS lần 1</div>
                                        )}
                                        <div className="font-bold text-amber-900">
                                          → {flow.versionLabel} · Hiện hành
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="space-y-1 text-[11px]">
                                        <div className="text-emerald-800 font-semibold">✓ Đã tìm thấy: {flow.versionLabel}</div>
                                        <div className="text-amber-800">⚠ Chưa tìm thấy: Bản chính thức / BS trước</div>
                                        {onScanSupplementalYear && (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setActiveBsPopoverPeriodKey(null);
                                              onScanSupplementalYear(flow.year);
                                            }}
                                            className="mt-1 w-full py-1 bg-amber-200/80 hover:bg-amber-300 text-amber-900 rounded text-[10.5px] font-bold transition-colors cursor-pointer"
                                          >
                                            Quét bổ sung dữ liệu {flow.year}
                                          </button>
                                        )}
                                      </div>
                                    )}
                                  </div>

                                  {/* Thay đổi chính */}
                                  {flow.supplementaryChanges.length > 0 ? (
                                    <div className="space-y-1">
                                      <div className="font-bold text-[10.5px] uppercase text-slate-500">Thay đổi chính:</div>
                                      <div className="space-y-0.5 font-mono text-[11px]">
                                        {flow.supplementaryChanges.map(ch => (
                                          <div key={ch.indicator} className="flex justify-between">
                                            <span className="text-slate-600">{ch.indicator} {ch.label}:</span>
                                            <span className={`font-bold ${ch.delta > 0n ? 'text-emerald-700' : 'text-red-700'}`}>
                                              {ch.delta > 0n ? `+${formatWorkingPaperMoney(ch.delta)}` : formatWorkingPaperMoney(ch.delta)}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="text-slate-400 italic text-[11px]">
                                      Không có thay đổi các chỉ tiêu tài chính cốt lõi
                                    </div>
                                  )}

                                  {/* Actions Deep Links */}
                                  <div className="pt-2 border-t border-slate-100 flex items-center space-x-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setActiveBsPopoverPeriodKey(null);
                                        setActiveInspectorItem({
                                          title: `Tờ khai 01/GTGT – Kỳ ${flow.periodLabel}`,
                                          indicatorCode: 'TỔNG HỢP',
                                          amount: flow.carryForwardCt43 > 0n ? flow.carryForwardCt43 : flow.taxPayableCt40,
                                          periodLabel: flow.periodLabel,
                                          versionLabel: flow.versionLabel,
                                          submissionId: flow.evidence?.submissionId || '',
                                          submittedAt: flow.evidence?.submittedAt,
                                          formCode: flow.evidence?.formCode || '01/GTGT'
                                        });
                                      }}
                                      className="flex-1 h-7 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded text-[11px] font-semibold transition-colors cursor-pointer"
                                    >
                                      Xem {flow.versionLabel}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setActiveBsPopoverPeriodKey(null);
                                        setActiveTab('SUPPLEMENTAL_HISTORY');
                                      }}
                                      className="h-7 px-2.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded text-[11px] font-semibold transition-colors cursor-pointer"
                                    >
                                      Xem lịch sử
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </td>
                        </tr>
                      </React.Fragment>
                    );
                  })}
                </tbody>

                {/* ─── FOOTER CỘNG PHÁT SINH NĂM & CUỐI KỲ ────────────── */}
                <tfoot className="sticky bottom-0 bg-[#F1F5F9] border-t-2 border-slate-300 font-mono font-bold text-slate-900 z-10 shadow-2xs text-[13px] tabular-nums">
                  <tr className="h-[46px]">
                    <td className="px-2 py-2 border-r border-slate-300 text-center font-sans font-bold text-xs w-[100px]">
                      CỘNG NĂM
                    </td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right w-[150px]">
                      {formatWorkingPaperMoney(yearFlowSummary.totalInputVat25)}
                    </td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right w-[150px]">
                      {formatWorkingPaperMoney(yearFlowSummary.totalOutputVat35)}
                    </td>
                    <td className="px-2.5 py-2 border-r border-slate-300 text-right text-red-700 w-[105px]">
                      {yearFlowSummary.totalAdjustDecrease37 > 0n ? formatWorkingPaperMoney(yearFlowSummary.totalAdjustDecrease37) : '-'}
                    </td>
                    <td className="px-2.5 py-2 border-r border-slate-300 text-right text-teal-700 w-[105px]">
                      {yearFlowSummary.totalAdjustIncrease38 > 0n ? formatWorkingPaperMoney(yearFlowSummary.totalAdjustIncrease38) : '-'}
                    </td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right w-[145px]">
                      {yearFlowSummary.totalRefund42 > 0n ? formatWorkingPaperMoney(yearFlowSummary.totalRefund42) : '-'}
                    </td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right text-slate-900 w-[145px]">
                      {yearFlowSummary.totalTaxPayable40 > 0n ? formatWorkingPaperMoney(yearFlowSummary.totalTaxPayable40, { isNegativeParenthesis: false, showDashForZero: false }) : '-'}
                    </td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right text-teal-900 font-bold bg-teal-50/50 w-[175px]">
                      {formatWorkingPaperMoney(yearFlowSummary.closingYearBalance)}
                    </td>
                    <td className="px-3.5 py-2 text-left font-sans text-xs text-slate-500 font-normal min-w-[210px]">
                      CUỐI KỲ (chuyển sang 01/{nextYear})
                    </td>
                  </tr>
                </tfoot>
              </table>
            ) : activeTab === 'SUPPLEMENTAL_HISTORY' ? (
              /* ─── VIEW 3: LỊCH SỬ BỔ SUNG (BẢNG TỔNG KẾT REVIEW TOÀN BỘ BS) ─── */
              <div className="flex-1 flex flex-col p-6 space-y-4">
                <div>
                  <h3 className="font-bold text-sm text-slate-900">Tổng Hợp Lịch Sử Khai Bổ Sung Năm {selectedYear}</h3>
                  <p className="text-xs text-slate-500">Kỳ nào bị sửa, sửa bao nhiêu lần, thay đổi gì và ảnh hưởng đến kỳ nào</p>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-100 font-bold text-slate-700 border-b border-slate-200">
                      <tr>
                        <th className="px-4 py-2.5 w-24">Kỳ kê khai</th>
                        <th className="px-3 py-2.5 w-28 text-center">Phiên bản</th>
                        <th className="px-4 py-2.5">Thay đổi chính</th>
                        <th className="px-4 py-2.5 w-48">Phạm vi ảnh hưởng</th>
                        <th className="px-3 py-2.5 w-24 text-center">Thao tác</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {yearFlowSummary.flows.filter(f => f.hasSupplemental).map(flow => (
                        <tr key={flow.periodKey} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-bold font-mono text-slate-900">{flow.periodLabel}</td>
                          <td className="px-3 py-3 text-center">
                            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-200">
                              {flow.versionLabel}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {flow.supplementaryChanges.length > 0 ? (
                              <div className="space-y-1">
                                {flow.supplementaryChanges.map(ch => (
                                  <div key={ch.indicator} className="font-mono text-slate-700">
                                    <span className="font-bold text-slate-900">{ch.indicator}</span>: {ch.delta > 0n ? '+' : ''}{formatWorkingPaperMoney(ch.delta)} ({ch.label})
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-slate-400 italic">Không thay đổi các chỉ tiêu tài chính cốt lõi</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {flow.incomingAdjustments.length > 0 ? (
                              <span className="text-teal-800 font-semibold">Tác động từ {flow.incomingAdjustments[0].sourcePeriod.periodLabel}</span>
                            ) : (
                              <span>Phát sinh trong kỳ {flow.periodLabel}</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-center">
                            <button
                              type="button"
                              onClick={() => {
                                setExpandedPeriodKey(flow.periodKey);
                                setActiveTab('RECONCILIATION');
                              }}
                              className="text-teal-700 font-semibold hover:underline"
                            >
                              Xem đối chiếu
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              /* ─── VIEW 2: DÒNG THUẾ (FINANCIAL FLOW LEDGER - BẢNG LUỒNG DÒNG THUẾ) ─── */
              <div className="flex-1 flex flex-col p-6 space-y-4 max-w-5xl">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-sm text-slate-900">Bảng Luồng Dòng Thuế GTGT Năm {selectedYear}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Theo dõi chi tiết số thuế khấu trừ luân chuyển qua từng kỳ và nghĩa vụ nộp phát sinh</p>
                  </div>
                  <div className="text-xs font-mono font-semibold px-2.5 py-1 bg-slate-100 rounded-lg text-slate-700 border border-slate-200">
                    Đầu năm: {formatWorkingPaperMoney(yearFlowSummary.openingYearBalance)} đ
                  </div>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs bg-white">
                  <table className="w-full text-left border-collapse text-[13px] tabular-nums">
                    <thead className="bg-[#F8FAFC] text-slate-700 font-bold border-b border-slate-200 text-[11.5px] select-none">
                      <tr className="h-[40px]">
                        <th className="px-3.5 py-2 border-r border-slate-200 w-[180px]">KỲ KÊ KHAI</th>
                        <th className="px-3.5 py-2 border-r border-slate-200 w-[160px]">PHIÊN BẢN HỒ SƠ</th>
                        <th className="px-3.5 py-2 border-r border-slate-200 text-right w-[180px]">ĐIỀU CHỈNH KỲ TRƯỚC</th>
                        <th className="px-3.5 py-2 border-r border-slate-200 text-right w-[210px] bg-teal-50/40">CHUYỂN KỲ SAU [43]</th>
                        <th className="px-3.5 py-2 text-right w-[200px] bg-purple-50/30">PHẢI NỘP TRONG KỲ [40]</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-sans">
                      {yearFlowSummary.flows.map(flow => {
                        const hasFiling = flow.effectiveSnapshot !== null;
                        const isPayable = flow.taxPayableCt40 > 0n;
                        const isCarryForward = flow.carryForwardCt43 > 0n;

                        return (
                          <tr
                            key={flow.periodKey}
                            className={`h-[44px] hover:bg-slate-50/80 transition-colors ${
                              !hasFiling ? 'opacity-40 bg-slate-50/40' : ''
                            }`}
                          >
                            {/* Kỳ */}
                            <td className="px-3.5 py-2 border-r border-slate-200 font-medium text-slate-900">
                              {flow.periodLabel}
                            </td>

                            {/* Phiên bản */}
                            <td className="px-3.5 py-2 border-r border-slate-200 text-xs">
                              {hasFiling ? (
                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${
                                  flow.hasSupplemental
                                    ? 'bg-amber-50 text-amber-900 border border-amber-200'
                                    : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                }`}>
                                  {flow.versionLabel}
                                </span>
                              ) : (
                                <span className="text-slate-400 italic font-normal">Chưa tìm thấy hồ sơ</span>
                              )}
                            </td>

                            {/* Điều chỉnh từ kỳ trước */}
                            <td className="px-3.5 py-2 border-r border-slate-200 text-right font-mono text-xs">
                              {flow.incomingAdjustments.length > 0 ? (
                                <span className="text-amber-800 font-semibold bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                                  {formatWorkingPaperMoney(flow.incomingAdjustments[0].delta)} đ
                                </span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </td>

                            {/* Chuyển kỳ sau [43] */}
                            <td className="px-3.5 py-2 border-r border-slate-200 text-right font-mono font-bold text-teal-900 bg-teal-50/30 text-[13.5px]">
                              {isCarryForward ? `${formatWorkingPaperMoney(flow.carryForwardCt43)} đ` : <span className="text-slate-300 font-normal font-sans">—</span>}
                            </td>

                            {/* Phải nộp trong kỳ [40] */}
                            <td className="px-3.5 py-2 text-right font-mono font-bold text-purple-900 bg-purple-50/20 text-[13.5px]">
                              {isPayable ? `${formatWorkingPaperMoney(flow.taxPayableCt40)} đ` : <span className="text-slate-300 font-normal font-sans">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-slate-100/90 border-t-2 border-slate-300 font-mono font-bold text-slate-900 text-[13px]">
                      <tr className="h-[46px]">
                        <td colSpan={3} className="px-3.5 py-2 border-r border-slate-300 font-sans font-bold text-xs">
                          TỔNG KẾT CUỐI NĂM {selectedYear} (Còn được khấu trừ chuyển sang năm {selectedYear + 1})
                        </td>
                        <td className="px-3.5 py-2 border-r border-slate-300 text-right font-bold text-teal-950 bg-teal-100/70 text-[14px]">
                          {formatWorkingPaperMoney(yearFlowSummary.closingYearBalance)} đ
                        </td>
                        <td className="px-3.5 py-2 text-right text-slate-400 font-normal font-sans text-xs">
                          —
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* Note dưới bảng */}
            <div className="p-3 border-t border-slate-200 text-xs text-slate-500 bg-slate-50/60 flex items-center justify-between">
              <div>
                <strong>Ghi chú:</strong> Số liệu lấy từ tờ khai 01/GTGT và các hồ sơ khai bổ sung đã xác định phiên bản hiện hành.
              </div>
              <div className="text-slate-400 font-mono text-[11px]">
                {yearFlowSummary.periodsWithFiling}/{yearFlowSummary.totalPeriodsInYear} kỳ có dữ liệu
              </div>
            </div>
          </div>

          {/* ─── CỘT PHẢI: EVIDENCE INSPECTOR (CHỈ HIỂN THỊ DÒNG CLICKED) ──── */}
          {activeInspectorItem && (
            <div className="w-[360px] bg-white border-l border-slate-200 flex flex-col justify-between shadow-xs overflow-y-auto animate-in slide-in-from-right duration-150">
              <div className="p-5 space-y-4">
                
                {/* Header Inspector */}
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                  <div>
                    <span className="text-[10px] font-mono font-bold text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                      EVIDENCE INSPECTOR
                    </span>
                    <h3 className="font-bold text-sm text-slate-900 tracking-tight uppercase mt-1">
                      Chi tiết & Chứng cứ
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveInspectorItem(null)}
                    className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Evidence Card Chính */}
                {activeInspectorItem.isCrossPeriod ? (
                  /* Thẻ Cross-Period Adjustment */
                  <div className="border border-amber-300 bg-amber-50/50 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs text-amber-900">
                        {activeInspectorItem.title}
                      </span>
                    </div>

                    <div className="text-xl font-bold font-mono text-red-700">
                      {formatWorkingPaperMoney(activeInspectorItem.amount, { isNegativeParenthesis: true, showDashForZero: false })} đ
                    </div>

                    <div className="text-xs text-amber-900 space-y-1.5 pt-2 border-t border-amber-200/80">
                      <div className="flex justify-between">
                        <span className="text-amber-800">Ảnh hưởng từ:</span>
                        <span className="font-bold">{activeInspectorItem.sourcePeriodLabel} – {activeInspectorItem.sourceVersionLabel}</span>
                      </div>
                      {activeInspectorItem.sourceSubmittedAt && (
                        <div className="flex justify-between">
                          <span className="text-amber-800">Ngày nộp BS:</span>
                          <span className="font-mono">{activeInspectorItem.sourceSubmittedAt}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-amber-800">Chỉ tiêu phản ánh:</span>
                        <span className="font-mono font-bold">{activeInspectorItem.indicatorCode}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-amber-800">Phản ánh tại:</span>
                        <span className="font-bold">{activeInspectorItem.impactPeriodLabel}</span>
                      </div>
                    </div>

                    <div className="pt-2 flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (activeInspectorItem.submissionId) {
                            onOpenFilingPreview?.(activeInspectorItem.submissionId, false);
                          }
                        }}
                        className="flex-1 h-8 bg-amber-200/90 hover:bg-amber-300 active:bg-amber-400 text-amber-950 rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                      >
                        Xem hồ sơ gốc
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (activeInspectorItem.submissionId) {
                            onOpenFilingPreview?.(activeInspectorItem.submissionId, true);
                          }
                        }}
                        className="h-8 px-3 bg-white hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                      >
                        Xem XML
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Thẻ Standard Indicator */
                  <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-white">
                    <div>
                      <div className="text-xs font-medium text-slate-500">
                        {activeInspectorItem.title} <span className="font-mono font-bold text-slate-700">{activeInspectorItem.indicatorCode}</span>
                      </div>
                      <div className="text-xl font-bold font-mono text-slate-900 mt-1">
                        {formatWorkingPaperMoney(activeInspectorItem.amount, { isNegativeParenthesis: false, showDashForZero: false })} đ
                      </div>
                    </div>

                    <div className="text-xs text-slate-600 space-y-1.5 pt-2 border-t border-slate-100">
                      <div className="flex justify-between">
                        <span className="text-slate-400">Nguồn:</span>
                        <span className="font-semibold text-slate-800">{activeInspectorItem.formCode} – Kỳ {activeInspectorItem.periodLabel}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">Phiên bản:</span>
                        <span className="font-semibold text-slate-800">{activeInspectorItem.versionLabel}</span>
                      </div>
                      {activeInspectorItem.submittedAt && (
                        <div className="flex justify-between">
                          <span className="text-slate-400">Ngày nộp:</span>
                          <span className="font-mono">{activeInspectorItem.submittedAt}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-slate-400">Mã hồ sơ:</span>
                        <span className="font-mono text-[11px] text-slate-700 truncate max-w-[170px]" title={activeInspectorItem.submissionId}>
                          {activeInspectorItem.submissionId}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2 flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (activeInspectorItem.submissionId) {
                            onOpenFilingPreview?.(activeInspectorItem.submissionId, false);
                          }
                        }}
                        className="flex-1 h-8 bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                      >
                        Xem tờ khai
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (activeInspectorItem.submissionId) {
                            onOpenFilingPreview?.(activeInspectorItem.submissionId, true);
                          }
                        }}
                        className="flex-1 h-8 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                      >
                        Xem XML
                      </button>
                    </div>
                  </div>
                )}

              </div>

              <div className="p-4 border-t border-slate-200 bg-slate-50">
                <button
                  type="button"
                  onClick={() => setActiveInspectorItem(null)}
                  className="w-full h-8.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Đóng
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

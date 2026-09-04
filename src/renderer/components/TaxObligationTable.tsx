import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Info,
  Scale,
  Search,
  X
} from 'lucide-react';
import { MatchedPaymentSlipItem, TaxObligation, TaxObligationSummary } from '../../shared/obligationTypes';
import { getTaxTypeLabel } from '../../shared/declarationFormatter';
import { formatMoneyVND } from '../../shared/moneyUtils';

interface TaxObligationTableProps {
  obligationSummary: TaxObligationSummary;
  gntCount?: number;
  isDetailLoading?: boolean;
}

interface StatusDisplayInfo {
  label: string;
  badgeClass: string;
}

const getStatusDisplay = (ob: TaxObligation): StatusDisplayInfo => {
  switch (ob.status) {
    case 'PAID_MATCHED':
      return { label: 'Đã đối chiếu đủ', badgeClass: 'bg-emerald-50 text-emerald-800 border-emerald-300' };
    case 'PARTIALLY_MATCHED':
      return { label: 'Đối chiếu một phần', badgeClass: 'bg-purple-50 text-purple-900 border-purple-300' };
    case 'PAST_DEADLINE_NO_MATCHED_PAYMENT':
      return { label: 'Quá hạn · chưa thấy GNT', badgeClass: 'bg-red-50 text-red-800 border-red-300' };
    case 'DUE_TODAY':
      return { label: 'Hạn nộp hôm nay', badgeClass: 'bg-yellow-50 text-yellow-800 border-yellow-400' };
    case 'DUE_SOON':
      return { label: 'Sắp đến hạn', badgeClass: 'bg-orange-50 text-orange-800 border-orange-300' };
    case 'PAYMENT_FOUND_NEEDS_REVIEW':
      return { label: 'Có GNT cần kiểm tra', badgeClass: 'bg-blue-50 text-blue-800 border-blue-300' };
    case 'AMBIGUOUS_PAYMENT_MATCH':
      return { label: 'Nhiều GNT mập mờ', badgeClass: 'bg-amber-50 text-amber-900 border-amber-400' };
    case 'PAYMENT_DATA_UNAVAILABLE':
      return { label: 'Chưa có dữ liệu GNT', badgeClass: 'bg-slate-100 text-slate-600 border-slate-300' };
    case 'NOT_DUE':
      return { label: 'Chưa đến hạn', badgeClass: 'bg-slate-50 text-slate-600 border-slate-200' };
    case 'NO_TAX_DUE':
      return { label: 'Không phát sinh', badgeClass: 'bg-slate-50 text-slate-400 border-slate-200' };
    default:
      return { label: 'Chưa xác định', badgeClass: 'bg-slate-50 text-slate-500 border-slate-200' };
  }
};

const CONFIDENCE_LABEL: Record<string, string> = {
  EXACT: 'Chính xác',
  HIGH: 'Tin cậy cao',
  POSSIBLE: 'Suy đoán'
};

const CONFIDENCE_CLASS: Record<string, string> = {
  EXACT: 'bg-emerald-100 text-emerald-800',
  HIGH: 'bg-teal-100 text-teal-800',
  POSSIBLE: 'bg-blue-100 text-blue-800'
};

const fmtVnd = (v: bigint | number | undefined | null): string => formatMoneyVND(v ?? undefined);

export const TaxObligationTable: React.FC<TaxObligationTableProps> = ({
  obligationSummary,
  gntCount = 0,
  isDetailLoading = false
}) => {
  const [filterTaxType, setFilterTaxType] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedLegalObligation, setSelectedLegalObligation] = useState<TaxObligation | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Lọc dữ liệu theo sắc thuế và tìm kiếm
  const filteredObligations = useMemo(() => {
    return (obligationSummary.obligations || []).filter(ob => {
      // Lọc theo search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchText = `${ob.periodLabel} ${ob.taxType} ${ob.declarationCode} ${ob.title} ${ob.currentVersion}`.toLowerCase();
        if (!matchText.includes(q)) return false;
      }

      // Lọc theo Sắc thuế
      if (filterTaxType === 'ALL') return true;
      return ob.taxType === filterTaxType;
    });
  }, [obligationSummary.obligations, filterTaxType, searchQuery]);

  // Thống kê theo từng sắc thuế
  const statsByTaxType = useMemo(() => {
    const list = obligationSummary.obligations || [];
    let vatSum = 0n;
    let pitSum = 0n;
    let citSum = 0n;
    let landSum = 0n;
    let otherSum = 0n;
    let totalPayable = 0n;

    for (const ob of list) {
      if (ob.amountPayable > 0n) {
        totalPayable += ob.amountPayable;
        if (ob.taxType === 'VAT') vatSum += ob.amountPayable;
        else if (ob.taxType === 'PIT') pitSum += ob.amountPayable;
        else if (ob.taxType === 'CIT') citSum += ob.amountPayable;
        else if (ob.taxType === 'HOUSE_LAND') landSum += ob.amountPayable;
        else otherSum += ob.amountPayable;
      }
    }

    return { vatSum, pitSum, citSum, landSum, otherSum, totalPayable };
  }, [obligationSummary.obligations]);

  const hasReconciliationData =
    obligationSummary.paymentQueryStatus === 'CONNECTED_WITH_DATA' ||
    obligationSummary.totalMatchedPaidAmount > 0n;

  const toggleExpanded = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderMatchedSlipsPanel = (ob: TaxObligation) => {
    if (ob.matchedSlips.length === 0) {
      return (
        <div className="text-[11.5px] text-slate-600 italic">
          {ob.statusMessage || 'Không có Giấy nộp tiền nào được đối chiếu tự động.'}
        </div>
      );
    }

    return (
      <div className="space-y-1.5">
        <div className="font-bold text-[11px] uppercase tracking-wider text-slate-500 mb-1.5">
          Giấy nộp tiền đã đối chiếu ({ob.matchedSlips.length})
        </div>
        {ob.matchedSlips.map((slip: MatchedPaymentSlipItem, sIdx: number) => (
          <div
            key={`${slip.paymentSlipId}_${slip.subItemStt ?? 'total'}_${sIdx}`}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-white rounded-lg border border-slate-200 px-3 py-2"
          >
            <div className="min-w-[150px]">
              <div className="font-mono font-semibold text-slate-800 text-[11px]" title={slip.soGnt}>
                GNT …{slip.soGnt.slice(-10)}
              </div>
              <div className="text-[10.5px] text-slate-500 tabular-nums">{slip.ngayNopDateOnly}</div>
            </div>
            <div className="min-w-[180px]">
              <div className="text-[11px] font-semibold text-slate-700">
                {slip.maNDKT ? `Tiểu mục ${slip.maNDKT}` : 'Toàn tờ (không tách dòng)'}
              </div>
              {slip.noiDungKhoanNop && (
                <div className="text-[10.5px] text-slate-500 max-w-[260px] truncate" title={slip.noiDungKhoanNop}>
                  {slip.noiDungKhoanNop}
                </div>
              )}
            </div>
            <div className="text-right min-w-[120px] ml-auto">
              <div className="font-mono font-bold text-[11.5px] text-teal-950 tabular-nums">
                {fmtVnd(slip.allocatedAmount)}
              </div>
            </div>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${CONFIDENCE_CLASS[slip.confidence] || 'bg-slate-100 text-slate-600'}`}>
              {CONFIDENCE_LABEL[slip.confidence] || slip.confidence}
            </span>
            {slip.isPaidAfterDeadline && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-orange-100 text-orange-800 border border-orange-300">
                ⚠ Nộp sau hạn {slip.daysLate ?? '?'} ngày
              </span>
            )}
            <div className="w-full text-[10.5px] text-slate-500 truncate" title={slip.matchReason}>
              {slip.matchReason}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden select-none">
      {/* ─── 1. TOP HEADER & SUMMARY RIBBON ───────────────────────── */}
      <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 shrink-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-teal-700 text-white flex items-center justify-center shadow-xs">
              <Scale className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-sm font-bold text-slate-900 tracking-tight">
                  Nghĩa Vụ Thuế &amp; Đối Chiếu Giấy Nộp Tiền
                </h2>
                <span className="text-[10.5px] font-semibold text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                  Căn cứ Luật QLT 108/2025 &amp; NĐ 252/2026
                </span>
              </div>
              <p className="text-[11.5px] text-slate-500 mt-0.5">
                Số thuế phát sinh theo tờ khai hiệu lực cao nhất, đối chiếu với Giấy nộp tiền NSNN đã truy vấn từ eTax
              </p>
            </div>
          </div>

          {/* KPI Summary Cards */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {statsByTaxType.vatSum > 0n && (
              <div className="px-3 py-1.5 rounded-lg bg-teal-50/80 border border-teal-200 text-teal-950 font-semibold">
                <span className="text-teal-700 font-normal mr-1">GTGT:</span>
                <span className="font-mono tabular-nums">{statsByTaxType.vatSum.toLocaleString('vi-VN')} ₫</span>
              </div>
            )}
            {statsByTaxType.pitSum > 0n && (
              <div className="px-3 py-1.5 rounded-lg bg-emerald-50/80 border border-emerald-200 text-emerald-950 font-semibold">
                <span className="text-emerald-700 font-normal mr-1">TNCN:</span>
                <span className="font-mono tabular-nums">{statsByTaxType.pitSum.toLocaleString('vi-VN')} ₫</span>
              </div>
            )}
            {statsByTaxType.citSum > 0n && (
              <div className="px-3 py-1.5 rounded-lg bg-blue-50/80 border border-blue-200 text-blue-950 font-semibold">
                <span className="text-blue-700 font-normal mr-1">TNDN:</span>
                <span className="font-mono tabular-nums">{statsByTaxType.citSum.toLocaleString('vi-VN')} ₫</span>
              </div>
            )}
            {statsByTaxType.landSum > 0n && (
              <div className="px-3 py-1.5 rounded-lg bg-amber-50/80 border border-amber-200 text-amber-950 font-semibold">
                <span className="text-amber-700 font-normal mr-1">Nhà đất:</span>
                <span className="font-mono tabular-nums">{statsByTaxType.landSum.toLocaleString('vi-VN')} ₫</span>
              </div>
            )}
            <div className="px-3 py-1.5 rounded-lg bg-slate-900 text-white font-bold font-mono">
              <span className="text-slate-300 font-sans font-normal text-[11px] mr-1.5">Tổng phát sinh:</span>
              <span>{statsByTaxType.totalPayable.toLocaleString('vi-VN')} ₫</span>
            </div>
            {hasReconciliationData && (
              <>
                <div className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold font-mono">
                  <span className="text-emerald-100 font-sans font-normal text-[11px] mr-1.5">Đã nộp:</span>
                  <span>{obligationSummary.totalMatchedPaidAmount.toLocaleString('vi-VN')} ₫</span>
                </div>
                {obligationSummary.totalDiscrepancy > 0n && (
                  <div className="px-3 py-1.5 rounded-lg bg-red-600 text-white font-bold font-mono">
                    <span className="text-red-100 font-sans font-normal text-[11px] mr-1.5">Còn thiếu:</span>
                    <span>{obligationSummary.totalDiscrepancy.toLocaleString('vi-VN')} ₫</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Filter Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {/* Segmented Filter theo sắc thuế */}
          <div className="flex items-center space-x-1 bg-slate-200/70 p-0.5 rounded-lg text-xs">
            {[
              { key: 'ALL', label: `Tất cả (${obligationSummary.obligations?.length || 0})` },
              { key: 'VAT', label: 'GTGT' },
              { key: 'PIT', label: 'TNCN' },
              { key: 'CIT', label: 'TNDN' },
              { key: 'FCT', label: 'Nhà thầu' },
              { key: 'HOUSE_LAND', label: 'Nhà đất' }
            ].map(tab => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilterTaxType(tab.key)}
                className={`px-3 py-1 rounded-md font-semibold transition-all cursor-pointer ${
                  filterTaxType === tab.key
                    ? 'bg-white text-slate-900 shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Search Box */}
          <div className="relative w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Tìm kỳ thuế, mẫu biểu..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal-500 font-sans"
            />
          </div>
        </div>

        {/* Chú thích ranh giới nghiệp vụ */}
        {hasReconciliationData ? (
          <div className="text-[11px] text-teal-900 not-italic bg-teal-50/70 border border-teal-200 rounded px-2.5 py-1 flex items-center justify-between">
            <span>
              ✓ Đã đối chiếu với {gntCount} Giấy nộp tiền truy vấn từ Cổng Thuế.
              {isDetailLoading && <span className="italic text-teal-700"> Đang tải chi tiết tiểu mục NDKT…</span>}
              {obligationSummary.paymentNeedsReviewCount > 0 &&
                ` Có ${obligationSummary.paymentNeedsReviewCount} nghĩa vụ cần kiểm tra thủ công.`}
            </span>
            <span className="font-semibold text-slate-700 not-italic">Được bảo vệ bởi chuỗi phiên bản (Version Chain)</span>
          </div>
        ) : (
          <div className="text-[11px] text-slate-500 italic bg-amber-50/50 border border-amber-200/60 rounded px-2.5 py-1 flex items-center justify-between">
            <span>
              ℹ Chưa có dữ liệu Giấy nộp tiền để đối chiếu thanh toán. Hãy vào tab «Giấy Nộp Tiền» bấm «Tra cứu GNT» trước khi đánh giá tình trạng nộp thuế.
            </span>
            <span className="font-semibold text-slate-700 not-italic">Được bảo vệ bởi chuỗi phiên bản (Version Chain)</span>
          </div>
        )}
      </div>

      {/* ─── 2. MAIN OBLIGATION TABLE ──────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="bg-slate-100/90 text-slate-600 font-semibold sticky top-0 z-10 border-b border-slate-200 shadow-2xs select-none">
            <tr>
              <th className="py-2.5 px-4 w-[110px]">Kỳ tính thuế</th>
              <th className="py-2.5 px-4 w-[150px]">Sắc thuế / Mẫu biểu</th>
              <th className="py-2.5 px-4 w-[140px]">Tờ khai hiệu lực</th>
              <th className="py-2.5 px-4 text-right w-[130px]">Phát sinh lần đầu</th>
              <th className="py-2.5 px-4 text-right w-[145px]">Phải nộp theo TK cuối</th>
              <th className="py-2.5 px-4 text-right w-[135px]">Đã nộp theo GNT</th>
              <th className="py-2.5 px-4 text-right w-[125px]">Còn thiếu</th>
              <th className="py-2.5 px-4 w-[170px]">Hạn nộp &amp; Căn cứ luật</th>
              <th className="py-2.5 px-4">Trạng thái đối chiếu</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-800">
            {filteredObligations.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-12 text-center text-slate-400">
                  <p className="text-xs">Không tìm thấy tờ khai phát sinh phù hợp với bộ lọc</p>
                </td>
              </tr>
            ) : (
              filteredObligations.map((ob, idx) => {
                const hasDiff = ob.hasSupplemental && ob.originalAmountPayable !== undefined && ob.originalAmountPayable !== ob.amountPayable;
                const diffAmount = ob.originalAmountPayable !== undefined ? ob.amountPayable - ob.originalAmountPayable : 0n;

                const statusInfo = getStatusDisplay(ob);
                const isExpanded = expandedIds.has(ob.id);
                const hasDetailRows = ob.matchedSlips.length > 0 ||
                  ob.status === 'PAYMENT_FOUND_NEEDS_REVIEW' ||
                  ob.status === 'AMBIGUOUS_PAYMENT_MATCH';
                const isFullyPaid = ob.amountPayable > 0n && ob.matchedPaymentAmount >= ob.amountPayable;

                return (
                  <React.Fragment key={ob.id || idx}>
                    <tr
                      className={`transition-colors ${isExpanded ? 'bg-slate-50' : 'hover:bg-slate-50/70'}`}
                      onClick={() => hasDetailRows && toggleExpanded(ob.id)}
                    >
                      {/* Kỳ tính thuế */}
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {ob.periodLabel}
                      </td>

                      {/* Sắc thuế / Mẫu biểu */}
                      <td className="py-3 px-4">
                        {(() => {
                          const info = getTaxTypeLabel(ob.taxType, ob.declarationCode);
                          return (
                            <div>
                              <span className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${info.badgeClass}`}>
                                {info.vietnameseName}
                              </span>
                              <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                                Mẫu {ob.declarationCode}
                              </div>
                            </div>
                          );
                        })()}
                      </td>

                      {/* Tờ khai hiệu lực cuối */}
                      <td className="py-3 px-4">
                        <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                          ob.hasSupplemental
                            ? 'bg-amber-50 text-amber-900 border border-amber-200'
                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                        }`}>
                          {ob.currentVersion}
                        </span>
                        {ob.hasSupplemental && ob.supplementalCount !== undefined && ob.supplementalCount > 0 && (
                          <div className="text-[10.5px] text-slate-500 mt-0.5">
                            {ob.supplementalCount} lần bổ sung
                          </div>
                        )}
                      </td>

                      {/* Số thuế phát sinh lần đầu */}
                      <td className="py-3 px-4 text-right">
                        {ob.originalAmountPayable !== undefined && ob.originalAmountPayable > 0n ? (
                          <span className="tabular-nums text-slate-600 font-mono">
                            {ob.originalAmountPayable.toLocaleString('vi-VN')} ₫
                          </span>
                        ) : (
                          <span className="text-slate-400 font-normal">—</span>
                        )}
                      </td>

                      {/* Số thuế phải nộp theo tờ khai cuối cùng */}
                      <td className="py-3 px-4 text-right">
                        {ob.amountPayable > 0n ? (
                          <span className="font-bold tabular-nums text-[13px] text-teal-950 font-mono">
                            {ob.amountPayable.toLocaleString('vi-VN')} ₫
                          </span>
                        ) : (
                          <span className="text-slate-400 font-normal">Không phát sinh</span>
                        )}
                      </td>

                      {/* Đã nộp theo GNT */}
                      <td className="py-3 px-4 text-right">
                        {ob.matchedPaymentAmount > 0n ? (
                          <span className={`font-bold tabular-nums text-[12.5px] font-mono ${isFullyPaid ? 'text-emerald-700' : 'text-purple-800'}`}>
                            {ob.matchedPaymentAmount.toLocaleString('vi-VN')} ₫
                          </span>
                        ) : ob.amountPayable > 0n ? (
                          <span className="text-slate-400 font-normal">—</span>
                        ) : (
                          <span className="text-slate-300 font-normal">—</span>
                        )}
                      </td>

                      {/* Còn thiếu so với phải nộp */}
                      <td className="py-3 px-4 text-right">
                        {ob.amountPayable <= 0n ? (
                          <span className="text-slate-300 font-normal">—</span>
                        ) : ob.discrepancy > 0n ? (
                          <span className="text-red-700 font-semibold font-mono tabular-nums" title="Số thuế chưa tìm thấy chứng từ nộp tương ứng">
                            -{ob.discrepancy.toLocaleString('vi-VN')} ₫
                          </span>
                        ) : ob.discrepancy < 0n ? (
                          <span className="text-blue-700 font-semibold font-mono tabular-nums" title="Nộp thừa so với số thuế phải nộp">
                            +{(ob.discrepancy * -1n).toLocaleString('vi-VN')} ₫
                          </span>
                        ) : (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 inline-block" />
                        )}
                      </td>

                      {/* Hạn nộp & Căn cứ luật */}
                      <td className="py-3 px-4">
                        {ob.deadline.effectivePaymentDeadline ? (
                          <div className="flex items-center space-x-1.5" onClick={e => e.stopPropagation()}>
                            <span className="font-semibold text-slate-800 tabular-nums">
                              {ob.deadline.effectivePaymentDeadline}
                            </span>
                            <button
                              type="button"
                              onClick={() => setSelectedLegalObligation(ob)}
                              className="text-teal-700 hover:text-teal-900 cursor-pointer p-0.5 rounded hover:bg-teal-50"
                              title="Bấm xem chi tiết căn cứ pháp lý & quy định hạn nộp"
                            >
                              <Info className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <span className="text-slate-400">Chưa xác định</span>
                        )}
                      </td>

                      {/* Trạng thái đối chiếu */}
                      <td className="py-3 px-4">
                        <div className="flex items-start space-x-1.5">
                          {hasDetailRows ? (
                            <button
                              type="button"
                              onClick={e => { e.stopPropagation(); toggleExpanded(ob.id); }}
                              className="mt-0.5 text-slate-400 hover:text-slate-700 cursor-pointer p-0.5 rounded hover:bg-slate-200 shrink-0"
                              title={isExpanded ? 'Ẩn danh sách GNT đối chiếu' : 'Xem danh sách GNT đối chiếu'}
                            >
                              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                            </button>
                          ) : null}
                          <div className="min-w-0">
                            <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold border whitespace-nowrap ${statusInfo.badgeClass}`}>
                              {statusInfo.label}
                            </span>
                            {ob.statusMessage && (
                              <div className="text-[10.5px] text-slate-500 mt-0.5 leading-snug max-w-[280px]" title={ob.statusMessage}>
                                {ob.statusMessage}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>

                    {/* Dòng mở rộng: Danh sách GNT đã phân bổ cho nghĩa vụ này */}
                    {isExpanded && hasDetailRows && (
                      <tr key={`${ob.id}_detail`} className="bg-slate-50/60">
                        <td colSpan={9} className="px-10 pb-4 pt-1 border-l-2 border-teal-500">
                          <div onClick={e => e.stopPropagation()}>
                            {renderMatchedSlipsPanel(ob)}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ─── 3. LEGAL BASIS DETAIL MODAL DRAWER ──────────────────────── */}
      {selectedLegalObligation && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setSelectedLegalObligation(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden animate-fadeIn"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-6 py-4 bg-teal-900 text-white flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <BookOpen className="w-5 h-5 text-teal-300" />
                <h3 className="font-bold text-sm">Căn Cứ Pháp Lý &amp; Thời Hạn Nộp Thuế</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedLegalObligation(null)}
                className="text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs text-slate-700 max-h-[75vh] overflow-y-auto">
              <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200/80 space-y-1.5">
                <div className="font-bold text-slate-900 text-[13px]">
                  {selectedLegalObligation.taxType} · {selectedLegalObligation.periodLabel}
                </div>
                <div className="text-slate-600">
                  Mẫu biểu: <span className="font-semibold">Mẫu {selectedLegalObligation.declarationCode}</span> · {selectedLegalObligation.currentVersion}
                </div>
                <div className="text-teal-950 font-bold font-mono text-[13px] pt-1">
                  Số thuế phát sinh theo tờ khai cuối: {formatMoneyVND(selectedLegalObligation.amountPayable)}
                </div>
                <div className="text-slate-600 pt-1">
                  Hạn nộp pháp định: <strong className="text-slate-900">{selectedLegalObligation.deadline.effectivePaymentDeadline}</strong>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-slate-900 uppercase text-[11px] tracking-wider mb-2">
                  Văn bản quy phạm pháp luật áp dụng
                </h4>
                <div className="space-y-2">
                  {selectedLegalObligation.deadline.legalBasis.map((doc, dIdx) => (
                    <div key={dIdx} className="p-3 bg-teal-50/50 rounded-lg border border-teal-200/70">
                      <div className="font-bold text-teal-950">
                        {doc.documentTitle} ({doc.documentNumber})
                      </div>
                      {doc.article && (
                        <div className="text-teal-800 font-semibold mt-0.5">
                          {doc.article} {doc.clause ? `· ${doc.clause}` : ''}
                        </div>
                      )}
                      <div className="text-slate-600 mt-1 leading-relaxed">
                        {doc.summary}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {selectedLegalObligation.deadline.notes && selectedLegalObligation.deadline.notes.length > 0 && (
                <div>
                  <h4 className="font-bold text-slate-900 uppercase text-[11px] tracking-wider mb-1.5">
                    Ghi chú điều chỉnh lịch nộp
                  </h4>
                  <ul className="list-disc list-inside text-slate-600 space-y-1 pl-1">
                    {selectedLegalObligation.deadline.notes.map((note, nIdx) => (
                      <li key={nIdx}>{note}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedLegalObligation(null)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg font-semibold text-xs transition-colors cursor-pointer"
              >
                Đóng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

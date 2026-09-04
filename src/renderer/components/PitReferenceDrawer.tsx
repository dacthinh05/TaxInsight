import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileSpreadsheet,
  Info,
  RefreshCw,
  TableProperties,
  X
} from 'lucide-react';
import { YearSelector } from './YearSelector';
import { PitAnalyticsSummary } from '../../shared/pitAnalyticsTypes';
import { PitFlowEngine } from '../../shared/PitFlowEngine';
interface PitReferenceDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  summary: PitAnalyticsSummary | null;
  isLoading: boolean;
  progressMessage?: string;
  onExportExcel: () => void;
  onRefreshAnalytics: () => void;
  onOpenFilingPreview?: (submissionId: string, isXml?: boolean) => void;
  targetYear: number;
  availableYears?: number[];
  onSelectYear?: (year: number) => void;
}
export const PitReferenceDrawer: React.FC<PitReferenceDrawerProps> = ({
  isOpen,
  onClose,
  summary,
  isLoading,
  progressMessage,
  onExportExcel,
  onRefreshAnalytics,
  onOpenFilingPreview,
  targetYear = 2026,
  availableYears,
  onSelectYear
}) => {
  const [selectedYear, setSelectedYear] = useState<number>(targetYear);
  const [collapsedQuarters, setCollapsedQuarters] = useState<Set<number>>(new Set());
  const [activeInspectorItem, setActiveInspectorItem] = useState<{
    title: string;
    indicatorCode: string;
    amount: bigint;
    periodLabel: string;
    versionLabel: string;
    submissionId: string;
    submittedAt?: string;
    formCode: string;
  } | null>(null);

  useEffect(() => {
    if (targetYear) setSelectedYear(targetYear);
  }, [targetYear]);

  const yearsList = useMemo(() => {
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
    setActiveInspectorItem(null);
    if (onSelectYear) {
      onSelectYear(newYear);
    }
  };

  const yearFlow = useMemo(() => {
    return PitFlowEngine.normalizeYearFlow(summary, selectedYear);
  }, [summary, selectedYear]);
  if (!isOpen) return null;

  const toggleQuarter = (q: number) => {
    const next = new Set(collapsedQuarters);
    if (next.has(q)) next.delete(q);
    else next.add(q);
    setCollapsedQuarters(next);
  };

  const formatMoney = (val: bigint | number | string | undefined | null) => {
    if (val === undefined || val === null || val === '') return '—';
    const num = typeof val === 'bigint' ? Number(val) : typeof val === 'number' ? (Number.isFinite(val) ? val : 0) : 0;
    if (num === 0) return '—';
    return num.toLocaleString('vi-VN');
  };

  // Kiểm tra xem đã đủ 4 quý chưa
  const hasAllQuarters = yearFlow.quarterBlocks.filter(q => q.totalWithheldTax > 0n || q.quarterFiling || q.monthFilings.length > 0).length >= 4;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden select-none animate-fadeIn flex">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-2xs transition-opacity"
        onClick={onClose}
      />

      {/* Main Drawer Fullscreen Canvas */}
      <div className="relative w-full h-full bg-white shadow-2xl flex flex-col z-50 animate-slideLeft">
        
        {/* ─── 1. TOPBAR ─────────────────────────────────────────── */}
        <div className="px-6 py-3 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-teal-50 border border-teal-200 text-teal-800 flex items-center justify-center">
              <TableProperties className="w-4.5 h-4.5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-slate-900 tracking-tight">
                  ĐỐI CHIẾU NGHĨA VỤ THUẾ TNCN & TỜ KHAI
                </h2>
                <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200">
                  Mẫu 05/KK-TNCN & 05/QTT
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Bảng làm việc kiểm toán (Audit Working Paper) · Tự động đối chiếu Tháng, Quý và Quyết toán năm
              </p>
            </div>
          </div>

          {/* Quick Year Switcher ở giữa */}
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

          {/* Action Buttons */}
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onExportExcel}
              className="h-9 px-3.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 shadow-2xs transition-colors cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4" />
              <span>Xuất Excel</span>
            </button>

            <button
              type="button"
              onClick={onRefreshAnalytics}
              disabled={isLoading}
              className="h-9 px-3 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-teal-700' : ''}`} />
              <span>Phân tích lại</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="h-9 w-9 flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
              title="Đóng (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* ─── 2. STATUS & SUMMARY RIBBON ───────────────────────── */}
        <div className="px-6 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs text-slate-600 shrink-0">
          <div className="flex items-center space-x-3">
            <span className="font-semibold text-slate-900">Năm {targetYear}</span>
            <span>·</span>
            <span>{yearFlow.periodsCount} kỳ có hồ sơ</span>
            <span>·</span>
            {yearFlow.auditStatus === 'MATCHED' ? (
              <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>Số liệu phát sinh khớp 100% với Quyết toán năm (05/QTT)</span>
              </span>
            ) : yearFlow.finalizationSnapshot && !hasAllQuarters ? (
              <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-800 border border-blue-200">
                <Info className="w-3.5 h-3.5 text-blue-600" />
                <span>Đang đối chiếu một phần ({yearFlow.periodsCount} kỳ đã quét · Quyết toán năm: {formatMoney(yearFlow.finalizationWithheldTax36)} đ)</span>
              </span>
            ) : yearFlow.auditStatus === 'MISMATCHED' ? (
              <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-red-50 text-red-800 border border-red-200">
                <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                <span>Lệch {formatMoney(yearFlow.mismatchDelta || 0n)} đ so với Quyết toán năm</span>
              </span>
            ) : (
              <span className="text-slate-500 italic">Chưa quét tờ khai Quyết toán năm 05/QTT-TNCN</span>
            )}
          </div>
          <div className="text-[11.5px] text-slate-500">
            Nhấp vào ô số tiền để xem chi tiết chứng cứ và tờ khai
          </div>
        </div>

        {/* ─── 3. TABLE BODY & EVIDENCE INSPECTOR ──────────────── */}
        <div className="flex-1 flex overflow-hidden bg-slate-50/40">
          
          {/* CỘT TRÁI: BẢNG WORKING PAPER KIỂM TOÁN */}
          <div className="flex-1 flex flex-col overflow-auto bg-white border-r border-slate-200">
            {isLoading ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-4">
                <div className="w-10 h-10 rounded-full border-3 border-teal-200 border-t-teal-700 animate-spin" />
                <p className="text-xs text-slate-600 font-medium">{progressMessage || 'Đang kết xuất working paper TNCN…'}</p>
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-[13.5px] tabular-nums">
                <thead className="sticky top-0 bg-[#F8FAFC] text-slate-700 font-bold border-b border-slate-300 z-20 shadow-2xs text-[12px] select-none">
                  <tr className="h-[44px]">
                    <th className="px-4 py-2 border-r border-slate-200 w-[240px] text-left font-bold">
                      KỲ KÊ KHAI (TNCN)
                    </th>
                    <th className="px-3 py-2 border-r border-slate-200 text-right w-[110px] font-bold">
                      SỐ LĐ <span className="font-mono text-[10px] text-slate-400 font-normal">[16]</span>
                    </th>
                    <th className="px-3.5 py-2 border-r border-slate-200 text-right w-[180px] font-bold">
                      TỔNG TNCT <span className="font-mono text-[10px] text-slate-400 font-normal">[21]</span>
                    </th>
                    <th className="px-3.5 py-2 border-r border-slate-200 text-right w-[170px] font-bold">
                      KHẤU TRỪ CƯ TRÚ <span className="font-mono text-[10px] text-slate-400 font-normal">[30]</span>
                    </th>
                    <th className="px-3.5 py-2 border-r border-slate-200 text-right w-[170px] font-bold">
                      KHẤU TRỪ K.CƯ TRÚ <span className="font-mono text-[10px] text-slate-400 font-normal">[31]</span>
                    </th>
                    <th className="px-3.5 py-2 border-r border-slate-200 text-right w-[190px] font-bold bg-teal-50/50">
                      TỔNG KHẤU TRỪ <span className="font-mono text-[10px] text-slate-400 font-normal">[29]</span>
                    </th>
                    <th className="px-4 py-2 text-left min-w-[260px] font-bold">
                      HỒ SƠ HIỆU LỰC
                    </th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-200 font-sans">
                  {yearFlow.quarterBlocks.map(qBlock => {
                    const isCollapsed = collapsedQuarters.has(qBlock.quarter);
                    const hasMonths = qBlock.monthFilings.length > 0;

                    return (
                      <React.Fragment key={`Q_${qBlock.quarter}`}>
                        {/* Dòng Quý (Header Quý) */}
                        <tr className="bg-slate-50/90 font-semibold text-slate-900 h-[48px] border-t border-slate-200">
                          <td className="px-4 py-2 border-r border-slate-200 flex items-center space-x-1.5">
                            {hasMonths ? (
                              <button
                                type="button"
                                onClick={() => toggleQuarter(qBlock.quarter)}
                                className="p-0.5 text-slate-400 hover:text-slate-700 rounded cursor-pointer"
                              >
                                {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                              </button>
                            ) : (
                              <span className="w-5" />
                            )}
                            <span className="font-mono font-bold text-[14px]">
                              {qBlock.quarterLabel}
                            </span>
                            {qBlock.hasHybridFiling && (
                              <span className="px-1.5 py-0.2 rounded text-[10.5px] bg-amber-100 text-amber-900 border border-amber-300 font-medium">
                                Hỗn hợp T+Q
                              </span>
                            )}
                          </td>

                          {/* Số lao động */}
                          <td className="px-3 py-2 border-r border-slate-200 text-right font-mono text-slate-700">
                            {qBlock.maxEmployeeCount > 0n ? Number(qBlock.maxEmployeeCount) : '—'}
                          </td>

                          {/* Tổng TNCT [24] */}
                          <td className="px-3.5 py-2 border-r border-slate-200 text-right font-mono">
                            {formatMoney(qBlock.totalIncomeCt24)}
                          </td>

                          {/* Cư trú [31] */}
                          <td className="px-3.5 py-2 border-r border-slate-200 text-right font-mono">
                            {formatMoney(qBlock.totalResidentTax)}
                          </td>

                          {/* Không cư trú [32] */}
                          <td className="px-3.5 py-2 border-r border-slate-200 text-right font-mono">
                            {formatMoney(qBlock.totalNonResidentTax)}
                          </td>
                          {/* Tổng khấu trừ [30/34] */}
                          <td className="px-3.5 py-2 border-r border-slate-200 text-right font-mono font-bold text-teal-950 bg-teal-50/40">
                            {formatMoney(qBlock.totalWithheldTax)}
                          </td>

                          {/* Hồ sơ hiệu lực */}
                          <td className="px-4 py-2 text-xs whitespace-nowrap min-w-[260px]">
                            {qBlock.quarterFiling ? (
                              <div className="flex items-center justify-between group">
                                <div className="flex items-center space-x-2">
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11.5px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                    {qBlock.quarterFiling.versionLabel}
                                  </span>
                                  <span className="font-mono text-[12px] text-slate-600">
                                    {qBlock.quarterFiling.evidence?.formCode || '05/KK-TNCN'} · {qBlock.quarterFiling.evidence?.submittedAt?.split(' ')[0] || '—'}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (qBlock.quarterFiling?.evidence?.submissionId) {
                                      onOpenFilingPreview?.(qBlock.quarterFiling.evidence.submissionId, false);
                                    }
                                  }}
                                  className="p-1 hover:bg-teal-50 rounded text-slate-400 hover:text-teal-700 opacity-60 group-hover:opacity-100 transition-opacity cursor-pointer"
                                  title="Xem tờ khai"
                                >
                                  <ExternalLink className="w-4 h-4" />
                                </button>
                              </div>
                            ) : hasMonths ? (
                              <span className="text-slate-400 italic text-xs font-normal">
                                Kê khai theo từng tháng
                              </span>
                            ) : (
                              <span className="text-slate-400 italic text-xs font-normal">
                                Chưa tìm thấy hồ sơ
                              </span>
                            )}
                          </td>
                        </tr>

                        {/* Các dòng Tháng con bên trong Quý (nếu có) */}
                        {!isCollapsed &&
                          qBlock.monthFilings.map(mItem => (
                            <tr
                              key={mItem.periodKey}
                              className="h-[48px] hover:bg-slate-50/80 transition-colors"
                            >
                              <td className="pl-9 pr-4 py-2 border-r border-slate-200 font-sans text-slate-700">
                                <div className="flex items-center space-x-2">
                                  <span className="text-slate-400 font-mono text-xs">├─</span>
                                  <span className="font-medium text-[13.5px]">{mItem.periodLabel}</span>
                                </div>
                              </td>

                              {/* Số lao động */}
                              <td className="px-3 py-2 border-r border-slate-200 text-right font-mono text-slate-700">
                                {mItem.employeeCountCt21 > 0n ? Number(mItem.employeeCountCt21) : '—'}
                              </td>

                              {/* Tổng TNCT [24] */}
                              <td
                                onClick={() => {
                                  if (mItem.totalIncomeCt24 > 0n) {
                                    setActiveInspectorItem({
                                      title: `Tổng thu nhập chịu thuế [21] – ${mItem.periodLabel}`,
                                      indicatorCode: '[21]',
                                      amount: mItem.totalIncomeCt24,
                                      periodLabel: mItem.periodLabel,
                                      versionLabel: mItem.versionLabel,
                                      submissionId: mItem.evidence?.submissionId || '',
                                      submittedAt: mItem.evidence?.submittedAt,
                                      formCode: mItem.evidence?.formCode || '05/KK-TNCN'
                                    });
                                  }
                                }}
                                className="px-3.5 py-2 border-r border-slate-200 text-right font-mono hover:underline hover:text-teal-700 cursor-pointer"
                              >
                                {formatMoney(mItem.totalIncomeCt24)}
                              </td>

                              {/* Khấu trừ Cư trú [31] */}
                              <td
                                onClick={() => {
                                  if (mItem.residentTaxCt32 > 0n) {
                                    setActiveInspectorItem({
                                      title: `Khấu trừ cá nhân cư trú [30] – ${mItem.periodLabel}`,
                                      indicatorCode: '[30]',
                                      amount: mItem.residentTaxCt32,
                                      periodLabel: mItem.periodLabel,
                                      versionLabel: mItem.versionLabel,
                                      submissionId: mItem.evidence?.submissionId || '',
                                      submittedAt: mItem.evidence?.submittedAt,
                                      formCode: mItem.evidence?.formCode || '05/KK-TNCN'
                                    });
                                  }
                                }}
                                className={`px-3.5 py-2 border-r border-slate-200 text-right font-mono ${
                                  mItem.residentTaxCt32 > 0n ? 'hover:underline hover:text-teal-700 cursor-pointer' : 'text-slate-400'
                                }`}
                              >
                                {formatMoney(mItem.residentTaxCt32)}
                              </td>

                              {/* Khấu trừ Không cư trú [32] */}
                              <td
                                onClick={() => {
                                  if (mItem.nonResidentTaxCt33 > 0n) {
                                    setActiveInspectorItem({
                                      title: `Khấu trừ cá nhân không cư trú [31] – ${mItem.periodLabel}`,
                                      indicatorCode: '[31]',
                                      amount: mItem.nonResidentTaxCt33,
                                      periodLabel: mItem.periodLabel,
                                      versionLabel: mItem.versionLabel,
                                      submissionId: mItem.evidence?.submissionId || '',
                                      submittedAt: mItem.evidence?.submittedAt,
                                      formCode: mItem.evidence?.formCode || '05/KK-TNCN'
                                    });
                                  }
                                }}
                                className={`px-3.5 py-2 border-r border-slate-200 text-right font-mono ${
                                  mItem.nonResidentTaxCt33 > 0n ? 'hover:underline hover:text-teal-700 cursor-pointer' : 'text-slate-400'
                                }`}
                              >
                                {formatMoney(mItem.nonResidentTaxCt33)}
                              </td>

                              {/* Tổng thuế khấu trừ [30/34] */}
                              <td
                                onClick={() => {
                                  if (mItem.totalWithheldTaxCt34 > 0n) {
                                    setActiveInspectorItem({
                                      title: `Tổng số thuế TNCN đã khấu trừ [29] – ${mItem.periodLabel}`,
                                      indicatorCode: '[29]',
                                      amount: mItem.totalWithheldTaxCt34,
                                      periodLabel: mItem.periodLabel,
                                      versionLabel: mItem.versionLabel,
                                      submissionId: mItem.evidence?.submissionId || '',
                                      submittedAt: mItem.evidence?.submittedAt,
                                      formCode: mItem.evidence?.formCode || '05/KK-TNCN'
                                    });
                                  }
                                }}
                                className="px-3.5 py-2 border-r border-slate-200 text-right font-mono font-semibold text-teal-900 bg-teal-50/20 hover:underline cursor-pointer"
                              >
                                {formatMoney(mItem.totalWithheldTaxCt34)}
                              </td>

                              <td className="px-4 py-2 text-xs whitespace-nowrap min-w-[260px]">
                                <div className="flex items-center justify-between group">
                                  <div className="flex items-center space-x-2">
                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[11.5px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                      {mItem.versionLabel}
                                    </span>
                                    <span className="font-mono text-[12px] text-slate-600">
                                      {mItem.evidence?.formCode || '05/KK-TNCN'} · {mItem.evidence?.submittedAt?.split(' ')[0] || '—'}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (mItem.evidence?.submissionId) {
                                        onOpenFilingPreview?.(mItem.evidence.submissionId, false);
                                      }
                                    }}
                                    className="p-1 hover:bg-teal-50 rounded text-slate-400 hover:text-teal-700 opacity-60 group-hover:opacity-100 transition-opacity cursor-pointer"
                                    title="Xem tờ khai"
                                  >
                                    <ExternalLink className="w-4 h-4" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                      </React.Fragment>
                    );
                  })}
                </tbody>

                {/* ─── FOOTER CỘNG PHÁT SINH & QUYẾT TOÁN ────────────────── */}
                <tfoot className="sticky bottom-0 bg-[#F1F5F9] border-t-2 border-slate-300 font-mono font-bold text-slate-900 z-10 shadow-2xs text-[13.5px] tabular-nums">
                  
                  {/* 1. DÒNG CỘNG PHÁT SINH NĂM */}
                  <tr className="h-[48px]">
                    <td className="px-4 py-2 border-r border-slate-300 font-sans font-bold text-xs">
                      CỘNG CÁC KỲ TRONG NĂM
                    </td>
                    <td className="px-3 py-2 border-r border-slate-300 text-right font-mono">
                      {yearFlow.totalEmployeeCount > 0n ? Number(yearFlow.totalEmployeeCount) : '—'}
                    </td>
                    <td className="px-3.5 py-2 border-r border-slate-300 text-right">
                      {formatMoney(yearFlow.totalIncomeCt24)}
                    </td>
                    <td className="px-3.5 py-2 border-r border-slate-300 text-right">
                      {formatMoney(yearFlow.totalResidentTax32)}
                    </td>
                    <td className="px-3.5 py-2 border-r border-slate-300 text-right">
                      {formatMoney(yearFlow.totalNonResidentTax33)}
                    </td>
                    <td className="px-3.5 py-2 border-r border-slate-300 text-right text-teal-950 bg-teal-100/60 font-bold">
                      {formatMoney(yearFlow.totalWithheldTax34)}
                    </td>
                    <td className="px-4 py-2 font-sans font-normal text-slate-600 text-xs whitespace-nowrap">
                      {yearFlow.periodsCount} kỳ kê khai đã quét
                    </td>
                  </tr>

                  {/* 2. DÒNG TỜ KHAI QUYẾT TOÁN NĂM (05/QTT-TNCN) */}
                  {yearFlow.finalizationSnapshot && (
                    <>
                      <tr className="h-[48px] bg-emerald-50 text-emerald-950 border-t border-emerald-200">
                        <td className="px-4 py-2 border-r border-emerald-300 font-sans font-bold text-xs text-emerald-900">
                          QUYẾT TOÁN NĂM (05/QTT-TNCN)
                        </td>
                        <td className="px-3 py-2 border-r border-emerald-300 text-right font-mono">
                          {yearFlow.finalizationSnapshot.ct21_tongSoNguoiLaoDong > 0n ? Number(yearFlow.finalizationSnapshot.ct21_tongSoNguoiLaoDong) : '—'}
                        </td>
                        <td className="px-3.5 py-2 border-r border-emerald-300 text-right">
                          {formatMoney(yearFlow.finalizationSnapshot.ct24_tongThuNhapChiuThue)}
                        </td>
                        <td className="px-3.5 py-2 border-r border-emerald-300 text-right">
                          {formatMoney(yearFlow.finalizationSnapshot.ct32_khauTruCaNhanCuTru)}
                        </td>
                        <td className="px-3.5 py-2 border-r border-emerald-300 text-right">
                          {formatMoney(yearFlow.finalizationSnapshot.ct33_khauTruCaNhanKhongCuTru)}
                        </td>
                        <td className="px-3.5 py-2 border-r border-emerald-300 text-right font-bold text-emerald-900 bg-emerald-100/80">
                          {formatMoney(yearFlow.finalizationWithheldTax36 || 0n)}
                        </td>
                        <td className="px-4 py-2 font-sans text-xs whitespace-nowrap">
                          <span className="font-semibold">Chỉ tiêu [31/36]</span> · {yearFlow.finalizationSnapshot.submittedAt?.split(' ')[0] || '—'}
                        </td>
                      </tr>

                      {/* 3. DÒNG CHÊNH LỆCH ĐỐI CHIẾU */}
                      <tr className={`h-[48px] ${
                        yearFlow.auditStatus === 'MATCHED'
                          ? 'bg-teal-950 text-white'
                          : !hasAllQuarters
                          ? 'bg-slate-800 text-white'
                          : 'bg-red-900 text-white'
                      }`}>
                        <td className="px-4 py-2 border-r border-slate-700 font-sans font-bold text-xs">
                          CHÊNH LỆCH ĐỐI CHIẾU
                        </td>
                        <td colSpan={4} className="px-3.5 py-2 border-r border-slate-700 text-right font-sans font-normal text-xs opacity-85">
                          {!hasAllQuarters
                            ? `(Đang đối chiếu một phần: Đã quét ${yearFlow.periodsCount} kỳ – Quyết toán năm)`
                            : '(Tổng phát sinh các kỳ – Quyết toán năm)'}
                        </td>
                        <td className="px-3.5 py-2 border-r border-slate-700 text-right font-bold font-mono">
                          {formatMoney(yearFlow.mismatchDelta || 0n)} đ
                        </td>
                        <td className="px-4 py-2 font-sans font-bold text-xs whitespace-nowrap">
                          {yearFlow.auditStatus === 'MATCHED' ? (
                            <span className="text-emerald-300">✓ KHỚP 100% (PASS)</span>
                          ) : !hasAllQuarters ? (
                            <span className="text-sky-300">ℹ️ ĐỐI CHIẾU MỘT PHẦN</span>
                          ) : (
                            <span className="text-red-300">⚠️ LỆCH SỐ LIỆU</span>
                          )}
                        </td>
                      </tr>
                    </>
                  )}
                </tfoot>
              </table>
            )}
          </div>

          {/* CỘT PHẢI: EVIDENCE INSPECTOR (CHI TIẾT CHỨNG CỨ) */}
          {activeInspectorItem && (
            <div className="w-80 lg:w-96 bg-white border-l border-slate-200 flex flex-col shrink-0 animate-slideLeft">
              <div className="p-4 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-bold text-teal-800 uppercase tracking-wider block">
                    EVIDENCE INSPECTOR
                  </span>
                  <h3 className="text-sm font-bold text-slate-900 mt-0.5">
                    CHI TIẾT CHỨNG CỨ TNCN
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveInspectorItem(null)}
                  className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 space-y-4 flex-1 overflow-y-auto">
                <div className="border border-slate-200 rounded-xl p-4 space-y-3 bg-white">
                  <div>
                    <div className="text-xs font-medium text-slate-500">
                      {activeInspectorItem.title}
                    </div>
                    <div className="text-xl font-bold font-mono text-slate-900 mt-1">
                      {formatMoney(activeInspectorItem.amount)} đ
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
                      className="flex-1 h-8.5 bg-teal-50 hover:bg-teal-100 text-teal-800 border border-teal-200 rounded-lg text-xs font-semibold cursor-pointer transition-colors"
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
                      className="flex-1 h-8.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                    >
                      Xem XML
                    </button>
                  </div>
                </div>
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

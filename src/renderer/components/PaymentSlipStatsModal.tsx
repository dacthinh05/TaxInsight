import React, { useMemo } from 'react';
import { BarChart3, FileSpreadsheet, Loader2, X } from 'lucide-react';
import {
  GntStatBucket,
  GNT_BUCKET_LABELS,
  GntStatisticsEngine,
  GntStatisticsResult
} from '../../main/engine/GntStatisticsEngine';

interface PaymentSlipStatsModalProps {
  isOpen: boolean;
  loading: boolean;
  stats: GntStatisticsResult | null;
  error: string | null;
  year: number;
  onClose: () => void;
  onExportExcel: () => void;
}

const fmt = (n: number) => n.toLocaleString('vi-VN');

export const PaymentSlipStatsModal: React.FC<PaymentSlipStatsModalProps> = ({
  isOpen, loading, stats, error, year, onClose, onExportExcel
}) => {
  if (!isOpen) return null;

  const buckets = useMemo(
    () => (stats ? (stats.activeBuckets.length ? stats.activeBuckets : []) : []),
    [stats]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-2xs">
      <div className="bg-white w-full max-w-4xl max-h-[88vh] rounded-xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden mx-4">
        {/* Header */}
        <div className="h-14 px-5 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2.5">
            <span className="w-8 h-8 rounded-lg bg-teal-100 text-teal-800 flex items-center justify-center">
              <BarChart3 className="w-4.5 h-4.5" />
            </span>
            <div>
              <h2 className="font-semibold text-slate-800 text-sm">Thống kê Giấy Nộp Tiền đã nộp</h2>
              <p className="text-[11px] text-slate-500">Theo tháng nộp × loại thuế · Năm {year} · Đơn vị VND</p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            {!loading && stats && stats.cells.length > 0 && (
              <button
                type="button"
                onClick={onExportExcel}
                className="h-8 px-3 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-medium flex items-center space-x-1.5 transition-colors cursor-pointer shadow-xs"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                <span>Xuất Excel</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-5">
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center space-y-3 text-slate-500">
              <Loader2 className="w-7 h-7 animate-spin text-teal-600" />
              <span className="text-xs">Đang phân tích chi tiết từng Giấy Nộp Tiền từ eTax…</span>
              <span className="text-[11px] text-slate-400">(lần đầu có thể mất vài giây — kết quả được cache)</span>
            </div>
          ) : error ? (
            <div className="p-6 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs text-center">{error}</div>
          ) : !stats || stats.cells.length === 0 ? (
            <div className="py-12 text-center text-slate-400 text-xs">Không có dữ liệu thống kê phù hợp.</div>
          ) : (
            <>
              {/* Summary chips */}
              <div className="flex flex-wrap gap-2 mb-4 text-[11px]">
                <span className="px-2.5 py-1 rounded-lg bg-teal-50 border border-teal-200 text-teal-800 font-medium">
                  Đã thống kê: <strong>{stats.paidCount}</strong> GNT đã nộp
                </span>
                {stats.skippedUnpaidCount > 0 && (
                  <span className="px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
                    Bỏ qua {stats.skippedUnpaidCount} chưa nộp/thất bại
                  </span>
                )}
                {stats.noDetailCount > 0 && (
                  <span className="px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-600">
                    {stats.noDetailCount} giấy chưa đọc được chi tiết → cột "Chưa phân loại"
                  </span>
                )}
              </div>

              {/* Matrix table */}
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="bg-[#F8FAFC] text-slate-600 font-semibold text-[11px]">
                      <th className="px-3 py-2.5 text-left border-b border-r border-slate-200 sticky left-0 bg-[#F8FAFC]">Tháng nộp</th>
                      {buckets.map(b => (
                        <th key={b} className="px-3 py-2.5 text-right border-b border-r border-slate-200 last:border-r-0 whitespace-nowrap">
                          {GNT_BUCKET_LABELS[b as GntStatBucket]}
                        </th>
                      ))}
                      <th className="px-3 py-2.5 text-right border-b border-slate-200 text-teal-800">Tổng tháng</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stats.monthKeys.map(mk => (
                      <tr key={mk} className="hover:bg-slate-50/70">
                        <td className="px-3 py-2 font-medium text-slate-700 border-r border-slate-100 sticky left-0 bg-white whitespace-nowrap">
                          Tháng {mk}
                        </td>
                        {buckets.map(b => {
                          const v = GntStatisticsEngine.amountOf(stats, mk, b);
                          return (
                            <td key={b} className={`px-3 py-2 text-right font-mono border-r border-slate-100 ${v ? 'text-slate-800' : 'text-slate-300'}`}>
                              {v ? fmt(v) : '—'}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2 text-right font-mono font-bold text-slate-900 bg-slate-50/60">
                          {fmt(GntStatisticsEngine.rowTotal(stats, mk))}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-slate-100/80 font-bold text-slate-900">
                      <td className="px-3 py-2.5 border-r border-slate-200 sticky left-0 bg-slate-100/80 uppercase text-[11px]">Tổng cộng</td>
                      {buckets.map(b => (
                        <td key={b} className="px-3 py-2.5 text-right font-mono border-r border-slate-200">
                          {fmt(GntStatisticsEngine.columnTotal(stats, b))}
                        </td>
                      ))}
                      <td className="px-3 py-2.5 text-right font-mono text-sm text-teal-900 bg-amber-50">
                        {fmt(stats.grandTotal)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="mt-3 text-[10.5px] text-slate-400 leading-relaxed">
                * Phân loại theo Tiểu mục NDKT trên chi tiết C1-02/NS (1001→TNCN, 1701→GTGT, 1052→TNDN, 1055→Nhà thầu, 3801/3802/3805/3806/3901→Nhà đất).
                Tháng tính theo <strong>ngày nộp thuế</strong> thực tế (fallback ngày lập GNT).
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

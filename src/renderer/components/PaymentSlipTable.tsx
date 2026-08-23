import React, { useMemo, useState } from 'react';
import { AlertCircle, CheckSquare, CreditCard, ExternalLink, RefreshCw, Square } from 'lucide-react';
import { PaymentSlipRecord } from '../../shared/types';
import { SlipReconInfo } from '../../shared/paymentSlipAudit';
import { PaymentSlipPreviewDrawer } from './PaymentSlipPreviewDrawer';
import { PaymentSlipRow } from './PaymentSlipRow';

interface PaymentSlipTableProps {
  /** Danh sách ĐÃ qua bộ lọc tìm kiếm (App chịu trách nhiệm filter) */
  paymentSlips: PaymentSlipRecord[];
  /** Tổng số GNT trước lọc — để phân biệt "không có dữ liệu" vs "search không khớp" */
  totalCount: number;
  reconIndex: Map<string, SlipReconInfo>;
  errorState?: { message: string; errorCode?: string } | null;
  onRetry?: () => void;
  isScanning?: boolean;
}

export const PaymentSlipTable: React.FC<PaymentSlipTableProps> = ({
  paymentSlips,
  totalCount,
  reconIndex,
  errorState,
  onRetry,
  isScanning = false
}) => {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [activeSlipForDetail, setActiveSlipForDetail] = useState<PaymentSlipRecord | null>(null);

  const allSelected = paymentSlips.length > 0 && paymentSlips.every(s => selectedIds.has(s.id));

  const handleToggleSelectAll = () => {
    const next = new Set(selectedIds);
    if (allSelected) {
      paymentSlips.forEach(s => next.delete(s.id));
    } else {
      paymentSlips.forEach(s => next.add(s.id));
    }
    setSelectedIds(next);
  };

  const handleToggleSelectOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const activeRecon = useMemo(
    () => (activeSlipForDetail ? reconIndex.get(activeSlipForDetail.id) : undefined),
    [activeSlipForDetail, reconIndex]
  );

  return (
    <div className="flex-1 flex flex-col bg-white border border-slate-200/90 rounded-xl shadow-xs overflow-hidden min-h-0">
      {/* Table Area */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-left border-collapse text-xs">
          <thead className="bg-[#F8FAFC] sticky top-0 z-10 border-b border-slate-200 text-slate-500 font-semibold text-[11px] select-none">
            <tr>
              <th className="w-9 px-2.5 py-2 text-center">
                <button
                  type="button"
                  onClick={handleToggleSelectAll}
                  className="text-slate-400 hover:text-teal-700 transition-colors flex items-center justify-center cursor-pointer"
                >
                  {allSelected ? (
                    <CheckSquare className="w-4 h-4 text-teal-700" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-300" />
                  )}
                </button>
              </th>
              <th className="w-[72px] px-2.5 py-2">Ngày nộp</th>
              <th className="px-2.5 py-2 min-w-[220px]">Số GNT / Mã GD</th>
              <th className="w-[84px] px-2.5 py-2">Loại thuế</th>
              <th className="w-[88px] px-2.5 py-2">Kỳ thuế</th>
              <th className="w-[118px] px-2.5 py-2 text-right">Số tiền</th>
              <th className="w-[100px] px-2.5 py-2">Đối chiếu</th>
              <th className="w-[110px] px-2.5 py-2">Trạng thái</th>
              <th className="w-11 px-1.5 py-2 text-center sticky right-0 bg-[#F8FAFC]">Xem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {errorState && totalCount === 0 ? (
              // ─── IN-TABLE ERROR STATE ────────────────────────────────
              <tr>
                <td colSpan={9} className="p-8 text-center">
                  <div className="max-w-lg mx-auto flex flex-col items-center justify-center space-y-3.5 bg-slate-50 border border-slate-200/90 rounded-2xl p-6 shadow-xs text-left">
                    <div className="flex items-center space-x-3 w-full border-b border-slate-200 pb-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 border border-amber-300">
                        <AlertCircle className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-800 text-sm">TaxInsight chưa nhận diện được phiên tra cứu Giấy Nộp Tiền trên eTax</h4>
                        <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                          {errorState?.message || 'Dừng tại bước chuyển phiên DVC → eTax (Module 330410 - Tra cứu GNT)'}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2 text-xs text-slate-600 w-full leading-relaxed">
                      <p className="text-[11.5px] text-slate-600">
                        Hệ thống Cổng Dịch vụ công cần chuyển tiếp phiên làm việc sang phân hệ Thuế Điện Tử (<span className="font-mono text-slate-700 font-semibold">thuedientu.gdt.gov.vn</span>) để đọc dữ liệu Giấy Nộp Tiền (C1-02/NS).
                      </p>
                      <div className="p-3 bg-amber-50/90 rounded-xl border border-amber-200 text-[11.5px] text-amber-950 space-y-1">
                        <div className="font-bold">💡 Giải pháp nhanh:</div>
                        <div>
                          Nhấn <strong>&quot;Mở eTax để xác thực&quot;</strong> bên dưới. Cửa sổ kết nối sẽ mở ra và tự động lấy phiên làm việc mà không cần nhập lại mật khẩu.
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2.5 pt-2 w-full justify-end">
                      <button
                        type="button"
                        onClick={async () => {
                          if (window.taxPortalAPI?.openPaymentSlipsAuthWindow) {
                            const res = await window.taxPortalAPI.openPaymentSlipsAuthWindow();
                            if (res && res.success && onRetry) {
                              onRetry();
                            }
                          }
                        }}
                        className="h-8 px-4 bg-teal-700 hover:bg-teal-800 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer shadow-xs"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>Mở eTax để xác thực</span>
                      </button>

                      {onRetry && (
                        <button
                          type="button"
                          onClick={onRetry}
                          disabled={isScanning}
                          className="h-8 px-3.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-colors cursor-pointer shadow-2xs disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />
                          <span>{isScanning ? 'Đang kết nối…' : 'Thử lại kết nối'}</span>
                        </button>
                      )}
                    </div>
                  </div>
                </td>
              </tr>
            ) : paymentSlips.length === 0 ? (
              // ─── IN-TABLE EMPTY STATE ────────────────────────────────
              <tr>
                <td colSpan={9} className="p-12 text-center text-slate-400 text-xs">
                  {totalCount === 0 ? (
                    <div className="flex flex-col items-center justify-center space-y-2">
                      <CreditCard className="w-8 h-8 text-slate-300" />
                      <p className="font-medium text-slate-600">Chưa có Giấy Nộp Tiền nào được quét</p>
                      <p className="text-[11px] text-slate-400">
                        Bấm nút &quot;Tra cứu&quot; ở thanh trên để tải danh sách chứng từ nộp thuế từ eTax
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center space-y-1">
                      <p className="font-medium text-slate-500">Không có Giấy Nộp Tiền nào khớp từ khóa tìm kiếm</p>
                      <p className="text-[11px] text-slate-400">{totalCount} GNT đang bị ẩn bởi bộ lọc</p>
                    </div>
                  )}
                </td>
              </tr>
            ) : (
              paymentSlips.map(slip => (
                <PaymentSlipRow
                  key={slip.id}
                  slip={slip}
                  reconInfo={reconIndex.get(slip.id)}
                  isSelected={selectedIds.has(slip.id)}
                  onToggleSelect={handleToggleSelectOne}
                  onViewDetail={setActiveSlipForDetail}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Detail Slide-Over Panel */}
      <PaymentSlipPreviewDrawer
        slip={activeSlipForDetail}
        reconInfo={activeRecon}
        isOpen={Boolean(activeSlipForDetail)}
        onClose={() => setActiveSlipForDetail(null)}
      />
    </div>
  );
};

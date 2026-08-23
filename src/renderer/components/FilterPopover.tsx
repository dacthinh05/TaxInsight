import React, { useEffect, useRef } from 'react';
import { Filter, RotateCcw, X } from 'lucide-react';

export interface FilterState {
  period: string;
  filingType: 'ALL' | 'ORIGINAL' | 'SUPPLEMENTAL' | 'FINALIZATION' | 'REFUND';
  portalStatus: string;
  downloadStatus: 'ALL' | 'DOWNLOADED' | 'NOT_DOWNLOADED' | 'FAILED';
}

interface FilterPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
  availablePeriods: string[];
  availableStatuses: string[];
  onReset: () => void;
}

export const FilterPopover: React.FC<FilterPopoverProps> = ({
  isOpen,
  onClose,
  filters,
  onFilterChange,
  availablePeriods,
  availableStatuses,
  onReset
}) => {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={popoverRef}
      className="absolute right-0 top-10 z-30 w-72 bg-white border border-slate-200 rounded-xl shadow-xl p-4 text-xs space-y-3 animate-fadeIn"
    >
      <div className="flex items-center justify-between pb-2 border-b border-slate-100">
        <div className="flex items-center space-x-1.5 font-semibold text-slate-800">
          <Filter className="w-3.5 h-3.5 text-teal-700" />
          <span>Bộ lọc chi tiết</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-slate-400 hover:text-slate-600 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* 1. Kỳ kê khai */}
      <div>
        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
          Kỳ kê khai:
        </label>
        <select
          value={filters.period}
          onChange={e => onFilterChange({ ...filters, period: e.target.value })}
          className="w-full h-8 px-2.5 bg-slate-50 border border-slate-300 rounded-md text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-teal-600 focus:bg-white"
        >
          <option value="ALL">Tất cả kỳ kê khai ({availablePeriods.length} kỳ)</option>
          {availablePeriods.map(p => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>

      {/* 2. Loại hồ sơ / nghiệp vụ */}
      <div>
        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
          Loại hồ sơ / nghiệp vụ:
        </label>
        <select
          value={filters.filingType}
          onChange={e => onFilterChange({ ...filters, filingType: e.target.value as any })}
          className="w-full h-8 px-2.5 bg-slate-50 border border-slate-300 rounded-md text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-teal-600 focus:bg-white"
        >
          <option value="ALL">Tất cả loại hồ sơ</option>
          <option value="ORIGINAL">Kê khai chính thức (Lần đầu)</option>
          <option value="SUPPLEMENTAL">Khai bổ sung</option>
          <option value="FINALIZATION">Quyết toán thuế (TNDN / TNCN)</option>
          <option value="REFUND">Hoàn thuế</option>
        </select>
      </div>

      {/* 3. Trạng thái Cổng */}
      {availableStatuses.length > 0 && (
        <div>
          <label className="block text-[11px] font-semibold text-slate-600 mb-1">
            Trạng thái xử lý Cổng:
          </label>
          <select
            value={filters.portalStatus}
            onChange={e => onFilterChange({ ...filters, portalStatus: e.target.value })}
            className="w-full h-8 px-2.5 bg-slate-50 border border-slate-300 rounded-md text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-teal-600 focus:bg-white"
          >
            <option value="ALL">Tất cả trạng thái</option>
            {availableStatuses.map(s => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* 4. Tình trạng tải */}
      <div>
        <label className="block text-[11px] font-semibold text-slate-600 mb-1">
          Tình trạng tải về:
        </label>
        <select
          value={filters.downloadStatus}
          onChange={e => onFilterChange({ ...filters, downloadStatus: e.target.value as any })}
          className="w-full h-8 px-2.5 bg-slate-50 border border-slate-300 rounded-md text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-teal-600 focus:bg-white"
        >
          <option value="ALL">Tất cả tình trạng</option>
          <option value="DOWNLOADED">Đã tải xong / Có sẵn</option>
          <option value="NOT_DOWNLOADED">Chưa tải</option>
          <option value="FAILED">Tải thất bại (Lỗi)</option>
        </select>
      </div>

      {/* Footer buttons */}
      <div className="flex items-center justify-between pt-2 border-t border-slate-100">
        <button
          type="button"
          onClick={onReset}
          className="px-2.5 py-1.5 text-slate-500 hover:text-slate-800 font-medium text-[11px] flex items-center space-x-1 transition-colors"
        >
          <RotateCcw className="w-3 h-3" />
          <span>Xóa bộ lọc</span>
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 bg-teal-700 hover:bg-teal-800 text-white font-semibold rounded-md text-[11px] transition-colors"
        >
          Áp dụng
        </button>
      </div>
    </div>
  );
};

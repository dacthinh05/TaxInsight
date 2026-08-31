import React from 'react';
import { CheckSquare, Download, X } from 'lucide-react';

interface SelectionActionBarProps {
  selectedCount: number;
  totalCount: number;
  onDeselectAll: () => void;
  onDownloadSelected: () => void;
  isDownloading?: boolean;
}

export const SelectionActionBar: React.FC<SelectionActionBarProps> = ({
  selectedCount,
  totalCount,
  onDeselectAll,
  onDownloadSelected,
  isDownloading = false
}) => {
  if (selectedCount === 0) return null;

  return (
    <div className="bg-slate-900/95 backdrop-blur-sm border border-slate-800 text-white rounded-xl px-4 py-2.5 shadow-modal flex items-center justify-between gap-4 animate-slideUp select-none transition-all">
      {/* Left Selection Info */}
      <div className="flex items-center space-x-3 text-xs">
        <div className="flex items-center space-x-1.5 font-medium">
          <CheckSquare className="w-4 h-4 text-teal-400" />
          <span>
            Đã chọn <strong className="text-teal-300 font-bold font-mono text-[13px]">{selectedCount}</strong> / {totalCount} hồ sơ
          </span>
        </div>
        <button
          type="button"
          onClick={onDeselectAll}
          className="text-slate-400 hover:text-slate-200 text-[11px] flex items-center gap-1 transition-colors cursor-pointer px-1.5 py-0.5 rounded hover:bg-slate-800"
          title="Bỏ chọn tất cả (phím Esc)"
        >
          <X className="w-3 h-3 text-slate-400" />
          <span>Bỏ chọn</span>
          <kbd className="px-1 py-0.2 bg-slate-800 text-slate-400 rounded text-[9px] font-mono border border-slate-700">Esc</kbd>
        </button>
      </div>

      {/* Right Primary Contextual Action */}
      <div className="flex items-center space-x-2">
        <button
          type="button"
          onClick={onDownloadSelected}
          disabled={isDownloading}
          className="h-8.5 px-4 bg-teal-600 hover:bg-teal-500 active:bg-teal-700 text-white font-bold rounded-lg text-xs flex items-center space-x-2 transition-all shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Tải {selectedCount} hồ sơ đã chọn</span>
        </button>
      </div>
    </div>
  );
};

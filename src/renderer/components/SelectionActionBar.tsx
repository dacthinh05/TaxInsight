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
    <div className="bg-slate-900 border border-slate-800 text-white rounded-xl px-4 py-2.5 shadow-2xl flex items-center justify-between gap-4 animate-slideUp select-none">
      {/* Left Selection Info */}
      <div className="flex items-center space-x-3 text-xs">
        <div className="flex items-center space-x-1.5 font-medium">
          <CheckSquare className="w-4 h-4 text-teal-400" />
          <span>
            Đã chọn <strong className="text-teal-300 font-bold font-mono">{selectedCount}</strong> / {totalCount} hồ sơ
          </span>
        </div>
        <button
          type="button"
          onClick={onDeselectAll}
          className="text-slate-400 hover:text-white text-[11px] underline underline-offset-2 transition-colors cursor-pointer"
        >
          Bỏ chọn
        </button>
      </div>

      {/* Right Primary Contextual Action */}
      <div className="flex items-center space-x-2">
        <button
          type="button"
          onClick={onDownloadSelected}
          disabled={isDownloading}
          className="h-8.5 px-4 bg-teal-600 hover:bg-teal-500 active:bg-teal-700 text-white font-bold rounded-lg text-xs flex items-center space-x-2 transition-all shadow-sm cursor-pointer disabled:opacity-50"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Tải {selectedCount} hồ sơ đã chọn</span>
        </button>
      </div>
    </div>
  );
};

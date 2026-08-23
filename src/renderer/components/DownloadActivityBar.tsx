import React from 'react';
import { AlertTriangle, Download, ExternalLink, Pause, Play, RotateCcw, XCircle } from 'lucide-react';
import { DownloadSummary } from '../../shared/types';

interface DownloadActivityBarProps {
  summary: DownloadSummary;
  onOpenDetails: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
}

export const DownloadActivityBar: React.FC<DownloadActivityBarProps> = ({
  summary,
  onOpenDetails,
  onPause,
  onResume,
  onCancel
}) => {
  if (summary.total === 0) return null;

  const processed = summary.completed + summary.existing + summary.failed;
  const percent = summary.total > 0 ? Math.round((processed / summary.total) * 100) : 0;
  const isAuthRequired = summary.state === 'AUTH_REQUIRED' || summary.state === 'PAUSED_AUTH_REQUIRED';
  const isFinished = !summary.isRunning && summary.remaining === 0 && summary.total > 0;

  return (
    <div
      className={`border rounded-xl px-4 py-2.5 shadow-lg flex flex-wrap items-center justify-between gap-3 text-xs select-none transition-all ${
        isAuthRequired
          ? 'bg-red-950/90 border-red-800 text-white'
          : isFinished
          ? 'bg-slate-900 border-slate-800 text-white'
          : 'bg-slate-900 border-slate-800 text-white'
      }`}
    >
      {/* Left Info & Mini Progress Bar */}
      <div className="flex items-center space-x-4 flex-1 min-w-[280px]">
        <div className="flex items-center space-x-2">
          {isAuthRequired ? (
            <AlertTriangle className="w-4 h-4 text-amber-400 animate-pulse" />
          ) : summary.isRunning ? (
            <Download className="w-4 h-4 text-teal-400 animate-bounce" />
          ) : (
            <Download className="w-4 h-4 text-slate-400" />
          )}

          <span className="font-semibold">
            {isAuthRequired
              ? 'Tạm dừng: Phiên Cổng Thuế hết hạn'
              : isFinished
              ? `Hoàn tất tải ${summary.completed + summary.existing}/${summary.total} hồ sơ`
              : `Đang tải ${processed}/${summary.total} hồ sơ (${percent}%)`}
          </span>
        </div>

        {/* Mini progress bar */}
        <div className="flex-1 max-w-xs h-2 bg-slate-800 rounded-full overflow-hidden border border-slate-700/60 hidden sm:block">
          <div
            className={`h-full transition-all duration-300 rounded-full ${
              isAuthRequired
                ? 'bg-amber-500'
                : 'bg-teal-500'
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>

        <span className="font-mono text-slate-300 text-[11px] font-bold">
          {percent}%
        </span>
      </div>

      {/* Right Action Controls */}
      <div className="flex items-center space-x-2">
        {isAuthRequired ? (
          <button
            type="button"
            onClick={onResume}
            className="h-7 px-2.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded-md text-[11px] flex items-center space-x-1 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Đăng nhập lại</span>
          </button>
        ) : !isFinished ? (
          <>
            {summary.isPaused ? (
              <button
                type="button"
                onClick={onResume}
                className="h-7 px-2.5 bg-teal-600 hover:bg-teal-500 text-white font-medium rounded-md text-[11px] flex items-center space-x-1 transition-colors"
              >
                <Play className="w-3 h-3" />
                <span>Tiếp tục</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onPause}
                className="h-7 px-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium rounded-md text-[11px] flex items-center space-x-1 transition-colors"
              >
                <Pause className="w-3 h-3" />
                <span>Tạm dừng</span>
              </button>
            )}
            <button
              type="button"
              onClick={onCancel}
              className="h-7 px-2 text-slate-400 hover:text-red-300 transition-colors"
              title="Hủy đợt tải"
            >
              <XCircle className="w-3.5 h-3.5" />
            </button>
          </>
        ) : null}

        <button
          type="button"
          onClick={onOpenDetails}
          className="h-7 px-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-medium rounded-md text-[11px] flex items-center space-x-1 transition-colors"
        >
          <ExternalLink className="w-3 h-3 text-teal-400" />
          <span>Chi tiết</span>
        </button>
      </div>
    </div>
  );
};

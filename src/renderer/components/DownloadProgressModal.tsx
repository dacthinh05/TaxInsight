import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FolderOpen,
  Pause,
  Play,
  RotateCcw,
  X,
  XCircle
} from 'lucide-react';
import { DownloadSummary } from '../../shared/types';

interface DownloadProgressModalProps {
  summary: DownloadSummary;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onOpenFolder: () => void;
  onClose: () => void;
}

export const DownloadProgressModal: React.FC<DownloadProgressModalProps> = ({
  summary,
  onPause,
  onResume,
  onCancel,
  onOpenFolder,
  onClose
}) => {
  const processedCount = summary.completed + summary.existing + summary.failed;
  const percent = summary.total > 0 ? Math.round((processedCount / summary.total) * 100) : 0;
  const isFinished = !summary.isRunning && summary.remaining === 0 && summary.total > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-emerald-800 p-4 text-white flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Download className="w-5 h-5 text-emerald-300 animate-bounce" />
            <h3 className="font-bold text-base">
              {isFinished ? 'Hoàn Tất Đợt Tải Hồ Sơ' : 'Đang Tải Hồ Sơ Thuế Hàng Loạt'}
            </h3>
          </div>
          {isFinished && (
            <button
              onClick={onClose}
              className="text-emerald-200 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {/* Progress Bar & Percentage */}
          <div>
            <div className="flex justify-between items-center text-xs font-semibold text-slate-700 mb-1.5">
              <span>Tiến độ tổng thể</span>
              <span className="font-mono text-sm text-emerald-700">{percent}%</span>
            </div>
            <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
              <div
                className="h-full bg-gradient-to-r from-emerald-500 to-teal-600 transition-all duration-300 rounded-full"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-5 gap-2 text-center text-xs">
            <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg">
              <span className="text-slate-500 block text-[11px]">Tổng số</span>
              <span className="font-bold text-slate-900 text-sm font-mono">{summary.total}</span>
            </div>
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
              <span className="text-emerald-700 block text-[11px]">Đã tải</span>
              <span className="font-bold text-emerald-800 text-sm font-mono">{summary.completed}</span>
            </div>
            <div className="p-2.5 bg-teal-50 border border-teal-200 rounded-lg">
              <span className="text-teal-700 block text-[11px]">Có sẵn</span>
              <span className="font-bold text-teal-800 text-sm font-mono">{summary.existing}</span>
            </div>
            <div className="p-2.5 bg-red-50 border border-red-200 rounded-lg">
              <span className="text-red-700 block text-[11px]">Lỗi</span>
              <span className="font-bold text-red-800 text-sm font-mono">{summary.failed}</span>
            </div>
            <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
              <span className="text-amber-700 block text-[11px]">Còn lại</span>
              <span className="font-bold text-amber-800 text-sm font-mono">{summary.remaining}</span>
            </div>
          </div>

          {/* Status Message */}
          <div className={`p-3 border rounded-lg text-xs flex items-center justify-between ${
            summary.state === 'AUTH_REQUIRED' || summary.state === 'PAUSED_AUTH_REQUIRED'
              ? 'bg-red-50 border-red-200 text-red-700'
              : summary.isPaused
              ? 'bg-amber-50 border-amber-200 text-amber-700'
              : 'bg-slate-50 border-slate-200 text-slate-600'
          }`}>
            <div className="flex items-center space-x-2">
              {summary.state === 'AUTH_REQUIRED' || summary.state === 'PAUSED_AUTH_REQUIRED' ? (
                <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-ping" />
              ) : summary.isRunning ? (
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              ) : summary.isPaused ? (
                <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              ) : (
                <div className="w-2.5 h-2.5 rounded-full bg-slate-400" />
              )}
              <span className="font-semibold">
                {summary.state === 'AUTH_REQUIRED' || summary.state === 'PAUSED_AUTH_REQUIRED'
                  ? 'ĐÃ TẠM DỪNG — CẦN ĐĂNG NHẬP LẠI ĐỂ TIẾP TỤC'
                  : summary.isRunning
                  ? `Đang tải đồng thời ${summary.downloading} hồ sơ... (Còn lại: ${summary.remaining})`
                  : summary.isPaused
                  ? 'Tiến trình tải đang tạm dừng'
                  : isFinished
                  ? 'Tất cả hồ sơ trong đợt đã được xử lý xong!'
                  : 'Đã dừng'}
              </span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-200">
            <button
              onClick={onOpenFolder}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg text-xs flex items-center space-x-1.5 transition-colors"
            >
              <FolderOpen className="w-4 h-4 text-emerald-700" />
              <span>Mở thư mục lưu trữ</span>
            </button>

            <div className="flex items-center space-x-2">
              {!isFinished ? (
                <>
                  {summary.state === 'AUTH_REQUIRED' || summary.state === 'PAUSED_AUTH_REQUIRED' ? (
                    <button
                      onClick={onResume}
                      className="px-3.5 py-2 bg-red-700 hover:bg-red-800 text-white font-bold rounded-lg text-xs flex items-center space-x-1.5 transition-colors animate-pulse"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Đăng nhập lại</span>
                    </button>
                  ) : summary.isPaused ? (
                    <button
                      onClick={onResume}
                      className="px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold rounded-lg text-xs flex items-center space-x-1.5 transition-colors"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Tiếp tục</span>
                    </button>
                  ) : (
                    <button
                      onClick={onPause}
                      className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg text-xs flex items-center space-x-1.5 transition-colors"
                    >
                      <Pause className="w-3.5 h-3.5" />
                      <span>Tạm dừng</span>
                    </button>
                  )}
                  <button
                    onClick={onCancel}
                    className="px-3 py-2 border border-red-300 hover:bg-red-50 text-red-700 font-semibold rounded-lg text-xs flex items-center space-x-1.5 transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>DỪNG</span>
                  </button>
                </>
              ) : (
                <button
                  onClick={onClose}
                  className="px-5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold rounded-lg text-xs transition-colors shadow"
                >
                  Đóng
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

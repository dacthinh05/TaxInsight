import React, { useEffect } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CheckSquare,
  Download,
  ExternalLink,
  FolderOpen,
  Pause,
  Play,
  RotateCcw,
  X,
  XCircle
} from 'lucide-react';
import { DownloadSummary } from '../../shared/types';

interface BottomStatusBarProps {
  selectedCount: number;
  totalCount: number;
  onDeselectAll: () => void;
  onDownloadSelected: () => void;
  downloadSummary: DownloadSummary | null;
  onOpenDetails: () => void;
  onPauseDownload: () => void;
  onResumeDownload: () => void;
  onCancelDownload: () => void;
  onRetryFailed: () => void;
  onOpenFolder: () => void;
  onDismissDownload: () => void;
}

export const BottomStatusBar: React.FC<BottomStatusBarProps> = ({
  selectedCount,
  totalCount,
  onDeselectAll,
  onDownloadSelected,
  downloadSummary,
  onOpenDetails,
  onPauseDownload,
  onResumeDownload,
  onCancelDownload,
  onRetryFailed,
  onOpenFolder,
  onDismissDownload
}) => {
  // Xác định trạng thái thực tế: ưu tiên remaining===0 để tránh race condition giữa onDownloadProgress và onDownloadCompleted
  const allAccountedFor = downloadSummary
    ? (downloadSummary.completed + downloadSummary.existing + downloadSummary.failed) >= downloadSummary.total
    : false;
  // Sau khi bấm DỪNG: state=CANCELLED nhưng remaining vẫn > 0 — trước đây bar
  // cứ hiển thị "Đang tải... Đang xử lý gói dữ liệu" mãi mãi (stale UI)
  const isCancelledState = downloadSummary?.state === 'CANCELLED';
  const isDownloading = downloadSummary && downloadSummary.total > 0 &&
    !isCancelledState &&
    (downloadSummary.isRunning || downloadSummary.remaining > 0) && !allAccountedFor;
  const isFinished = downloadSummary && downloadSummary.total > 0 &&
    ((!downloadSummary.isRunning || allAccountedFor) && downloadSummary.remaining === 0 || isCancelledState);
  const isAuthRequired = downloadSummary && (downloadSummary.state === 'AUTH_REQUIRED' || downloadSummary.state === 'PAUSED_AUTH_REQUIRED');

  // Tự động đóng thông báo hoàn tất sau 7 giây nếu không có lỗi
  useEffect(() => {
    if (isFinished && downloadSummary?.failed === 0) {
      const timer = setTimeout(() => {
        onDismissDownload();
      }, 7000);
      return () => clearTimeout(timer);
    }
  }, [isFinished, downloadSummary?.failed, onDismissDownload]);

  // Nếu không có selection và không có download -> Ẩn thanh đáy
  if (selectedCount === 0 && !isDownloading && !isFinished && !isAuthRequired) {
    return null;
  }

  // ─── CASE A: DOWNLOAD IN-PROGRESS HOẶC FINISHED ─────────────────────
  if (downloadSummary && downloadSummary.total > 0 && (isDownloading || isFinished || isAuthRequired)) {
    const successCount = downloadSummary.completed + downloadSummary.existing;
    const total = downloadSummary.total;
    const failed = downloadSummary.failed;
    // Tính % chính xác từ các file thành công thực tế, không bao giờ gán 100% giả khi toàn bộ thất bại
    const percent = total > 0 ? Math.round((successCount / total) * 100) : 0;

    return (
      <div className="bg-white border border-slate-200/90 rounded-xl px-4 py-2.5 shadow-md flex items-center justify-between gap-4 text-xs select-none animate-slideUp overflow-x-auto min-w-[500px]">
        {/* Left: Progress info & derived bar */}
        <div className="flex items-center space-x-3 flex-1 min-w-[240px] shrink-0">
          {isAuthRequired ? (
            <AlertTriangle className="w-4 h-4 text-amber-500 animate-pulse shrink-0" />
          ) : isDownloading ? (
            <Download className="w-4 h-4 text-teal-700 animate-bounce shrink-0" />
          ) : failed > 0 ? (
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-teal-700 shrink-0" />
          )}

          <div className="flex flex-col shrink-0">
            <span className="font-semibold text-slate-800 whitespace-nowrap">
              {isAuthRequired
                ? 'Tạm dừng: Cần đăng nhập lại Cổng Thuế'
                : isCancelledState
                ? `Đã dừng theo yêu cầu — Đã tải ${successCount}/${total} hồ sơ`
                : isDownloading
                ? `Đang tải ${successCount}/${total} hồ sơ (${percent}%)`
                : failed > 0
                ? `Đã tải ${successCount}/${total} hồ sơ (${failed} lỗi)`
                : `Đã tải hoàn tất ${successCount}/${total} hồ sơ`}
            </span>
            {isDownloading && (
              <span className="text-[11px] text-slate-400 whitespace-nowrap">
                {downloadSummary?.isPaused ? 'Đã tạm dừng tiến trình tải' : 'Đang xử lý gói dữ liệu từ Cổng Dịch vụ công...'}
              </span>
            )}
          </div>

          {/* Derived Real Progress Bar */}
          {isDownloading && (
            <div className="flex-1 max-w-[200px] h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200 hidden md:block">
              <div
                className={`h-full transition-all duration-300 rounded-full ${
                  downloadSummary?.isPaused ? 'bg-amber-500' : 'bg-teal-600'
                }`}
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center space-x-2 shrink-0 whitespace-nowrap">
          {isAuthRequired ? (
            <button
              type="button"
              onClick={onResumeDownload}
              className="h-7.5 px-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg text-xs flex items-center space-x-1.5 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Đăng nhập lại</span>
            </button>
          ) : isDownloading ? (
            <>
              {downloadSummary.isPaused ? (
                <button
                  type="button"
                  onClick={onResumeDownload}
                  className="h-7.5 px-3 bg-teal-700 hover:bg-teal-800 text-white font-semibold rounded-lg text-xs flex items-center space-x-1.5 transition-colors cursor-pointer shadow-xs"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Tiếp tục tải</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onPauseDownload}
                  className="h-7.5 px-3 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 font-semibold rounded-lg text-xs flex items-center space-x-1.5 transition-colors cursor-pointer"
                >
                  <Pause className="w-3.5 h-3.5 fill-current" />
                  <span>Tạm dừng</span>
                </button>
              )}
              <button
                type="button"
                onClick={onCancelDownload}
                className="h-7.5 px-2.5 bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-700 border border-slate-200 rounded-lg text-xs flex items-center space-x-1 transition-colors cursor-pointer"
                title="Hủy tải toàn bộ"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>Hủy</span>
              </button>
            </>
          ) : (
            <>
              {failed > 0 && (
                <button
                  type="button"
                  onClick={onRetryFailed}
                  className="h-7.5 px-3 bg-amber-600 hover:bg-amber-700 text-white font-semibold rounded-lg text-xs flex items-center space-x-1.5 transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Thử lại {failed} hồ sơ lỗi</span>
                </button>
              )}
              <button
                type="button"
                onClick={onOpenFolder}
                className="h-7.5 px-3 bg-teal-700 hover:bg-teal-800 text-white font-medium rounded-lg text-xs flex items-center space-x-1.5 transition-colors cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Mở thư mục</span>
              </button>
              <button
                type="button"
                onClick={onDismissDownload}
                className="h-7 w-7 text-slate-400 hover:text-slate-700 rounded-md hover:bg-slate-100 flex items-center justify-center transition-colors cursor-pointer ml-1"
                title="Đóng thông báo"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onOpenDetails}
            className="h-7.5 px-2.5 text-slate-500 hover:text-slate-800 text-xs flex items-center space-x-1 transition-colors cursor-pointer"
          >
            <ExternalLink className="w-3 h-3" />
            <span>Chi tiết</span>
          </button>
        </div>
      </div>
    );
  }

  // ─── CASE B: SELECTION ONLY (Chưa bấm tải) ──────────────────────────
  return (
    <div className="bg-white border border-slate-200/90 rounded-xl px-4 py-2.5 shadow-md flex items-center justify-between gap-4 animate-slideUp text-xs select-none">
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-1.5 text-slate-800 font-medium">
          <CheckSquare className="w-4 h-4 text-teal-700" />
          <span>
            Đã chọn <strong className="text-teal-800 font-bold font-mono">{selectedCount}</strong> / {totalCount} hồ sơ
          </span>
        </div>
        <button
          type="button"
          onClick={onDeselectAll}
          className="text-slate-400 hover:text-slate-700 text-[11px] underline underline-offset-2 transition-colors cursor-pointer"
        >
          Bỏ chọn
        </button>
      </div>

      <button
        type="button"
        onClick={onDownloadSelected}
        className="h-8.5 px-4 bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white font-semibold rounded-lg text-xs flex items-center space-x-1.5 transition-all shadow-xs cursor-pointer"
      >
        <Download className="w-3.5 h-3.5" />
        <span>{selectedCount === 1 ? 'Tải hồ sơ' : `Tải ${selectedCount} hồ sơ`}</span>
      </button>
    </div>
  );
};

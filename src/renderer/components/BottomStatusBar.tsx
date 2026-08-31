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
      <div className="bg-slate-900/95 backdrop-blur-md border border-slate-800 text-white rounded-2xl px-5 py-3 shadow-modal flex items-center justify-between gap-4 text-xs select-none animate-slideUp overflow-x-auto min-w-[520px]">
        {/* Left: Progress info & derived bar */}
        <div className="flex items-center space-x-3.5 flex-1 min-w-[260px] shrink-0">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${
            isAuthRequired
              ? 'bg-red-500/20 text-red-400 border-red-500/30'
              : isDownloading
              ? 'bg-teal-500/20 text-teal-400 border-teal-500/30'
              : failed > 0
              ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
              : 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
          }`}>
            {isAuthRequired ? (
              <AlertTriangle className="w-4 h-4 text-red-400 animate-pulse" />
            ) : isDownloading ? (
              <Download className="w-4 h-4 text-teal-400 animate-bounce" />
            ) : failed > 0 ? (
              <AlertTriangle className="w-4 h-4 text-amber-400" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            )}
          </div>

          <div className="flex flex-col shrink-0">
            <span className="font-bold text-slate-100 text-[13px] whitespace-nowrap">
              {isAuthRequired
                ? 'Tạm dừng: Cần xác thực lại Cổng Thuế'
                : isCancelledState
                ? `Đã dừng tiến trình — Đã tải ${successCount}/${total} hồ sơ`
                : isDownloading
                ? `Đang tải hồ sơ (${successCount}/${total} — ${percent}%)`
                : failed > 0
                ? `Tiến trình hoàn tất: ${successCount}/${total} thành công (${failed} lỗi)`
                : `Hoàn tất tải về: ${successCount}/${total} hồ sơ thành công`}
            </span>
            <span className="text-[11px] text-slate-400 whitespace-nowrap mt-0.5">
              {isDownloading
                ? (downloadSummary?.isPaused ? 'Đang tạm dừng theo yêu cầu của bạn' : 'Đang đồng bộ dữ liệu từ Cổng Dịch vụ công...')
                : failed > 0
                ? `Có ${failed} hồ sơ chưa tải được. Bấm "Thử lại" để tải tiếp.`
                : 'Tất cả tệp đã được lưu an toàn vào thư mục lưu trữ.'}
            </span>
          </div>

          {/* Derived Real Progress Bar */}
          {isDownloading && (
            <div className="flex-1 max-w-[160px] h-2 bg-slate-800 rounded-full overflow-hidden border border-slate-700 hidden md:block">
              <div
                className={`h-full transition-all duration-300 rounded-full ${
                  downloadSummary?.isPaused ? 'bg-amber-400' : 'bg-teal-400'
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
              className="h-8 px-3.5 bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-bold rounded-lg text-xs flex items-center space-x-1.5 transition-colors cursor-pointer shadow-sm"
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
                  className="h-8 px-3.5 bg-teal-600 hover:bg-teal-500 active:bg-teal-700 text-white font-bold rounded-lg text-xs flex items-center space-x-1.5 transition-colors cursor-pointer shadow-sm"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Tiếp tục tải</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onPauseDownload}
                  className="h-8 px-3.5 bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-500/40 font-semibold rounded-lg text-xs flex items-center space-x-1.5 transition-colors cursor-pointer"
                >
                  <Pause className="w-3.5 h-3.5 fill-current" />
                  <span>Tạm dừng</span>
                </button>
              )}
              <button
                type="button"
                onClick={onCancelDownload}
                className="h-8 px-3 bg-slate-800 hover:bg-red-950/80 text-slate-300 hover:text-red-400 border border-slate-700 rounded-lg text-xs flex items-center space-x-1.5 transition-colors cursor-pointer"
                title="Hủy tiến trình tải"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>Hủy đợt tải</span>
              </button>
            </>
          ) : (
            <>
              {failed > 0 && (
                <button
                  type="button"
                  onClick={onRetryFailed}
                  className="h-8 px-3.5 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 font-bold rounded-lg text-xs flex items-center space-x-1.5 transition-all shadow-sm cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Thử lại {failed} file lỗi</span>
                </button>
              )}
              <button
                type="button"
                onClick={onOpenFolder}
                className="h-8 px-3.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold rounded-lg text-xs flex items-center space-x-1.5 transition-colors cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5 text-teal-400" />
                <span>Mở thư mục</span>
              </button>
              <button
                type="button"
                onClick={onDismissDownload}
                className="h-8 w-8 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 flex items-center justify-center transition-colors cursor-pointer"
                title="Đóng thông báo"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onOpenDetails}
            className="h-8 px-2.5 text-slate-400 hover:text-slate-200 text-xs flex items-center space-x-1 transition-colors cursor-pointer rounded-lg hover:bg-slate-800"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>Chi tiết</span>
          </button>
        </div>
      </div>
    );
  }

  // ─── CASE B: SELECTION ONLY (Chưa bấm tải) ──────────────────────────
  return (
    <div className="bg-slate-900/95 backdrop-blur-md border border-slate-800 text-white rounded-2xl px-5 py-3 shadow-modal flex items-center justify-between gap-4 animate-slideUp text-xs select-none">
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2 text-slate-200 font-medium">
          <CheckSquare className="w-4 h-4 text-teal-400" />
          <span>
            Đã chọn <strong className="text-teal-300 font-bold font-mono text-[13px]">{selectedCount}</strong> / {totalCount} hồ sơ
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

      <button
        type="button"
        onClick={onDownloadSelected}
        className="h-8.5 px-4 bg-teal-600 hover:bg-teal-500 active:bg-teal-700 text-white font-bold rounded-lg text-xs flex items-center space-x-1.5 transition-all shadow-sm cursor-pointer"
      >
        <Download className="w-3.5 h-3.5" />
        <span>{selectedCount === 1 ? 'Tải hồ sơ đã chọn' : `Tải ${selectedCount} hồ sơ đã chọn`}</span>
      </button>
    </div>
  );
};

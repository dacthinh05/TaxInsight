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
      <div className="bg-white/95 backdrop-blur-md border border-slate-200/90 text-slate-800 rounded-2xl px-5 py-3 shadow-floating flex items-center justify-between gap-4 text-xs select-none animate-slideUp overflow-x-auto min-w-[520px]">
        {/* Left: Progress info & derived bar */}
        <div className="flex items-center space-x-3.5 flex-1 min-w-[260px] shrink-0">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${
            isAuthRequired
              ? 'bg-rose-50 text-rose-600 border-rose-200'
              : isDownloading
              ? 'bg-teal-50 text-teal-600 border-teal-200'
              : failed > 0
              ? 'bg-amber-50 text-amber-700 border-amber-200'
              : 'bg-emerald-50 text-emerald-600 border-emerald-200'
          }`}>
            {isAuthRequired ? (
              <AlertTriangle className="w-4 h-4 text-rose-600 animate-pulse" />
            ) : isDownloading ? (
              <Download className="w-4 h-4 text-teal-600 animate-bounce" />
            ) : failed > 0 ? (
              <AlertTriangle className="w-4 h-4 text-amber-600" />
            ) : (
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            )}
          </div>

          <div className="flex flex-col shrink-0">
            <span className="font-bold text-slate-900 text-[13px] whitespace-nowrap">
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
            <span className="text-[11px] text-slate-500 whitespace-nowrap mt-0.5">
              {isDownloading
                ? (downloadSummary?.isPaused ? 'Đang tạm dừng theo yêu cầu của bạn' : 'Đang đồng bộ dữ liệu từ Cổng Dịch vụ công...')
                : failed > 0
                ? `Có ${failed} hồ sơ chưa tải được. Bấm "Thử lại" để tải tiếp.`
                : 'Tất cả tệp đã được lưu an toàn vào thư mục lưu trữ.'}
            </span>
          </div>

          {/* Derived Real Progress Bar */}
          {isDownloading && (
            <div className="flex-1 max-w-[160px] h-2.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200/80 hidden md:block">
              <div
                className={`h-full transition-all duration-300 rounded-full ${
                  downloadSummary?.isPaused ? 'bg-amber-500' : 'bg-gradient-to-r from-teal-600 to-teal-500'
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
              className="h-8.5 px-3.5 bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-bold rounded-lg text-xs flex items-center space-x-1.5 transition-all cursor-pointer shadow-xs btn-press"
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
                  className="h-8.5 px-3.5 bg-gradient-to-r from-teal-700 to-teal-600 hover:from-teal-600 hover:to-teal-500 active:from-teal-800 active:to-teal-700 text-white font-bold rounded-lg text-xs flex items-center space-x-1.5 transition-all cursor-pointer shadow-xs btn-press border border-teal-700/40"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>Tiếp tục tải</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onPauseDownload}
                  className="h-8.5 px-3.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 font-semibold rounded-lg text-xs flex items-center space-x-1.5 transition-all cursor-pointer shadow-2xs btn-press"
                >
                  <Pause className="w-3.5 h-3.5 fill-current" />
                  <span>Tạm dừng</span>
                </button>
              )}
              <button
                type="button"
                onClick={onCancelDownload}
                className="h-8.5 px-3 bg-slate-50 hover:bg-rose-50 text-slate-600 hover:text-rose-700 border border-slate-200 rounded-lg text-xs flex items-center space-x-1.5 transition-all cursor-pointer shadow-2xs btn-press"
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
                  className="h-8.5 px-3.5 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white font-bold rounded-lg text-xs flex items-center space-x-1.5 transition-all shadow-xs cursor-pointer btn-press"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Thử lại {failed} file lỗi</span>
                </button>
              )}
              <button
                type="button"
                onClick={onOpenFolder}
                className="h-8.5 px-3.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-semibold rounded-lg text-xs flex items-center space-x-1.5 transition-all cursor-pointer shadow-2xs btn-press"
              >
                <FolderOpen className="w-3.5 h-3.5 text-teal-600" />
                <span>Mở thư mục</span>
              </button>
              <button
                type="button"
                onClick={onDismissDownload}
                className="h-8.5 w-8.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 flex items-center justify-center transition-all cursor-pointer btn-press"
                title="Đóng thông báo"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onOpenDetails}
            className="h-8.5 px-3.5 bg-teal-700 hover:bg-teal-800 text-white font-bold rounded-lg text-xs flex items-center space-x-1.5 transition-all cursor-pointer shadow-xs btn-press"
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
    <div className="bg-white/95 backdrop-blur-md border border-slate-200/90 text-slate-800 rounded-2xl px-5 py-3 shadow-floating flex items-center justify-between gap-4 animate-slideUp text-xs select-none">
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2 text-slate-700 font-medium">
          <CheckSquare className="w-4 h-4 text-teal-600" />
          <span>
            Đã chọn <strong className="text-teal-900 font-bold font-mono text-[13px] bg-teal-50 px-2 py-0.5 rounded-md border border-teal-200/80">{selectedCount}</strong> / {totalCount} hồ sơ
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
        className="h-8.5 px-4.5 bg-gradient-to-r from-teal-700 to-teal-600 hover:from-teal-600 hover:to-teal-500 active:from-teal-800 active:to-teal-700 text-white font-bold rounded-lg text-xs flex items-center space-x-2 transition-all shadow-xs cursor-pointer btn-press border border-teal-700/40"
      >
        <Download className="w-3.5 h-3.5" />
        <span>{selectedCount === 1 ? 'Tải hồ sơ đã chọn' : `Tải ${selectedCount} hồ sơ đã chọn`}</span>
      </button>
    </div>
  );
};

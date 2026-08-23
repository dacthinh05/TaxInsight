import React from 'react';
import { ArrowRight, CheckCircle2, Download, DownloadCloud, RefreshCw, X } from 'lucide-react';
import { UpdateInfo } from '../../shared/types';

interface UpdateNotificationModalProps {
  updateInfo: UpdateInfo | null;
  isOpen: boolean;
  onClose: () => void;
  onDownload: () => void;
  onInstall: () => void;
}

function formatReleaseNotes(notes?: string): string {
  if (!notes) return '• Nâng cấp hiệu năng tra cứu và tối ưu hóa hệ thống soát xét thuế.';
  return notes
    .replace(/<h[1-6]>(.*?)<\/h[1-6]>/gi, '$1:\n')
    .replace(/<li>(.*?)<\/li>/gi, '• $1\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p>(.*?)<\/p>/gi, '$1\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

export const UpdateNotificationModal: React.FC<UpdateNotificationModalProps> = ({
  updateInfo,
  isOpen,
  onClose,
  onDownload,
  onInstall
}) => {
  if (!isOpen || !updateInfo) return null;

  const isDownloading = updateInfo.state === 'DOWNLOADING';
  const isDownloaded = updateInfo.state === 'DOWNLOADED';
  const isAvailable = updateInfo.state === 'AVAILABLE';

  if (!isAvailable && !isDownloading && !isDownloaded) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-slate-900 px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-teal-500/20 text-teal-400 border border-teal-500/30 flex items-center justify-center">
              <DownloadCloud className="w-4.5 h-4.5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white tracking-wide">
                {isDownloaded ? 'Bản cập nhật đã sẵn sàng' : (isDownloading ? 'Đang tải bản cập nhật...' : 'Đã có phiên bản mới')}
              </h3>
              <p className="text-[11px] text-slate-400">TaxInsight Auto-Updater</p>
            </div>
          </div>
          {!isDownloading && (
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          )}
        </div>

        {/* Content Body */}
        <div className="p-4 space-y-3.5">
          {/* Version Transition Badge */}
          <div className="flex items-center justify-center space-x-3 py-2 px-3 bg-slate-950 border border-slate-800 rounded-xl">
            <span className="text-xs font-mono font-medium text-slate-400">
              v{updateInfo.currentVersion}
            </span>
            <ArrowRight className="w-3.5 h-3.5 text-teal-400" />
            <span className="text-xs font-mono font-bold text-teal-300 bg-teal-950/80 border border-teal-700/50 px-2.5 py-0.5 rounded-md">
              v{updateInfo.latestVersion || 'Mới nhất'}
            </span>
          </div>

          {/* Release Notes / Changelog */}
          {isAvailable && (
            <div className="space-y-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Nội dung cập nhật & cải tiến:
              </span>
              <div className="max-h-44 overflow-y-auto bg-slate-950/70 border border-slate-800/80 rounded-xl p-3.5 text-[13px] text-slate-200 space-y-1.5 leading-relaxed whitespace-pre-line">
                {formatReleaseNotes(updateInfo.releaseNotes)}
              </div>
            </div>
          )}

          {/* Downloading State */}
          {isDownloading && (
            <div className="space-y-2.5 py-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Tiến trình tải về</span>
                <span className="font-mono font-bold text-teal-400">{updateInfo.downloadPercent || 0}%</span>
              </div>
              <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                <div
                  className="bg-teal-500 h-full rounded-full transition-all duration-300"
                  style={{ width: `${updateInfo.downloadPercent || 0}%` }}
                />
              </div>
              {updateInfo.downloadSpeed && (
                <div className="text-right text-[11px] text-slate-500">
                  Tốc độ: {updateInfo.downloadSpeed}
                </div>
              )}
            </div>
          )}

          {/* Downloaded State */}
          {isDownloaded && (
            <div className="flex items-start space-x-2.5 p-3.5 bg-emerald-950/30 border border-emerald-500/30 rounded-xl text-emerald-300 text-xs">
              <CheckCircle2 className="w-4.5 h-4.5 shrink-0 text-emerald-400 mt-0.5" />
              <div>
                <p className="font-bold text-white mb-0.5">Tải hoàn tất!</p>
                <p className="text-slate-300 text-xs">
                  Bản cập nhật v{updateInfo.latestVersion} đã sẵn sàng. Bấm nút bên dưới để khởi động lại và cập nhật.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3 bg-slate-950/50 border-t border-slate-800 flex items-center justify-end space-x-2.5">
          {isAvailable && (
            <>
              <button
                onClick={onClose}
                className="px-3.5 py-1.5 text-xs font-medium text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
              >
                Để sau
              </button>
              <button
                onClick={onDownload}
                className="h-8.5 px-4 bg-teal-600 hover:bg-teal-500 text-white font-semibold rounded-lg text-xs transition-all flex items-center space-x-1.5 cursor-pointer shadow-sm"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Cập nhật ngay</span>
              </button>
            </>
          )}

          {isDownloading && (
            <div className="flex items-center space-x-2 text-xs text-slate-400 py-1">
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-teal-400" />
              <span>Đang tải gói cập nhật trong nền...</span>
            </div>
          )}

          {isDownloaded && (
            <button
              onClick={onInstall}
              className="w-full h-8.5 bg-teal-600 hover:bg-teal-500 text-white font-semibold rounded-lg text-xs transition-all flex items-center justify-center space-x-2 cursor-pointer shadow-sm"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Khởi động lại & Cập nhật</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Eye,
  FileCode,
  FileText,
  Filter,
  FolderOpen,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  X,
  XCircle
} from 'lucide-react';
import { DownloadQueueItem, DownloadSummary, TaxFiling } from '../../shared/types';

interface DownloadProgressModalProps {
  summary: DownloadSummary;
  queue?: DownloadQueueItem[];
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onOpenFolder: () => void;
  onClose: () => void;
  onRetryFailed?: () => void;
  onRetrySingle?: (filing: TaxFiling) => void;
  onPreviewFiling?: (filing: TaxFiling) => void;
  onOpenFilePath?: (filePath: string) => void;
}

type FilterTab = 'ALL' | 'DOWNLOADING' | 'COMPLETED' | 'EXISTING' | 'FAILED' | 'PENDING';

export const DownloadProgressModal: React.FC<DownloadProgressModalProps> = ({
  summary,
  queue = [],
  onPause,
  onResume,
  onCancel,
  onOpenFolder,
  onClose,
  onRetryFailed,
  onRetrySingle,
  onPreviewFiling,
  onOpenFilePath
}) => {
  const [activeTab, setActiveTab] = useState<FilterTab>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const processedCount = summary.completed + summary.existing + summary.failed;
  const percent = summary.total > 0 ? Math.min(100, Math.round((processedCount / summary.total) * 100)) : 0;
  const isFinished = !summary.isRunning && summary.remaining === 0 && summary.total > 0;
  const isStoppedManually =
    !summary.isRunning &&
    !summary.isPaused &&
    !isFinished &&
    summary.state !== 'AUTH_REQUIRED' &&
    summary.state !== 'PAUSED_AUTH_REQUIRED';
  const canClose = isFinished || isStoppedManually || summary.isCancelled;

  const handleCopyId = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  // Lọc danh sách hồ sơ trong hàng đợi
  const filteredQueue = useMemo(() => {
    return queue.filter(item => {
      // Lọc theo Tab
      if (activeTab === 'DOWNLOADING' && item.status !== 'DOWNLOADING') return false;
      if (activeTab === 'COMPLETED' && item.status !== 'COMPLETED') return false;
      if (activeTab === 'EXISTING' && item.status !== 'EXISTING') return false;
      if (activeTab === 'FAILED' && item.status !== 'FAILED') return false;
      if (activeTab === 'PENDING' && item.status !== 'PENDING' && item.status !== 'CANCELLED') return false;

      // Lọc theo Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const f = item.filing;
        const matchTitle = (f.title || '').toLowerCase().includes(q);
        const matchCode = (f.declarationCode || f.procedureCode || '').toLowerCase().includes(q);
        const matchPeriod = (f.period || '').toLowerCase().includes(q);
        const matchId = (item.filingId || f.id || '').toLowerCase().includes(q);
        const matchError = (item.error || f.downloadError || '').toLowerCase().includes(q);
        if (!matchTitle && !matchCode && !matchPeriod && !matchId && !matchError) {
          return false;
        }
      }

      return true;
    });
  }, [queue, activeTab, searchQuery]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 sm:p-6 animate-fadeIn select-none">
      <div className="bg-white w-full max-w-4xl max-h-[92vh] rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
        {/* ─── 1. HEADER SECTION ────────────────────────────────────────── */}
        <div className="bg-gradient-to-r from-teal-900 via-emerald-900 to-slate-900 px-6 py-4.5 text-white flex items-center justify-between border-b border-teal-800/60 shrink-0">
          <div className="flex items-center space-x-3.5">
            <div className="w-10 h-10 rounded-xl bg-teal-500/20 border border-teal-400/30 flex items-center justify-center shrink-0 shadow-inner">
              {summary.isRunning ? (
                <RefreshCw className="w-5 h-5 text-teal-300 animate-spin" />
              ) : isFinished ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              ) : summary.state === 'AUTH_REQUIRED' || summary.state === 'PAUSED_AUTH_REQUIRED' ? (
                <AlertCircle className="w-5 h-5 text-red-400 animate-pulse" />
              ) : (
                <Download className="w-5 h-5 text-teal-300" />
              )}
            </div>
            <div>
              <div className="flex items-center space-x-2.5">
                <h3 className="font-bold text-base tracking-tight text-white">
                  {isFinished ? 'Hoàn Tất Tiến Trình Tải Hồ Sơ Thuế' : 'Tiến Trình Tải Hồ Sơ Thuế Hàng Loạt'}
                </h3>
                {summary.isRunning && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping mr-1.5" />
                    Đang xử lý
                  </span>
                )}
                {summary.isPaused && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                    Đã tạm dừng
                  </span>
                )}
                {(summary.state === 'AUTH_REQUIRED' || summary.state === 'PAUSED_AUTH_REQUIRED') && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-red-500/20 text-red-300 border border-red-500/40 animate-pulse">
                    Cần đăng nhập lại
                  </span>
                )}
              </div>
              <p className="text-xs text-teal-200/80 mt-0.5">
                {isFinished
                  ? `Đã xử lý xong toàn bộ ${summary.total} hồ sơ trong đợt tải.`
                  : summary.isRunning
                  ? `Đang tải đồng thời dữ liệu từ Cổng Dịch vụ công (Thuế Điện Tử)...`
                  : summary.isPaused
                  ? 'Tiến trình tải đang tạm dừng theo yêu cầu của bạn.'
                  : 'Hàng đợi tải hồ sơ đã dừng.'}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            <div className="text-right hidden sm:block">
              <span className="text-[11px] text-teal-200 block font-medium">Tiến độ đợt tải</span>
              <span className="text-lg font-bold font-mono text-emerald-300">{percent}%</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-teal-200 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              title={isFinished ? "Đóng cửa sổ" : "Ẩn cửa sổ và tiếp tục tải ngầm trong nền"}
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {/* ─── 2. PROGRESS BAR & STATS CARDS ───────────────────────────── */}
        <div className="p-5 space-y-4 bg-slate-50 border-b border-slate-200 shrink-0">
          {/* Main Progress Bar */}
          <div>
            <div className="flex justify-between items-center text-xs font-semibold text-slate-700 mb-1.5">
              <span className="flex items-center space-x-1.5">
                <span>Tiến độ hoàn thành:</span>
                <span className="font-mono text-emerald-800 font-bold">
                  {processedCount}/{summary.total} hồ sơ ({percent}%)
                </span>
              </span>
              <span className="text-slate-500 font-mono text-[11px]">
                {summary.remaining > 0 ? `Còn lại: ${summary.remaining} hồ sơ` : 'Đã hoàn tất xử lý'}
              </span>
            </div>
            <div className="w-full h-3.5 bg-slate-200 rounded-full overflow-hidden border border-slate-300/80 p-0.5">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  summary.failed > 0 && percent === 100
                    ? 'bg-gradient-to-r from-emerald-500 via-amber-500 to-teal-600'
                    : 'bg-gradient-to-r from-teal-500 via-emerald-500 to-cyan-500'
                }`}
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>

          {/* Interactive Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
            {/* Tổng số */}
            <button
              type="button"
              onClick={() => setActiveTab('ALL')}
              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                activeTab === 'ALL'
                  ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                  : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-100/60'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-[11px] font-semibold ${activeTab === 'ALL' ? 'text-slate-300' : 'text-slate-500'}`}>
                  Tổng số
                </span>
                <Download className={`w-3.5 h-3.5 ${activeTab === 'ALL' ? 'text-teal-300' : 'text-slate-400'}`} />
              </div>
              <div className={`text-base font-bold font-mono mt-0.5 ${activeTab === 'ALL' ? 'text-white' : 'text-slate-900'}`}>
                {summary.total}
              </div>
            </button>

            {/* Đã tải mới */}
            <button
              type="button"
              onClick={() => setActiveTab('COMPLETED')}
              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                activeTab === 'COMPLETED'
                  ? 'bg-emerald-800 text-white border-emerald-800 shadow-sm'
                  : 'bg-emerald-50/70 text-emerald-900 border-emerald-200 hover:bg-emerald-100/70'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-[11px] font-semibold ${activeTab === 'COMPLETED' ? 'text-emerald-200' : 'text-emerald-700'}`}>
                  Đã tải mới
                </span>
                <CheckCircle2 className={`w-3.5 h-3.5 ${activeTab === 'COMPLETED' ? 'text-emerald-200' : 'text-emerald-600'}`} />
              </div>
              <div className={`text-base font-bold font-mono mt-0.5 ${activeTab === 'COMPLETED' ? 'text-white' : 'text-emerald-900'}`}>
                {summary.completed}
              </div>
            </button>

            {/* Có sẵn */}
            <button
              type="button"
              onClick={() => setActiveTab('EXISTING')}
              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                activeTab === 'EXISTING'
                  ? 'bg-teal-800 text-white border-teal-800 shadow-sm'
                  : 'bg-teal-50/70 text-teal-900 border-teal-200 hover:bg-teal-100/70'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-[11px] font-semibold ${activeTab === 'EXISTING' ? 'text-teal-200' : 'text-teal-700'}`}>
                  Có sẵn (Cache)
                </span>
                <FileText className={`w-3.5 h-3.5 ${activeTab === 'EXISTING' ? 'text-teal-200' : 'text-teal-600'}`} />
              </div>
              <div className={`text-base font-bold font-mono mt-0.5 ${activeTab === 'EXISTING' ? 'text-white' : 'text-teal-900'}`}>
                {summary.existing}
              </div>
            </button>

            {/* Bị lỗi */}
            <button
              type="button"
              onClick={() => setActiveTab('FAILED')}
              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                activeTab === 'FAILED'
                  ? 'bg-red-800 text-white border-red-800 shadow-sm'
                  : summary.failed > 0
                  ? 'bg-red-50 text-red-900 border-red-300 hover:bg-red-100/80 animate-pulse'
                  : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-[11px] font-semibold ${activeTab === 'FAILED' ? 'text-red-200' : summary.failed > 0 ? 'text-red-700' : 'text-slate-500'}`}>
                  Bị lỗi
                </span>
                <AlertCircle className={`w-3.5 h-3.5 ${activeTab === 'FAILED' ? 'text-red-200' : summary.failed > 0 ? 'text-red-600' : 'text-slate-400'}`} />
              </div>
              <div className={`text-base font-bold font-mono mt-0.5 ${activeTab === 'FAILED' ? 'text-white' : summary.failed > 0 ? 'text-red-700' : 'text-slate-600'}`}>
                {summary.failed}
              </div>
            </button>

            {/* Đang chờ / Đang tải */}
            <button
              type="button"
              onClick={() => setActiveTab('PENDING')}
              className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer col-span-2 sm:col-span-1 ${
                activeTab === 'PENDING'
                  ? 'bg-amber-800 text-white border-amber-800 shadow-sm'
                  : 'bg-amber-50/70 text-amber-900 border-amber-200 hover:bg-amber-100/70'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-[11px] font-semibold ${activeTab === 'PENDING' ? 'text-amber-200' : 'text-amber-700'}`}>
                  Còn lại
                </span>
                <Clock className={`w-3.5 h-3.5 ${activeTab === 'PENDING' ? 'text-amber-200' : 'text-amber-600'}`} />
              </div>
              <div className={`text-base font-bold font-mono mt-0.5 ${activeTab === 'PENDING' ? 'text-white' : 'text-amber-900'}`}>
                {summary.remaining}
              </div>
            </button>
          </div>

          {/* Smart Failed Callout Banner */}
          {summary.failed > 0 && (
            <div className="p-3 bg-red-50/90 border border-red-200 rounded-xl flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
                <div className="text-xs text-red-800">
                  <span className="font-bold">Có {summary.failed} hồ sơ chưa tải được.</span>
                  <span className="text-red-700 block sm:inline sm:ml-1.5">
                    (Do Cổng Thuế quá tải hoặc chưa sẵn sàng file). Bạn có thể bấm Thử lại để hệ thống tải tiếp.
                  </span>
                </div>
              </div>
              {onRetryFailed && (
                <button
                  type="button"
                  onClick={onRetryFailed}
                  className="px-3 py-1.5 bg-red-700 hover:bg-red-800 active:bg-red-900 text-white font-semibold rounded-lg text-xs flex items-center space-x-1.5 transition-colors shadow-xs shrink-0 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Thử lại {summary.failed} file lỗi</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* ─── 3. SEARCH & QUEUE LIST VIEW ────────────────────────────── */}
        <div className="flex flex-col flex-1 overflow-hidden">
          {/* Search Toolbar */}
          <div className="px-5 py-2.5 bg-white border-b border-slate-200 flex items-center justify-between gap-3 shrink-0">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Tìm mã tờ khai, kỳ thuế, mã hồ sơ..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-8.5 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 focus:bg-white transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center space-x-2 text-xs text-slate-500 font-medium">
              <Filter className="w-3.5 h-3.5 text-slate-400" />
              <span>Hiển thị: </span>
              <span className="font-bold text-slate-800">{filteredQueue.length}</span>
              <span className="text-slate-400">/ {queue.length || summary.total} hồ sơ</span>
            </div>
          </div>

          {/* Scrollable File List / Table */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-slate-100/60 divide-y-0">
            {filteredQueue.length === 0 ? (
              <div className="py-12 text-center text-slate-400">
                <FileCode className="w-10 h-10 text-slate-300 mx-auto mb-2 opacity-60" />
                <p className="text-xs font-semibold text-slate-600">Không tìm thấy hồ sơ nào trong mục này</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {searchQuery ? 'Thử tìm kiếm với từ khóa khác' : 'Chọn tab khác để xem danh sách hồ sơ'}
                </p>
              </div>
            ) : (
              filteredQueue.map((item, index) => {
                const filing = item.filing;
                const isDownloading = item.status === 'DOWNLOADING';
                const isCompleted = item.status === 'COMPLETED';
                const isExisting = item.status === 'EXISTING';
                const isFailed = item.status === 'FAILED';
                const isPending = item.status === 'PENDING';
                const isCancelled = item.status === 'CANCELLED';

                const procedureCode = filing.declarationCode || filing.procedureCode || 'TKHAI';
                const period = filing.period || filing.periodNormalized?.raw || 'Chưa rõ kỳ';

                return (
                  <div
                    key={item.filingId || `${procedureCode}_${index}`}
                    className={`p-3 bg-white rounded-xl border transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                      isDownloading
                        ? 'border-teal-400 bg-teal-50/30 shadow-xs'
                        : isFailed
                        ? 'border-red-200 bg-red-50/20'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {/* Left: Status Icon & Details */}
                    <div className="flex items-start space-x-3 min-w-0 flex-1">
                      <div className="mt-0.5 shrink-0">
                        {isDownloading ? (
                          <div className="w-7 h-7 rounded-lg bg-teal-100 border border-teal-300 flex items-center justify-center">
                            <RefreshCw className="w-4 h-4 text-teal-700 animate-spin" />
                          </div>
                        ) : isCompleted ? (
                          <div className="w-7 h-7 rounded-lg bg-emerald-100 border border-emerald-300 flex items-center justify-center">
                            <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                          </div>
                        ) : isExisting ? (
                          <div className="w-7 h-7 rounded-lg bg-teal-100 border border-teal-300 flex items-center justify-center" title="Đã có sẵn trên ổ cứng">
                            <FileText className="w-4 h-4 text-teal-700" />
                          </div>
                        ) : isFailed ? (
                          <div className="w-7 h-7 rounded-lg bg-red-100 border border-red-300 flex items-center justify-center">
                            <AlertCircle className="w-4 h-4 text-red-700" />
                          </div>
                        ) : (
                          <div className="w-7 h-7 rounded-lg bg-slate-100 border border-slate-300 flex items-center justify-center">
                            <Clock className="w-4 h-4 text-slate-500" />
                          </div>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center flex-wrap gap-1.5 mb-1">
                          {/* Code Badge */}
                          <span className="px-2 py-0.5 rounded-md text-[11px] font-bold bg-slate-900 text-white font-mono">
                            {procedureCode}
                          </span>
                          {/* Period Badge */}
                          <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                            {period}
                          </span>
                          {/* Filing Type */}
                          {filing.filingType === 'SUPPLEMENTAL' ? (
                            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                              Bổ sung L{filing.supplementalNo || 1}
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 text-slate-700">
                              Chính thức
                            </span>
                          )}
                          {/* Status Pill */}
                          {isDownloading && (
                            <span className="text-[10px] font-semibold text-teal-700 bg-teal-100/80 px-2 py-0.5 rounded-full animate-pulse">
                              Đang tải...
                            </span>
                          )}
                          {isCompleted && (
                            <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                              Tải mới thành công
                            </span>
                          )}
                          {isExisting && (
                            <span className="text-[10px] font-semibold text-teal-700 bg-teal-100 px-2 py-0.5 rounded-full">
                              Đã có trong kho
                            </span>
                          )}
                          {isFailed && (
                            <span className="text-[10px] font-semibold text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
                              Thất bại
                            </span>
                          )}
                          {isPending && (
                            <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                              Đang chờ
                            </span>
                          )}
                          {isCancelled && (
                            <span className="text-[10px] font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full">
                              Đã hủy
                            </span>
                          )}
                        </div>

                        {/* Title */}
                        <div className="text-xs font-semibold text-slate-800 truncate" title={filing.title}>
                          {filing.title || 'Hồ sơ khai thuế điện tử'}
                        </div>

                        {/* Submission ID & Error Details */}
                        <div className="flex items-center flex-wrap gap-2 text-[11px] text-slate-500 mt-0.5">
                          {item.filingId && (
                            <button
                              type="button"
                              onClick={e => handleCopyId(item.filingId, e)}
                              className="font-mono text-[10px] text-slate-600 hover:text-teal-700 bg-slate-100 hover:bg-slate-200 px-1.5 py-0.5 rounded flex items-center space-x-1 cursor-pointer transition-colors"
                              title="Bấm để sao chép mã hồ sơ"
                            >
                              <span>{item.filingId}</span>
                              {copiedId === item.filingId ? (
                                <Check className="w-2.5 h-2.5 text-emerald-600" />
                              ) : (
                                <Copy className="w-2.5 h-2.5 text-slate-400" />
                              )}
                            </button>
                          )}

                          {filing.submittedAt && (
                            <span>Nộp ngày: {filing.submittedAt}</span>
                          )}

                          {isFailed && (item.error || filing.downloadError) && (
                            <span className="text-red-700 font-medium break-all bg-red-100/60 px-1.5 py-0.5 rounded border border-red-200/60">
                              Lý do: {item.error || filing.downloadError}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center space-x-2 shrink-0 self-end sm:self-center">
                      {isFailed && onRetrySingle && (
                        <button
                          type="button"
                          onClick={() => onRetrySingle(filing)}
                          className="px-2.5 py-1 bg-red-50 hover:bg-red-100 border border-red-300 text-red-700 font-semibold rounded-lg text-xs flex items-center space-x-1 transition-colors cursor-pointer"
                          title="Thử tải lại riêng hồ sơ này"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Thử lại</span>
                        </button>
                      )}

                      {(isCompleted || isExisting) && onPreviewFiling && (
                        <button
                          type="button"
                          onClick={() => onPreviewFiling(filing)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-teal-50 border border-slate-200 hover:border-teal-300 text-slate-700 hover:text-teal-800 font-medium rounded-lg text-xs flex items-center space-x-1 transition-colors cursor-pointer"
                          title="Xem chi tiết & nội dung tờ khai"
                        >
                          <Eye className="w-3 h-3 text-teal-700" />
                          <span>Xem</span>
                        </button>
                      )}

                      {item.savedPaths && item.savedPaths.length > 0 && onOpenFilePath && (
                        <button
                          type="button"
                          onClick={() => onOpenFilePath(item.savedPaths![0])}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs flex items-center space-x-1 transition-colors cursor-pointer"
                          title="Mở file trên máy tính"
                        >
                          <FolderOpen className="w-3 h-3 text-teal-700" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* ─── 4. FOOTER CONTROLS ──────────────────────────────────────── */}
        <div className="bg-slate-50 px-6 py-3.5 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <button
            type="button"
            onClick={onOpenFolder}
            className="w-full sm:w-auto px-3.5 py-2 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-semibold rounded-xl text-xs flex items-center justify-center space-x-2 transition-all shadow-2xs cursor-pointer"
          >
            <FolderOpen className="w-4 h-4 text-teal-700" />
            <span>Mở thư mục lưu trữ hồ sơ</span>
          </button>

          <div className="flex items-center space-x-2.5 w-full sm:w-auto justify-end">
            {!isFinished ? (
              <>
                {summary.state === 'AUTH_REQUIRED' || summary.state === 'PAUSED_AUTH_REQUIRED' ? (
                  <button
                    type="button"
                    onClick={onResume}
                    className="px-4 py-2 bg-red-700 hover:bg-red-800 active:bg-red-900 text-white font-bold rounded-xl text-xs flex items-center space-x-1.5 transition-all shadow-xs animate-pulse cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Đăng nhập lại để tiếp tục</span>
                  </button>
                ) : summary.isPaused ? (
                  <button
                    type="button"
                    onClick={onResume}
                    className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white font-semibold rounded-xl text-xs flex items-center space-x-1.5 transition-all shadow-xs cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Tiếp tục tải</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={onPause}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white font-semibold rounded-xl text-xs flex items-center space-x-1.5 transition-all shadow-xs cursor-pointer"
                  >
                    <Pause className="w-3.5 h-3.5" />
                    <span>Tạm dừng</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 font-semibold rounded-xl text-xs flex items-center space-x-1.5 transition-all cursor-pointer shadow-2xs"
                  title="Ẩn cửa sổ và tiếp tục tải ngầm trong nền"
                >
                  <Eye className="w-3.5 h-3.5 text-teal-700" />
                  <span>Ẩn & Chạy trong nền</span>
                </button>

                <button
                  type="button"
                  onClick={onCancel}
                  className="px-3.5 py-2 bg-white hover:bg-rose-50 border border-rose-300 text-rose-700 hover:text-rose-800 font-semibold rounded-xl text-xs flex items-center space-x-1.5 transition-all cursor-pointer"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  <span>Dừng đợt tải</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2 bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white font-bold rounded-xl text-xs transition-all shadow-xs cursor-pointer"
              >
                Đóng cửa sổ
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

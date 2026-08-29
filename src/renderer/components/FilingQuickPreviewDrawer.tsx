import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Building2,
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Code2,
  Copy,
  Download,
  Eye,
  FileCode,
  FileText,
  Loader2,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  X
} from 'lucide-react';
import { formatDeclarationValue, FormattedDeclarationMetric } from '../../shared/declarationFormatter';
import { formatCompactPeriod, getFilingDisplayName } from '../../shared/dateUtils';
import { FilingMetricItem, FilingPreviewData, TaxFiling } from '../../shared/types';

interface FilingQuickPreviewDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  filing: TaxFiling | null;
  onDownloadSingle: (filing: TaxFiling) => void;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  initialShowXml?: boolean;
}

export const FilingQuickPreviewDrawer: React.FC<FilingQuickPreviewDrawerProps> = ({
  isOpen,
  onClose,
  filing,
  onDownloadSingle,
  onNavigatePrev,
  onNavigateNext,
  hasPrev = false,
  hasNext = false,
  initialShowXml = false
}) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<FilingPreviewData | null>(null);
  const [copiedId, setCopiedId] = useState(false);
  const [copiedXml, setCopiedXml] = useState(false);
  const [activeTab, setActiveTab] = useState<'METRICS' | 'XML'>('METRICS');
  const [showFullLegalTitle, setShowFullLegalTitle] = useState(false);

  // In-memory cache theo session
  const [cache] = useState<Map<string, FilingPreviewData>>(() => new Map());

  useEffect(() => {
    if (!isOpen || !filing) {
      setPreviewData(null);
      setError(null);
      setActiveTab('METRICS');
      setShowFullLegalTitle(false);
      return;
    }

    setActiveTab(initialShowXml ? 'XML' : 'METRICS');

    const cacheKey = `${filing.id}_${filing.period}`;
    if (cache.has(cacheKey)) {
      setPreviewData(cache.get(cacheKey)!);
      setLoading(false);
      setError(null);
      return;
    }

    let isSubscribed = true;
    setLoading(true);
    setError(null);

    if (window.taxPortalAPI) {
      window.taxPortalAPI
        .getFilingPreview(filing)
        .then(res => {
          if (!isSubscribed) return;
          if (res.success && res.data) {
            cache.set(cacheKey, res.data);
            setPreviewData(res.data);
          } else {
            setError(res.error || 'Không thể lấy dữ liệu chi tiết của hồ sơ');
          }
        })
        .catch(err => {
          if (!isSubscribed) return;
          setError(err.message || 'Lỗi kết nối khi tải nội dung xem nhanh');
        })
        .finally(() => {
          if (isSubscribed) setLoading(false);
        });
    } else {
      setError('Không kết nối được tiến trình chính để tải nội dung xem nhanh.');
      setLoading(false);
    }

    return () => {
      isSubscribed = false;
    };
  }, [isOpen, filing, initialShowXml]);

  const displayInfo = useMemo(() => {
    if (!filing) return { primaryTitle: '', compactPeriod: '—' };
    const nameInfo = getFilingDisplayName(filing);
    return {
      primaryTitle: typeof nameInfo === 'string' ? nameInfo : nameInfo.primaryTitle,
      compactPeriod: formatCompactPeriod(filing)
    };
  }, [filing]);

  const formattedMetricGroups = useMemo(() => {
    if (!previewData || !previewData.metrics) return new Map<string, FormattedDeclarationMetric[]>();

    const map = new Map<string, FormattedDeclarationMetric[]>();
    for (const raw of previewData.metrics) {
      const formatted = formatDeclarationValue(raw);
      const groupName = formatted.group || 'CHỈ TIÊU KHÁC';

      if (!map.has(groupName)) {
        map.set(groupName, []);
      }
      map.get(groupName)!.push(formatted);
    }
    return map;
  }, [previewData]);

  if (!isOpen || !filing) return null;

  const { primaryTitle, compactPeriod } = displayInfo;

  return (
    <div className="fixed inset-0 z-[70] overflow-hidden select-none animate-fadeIn flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-2xs transition-opacity"
        onClick={onClose}
      />

      {/* Drawer Canvas (w-full max-w-2xl) */}
      <div className="relative w-full max-w-2xl bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col z-[70] animate-slideLeft">
        
        {/* ─── 1. TOPBAR ─────────────────────────────────────────────── */}
        <div className="px-6 py-3.5 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              CHI TIẾT HỒ SƠ
            </span>
            {filing.declarationCode && (
              <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200">
                {filing.declarationCode}
              </span>
            )}
          </div>

          <div className="flex items-center space-x-1.5">
            {onNavigatePrev && (
              <button
                type="button"
                onClick={onNavigatePrev}
                disabled={!hasPrev}
                className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Hồ sơ trước (Phím ↑)"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            {onNavigateNext && (
              <button
                type="button"
                onClick={onNavigateNext}
                disabled={!hasNext}
                className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Hồ sơ sau (Phím ↓)"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors ml-1 cursor-pointer"
              title="Đóng (Esc)"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {/* ─── 2. RECOGNIZABLE HEADER BANNER ────────────────────────── */}
        <div className="px-6 py-3.5 bg-slate-50/80 border-b border-slate-200 shrink-0 space-y-2">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-900 leading-snug">
              {primaryTitle}
            </h2>
          </div>

          {/* Badges metadata */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {filing.declarationCode && (
              <span className="font-semibold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200 shadow-2xs">
                Mẫu {filing.declarationCode}
              </span>
            )}
            {compactPeriod !== '—' && (
              <span className="font-semibold text-teal-900 bg-teal-50 px-2 py-0.5 rounded border border-teal-200/80">
                Kỳ {compactPeriod}
              </span>
            )}
            <span className={`px-2 py-0.5 rounded font-semibold text-[11.5px] ${
              filing.filingType === 'SUPPLEMENTAL'
                ? 'bg-amber-50 text-amber-900 border border-amber-200'
                : 'bg-slate-100 text-slate-700 border border-slate-200'
            }`}>
              {filing.filingType === 'SUPPLEMENTAL'
                ? `Bổ sung ${filing.supplementalNo ? `lần ${filing.supplementalNo}` : ''}`
                : 'Chính thức'}
            </span>
            {filing.submittedAt && (
              <span className="text-slate-500 text-xs">
                · Nộp ngày {filing.submittedAt}
              </span>
            )}
          </div>

          {/* Tab Switcher: Chỉ Tiêu Kê Khai vs Cấu Trúc XML */}
          <div className="pt-2 flex items-center space-x-2 border-t border-slate-200/80">
            <button
              type="button"
              onClick={() => setActiveTab('METRICS')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer ${
                activeTab === 'METRICS'
                  ? 'bg-teal-700 text-white shadow-2xs'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Chỉ tiêu kê khai</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('XML')}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer ${
                activeTab === 'XML'
                  ? 'bg-teal-700 text-white shadow-2xs'
                  : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>Cấu trúc XML gốc</span>
            </button>
          </div>
        </div>

        {/* ─── 3. SCROLLABLE CONTENT BODY ────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5 bg-white">
          {loading && (
            <div className="space-y-4 py-8 animate-pulse">
              <div className="h-20 bg-slate-100 rounded-xl" />
              <div className="h-32 bg-slate-100 rounded-xl" />
            </div>
          )}

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs flex items-start space-x-2.5">
              <AlertCircle className="w-4.5 h-4.5 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <div className="font-semibold">Không thể tải nội dung hồ sơ</div>
                <div>{error}</div>
              </div>
            </div>
          )}

          {!loading && !error && previewData && (
            <>
              {/* TAB 1: METRICS & FORM VIEW */}
              {activeTab === 'METRICS' && (
                <div className="space-y-5">
                  {/* Card Metadata Hồ Sơ */}
                  <div className="bg-slate-50 border border-slate-200/90 rounded-xl p-4 space-y-3 shadow-2xs">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-700 uppercase tracking-wider">
                        Thông tin hồ sơ
                      </span>
                      <span className="inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11.5px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                        <span>{filing.status || 'Đã chấp nhận'}</span>
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs text-slate-600 pt-1 border-t border-slate-200/60">
                      <div>
                        <span className="text-slate-400 block text-[11px]">Mã thủ tục:</span>
                        <span className="font-mono font-medium text-slate-800">{filing.procedureCode || '1.008327'}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[11px]">Cơ quan tiếp nhận:</span>
                        <span className="font-medium text-slate-800">{previewData.taxAuthority || 'Cơ quan Thuế tiếp nhận'}</span>
                      </div>
                    </div>

                    {/* Mã giao dịch ID */}
                    <div className="pt-2 border-t border-slate-200/60">
                      <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                        <span>Mã giao dịch / ID hồ sơ:</span>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard.writeText(filing.id);
                            setCopiedId(true);
                            setTimeout(() => setCopiedId(false), 2000);
                          }}
                          className="hover:text-teal-700 font-medium inline-flex items-center space-x-1 cursor-pointer"
                        >
                          {copiedId ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-teal-600" />
                              <span>Đã sao chép</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Sao chép</span>
                            </>
                          )}
                        </button>
                      </div>
                      <div className="font-mono text-slate-700 text-xs select-all bg-white p-2 rounded-lg border border-slate-200 break-all shadow-2xs">
                        {filing.id}
                      </div>
                    </div>
                  </div>

                  {/* Nhóm Chỉ Tiêu Kê Khai Chính */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                        Chỉ tiêu kê khai chính
                      </span>
                      <span className="text-[11px] text-slate-500 flex items-center space-x-1">
                        <Sparkles className="w-3 h-3 text-teal-600" />
                        <span>{previewData.xmlAvailable ? 'Trích xuất từ XML' : 'Thông tin hồ sơ'}</span>
                      </span>
                    </div>

                    {Array.from(formattedMetricGroups.entries()).map(([groupName, items], gIdx) => (
                      <div key={gIdx} className="space-y-2">
                        {formattedMetricGroups.size > 1 && groupName !== 'CHỈ TIÊU KÊ KHAI CHÍNH' && (
                          <div className="text-[11.5px] font-bold text-slate-600 tracking-wide uppercase px-1">
                            {groupName}
                          </div>
                        )}

                        <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 overflow-hidden bg-white shadow-2xs">
                          {items.map((item, idx) => {
                            const isText = item.type === 'text' || item.type === 'identifier';
                            return (
                              <div
                                key={idx}
                                className={`px-4 py-3 min-h-[52px] flex items-start justify-between gap-4 transition-colors ${
                                  item.code === '[40]'
                                    ? 'bg-emerald-50/50'
                                    : item.code === '[43]'
                                    ? 'bg-teal-50/50'
                                    : item.isHighlight
                                    ? 'bg-slate-50/60'
                                    : 'hover:bg-slate-50/40'
                                }`}
                              >
                                <div className="min-w-[140px] max-w-[200px] shrink-0">
                                  <div className="text-[13px] leading-snug font-medium text-slate-600">
                                    {item.label}
                                  </div>
                                  {item.code && (
                                    <div className="mt-0.5 flex items-center space-x-1.5">
                                      <span className="text-[10.5px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded border border-slate-200/80">
                                        Chỉ tiêu {item.code}
                                      </span>
                                    </div>
                                  )}
                                </div>

                                <div className={`flex-1 text-right min-w-0 ${isText ? 'text-slate-900 font-medium text-[13px] break-words text-right' : 'font-mono tabular-nums text-[14.5px]'}`}>
                                  <span className={
                                    item.code === '[40]'
                                      ? 'font-bold text-emerald-950'
                                      : item.code === '[43]'
                                      ? 'font-bold text-teal-950'
                                      : item.isHighlight
                                      ? 'font-bold text-slate-950'
                                      : 'font-semibold text-slate-900'
                                  }>
                                    {item.formattedValue}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 2: FULL RAW XML CODE VIEW */}
              {activeTab === 'XML' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center space-x-1.5">
                      <Code2 className="w-4 h-4 text-teal-700" />
                      <span>Cấu trúc XML gốc của tờ khai</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (previewData.xmlSnippet) {
                          navigator.clipboard.writeText(previewData.xmlSnippet);
                          setCopiedXml(true);
                          setTimeout(() => setCopiedXml(false), 2000);
                        }
                      }}
                      className="h-8 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center space-x-1.5 cursor-pointer transition-colors"
                    >
                      {copiedXml ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-teal-600" />
                          <span>Đã sao chép XML</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Sao chép toàn bộ XML</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="p-4 bg-slate-950 rounded-xl text-emerald-400 font-mono text-[12px] overflow-auto max-h-[600px] break-all whitespace-pre-wrap leading-relaxed border border-slate-800 shadow-inner">
                    {previewData.xmlSnippet || 'Không có đoạn trích XML cho hồ sơ này.'}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ─── 4. FOOTER ACTIONS ─────────────────────────────────────── */}
        <div className="px-6 py-3.5 bg-white border-t border-slate-200 flex items-center justify-between gap-3 shrink-0 shadow-2xs">
          <button
            type="button"
            onClick={onClose}
            className="h-9 px-4 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 font-medium rounded-lg text-xs transition-colors cursor-pointer shadow-2xs"
          >
            Đóng
          </button>

          <button
            type="button"
            onClick={() => onDownloadSingle(filing)}
            className="h-9 px-4.5 bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white font-semibold rounded-lg text-xs flex items-center space-x-1.5 transition-all shadow-xs cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Tải hồ sơ</span>
          </button>
        </div>
      </div>
    </div>
  );
};

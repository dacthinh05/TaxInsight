import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCircle2,
  Clock,
  Code2,
  Copy,
  Download,
  FileCode,
  FileJson,
  Filter,
  Layers,
  Play,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Terminal,
  Trash2,
  Wifi,
  WifiOff,
  X
} from 'lucide-react';
import { ApiInspectorEntry, ApiInspectorModule } from '../../shared/types';

interface ApiInspectorDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabType = 'OVERVIEW' | 'REQUEST' | 'RESPONSE' | 'TROUBLESHOOTING';

export const ApiInspectorDrawer: React.FC<ApiInspectorDrawerProps> = ({ isOpen, onClose }) => {
  const [entries, setEntries] = useState<ApiInspectorEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ERRORS' | '2XX' | '4XX' | '5XX' | 'SLOW'>('ALL');
  const [moduleFilter, setModuleFilter] = useState<string>('ALL');
  const [isLiveStreaming, setIsLiveStreaming] = useState(true);
  const [activeTab, setActiveTab] = useState<TabType>('OVERVIEW');
  const [copiedState, setCopiedState] = useState<string | null>(null);
  const [responseViewMode, setResponseViewMode] = useState<'PRETTY' | 'RAW'>('PRETTY');

  const listContainerRef = useRef<HTMLDivElement>(null);

  // Load initial entries and register live listeners
  useEffect(() => {
    if (!isOpen) return;

    if (window.taxPortalAPI?.inspectorGetEntries) {
      window.taxPortalAPI.inspectorGetEntries().then(list => {
        setEntries(list || []);
        if (list && list.length > 0 && !selectedId) {
          setSelectedId(list[0].id);
        }
      });
    }

    if (!window.taxPortalAPI) return;

    const unsubs = [
      window.taxPortalAPI.onInspectorNewEntry(newEntry => {
        setEntries(prev => {
          const next = [newEntry, ...prev.filter(e => e.id !== newEntry.id)].slice(0, 500);
          return next;
        });
      }),

      window.taxPortalAPI.onInspectorEntryUpdated(updatedEntry => {
        setEntries(prev => prev.map(e => (e.id === updatedEntry.id ? { ...e, ...updatedEntry } : e)));
      }),

      window.taxPortalAPI.onInspectorCleared(() => {
        setEntries([]);
        setSelectedId(null);
      })
    ];

    return () => {
      unsubs.forEach(unsub => unsub && unsub());
    };
  }, [isOpen]);

  // Select first item if current selection disappears
  useEffect(() => {
    if (entries.length > 0 && (!selectedId || !entries.some(e => e.id === selectedId))) {
      setSelectedId(entries[0].id);
    }
  }, [entries, selectedId]);

  // Filtered entries
  const filteredEntries = useMemo(() => {
    return entries.filter(entry => {
      // 1. Search Query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const inUrl = entry.url.toLowerCase().includes(q);
        const inMethod = entry.method.toLowerCase().includes(q);
        const inEndpoint = entry.endpoint.toLowerCase().includes(q);
        const inBody =
          typeof entry.responseBody === 'string'
            ? entry.responseBody.toLowerCase().includes(q)
            : JSON.stringify(entry.responseBody || '').toLowerCase().includes(q);
        const inReqBody =
          typeof entry.requestBody === 'string'
            ? entry.requestBody.toLowerCase().includes(q)
            : JSON.stringify(entry.requestBody || '').toLowerCase().includes(q);

        if (!inUrl && !inMethod && !inEndpoint && !inBody && !inReqBody) {
          return false;
        }
      }

      // 2. Status filter
      if (statusFilter === 'ERRORS') {
        const isErr =
          entry.isError ||
          (typeof entry.status === 'number' && entry.status >= 400) ||
          entry.status === 'FAILED' ||
          entry.status === 'TIMEOUT';
        if (!isErr) return false;
      } else if (statusFilter === '2XX') {
        if (typeof entry.status !== 'number' || entry.status < 200 || entry.status >= 300) return false;
      } else if (statusFilter === '4XX') {
        if (typeof entry.status !== 'number' || entry.status < 400 || entry.status >= 500) return false;
      } else if (statusFilter === '5XX') {
        if (typeof entry.status !== 'number' || entry.status < 500) return false;
      } else if (statusFilter === 'SLOW') {
        if (!entry.durationMs || entry.durationMs < 1000) return false;
      }

      // 3. Module filter
      if (moduleFilter !== 'ALL' && entry.module !== moduleFilter) {
        return false;
      }

      return true;
    });
  }, [entries, searchQuery, statusFilter, moduleFilter]);

  const selectedEntry = useMemo(() => {
    return entries.find(e => e.id === selectedId) || filteredEntries[0] || null;
  }, [entries, selectedId, filteredEntries]);

  // Copy helper
  const handleCopy = (text: string, label: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedState(label);
    setTimeout(() => setCopiedState(null), 2000);
  };

  const handleClear = async () => {
    if (window.taxPortalAPI?.inspectorClear) {
      await window.taxPortalAPI.inspectorClear();
    }
    setEntries([]);
    setSelectedId(null);
  };

  const handleExport = async () => {
    if (window.taxPortalAPI?.inspectorExport) {
      const jsonStr = await window.taxPortalAPI.inspectorExport();
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `taxinsight_api_traffic_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  if (!isOpen) return null;

  const totalErrors = entries.filter(
    e => e.isError || (typeof e.status === 'number' && e.status >= 400) || e.status === 'FAILED'
  ).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-2 sm:p-4 animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl w-full h-[92vh] max-w-[96vw] flex flex-col overflow-hidden text-slate-200">
        {/* ── 1. Top Header Bar ──────────────────────────────────────── */}
        <header className="h-14 bg-slate-950/90 border-b border-slate-800 px-4 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-teal-500/20 border border-teal-500/40 flex items-center justify-center text-teal-400">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="font-bold text-sm text-white tracking-tight">API Inspector</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-purple-950 text-purple-300 border border-purple-800/80">
                  ĐÃ ẨN DỮ LIỆU NHẠY CẢM
                </span>
                {isLiveStreaming && (
                  <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-800/80 animate-pulse">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span>LIVE</span>
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400">
                Tổng: <strong className="text-white">{entries.length}</strong> calls
                {totalErrors > 0 && (
                  <span className="ml-2 text-red-400 font-semibold">
                    • {totalErrors} lỗi phát hiện
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Quick Actions & Close */}
          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => setIsLiveStreaming(!isLiveStreaming)}
              className={`h-8 px-2.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 border transition-all cursor-pointer ${
                isLiveStreaming
                  ? 'bg-emerald-950/70 border-emerald-700/80 text-emerald-300 hover:bg-emerald-900'
                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
              title="Tự động cập nhật request mới theo thời gian thực"
            >
              {isLiveStreaming ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
              <span className="hidden md:inline">{isLiveStreaming ? 'Live On' : 'Live Tạm dừng'}</span>
            </button>

            <button
              type="button"
              onClick={handleExport}
              disabled={entries.length === 0}
              className="h-8 px-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 rounded-lg text-xs font-medium border border-slate-700/80 flex items-center space-x-1.5 transition-colors cursor-pointer"
              title="Xuất toàn bộ lịch sử API traffic ra file JSON"
            >
              <Download className="w-3.5 h-3.5 text-teal-400" />
              <span className="hidden sm:inline">Xuất JSON</span>
            </button>

            <button
              type="button"
              onClick={handleClear}
              disabled={entries.length === 0}
              className="h-8 px-2.5 bg-slate-800 hover:bg-red-950/60 disabled:opacity-40 text-slate-300 hover:text-red-300 rounded-lg text-xs font-medium border border-slate-700/80 hover:border-red-800 flex items-center space-x-1.5 transition-colors cursor-pointer"
              title="Xóa toàn bộ bộ đệm request hiện tại"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Xóa bộ đệm</span>
            </button>

            <div className="h-4 w-px bg-slate-800 mx-1" />

            <button
              type="button"
              onClick={onClose}
              className="h-8 w-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              title="Đóng Inspector (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* ── 2. Filter & Search Bar ─────────────────────────────────── */}
        <div className="p-2.5 bg-slate-950/60 border-b border-slate-800 flex flex-wrap items-center gap-2 text-xs shrink-0">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Tìm kiếm theo URL, Method, Headers, Body hoặc Mã lỗi..."
              className="w-full pl-9 pr-8 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-teal-500"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2 text-slate-500 hover:text-slate-300"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Status Filters */}
          <div className="flex items-center bg-slate-900 border border-slate-700/80 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setStatusFilter('ALL')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                statusFilter === 'ALL' ? 'bg-teal-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Tất cả ({entries.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('ERRORS')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                statusFilter === 'ERRORS' ? 'bg-red-600 text-white' : 'text-red-400 hover:text-red-300'
              }`}
            >
              Lỗi ({totalErrors})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('2XX')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                statusFilter === '2XX' ? 'bg-emerald-600 text-white' : 'text-emerald-400 hover:text-emerald-300'
              }`}
            >
              2xx
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('4XX')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                statusFilter === '4XX' ? 'bg-amber-600 text-white' : 'text-amber-400 hover:text-amber-300'
              }`}
            >
              4xx
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('5XX')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                statusFilter === '5XX' ? 'bg-purple-600 text-white' : 'text-purple-400 hover:text-purple-300'
              }`}
            >
              5xx
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('SLOW')}
              className={`px-2.5 py-1 rounded-md font-medium transition-all ${
                statusFilter === 'SLOW' ? 'bg-orange-600 text-white' : 'text-orange-400 hover:text-orange-300'
              }`}
            >
              Chậm &gt;1s
            </button>
          </div>

          {/* Module Selector */}
          <div className="flex items-center space-x-1.5">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={moduleFilter}
              onChange={e => setModuleFilter(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-teal-500 cursor-pointer"
            >
              <option value="ALL">Tất cả Modules</option>
              <option value="AUTH">AUTH (Đăng nhập / Captcha)</option>
              <option value="SCAN">SCAN (Tra cứu Tờ khai)</option>
              <option value="DOWNLOAD">DOWNLOAD (Tải file ZIP/PDF)</option>
              <option value="ETAX_GNT">ETAX_GNT (Giấy Nộp Tiền eTax)</option>
              <option value="VAT">VAT (Phân tích GTGT)</option>
              <option value="PIT">PIT (Phân tích TNCN)</option>
              <option value="SYSTEM">SYSTEM (Hệ thống)</option>
            </select>
          </div>
        </div>

        {/* ── 3. Split View Content ──────────────────────────────────── */}
        <div className="flex-1 flex min-h-0 divide-x divide-slate-800 overflow-hidden">
          {/* Left Panel: Request List */}
          <div
            ref={listContainerRef}
            className="w-2/5 min-w-[340px] max-w-[480px] flex flex-col bg-slate-950/40 overflow-y-auto divide-y divide-slate-800/80"
          >
            {filteredEntries.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500">
                <Code2 className="w-10 h-10 text-slate-600 mb-2 stroke-1" />
                <p className="text-xs font-semibold text-slate-400">Không tìm thấy yêu cầu API nào</p>
                <p className="text-[11px] text-slate-500 mt-1 max-w-xs">
                  Thực hiện các thao tác trên app (Đăng nhập, Quét hồ sơ, Tải file...) để bắt lưu lượng HTTP.
                </p>
              </div>
            ) : (
              filteredEntries.map(entry => {
                const isSelected = entry.id === selectedEntry?.id;
                const isPending = entry.status === 'PENDING';
                const isError =
                  entry.isError ||
                  (typeof entry.status === 'number' && entry.status >= 400) ||
                  entry.status === 'FAILED';

                // Status Badge Colors
                let statusBadge = 'bg-slate-800 text-slate-400 border-slate-700';
                if (typeof entry.status === 'number') {
                  if (entry.status >= 200 && entry.status < 300) {
                    statusBadge = 'bg-emerald-950/80 text-emerald-400 border-emerald-800/80';
                  } else if (entry.status >= 300 && entry.status < 400) {
                    statusBadge = 'bg-blue-950/80 text-blue-400 border-blue-800/80';
                  } else if (entry.status === 403 || entry.status === 429) {
                    statusBadge = 'bg-amber-950/90 text-amber-300 border-amber-800/80';
                  } else if (entry.status >= 400) {
                    statusBadge = 'bg-red-950/90 text-red-400 border-red-800/80';
                  }
                } else if (isPending) {
                  statusBadge = 'bg-blue-950/90 text-blue-300 border-blue-700 animate-pulse';
                } else if (entry.status === 'FAILED') {
                  statusBadge = 'bg-red-950/90 text-red-400 border-red-800';
                }

                // Method Colors
                const isPost = entry.method === 'POST';
                const methodBadge = isPost
                  ? 'bg-purple-950/80 text-purple-300 border-purple-800/80'
                  : 'bg-sky-950/80 text-sky-300 border-sky-800/80';

                return (
                  <div
                    key={entry.id}
                    onClick={() => setSelectedId(entry.id)}
                    className={`p-3 flex flex-col space-y-1.5 transition-all cursor-pointer border-l-2 ${
                      isSelected
                        ? 'bg-slate-800/90 border-l-teal-400 shadow-inner'
                        : isError
                        ? 'hover:bg-red-950/20 border-l-red-500/40'
                        : 'hover:bg-slate-850 border-l-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border ${methodBadge}`}>
                          {entry.method}
                        </span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border ${statusBadge}`}>
                          {isPending ? 'PENDING...' : entry.status}
                        </span>
                        <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-slate-900 text-slate-400 border border-slate-800">
                          {entry.module}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-400 flex items-center space-x-1">
                        <Clock className="w-2.5 h-2.5" />
                        <span>{entry.timeFormatted}</span>
                      </span>
                    </div>

                    <div className="font-mono text-xs text-slate-200 font-semibold truncate" title={entry.url}>
                      {entry.endpoint}
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400 pt-0.5">
                      <span className="font-mono">
                        {entry.durationMs !== undefined ? `${entry.durationMs}ms` : '—'}
                      </span>
                      {entry.responseSize ? (
                        <span className="font-mono text-[10.5px]">
                          {entry.responseSize > 1024
                            ? `${(entry.responseSize / 1024).toFixed(1)} KB`
                            : `${entry.responseSize} B`}
                        </span>
                      ) : null}
                    </div>

                    {entry.diagnosticHint && (
                      <div className="text-[10px] text-amber-300 font-medium line-clamp-1 bg-amber-950/40 px-1.5 py-0.5 rounded border border-amber-800/40">
                        {entry.diagnosticHint}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Right Panel: Detail Inspection */}
          <div className="flex-1 flex flex-col bg-slate-900 overflow-hidden">
            {selectedEntry ? (
              <>
                {/* Detail Header */}
                <div className="p-4 bg-slate-950/70 border-b border-slate-800 flex flex-col space-y-3 shrink-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-teal-950 text-teal-300 border border-teal-700">
                          {selectedEntry.method}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-xs font-mono font-bold border ${
                            selectedEntry.status === 200
                              ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                              : selectedEntry.status === 'PENDING'
                              ? 'bg-blue-950 text-blue-300 border-blue-700 animate-pulse'
                              : 'bg-red-950 text-red-300 border-red-700'
                          }`}
                        >
                          Status: {selectedEntry.status} {selectedEntry.statusText || ''}
                        </span>
                        <span className="text-xs font-mono text-slate-400">
                          • {selectedEntry.durationMs !== undefined ? `${selectedEntry.durationMs} ms` : 'Đang xử lý...'}
                        </span>
                        <span className="text-xs text-slate-500 font-mono">
                          • {selectedEntry.timeFormatted}
                        </span>
                      </div>
                      <div className="font-mono text-xs text-white break-all select-all bg-slate-950 p-2 rounded-lg border border-slate-800">
                        {selectedEntry.url}
                      </div>
                    </div>

                    {/* Copy Buttons */}
                    <div className="flex items-center space-x-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleCopy(selectedEntry.curl, 'curl')}
                        className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold flex items-center space-x-1.5 border border-slate-700 transition-colors cursor-pointer"
                        title="Sao chép lệnh cURL để chạy thử trên Terminal/Postman"
                      >
                        <Terminal className="w-3.5 h-3.5 text-teal-400" />
                        <span>{copiedState === 'curl' ? 'Đã copy cURL!' : 'Copy cURL'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Tab Navigation */}
                  <div className="flex items-center space-x-1 border-b border-slate-800 text-xs">
                    <button
                      type="button"
                      onClick={() => setActiveTab('OVERVIEW')}
                      className={`px-3.5 py-2 font-semibold border-b-2 transition-all flex items-center space-x-1.5 cursor-pointer ${
                        activeTab === 'OVERVIEW'
                          ? 'border-teal-400 text-teal-300 bg-slate-850'
                          : 'border-transparent text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>Tổng quan</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab('REQUEST')}
                      className={`px-3.5 py-2 font-semibold border-b-2 transition-all flex items-center space-x-1.5 cursor-pointer ${
                        activeTab === 'REQUEST'
                          ? 'border-teal-400 text-teal-300 bg-slate-850'
                          : 'border-transparent text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <ArrowUpCircle className="w-3.5 h-3.5" />
                      <span>Yêu cầu (Request)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab('RESPONSE')}
                      className={`px-3.5 py-2 font-semibold border-b-2 transition-all flex items-center space-x-1.5 cursor-pointer ${
                        activeTab === 'RESPONSE'
                          ? 'border-teal-400 text-teal-300 bg-slate-850'
                          : 'border-transparent text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <ArrowDownCircle className="w-3.5 h-3.5" />
                      <span>Phản hồi (Response)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab('TROUBLESHOOTING')}
                      className={`px-3.5 py-2 font-semibold border-b-2 transition-all flex items-center space-x-1.5 cursor-pointer ${
                        activeTab === 'TROUBLESHOOTING'
                          ? 'border-amber-400 text-amber-300 bg-amber-950/30'
                          : selectedEntry.diagnosticHint
                          ? 'border-transparent text-amber-400 hover:text-amber-300'
                          : 'border-transparent text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>Chẩn đoán &amp; Sửa lỗi {selectedEntry.diagnosticHint ? '⚠️' : ''}</span>
                    </button>
                  </div>
                </div>

                {/* Detail Tab Contents */}
                <div className="flex-1 p-4 overflow-y-auto space-y-4">
                  {/* TAB 1: OVERVIEW */}
                  {activeTab === 'OVERVIEW' && (
                    <div className="space-y-4">
                      {/* Diagnostic Alert if available */}
                      {selectedEntry.diagnosticHint && (
                        <div className="p-3.5 rounded-xl bg-amber-950/60 border border-amber-600/80 text-amber-200 text-xs space-y-2">
                          <div className="flex items-center space-x-2 font-bold text-amber-300">
                            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
                            <span>GỢI Ý CHẨN ĐOÁN LỖI TỰ ĐỘNG</span>
                          </div>
                          <p className="leading-relaxed font-sans">{selectedEntry.diagnosticHint}</p>
                          <div className="pt-1">
                            <button
                              type="button"
                              onClick={() => setActiveTab('TROUBLESHOOTING')}
                              className="text-xs text-amber-400 hover:underline font-semibold flex items-center space-x-1"
                            >
                              <span>Xem hướng dẫn xử lý chi tiết →</span>
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Error details if failed */}
                      {selectedEntry.errorDetail && (
                        <div className="p-3.5 rounded-xl bg-red-950/60 border border-red-800 text-red-200 text-xs space-y-1.5">
                          <div className="font-bold text-red-300 flex items-center space-x-2">
                            <AlertCircle className="w-4 h-4" />
                            <span>Lỗi Ngoại Lệ (Exception Detail)</span>
                          </div>
                          <div className="font-mono text-xs">{selectedEntry.errorDetail.message}</div>
                          {selectedEntry.errorDetail.code && (
                            <div className="text-[11px] text-red-400 font-mono">
                              Error Code: {selectedEntry.errorDetail.code}
                            </div>
                          )}
                          {selectedEntry.errorDetail.stack && (
                            <pre className="p-2 bg-slate-950 rounded-lg text-[10.5px] font-mono text-red-300/80 overflow-x-auto whitespace-pre-wrap max-h-40">
                              {selectedEntry.errorDetail.stack}
                            </pre>
                          )}
                        </div>
                      )}

                      {/* Key Value Overview Table */}
                      <div className="border border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-800 text-xs font-mono">
                        <div className="p-2.5 bg-slate-950/60 font-sans font-bold text-slate-400 uppercase tracking-wider text-[11px]">
                          Thông Số Request
                        </div>
                        <div className="grid grid-cols-3 p-2.5 bg-slate-900/60">
                          <span className="text-slate-400 font-sans">Module:</span>
                          <span className="col-span-2 text-teal-300 font-bold">{selectedEntry.module}</span>
                        </div>
                        <div className="grid grid-cols-3 p-2.5">
                          <span className="text-slate-400 font-sans">HTTP Method:</span>
                          <span className="col-span-2 text-white">{selectedEntry.method}</span>
                        </div>
                        <div className="grid grid-cols-3 p-2.5 bg-slate-900/60">
                          <span className="text-slate-400 font-sans">Mã Phản Hồi (Status):</span>
                          <span className="col-span-2 text-white font-bold">{selectedEntry.status}</span>
                        </div>
                        <div className="grid grid-cols-3 p-2.5">
                          <span className="text-slate-400 font-sans">Thời Gian Xử Lý (Latency):</span>
                          <span className="col-span-2 text-teal-400 font-bold">{selectedEntry.durationMs ?? '—'} ms</span>
                        </div>
                        <div className="grid grid-cols-3 p-2.5 bg-slate-900/60">
                          <span className="text-slate-400 font-sans">Kích Thước Phản Hồi:</span>
                          <span className="col-span-2 text-white">
                            {selectedEntry.responseSize ? `${selectedEntry.responseSize} bytes` : '0 bytes'}
                          </span>
                        </div>
                        <div className="grid grid-cols-3 p-2.5">
                          <span className="text-slate-400 font-sans">Content-Type Phản Hồi:</span>
                          <span className="col-span-2 text-slate-300">{selectedEntry.responseContentType || '—'}</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* TAB 2: REQUEST */}
                  {activeTab === 'REQUEST' && (
                    <div className="space-y-4">
                      {/* Request Parameters */}
                      {selectedEntry.requestParams && Object.keys(selectedEntry.requestParams).length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                              Query Parameters (URL Params)
                            </h4>
                          </div>
                          <div className="border border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-800 font-mono text-xs">
                            {typeof selectedEntry.requestParams === 'object' ? (
                              Object.entries(selectedEntry.requestParams).map(([k, v]) => (
                                <div key={k} className="p-2 grid grid-cols-3 hover:bg-slate-850">
                                  <span className="text-teal-400 font-semibold">{k}</span>
                                  <span className="col-span-2 text-slate-200 break-all">{String(v)}</span>
                                </div>
                              ))
                            ) : (
                              <pre className="p-2 text-slate-200">{String(selectedEntry.requestParams)}</pre>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Request Headers */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Request Headers</h4>
                          <button
                            type="button"
                            onClick={() => handleCopy(JSON.stringify(selectedEntry.requestHeaders, null, 2), 'reqHeaders')}
                            className="text-[11px] text-teal-400 hover:underline flex items-center space-x-1"
                          >
                            <Copy className="w-3 h-3" />
                            <span>{copiedState === 'reqHeaders' ? 'Đã copy!' : 'Copy Headers'}</span>
                          </button>
                        </div>
                        <div className="border border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-800 font-mono text-xs max-h-56 overflow-y-auto">
                          {Object.entries(selectedEntry.requestHeaders).map(([k, v]) => (
                            <div key={k} className="p-2 grid grid-cols-3 hover:bg-slate-850">
                              <span className="text-slate-400 font-semibold">{k}</span>
                              <span className="col-span-2 text-slate-200 break-all">{String(v)}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Request Body */}
                      {selectedEntry.requestBody && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                              Request Body / Payload (Mật khẩu đã che)
                            </h4>
                            <button
                              type="button"
                              onClick={() =>
                                handleCopy(
                                  typeof selectedEntry.requestBody === 'string'
                                    ? selectedEntry.requestBody
                                    : JSON.stringify(selectedEntry.requestBody, null, 2),
                                  'reqBody'
                                )
                              }
                              className="text-[11px] text-teal-400 hover:underline flex items-center space-x-1"
                            >
                              <Copy className="w-3 h-3" />
                              <span>{copiedState === 'reqBody' ? 'Đã copy!' : 'Copy Payload'}</span>
                            </button>
                          </div>
                          <pre className="p-3 bg-slate-950 border border-slate-800 rounded-xl font-mono text-xs text-teal-300 overflow-x-auto whitespace-pre-wrap">
                            {typeof selectedEntry.requestBody === 'object'
                              ? JSON.stringify(selectedEntry.requestBody, null, 2)
                              : String(selectedEntry.requestBody)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 3: RESPONSE */}
                  {activeTab === 'RESPONSE' && (
                    <div className="space-y-4">
                      {/* Response Headers */}
                      {selectedEntry.responseHeaders && Object.keys(selectedEntry.responseHeaders).length > 0 && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                              Response Headers
                            </h4>
                            <button
                              type="button"
                              onClick={() => handleCopy(JSON.stringify(selectedEntry.responseHeaders, null, 2), 'resHeaders')}
                              className="text-[11px] text-teal-400 hover:underline flex items-center space-x-1"
                            >
                              <Copy className="w-3 h-3" />
                              <span>{copiedState === 'resHeaders' ? 'Đã copy!' : 'Copy Headers'}</span>
                            </button>
                          </div>
                          <div className="border border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-800 font-mono text-xs max-h-48 overflow-y-auto">
                            {Object.entries(selectedEntry.responseHeaders).map(([k, v]) => (
                              <div key={k} className="p-2 grid grid-cols-3 hover:bg-slate-850">
                                <span className="text-slate-400 font-semibold">{k}</span>
                                <span className="col-span-2 text-slate-200 break-all">{String(v)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Response Body */}
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                              Response Body
                            </h4>
                            <span className="text-[11px] text-slate-500 font-mono">
                              ({selectedEntry.responseContentType || 'text/plain'})
                            </span>
                          </div>

                          <div className="flex items-center space-x-2">
                            <button
                              type="button"
                              onClick={() =>
                                handleCopy(
                                  typeof selectedEntry.responseBody === 'string'
                                    ? selectedEntry.responseBody
                                    : JSON.stringify(selectedEntry.responseBody, null, 2),
                                  'resBody'
                                )
                              }
                              className="text-[11px] text-teal-400 hover:underline flex items-center space-x-1"
                            >
                              <Copy className="w-3 h-3" />
                              <span>{copiedState === 'resBody' ? 'Đã copy!' : 'Copy Body'}</span>
                            </button>
                          </div>
                        </div>

                        <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl max-h-[460px] overflow-auto">
                          {selectedEntry.responseBody === undefined || selectedEntry.responseBody === null ? (
                            <div className="text-slate-500 text-xs font-mono">Phản hồi rỗng hoặc chưa có kết quả.</div>
                          ) : typeof selectedEntry.responseBody === 'object' ? (
                            <pre className="font-mono text-xs text-emerald-300 whitespace-pre-wrap select-text">
                              {JSON.stringify(selectedEntry.responseBody, null, 2)}
                            </pre>
                          ) : (
                            <pre className="font-mono text-xs text-slate-200 whitespace-pre-wrap select-text">
                              {String(selectedEntry.responseBody)}
                            </pre>
                          )}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* TAB 4: TROUBLESHOOTING & FIX GUIDE */}
                  {activeTab === 'TROUBLESHOOTING' && (
                    <div className="space-y-4">
                      {/* Diagnostic Alert Box */}
                      <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                        <div className="flex items-center space-x-2 font-bold text-sm text-teal-300">
                          <CheckCircle2 className="w-4 h-4 text-teal-400" />
                          <span>Hướng Dẫn Khắc Phục Các Lỗi API Thường Gặp</span>
                        </div>

                        {selectedEntry.diagnosticHint ? (
                          <div className="p-3 rounded-lg bg-amber-950/70 border border-amber-600 text-amber-200 text-xs space-y-1.5">
                            <div className="font-bold text-amber-300 flex items-center space-x-1.5">
                              <AlertTriangle className="w-4 h-4 shrink-0" />
                              <span>Chẩn đoán cho request này:</span>
                            </div>
                            <p className="leading-relaxed font-sans">{selectedEntry.diagnosticHint}</p>
                          </div>
                        ) : (
                          <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-800 text-emerald-300 text-xs">
                            ✓ Request này đã hoàn thành thành công hoặc không phát hiện lỗi bất thường.
                          </div>
                        )}
                      </div>

                      {/* Common GDT Error Playbook */}
                      <div className="space-y-3">
                        <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                          Sổ Tay Xử Lý Lỗi Cổng Dịch Vụ Công &amp; eTax
                        </h4>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                          {/* Card 1 */}
                          <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1.5">
                            <div className="font-bold text-amber-400 flex items-center space-x-1.5">
                              <span>1. Lỗi HTTP 403 Forbidden / CSRF Mismatch</span>
                            </div>
                            <p className="text-slate-400 leading-relaxed text-[11.5px]">
                              Xảy ra khi Spring Framework từ chối CSRF Token. Cookie XSRF-TOKEN bị encode <code className="text-teal-300">%2B</code> thay vì <code className="text-teal-300">+</code>. Cần <code className="text-teal-300">decodeURIComponent</code> trước khi gán header <code className="text-teal-300">X-XSRF-TOKEN</code>.
                            </p>
                          </div>

                          {/* Card 2 */}
                          <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1.5">
                            <div className="font-bold text-orange-400 flex items-center space-x-1.5">
                              <span>2. Lỗi HTTP 429 Too Many Requests</span>
                            </div>
                            <p className="text-slate-400 leading-relaxed text-[11.5px]">
                              Cổng Thuế chặn tạm thời IP do gửi request dồn dập trong thời gian ngắn (&gt; 5 req/s). Khắc phục: Sử dụng Download Queue có độ trễ và áp dụng Exponential Backoff tự động.
                            </p>
                          </div>

                          {/* Card 3 */}
                          <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1.5">
                            <div className="font-bold text-red-400 flex items-center space-x-1.5">
                              <span>3. Lỗi NullPointerException trên eTax (GNT)</span>
                            </div>
                            <p className="text-slate-400 leading-relaxed text-[11.5px]">
                              Do <code className="text-teal-300">dse_sessionId</code> hoặc <code className="text-teal-300">dse_processorId</code> bị mất đồng bộ khi chuyển module. Khắc phục: Gọi lại <code className="text-teal-300">module=330410</code> để mở phiên tra cứu mới hoặc dùng nút "Mở eTax để xác thực".
                            </p>
                          </div>

                          {/* Card 4 */}
                          <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-1.5">
                            <div className="font-bold text-sky-400 flex items-center space-x-1.5">
                              <span>4. Lỗi Base64 Rỗng khi Tải Tờ Khai</span>
                            </div>
                            <p className="text-slate-400 leading-relaxed text-[11.5px]">
                              Do tờ khai nằm ở phân hệ Thuế Điện Tử (cần gọi <code className="text-teal-300">/downloadhoso-tdt</code>) hoặc mã hồ sơ có dạng tham chiếu dài. TaxInsight có cơ chế Adaptive Dual Routing để tự động fallback.
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500">
                <Layers className="w-12 h-12 text-slate-600 mb-2 stroke-1" />
                <p className="text-xs font-semibold text-slate-400">Chọn một request từ danh sách bên trái để xem chi tiết</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

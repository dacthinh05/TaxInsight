import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Layers,
  Search,
  Sparkles,
  X
} from 'lucide-react';

export interface YearRangeSelection {
  isMultiYear: boolean;
  startYear: number;
  endYear: number;
  selectedYears?: number[];
  label: string;
}

interface YearSelectorProps {
  selectedYear: number;
  onYearChange: (year: number) => void;
  availableYears?: number[];
  disabled?: boolean;
  // Hỗ trợ chọn nhiều năm
  isMultiYearSupported?: boolean;
  scanRangeMode?: string;
  onRangeModeChange?: (mode: string) => void;
  className?: string;
  size?: 'sm' | 'md';
}

export const YearSelector: React.FC<YearSelectorProps> = ({
  selectedYear,
  onYearChange,
  availableYears = [],
  disabled = false,
  isMultiYearSupported = false,
  scanRangeMode = 'YEAR_TO_DATE',
  onRangeModeChange,
  className = '',
  size = 'md'
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'SINGLE' | 'MULTI'>('SINGLE');
  const [searchYear, setSearchYear] = useState('');
  
  const currentYear = new Date().getFullYear();
  const [rangeFromYear, setRangeFromYear] = useState<number>(() => selectedYear - 2);
  const [rangeToYear, setRangeToYear] = useState<number>(() => selectedYear);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Đóng dropdown khi click ra ngoài
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Đồng bộ tab khi scanRangeMode thay đổi
  useEffect(() => {
    if (scanRangeMode.startsWith('MULTI')) {
      setActiveTab('MULTI');
    } else {
      setActiveTab('SINGLE');
    }
  }, [scanRangeMode]);

  // Tạo danh sách năm (từ currentYear + 1 lùi về 2010)
  const fullYearList = useMemo(() => {
    const years: number[] = [];
    for (let y = currentYear + 1; y >= 2010; y--) {
      years.push(y);
    }
    return years;
  }, [currentYear]);

  // Các năm ưu tiên / phổ biến
  const topYears = useMemo(() => {
    const set = new Set<number>([
      currentYear,
      currentYear - 1,
      currentYear - 2,
      currentYear - 3,
      currentYear - 4,
      ...availableYears
    ]);
    return Array.from(set).sort((a, b) => b - a);
  }, [currentYear, availableYears]);

  // Lọc năm theo từ khóa tìm kiếm
  const filteredYears = useMemo(() => {
    if (!searchYear.trim()) return fullYearList;
    const q = searchYear.trim();
    return fullYearList.filter(y => String(y).includes(q));
  }, [fullYearList, searchYear]);

  // Xử lý chọn 1 năm
  const handleSelectSingleYear = (year: number) => {
    onYearChange(year);
    if (onRangeModeChange && scanRangeMode.startsWith('MULTI')) {
      onRangeModeChange(year === currentYear ? 'YEAR_TO_DATE' : 'FULL_YEAR');
    }
    setIsOpen(false);
    setSearchYear('');
  };

  // Xử lý gõ năm tự do và bấm Enter
  const handleCustomYearSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseInt(searchYear.trim(), 10);
    if (!isNaN(num) && num >= 1990 && num <= 2099) {
      handleSelectSingleYear(num);
    }
  };

  // Xử lý chọn Preset nhiều năm
  const handleSelectMultiPreset = (presetMode: 'MULTI_3_YEARS' | 'MULTI_5_YEARS') => {
    if (onRangeModeChange) {
      onRangeModeChange(presetMode);
      onYearChange(currentYear);
    }
    setIsOpen(false);
  };

  // Xử lý áp dụng khoảng năm tùy chọn (Từ năm -> Đến năm)
  const handleApplyCustomRange = () => {
    const minYear = Math.min(rangeFromYear, rangeToYear);
    const maxYear = Math.max(rangeFromYear, rangeToYear);
    const customMode = `MULTI_RANGE:${minYear}:${maxYear}`;
    
    if (onRangeModeChange) {
      onRangeModeChange(customMode);
      onYearChange(maxYear);
    }
    setIsOpen(false);
  };

  // Nhãn hiển thị trên trigger button
  const displayLabel = useMemo(() => {
    if (isMultiYearSupported && scanRangeMode.startsWith('MULTI')) {
      if (scanRangeMode === 'MULTI_3_YEARS') {
        return `3 năm (${currentYear - 2} – ${currentYear})`;
      }
      if (scanRangeMode === 'MULTI_5_YEARS') {
        return `5 năm (${currentYear - 4} – ${currentYear})`;
      }
      const rangeMatch = scanRangeMode.match(/^MULTI_RANGE:(\d{4}):(\d{4})$/);
      if (rangeMatch) {
        return `${rangeMatch[1]} – ${rangeMatch[2]}`;
      }
      return 'Nhiều năm';
    }
    return `Năm ${selectedYear}`;
  }, [isMultiYearSupported, scanRangeMode, selectedYear, currentYear]);

  const isMultiActive = isMultiYearSupported && scanRangeMode.startsWith('MULTI');

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      {/* ─── TRIGGER BUTTON ─────────────────────────────────────────── */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          if (!disabled) {
            setIsOpen(!isOpen);
            setTimeout(() => inputRef.current?.focus(), 50);
          }
        }}
        className={`flex items-center space-x-1.5 rounded-lg border font-mono font-bold transition-all cursor-pointer shadow-2xs ${
          size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-2.5 text-xs'
        } ${
          isMultiActive
            ? 'bg-teal-50 border-teal-300 text-teal-900 hover:bg-teal-100/80 ring-1 ring-teal-400/50'
            : 'bg-slate-50 border-slate-300 text-slate-800 hover:bg-white hover:border-slate-400 focus:bg-white'
        } disabled:opacity-50 disabled:cursor-not-allowed`}
        title="Bấm để chọn năm, nhập năm hoặc chọn khoảng nhiều năm"
      >
        <Calendar className={`w-3.5 h-3.5 shrink-0 ${isMultiActive ? 'text-teal-700' : 'text-slate-500'}`} />
        <span className="truncate">{displayLabel}</span>
        <ChevronDown className={`w-3.5 h-3.5 shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180 text-teal-700' : ''}`} />
      </button>

      {/* ─── DROPDOWN POPUP ──────────────────────────────────────────── */}
      {isOpen && (
        <div className="absolute left-0 top-9.5 z-50 w-72 bg-white rounded-2xl shadow-2xl border border-slate-200 p-3 animate-fadeIn select-none">
          {/* Header Switcher Tabs (nếu hỗ trợ nhiều năm) */}
          {isMultiYearSupported ? (
            <div className="flex items-center bg-slate-100 p-0.5 rounded-xl mb-3">
              <button
                type="button"
                onClick={() => setActiveTab('SINGLE')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center justify-center space-x-1.5 ${
                  activeTab === 'SINGLE'
                    ? 'bg-white text-teal-900 shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                <span>Một năm</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('MULTI')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center justify-center space-x-1.5 ${
                  activeTab === 'MULTI'
                    ? 'bg-teal-700 text-white shadow-2xs'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Nhiều năm</span>
              </button>
            </div>
          ) : (
            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2 px-1 flex items-center justify-between">
              <span>CHỌN NĂM TRA CỨU</span>
              <span className="font-mono text-teal-700">{selectedYear}</span>
            </div>
          )}

          {/* ─── TAB 1: CHỌN MỘT NĂM HOẶC NHẬP NĂM TÙY Ý ─────────────── */}
          {activeTab === 'SINGLE' && (
            <div className="space-y-3">
              {/* Ô Nhập năm trực tiếp */}
              <form onSubmit={handleCustomYearSubmit} className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Gõ năm (VD: 2024, 2020...)"
                  value={searchYear}
                  onChange={e => setSearchYear(e.target.value)}
                  className="w-full pl-8 pr-12 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:bg-white transition-all"
                />
                {searchYear ? (
                  <button
                    type="submit"
                    className="absolute right-1 top-1/2 -translate-y-1/2 px-2 py-0.5 bg-teal-700 hover:bg-teal-800 text-white rounded text-[10.5px] font-bold transition-colors cursor-pointer"
                  >
                    Chọn
                  </button>
                ) : (
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 font-mono">
                    YYYY
                  </span>
                )}
              </form>

              {/* Quick Pills (Các năm gần nhất) */}
              <div>
                <div className="text-[10.5px] font-semibold text-slate-400 mb-1.5 px-0.5">
                  NĂM PHỔ BIẾN
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {topYears.slice(0, 8).map(y => {
                    const isSelected = y === selectedYear && !isMultiActive;
                    return (
                      <button
                        key={y}
                        type="button"
                        onClick={() => handleSelectSingleYear(y)}
                        className={`py-1.5 rounded-lg font-mono text-xs font-bold transition-all cursor-pointer flex items-center justify-center ${
                          isSelected
                            ? 'bg-teal-700 text-white shadow-xs'
                            : 'bg-slate-50 hover:bg-teal-50 text-slate-700 hover:text-teal-900 border border-slate-200 hover:border-teal-300'
                        }`}
                      >
                        {y}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Danh sách cuộn toàn bộ các năm */}
              <div>
                <div className="text-[10.5px] font-semibold text-slate-400 mb-1 px-0.5 flex justify-between">
                  <span>TẤT CẢ CÁC NĂM</span>
                  <span>{filteredYears.length} năm</span>
                </div>
                <div className="max-h-36 overflow-y-auto pr-1 space-y-1 divide-y divide-slate-100 rounded-lg border border-slate-100 bg-slate-50/50 p-1">
                  {filteredYears.map(y => {
                    const isSelected = y === selectedYear && !isMultiActive;
                    return (
                      <button
                        key={y}
                        type="button"
                        onClick={() => handleSelectSingleYear(y)}
                        className={`w-full px-2.5 py-1.5 rounded-md font-mono text-xs text-left transition-colors flex items-center justify-between cursor-pointer ${
                          isSelected
                            ? 'bg-teal-700 text-white font-bold'
                            : 'hover:bg-teal-50 text-slate-700 hover:text-teal-900'
                        }`}
                      >
                        <span>Năm {y}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-white" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ─── TAB 2: CHỌN NHIỀU NĂM / KHOẢNG NĂM ──────────────────── */}
          {activeTab === 'MULTI' && isMultiYearSupported && (
            <div className="space-y-3">
              {/* Presets Đa Năm */}
              <div>
                <div className="text-[10.5px] font-semibold text-slate-400 mb-1.5 px-0.5">
                  GỢI Ý QUYẾT TOÁN NHIỀU NĂM
                </div>
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => handleSelectMultiPreset('MULTI_3_YEARS')}
                    className={`w-full p-2 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between ${
                      scanRangeMode === 'MULTI_3_YEARS'
                        ? 'bg-teal-50 border-teal-400 text-teal-900 shadow-2xs font-bold'
                        : 'bg-slate-50 border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <Sparkles className="w-4 h-4 text-teal-600 shrink-0" />
                      <div>
                        <div className="text-xs font-bold">3 năm gần nhất</div>
                        <div className="text-[10.5px] text-slate-500 font-mono">
                          {currentYear - 2} – {currentYear}
                        </div>
                      </div>
                    </div>
                    {scanRangeMode === 'MULTI_3_YEARS' && <Check className="w-4 h-4 text-teal-700" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSelectMultiPreset('MULTI_5_YEARS')}
                    className={`w-full p-2 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between ${
                      scanRangeMode === 'MULTI_5_YEARS'
                        ? 'bg-teal-50 border-teal-400 text-teal-900 shadow-2xs font-bold'
                        : 'bg-slate-50 border-slate-200 hover:border-slate-300 text-slate-700'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      <Layers className="w-4 h-4 text-amber-600 shrink-0" />
                      <div>
                        <div className="text-xs font-bold">5 năm quyết toán</div>
                        <div className="text-[10.5px] text-slate-500 font-mono">
                          {currentYear - 4} – {currentYear}
                        </div>
                      </div>
                    </div>
                    {scanRangeMode === 'MULTI_5_YEARS' && <Check className="w-4 h-4 text-teal-700" />}
                  </button>
                </div>
              </div>

              {/* Tùy chọn khoảng năm tùy chỉnh */}
              <div className="pt-2 border-t border-slate-100">
                <div className="text-[10.5px] font-semibold text-slate-400 mb-2 px-0.5">
                  TÙY CHỈNH KHOẢNG NĂM
                </div>
                <div className="grid grid-cols-2 gap-2 mb-2.5">
                  <div>
                    <label className="text-[10px] text-slate-500 font-medium block mb-1">
                      Từ năm:
                    </label>
                    <select
                      value={rangeFromYear}
                      onChange={e => setRangeFromYear(Number(e.target.value))}
                      className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-600 cursor-pointer"
                    >
                      {fullYearList.map(y => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 font-medium block mb-1">
                      Đến năm:
                    </label>
                    <select
                      value={rangeToYear}
                      onChange={e => setRangeToYear(Number(e.target.value))}
                      className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-teal-600 cursor-pointer"
                    >
                      {fullYearList.map(y => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleApplyCustomRange}
                  className="w-full py-2 bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white font-bold rounded-xl text-xs transition-colors shadow-2xs flex items-center justify-center space-x-1.5 cursor-pointer"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Áp dụng ({Math.min(rangeFromYear, rangeToYear)} → {Math.max(rangeFromYear, rangeToYear)})</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import { Calendar, Download, FileSpreadsheet, Filter, MoreHorizontal, Search, TableProperties, X } from 'lucide-react';
import { FilterPopover, FilterState } from './FilterPopover';

interface SearchToolbarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  filters: FilterState;
  onFilterChange: (filters: FilterState) => void;
  availablePeriods: string[];
  availableStatuses: string[];
  onResetFilters: () => void;
  onExportExcel: () => void;
  onDownloadAll: () => void;
  onDownloadPeriod: (period: string) => void;
  periodCounts: Record<string, number>;
  totalFilingsCount: number;
  selectedCount?: number;
  filteredCount?: number;
  quickDownloadLabel?: string;
  onDownloadFiltered?: () => void;
  onDownloadSelected?: () => void;
  onDownloadCategory?: (taxType: string) => void;
  categoryCounts?: {
    VAT: number;
    PIT: number;
    CIT: number;
    FINALIZATION: number;
  };
  viewMode?: 'LIST' | 'BY_PERIOD';
  onToggleViewMode?: () => void;
  isVatTab?: boolean;
  onAnalyzeVat?: () => void;
  isVatAnalyzing?: boolean;
  onExportVatReference?: () => void;
  isPitTab?: boolean;
  onAnalyzePit?: () => void;
  isPitAnalyzing?: boolean;
  onExportPitReference?: () => void;
}

export const SearchToolbar: React.FC<SearchToolbarProps> = ({
  searchQuery,
  onSearchChange,
  filters,
  onFilterChange,
  availablePeriods,
  availableStatuses,
  onResetFilters,
  onExportExcel,
  onDownloadAll,
  onDownloadPeriod,
  periodCounts,
  totalFilingsCount,
  selectedCount = 0,
  filteredCount = 0,
  quickDownloadLabel,
  onDownloadFiltered,
  onDownloadSelected,
  onDownloadCategory,
  categoryCounts,
  viewMode = 'LIST',
  onToggleViewMode,
  isVatTab = false,
  onAnalyzeVat,
  isVatAnalyzing = false,
  onExportVatReference,
  isPitTab = false,
  onAnalyzePit,
  isPitAnalyzing = false,
  onExportPitReference
}) => {
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isExcelMenuOpen, setIsExcelMenuOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Lắng nghe Ctrl+K / Ctrl+F để focus nhanh vào ô tìm kiếm
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K' || e.key === 'f' || e.key === 'F')) {
        const tag = (document.activeElement?.tagName || '').toLowerCase();
        if (tag !== 'input' && tag !== 'textarea') {
          e.preventDefault();
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Tính số lượng bộ lọc phụ đang kích hoạt
  let activeFilterCount = 0;
  if (filters.period !== 'ALL') activeFilterCount++;
  if (filters.filingType !== 'ALL') activeFilterCount++;
  if (filters.portalStatus !== 'ALL') activeFilterCount++;
  if (filters.downloadStatus !== 'ALL') activeFilterCount++;

  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      {/* Search Box */}
      <div className="relative flex-1 max-w-md">
        <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5 pointer-events-none" />
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Tìm tên, mã, kỳ hoặc ID hồ sơ…"
          className="w-full h-9 pl-9 pr-14 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600/40 focus:border-teal-600 transition-all shadow-2xs"
        />
        {searchQuery ? (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
            title="Xóa tìm kiếm"
          >
            <X className="w-4 h-4" />
          </button>
        ) : (
          <kbd className="absolute right-2 top-2 px-1.5 py-0.5 bg-slate-100 text-slate-400 rounded text-[10px] font-mono border border-slate-200 pointer-events-none select-none">
            Ctrl K
          </kbd>
        )}
      </div>
      {/* Action Controls */}
      <div className="flex items-center space-x-2 relative">
        {/* Chuyển đổi Chế độ Xem: Theo kỳ / Danh sách */}
        {onToggleViewMode && (
          <button
            type="button"
            onClick={onToggleViewMode}
            className={`h-9 px-3 rounded-lg border font-medium text-xs flex items-center space-x-1.5 transition-colors cursor-pointer ${
              viewMode === 'BY_PERIOD'
                ? 'bg-teal-50 border-teal-300 text-teal-800 font-semibold'
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
            title="Chuyển đổi giữa gom nhóm theo kỳ kê khai và danh sách phẳng"
          >
            <Calendar className="w-3.5 h-3.5 text-teal-700" />
            <span>{viewMode === 'BY_PERIOD' ? 'Theo kỳ ▾' : 'Danh sách'}</span>
          </button>
        )}

        {/* Nút Phân tích chuyên sâu GTGT (Secondary CTA) */}
        {isVatTab && onAnalyzeVat && (
          <button
            type="button"
            onClick={onAnalyzeVat}
            disabled={totalFilingsCount === 0 || isVatAnalyzing}
            className={`h-9 px-3 rounded-lg border font-semibold text-xs flex items-center space-x-1.5 transition-colors cursor-pointer disabled:opacity-50 ${
              isVatAnalyzing
                ? 'bg-amber-50 border-amber-300 text-amber-900 animate-pulse'
                : 'bg-teal-50/80 hover:bg-teal-100/80 text-teal-800 border-teal-200 shadow-2xs'
            }`}
            title="Trích xuất chỉ tiêu [22]..[43], đối chiếu các lần bổ sung và tạo Bảng tham chiếu"
          >
            <TableProperties className={`w-3.5 h-3.5 ${isVatAnalyzing ? 'animate-spin text-amber-700' : 'text-teal-700'}`} />
            <span>{isVatAnalyzing ? '◌ Đang phân tích…' : 'Phân tích GTGT'}</span>
          </button>
        )}

        {/* Nút Phân tích chuyên sâu TNCN (Secondary CTA) */}
        {isPitTab && onAnalyzePit && (
          <button
            type="button"
            onClick={onAnalyzePit}
            disabled={totalFilingsCount === 0 || isPitAnalyzing}
            className={`h-9 px-3 rounded-lg border font-semibold text-xs flex items-center space-x-1.5 transition-colors cursor-pointer disabled:opacity-50 ${
              isPitAnalyzing
                ? 'bg-amber-50 border-amber-300 text-amber-900 animate-pulse'
                : 'bg-teal-50/80 hover:bg-teal-100/80 text-teal-800 border-teal-200 shadow-2xs'
            }`}
            title="Trích xuất chỉ tiêu [32]..[34], đối chiếu Tháng, Quý và Quyết toán năm 05/QTT-TNCN"
          >
            <TableProperties className={`w-3.5 h-3.5 ${isPitAnalyzing ? 'animate-spin text-amber-700' : 'text-teal-700'}`} />
            <span>{isPitAnalyzing ? '◌ Đang phân tích…' : 'Phân tích TNCN'}</span>
          </button>
        )}

        {/* Nút tải chính (Primary CTA - Màu Teal đậm duy nhất trên thanh) */}
        {selectedCount > 0 ? (
          <button
            type="button"
            onClick={onDownloadSelected}
            className="h-9 px-3.5 bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white font-semibold rounded-lg text-xs flex items-center space-x-1.5 transition-colors shadow-xs cursor-pointer"
            title={`Bắt đầu tải ${selectedCount} hồ sơ đã chọn`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Tải {selectedCount} hồ sơ đã chọn</span>
          </button>
        ) : filteredCount > 0 && onDownloadFiltered ? (
          <button
            type="button"
            onClick={onDownloadFiltered}
            className="h-9 px-3.5 bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white font-semibold rounded-lg text-xs flex items-center space-x-1.5 transition-colors shadow-xs cursor-pointer"
            title={`Tải nhanh ${filteredCount} hồ sơ theo danh mục đang xem`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Tải {filteredCount} hồ sơ</span>
          </button>
        ) : null}

        {/* Filter Popover Trigger */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setIsFilterOpen(!isFilterOpen);
              setIsMenuOpen(false);
            }}
            className={`h-9 px-3 rounded-lg border font-medium text-xs flex items-center space-x-1.5 transition-colors cursor-pointer ${
              activeFilterCount > 0
                ? 'bg-teal-50 border-teal-300 text-teal-800 font-semibold'
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Filter className="w-3.5 h-3.5 text-teal-700" />
            <span>Bộ lọc</span>
            {activeFilterCount > 0 && (
              <span className="w-4 h-4 rounded-full bg-teal-700 text-white text-[10.5px] font-bold flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>

          <FilterPopover
            isOpen={isFilterOpen}
            onClose={() => setIsFilterOpen(false)}
            filters={filters}
            onFilterChange={onFilterChange}
            availablePeriods={availablePeriods}
            availableStatuses={availableStatuses}
            onReset={() => {
              onResetFilters();
              setIsFilterOpen(false);
            }}
          />
        </div>

        {/* Export Excel Menu Dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setIsExcelMenuOpen(!isExcelMenuOpen);
              setIsFilterOpen(false);
              setIsMenuOpen(false);
            }}
            disabled={totalFilingsCount === 0}
            className="h-9 px-3 bg-white hover:bg-slate-50 border border-slate-300 text-slate-700 font-medium rounded-lg text-xs flex items-center space-x-1.5 transition-colors disabled:opacity-40 cursor-pointer shadow-2xs"
            title="Tùy chọn xuất Excel"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-teal-700" />
            <span>Xuất Excel ▾</span>
          </button>

          {isExcelMenuOpen && (
            <div className="absolute right-0 top-11.5 z-30 w-64 bg-white border border-slate-200 rounded-xl shadow-xl py-1 text-xs animate-fadeIn divide-y divide-slate-100">
              <button
                type="button"
                onClick={() => {
                  setIsExcelMenuOpen(false);
                  onExportExcel();
                }}
                className="w-full px-3 py-2 text-left hover:bg-teal-50 flex items-center space-x-2 text-slate-700 font-medium transition-colors cursor-pointer"
              >
                <FileSpreadsheet className="w-4 h-4 text-teal-700 shrink-0" />
                <div>
                  <div className="font-semibold text-slate-800 text-[12.5px]">Danh sách hồ sơ thuế</div>
                  <div className="text-[11px] text-slate-500">Xuất danh sách bảng kê 1 sheet chuẩn</div>
                </div>
              </button>

              {onExportVatReference && (
                <button
                  type="button"
                  onClick={() => {
                    setIsExcelMenuOpen(false);
                    onExportVatReference();
                  }}
                  className="w-full px-3 py-2 text-left hover:bg-teal-50 flex items-center space-x-2 text-slate-700 font-medium transition-colors cursor-pointer"
                >
                  <FileSpreadsheet className="w-4 h-4 text-teal-700 shrink-0" />
                  <div>
                    <div className="font-semibold text-teal-900 text-[12.5px]">Bảng tham chiếu GTGT</div>
                    <div className="text-[11px] text-teal-700">3 Sheet kiểm toán: Tổng hợp, Lịch sử, Chỉ tiêu</div>
                  </div>
                </button>
              )}
            </div>
          )}
        </div>

        {/* More Menu (Tải nhanh theo nhóm thuế, theo kỳ & Tải tất cả) */}
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setIsMenuOpen(!isMenuOpen);
              setIsFilterOpen(false);
            }}
            disabled={totalFilingsCount === 0}
            className="h-9 px-2.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-600 rounded-lg text-xs flex items-center transition-colors disabled:opacity-40 cursor-pointer shadow-2xs"
            title="Tùy chọn tải khác"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>

          {isMenuOpen && (
            <div className="absolute right-0 top-10.5 z-30 w-60 bg-white border border-slate-200 rounded-xl shadow-xl py-1 text-xs animate-fadeIn divide-y divide-slate-100">
              {/* Tải nhanh theo từng nhóm thuế */}
              {categoryCounts && (
                <div className="py-1">
                  <div className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    Tải nhanh theo nhóm thuế
                  </div>
                  {categoryCounts.VAT > 0 && onDownloadCategory && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        onDownloadCategory('VAT');
                      }}
                      className="w-full px-3 py-1.5 text-left hover:bg-teal-50 flex items-center justify-between text-slate-700 font-medium transition-colors cursor-pointer"
                    >
                      <span>Tờ khai thuế GTGT</span>
                      <span className="text-[11px] font-mono text-teal-700 bg-teal-50 px-1.5 py-0.2 rounded font-bold">
                        {categoryCounts.VAT} hồ sơ
                      </span>
                    </button>
                  )}
                  {categoryCounts.FINALIZATION > 0 && onDownloadCategory && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        onDownloadCategory('FINALIZATION');
                      }}
                      className="w-full px-3 py-1.5 text-left hover:bg-teal-50 flex items-center justify-between text-slate-700 font-medium transition-colors cursor-pointer"
                    >
                      <span>Quyết toán thuế (TNDN/TNCN)</span>
                      <span className="text-[11px] font-mono text-teal-700 bg-teal-50 px-1.5 py-0.2 rounded font-bold">
                        {categoryCounts.FINALIZATION} hồ sơ
                      </span>
                    </button>
                  )}
                  {categoryCounts.PIT > 0 && onDownloadCategory && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        onDownloadCategory('PIT');
                      }}
                      className="w-full px-3 py-1.5 text-left hover:bg-teal-50 flex items-center justify-between text-slate-700 font-medium transition-colors cursor-pointer"
                    >
                      <span>Tờ khai thuế TNCN</span>
                      <span className="text-[11px] font-mono text-teal-700 bg-teal-50 px-1.5 py-0.2 rounded font-bold">
                        {categoryCounts.PIT} hồ sơ
                      </span>
                    </button>
                  )}
                  {categoryCounts.CIT > 0 && onDownloadCategory && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsMenuOpen(false);
                        onDownloadCategory('CIT');
                      }}
                      className="w-full px-3 py-1.5 text-left hover:bg-teal-50 flex items-center justify-between text-slate-700 font-medium transition-colors cursor-pointer"
                    >
                      <span>Tờ khai thuế TNDN</span>
                      <span className="text-[11px] font-mono text-teal-700 bg-teal-50 px-1.5 py-0.2 rounded font-bold">
                        {categoryCounts.CIT} hồ sơ
                      </span>
                    </button>
                  )}
                </div>
              )}

              {/* Tải theo kỳ */}
              {availablePeriods.length > 0 && (
                <div className="py-1 max-h-44 overflow-y-auto">
                  <div className="px-3 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    Tải theo kỳ
                  </div>
                  {availablePeriods.map(p => {
                    const count = periodCounts[p] || 0;
                    return (
                      <button
                        key={p}
                        type="button"
                        onClick={() => {
                          setIsMenuOpen(false);
                          onDownloadPeriod(p);
                        }}
                        className="w-full px-3 py-1.5 text-left hover:bg-teal-50 flex items-center justify-between text-slate-700 font-medium transition-colors cursor-pointer"
                      >
                        <span className="truncate">{p}</span>
                        <span className="text-[11px] font-mono text-teal-700 bg-teal-50 px-1.5 py-0.2 rounded font-bold">
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="py-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsMenuOpen(false);
                    onDownloadAll();
                  }}
                  className="w-full px-3 py-2 text-left text-slate-700 hover:bg-slate-50 flex items-center space-x-2 font-medium cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-teal-700" />
                  <span>Tải tất cả ({totalFilingsCount} hồ sơ)</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

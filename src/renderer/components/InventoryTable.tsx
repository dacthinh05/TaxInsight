import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckSquare, FileSearch, Inbox, RotateCcw, Square } from 'lucide-react';
import {
  buildFilingSearchString,
  compareFilings,
  detectPeriodAnomalies,
  isFilingRejected,
  normalizeSearchText,
  normalizeVatPeriod,
  parseSubmissionTimestamp,
  TAX_TYPE_ORDER
} from '../../shared/dateUtils';
import { MissingPeriodCheck, TaxFiling, TaxType } from '../../shared/types';
import { FilingRow } from './FilingRow';
import { FilingTabs } from './FilingTabs';
import { FilterState } from './FilterPopover';
import { SearchToolbar } from './SearchToolbar';

interface InventoryTableProps {
  filings: TaxFiling[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: (ids: string[]) => void;
  onDeselectAll: () => void;
  onPreview: (filing: TaxFiling) => void;
  missingVatCheck?: MissingPeriodCheck;
  missingPitCheck?: MissingPeriodCheck;
  onDownloadSelected: () => void;
  onDownloadAll: () => void;
  onDownloadPeriod: (period: string) => void;
  /** Tải trực tiếp một danh sách hồ sơ — tránh stale closure qua selection state */
  onDownloadFilings?: (filings: TaxFiling[]) => void;
  onExportExcel: () => void;
  isDownloading: boolean;
  onAnalyzeVat?: () => void;
  isVatAnalyzing?: boolean;
  onExportVatReference?: () => void;
  onAnalyzePit?: () => void;
  isPitAnalyzing?: boolean;
  onExportPitReference?: () => void;
  selectedTaxType?: TaxType;
  onTaxTypeChange?: (taxType: TaxType) => void;
}

export const InventoryTable: React.FC<InventoryTableProps> = ({
  filings,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onDeselectAll,
  onPreview,
  missingVatCheck,
  missingPitCheck,
  onDownloadSelected,
  onDownloadAll,
  onDownloadPeriod,
  onDownloadFilings,
  onExportExcel,
  isDownloading,
  onAnalyzeVat,
  isVatAnalyzing = false,
  onExportVatReference,
  onAnalyzePit,
  isPitAnalyzing = false,
  onExportPitReference,
  selectedTaxType: externalTaxType,
  onTaxTypeChange: externalOnTaxTypeChange
}) => {
  const [internalTaxType, setInternalTaxType] = useState<TaxType>('ALL');
  const selectedTaxType = externalTaxType !== undefined ? externalTaxType : internalTaxType;
  const setSelectedTaxType = (t: TaxType) => {
    setInternalTaxType(t);
    if (selectedIds.size > 0) onDeselectAll();
    if (externalOnTaxTypeChange) externalOnTaxTypeChange(t);
  };

  // Tự động bỏ chọn các checkbox khi người dùng chuyển sang tab loại thuế khác
  useEffect(() => {
    if (selectedIds.size > 0) {
      onDeselectAll();
    }
  }, [selectedTaxType]);
  const [viewMode, setViewMode] = useState<'LIST' | 'BY_PERIOD'>('BY_PERIOD');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [filters, setFilters] = useState<FilterState>({
    period: 'ALL',
    filingType: 'ALL',
    portalStatus: 'ALL',
    downloadStatus: 'ALL'
  });

  // Debounce tìm kiếm nhẹ 180ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 180);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const availablePeriods = useMemo(() => {
    const set = new Set<string>();
    for (const f of filings) {
      if (f.period && f.period !== 'Không xác định' && f.period !== 'Kỳ trong năm' && f.period !== '—') {
        set.add(f.period);
      } else if (f.periodNormalized?.raw) {
        set.add(f.periodNormalized.raw);
      }
    }
    return Array.from(set);
  }, [filings]);

  const availablePortalStatuses = useMemo(() => {
    const set = new Set<string>();
    for (const f of filings) {
      if (f.status) set.add(f.status);
    }
    return Array.from(set);
  }, [filings]);

  // Derived records pipeline
  const filteredFilings = useMemo(() => {
    const normalizedQuery = normalizeSearchText(debouncedSearchQuery);
    const searchTokens = normalizedQuery ? normalizedQuery.split(/\s+/).filter(Boolean) : [];

    const result = filings.filter(f => {
      // 1. Lọc theo Tab Loại thuế
      if (selectedTaxType !== 'ALL') {
        if (selectedTaxType === 'REFUND') {
          const isRefund = f.taxType === 'REFUND' || f.filingType === 'REFUND' || f.procedureCode === '1.007037' || f.procedureCode === '1.007039';
          if (!isRefund) return false;
        } else if (selectedTaxType === 'VAT') {
          const isRefund = f.taxType === 'REFUND' || f.filingType === 'REFUND' || f.procedureCode === '1.007037' || f.procedureCode === '1.007039';
          if (isRefund || f.taxType !== 'VAT') return false;
        } else {
          if (f.taxType !== selectedTaxType) return false;
        }
      }

      // 2. Lọc theo Search đa từ khóa
      if (searchTokens.length > 0) {
        const itemSearchString = buildFilingSearchString(f);
        const matchesAllTokens = searchTokens.every(token => itemSearchString.includes(token));
        if (!matchesAllTokens) return false;
      }

      // 3. Lọc theo Kỳ kê khai
      if (filters.period !== 'ALL') {
        const periodStr = f.periodNormalized?.raw || f.period || '';
        if (periodStr !== filters.period) return false;
      }

      // 4. Lọc theo Loại hồ sơ
      if (filters.filingType !== 'ALL') {
        if (filters.filingType === 'FINALIZATION') {
          if (f.filingType !== 'FINALIZATION') return false;
        } else if (filters.filingType === 'REFUND') {
          if (f.filingType !== 'REFUND') return false;
        } else if (filters.filingType === 'SUPPLEMENTAL') {
          if (f.filingType !== 'SUPPLEMENTAL') return false;
        } else if (filters.filingType === 'ORIGINAL') {
          if (f.filingType !== 'ORIGINAL' && f.filingType !== 'PERIODIC') return false;
        }
      }

      // 5. Lọc theo Trạng thái Cổng
      if (filters.portalStatus !== 'ALL') {
        if (f.status !== filters.portalStatus) return false;
      }

      // 6. Lọc theo Tình trạng tải
      if (filters.downloadStatus !== 'ALL') {
        const status = f.downloadStatus || 'NOT_DOWNLOADED';
        if (filters.downloadStatus === 'NOT_DOWNLOADED') {
          if (status !== 'NOT_DOWNLOADED' && status !== 'PENDING') return false;
        } else if (status !== filters.downloadStatus) {
          return false;
        }
      }

      return true;
    });

    return [...result].sort(compareFilings);
  }, [filings, selectedTaxType, debouncedSearchQuery, filters]);

  const periodCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const f of filings) {
      const p = f.periodNormalized?.raw || (f.period && f.period !== 'Không xác định' && f.period !== 'Kỳ trong năm' && f.period !== '—' ? f.period : undefined);
      if (p) {
        map[p] = (map[p] || 0) + 1;
      }
    }
    return map;
  }, [filings]);

  const counts = useMemo(() => {
    const res: Record<TaxType, number> = {
      ALL: filings.length,
      VAT: 0,
      REFUND: 0,
      PIT: 0,
      CIT: 0,
      FCT: 0,
      HOUSE_LAND: 0,
      REPORT: 0,
      OTHER: 0
    };
    for (const f of filings) {
      if (f.taxType === 'REFUND' || f.filingType === 'REFUND' || f.procedureCode === '1.007037' || f.procedureCode === '1.007039') {
        res.REFUND++;
      } else if (res[f.taxType] !== undefined && f.taxType !== 'ALL') {
        res[f.taxType]++;
      } else {
        res.OTHER++;
      }
    }
    return res;
  }, [filings]);

  const categoryCounts = useMemo(() => {
    let vat = 0, pit = 0, cit = 0, finalization = 0;
    for (const f of filings) {
      if (f.taxType === 'VAT') vat++;
      if (f.taxType === 'PIT') pit++;
      if (f.taxType === 'CIT') cit++;
      if (f.filingType === 'FINALIZATION') finalization++;
    }
    return { VAT: vat, PIT: pit, CIT: cit, FINALIZATION: finalization };
  }, [filings]);

  const allFilteredSelected =
    filteredFilings.length > 0 &&
    filteredFilings.every(f => selectedIds.has(f.id));

  const handleToggleSelectAll = () => {
    if (allFilteredSelected) {
      const next = new Set(selectedIds);
      filteredFilings.forEach(f => next.delete(f.id));
      onSelectAll(Array.from(next));
    } else {
      const next = new Set(selectedIds);
      filteredFilings.forEach(f => next.add(f.id));
      onSelectAll(Array.from(next));
    }
  };

  const handleResetFilters = () => {
    setFilters({
      period: 'ALL',
      filingType: 'ALL',
      portalStatus: 'ALL',
      downloadStatus: 'ALL'
    });
    setSearchQuery('');
    setDebouncedSearchQuery('');
  };

  const quickDownloadLabel = useMemo(() => {
    if (selectedTaxType === 'VAT') return 'GTGT';
    if (selectedTaxType === 'REFUND') return 'Hoàn thuế';
    if (selectedTaxType === 'PIT') return 'TNCN';
    if (selectedTaxType === 'CIT') return 'TNDN';
    if (selectedTaxType === 'FCT') return 'Nhà thầu';
    if (selectedTaxType === 'HOUSE_LAND') return 'Nhà đất';
    if (selectedTaxType === 'REPORT') return 'Báo cáo';
    if (selectedTaxType === 'OTHER') return 'Thủ tục khác';
    return 'tất cả';
  }, [selectedTaxType]);

  const handleDownloadCategory = (type: string) => {
    let targetFilings: TaxFiling[] = [];
    if (type === 'FINALIZATION') {
      targetFilings = filings.filter(f => f.filingType === 'FINALIZATION');
    } else if (type === 'VAT') {
      targetFilings = filings.filter(f => f.taxType === 'VAT');
    } else if (type === 'PIT') {
      targetFilings = filings.filter(f => f.taxType === 'PIT');
    } else if (type === 'CIT') {
      targetFilings = filings.filter(f => f.taxType === 'CIT');
    }
    if (targetFilings.length > 0) {
      onSelectAll(targetFilings.map(f => f.id));
      // Tải TRỰC TIẾP danh sách đích — trước đây gọi setTimeout(onDownloadSelected)
      // với closure selectedIds CŨ: khi chưa có selection, bấm nút tải không làm gì;
      // khi có selection cũ, tải SAI các hàng đã chọn trước đó.
      if (onDownloadFilings) {
        onDownloadFilings(targetFilings);
      } else {
        setTimeout(() => onDownloadSelected(), 50);
      }
    }
  };

  const handleDownloadFiltered = () => {
    if (filteredFilings.length > 0) {
      onSelectAll(filteredFilings.map(f => f.id));
      if (onDownloadFilings) {
        onDownloadFilings(filteredFilings);
      } else {
        setTimeout(() => onDownloadSelected(), 50);
      }
    }
  };

  const handleDownloadSelectedOnly = () => {
    if (selectedIds.size > 0) {
      onDownloadSelected();
    }
  };

  // Grouping theo kỳ kê khai khi viewMode === 'BY_PERIOD'
  const periodGroups = useMemo(() => {
    if (viewMode !== 'BY_PERIOD') return [];

    const map = new Map<string, {
      label: string;
      key: string;
      year: number;
      month?: number;
      quarter?: number;
      isNoPeriod?: boolean;
      filings: TaxFiling[];
    }>();

    for (const f of filteredFilings) {
      const raw = f.period || f.periodNormalized?.raw || '—';
      const norm = normalizeVatPeriod(raw, f.submittedAt);
      const isNoPeriod = norm.type === 'UNKNOWN' || norm.year === 0;
      const key = isNoPeriod ? 'NO_PERIOD' : norm.key;
      const label = isNoPeriod ? 'Hồ sơ không theo kỳ' : norm.label;

      if (!map.has(key)) {
        map.set(key, {
          label,
          key,
          year: isNoPeriod ? -1 : norm.year,
          month: norm.month,
          quarter: norm.quarter,
          isNoPeriod,
          filings: []
        });
      }
      map.get(key)!.filings.push(f);
    }

    const groups = Array.from(map.values()).map(g => {
      const sorted = [...g.filings].sort((a, b) => {
        const orderA = TAX_TYPE_ORDER[a.taxType] ?? 5;
        const orderB = TAX_TYPE_ORDER[b.taxType] ?? 5;
        if (orderA !== orderB) return orderA - orderB;

        const declA = a.declarationCode || '';
        const declB = b.declarationCode || '';
        if (declA !== declB) return declA.localeCompare(declB);

        const isAOrig = a.filingType !== 'SUPPLEMENTAL';
        const isBOrig = b.filingType !== 'SUPPLEMENTAL';
        if (isAOrig && !isBOrig) return -1;
        if (!isAOrig && isBOrig) return 1;

        const seqA = a.supplementalNo || 0;
        const seqB = b.supplementalNo || 0;
        if (seqA !== seqB) return seqA - seqB;

        const timeA = parseSubmissionTimestamp(a.submittedAt);
        const timeB = parseSubmissionTimestamp(b.submittedAt);
        return timeA - timeB;
      });

      const suppCount = sorted.filter(f => f.filingType === 'SUPPLEMENTAL' && !isFilingRejected(f)).length;
      const anomalies = g.isNoPeriod ? [] : detectPeriodAnomalies(sorted);

      let latestSubmissionDate = '';
      const validFilings = sorted.filter(f => !isFilingRejected(f));
      const targetList = validFilings.length > 0 ? validFilings : sorted;
      if (targetList.length > 0) {
        const latestFiling = [...targetList].sort(
          (a, b) => parseSubmissionTimestamp(b.submittedAt) - parseSubmissionTimestamp(a.submittedAt)
        )[0];
        if (latestFiling?.submittedAt) {
          latestSubmissionDate = latestFiling.submittedAt.split(' ')[0];
        }
      }

      return {
        ...g,
        filings: sorted,
        supplementalCount: suppCount,
        anomalies,
        latestSubmissionDate
      };
    });

    groups.sort((a, b) => {
      if (a.isNoPeriod && !b.isNoPeriod) return 1;
      if (!a.isNoPeriod && b.isNoPeriod) return -1;
      if (a.year !== b.year) return b.year - a.year;
      const orderA = (a.month || 0) * 10 + (a.quarter || 0);
      const orderB = (b.month || 0) * 10 + (b.quarter || 0);
      return orderB - orderA;
    });

    return groups;
  }, [filteredFilings, viewMode]);

  return (
    <div className="flex flex-col h-full bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-visible">
      <div className="shrink-0 border-b border-slate-200/80 bg-white rounded-t-xl">
        <FilingTabs
          selectedTab={selectedTaxType}
          onTabChange={setSelectedTaxType}
          counts={counts}
        />

        {(
          (missingVatCheck?.isCompleteData === false && (missingVatCheck.missingPeriods?.length ?? 0) > 0) ||
          (missingPitCheck?.isCompleteData === false && (missingPitCheck.missingPeriods?.length ?? 0) > 0)
        ) && (
          <div className="mx-4 my-2 p-3 bg-amber-50/90 border border-amber-200/80 rounded-lg text-[12px] text-amber-900 flex items-start space-x-2.5">
            <AlertTriangle className="w-4.5 h-4.5 text-amber-600 shrink-0 mt-0.5" />
            <div className="space-y-1 text-[12px]">
              {missingVatCheck?.isCompleteData === false && (missingVatCheck.missingPeriods?.length ?? 0) > 0 && (
                <div>
                  <strong className="font-semibold text-amber-950">Đối chiếu sơ bộ: </strong>
                  <span>GTGT ({missingVatCheck.periodType === 'MONTH' ? 'Khai tháng' : 'Khai quý'}): Chưa thấy kỳ {missingVatCheck.missingPeriods.join(', ')} trong dữ liệu đã quét.</span>
                </div>
              )}
              {missingPitCheck?.isCompleteData === false && (missingPitCheck.missingPeriods?.length ?? 0) > 0 && (
                <div>
                  <strong className="font-semibold text-amber-950">Đối chiếu sơ bộ: </strong>
                  <span>TNCN ({missingPitCheck.periodType === 'MONTH' ? 'Khai tháng' : 'Khai quý'}): Chưa thấy kỳ {missingPitCheck.missingPeriods.join(', ')} trong dữ liệu đã quét.</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* SearchToolbar */}
        <div className="px-4 py-3 relative">
          <SearchToolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            filters={filters}
            onFilterChange={setFilters}
            onResetFilters={handleResetFilters}
            availablePeriods={availablePeriods}
            availableStatuses={availablePortalStatuses}
            onExportExcel={onExportExcel}
            onDownloadAll={onDownloadAll}
            onDownloadPeriod={onDownloadPeriod}
            periodCounts={periodCounts}
            totalFilingsCount={filings.length}
            selectedCount={selectedIds.size}
            filteredCount={filteredFilings.length}
            quickDownloadLabel={quickDownloadLabel}
            onDownloadFiltered={handleDownloadFiltered}
            onDownloadSelected={handleDownloadSelectedOnly}
            onDownloadCategory={handleDownloadCategory}
            categoryCounts={categoryCounts}
            viewMode={viewMode}
            onToggleViewMode={() => setViewMode(v => v === 'BY_PERIOD' ? 'LIST' : 'BY_PERIOD')}
            isVatTab={selectedTaxType === 'VAT'}
            onAnalyzeVat={onAnalyzeVat}
            isVatAnalyzing={isVatAnalyzing}
            onExportVatReference={onExportVatReference}
            isPitTab={selectedTaxType === 'PIT'}
            onAnalyzePit={onAnalyzePit}
            isPitAnalyzing={isPitAnalyzing}
            onExportPitReference={onExportPitReference}
          />
        </div>

        {/* Summary status line thanh lịch phía trên table */}
        <div className="px-4 py-2 bg-slate-50/70 border-t border-slate-200/80 flex items-center justify-between text-[12.5px] text-slate-600 font-sans">
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-slate-800">{filings.length} hồ sơ</span>
            <span className="text-slate-300">·</span>
            <span className="text-emerald-700 font-semibold">
              {filings.filter(f => (f.status || '').toLowerCase().includes('chấp nhận')).length} đã chấp nhận
            </span>
            <span className="text-slate-300">·</span>
            <span className="text-slate-600">
              {filings.filter(f => f.downloadStatus === 'COMPLETED' || f.downloadStatus === 'EXISTING').length} đã tải về máy
            </span>
          </div>

          {filteredFilings.length !== filings.length && (
            <div className="text-[12px] text-teal-800 font-medium bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
              Đang lọc hiển thị {filteredFilings.length} / {filings.length} hồ sơ
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-b-xl">
        <table className="w-full text-left border-collapse text-[14px]">
          <thead className="bg-[#F8FAFC] sticky top-0 z-10 border-b border-slate-200 text-slate-700 font-semibold text-[12px] select-none">
            <tr>
              <th className="w-10 px-3 py-2.5 text-center">
                <button
                  type="button"
                  onClick={handleToggleSelectAll}
                  className="text-slate-400 hover:text-teal-700 transition-colors flex items-center justify-center cursor-pointer"
                >
                  {allFilteredSelected ? (
                    <CheckSquare className="w-4 h-4 text-teal-700" />
                  ) : (
                    <Square className="w-4 h-4 text-slate-300" />
                  )}
                </button>
              </th>
              {viewMode === 'LIST' && (
                <th className="w-32 px-3 py-2.5">KỲ KÊ KHAI</th>
              )}
              <th className="px-3.5 py-2.5 min-w-[380px] lg:min-w-[420px]">HỒ SƠ / TỜ KHAI</th>
              <th className="w-[100px] px-3 py-2.5">MẪU BIỂU</th>
              <th className="w-[140px] px-3 py-2.5">LOẠI HỒ SƠ</th>
              <th className="w-[160px] px-3 py-2.5">NGÀY NỘP</th>
              <th className="w-[150px] px-3 py-2.5">TRẠNG THÁI</th>
              <th className="w-[68px] px-2 py-2.5 text-center sticky right-0 bg-[#F8FAFC]">XEM</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredFilings.length === 0 ? (
              <tr>
                <td colSpan={viewMode === 'BY_PERIOD' ? 7 : 8} className="p-12 text-center text-slate-400 text-[13px]">
                  {filings.length === 0 ? (
                    <div className="flex flex-col items-center justify-center space-y-3 max-w-sm mx-auto py-6">
                      <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 shadow-2xs border border-slate-200">
                        <Inbox className="w-6 h-6 text-slate-400" />
                      </div>
                      <div className="space-y-1">
                        <p className="font-semibold text-slate-700 text-sm">Chưa có dữ liệu hồ sơ tờ khai</p>
                        <p className="text-slate-500 text-xs">
                          Hãy chọn năm/kỳ thuế và nhấn nút <strong className="text-teal-700">"Quét tờ khai"</strong> ở thanh lệnh phía trên để đồng bộ từ Cổng Thuế.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center space-y-3 max-w-sm mx-auto py-6">
                      <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 shadow-2xs border border-slate-200">
                        <FileSearch className="w-6 h-6 text-slate-400" />
                      </div>
                      <div className="space-y-1">
                        <p className="font-semibold text-slate-700 text-sm">Không tìm thấy tờ khai phù hợp</p>
                        <p className="text-slate-500 text-xs">
                          Bộ lọc hiện tại không khớp với {filings.length} tờ khai đã quét.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleResetFilters}
                        className="mt-1 px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-700 font-semibold rounded-lg text-xs flex items-center gap-1.5 transition-colors cursor-pointer border border-slate-300 shadow-2xs"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                        <span>Xóa tất cả bộ lọc</span>
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ) : viewMode === 'BY_PERIOD' ? (
              // ─── CHẾ ĐỘ XEM THEO KỲ: GOM NHÓM RÕ RÀNG ─────────────────
              periodGroups.map(group => {
                const groupSelected = group.filings.length > 0 && group.filings.every(f => selectedIds.has(f.id));
                const toggleGroup = () => {
                  const next = new Set(selectedIds);
                  if (groupSelected) {
                    group.filings.forEach(f => next.delete(f.id));
                  } else {
                    group.filings.forEach(f => next.add(f.id));
                  }
                  onSelectAll(Array.from(next));
                };

                return (
                  <React.Fragment key={group.key}>
                    {/* Header Nhóm Kỳ */}
                    <tr className="bg-slate-50/90 hover:bg-slate-100/90 text-slate-800 font-semibold border-t border-b border-slate-200/90 select-none h-[42px] transition-colors">
                      <td className="w-10 px-3 py-2 text-center" onClick={toggleGroup}>
                        <button type="button" className="text-slate-400 hover:text-teal-700 transition-colors flex items-center justify-center cursor-pointer">
                          {groupSelected ? <CheckSquare className="w-4 h-4 text-teal-700" /> : <Square className="w-4 h-4 text-slate-300" />}
                        </button>
                      </td>
                      <td colSpan={6} className="px-3.5 py-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <span className="font-bold text-slate-900 font-mono text-[14px]">
                              ▼ {group.isNoPeriod ? group.label : `Kỳ ${group.label}`}
                            </span>
                            <span className="text-slate-500 font-medium text-[12.5px]">
                              {group.filings.length} hồ sơ
                              {group.supplementalCount > 0 ? (
                                <span className="text-amber-800 font-semibold ml-1.5 px-1.5 py-0.2 rounded bg-amber-50 border border-amber-200 text-[11.5px]">
                                  Hiện hành: BS lần {group.supplementalCount}
                                </span>
                              ) : (
                                <span className="text-slate-600 font-semibold ml-1.5 px-1.5 py-0.2 rounded bg-slate-100 border border-slate-200 text-[11.5px]">
                                  Hiện hành: Chính thức
                                </span>
                              )}
                              {group.latestSubmissionDate ? ` · ${group.latestSubmissionDate}` : ''}
                            </span>
                          </div>
                          {group.anomalies.length > 0 && (
                            <div className="flex items-center space-x-2">
                              {group.anomalies.includes('MISSING_OFFICIAL') && (
                                <span
                                  title="Chưa tìm thấy bản chính thức trong dải ngày đang lọc (có thể đã nộp ở kỳ/năm khác). Bản bổ sung hiện hành vẫn được áp dụng đối chiếu."
                                  className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-900 border border-amber-300 font-medium text-[11.5px] cursor-help shadow-2xs"
                                >
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                  <span>Thiếu bản chính thức trong dải lọc</span>
                                </span>
                              )}
                              {group.anomalies.includes('MULTIPLE_OFFICIAL') && (
                                <span
                                  title="Phát hiện nhiều hơn 1 bản chính thức cho cùng 1 mẫu biểu trong kỳ này. Cần kiểm tra lại hồ sơ."
                                  className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-red-50 text-red-900 border border-red-200 font-medium text-[11.5px] cursor-help shadow-2xs"
                                >
                                  <AlertTriangle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                                  <span>Nhiều bản chính thức</span>
                                </span>
                              )}
                              {group.anomalies.includes('DISCONTINUOUS_SEQUENCE') && (
                                <span
                                  title="Chuỗi bổ sung có bước nhảy (ví dụ có lần 1 và lần 3). Bản bổ sung mới nhất vẫn được lấy làm căn cứ pháp lý."
                                  className="inline-flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-900 border border-amber-300 font-medium text-[11.5px] cursor-help shadow-2xs"
                                >
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                  <span>Chuỗi BS nhảy bậc</span>
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Danh sách hồ sơ trong nhóm */}
                    {group.filings.map((filing, index) => {
                      const sameSeriesFilings = group.filings.filter(
                        f => f.taxType === filing.taxType && (f.declarationCode || '') === (filing.declarationCode || '')
                      );
                      const seriesIndex = sameSeriesFilings.findIndex(f => f.id === filing.id);
                      const isFirstInSeries = seriesIndex === 0;
                      const isLastInSeries = seriesIndex === sameSeriesFilings.length - 1;
                      const seriesTotalItems = sameSeriesFilings.length;

                      return (
                        <FilingRow
                          key={filing.id}
                          filing={filing}
                          index={index}
                          isSelected={selectedIds.has(filing.id)}
                          onToggleSelect={onToggleSelect}
                          onPreview={onPreview}
                          viewMode="BY_PERIOD"
                          isFirstInGroup={isFirstInSeries}
                          isLastInGroup={isLastInSeries}
                          groupTotalItems={seriesTotalItems}
                        />
                      );
                    })}
                  </React.Fragment>
                );
              })
            ) : (
              // ─── CHẾ ĐỘ XEM DANH SÁCH PHẲNG ─────────────────────────
              filteredFilings.map((filing, index) => {
                const prev = index > 0 ? filteredFilings[index - 1] : undefined;
                const isGroupStart = index > 0 && filing.taxType !== prev?.taxType;
                return (
                  <FilingRow
                    key={filing.id}
                    filing={filing}
                    index={index}
                    isSelected={selectedIds.has(filing.id)}
                    onToggleSelect={onToggleSelect}
                    onPreview={onPreview}
                    isGroupStart={isGroupStart}
                    viewMode="LIST"
                  />
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

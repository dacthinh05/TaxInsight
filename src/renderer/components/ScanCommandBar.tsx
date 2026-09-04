import React from 'react';
import { BarChart3, CreditCard, FileSpreadsheet, FileText, History, Loader2, Search } from 'lucide-react';
import { AppViewMode, FilingSourceMode, TaxType } from '../../shared/types';
import { YearSelector } from './YearSelector';
export interface GntCommandStats {
  /** Số GNT đang hiển thị (sau khi lọc tìm kiếm) */
  count: number;
  totalAmount: number;
  /** Số GNT chưa đối chiếu/không khớp trong tập đang hiển thị (0 khi chưa đủ dữ liệu) */
  unreconciledCount: number;
}

interface ScanCommandBarProps {
  selectedYear: number;
  onYearChange: (year: number) => void;
  scanRangeMode: string; // 'YEAR_TO_DATE' | 'FULL_YEAR' | 'Q1'..'Q4' | 'M01'..'M12'
  onRangeModeChange: (mode: string) => void;
  selectedTaxType: TaxType;
  onTaxTypeChange: (type: TaxType) => void;
  isScanning: boolean;
  onStartScan: () => void;
  viewMode: AppViewMode;
  onViewModeChange: (mode: AppViewMode) => void;
  // ── Chế độ Giấy Nộp Tiền: gộp search + thống kê + xuất vào đúng 1 thanh lệnh ──
  gntSearchValue?: string;
  onGntSearchChange?: (value: string) => void;
  gntStats?: GntCommandStats;
  onOpenGntStats?: () => void;
  onExportGntExcel?: () => void;
  // ── Chế độ Tra Cứu Tờ Khai Năm Cũ (Legacy Filing) ──
  sourceMode?: FilingSourceMode;
  onSourceModeChange?: (mode: FilingSourceMode) => void;
  legacyYearFrom?: number;
  onLegacyYearFromChange?: (year: number) => void;
  legacyYearTo?: number;
  onLegacyYearToChange?: (year: number) => void;
  legacyMaTKhai?: string;
  onLegacyMaTKhaiChange?: (code: string) => void;
  legacyFormOptions?: { value: string; text: string }[];
  onlyMissing?: boolean;
  onOnlyMissingChange?: (checked: boolean) => void;
}

const fmtVnd = (n: number) => n.toLocaleString('vi-VN');

export const ScanCommandBar: React.FC<ScanCommandBarProps> = ({
  selectedYear,
  onYearChange,
  scanRangeMode,
  onRangeModeChange,
  selectedTaxType,
  onTaxTypeChange,
  isScanning,
  onStartScan,
  viewMode,
  gntSearchValue = '',
  onGntSearchChange,
  gntStats,
  onOpenGntStats,
  onExportGntExcel,
  sourceMode = 'CURRENT',
  onSourceModeChange,
  legacyYearFrom = 2021,
  onLegacyYearFromChange,
  legacyYearTo = 2023,
  onLegacyYearToChange,
  legacyMaTKhai = '00',
  onLegacyMaTKhaiChange,
  legacyFormOptions = [],
  onlyMissing = false,
  onOnlyMissingChange
}) => {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 21 }, (_, index) => currentYear - index);
  const isCurrentYear = selectedYear === currentYear;
  const isGntMode = viewMode === 'PAYMENT_SLIPS';
  const isLegacyMode = viewMode === 'FILINGS' && sourceMode === 'DVC_ETAX_LEGACY';

  const todayStr = `${String(new Date().getDate()).padStart(2, '0')}/${String(new Date().getMonth() + 1).padStart(2, '0')}/${currentYear}`;

  // Chỉ mã "00 = tất cả" đã được xác nhận từ trace. Các mã/mapping khác
  // phải lấy từ form HTML của phiên eTax hiện tại, không hardcode theo trace cũ.
  const defaultLegacyFormOptions = [
    { value: '00', text: '-- Tất cả tờ khai --' }
  ];

  const mergedFormOptions = legacyFormOptions.length > 0 ? legacyFormOptions : defaultLegacyFormOptions;

  return (
    <div className="bg-white border border-slate-200/90 rounded-xl px-4 py-2 shadow-xs flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
      {/* 1. Năm */}
      <div className="flex items-center space-x-1.5 shrink-0">
        <label className="font-medium text-slate-600 text-xs">
          {isGntMode ? 'Năm nộp:' : 'Năm:'}
        </label>
        <YearSelector
          selectedYear={selectedYear}
          onYearChange={onYearChange}
          isMultiYearSupported={true}
          scanRangeMode={scanRangeMode}
          onRangeModeChange={onRangeModeChange}
          disabled={isScanning}
        />
      </div>

      {/* 2. Thời gian nộp */}
      <div className="flex items-center space-x-1.5 shrink-0">
        <label className="font-medium text-slate-600 text-xs">
          Thời gian:
        </label>
        <select
          value={scanRangeMode}
          onChange={e => onRangeModeChange(e.target.value)}
          disabled={isScanning}
          className="h-8 max-w-[290px] px-2.5 bg-slate-50 border border-slate-300 rounded-lg font-medium text-slate-700 text-xs focus-ring focus:bg-white transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-2xs"
        >
          <optgroup label="Quét Đa Năm (Soát xét toàn diện)">
            <option value="MULTI_3_YEARS">3 năm gần nhất ({currentYear - 2} – {currentYear})</option>
            <option value="MULTI_5_YEARS">5 năm quyết toán ({currentYear - 4} – {currentYear})</option>
          </optgroup>
          <optgroup label="Theo Năm">
            {isCurrentYear ? (
              <>
                <option value="YEAR_TO_DATE">Từ 01/01 → hôm nay ({todayStr})</option>
                <option value="FULL_YEAR">Cả năm {selectedYear} (01/01 → 31/12/{selectedYear})</option>
              </>
            ) : (
              <option value="FULL_YEAR">Cả năm {selectedYear} (Bao gồm T01/{selectedYear + 1})</option>
            )}
          </optgroup>
          <optgroup label="Theo Quý">
            <option value="Q1">Quý 1 (01/01 → 31/03/{selectedYear})</option>
            <option value="Q2">Quý 2 (01/04 → 30/06/{selectedYear})</option>
            <option value="Q3">Quý 3 (01/07 → 30/09/{selectedYear})</option>
            <option value="Q4">Quý 4 (01/10 → 31/12/{selectedYear})</option>
          </optgroup>
          <optgroup label="Theo Tháng">
            <option value="M01">Tháng 01/{selectedYear}</option>
            <option value="M02">Tháng 02/{selectedYear}</option>
            <option value="M03">Tháng 03/{selectedYear}</option>
            <option value="M04">Tháng 04/{selectedYear}</option>
            <option value="M05">Tháng 05/{selectedYear}</option>
            <option value="M06">Tháng 06/{selectedYear}</option>
            <option value="M07">Tháng 07/{selectedYear}</option>
            <option value="M08">Tháng 08/{selectedYear}</option>
            <option value="M09">Tháng 09/{selectedYear}</option>
            <option value="M10">Tháng 10/{selectedYear}</option>
            <option value="M11">Tháng 11/{selectedYear}</option>
            <option value="M12">Tháng 12/{selectedYear}</option>
          </optgroup>
        </select>
      </div>

      {/* 3. Loại hồ sơ */}
      {viewMode === 'FILINGS' && (
        <div className="flex items-center space-x-1.5 shrink-0">
          <label className="font-medium text-slate-600 text-xs">
            Loại hồ sơ:
          </label>
          <select
            value={selectedTaxType}
            onChange={e => onTaxTypeChange(e.target.value as TaxType)}
            className="h-8 px-2.5 bg-slate-50 border border-slate-300 rounded-lg font-medium text-slate-700 text-xs focus-ring focus:bg-white transition-all cursor-pointer shadow-2xs"
          >
            <option value="ALL">Tất cả tờ khai thuế</option>
            <option value="VAT">Thuế GTGT</option>
            <option value="PIT">Thuế TNCN</option>
            <option value="CIT">Thuế TNDN</option>
            <option value="FCT">Thuế Nhà Thầu (FCT)</option>
            <option value="HOUSE_LAND">Thuê đất / Nhà đất</option>
            <option value="REFUND">Hoàn thuế</option>
          </select>
        </div>
      )}

      {/* Search (chế độ GNT — thay cho toolbar riêng của bảng) */}
      {isGntMode && (
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-2 pointer-events-none" />
          <input
            type="text"
            value={gntSearchValue}
            onChange={e => onGntSearchChange?.(e.target.value)}
            placeholder="Tìm GNT, mã GD, loại thuế, kỳ thuế…"
            className="w-full h-8 pl-8 pr-3 bg-white border border-slate-300 rounded-lg text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-1.5 focus:ring-teal-600 focus:border-teal-600 transition-colors shadow-2xs"
          />
        </div>
      )}

      {/* Right: summary chips + secondary actions + CTA (canh lề bên phải) */}
      <div className="ml-auto flex flex-wrap items-center gap-2 shrink-0">
        {/* Summary: 10 GNT · Tổng nộp X đ · Chưa đối chiếu N */}
        {isGntMode && gntStats && (
          <div className="flex items-center gap-1.5 whitespace-nowrap" title="Thống kê theo danh sách đang hiển thị (bao gồm bộ lọc tìm kiếm)">
            <span className="inline-flex items-center h-8 px-2.5 bg-slate-50 border border-slate-200 rounded-lg font-semibold text-slate-800">
              <CreditCard className="w-3.5 h-3.5 text-teal-700 mr-1.5" />
              {gntStats.count} GNT
            </span>
            <span className="inline-flex items-center h-8 px-2.5 bg-slate-50 border border-slate-200 rounded-lg font-mono font-bold text-slate-900 tabular-nums">
              <span className="font-sans font-normal text-slate-500 mr-1.5">Tổng nộp</span>
              {fmtVnd(gntStats.totalAmount)} ₫
            </span>
            {gntStats.unreconciledCount > 0 && (
              <span
                className="inline-flex items-center h-8 px-2.5 bg-amber-50 border border-amber-200 rounded-lg font-semibold text-amber-800 cursor-help"
                title={`${gntStats.unreconciledCount} GNT chưa khớp nghĩa vụ thuế nào — xem cột «Đối chiếu» để biết chi tiết`}
              >
                Chưa đối chiếu {gntStats.unreconciledCount}
              </span>
            )}
          </div>
        )}

        {/* Thống kê (GNT mode) */}
        {isGntMode && (
          <button
            type="button"
            onClick={onOpenGntStats}
            disabled={!gntStats || gntStats.count === 0}
            className="h-8 px-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium rounded-lg flex items-center space-x-1.5 transition-colors cursor-pointer shadow-2xs disabled:opacity-40"
            title="Tổng hợp tiền đã nộp theo tháng & loại thuế (GTGT/TNCN/TNDN…)"
          >
            <BarChart3 className="w-3.5 h-3.5 text-sky-700" />
            <span>Thống kê</span>
          </button>
        )}

        {/* Xuất Excel (GNT mode) */}
        {isGntMode && (
          <button
            type="button"
            onClick={onExportGntExcel}
            disabled={!gntStats || gntStats.count === 0}
            className="h-8 px-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium rounded-lg flex items-center space-x-1.5 transition-colors cursor-pointer shadow-2xs disabled:opacity-40"
            title="Xuất danh sách Giấy Nộp Tiền ra file Excel"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
            <span>Xuất Excel</span>
          </button>
        )}

        {/* Primary CTA — Nổi bật, sắc nét và đồng bộ chiều cao h-8 */}
        <button
          type="button"
          onClick={onStartScan}
          disabled={isScanning}
          className={`h-8 px-4 rounded-lg font-semibold text-xs flex items-center justify-center space-x-1.5 transition-all shadow-xs shrink-0 select-none ${
            isScanning
              ? 'bg-teal-800 text-teal-100 cursor-wait border border-teal-700/60 shadow-inner'
              : 'bg-teal-700 hover:bg-teal-600 active:bg-teal-800 active:scale-[0.98] text-white hover:shadow-sm cursor-pointer border border-teal-800/30'
          }`}
        >
          {isScanning ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin text-teal-200 shrink-0" />
              <span>{isGntMode ? 'Đang tra cứu…' : 'Đang quét…'}</span>
            </>
          ) : isGntMode ? (
            <>
              <Search className="w-3.5 h-3.5 text-teal-200 shrink-0" />
              <span>Tra cứu GNT</span>
            </>
          ) : (
            <>
              <FileText className="w-3.5 h-3.5 text-teal-200 shrink-0" />
              <span>Quét hồ sơ thuế</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

import React from 'react';
import { FileSpreadsheet, FileText, ArrowUpRight, CheckCircle2 } from 'lucide-react';
import { TaxFiling } from '../../shared/types';

interface MetricCardsRibbonProps {
  filings: TaxFiling[];
  onAnalyzeVat?: () => void;
  onAnalyzePit?: () => void;
  onOpenFolder?: () => void;
}

export const MetricCardsRibbon: React.FC<MetricCardsRibbonProps> = ({
  filings,
  onAnalyzeVat,
  onAnalyzePit
}) => {
  const vatFilings = filings.filter(f => f.taxType === 'VAT');
  const pitFilings = filings.filter(f => f.taxType === 'PIT');

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 shrink-0 select-none">
      {/* Card 1: SOÁT XÉT THUẾ GTGT */}
      <div
        onClick={() => onAnalyzeVat && onAnalyzeVat()}
        className="p-3.5 rounded-xl border border-slate-200/90 bg-white hover:border-teal-500 hover:shadow-xs transition-all cursor-pointer relative overflow-hidden group"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-teal-50 text-teal-700 group-hover:bg-teal-700 group-hover:text-white transition-colors">
              <FileSpreadsheet className="w-4.5 h-4.5" />
            </div>
            <div>
              <span className="text-[12px] font-bold text-slate-500 tracking-wider uppercase block leading-tight">
                SOÁT XÉT THUẾ GTGT
              </span>
              <span className="text-[15px] font-bold text-slate-900 mt-0.5 block">
                {vatFilings.length > 0 ? `${vatFilings.length} tờ khai GTGT đã quét` : 'Phân tích chuỗi tờ khai GTGT'}
              </span>
            </div>
          </div>
          <div className="flex items-center space-x-1 text-slate-400 group-hover:text-teal-700 transition-colors">
            <span className="text-xs font-semibold">Working Paper</span>
            <ArrowUpRight className="w-4 h-4 text-slate-300 group-hover:text-teal-700" />
          </div>
        </div>
        <div className="mt-2.5 text-[12px] text-slate-600 truncate flex items-center justify-between">
          <span className="text-slate-500">Soát xét chuỗi tờ khai chính thức & bổ sung, đối chiếu chỉ tiêu phát sinh</span>
          <span className="text-teal-700 font-semibold flex items-center space-x-0.5 shrink-0 ml-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-teal-600 inline mr-1" />
            <span>Mở phân tích →</span>
          </span>
        </div>
      </div>

      {/* Card 2: SOÁT XÉT THUẾ TNCN */}
      <div
        onClick={() => onAnalyzePit && onAnalyzePit()}
        className="p-3.5 rounded-xl border border-slate-200/90 bg-white hover:border-teal-500 hover:shadow-xs transition-all cursor-pointer relative overflow-hidden group"
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-emerald-50 text-emerald-700 group-hover:bg-teal-700 group-hover:text-white transition-colors">
              <FileText className="w-4.5 h-4.5" />
            </div>
            <div>
              <span className="text-[12px] font-bold text-slate-500 tracking-wider uppercase block leading-tight">
                SOÁT XÉT THUẾ TNCN
              </span>
              <span className="text-[15px] font-bold text-slate-900 mt-0.5 block">
                {pitFilings.length > 0 ? `${pitFilings.length} tờ khai TNCN đã quét` : 'Phân tích quyết toán & khấu trừ'}
              </span>
            </div>
          </div>
          <div className="flex items-center space-x-1 text-slate-400 group-hover:text-teal-700 transition-colors">
            <span className="text-xs font-semibold">Bảng kê TNCN</span>
            <ArrowUpRight className="w-4 h-4 text-slate-300 group-hover:text-teal-700" />
          </div>
        </div>
        <div className="mt-2.5 text-[12px] text-slate-600 truncate flex items-center justify-between">
          <span className="text-slate-500">Tổng hợp tờ khai khấu trừ 05/KK & quyết toán năm 05/QTT-TNCN</span>
          <span className="text-teal-700 font-semibold flex items-center space-x-0.5 shrink-0 ml-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-teal-600 inline mr-1" />
            <span>Mở phân tích →</span>
          </span>
        </div>
      </div>
    </div>
  );
};

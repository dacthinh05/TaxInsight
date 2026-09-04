import React from 'react';
import { TaxType } from '../../shared/types';

interface FilingTabsProps {
  selectedTab: TaxType;
  onTabChange: (tab: TaxType) => void;
  counts: {
    ALL: number;
    VAT: number;
    REFUND: number;
    PIT: number;
    CIT: number;
    FCT: number;
    HOUSE_LAND: number;
    REPORT?: number;
    OTHER?: number;
  };
  gntCount?: number;
  onSwitchToGnt?: () => void;
}

export const FilingTabs: React.FC<FilingTabsProps> = ({
  selectedTab,
  onTabChange,
  counts,
  gntCount = 0,
  onSwitchToGnt
}) => {
  const otherCount = (counts.REPORT || 0) + (counts.OTHER || 0);
  const tabs: { key: TaxType; label: string; count: number }[] = [
    { key: 'ALL', label: 'Tất cả tờ khai', count: counts.ALL },
    { key: 'VAT', label: 'GTGT', count: counts.VAT },
    { key: 'PIT', label: 'TNCN', count: counts.PIT },
    { key: 'CIT', label: 'TNDN', count: counts.CIT },
    { key: 'FCT', label: 'Nhà thầu (FCT)', count: counts.FCT },
    { key: 'HOUSE_LAND', label: 'Thuê đất / Nhà đất', count: counts.HOUSE_LAND },
    { key: 'REFUND', label: 'Hoàn thuế', count: counts.REFUND }
  ];
  if (otherCount > 0) {
    tabs.push({ key: 'OTHER', label: 'Hồ sơ khác', count: otherCount });
  }

  return (
    <div className="flex items-center justify-between border-b border-slate-200/90 px-5 bg-slate-50/40 select-none">
      {/* Segmented Underline Tabs - Kích thước lớn hơn, sang trọng và dễ bấm */}
      <div className="flex items-center space-x-7 overflow-x-auto no-scrollbar">
        {tabs.map(tab => {
          const isActive = selectedTab === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange(tab.key)}
              className={`py-3.5 text-[13.5px] font-medium transition-colors relative flex items-center space-x-2 cursor-pointer shrink-0 ${
                isActive
                  ? 'text-teal-900 font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/50'
              }`}
            >
              <span className="tracking-tight">{tab.label}</span>
              {tab.count > 0 && (
                <span
                  className={`text-xs font-mono tabular-nums px-2 py-0.5 rounded-full ${
                    isActive ? 'bg-teal-100/80 text-teal-900 font-bold' : 'bg-slate-200/70 text-slate-600 font-medium'
                  }`}
                >
                  {tab.count}
                </span>
              )}
              {isActive && (
                <div className="absolute bottom-0 left-0 right-0 h-[2.5px] bg-teal-700 rounded-full" />
              )}
            </button>
          );
        })}

        {/* Core v2.0: Phân loại theo sắc thuế tờ khai */}
      </div>
    </div>
  );
};

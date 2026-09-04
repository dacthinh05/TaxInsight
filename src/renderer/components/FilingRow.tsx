import React from 'react';
import { Check, CheckSquare, Eye, MoreHorizontal, Square } from 'lucide-react';
import { formatCompactPeriod, getFilingDisplayName } from '../../shared/dateUtils';
import { TaxFiling } from '../../shared/types';

interface FilingRowProps {
  filing: TaxFiling;
  index: number;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onPreview: (filing: TaxFiling) => void;
  isGroupStart?: boolean;
  viewMode?: 'LIST' | 'BY_PERIOD';
  isFirstInGroup?: boolean;
  isLastInGroup?: boolean;
  groupTotalItems?: number;
}

export const FilingRow: React.FC<FilingRowProps> = ({
  filing,
  isSelected,
  onToggleSelect,
  onPreview,
  isGroupStart = false,
  viewMode = 'LIST',
  isFirstInGroup = false,
  isLastInGroup = false,
  groupTotalItems = 1
}) => {
  // Presentation mapping cho tiêu đề ngắn gọn chuẩn kế toán
  const displayInfo = getFilingDisplayName(filing);

  // Format ngày nộp
  let datePart = '—';
  let timePart = '';
  if (filing.submittedAt) {
    const parts = filing.submittedAt.split(' ');
    datePart = parts[0] || '—';
    timePart = parts[1] || '';
  }

  // Trạng thái xử lý
  const statusText = filing.status || 'Đã tiếp nhận';
  const isRejectedStatus =
    statusText.includes('từ chối') ||
    statusText.includes('lỗi') ||
    statusText.includes('không chấp nhận') ||
    statusText.includes('không hợp lệ');
  const isPendingStatus =
    statusText.includes('chờ') ||
    statusText.includes('tiếp nhận') ||
    statusText.includes('giải quyết');

  // Kỳ kê khai rút gọn
  const compactPeriod = formatCompactPeriod(filing);

  // Primary title
  const primaryTitle =
    filing.taxType === 'VAT'
      ? filing.filingType === 'SUPPLEMENTAL'
        ? 'Khai bổ sung GTGT'
        : 'Khai thuế GTGT'
      : displayInfo.primaryTitle;

  // Secondary relation text
  let relationMeta = '';
  if (filing.taxType === 'VAT') {
    if (viewMode === 'BY_PERIOD') {
      relationMeta = `${filing.declarationCode || '01/GTGT'} · ${
        filing.filingType === 'SUPPLEMENTAL'
          ? `Bổ sung lần ${filing.supplementalNo || 1}`
          : 'Bản chính thức'
      }`;
    } else {
      relationMeta = `${filing.declarationCode || '01/GTGT'} · Kỳ ${compactPeriod}${
        filing.filingType === 'SUPPLEMENTAL' ? ` · Lần ${filing.supplementalNo || 1}` : ''
      }`;
    }
  } else {
    relationMeta = displayInfo.detailText || (filing.declarationCode ? `Mẫu ${filing.declarationCode}` : '');
  }

  const isDownloaded = filing.downloadStatus === 'COMPLETED' || filing.downloadStatus === 'EXISTING';

  return (
    <tr
      tabIndex={0}
      onDoubleClick={() => onPreview(filing)}
      onKeyDown={e => {
        const tag = (document.activeElement?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        if (e.key === 'Enter') {
          e.preventDefault();
          onPreview(filing);
        }
      }}
      className={`group h-[50px] transition-colors border-b border-slate-100 select-none text-xs ${
        isGroupStart ? 'border-t border-slate-200/90' : ''
      } ${
        isSelected
          ? 'bg-teal-50/70 border-l-[3px] border-l-teal-600'
          : 'hover:bg-slate-50/90 bg-white'
      }`}
    >
      {/* 1. Checkbox */}
      <td
        className="w-10 px-3 py-2 text-center"
        onClick={e => {
          e.stopPropagation();
          onToggleSelect(filing.id);
        }}
      >
        <button
          type="button"
          className="text-slate-400 hover:text-teal-700 transition-colors flex items-center justify-center cursor-pointer"
        >
          {isSelected ? (
            <CheckSquare className="w-4 h-4 text-teal-700" />
          ) : (
            <Square className="w-4 h-4 text-slate-300" />
          )}
        </button>
      </td>

      {/* 2. Cột Kỳ kê khai (chỉ hiện ở chế độ LIST) */}
      {viewMode === 'LIST' && (
        <td className="w-32 px-3 py-2 font-medium text-slate-800 text-[13.5px] tabular-nums whitespace-nowrap">
          {compactPeriod !== '—' ? (
            <span className="font-bold text-slate-900 font-mono">{compactPeriod}</span>
          ) : (
            <span className="text-slate-300 select-none font-normal">—</span>
          )}
        </td>
      )}

      {/* 3. Hồ sơ / Tờ khai (Typography 14.5px nổi bật + Secondary 12.5px) */}
      <td className="px-3.5 py-2 min-w-[380px] lg:min-w-[420px]">
        <div
          className="cursor-pointer hover:text-teal-900 flex flex-col justify-center"
          title={`Tên đầy đủ: ${filing.title}\nID: ${filing.id}`}
          onClick={() => onPreview(filing)}
        >
          <div className="font-semibold text-slate-900 text-[14.5px] leading-tight truncate flex items-center space-x-1.5">
            {viewMode === 'BY_PERIOD' && groupTotalItems > 1 && (
              <span className="text-slate-400 font-mono text-[13px] font-bold shrink-0">
                {isLastInGroup ? '└─' : '├─'}
              </span>
            )}
            <span className="truncate">{primaryTitle}</span>
          </div>
          {relationMeta && (
            <div className="text-[12.5px] text-slate-500 font-mono flex items-center space-x-1 mt-1">
              <span className="truncate">{relationMeta}</span>
              {filing.isSequenceInferred && (
                <span className="text-[11px] text-slate-400 font-sans italic" title="Số lần bổ sung suy luận từ trình tự nộp">
                  (suy luận)
                </span>
              )}
            </div>
          )}
        </div>
      </td>

      {/* 4. Mẫu biểu */}
      <td className="w-[100px] px-3 py-2 whitespace-nowrap">
        {filing.declarationCode ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-[12px] font-mono font-semibold text-slate-700">
            {filing.declarationCode}
          </span>
        ) : filing.procedureCode ? (
          <span className="text-[11.5px] font-mono text-slate-500">
            {filing.procedureCode}
          </span>
        ) : (
          <span className="text-slate-300 select-none text-[12px]">—</span>
        )}
      </td>

      {/* 5. Loại hồ sơ / Phiên bản */}
      <td className="w-[140px] px-3 py-2 whitespace-nowrap">
        {filing.filingType === 'SUPPLEMENTAL' ? (
          <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-medium bg-amber-50 text-amber-800 border border-amber-200">
            Bổ sung lần {filing.supplementalNo || 1}
          </span>
        ) : filing.filingType === 'FINALIZATION' ? (
          <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-medium bg-purple-50 text-purple-700 border border-purple-200">
            Quyết toán
          </span>
        ) : filing.filingType === 'REFUND' ? (
          <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-medium bg-cyan-50 text-cyan-700 border border-cyan-200">
            Hoàn thuế
          </span>
        ) : (
          <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
            Chính thức
          </span>
        )}
      </td>

      {/* 6. Ngày nộp */}
      <td className="w-[160px] px-3 py-2 text-slate-700 text-[13px] font-mono tabular-nums whitespace-nowrap" title={timePart ? `Thời gian: ${timePart}` : undefined}>
        {filing.submittedAt || datePart}
      </td>

      {/* 7. Trạng thái */}
      {/* 7. Trạng thái */}
      <td className="w-[150px] px-3 py-2 whitespace-nowrap">
        <span
          className={`inline-flex items-center h-6 px-2.5 rounded-full text-[11.5px] font-semibold tracking-tight ${
            isRejectedStatus
              ? 'bg-rose-50 text-rose-700 border border-rose-200'
              : isPendingStatus
              ? 'bg-amber-50 text-amber-700 border border-amber-200'
              : statusText.includes('kết quả')
              ? 'bg-sky-50 text-sky-700 border border-sky-200'
              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
          }`}
          title={statusText}
        >
          {statusText}
        </span>
      </td>
      {/* 8. Action (Cố định 68px, có icon tải ✓ và nút 👁 xem nhanh luôn rõ ràng) */}
      <td className="w-[68px] px-2 py-2 text-center sticky right-0 bg-inherit whitespace-nowrap">
        <div className="flex items-center justify-center space-x-1">
          {isDownloaded && (
            <span title="Đã tải về máy" className="text-teal-700 inline-flex items-center">
              <Check className="w-3.5 h-3.5 stroke-[2.5]" />
            </span>
          )}
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              onPreview(filing);
            }}
            className="h-7.5 w-7.5 rounded-lg hover:bg-teal-100/70 text-slate-400 hover:text-teal-800 inline-flex items-center justify-center transition-colors cursor-pointer btn-press"
            title="Xem chi tiết tờ khai (Enter hoặc nhấp đúp)"
          >
            <Eye className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
};

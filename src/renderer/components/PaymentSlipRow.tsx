import React from 'react';
import { Eye, CheckSquare, Square } from 'lucide-react';
import { PaymentSlipRecord } from '../../shared/types';
import {
  SLIP_RECON_META,
  formatDateShort,
  formatKyThueShort,
  getSlipReconTooltip,
  getSlipStatusView,
  SlipReconInfo
} from '../../shared/paymentSlipAudit';
import { getTaxTypeLabel } from '../../shared/declarationFormatter';

interface PaymentSlipRowProps {
  slip: PaymentSlipRecord;
  reconInfo?: SlipReconInfo;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onViewDetail: (slip: PaymentSlipRecord) => void;
}

export const PaymentSlipRow: React.FC<PaymentSlipRowProps> = ({
  slip,
  reconInfo,
  isSelected,
  onToggleSelect,
  onViewDetail
}) => {
  const statusView = getSlipStatusView(slip);
  const reconMeta = reconInfo ? SLIP_RECON_META[reconInfo.status] : null;

  const taxTypes = slip.classification?.taxTypes ?? [];
  const periods = slip.classification?.periods.map(formatKyThueShort) ?? [];
  const uniquePeriods = [...new Set(periods)];

  return (
    <tr
      className={`py-1 border-b border-slate-100 transition-colors text-xs select-none ${
        isSelected ? 'bg-teal-50/60 hover:bg-teal-50/80' : 'hover:bg-slate-50/80'
      }`}
    >
      {/* 1. Checkbox */}
      <td className="w-9 px-2.5 text-center">
        <button
          type="button"
          onClick={() => onToggleSelect(slip.id)}
          className="text-slate-400 hover:text-teal-700 transition-colors flex items-center justify-center cursor-pointer"
        >
          {isSelected ? (
            <CheckSquare className="w-4 h-4 text-teal-700" />
          ) : (
            <Square className="w-4 h-4 text-slate-300" />
          )}
        </button>
      </td>

      {/* 2. Ngày nộp */}
      <td className="px-2.5 font-mono text-[11px] text-slate-700 whitespace-nowrap" title={slip.ngayNopThue || slip.ngayLapGnt}>
        {formatDateShort(slip.ngayNopThue || slip.ngayLapGnt)}
      </td>

      {/* 3. Số GNT (primary) / Mã GD (secondary) */}
      <td className="px-2.5 min-w-[220px]">
        <button
          type="button"
          onClick={() => onViewDetail(slip)}
          className="block max-w-[240px] truncate font-medium font-mono text-[11.5px] text-slate-900 hover:text-teal-800 hover:underline cursor-pointer text-left"
          title={`Xem chi tiết & đối chiếu · ${slip.soGnt}`}
        >
          {slip.soGnt}
        </button>
        <div className="text-[10px] text-slate-400 font-mono truncate max-w-[240px]">
          {slip.maGiaoDich}
        </div>
      </td>

      {/* 4. Loại thuế */}
      <td className="px-2.5">
        {taxTypes.length > 0 ? (
          <div className="flex items-center gap-1" title={taxTypes.map(t => getTaxTypeLabel(t).vietnameseName).join(', ')}>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border whitespace-nowrap ${getTaxTypeLabel(taxTypes[0]).badgeClass}`}>
              {getTaxTypeLabel(taxTypes[0]).shortLabel}
            </span>
            {taxTypes.length > 1 && (
              <span className="text-[9.5px] font-semibold text-slate-500">+{taxTypes.length - 1}</span>
            )}
          </div>
        ) : (
          <span
            className={slip.classification ? 'text-slate-300' : 'text-slate-300 animate-pulse'}
            title={
              slip.classification
                ? 'Chi tiết C1-02 không chứa khoản nộp phân loại được'
                : 'Đang tải chi tiết C1-02 để xác định loại thuế / kỳ thuế…'
            }
          >
            —
          </span>
        )}
      </td>

      {/* 5. Kỳ thuế */}
      <td className="px-2.5 font-mono text-[11px] text-slate-700 whitespace-nowrap" title={uniquePeriods.join('; ') || undefined}>
        {uniquePeriods.length > 0 ? (
          <>
            {uniquePeriods[0]}
            {uniquePeriods.length > 1 && (
              <span className="text-slate-400 font-sans"> +{uniquePeriods.length - 1}</span>
            )}
          </>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>

      {/* 6. Số tiền */}
      <td className="px-2.5 text-right font-mono font-semibold text-slate-900 whitespace-nowrap tabular-nums" title={`${slip.soTienFormatted} ${slip.loaiTien}`}>
        {slip.soTienFormatted}
        {slip.loaiTien !== 'VND' && <span className="text-[10px] font-normal text-slate-500 ml-0.5">{slip.loaiTien}</span>}
      </td>

      {/* 7. Đối chiếu nghĩa vụ */}
      <td className="px-2.5 whitespace-nowrap">
        {reconInfo && reconMeta ? (
          <span
            className={`inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-full text-[10.5px] font-medium border cursor-help ${reconMeta.badgeClass}`}
            title={getSlipReconTooltip(reconInfo)}
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${reconMeta.dotClass}`} />
            {reconMeta.label}
          </span>
        ) : (
          <span className="text-slate-300 text-[11px]">—</span>
        )}
      </td>

      {/* 8. Trạng thái thanh toán */}
      <td className="px-2.5 whitespace-nowrap">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-medium border cursor-help ${statusView.badgeClass}`}
          title={statusView.tooltip}
        >
          {statusView.label}
        </span>
      </td>

      {/* 9. Xem chi tiết */}
      <td className="w-11 px-1.5 sticky right-0 bg-white group-hover:bg-slate-50/80">
        <button
          type="button"
          onClick={() => onViewDetail(slip)}
          title="Mở side panel: chi tiết GNT + đối chiếu nghĩa vụ"
          className="p-1.5 text-slate-400 hover:text-teal-700 hover:bg-teal-50 rounded-md transition-colors cursor-pointer inline-flex items-center justify-center"
        >
          <Eye className="w-3.5 h-3.5" />
        </button>
      </td>
    </tr>
  );
};

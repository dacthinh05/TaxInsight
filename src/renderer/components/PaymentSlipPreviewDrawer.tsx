import React, { useEffect, useState } from 'react';
import { X, Printer, CheckCircle2, ShieldCheck, Loader2, FileText, Scale, AlertTriangle, ArrowLeftRight, FolderOpen } from 'lucide-react';
import { PaymentSlipDetail, PaymentSlipRecord } from '../../shared/types';
import {
  SLIP_RECON_META,
  getSlipReconTooltip,
  getSlipStatusView,
  SlipReconInfo
} from '../../shared/paymentSlipAudit';

interface PaymentSlipPreviewDrawerProps {
  slip: PaymentSlipRecord | null;
  reconInfo?: SlipReconInfo;
  isOpen: boolean;
  onClose: () => void;
}

const fmtBig = (n: bigint) => n.toLocaleString('vi-VN');

/** Verdict banner của khối ĐỐI CHIẾU */
const ReconVerdictBadge: React.FC<{ info: SlipReconInfo }> = ({ info }) => {
  switch (info.status) {
    case 'MATCHED':
      return (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span className="text-[11.5px] font-bold tracking-wide text-emerald-800">✓ KHỚP NGHĨA VỤ</span>
        </div>
      );
    case 'PARTIAL':
      return (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
          <span className="text-[11.5px] font-bold tracking-wide text-amber-800">
            ◐ KHỚP MỘT PHẦN · còn thiếu {fmtBig(info.slipAmount - info.allocatedAmount)} ₫
          </span>
        </div>
      );
    case 'DUPLICATE_SUSPECT':
      return (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-orange-50 border border-orange-300">
          <AlertTriangle className="w-4 h-4 text-orange-600 shrink-0" />
          <span className="text-[11.5px] font-bold tracking-wide text-orange-800">⚠ NGHI VẤN NỘP TRÙNG</span>
        </div>
      );
    case 'UNMATCHED':
      return (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 border border-slate-300">
          <Scale className="w-4 h-4 text-slate-500 shrink-0" />
          <span className="text-[11.5px] font-bold tracking-wide text-slate-700">○ CHƯA KHỚP NGHĨA VỤ NÀO</span>
        </div>
      );
    default:
      return (
        <div className="px-3 py-2 rounded-lg bg-slate-50 border border-dashed border-slate-300">
          <span className="text-[11.5px] text-slate-500">{info.reasonUnknown}</span>
        </div>
      );
  }
};

export const PaymentSlipPreviewDrawer: React.FC<PaymentSlipPreviewDrawerProps> = ({
  slip,
  reconInfo,
  isOpen,
  onClose
}) => {
  const [detail, setDetail] = useState<PaymentSlipDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [exportSuccessMsg, setExportSuccessMsg] = useState<string | null>(null);
  // Thư mục chứa PDF GNT đã xuất — cho nút "Mở thư mục" truy cập nhanh
  const [exportedFolder, setExportedFolder] = useState<string | null>(null);
  // 'overview': side panel tổng quan + đối chiếu | 'doc': bản gốc C1-02/NS
  const [view, setView] = useState<'overview' | 'doc'>('overview');

  useEffect(() => {
    if (!isOpen || !slip) {
      setDetail(null);
      setError(null);
      setView('overview');
      setExportedFolder(null);
      return;
    }
    setView('overview');

    let isMounted = true;
    setLoading(true);
    setError(null);

    window.taxPortalAPI
      .getPaymentSlipDetail({ ctuId: slip.id, soGnt: slip.soGnt, maGiaoDich: slip.maGiaoDich })
      .then(res => {
        if (!isMounted) return;
        if (res.success && res.detail) {
          setDetail(res.detail);
        } else {
          setError(res.error || 'Không thể lấy chi tiết Giấy Nộp Tiền từ eTax');
        }
      })
      .catch(err => {
        if (!isMounted) return;
        setError(err.message || 'Lỗi kết nối khi tải chi tiết');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, slip]);

  if (!isOpen || !slip) return null;

  const statusView = getSlipStatusView(slip);

  const handleExportPdf = async () => {
    if (!slip) return;
    setIsExportingPdf(true);
    setExportSuccessMsg(null);
    try {
      const res = await window.taxPortalAPI.exportPaymentSlipPdf({ ctuId: slip.id });
      if (res.success) {
        setExportSuccessMsg(`Đã lưu file PDF: ${res.fileName}`);
        if (res.folderPath) setExportedFolder(res.folderPath);
        setTimeout(() => setExportSuccessMsg(null), 6000);
      } else {
        alert(`Lỗi khi xuất file PDF: ${res.error}`);
      }
    } catch (err: any) {
      alert(`Lỗi khi xuất file PDF: ${err.message}`);
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Tổng nghĩa vụ liên quan & chênh lệch (khi đã có dữ liệu đối chiếu)
  const totalPayableOfRefs = reconInfo
    ? reconInfo.obligations.reduce((acc, o) => acc + o.payableAmount, 0n)
    : 0n;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden flex justify-end bg-slate-900/40 backdrop-blur-2xs transition-opacity animate-in fade-in duration-200">
      <div
        className={`w-full ${view === 'doc' ? 'max-w-4xl' : 'max-w-xl'} bg-white h-full shadow-2xl flex flex-col border-l border-slate-200`}
      >
        {/* Drawer Header */}
        <div className="h-14 px-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/80 shrink-0">
          <div className="flex items-center space-x-2.5 min-w-0">
            <span className="w-7 h-7 rounded-lg bg-teal-100 text-teal-800 font-bold text-[10px] flex items-center justify-center shrink-0">
              GNT
            </span>
            <div className="min-w-0">
              <h2 className="font-semibold text-slate-800 text-sm leading-tight">
                {view === 'overview' ? 'Chi tiết Giấy Nộp Tiền' : 'Giấy Nộp Tiền vào NSNN (C1-02/NS)'}
              </h2>
              <div className="text-[10.5px] text-slate-500 font-mono truncate">
                {slip.soGnt}
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-1.5 shrink-0">
            {exportSuccessMsg && (
              <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md mr-1">
                {exportSuccessMsg}
              </span>
            )}

            {/* Mở nhanh thư mục chứa PDF Giấy nộp tiền đã xuất */}
            {exportedFolder && (
              <button
                type="button"
                onClick={() => window.taxPortalAPI?.openPath(exportedFolder)}
                className="h-8 px-3 rounded-lg border border-slate-300 text-slate-700 hover:bg-white hover:border-teal-500 hover:text-teal-800 text-xs font-medium flex items-center space-x-1.5 transition-colors cursor-pointer"
                title="Mở thư mục chứa file PDF Giấy nộp tiền đã lưu"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Mở thư mục</span>
              </button>
            )}

            {view === 'overview' ? (
              <>
                <button
                  type="button"
                  onClick={() => setView('doc')}
                  disabled={loading || Boolean(error)}
                  className="h-8 px-3 rounded-lg border border-slate-300 text-slate-700 hover:bg-white hover:border-teal-500 hover:text-teal-800 text-xs font-medium flex items-center space-x-1.5 transition-colors cursor-pointer disabled:opacity-40"
                  title="Xem đúng biểu mẫu Giấy Nộp Tiền gốc tải từ eTax"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Xem chứng từ</span>
                </button>
                <button
                  type="button"
                  onClick={handleExportPdf}
                  disabled={isExportingPdf || loading}
                  className="h-8 px-3 rounded-lg bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white text-xs font-medium flex items-center space-x-1.5 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
                  title="Lưu file PDF giấy nộp tiền (Mẫu C1-02/NS)"
                >
                  {isExportingPdf ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Printer className="w-3.5 h-3.5" />
                  )}
                  <span>{isExportingPdf ? 'Đang lưu…' : 'Xuất C1-02/NS'}</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleExportPdf}
                  disabled={isExportingPdf || loading}
                  className="h-8 px-3 rounded-lg bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white text-xs font-medium flex items-center space-x-1.5 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
                  title="Lưu file PDF Giấy Nộp Tiền (Mẫu C1-02/NS) vào máy"
                >
                  {isExportingPdf ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Printer className="w-3.5 h-3.5" />
                  )}
                  <span>{isExportingPdf ? 'Đang lưu…' : 'Tải PDF'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="h-8 px-3 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-medium flex items-center space-x-1.5 transition-colors cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5 text-slate-500" />
                  <span>In</span>
                </button>
                <button
                  type="button"
                  onClick={() => setView('overview')}
                  className="h-8 px-3 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium flex items-center space-x-1.5 transition-colors cursor-pointer shadow-xs"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  <span>Quay lại đối chiếu</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className={`flex-1 overflow-y-auto ${view === 'overview' ? 'bg-slate-50 p-5 space-y-4 print:hidden' : 'bg-slate-100/50 p-8'}`}>
          {/* ═══════════ OVERVIEW SIDE PANEL ═══════════ */}
          {view === 'overview' ? (
            <>
              {/* Status strip */}
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold border ${statusView.badgeClass}`}
                  title={statusView.tooltip}
                >
                  {statusView.label}
                </span>
                <span
                  className={`font-mono text-sm font-bold tabular-nums ${detail?.suspectedMismatch ? 'text-rose-700 line-through decoration-rose-400' : 'text-slate-900'}`}
                  title={`${!detail?.suspectedMismatch ? (detail?.tongTienVND || slip.soTienFormatted) : slip.soTienFormatted} ${slip.loaiTien}`}
                >
                  {!detail?.suspectedMismatch ? (detail?.tongTienVND || slip.soTienFormatted) : slip.soTienFormatted} ₫
                </span>
              </div>

              {/* CẢNH BÁO: chi tiết trả về không khớp GNT đang chọn */}
              {detail?.suspectedMismatch && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-rose-50 border border-rose-300 text-[11.5px] text-rose-800">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Chi tiết trả về KHÔNG khớp giấy nộp tiền đang chọn</span> — số tham chiếu trên chứng từ ({detail.soThamChieu || '—'}) khác mã giao dịch của GNT này ({slip.maGiaoDich || '—'}). App đã tự làm mới phiên eTax và tải lại nhưng máy chủ vẫn trả chứng từ khác. Số liệu bên dưới CÓ THỂ của chứng từ khác — vui lòng đóng drawer, mở lại, hoặc đăng nhập lại eTax.
                  </div>
                </div>
              )}

              {/* ─── Section: Chi tiết GNT ─── */}
              <section className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
                <header className="px-4 pt-3 pb-2 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
                  <FileText className="w-3.5 h-3.5 text-teal-700" />
                  Chi tiết Giấy Nộp Tiền
                </header>
                <dl className="px-4 pb-3 divide-y divide-slate-100 text-xs">
                  {[
                    ['Số GNT', slip.soGnt],
                    ['Mã giao dịch', slip.maGiaoDich],
                    ['Số chứng từ', detail?.soChungTu || slip.soChungTu || '—'],
                    ['Ngày nộp', slip.ngayNopThue || slip.ngayGuiGnt || slip.ngayLapGnt || '—'],
                    [
                      'Ngân hàng / TK trích',
                      [slip.tenNganHang, slip.soTaiKhoan ? `TK ${slip.soTaiKhoan}` : ''].filter(Boolean).join(' · ') || '—'
                    ],
                    ...(slip.hinhThucNop ? [['Hình thức', slip.hinhThucNop]] : []),
                    ...(detail?.coQuanQuanLyThu ? [['Cơ quan thuế QL', detail.coQuanQuanLyThu]] : [])
                  ].map(([label, value]) => (
                    <div key={label} className="py-1.5 grid grid-cols-[110px_1fr] gap-2">
                      <dt className="text-slate-400 text-[10.5px] uppercase tracking-wide pt-0.5">{label}</dt>
                      <dd className={`text-slate-800 break-all ${/^[\d/:\s]+$/.test(value) ? 'font-mono' : ''}`}>{value}</dd>
                    </div>
                  ))}
                </dl>
              </section>

              {/* ─── Section: Nội dung nộp NSNN ─── */}
              <section className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
                <header className="px-4 pt-3 pb-2 flex items-center justify-between text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-teal-700" />
                    Nội dung nộp NSNN
                  </span>
                  {detail && (
                    <span className="font-normal normal-case tracking-normal text-slate-400">
                      Người nộp: {detail.nguoiNopThue} · MST {detail.maSoThue}
                    </span>
                  )}
                </header>

                {!detail ? (
                  <div className="px-4 pb-4 text-[11px] text-slate-400">
                    {loading ? 'Đang tải chi tiết khoản nộp từ eTax…' : `Không đọc được nội dung chi tiết: ${error || '—'}`}
                  </div>
                ) : (
                  <table className="w-full border-collapse text-[11px] mb-1">
                    <thead>
                      <tr className="border-y border-slate-200 bg-slate-50 text-slate-500 font-semibold">
                        <th className="px-4 py-1.5 text-left w-16">Tiểu mục</th>
                        <th className="px-1 py-1.5 text-left w-12">Chương</th>
                        <th className="px-1 py-1.5 text-left">Kỳ thuế</th>
                        <th className="px-1 py-1.5 text-right pr-4">Số tiền (₫)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(detail.items.length > 0 ? detail.items : [{
                        stt: 1,
                        maNDKT: '',
                        maChuong: '',
                        kyThueNgayQd: '',
                        noiDungKhoanNop: 'Khoản nộp thuế vào NSNN',
                        soTienVND: slip.soTienFormatted
                      }]).map((item, idx) => (
                        <tr key={idx}>
                          <td className="px-4 py-1.5 font-mono font-semibold text-teal-800">{item.maNDKT || '—'}</td>
                          <td className="px-1 py-1.5 font-mono text-slate-600">{item.maChuong || '—'}</td>
                          <td className="px-1 py-1.5 text-slate-700">
                            <div className="truncate max-w-[220px]" title={`${item.noiDungKhoanNop || ''}${item.kyThueNgayQd ? ` · Kỳ: ${item.kyThueNgayQd}` : ''}`}>
                              {item.kyThueNgayQd || item.noiDungKhoanNop || '—'}
                            </div>
                          </td>
                          <td className="px-1 py-1.5 pr-4 text-right font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                            {item.soTienVND}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-slate-200 bg-slate-50/70 font-bold">
                        <td colSpan={3} className="px-4 py-1.5 text-right text-slate-500 uppercase text-[10.5px]">Tổng</td>
                        <td className="px-1 py-1.5 pr-4 text-right font-mono text-teal-900 tabular-nums whitespace-nowrap">
                          {detail.tongTienVND || slip.soTienFormatted}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                )}
              </section>

              {/* ─── Section: Đối chiếu ─── */}
              <section className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden">
                <header className="px-4 pt-3 pb-2 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
                  <Scale className="w-3.5 h-3.5 text-teal-700" />
                  Đối chiếu nghĩa vụ thuế
                </header>

                {!reconInfo ? (
                  <div className="px-4 pb-4 text-[11px] text-slate-400">Chưa có dữ liệu đối chiếu.</div>
                ) : (
                  <div className="px-4 pb-4 space-y-3">
                    {reconInfo.status !== 'UNKNOWN' && (
                      <dl className="grid grid-cols-3 gap-2 text-xs">
                        <div className="rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-2">
                          <dt className="text-[10px] uppercase tracking-wide text-slate-400">Nghĩa vụ</dt>
                          <dd className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                            {fmtBig(totalPayableOfRefs)}
                          </dd>
                        </div>
                        <div className="rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-2">
                          <dt className="text-[10px] uppercase tracking-wide text-slate-400">Đã nộp (quy về)</dt>
                          <dd className="font-mono font-semibold text-slate-900 tabular-nums mt-0.5">
                            {fmtBig(reconInfo.allocatedAmount)}
                          </dd>
                        </div>
                        <div
                          className={`rounded-lg border px-2.5 py-2 ${
                            reconInfo.status === 'MATCHED'
                              ? 'bg-emerald-50 border-emerald-200'
                              : 'bg-amber-50 border-amber-200'
                          }`}
                        >
                          <dt className="text-[10px] uppercase tracking-wide text-slate-400">Chênh lệch</dt>
                          <dd
                            className={`font-mono font-bold tabular-nums mt-0.5 ${
                              totalPayableOfRefs === reconInfo.allocatedAmount ? 'text-emerald-700' : 'text-amber-700'
                            }`}
                            title={getSlipReconTooltip(reconInfo)}
                          >
                            {fmtBig(totalPayableOfRefs - reconInfo.allocatedAmount)}
                          </dd>
                        </div>
                      </dl>
                    )}

                    <ReconVerdictBadge info={reconInfo} />

                    {reconInfo.status === 'DUPLICATE_SUSPECT' && (
                      <p className="text-[11px] text-orange-800 leading-relaxed">
                        Có {reconInfo.duplicateWith.length + 1} GNT cùng số tiền{' '}
                        <strong className="font-mono">{fmtBig(reconInfo.slipAmount)} ₫</strong>, cùng loại thuế và kỳ thuế:{' '}
                        <span className="font-mono">{reconInfo.duplicateWith.join(', ')}</span>. Nếu nghiệp vụ chỉ phát sinh một
                        khoản phải nộp → khả năng nộp trùng.
                      </p>
                    )}

                    {reconInfo.obligations.length > 0 && (
                      <ul className="divide-y divide-slate-100 border border-slate-100 rounded-lg overflow-hidden">
                        {reconInfo.obligations.map(o => (
                          <li key={`${o.id}-${o.confidence}`} className="flex items-center justify-between gap-2 px-3 py-1.5 text-[11px]">
                            <span className="min-w-0">
                              <span className="font-medium text-slate-700 truncate block">{o.title}</span>
                              <span className="text-slate-400 text-[10px]">
                                {o.periodLabel} ·{' '}
                                {o.confidence === 'EXACT' ? 'khớp chính xác' : o.confidence === 'HIGH' ? 'độ tin cậy cao' : 'cần kiểm tra'}
                              </span>
                            </span>
                            <span className="font-mono font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                              {fmtBig(o.allocatedAmount)} ₫
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </section>
            </>
          ) : (
            /* ═══════════ DOCUMENT VIEW (bản gốc C1-02/NS) ═══════════ */
            !loading && error ? (
              <div className="m-6 p-6 bg-red-50 border border-red-200 rounded-xl text-center text-red-700 text-xs">
                <p className="font-semibold mb-1">Lỗi khi tải chi tiết</p>
                <p>{error}</p>
              </div>
            ) : detail ? (
              <div className="bg-white border border-slate-300 rounded-xl shadow-xs p-8 max-w-3xl mx-auto text-slate-800 text-xs leading-relaxed print:border-none print:shadow-none print:p-0">
                {/* Top Meta Info */}
                <div className="flex justify-between items-start pb-4 border-b border-slate-200">
                  <div className="text-[11px] text-slate-500 space-y-0.5">
                    <p>Mã hiệu: <span className="font-mono text-slate-800 font-semibold">{detail.maHieu || '2620202TSA'}</span></p>
                    <p>Số chứng từ: <span className="font-mono text-slate-800 font-semibold">{detail.soChungTu || slip.soChungTu || '—'}</span></p>
                    <p>Số tham chiếu: <span className="font-mono text-slate-800 font-semibold">{detail.soThamChieu || slip.maGiaoDich}</span></p>
                  </div>
                  <div className="text-right">
                    <span className="inline-block font-bold text-xs uppercase px-2.5 py-1 bg-slate-100 rounded text-slate-700 border border-slate-300">
                      Mẫu số C1- 02/NS
                    </span>
                    <p className="text-[10px] text-slate-400 mt-1">Thông tư 84/2016/TT-BTC</p>
                  </div>
                </div>

                {/* Document Title */}
                <div className="text-center my-5">
                  <h1 className="text-base font-bold uppercase tracking-wide text-slate-900">
                    Giấy Nộp Tiền Vào Ngân Sách Nhà Nước
                  </h1>
                  <div className="flex justify-center items-center space-x-6 text-xs text-slate-600 mt-1.5 font-medium">
                    <span className="inline-flex items-center space-x-1">
                      <span className="w-3.5 h-3.5 border border-slate-400 rounded-xs inline-flex items-center justify-center text-[10px] font-bold">✓</span>
                      <span>Chuyển khoản</span>
                    </span>
                    <span className="inline-flex items-center space-x-1 text-slate-400">
                      <span className="w-3.5 h-3.5 border border-slate-300 rounded-xs inline-flex items-center justify-center text-[10px]"></span>
                      <span>Tiền mặt</span>
                    </span>
                    <span>·</span>
                    <span>Loại tiền: <strong className="font-semibold text-slate-800">VND</strong></span>
                  </div>
                </div>

                {/* Taxpayer Information */}
                <div className="space-y-2 py-3 text-xs bg-slate-50/60 p-4 rounded-lg border border-slate-200">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <span className="text-slate-500">Người nộp thuế: </span>
                      <strong className="font-semibold text-slate-900 uppercase">{detail.nguoiNopThue}</strong>
                    </div>
                    <div>
                      <span className="text-slate-500">Mã số thuế: </span>
                      <strong className="font-mono font-semibold text-slate-900">{detail.maSoThue}</strong>
                    </div>
                  </div>

                  {detail.diaChi && (
                    <div>
                      <span className="text-slate-500">Địa chỉ: </span>
                      <span className="text-slate-800">{detail.diaChi} {detail.tinhTp ? `, ${detail.tinhTp}` : ''}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-200/80">
                    <div>
                      <span className="text-slate-500">Đề nghị trích TK: </span>
                      <strong className="font-mono text-slate-900">{detail.soTaiKhoanTrich || slip.soTaiKhoan || '—'}</strong>
                      {detail.nganHangTrichTk && <div className="text-[11px] text-slate-600">{detail.nganHangTrichTk}</div>}
                    </div>
                    <div>
                      <span className="text-slate-500">Vào TK KBNN: </span>
                      <strong className="text-slate-900">{detail.taiKhoanKbnn || 'Kho bạc Nhà nước'}</strong>
                      {detail.coQuanQuanLyThu && <div className="text-[11px] text-slate-600">CQ Thuế: {detail.coQuanQuanLyThu}</div>}
                    </div>
                  </div>
                </div>

                {/* Sub-items Table */}
                <div className="mt-5">
                  <table className="w-full border-collapse border border-slate-300 text-xs">
                    <thead>
                      <tr className="bg-slate-100 text-slate-700 font-semibold text-[11px]">
                        <th className="border border-slate-300 p-2 text-center w-8">STT</th>
                        <th className="border border-slate-300 p-2 text-left">Số tờ khai / QĐ</th>
                        <th className="border border-slate-300 p-2 text-center w-24">Kỳ thuế</th>
                        <th className="border border-slate-300 p-2 text-left">Nội dung khoản nộp NSNN</th>
                        <th className="border border-slate-300 p-2 text-center w-16">Chương</th>
                        <th className="border border-slate-300 p-2 text-center w-16">Tiểu mục</th>
                        <th className="border border-slate-300 p-2 text-right w-36 whitespace-nowrap">Số tiền (VND)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.items.length > 0 ? (
                        detail.items.map((item, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="border border-slate-300 p-2 text-center">{item.stt}</td>
                            <td className="border border-slate-300 p-2 font-mono text-[11px]">{item.soToKhaiQuyetDinh || '—'}</td>
                            <td className="border border-slate-300 p-2 text-center font-mono text-[11px]">{item.kyThueNgayQd || '—'}</td>
                            <td className="border border-slate-300 p-2 font-medium text-slate-800">{item.noiDungKhoanNop}</td>
                            <td className="border border-slate-300 p-2 text-center font-mono">{item.maChuong || '—'}</td>
                            <td className="border border-slate-300 p-2 text-center font-mono font-bold text-teal-800">{item.maNDKT || '—'}</td>
                            <td className="border border-slate-300 p-2 text-right font-mono font-semibold text-slate-900 whitespace-nowrap">{item.soTienVND}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td className="border border-slate-300 p-2 text-center">1</td>
                          <td className="border border-slate-300 p-2 font-mono text-[11px]">—</td>
                          <td className="border border-slate-300 p-2 text-center font-mono text-[11px]">—</td>
                          <td className="border border-slate-300 p-2 font-medium text-slate-800">Khoản nộp thuế vào NSNN</td>
                          <td className="border border-slate-300 p-2 text-center font-mono">557</td>
                          <td className="border border-slate-300 p-2 text-center font-mono font-bold text-teal-800">1001</td>
                          <td className="border border-slate-300 p-2 text-right font-mono font-semibold text-slate-900 whitespace-nowrap">{slip.soTienFormatted}</td>
                        </tr>
                      )}
                    </tbody>
                    <tfoot>
                      <tr className="bg-slate-50 font-bold">
                        <td colSpan={6} className="border border-slate-300 p-2.5 text-right uppercase">
                          Tổng tiền:
                        </td>
                        <td className="border border-slate-300 p-2.5 text-right font-mono text-sm text-teal-900 whitespace-nowrap">
                          {detail.tongTienVND || slip.soTienFormatted} ₫
                        </td>
                      </tr>
                    </tfoot>
                  </table>

                  {detail.tongTienBangChu && (
                    <p className="mt-2 text-xs italic text-slate-600">
                      Tổng số tiền ghi bằng chữ: <strong className="font-semibold text-slate-800 not-italic">{detail.tongTienBangChu}</strong>
                    </p>
                  )}
                </div>

                {/* Digital Signatures */}
                <div className="mt-8 pt-4 border-t border-slate-200">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3 flex items-center space-x-1.5">
                    <ShieldCheck className="w-4 h-4 text-teal-700" />
                    <span>Xác thực Chữ Ký Số Điện Tử (3 Bên)</span>
                  </h3>

                  <div className="grid grid-cols-3 gap-3">
                    {detail.signatures.length > 0 ? (
                      detail.signatures.map((sig, idx) => (
                        <div key={idx} className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-lg text-xs space-y-1">
                          <div className="flex items-center space-x-1.5 text-emerald-800 font-bold text-[11px]">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span className="truncate">{sig.signer}</span>
                          </div>
                          <div className="text-[10.5px] text-slate-600 font-mono">
                            Ngày ký: {sig.signedAt}
                          </div>
                        </div>
                      ))
                    ) : (
                      <>
                        <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-lg text-xs space-y-1">
                          <div className="flex items-center space-x-1.5 text-emerald-800 font-bold text-[11px]">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span>Người nộp thuế</span>
                          </div>
                          <div className="text-[10.5px] text-slate-600 font-mono">
                            Đã ký số NNT
                          </div>
                        </div>
                        <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-lg text-xs space-y-1">
                          <div className="flex items-center space-x-1.5 text-emerald-800 font-bold text-[11px]">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span>Cơ quan Thuế</span>
                          </div>
                          <div className="text-[10.5px] text-slate-600 font-mono">
                            Đã xác nhận tiếp nhận
                          </div>
                        </div>
                        <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-lg text-xs space-y-1">
                          <div className="flex items-center space-x-1.5 text-emerald-800 font-bold text-[11px]">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            <span>Ngân hàng TMCP</span>
                          </div>
                          <div className="text-[10.5px] text-slate-600 font-mono">
                            Đã trích nợ thành công
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-16 text-center text-slate-500 flex flex-col items-center justify-center space-y-3">
                <Loader2 className="w-7 h-7 animate-spin text-teal-600" />
                <span className="text-xs">Đang trích xuất dữ liệu Mẫu C1-02/NS từ eTax...</span>
              </div>
            )
          )}
        </div>

        {/* Footer actions (chỉ ở chế độ overview) */}
        {view === 'overview' && (
          <div className="shrink-0 border-t border-slate-200 bg-white px-5 py-2.5 flex items-center justify-between print:hidden">
            <span className="text-[10.5px] text-slate-400">
              {SLIP_RECON_META[reconInfo?.status ?? 'UNKNOWN'].label} · nguồn: eTax {slip.trangThai ? `· «${slip.trangThai}»` : ''}
            </span>
            <div className="flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setView('doc')}
                disabled={loading || Boolean(error)}
                className="h-8 px-3.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium flex items-center space-x-1.5 transition-colors cursor-pointer disabled:opacity-40"
              >
                <FileText className="w-3.5 h-3.5 text-slate-500" />
                <span>Xem chứng từ</span>
              </button>
              <button
                type="button"
                onClick={handleExportPdf}
                disabled={isExportingPdf || loading}
                className="h-8 px-3.5 bg-teal-700 hover:bg-teal-800 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
              >
                {isExportingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
                <span>Xuất C1-02/NS</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

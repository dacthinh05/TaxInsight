import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppViewMode,
  DateRange,
  PaymentSlipDetail,
  PaymentSlipRecord
} from '../../shared/types';
import { resolveScanDateRange } from '../../shared/dateUtils';
// Dùng chung 1 định nghĩa duy nhất với phần còn lại của app (trước đây có 3 bản
// isPaidSuccessSlip khác nhau rải rác — bản này thiếu 'thất bại')
import { isPaidSuccessSlip } from '../../shared/paymentSlipAudit';
export { isPaidSuccessSlip };

export type PaymentQueryStatus = 'CONNECTED_WITH_DATA' | 'CONNECTED_NO_DATA' | 'QUERY_FAILED' | 'NOT_QUERIED';

/** Lấy năm từ DateRange (dd/MM/yyyy) — dùng để gộp/trả phạm vi phủ theo từng năm */
const yearOfRange = (range: DateRange): number => {
  const m = (range.toDate || range.fromDate || '').trim().match(/(\d{4})\s*$/);
  return m ? parseInt(m[1], 10) : 0;
};

interface UseGntReconciliationParams {
  sessionTaxCode: string | undefined;
  isLoggedIn: boolean;
  selectedYear: number;
  scanRangeMode: string;
  viewMode: AppViewMode;
}

/**
 * Quản lý toàn bộ vòng đời dữ liệu Giấy Nộp Tiền phục vụ đối chiếu nghĩa vụ thuế:
 *  - Tra cứu GNT từ eTax + lưu/đọc checkpoint theo (MST, năm)
 *  - Tải chi tiết C1-02 (tiểu mục NDKT) khi mở tab Nghĩa vụ thuế
 *  - Theo dõi phạm vi ngày đã phủ để engine chống kết luận nợ thuế sai
 */
export function useGntReconciliation({
  sessionTaxCode,
  isLoggedIn,
  selectedYear,
  scanRangeMode,
  viewMode
}: UseGntReconciliationParams) {
  const [paymentSlips, setPaymentSlips] = useState<PaymentSlipRecord[]>([]);
  const [paymentSlipsError, setPaymentSlipsError] = useState<{ message: string; errorCode?: string } | null>(null);
  const [isScanningGnt, setIsScanningGnt] = useState(false);
  const [gntDetails, setGntDetails] = useState<Map<string, PaymentSlipDetail>>(new Map());
  const [paymentQueryStatus, setPaymentQueryStatus] = useState<PaymentQueryStatus>('NOT_QUERIED');
  const [gntCoverageRanges, setGntCoverageRanges] = useState<DateRange[]>([]);

  const gntDetailReqId = useRef(0);
  const gntLoadReqId = useRef(0);
  const failedGntDetailIds = useRef<Set<string>>(new Set());

  // ─── TẢI CHECKPOINT GNT KHI ĐĂNG NHẬP / ĐỔI NĂM ──────────────────────
  // Nhờ đó đối chiếu vẫn hoạt động ngay sau khi khởi động lại app mà không cần tra cứu lại eTax.
  useEffect(() => {
    if (!isLoggedIn || !sessionTaxCode || !window.taxPortalAPI?.getGntCheckpoint) return;
    const reqId = ++gntLoadReqId.current;
    window.taxPortalAPI
      .getGntCheckpoint({ taxCode: sessionTaxCode, year: selectedYear })
      .then((res: any) => {
        // Bỏ qua response cũ nếu user đã đổi năm trong lúc chờ
        if (reqId !== gntLoadReqId.current) return;
        if (!res?.success || !res.data?.slips?.length) return;
        setPaymentSlips(res.data.slips as PaymentSlipRecord[]);
        setGntDetails(new Map());
        setGntCoverageRanges(res.data.dateRange ? [res.data.dateRange as DateRange] : []);
        setPaymentSlipsError(null);
        setPaymentQueryStatus('CONNECTED_WITH_DATA');
      })
      .catch(() => {
        // Checkpoint hỏng/không đọc được — giữ trạng thái NOT_QUERIED an toàn
      });
  }, [isLoggedIn, sessionTaxCode, selectedYear]);

  // ─── TRA CỨU GNT THEO NĂM (có thể chỉ định năm khác năm đang chọn) ────
  const scanGntForYear = async (yearOverride?: number) => {
    const targetYear = typeof yearOverride === 'number' && Number.isFinite(yearOverride)
      ? Math.trunc(yearOverride)
      : selectedYear;
    if (!sessionTaxCode || isScanningGnt) return;

    setIsScanningGnt(true);
    setPaymentSlipsError(null);
    try {
      const range = resolveScanDateRange(
        targetYear,
        scanRangeMode.startsWith('MULTI') ? 'FULL_YEAR' : scanRangeMode
      );
      const res: any = await window.taxPortalAPI.scanPaymentSlips({ range });
      if (res?.success) {
        const slips: PaymentSlipRecord[] = res.paymentSlips || [];
        failedGntDetailIds.current.clear();
        setPaymentSlips(slips);
        setGntDetails(new Map());
        setPaymentSlipsError(null);
        setPaymentQueryStatus(slips.length > 0 ? 'CONNECTED_WITH_DATA' : 'CONNECTED_NO_DATA');

        // Gộp phạm vi phủ: thay khoảng cùng năm cũ bằng khoảng mới
        setGntCoverageRanges(prev => [
          ...prev.filter(r => yearOfRange(r) !== targetYear),
          ...(slips.length > 0 ? [range] : [])
        ]);

        // Lưu checkpoint (fire-and-forget) — lỗi lưu không ảnh hưởng phiên hiện tại
        if (window.taxPortalAPI.saveGntCheckpoint) {
          window.taxPortalAPI.saveGntCheckpoint({
            taxCode: sessionTaxCode,
            year: targetYear,
            paymentSlips: slips,
            dateRange: range
          });
        }
      } else {
        setPaymentSlips([]);
        setGntDetails(new Map());
        setPaymentQueryStatus('QUERY_FAILED');
        setPaymentSlipsError({
          message: res?.error || 'Không tra cứu được danh sách Giấy Nộp Tiền',
          errorCode: res?.errorCode
        });
      }
    } catch (err: any) {
      setPaymentSlips([]);
      setGntDetails(new Map());
      setPaymentQueryStatus('QUERY_FAILED');
      setPaymentSlipsError({ message: err?.message || 'Lỗi kết nối khi tra cứu GNT' });
    } finally {
      setIsScanningGnt(false);
    }
  };

  // ─── TẢI CHI TIẾT C1-02 CỦA GNT (tiểu mục NDKT) KHI MỞ TAB NGHĨA VỤ THUẾ ──
  // Chỉ tải các GNT nộp thành công chưa có trong cache; PaymentSlipClient bên main
  // có cache + chống trùng request nên gọi lặp lại an toàn.
  const pendingDetailKey = useMemo(
    () => paymentSlips.filter(isPaidSuccessSlip).filter(s => !gntDetails.has(s.id) && !failedGntDetailIds.current.has(s.id)).map(s => s.id).join(','),
    [paymentSlips, gntDetails]
  );

  useEffect(() => {
    if (viewMode !== 'OBLIGATIONS' || !pendingDetailKey || !window.taxPortalAPI?.getPaymentSlipDetail) return;
    const reqId = ++gntDetailReqId.current;
    const queue = pendingDetailKey.split(',');
    let cancelled = false;
    let stopBatch = false;

    const stopRemaining = () => {
      stopBatch = true;
      for (const remainingId of queue.splice(0)) {
        failedGntDetailIds.current.add(remainingId);
      }
    };

    const worker = async () => {
      while (!cancelled && !stopBatch && reqId === gntDetailReqId.current && queue.length > 0) {
        const ctuId = queue.shift()!;
        try {
          await new Promise(r => setTimeout(r, 100));
          const slip = paymentSlips.find(item => item.id === ctuId);
          const res: any = await window.taxPortalAPI.getPaymentSlipDetail({
            ctuId,
            soGnt: slip?.soGnt,
            maGiaoDich: slip?.maGiaoDich
          });
          if (!cancelled && res?.success && res.detail) {
            setGntDetails(prev => {
              const next = new Map(prev);
              next.set(ctuId, res.detail as PaymentSlipDetail);
              return next;
            });
          } else {
            failedGntDetailIds.current.add(ctuId);
            const code = String(res?.errorCode || '');
            if (['RATE_LIMIT', 'ETAX_SYSTEM_ERROR', 'SESSION_EXPIRED', 'AUTH_REQUIRED'].includes(code)) {
              stopRemaining();
            }
          }
        } catch (err: any) {
          // Bỏ qua GNT lỗi chi tiết — matcher sẽ fallback về chế độ header-only
          failedGntDetailIds.current.add(ctuId);
          const code = String(err?.code || err?.errorCode || '');
          const status = Number(err?.response?.status || 0);
          if (status === 429 || status >= 500 || ['RATE_LIMIT', 'ETAX_SYSTEM_ERROR', 'SESSION_EXPIRED', 'AUTH_REQUIRED'].includes(code)) {
            stopRemaining();
          }
        }
      }
    };

    void worker();
    return () => { cancelled = true; };
  }, [viewMode, pendingDetailKey, paymentSlips]);

  // ─── RESET (logout / đổi tài khoản) ──────────────────────────────────
  const resetGntData = () => {
    gntDetailReqId.current++;
    gntLoadReqId.current++;
    failedGntDetailIds.current.clear();
    setPaymentSlips([]);
    setGntDetails(new Map());
    setPaymentSlipsError(null);
    setPaymentQueryStatus('NOT_QUERIED');
    setGntCoverageRanges([]);
  };

  return {
    paymentSlips,
    paymentSlipsError,
    isScanningGnt,
    gntDetails,
    paymentQueryStatus,
    gntCoverageRanges,
    pendingDetailKey,
    handleScanPaymentSlips: () => scanGntForYear(),
    scanGntForYear,
    resetGntData
  };
}

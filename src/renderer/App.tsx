import React, { useEffect, useMemo, useRef, useState } from 'react';
import { checkMissingPeriods, resolveScanDateRange } from '../shared/dateUtils';
import {
  AppViewMode,
  AuditLogEntry,
  CaptchaChallenge,
  CheckpointData,
  DownloadSummary,
  FilingSourceMode,
  LegacyFilingScanProgress,
  MissingPeriodCheck,
  PaymentSlipDetail,
  PaymentSlipRecord,
  ScanProgressState,
  TaxFiling,
  TaxType,
  UserSessionInfo
} from '../shared/types';
import { AppHeader } from './components/AppHeader';
import { AuditLogDrawer } from './components/AuditLogDrawer';
import { AuthRequiredModal } from './components/AuthRequiredModal';
import { BottomStatusBar } from './components/BottomStatusBar';
import { CaptchaModal } from './components/CaptchaModal';
import { DownloadProgressModal } from './components/DownloadProgressModal';
import { enrichSlipWithClassification } from '../shared/gntClassification';
import { buildSlipReconciliationIndex, filterPaymentSlips, isPaidSuccessSlip, SlipReconInfo } from '../shared/paymentSlipAudit';
import { FilingQuickPreviewDrawer } from './components/FilingQuickPreviewDrawer';
import { InventoryTable } from './components/InventoryTable';
import { LoginPage } from './components/LoginPage';
import { MetricCardsRibbon } from './components/MetricCardsRibbon';
import { PaymentSlipStatsModal } from './components/PaymentSlipStatsModal';
import { PaymentSlipTable } from './components/PaymentSlipTable';
import { ScanCommandBar } from './components/ScanCommandBar';
import { VatReferenceDrawer } from './components/VatReferenceDrawer';
import { PitReferenceDrawer } from './components/PitReferenceDrawer';
import { VatAnalyticsSummary } from '../shared/vatAnalyticsTypes';
import { PitAnalyticsSummary } from '../shared/pitAnalyticsTypes';
import { TaxObligationEngine } from '../main/engine/TaxObligationEngine';
import { GntStatisticsResult } from '../main/engine/GntStatisticsEngine';
import { TaxObligationSummary } from '../shared/obligationTypes';
import { TaxObligationTable } from './components/TaxObligationTable';
import { LicenseModal } from './components/LicenseModal';
import { UpdateNotificationModal } from './components/UpdateNotificationModal';
import { ApiInspectorDrawer } from './components/ApiInspectorDrawer';
import { AdminPinModal } from './components/AdminPinModal';
import { ApiInspectorEntry, UpdateInfo } from '../shared/types';

type PaymentQueryStatus = 'CONNECTED_WITH_DATA' | 'CONNECTED_NO_DATA' | 'QUERY_FAILED' | 'NOT_QUERIED';

export const App: React.FC = () => {
  const [session, setSession] = useState<UserSessionInfo>({ isLoggedIn: false });
  const [viewMode, setViewMode] = useState<AppViewMode>('FILINGS');
  // ── Giấy Nộp Tiền (GNT) state ─────────────────────────────
  const [paymentSlips, setPaymentSlips] = useState<PaymentSlipRecord[]>([]);
  const [paymentSlipsError, setPaymentSlipsError] = useState<{ message: string; errorCode?: string } | null>(null);
  const [isScanningGnt, setIsScanningGnt] = useState(false);
  // Chi tiết C1-02 (tiểu mục NDKT từng dòng) phục vụ đối chiếu nghĩa vụ thuế ↔ GNT
  const [gntDetails, setGntDetails] = useState<Map<string, PaymentSlipDetail>>(new Map());
  const [paymentQueryStatus, setPaymentQueryStatus] = useState<PaymentQueryStatus>('NOT_QUERIED');
  const gntDetailReqId = useRef(0);
  const failedGntDetailIds = useRef<Set<string>>(new Set());
  // ── Thanh lệnh GNT (đã nén vào ScanCommandBar): tìm kiếm + modal thống kê ──
  const [gntSearchQuery, setGntSearchQuery] = useState('');
  const [gntStatsOpen, setGntStatsOpen] = useState(false);
  const [gntStatsLoading, setGntStatsLoading] = useState(false);
  const [gntStatsResult, setGntStatsResult] = useState<GntStatisticsResult | null>(null);
  const [gntStatsError, setGntStatsError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(() => new Date().getFullYear());
  const [scanRangeMode, setScanRangeMode] = useState<string>('YEAR_TO_DATE');
  const [selectedTaxType, setSelectedTaxType] = useState<TaxType>('ALL');

  // ── Tra Cứu Tờ Khai Năm Cũ qua eTax (Legacy Filing) State ──
  const [sourceMode, setSourceMode] = useState<FilingSourceMode>('CURRENT');
  const [legacyYearFrom, setLegacyYearFrom] = useState<number>(() => Math.max(2018, new Date().getFullYear() - 4));
  const [legacyYearTo, setLegacyYearTo] = useState<number>(() => new Date().getFullYear() - 1);
  const [legacyMaTKhai, setLegacyMaTKhai] = useState<string>('00');
  const [legacyFormOptions, setLegacyFormOptions] = useState<{ value: string; text: string }[]>([]);
  const [onlyMissing, setOnlyMissing] = useState<boolean>(false);
  const [legacyScanProgress, setLegacyScanProgress] = useState<LegacyFilingScanProgress | null>(null);
  const activeDownloadSource = useRef<'CURRENT' | 'LEGACY'>('CURRENT');

  // Auto-Updater State
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);

  // API Inspector chỉ mở sau khi main process xác thực quyền quản trị.
  const [isApiInspectorOpen, setIsApiInspectorOpen] = useState(false);
  const [isAdminPinOpen, setIsAdminPinOpen] = useState(false);
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [inspectorErrorCount, setInspectorErrorCount] = useState(0);

  const handleOpenInspector = async () => {
    const status = await window.taxPortalAPI?.inspectorGetAdminStatus?.();
    if (status?.isAdmin || isAdminUnlocked) {
      setIsApiInspectorOpen(true);
    } else {
      setIsAdminPinOpen(true);
    }
  };

  // Filings & Selection
  const [filings, setFilings] = useState<TaxFiling[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [missingVat, setMissingVat] = useState<MissingPeriodCheck | undefined>();
  const [missingPit, setMissingPit] = useState<MissingPeriodCheck | undefined>();

  // Scanner & Progress
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgressState | null>(null);
  const [captchaChallenge, setCaptchaChallenge] = useState<CaptchaChallenge | null>(null);
  const latestScanId = useRef(0);

  // Ref đồng bộ giá trị năm hiện tại cho các callback/effect không phụ thuộc selectedYear
  const selectedYearRef = useRef(selectedYear);
  useEffect(() => {
    selectedYearRef.current = selectedYear;
  }, [selectedYear]);

  // Ref chống race khi gọi getCheckpoint liên tiếp (đổi năm nhanh) — response cũ phải bị bỏ qua
  const checkpointReqId = useRef(0);

  // Counter cho id log (Date.now() bị trùng khi nhiều log cùng ms -> key React trùng)
  const logIdCounter = useRef(0);

  const buildInitialDownloadSummary = (total: number): DownloadSummary => ({
    total,
    completed: 0,
    existing: 0,
    failed: 0,
    downloading: 0,
    pending: total,
    remaining: total,
    isPaused: false,
    isCancelled: false,
    isRunning: true,
    state: 'RUNNING'
  });

  const startDownloadBatch = async (batch: TaxFiling[]) => {
    if (!window.taxPortalAPI || batch.length === 0) return;

    setDownloadSummary(buildInitialDownloadSummary(batch.length));
    setIsDownloadModalOpen(true);

    try {
      const isLegacy = sourceMode === 'DVC_ETAX_LEGACY' || batch.some(f => f.source === 'dvc-etax-html');
      activeDownloadSource.current = isLegacy ? 'LEGACY' : 'CURRENT';
      const res = isLegacy
        ? await window.taxPortalAPI.startLegacyFilingDownload({
            filings: batch,
            taxCode: session.taxCode,
            year: selectedYear
          })
        : await window.taxPortalAPI.startDownload({
            filings: batch,
            taxCode: session.taxCode,
            year: selectedYear
          });

      if (res.success && res.summary) {
        setDownloadSummary(res.summary);
      } else {
        setIsDownloadModalOpen(false);
        setDownloadSummary(null);
        alert(res.error || 'Không thể bắt đầu tải hồ sơ thuế.');
      }
    } catch (err: any) {
      setIsDownloadModalOpen(false);
      setDownloadSummary(null);
      alert(err?.message || 'Không thể bắt đầu tải hồ sơ thuế.');
    }
  };

  // Download & Modals
  const [downloadSummary, setDownloadSummary] = useState<DownloadSummary | null>(null);
  const [isDownloadModalOpen, setIsDownloadModalOpen] = useState(false);
  const [isAuthRequiredModalOpen, setIsAuthRequiredModalOpen] = useState(false);

  // Logs & Checkpoint
  const [availableCheckpoint, setAvailableCheckpoint] = useState<CheckpointData | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [isAuditDrawerOpen, setIsAuditDrawerOpen] = useState(false);

  // VAT Deep Analytics
  const [vatSummary, setVatSummary] = useState<VatAnalyticsSummary | null>(null);
  const [isVatDrawerOpen, setIsVatDrawerOpen] = useState(false);
  const [isVatAnalyzing, setIsVatAnalyzing] = useState(false);
  const [vatProgressMessage, setVatProgressMessage] = useState('');

  // PIT Deep Analytics
  const [pitSummary, setPitSummary] = useState<PitAnalyticsSummary | null>(null);
  const [isPitDrawerOpen, setIsPitDrawerOpen] = useState(false);
  const [isPitAnalyzing, setIsPitAnalyzing] = useState(false);
  const [pitProgressMessage, setPitProgressMessage] = useState('');

  // Licensing
  const [isLicenseModalOpen, setIsLicenseModalOpen] = useState(false);
  const [isLicenseActivated, setIsLicenseActivated] = useState(false);
  const [isTrial, setIsTrial] = useState(false);
  const [licenseTierLabel, setLicenseTierLabel] = useState('');
  const [machineId, setMachineId] = useState('');
  const [targetLoginTaxCode, setTargetLoginTaxCode] = useState('');
  const [baseDir, setBaseDir] = useState('');

  const refreshLicenseStatus = () => {
    if (window.taxPortalAPI) {
      window.taxPortalAPI.getLicenseStatus().then(status => {
        setIsLicenseActivated(status.isActivated);
        setIsTrial(status.isTrial);
        setLicenseTierLabel(status.tierLabel);
        if (status.machineId) setMachineId(status.machineId);
      });
    }
  };

  // ─── LẮNG NGHE SỰ KIỆN IPC TỪ ELECTRON MAIN ─────────────────────────
  // Effect chỉ chạy MỘT lần: nếu phụ thuộc selectedYear, mỗi lần đổi năm sẽ tháo/gắn
  // lại toàn bộ listener IPC (mất sự kiện trong khoảng trống) và gọi getSession lặp lại.
  useEffect(() => {
    if (!window.taxPortalAPI) return;

    refreshLicenseStatus();

    if (window.taxPortalAPI.getBaseDir) {
      window.taxPortalAPI.getBaseDir().then(res => {
        if (res?.success && res.path) setBaseDir(res.path);
      });
    }

    window.taxPortalAPI.getSession().then(info => {
      if (info.isLoggedIn) {
        setSession(info);
        checkExistingCheckpoint(info.taxCode || '', selectedYearRef.current);
      }
    });

    const unsubs = [
      window.taxPortalAPI.onCaptchaRequired(challenge => {
        setCaptchaChallenge(challenge);
      }),

      window.taxPortalAPI.onScanProgress(state => {
        setScanProgress(state);
        setIsScanning(state.status === 'SCANNING');
      }),

      window.taxPortalAPI.onDownloadProgress(data => {
        setDownloadSummary(data.summary);
        if (data.item?.filing) {
          setFilings(prev =>
            prev.map(f => (f.id === data.item.filingId ? { ...f, ...data.item.filing } : f))
          );
        }
      }),

      window.taxPortalAPI.onDownloadCompleted(summary => {
        setDownloadSummary(summary);
      }),

      window.taxPortalAPI.onSessionExpired(() => {
        setIsAuthRequiredModalOpen(true);
      }),

      // Legacy Filing listeners
      window.taxPortalAPI.onLegacyFilingProgress && window.taxPortalAPI.onLegacyFilingProgress((data: LegacyFilingScanProgress) => {
        setLegacyScanProgress(data);
        setIsScanning(data.status === 'SCANNING' || data.status === 'SSO_INITIALIZING');
        const mappedStatus: ScanProgressState['status'] =
          data.status === 'COMPLETED'
            ? 'COMPLETED'
            : data.status === 'CANCELLED'
              ? 'CANCELLED'
              : data.status === 'ERROR' || data.status === 'AUTH_EXPIRED'
                ? 'ERROR'
                : 'SCANNING';
        setScanProgress({
          status: mappedStatus,
          level: 'YEAR',
          completedRanges: data.currentPage,
          totalRanges: Math.max(1, data.totalPages),
          foundFilingsCount: data.foundFilingsCount,
          currentRange: {
            fromDate: `01/01/${data.currentYear}`,
            toDate: `31/12/${data.currentYear}`,
            label: `Năm ${data.currentYear} (Trang ${data.currentPage}/${Math.max(1, data.totalPages)})`,
            level: 'YEAR'
          }
        });
      }),

      window.taxPortalAPI.onLegacyFilingDownloadProgress && window.taxPortalAPI.onLegacyFilingDownloadProgress((data: any) => {
        setDownloadSummary(data.summary);
        if (data.currentItem?.filing) {
          setFilings(prev =>
            prev.map(f => (f.id === data.currentItem.filingId ? { ...f, ...data.currentItem.filing } : f))
          );
        }
      }),

      window.taxPortalAPI.onLegacyFilingDownloadCompleted && window.taxPortalAPI.onLegacyFilingDownloadCompleted((summary: any) => {
        setDownloadSummary(summary);
      }),

      window.taxPortalAPI.onLegacyFilingAuthExpired && window.taxPortalAPI.onLegacyFilingAuthExpired(() => {
        setIsAuthRequiredModalOpen(true);
      }),

      window.taxPortalAPI.onVatProgress(data => {
        setVatProgressMessage(data.message);
      }),

      window.taxPortalAPI.onNewLog(log => {
        setAuditLogs(prev => [
          {
            id: `log_${++logIdCounter.current}`,
            timestamp: new Date().toLocaleTimeString('vi-VN'),
            type: log.type || 'INFO',
            action: log.action
          },
          ...prev
        ].slice(0, 500)); // Chặn tăng trưởng không giới hạn trong phiên dài
      }),

      window.taxPortalAPI.onUpdateStatus && window.taxPortalAPI.onUpdateStatus((info: UpdateInfo) => {
        setUpdateInfo(info);
      }),

      window.taxPortalAPI.onInspectorNewEntry && window.taxPortalAPI.onInspectorNewEntry(entry => {
        if (entry.isError || (typeof entry.status === 'number' && entry.status >= 400) || entry.status === 'FAILED') {
          setInspectorErrorCount(prev => prev + 1);
        }
      }),

      window.taxPortalAPI.onInspectorCleared && window.taxPortalAPI.onInspectorCleared(() => {
        setInspectorErrorCount(0);
      })

    ].filter(Boolean) as (() => void)[];

    // Đếm lỗi Inspector ban đầu
    if (window.taxPortalAPI?.inspectorGetEntries) {
      window.taxPortalAPI.inspectorGetEntries().then(entries => {
        const errs = (entries || []).filter(
          e => e.isError || (typeof e.status === 'number' && e.status >= 400) || e.status === 'FAILED'
        ).length;
        setInspectorErrorCount(errs);
      });
    }


    return () => {
      unsubs.forEach(unsub => unsub && unsub());
    };
  }, []);

  // Lắng nghe phím tắt mở nhanh API Inspector: Ctrl + Shift + A hoặc Ctrl + Alt + I
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isShortcut =
        (e.ctrlKey && e.shiftKey && (e.key === 'A' || e.key === 'a')) ||
        (e.ctrlKey && e.altKey && (e.key === 'I' || e.key === 'i'));

      if (isShortcut) {
        e.preventDefault();
        handleOpenInspector();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const checkExistingCheckpoint = async (taxCode: string, year: number) => {
    if (!window.taxPortalAPI || !taxCode) return;
    const reqId = ++checkpointReqId.current;
    const res = await window.taxPortalAPI.getCheckpoint({ taxCode, year });
    // Bỏ qua response cũ nếu user đã đổi năm sang nơi khác trong lúc chờ
    if (reqId !== checkpointReqId.current) return;
    if (res.success && res.data && res.data.filings?.length > 0) {
      setAvailableCheckpoint(res.data);
    } else {
      setAvailableCheckpoint(null);
    }
    checkExistingGntCheckpoint(taxCode, year);
  };

  const checkExistingGntCheckpoint = async (taxCode: string, year: number) => {
    if (!window.taxPortalAPI?.getGntCheckpoint || !taxCode) return;
    try {
      const res = await window.taxPortalAPI.getGntCheckpoint({ taxCode, year });
      if (res?.success && res.data?.slips?.length > 0) {
        failedGntDetailIds.current.clear();
        setPaymentSlips(res.data.slips as PaymentSlipRecord[]);
        setPaymentQueryStatus('CONNECTED_WITH_DATA');
      }
    } catch {}
  };

  // Lưu trữ dữ liệu hồ sơ độc lập theo từng năm trong phiên làm việc
  const [filingsByYear, setFilingsByYear] = useState<Record<number, TaxFiling[]>>({});

  const handleLoginSuccess = (taxCode: string) => {
    const info: UserSessionInfo = {
      isLoggedIn: true,
      taxCode,
      companyName: `Doanh nghiệp MST: ${taxCode}`,
      loginTime: new Date().toISOString()
    };
    setSession(info);
    checkExistingCheckpoint(taxCode, selectedYear);
    checkExistingGntCheckpoint(taxCode, selectedYear);
  };

  // Quét hồ sơ thuế (Hỗ trợ Quét Đa Năm & Chống Race Condition)
  const handleStartScan = async () => {
    if (!session.taxCode) return;

    const scanId = ++latestScanId.current;
    setIsScanning(true);
    setAvailableCheckpoint(null);
    setSelectedIds(new Set());
    setDownloadSummary(null);

    // ─── CHẾ ĐỘ QUÉT ĐA NĂM TỰ ĐỘNG (MULTI-YEAR BATCH SCAN) ───────────────
    if (scanRangeMode === 'MULTI_3_YEARS' || scanRangeMode === 'MULTI_5_YEARS') {
      const currentYear = new Date().getFullYear();
      const yearsToScan = scanRangeMode === 'MULTI_3_YEARS'
        ? [currentYear - 2, currentYear - 1, currentYear]
        : [currentYear - 4, currentYear - 3, currentYear - 2, currentYear - 1, currentYear];

      let combinedFilings: TaxFiling[] = [];
      const updatedByYear = { ...filingsByYear };

      for (let i = 0; i < yearsToScan.length; i++) {
        const y = yearsToScan[i];
        if (scanId !== latestScanId.current) break;

        setScanProgress({
          status: 'SCANNING',
          level: 'YEAR',
          completedRanges: i,
          totalRanges: yearsToScan.length,
          foundFilingsCount: combinedFilings.length,
          currentRange: {
            fromDate: `01/01/${y}`,
            toDate: y < currentYear ? `31/01/${y + 1}` : `31/12/${y}`,
            label: `Quét năm ${y} (${i + 1}/${yearsToScan.length})`,
            level: 'YEAR'
          }
        });

        if (window.taxPortalAPI) {
          const res = await window.taxPortalAPI.startScan({
            year: y,
            taxType: selectedTaxType,
            limitToToday: y === currentYear,
            customRange: resolveScanDateRange(y, 'FULL_YEAR')
          });

          if (res.success && res.data) {
            updatedByYear[y] = res.data.filings;
            combinedFilings = [...combinedFilings, ...res.data.filings];
          }
        }
      }

      if (scanId === latestScanId.current) {
        // Merge kiểu functional: không ghi đè các cập nhật filingsByYear xảy ra
        // trong lúc quét (trước đây snapshot đầu phiên đè mất cache năm vừa đổi)
        setFilingsByYear(prev => ({ ...prev, ...updatedByYear }));
        const curYearFilings = updatedByYear[selectedYear] || combinedFilings;
        setFilings(curYearFilings);
        setMissingVat(checkMissingPeriods(curYearFilings, selectedYear, 'VAT', true));
        setMissingPit(checkMissingPeriods(curYearFilings, selectedYear, 'PIT', true));
        setIsScanning(false);
      }
      return;
    }

    // ─── CHẾ ĐỘ QUÉT 1 NĂM THÔNG THƯỜNG ─────────────────────────────────
    const customRange = resolveScanDateRange(selectedYear, scanRangeMode);
    if (window.taxPortalAPI) {
      const res = await window.taxPortalAPI.startScan({
        year: selectedYear,
        taxType: selectedTaxType,
        limitToToday: scanRangeMode === 'YEAR_TO_DATE',
        customRange
      });

      // Nếu có request quét mới hơn đã gửi đi -> Bỏ qua kết quả cũ tránh race condition
      if (scanId !== latestScanId.current) return;

      if (res.success && res.data) {
        setFilings(res.data.filings);
        
        // Tự động phân bổ filings theo từng năm kê khai vào filingsByYear
        const grouped: Record<number, TaxFiling[]> = { [selectedYear]: res.data.filings };
        for (const f of res.data.filings) {
          const y = f.periodNormalized?.year;
          if (y && y >= 2000 && y <= 2099) {
            if (!grouped[y]) grouped[y] = [];
            if (!grouped[y].some(item => item.id === f.id)) {
              grouped[y].push(f);
            }
          }
        }
        setFilingsByYear(prev => ({ ...prev, ...grouped }));
        setMissingVat(res.data.missingVatCheck);
        setMissingPit(res.data.missingPitCheck);
        setSelectedIds(new Set()); // Mặc định không auto-select toàn bộ
      } else {
        alert(res.error || 'Có lỗi xảy ra trong quá trình quét hồ sơ');
      }
    } else {
      alert('Không kết nối được tiến trình chính. Không thể quét dữ liệu Cổng Thuế.');
      setIsScanning(false);
    }

    if (scanId === latestScanId.current) {
      setIsScanning(false);
    }
  };

  const handleStartLegacyScan = async () => {
    if (!session.taxCode || !window.taxPortalAPI?.scanLegacyFilings) return;

    const scanId = ++latestScanId.current;
    setIsScanning(true);
    setAvailableCheckpoint(null);
    setSelectedIds(new Set());
    setDownloadSummary(null);

    try {
      const res = await window.taxPortalAPI.scanLegacyFilings({
        yearFrom: legacyYearFrom,
        yearTo: legacyYearTo,
        maTKhai: legacyMaTKhai,
        onlyMissing
      });

      if (scanId !== latestScanId.current) return;

      if (res.success && res.filings) {
        setFilings(res.filings);
        const optionResponse = await window.taxPortalAPI.getLegacyFilingFormOptions?.();
        if (optionResponse?.success && Array.isArray(optionResponse.options)) {
          setLegacyFormOptions(optionResponse.options);
        }
        const byYear: Record<number, TaxFiling[]> = {};
        for (const f of res.filings) {
          const y = f.periodNormalized?.year || selectedYear;
          if (!byYear[y]) byYear[y] = [];
          if (!byYear[y].some(item => item.id === f.id)) {
            byYear[y].push(f);
          }
        }
        setFilingsByYear(prev => ({ ...prev, ...byYear }));
        setMissingVat(checkMissingPeriods(res.filings, selectedYear, 'VAT', true));
        setMissingPit(checkMissingPeriods(res.filings, selectedYear, 'PIT', true));
        setSelectedIds(new Set());
      } else {
        alert(res.error || 'Có lỗi xảy ra trong quá trình tra cứu tờ khai năm cũ.');
      }
    } catch (err: any) {
      alert(err?.message || 'Lỗi khi tra cứu tờ khai năm cũ.');
    } finally {
      if (scanId === latestScanId.current) {
        setIsScanning(false);
      }
    }
  };

  const handleCaptchaSubmit = async (captcha: string) => {
    if (window.taxPortalAPI) {
      await window.taxPortalAPI.submitCaptcha(captcha);
    }
    setCaptchaChallenge(null);
  };

  const handleCaptchaCancel = async () => {
    if (window.taxPortalAPI) {
      await window.taxPortalAPI.cancelScan();
    }
    setCaptchaChallenge(null);
    setIsScanning(false);
  };

  const pauseActiveDownload = async () => {
    if (!window.taxPortalAPI) return;
    if (activeDownloadSource.current === 'LEGACY') {
      await window.taxPortalAPI.pauseLegacyFilingDownload?.();
    } else {
      await window.taxPortalAPI.pauseDownload();
    }
  };

  const resumeActiveDownload = async () => {
    if (!window.taxPortalAPI) return;
    if (activeDownloadSource.current === 'LEGACY') {
      await window.taxPortalAPI.resumeLegacyFilingDownload?.();
    } else {
      await window.taxPortalAPI.resumeDownload();
    }
  };

  const cancelActiveDownload = async () => {
    if (!window.taxPortalAPI) return;
    if (activeDownloadSource.current === 'LEGACY') {
      await window.taxPortalAPI.cancelLegacyFilingDownload?.();
    } else {
      await window.taxPortalAPI.cancelDownload();
    }
  };

  // Quick Preview State
  const [previewFiling, setPreviewFiling] = useState<TaxFiling | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [initialShowXmlPreview, setInitialShowXmlPreview] = useState(false);

  const previewIdx = filings.findIndex(f => f.id === previewFiling?.id);
  const hasPrevPreview = previewIdx > 0;
  const hasNextPreview = previewIdx >= 0 && previewIdx < filings.length - 1;

  const handleOpenPreview = (filing: TaxFiling, showXml = false) => {
    setInitialShowXmlPreview(showXml);
    setPreviewFiling(filing);
    setIsPreviewOpen(true);
  };

  const handleOpenPreviewBySubmissionId = (submissionId: string, showXml = false) => {
    if (!submissionId) return;
    setInitialShowXmlPreview(showXml);

    const found = filings.find(
      f =>
        f.id === submissionId ||
        (f.id && submissionId && (f.id.includes(submissionId) || submissionId.includes(f.id)))
    );

    if (found) {
      setPreviewFiling(found);
      setIsPreviewOpen(true);
    } else {
      // Fallback filing để cho phép mở preview XML/Chi tiết ngay cả khi không có trong state
      const fallbackFiling: TaxFiling = {
        id: submissionId,
        procedureCode: '1.007014',
        title: '01/GTGT - Tờ khai thuế GTGT khấu trừ',
        taxType: 'VAT',
        period: `Năm ${selectedYear}`,
        submittedAt: '',
        filingType: 'ORIGINAL',
        status: 'Đã nộp',
        downloadAvailable: true
      };
      setPreviewFiling(fallbackFiling);
      setIsPreviewOpen(true);
    }
  };

  const handleClosePreview = () => {
    setIsPreviewOpen(false);
    setPreviewFiling(null);
    setInitialShowXmlPreview(false);
  };

  const handleNavigatePrevPreview = () => {
    if (hasPrevPreview) {
      setPreviewFiling(filings[previewIdx - 1]);
    }
  };

  const handleNavigateNextPreview = () => {
    if (hasNextPreview) {
      setPreviewFiling(filings[previewIdx + 1]);
    }
  };

  // Tải 1 hồ sơ đơn lẻ từ Preview Drawer
  const handleDownloadSingle = async (filing: TaxFiling) => {
    setSelectedIds(new Set([filing.id]));
    await startDownloadBatch([filing]);
  };

  // Tải danh sách hồ sơ đã chọn
  const handleDownloadSelected = async () => {
    const toDownload = filings.filter(f => selectedIds.has(f.id));
    if (toDownload.length === 0) return;

    await startDownloadBatch(toDownload);
  };

  // Tải TRỰC TIẾP một danh sách hồ sơ (quick download theo nhóm/lọc)
  // — không đi qua selection state nên không bị stale closure
  const handleDownloadFilings = async (list: TaxFiling[]) => {
    if (!list || list.length === 0) return;

    await startDownloadBatch(list);
  };

  // Tải theo từng kỳ cụ thể (Quý / Tháng)
  const handleDownloadPeriod = async (periodName: string) => {
    const toDownload = filings.filter(f => {
      const p = f.period || f.periodNormalized?.raw || '';
      return p === periodName || p.includes(periodName);
    });

    if (toDownload.length === 0) return;

    setSelectedIds(new Set(toDownload.map(f => f.id)));

    await startDownloadBatch(toDownload);
  };

  // Tải toàn bộ hồ sơ
  const handleDownloadAll = async () => {
    if (filings.length === 0) return;

    await startDownloadBatch(filings);
  };

  // Thử lại riêng các file lỗi
  const handleRetryFailed = async () => {
    const failedFilings = filings.filter(f => f.downloadStatus === 'FAILED');

    // BUG 3 fix: Nếu filings state trống nhưng có lỗi tải → cần quét lại trước
    if (failedFilings.length === 0) {
      if ((downloadSummary?.failed ?? 0) > 0) {
        alert('Danh sách hồ sơ đã bị xóa khỏi bộ nhớ. Vui lòng bấm "Quét hồ sơ" trước để tải lại danh sách, sau đó thử lại.');
      }
      return;
    }

    setSelectedIds(new Set(failedFilings.map(f => f.id)));

    await startDownloadBatch(failedFilings);
  };

  // Xuất Excel danh sách hồ sơ thuế
  const handleExportExcel = async () => {
    try {
      if (filings.length === 0) {
        alert('Chưa có dữ liệu hồ sơ để xuất Excel. Vui lòng bấm Quét hồ sơ trước.');
        return;
      }
      if (window.taxPortalAPI) {
        const res = await window.taxPortalAPI.exportExcel({
          filings,
          year: selectedYear
        });
        if (res.success && res.filePath) {
          window.taxPortalAPI.openPath(res.filePath);
        } else {
          alert(res.error || 'Xuất danh sách hồ sơ Excel thất bại.');
        }
      }
    } catch (err: any) {
      alert(`Lỗi xuất Excel: ${err.message}`);
    }
  };

  // Phân tích chuyên sâu GTGT (Tự động gom hồ sơ T12 nộp vào tháng 1 năm sau)
  // overrideFilings: dùng danh sách chỉ định (vd sau khi quét bổ sung) thay vì đọc state.
  // Phòng thủ Array.isArray vì một số nơi truyền thẳng handler vào onClick (nhận MouseEvent).
  const handleAnalyzeVat = async (overrideArg?: unknown) => {
    const overrideFilings = Array.isArray(overrideArg) ? (overrideArg as TaxFiling[]) : undefined;
    if (overrideFilings) {
      setIsVatAnalyzing(true);
      setIsVatDrawerOpen(true);
      const vatOverride = overrideFilings.filter(f => f.taxType === 'VAT' || f.declarationCode === '01/GTGT' || f.title.includes('GTGT'));
      if (vatOverride.length === 0) {
        alert('Không tìm thấy tờ khai thuế GTGT trong danh sách hồ sơ đã quét.');
        setIsVatAnalyzing(false);
        return;
      }
      if (window.taxPortalAPI) {
        const res = await window.taxPortalAPI.analyzeVat({ filings: overrideFilings });
        if (res.success && res.summary) {
          setVatSummary(res.summary);
        } else {
          alert(res.error || 'Phân tích tờ khai GTGT thất bại.');
        }
      }
      setIsVatAnalyzing(false);
      return;
    }

    // 1. Gom toàn bộ hồ sơ đã quét trong phiên. Phân tích theo kỳ kê khai
    // cần dữ liệu năm trước để xác định [22] đầu kỳ, dù ngày nộp nằm ở năm sau.
    const filingMap = new Map<string, TaxFiling>();
    for (const yearFilings of Object.values(filingsByYear)) {
      for (const filing of yearFilings) filingMap.set(filing.id, filing);
    }
    for (const filing of filings) filingMap.set(filing.id, filing);
    const currentYearFilings = filingsByYear[selectedYear] || filings;
    
    // 2. Gom thêm hồ sơ thuộc kỳ selectedYear nhưng nộp vào năm sau (như Tháng 12/YYYY nộp vào T01/YYYY+1)
    const nextYearFilings = filingsByYear[selectedYear + 1] || [];
    const crossYearFilings = nextYearFilings.filter(f => {
      const p = (f.period || f.periodNormalized?.raw || '').toLowerCase();
      return p.includes(String(selectedYear)) || p.includes(`12/${selectedYear}`) || p.includes(`q4/${selectedYear}`);
    });

    const combined = [...filingMap.values()];
    const existingIds = new Set(combined.map(f => f.id));
    for (const filing of currentYearFilings) {
      if (!existingIds.has(filing.id)) {
        combined.push(filing);
        existingIds.add(filing.id);
      }
    }
    for (const f of crossYearFilings) {
      if (!existingIds.has(f.id)) {
        combined.push(f);
        existingIds.add(f.id);
      }
    }

    const vatFilings = combined.filter(f => f.taxType === 'VAT' || f.declarationCode === '01/GTGT' || f.title.includes('GTGT'));
    if (vatFilings.length === 0) {
      alert('Không tìm thấy tờ khai thuế GTGT trong danh sách hồ sơ đã quét.');
      return;
    }
    setIsVatAnalyzing(true);
    setIsVatDrawerOpen(true);
    if (window.taxPortalAPI) {
      const res = await window.taxPortalAPI.analyzeVat({ filings: combined });
      if (res.success && res.summary) {
        setVatSummary(res.summary);
      } else {
        alert(res.error || 'Phân tích tờ khai GTGT thất bại.');
      }
    }
    setIsVatAnalyzing(false);
  };

  // Xuất Bảng tham chiếu GTGT 3 Sheet
  const handleExportVatReference = async () => {
    try {
      if (!vatSummary && filings.length > 0) {
        if (window.taxPortalAPI) {
          const aRes = await window.taxPortalAPI.analyzeVat({ filings });
          if (aRes.success && aRes.summary) {
            setVatSummary(aRes.summary);
            const eRes = await window.taxPortalAPI.exportVatReferenceExcel({ summary: aRes.summary, year: selectedYear });
            if (eRes.success && eRes.filePath) {
              window.taxPortalAPI.openPath(eRes.filePath);
            } else {
              alert(eRes.error || 'Lỗi khi xuất file Excel GTGT');
            }
          } else {
            alert(aRes.error || 'Phân tích dữ liệu GTGT trước khi xuất thất bại');
          }
        }
        return;
      }
      if (vatSummary && window.taxPortalAPI) {
        const res = await window.taxPortalAPI.exportVatReferenceExcel({ summary: vatSummary, year: selectedYear });
        if (res.success && res.filePath) {
          window.taxPortalAPI.openPath(res.filePath);
        } else {
          alert(res.error || 'Lỗi khi xuất file Excel GTGT');
        }
      }
    } catch (err: any) {
      alert(`Lỗi khi xuất Excel GTGT: ${err.message}`);
    }
  };

  // ─── PHÂN TÍCH CHUYÊN SÂU TNCN (PIT ANALYTICS) ─────────────────────
  const handleAnalyzePit = async () => {
    // 1. Gom toàn bộ hồ sơ đã quét trong phiên để bắt trọn Quyết toán năm (thường nộp vào T03 năm sau)
    const filingMap = new Map<string, TaxFiling>();
    for (const yearFilings of Object.values(filingsByYear)) {
      for (const filing of yearFilings) filingMap.set(filing.id, filing);
    }
    for (const filing of filings) filingMap.set(filing.id, filing);
    const combined = [...filingMap.values()];

    const pitFilings = combined.filter(
      f =>
        f.taxType === 'PIT' ||
        (f.declarationCode || '').includes('TNCN') ||
        (f.declarationCode || '').includes('05/KK') ||
        (f.declarationCode || '').includes('05/QTT') ||
        f.title.toLowerCase().includes('thu nhập cá nhân') ||
        f.title.toLowerCase().includes('tncn')
    );

    if (pitFilings.length === 0) {
      alert('Không tìm thấy tờ khai thuế TNCN trong danh sách hồ sơ đã quét.');
      return;
    }

    setIsPitAnalyzing(true);
    setPitProgressMessage('Đang chuẩn bị phân tích dữ liệu tờ khai TNCN…');
    setIsPitDrawerOpen(true);

    if (window.taxPortalAPI) {
      const res = await window.taxPortalAPI.analyzePit({ filings: combined });
      if (res.success && res.summary) {
        setPitSummary(res.summary);
      } else {
        alert(res.error || 'Phân tích tờ khai TNCN thất bại.');
      }
    }
    setIsPitAnalyzing(false);
  };

  const handleExportPitReference = async () => {
    try {
      if (!pitSummary && filings.length > 0) {
        if (window.taxPortalAPI) {
          const aRes = await window.taxPortalAPI.analyzePit({ filings });
          if (aRes.success && aRes.summary) {
            setPitSummary(aRes.summary);
            const eRes = await window.taxPortalAPI.exportPitReferenceExcel({ summary: aRes.summary, year: selectedYear });
            if (eRes.success && eRes.filePath) {
              window.taxPortalAPI.openPath(eRes.filePath);
            } else {
              alert(eRes.error || 'Lỗi khi xuất file Excel TNCN');
            }
          } else {
            alert(aRes.error || 'Phân tích tờ khai TNCN trước khi xuất thất bại.');
          }
        }
        return;
      }
      if (pitSummary && window.taxPortalAPI) {
        const res = await window.taxPortalAPI.exportPitReferenceExcel({ summary: pitSummary, year: selectedYear });
        if (res.success && res.filePath) {
          window.taxPortalAPI.openPath(res.filePath);
        } else {
          alert(res.error || 'Lỗi khi xuất file Excel TNCN');
        }
      }
    } catch (err: any) {
      alert(`Lỗi xuất Excel TNCN: ${err.message}`);
    }
  };

  // ─── TÍNH TOÁN NGHĨA VỤ THUẾ + ĐỐI CHIẾU GIẤY NỘP TIỀN (TAX OBLIGATION ENGINE) ──
  const successfulPaymentSlips = useMemo(
    () => paymentSlips.filter(isPaidSuccessSlip),
    [paymentSlips]
  );

  const obligationSummary = useMemo<TaxObligationSummary>(() => {
    return TaxObligationEngine.processObligations(
      filings,
      successfulPaymentSlips,
      session.taxCode || '',
      gntDetails,
      new Date(),
      paymentQueryStatus
    );
  }, [filings, successfulPaymentSlips, gntDetails, session.taxCode, paymentQueryStatus]);

  // ─── GẮN PHÂN LOẠI (LOẠI THUẾ / KỲ) VÀO DANH SÁCH GNT TỪ CHI TIẾT C1-02 ĐÃ TẢI ──
  const enrichedPaymentSlips = useMemo<PaymentSlipRecord[]>(() => {
    if (gntDetails.size === 0) return successfulPaymentSlips;
    return successfulPaymentSlips.map(s => enrichSlipWithClassification(s, gntDetails));
  }, [successfulPaymentSlips, gntDetails]);

  // ─── ĐỐI CHIẾU NGƯỢC GNT → NGHĨA VỤ (cột «Đối chiếu» + side panel chi tiết) ──
  // Liên kết 3 module: Tờ khai → Nghĩa vụ (obligationSummary) → GNT → trạng thái Khớp/Chưa khớp/Nộp trùng?
  const slipReconIndex = useMemo<Map<string, SlipReconInfo>>(
    () => buildSlipReconciliationIndex(enrichedPaymentSlips, obligationSummary.obligations, paymentQueryStatus),
    [enrichedPaymentSlips, obligationSummary.obligations, paymentQueryStatus]
  );

  // ─── LỌC TÌM KIẾM CHO TAB GIẤY NỘP TIỀN (search box nằm trong thanh lệnh) ──
  const filteredPaymentSlips = useMemo(
    () => filterPaymentSlips(enrichedPaymentSlips, gntSearchQuery),
    [enrichedPaymentSlips, gntSearchQuery]
  );

  // ─── CHIP TÓM TẮT TRÊN THANH LỆNH: N GNT · Tổng nộp · Chưa đối chiếu ──
  const gntCommandStats = useMemo(() => {
    const reconDataUsable =
      paymentQueryStatus === 'CONNECTED_WITH_DATA' &&
      (obligationSummary.obligations?.length || 0) > 0;
    const unreconciledCount = reconDataUsable
      ? filteredPaymentSlips.filter(s => {
          const st = slipReconIndex.get(s.id)?.status;
          return st === 'UNMATCHED' || st === 'PARTIAL' || st === 'DUPLICATE_SUSPECT';
        }).length
      : 0;
    return {
      count: filteredPaymentSlips.length,
      totalAmount: filteredPaymentSlips.reduce((acc, s) => acc + (s.soTien || 0), 0),
      unreconciledCount
    };
  }, [filteredPaymentSlips, slipReconIndex, obligationSummary.obligations, paymentQueryStatus]);

  // ─── THỐNG KÊ GNT THEO THÁNG × LOẠI THUẾ (modal) ──
  const handleBuildGntStats = async () => {
    if (filteredPaymentSlips.length === 0 || gntStatsLoading) return;
    setGntStatsOpen(true);
    setGntStatsLoading(true);
    setGntStatsError(null);
    try {
      const res: any = await window.taxPortalAPI.getPaymentSlipsStatistics({ paymentSlips: filteredPaymentSlips });
      if (res?.success) {
        setGntStatsResult(res.stats);
      } else {
        setGntStatsResult(null);
        setGntStatsError(res?.error || 'Không thống kê được dữ liệu');
      }
    } catch (err: any) {
      setGntStatsResult(null);
      setGntStatsError(err.message || 'Lỗi kết nối khi thống kê');
    } finally {
      setGntStatsLoading(false);
    }
  };

  const handleExportGntStatsExcel = async () => {
    if (!gntStatsResult) return;
    await window.taxPortalAPI.exportPaymentSlipsStatsExcel({ stats: gntStatsResult, year: selectedYear });
  };

  // ─── TẢI CHI TIẾT C1-02 CỦA GNT (tiểu mục NDKT) KHI MỞ TAB NGHĨA VỤ THUẾ ──
  // Chỉ tải các GNT nộp thành công chưa có trong cache; PaymentSlipClient bên main
  // có cache + chống trùng request nên gọi lặp lại an toàn.
  // Ở tab Giấy Nộp Tiền: tải chi tiết cho TOÀN BỘ danh sách để hiển thị cột Loại thuế/Kỳ.
  const pendingDetailKey = useMemo(
    () => successfulPaymentSlips
      .filter(s => !gntDetails.has(s.id) && !failedGntDetailIds.current.has(s.id)).map(s => s.id).join(','),
    [successfulPaymentSlips, gntDetails]
  );

  useEffect(() => {
    if (
      (viewMode !== 'OBLIGATIONS' && viewMode !== 'PAYMENT_SLIPS') ||
      !pendingDetailKey ||
      !window.taxPortalAPI?.getPaymentSlipDetail
    ) return;
    const reqId = ++gntDetailReqId.current;
    const queue = pendingDetailKey.split(',').map(ctuId => ({ ctuId, retries: 0 }));
    let cancelled = false;
    let stopBatch = false;

    const stopForAuthentication = () => {
      // Các chứng từ còn lại chưa hề được thử, vì vậy không được đưa chúng vào
      // failedGntDetailIds. Sau khi người dùng xác thực/quét lại, toàn bộ batch
      // phải có khả năng chạy tiếp.
      stopBatch = true;
      queue.splice(0);
    };

    const worker = async () => {
      while (!cancelled && !stopBatch && reqId === gntDetailReqId.current && queue.length > 0) {
        const task = queue.shift()!;
        const ctuId = task.ctuId;
        try {
          await new Promise(r => setTimeout(r, 150));
          const slip = successfulPaymentSlips.find(item => item.id === ctuId);
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
            const code = String(res?.errorCode || '');
            if (code === 'AUTH_REQUIRED' || code === 'SESSION_EXPIRED') {
              stopForAuthentication();
            } else if (code === 'RATE_LIMIT') {
              if (task.retries < 1) {
                await new Promise(r => setTimeout(r, 2000));
                queue.unshift({ ...task, retries: task.retries + 1 });
              } else {
                failedGntDetailIds.current.add(ctuId);
              }
            } else {
              failedGntDetailIds.current.add(ctuId);
            }
          }
        } catch (err: any) {
          const code = String(err?.code || err?.errorCode || '');
          const status = Number(err?.response?.status || 0);
          if (status === 401 || ['SESSION_EXPIRED', 'AUTH_REQUIRED'].includes(code)) {
            stopForAuthentication();
          } else if (status === 429 || code === 'RATE_LIMIT') {
            if (task.retries < 1) {
              await new Promise(r => setTimeout(r, 2000));
              queue.unshift({ ...task, retries: task.retries + 1 });
            } else {
              failedGntDetailIds.current.add(ctuId);
            }
          } else {
            // Chỉ poison đúng chứng từ đã thực sự thất bại; matcher sẽ fallback
            // về chế độ header-only và worker tiếp tục các chứng từ sau.
            failedGntDetailIds.current.add(ctuId);
          }
        }
      }
    };

    void worker();
    return () => { cancelled = true; };
  }, [viewMode, pendingDetailKey, successfulPaymentSlips]);

  const handleOpenFolder = async (targetYear?: number | any) => {
    if (window.taxPortalAPI) {
      const validYear = typeof targetYear === 'number' && !isNaN(targetYear) ? targetYear : selectedYear;
      const subFolder = session.taxCode ? `${session.taxCode}_${validYear}` : '';
      await window.taxPortalAPI.openPath(subFolder);
    }
  };

  const handleSelectDirectory = async () => {
    if (window.taxPortalAPI) {
      const res = await window.taxPortalAPI.selectDirectory();
      if (res.success && res.path) {
        setBaseDir(res.path);
      }
    }
  };

  const handleResetDirectory = async () => {
    if (window.taxPortalAPI?.resetDirectory) {
      const res = await window.taxPortalAPI.resetDirectory();
      if (res.success && res.path) {
        setBaseDir(res.path);
      }
    }
  };

  const handleScanSupplementalYear = async (year: number) => {
    if (isScanning) return;
    setIsScanning(true);
    if (window.taxPortalAPI) {
      try {
        const res = await window.taxPortalAPI.startScan({
          year,
          taxType: 'VAT',
          limitToToday: false
        });

        if (res.success && res.data && res.data.filings) {
          // Merge & Dedupe theo id — tính danh sách gộp đồng bộ để phân tích ngay
          // trên dữ liệu MỚI (setTimeout + closure cũ trước đây chạy trên data stale)
          const existingIds = new Set(filings.map((f: TaxFiling) => f.id));
          const newRecords = res.data.filings.filter((f: TaxFiling) => !existingIds.has(f.id));
          const mergedFilings = [...filings, ...newRecords];
          setFilings(mergedFilings);

          // Tự động phân tích lại chuỗi kê khai GTGT trên chính danh sách vừa merge
          handleAnalyzeVat(mergedFilings);
        } else {
          alert(res.error || `Không thể quét bổ sung dữ liệu năm ${year}`);
        }
      } catch (err: any) {
        alert(`Lỗi khi quét bổ sung: ${err.message}`);
      } finally {
        setIsScanning(false);
      }
    } else {
      setIsScanning(false);
    }
  };

  const handleLogout = async () => {
    if (window.taxPortalAPI) {
      await window.taxPortalAPI.logout();
    }
    setSession({ isLoggedIn: false });
    setFilings([]);
    setVatSummary(null);
    setIsVatDrawerOpen(false);
    setPaymentSlips([]);
    setGntDetails(new Map());
    failedGntDetailIds.current.clear();
    setPaymentQueryStatus('NOT_QUERIED');
    setTargetLoginTaxCode('');
  };

  const handleSwitchAccount = async (targetMst: string) => {
    if (window.taxPortalAPI) {
      await window.taxPortalAPI.logout();
    }
    setSession({ isLoggedIn: false });
    setFilings([]);
    setVatSummary(null);
    setIsVatDrawerOpen(false);
    setPaymentSlips([]);
    setGntDetails(new Map());
    failedGntDetailIds.current.clear();
    setPaymentQueryStatus('NOT_QUERIED');
    setTargetLoginTaxCode(targetMst);
  };

  const handleCheckUpdate = async () => {
    if (window.taxPortalAPI?.checkForUpdates) {
      const res = await window.taxPortalAPI.checkForUpdates();
      if (res) {
        setUpdateInfo(res);
        if (res.state === 'AVAILABLE') {
          setIsUpdateModalOpen(true);
        } else if (res.state === 'NOT_AVAILABLE' || res.state === 'IDLE') {
          alert(`Phần mềm đang ở phiên bản mới nhất (v${res.currentVersion || __APP_VERSION__}).`);
        } else if (res.state === 'ERROR') {
          alert('Không thể kết nối máy chủ cập nhật: ' + (res.error || 'Lỗi mạng'));
        }
      }
    }
  };

  const handleDownloadUpdate = async () => {
    if (window.taxPortalAPI?.downloadUpdate) {
      await window.taxPortalAPI.downloadUpdate();
    }
  };

  const handleInstallUpdate = async () => {
    if (window.taxPortalAPI?.installUpdate) {
      await window.taxPortalAPI.installUpdate();
    }
  };

  // ── Giấy Nộp Tiền: tra cứu danh sách GNT từ eTax ──────────────
  const handleScanPaymentSlips = async () => {
    if (!session.taxCode || isScanningGnt) return;

    setIsScanningGnt(true);
    setPaymentSlipsError(null);
    try {
      // GNT chỉ tra cứu theo khoảng ngày đơn; multi-year mode -> dùng cả năm
      const range = resolveScanDateRange(
        selectedYear,
        scanRangeMode.startsWith('MULTI') ? 'FULL_YEAR' : scanRangeMode
      );
      let res: any = await window.taxPortalAPI.scanPaymentSlips({ range });

      // eTax đôi lúc chặn chuỗi SSO nền ở trang kiểm tra plugin dù người dùng
      // đã đăng nhập DVC. Mở cửa sổ xác thực đúng một lần, đồng bộ cookie +
      // DSE state rồi tự chạy lại truy vấn; người dùng không phải tự tìm nút
      // "Mở eTax" và bấm "Thử lại" thêm một vòng.
      if (
        !res?.success &&
        res?.errorCode === 'AUTH_REQUIRED' &&
        window.taxPortalAPI?.openPaymentSlipsAuthWindow
      ) {
        const authResult: any = await window.taxPortalAPI.openPaymentSlipsAuthWindow();
        if (authResult?.success) {
          res = await window.taxPortalAPI.scanPaymentSlips({ range });
        } else if (authResult?.error || authResult?.message) {
          res = {
            ...res,
            error: authResult.error || authResult.message,
            errorCode: 'AUTH_REQUIRED'
          };
        }
      }

      if (res?.success) {
        const slips: PaymentSlipRecord[] = res.paymentSlips || [];
        failedGntDetailIds.current.clear();
        setPaymentSlips(slips);
        setGntDetails(new Map());
        setPaymentSlipsError(null);
        setPaymentQueryStatus(slips.length > 0 ? 'CONNECTED_WITH_DATA' : 'CONNECTED_NO_DATA');
        if (window.taxPortalAPI?.saveGntCheckpoint && session.taxCode) {
          window.taxPortalAPI.saveGntCheckpoint({
            taxCode: session.taxCode,
            year: selectedYear,
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

  const handleExportSlipsExcel = async (slips: PaymentSlipRecord[]) => {
    if (!slips.length || !window.taxPortalAPI.exportPaymentSlipsExcel) return;
    await window.taxPortalAPI.exportPaymentSlipsExcel({ paymentSlips: slips, year: selectedYear });
  };

  const isDownloadingActive = downloadSummary?.isRunning || (downloadSummary?.remaining || 0) > 0;

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-100 font-sans antialiased text-slate-800 overflow-hidden select-none">
      {!session.isLoggedIn ? (
        <LoginPage
          onLoginSuccess={handleLoginSuccess}
          initialTaxCode={targetLoginTaxCode}
          updateInfo={updateInfo}
          onCheckUpdate={handleCheckUpdate}
          onOpenUpdate={() => setIsUpdateModalOpen(true)}
        />
      ) : (
        <>
          {/* 1. Header ứng dụng */}
          <AppHeader
            session={session}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            onOpenFolder={handleOpenFolder}
            onSelectDirectory={handleSelectDirectory}
            onResetDirectory={handleResetDirectory}
            baseDir={baseDir}
            onOpenLogs={() => setIsAuditDrawerOpen(true)}
            onLogout={handleLogout}
            onSwitchAccount={handleSwitchAccount}
            onOpenLicense={() => setIsLicenseModalOpen(true)}
            onCheckUpdate={handleCheckUpdate}
            onOpenInspector={handleOpenInspector}
            inspectorErrorCount={inspectorErrorCount}
            hasNewUpdate={updateInfo?.state === 'AVAILABLE' || updateInfo?.state === 'DOWNLOADED'}
            isLicenseActivated={isLicenseActivated}
            isTrial={isTrial}
            licenseTierLabel={licenseTierLabel}
            logsCount={auditLogs.length}
          />

      {/* 2. Workspace Viewports */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden px-4 pt-3 pb-2 space-y-3">
        {/* Command Toolbar */}
        <ScanCommandBar
          selectedYear={selectedYear}
          onYearChange={y => {
            if (y === selectedYear) return;

            // 1. Lưu lại filings của năm cũ trước khi đổi
            setFilingsByYear(prev => ({ ...prev, [selectedYear]: filings }));

            // 2. Chuyển sang năm mới — XÓA selection của năm cũ để tránh
            // "Đã chọn N" ma với id không còn trong bảng (download câm lặng)
            setSelectedYear(y);
            setSelectedIds(new Set());
            const currentYear = new Date().getFullYear();
            if (y !== currentYear && scanRangeMode === 'YEAR_TO_DATE') {
              setScanRangeMode('FULL_YEAR');
            }

            // 3. Nạp filings của năm mới nếu đã có sẵn trong state hoặc checkpoint
            if (filingsByYear[y] && filingsByYear[y].length > 0) {
              setFilings(filingsByYear[y]);
              setMissingVat(checkMissingPeriods(filingsByYear[y], y, 'VAT', true));
              setMissingPit(checkMissingPeriods(filingsByYear[y], y, 'PIT', true));
            } else {
              setFilings([]);
              setMissingVat(undefined);
              setMissingPit(undefined);
              checkExistingCheckpoint(session.taxCode || '', y);
            }
          }}
          scanRangeMode={scanRangeMode}
          onRangeModeChange={setScanRangeMode}
          selectedTaxType={selectedTaxType}
          onTaxTypeChange={setSelectedTaxType}
          isScanning={isScanning || isScanningGnt}
          onStartScan={
            viewMode === 'PAYMENT_SLIPS'
              ? handleScanPaymentSlips
              : (sourceMode === 'DVC_ETAX_LEGACY' ? handleStartLegacyScan : handleStartScan)
          }
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          // ── Chế độ Tra Cứu Tờ Khai Năm Cũ (Legacy Filing) ──
          sourceMode={sourceMode}
          onSourceModeChange={setSourceMode}
          legacyYearFrom={legacyYearFrom}
          onLegacyYearFromChange={setLegacyYearFrom}
          legacyYearTo={legacyYearTo}
          onLegacyYearToChange={setLegacyYearTo}
          legacyMaTKhai={legacyMaTKhai}
          onLegacyMaTKhaiChange={setLegacyMaTKhai}
          legacyFormOptions={legacyFormOptions}
          onlyMissing={onlyMissing}
          onOnlyMissingChange={setOnlyMissing}
          // ── Chế độ GNT: gộp search + tóm tắt + Thống kê/Xuất Excel vào 1 thanh lệnh ──
          gntSearchValue={gntSearchQuery}
          onGntSearchChange={setGntSearchQuery}
          gntStats={gntCommandStats}
          onOpenGntStats={handleBuildGntStats}
          onExportGntExcel={() => handleExportSlipsExcel(filteredPaymentSlips)}
        />

        {/* Contextual Shortcut Cards: Phân tích GTGT & TNCN */}
        {viewMode !== 'PAYMENT_SLIPS' && (
          <MetricCardsRibbon
            filings={filings}
            onAnalyzeVat={handleAnalyzeVat}
            onAnalyzePit={handleAnalyzePit}
            onOpenFolder={handleOpenFolder}
          />
        )}

        {/* Workspace Table Container */}
        <div className="flex-1 min-h-0">
          {viewMode === 'FILINGS' ? (
            <InventoryTable
              filings={filings}
              selectedIds={selectedIds}
              onToggleSelect={id => {
                const next = new Set(selectedIds);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                setSelectedIds(next);
              }}
              onSelectAll={ids => setSelectedIds(new Set(ids))}
              onDeselectAll={() => setSelectedIds(new Set())}
              onPreview={handleOpenPreview}
              missingVatCheck={missingVat}
              missingPitCheck={missingPit}
              onDownloadSelected={handleDownloadSelected}
              onDownloadAll={handleDownloadAll}
              onDownloadPeriod={handleDownloadPeriod}
              onDownloadFilings={handleDownloadFilings}
              onExportExcel={handleExportExcel}
              isDownloading={downloadSummary?.isRunning || false}
              onAnalyzeVat={handleAnalyzeVat}
              isVatAnalyzing={isVatAnalyzing}
              onExportVatReference={handleExportVatReference}
              onAnalyzePit={handleAnalyzePit}
              isPitAnalyzing={isPitAnalyzing}
              onExportPitReference={handleExportPitReference}
              selectedTaxType={selectedTaxType}
              onTaxTypeChange={setSelectedTaxType}
            />
          ) : viewMode === 'PAYMENT_SLIPS' ? (
            <PaymentSlipTable
              paymentSlips={filteredPaymentSlips}
              totalCount={enrichedPaymentSlips.length}
              reconIndex={slipReconIndex}
              errorState={paymentSlipsError}
              onRetry={handleScanPaymentSlips}
              isScanning={isScanningGnt}
            />
          ) : (
            <TaxObligationTable
              obligationSummary={obligationSummary}
              gntCount={paymentSlips.length}
              isDetailLoading={viewMode === 'OBLIGATIONS' && pendingDetailKey.length > 0}
            />
          )}
        </div>

        {/* 3. Single Unified Bottom Status / Action Bar (Chỉ hiện khi xem Tờ khai) */}
        {viewMode === 'FILINGS' && (
          <div className="shrink-0 z-20 pt-0.5">
            <BottomStatusBar
              selectedCount={selectedIds.size}
              totalCount={filings.length}
              onDeselectAll={() => setSelectedIds(new Set())}
              onDownloadSelected={handleDownloadSelected}
              downloadSummary={downloadSummary}
              onOpenDetails={() => setIsDownloadModalOpen(true)}
              onPauseDownload={pauseActiveDownload}
              onResumeDownload={async () => {
                if (downloadSummary?.state === 'AUTH_REQUIRED' || downloadSummary?.state === 'PAUSED_AUTH_REQUIRED') {
                  setIsAuthRequiredModalOpen(true);
                } else {
                  await resumeActiveDownload();
                }
              }}
              onCancelDownload={cancelActiveDownload}
              onRetryFailed={handleRetryFailed}
              onOpenFolder={handleOpenFolder}
              onDismissDownload={() => setDownloadSummary(null)}
            />
          </div>
        )}
      </main>
      </>
      )}

      {/* 4. Modals & Drawers */}
      {/* Thống kê GNT theo tháng × loại thuế */}
      <PaymentSlipStatsModal
        isOpen={gntStatsOpen}
        loading={gntStatsLoading}
        stats={gntStatsResult}
        error={gntStatsError}
        year={selectedYear}
        onClose={() => setGntStatsOpen(false)}
        onExportExcel={handleExportGntStatsExcel}
      />

      {captchaChallenge && (
        <CaptchaModal
          challenge={captchaChallenge}
          onSubmit={handleCaptchaSubmit}
          onCancel={handleCaptchaCancel}
        />
      )}

      {/* Quick Preview Side Drawer */}
      <FilingQuickPreviewDrawer
        isOpen={isPreviewOpen}
        onClose={handleClosePreview}
        filing={previewFiling}
        onDownloadSingle={handleDownloadSingle}
        onNavigatePrev={handleNavigatePrevPreview}
        onNavigateNext={handleNavigateNextPreview}
        hasPrev={hasPrevPreview}
        hasNext={hasNextPreview}
        initialShowXml={initialShowXmlPreview}
      />

      {/* VAT Reference Drawer (Bảng Tham Chiếu & Lịch Sử Bổ Sung GTGT) */}
      <VatReferenceDrawer
        isOpen={isVatDrawerOpen}
        onClose={() => setIsVatDrawerOpen(false)}
        summary={vatSummary}
        isLoading={isVatAnalyzing}
        progressMessage={vatProgressMessage}
        onExportExcel={handleExportVatReference}
        onRefreshAnalytics={handleAnalyzeVat}
        onScanSupplementalYear={handleScanSupplementalYear}
        onOpenFilingPreview={handleOpenPreviewBySubmissionId}
        targetYear={selectedYear}
      />

      {/* PIT Reference Drawer (Bảng Tham Chiếu & Đối Chiếu Nghĩa Vụ Thuế TNCN) */}
      <PitReferenceDrawer
        isOpen={isPitDrawerOpen}
        onClose={() => setIsPitDrawerOpen(false)}
        summary={pitSummary}
        isLoading={isPitAnalyzing}
        progressMessage={pitProgressMessage}
        onExportExcel={handleExportPitReference}
        onRefreshAnalytics={handleAnalyzePit}
        onOpenFilingPreview={handleOpenPreviewBySubmissionId}
        targetYear={selectedYear}
      />

      {isDownloadModalOpen && downloadSummary && (
        <DownloadProgressModal
          summary={downloadSummary}
          onPause={pauseActiveDownload}
          onResume={async () => {
            if (downloadSummary.state === 'AUTH_REQUIRED' || downloadSummary.state === 'PAUSED_AUTH_REQUIRED') {
              setIsAuthRequiredModalOpen(true);
            } else {
              await resumeActiveDownload();
            }
          }}
          onCancel={cancelActiveDownload}
          onOpenFolder={handleOpenFolder}
          onClose={() => setIsDownloadModalOpen(false)}
        />
      )}

      {isAuthRequiredModalOpen && (
        <AuthRequiredModal
          initialTaxCode={session.taxCode || ''}
          onLoginSuccess={async newTaxCode => {
            setIsAuthRequiredModalOpen(false);
            const info: UserSessionInfo = {
              isLoggedIn: true,
              taxCode: newTaxCode,
              companyName: `Doanh nghiệp MST: ${newTaxCode}`,
              loginTime: new Date().toISOString()
            };
            setSession(info);

            if (window.taxPortalAPI && (isDownloadModalOpen || isDownloadingActive)) {
              await resumeActiveDownload();
            }
          }}
          onCancel={async () => {
            setIsAuthRequiredModalOpen(false);
            if (window.taxPortalAPI) {
              await cancelActiveDownload();
            }
          }}
        />
      )}

      <AuditLogDrawer
        isOpen={isAuditDrawerOpen}
        onClose={() => setIsAuditDrawerOpen(false)}
        logs={auditLogs}
      />

      <LicenseModal
        isOpen={isLicenseModalOpen}
        onClose={() => setIsLicenseModalOpen(false)}
        initialMachineId={machineId}
        onActivated={refreshLicenseStatus}
      />

      <UpdateNotificationModal
        isOpen={isUpdateModalOpen}
        updateInfo={updateInfo}
        onClose={() => setIsUpdateModalOpen(false)}
        onDownload={handleDownloadUpdate}
        onInstall={handleInstallUpdate}
      />

      <AdminPinModal
        isOpen={isAdminPinOpen}
        onClose={() => setIsAdminPinOpen(false)}
        onSuccess={() => {
          setIsAdminUnlocked(true);
          setIsApiInspectorOpen(true);
        }}
      />
      <ApiInspectorDrawer
        isOpen={isApiInspectorOpen}
        onClose={() => setIsApiInspectorOpen(false)}
      />
    </div>
  );
};

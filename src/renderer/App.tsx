import React, { useEffect, useMemo, useRef, useState } from 'react';
import { checkMissingPeriods, resolveScanDateRange } from '../shared/dateUtils';
import {
  AppViewMode,
  AuditLogEntry,
  CaptchaChallenge,
  CheckpointData,
  DownloadSummary,
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
import { UpdateInfo } from '../shared/types';

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
  // ── Thanh lệnh GNT (đã nén vào ScanCommandBar): tìm kiếm + modal thống kê ──
  const [gntSearchQuery, setGntSearchQuery] = useState('');
  const [gntStatsOpen, setGntStatsOpen] = useState(false);
  const [gntStatsLoading, setGntStatsLoading] = useState(false);
  const [gntStatsResult, setGntStatsResult] = useState<GntStatisticsResult | null>(null);
  const [gntStatsError, setGntStatsError] = useState<string | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(() => new Date().getFullYear());
  const [scanRangeMode, setScanRangeMode] = useState<string>('YEAR_TO_DATE');
  const [selectedTaxType, setSelectedTaxType] = useState<TaxType>('ALL');

  // Auto-Updater State
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isUpdateModalOpen, setIsUpdateModalOpen] = useState(false);

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
        if (info.state === 'AVAILABLE' || info.state === 'DOWNLOADING' || info.state === 'DOWNLOADED') {
          setIsUpdateModalOpen(true);
        }
      })
    ];

    return () => {
      unsubs.forEach(unsub => unsub && unsub());
    };
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
      simulateMockScan();
    }

    if (scanId === latestScanId.current) {
      setIsScanning(false);
    }
  };

  const simulateMockScan = () => {
    setTimeout(() => {
      const mock: TaxFiling[] = [
        {
          id: '000.701.18.G12-251219-27110000132363',
          procedureCode: '1.007014',
          declarationCode: '01/GTGT',
          title: 'Khai thuế GTGT đối với phương pháp khấu trừ',
          taxType: 'VAT',
          period: `Tháng 11/${selectedYear}`,
          submittedAt: `19/12/${selectedYear} 14:59`,
          filingType: 'ORIGINAL',
          status: 'Đã chấp nhận',
          downloadAvailable: true
        },
        {
          id: '000.701.18.G12-251226-27110000025488',
          procedureCode: '1.008500',
          title: 'Đăng ký thuế lần đầu cho người phụ thuộc để giảm trừ gia cảnh',
          taxType: 'PIT',
          period: `Năm ${selectedYear}`,
          submittedAt: `26/12/${selectedYear} 10:03`,
          filingType: 'ORIGINAL',
          status: 'Đã trả kết quả',
          downloadAvailable: true
        }
      ];
      setFilings(mock);
      setSelectedIds(new Set());
      setIsScanning(false);
    }, 1000);
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
    if (window.taxPortalAPI) {
      setDownloadSummary(buildInitialDownloadSummary(1));
      setIsDownloadModalOpen(true);
      const res = await window.taxPortalAPI.startDownload({
        filings: [filing],
        taxCode: session.taxCode,
        year: selectedYear
      });
      if (res.success && res.summary) {
        setDownloadSummary(res.summary);
      }
    }
  };

  // Tải danh sách hồ sơ đã chọn
  const handleDownloadSelected = async () => {
    const toDownload = filings.filter(f => selectedIds.has(f.id));
    if (toDownload.length === 0) return;

    if (window.taxPortalAPI) {
      setDownloadSummary(buildInitialDownloadSummary(toDownload.length));
      setIsDownloadModalOpen(true);
      const res = await window.taxPortalAPI.startDownload({
        filings: toDownload,
        taxCode: session.taxCode,
        year: selectedYear
      });

      if (res.success && res.summary) {
        setDownloadSummary(res.summary);
      }
    }
  };

  // Tải TRỰC TIẾP một danh sách hồ sơ (quick download theo nhóm/lọc)
  // — không đi qua selection state nên không bị stale closure
  const handleDownloadFilings = async (list: TaxFiling[]) => {
    if (!list || list.length === 0) return;

    if (window.taxPortalAPI) {
      setDownloadSummary(buildInitialDownloadSummary(list.length));
      setIsDownloadModalOpen(true);
      const res = await window.taxPortalAPI.startDownload({
        filings: list,
        taxCode: session.taxCode,
        year: selectedYear
      });

      if (res.success && res.summary) {
        setDownloadSummary(res.summary);
      }
    }
  };

  // Tải theo từng kỳ cụ thể (Quý / Tháng)
  const handleDownloadPeriod = async (periodName: string) => {
    const toDownload = filings.filter(f => {
      const p = f.period || f.periodNormalized?.raw || '';
      return p === periodName || p.includes(periodName);
    });

    if (toDownload.length === 0) return;

    setSelectedIds(new Set(toDownload.map(f => f.id)));

    if (window.taxPortalAPI) {
      setDownloadSummary(buildInitialDownloadSummary(toDownload.length));
      setIsDownloadModalOpen(true);
      const res = await window.taxPortalAPI.startDownload({
        filings: toDownload,
        taxCode: session.taxCode,
        year: selectedYear
      });

      if (res.success && res.summary) {
        setDownloadSummary(res.summary);
      }
    }
  };

  // Tải toàn bộ hồ sơ
  const handleDownloadAll = async () => {
    if (filings.length === 0) return;

    if (window.taxPortalAPI) {
      setDownloadSummary(buildInitialDownloadSummary(filings.length));
      setIsDownloadModalOpen(true);
      const res = await window.taxPortalAPI.startDownload({
        filings,
        taxCode: session.taxCode,
        year: selectedYear
      });

      if (res.success && res.summary) {
        setDownloadSummary(res.summary);
      }
    }
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

    if (window.taxPortalAPI) {
      setDownloadSummary(buildInitialDownloadSummary(failedFilings.length));
      setIsDownloadModalOpen(true);
      const res = await window.taxPortalAPI.startDownload({
        filings: failedFilings,
        taxCode: session.taxCode,
        year: selectedYear
      });

      if (res.success && res.summary) {
        setDownloadSummary(res.summary);
      }
    }
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

    // 1. Gom hồ sơ năm hiện tại
    const currentYearFilings = filingsByYear[selectedYear] || filings;
    
    // 2. Gom thêm hồ sơ thuộc kỳ selectedYear nhưng nộp vào năm sau (như Tháng 12/YYYY nộp vào T01/YYYY+1)
    const nextYearFilings = filingsByYear[selectedYear + 1] || [];
    const crossYearFilings = nextYearFilings.filter(f => {
      const p = (f.period || f.periodNormalized?.raw || '').toLowerCase();
      return p.includes(String(selectedYear)) || p.includes(`12/${selectedYear}`) || p.includes(`q4/${selectedYear}`);
    });

    const combined = [...currentYearFilings];
    const existingIds = new Set(combined.map(f => f.id));
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
    if (filings.length === 0) return;
    setIsPitAnalyzing(true);
    setPitProgressMessage('Đang chuẩn bị phân tích dữ liệu tờ khai TNCN…');
    setIsPitDrawerOpen(true);

    if (window.taxPortalAPI) {
      const res = await window.taxPortalAPI.analyzePit({ filings });
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
      .filter(s => !gntDetails.has(s.id)).map(s => s.id).join(','),
    [successfulPaymentSlips, gntDetails]
  );

  useEffect(() => {
    if (
      (viewMode !== 'OBLIGATIONS' && viewMode !== 'PAYMENT_SLIPS') ||
      !pendingDetailKey ||
      !window.taxPortalAPI?.getPaymentSlipDetail
    ) return;
    const reqId = ++gntDetailReqId.current;
    const queue = pendingDetailKey.split(',');
    let cancelled = false;

    const worker = async () => {
      while (!cancelled && reqId === gntDetailReqId.current && queue.length > 0) {
        const ctuId = queue.shift()!;
        try {
          const res: any = await window.taxPortalAPI.getPaymentSlipDetail({ ctuId });
          if (!cancelled && res?.success && res.detail) {
            setGntDetails(prev => {
              const next = new Map(prev);
              next.set(ctuId, res.detail as PaymentSlipDetail);
              return next;
            });
          }
        } catch {
          // Bỏ qua GNT lỗi chi tiết — matcher sẽ fallback về chế độ header-only
        }
      }
    };

    Promise.all([worker(), worker(), worker(), worker()]);
    return () => { cancelled = true; };
  }, [viewMode, pendingDetailKey]);

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
          alert(`Phần mềm đang ở phiên bản mới nhất (v${res.currentVersion || '2.5.0'}).`);
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
      const res: any = await window.taxPortalAPI.scanPaymentSlips({ range });
      if (res?.success) {
        const slips: PaymentSlipRecord[] = res.paymentSlips || [];
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

  // Nếu chưa đăng nhập, hiển thị trang Login
  if (!session.isLoggedIn) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} initialTaxCode={targetLoginTaxCode} />;
  }

  const isDownloadingActive = downloadSummary?.isRunning || (downloadSummary?.remaining || 0) > 0;

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-100 font-sans antialiased text-slate-800 overflow-hidden select-none">
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
          onStartScan={viewMode === 'PAYMENT_SLIPS' ? handleScanPaymentSlips : handleStartScan}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
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
              onPauseDownload={() => window.taxPortalAPI?.pauseDownload()}
              onResumeDownload={async () => {
                if (downloadSummary?.state === 'AUTH_REQUIRED' || downloadSummary?.state === 'PAUSED_AUTH_REQUIRED') {
                  setIsAuthRequiredModalOpen(true);
                } else {
                  await window.taxPortalAPI?.resumeDownload();
                }
              }}
              onCancelDownload={() => window.taxPortalAPI?.cancelDownload()}
              onRetryFailed={handleRetryFailed}
              onOpenFolder={handleOpenFolder}
              onDismissDownload={() => setDownloadSummary(null)}
            />
          </div>
        )}
      </main>

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
          onPause={() => window.taxPortalAPI?.pauseDownload()}
          onResume={async () => {
            if (downloadSummary.state === 'AUTH_REQUIRED' || downloadSummary.state === 'PAUSED_AUTH_REQUIRED') {
              setIsAuthRequiredModalOpen(true);
            } else {
              await window.taxPortalAPI?.resumeDownload();
            }
          }}
          onCancel={() => window.taxPortalAPI?.cancelDownload()}
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
              await window.taxPortalAPI.resumeDownload();
            }
          }}
          onCancel={async () => {
            setIsAuthRequiredModalOpen(false);
            if (window.taxPortalAPI) {
              await window.taxPortalAPI.cancelDownload();
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
    </div>
  );
};

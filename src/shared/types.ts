export type TaxType = 'ALL' | 'VAT' | 'REFUND' | 'PIT' | 'CIT' | 'FCT' | 'HOUSE_LAND' | 'REPORT' | 'OTHER';

export type FilingType = 'PERIODIC' | 'FINALIZATION' | 'SUPPLEMENTAL' | 'REFUND' | 'ORIGINAL' | 'UNKNOWN';

export type PortalErrorCode =
  | 'NETWORK'
  | 'TIMEOUT'
  | 'CAPTCHA_REQUIRED'
  | 'CAPTCHA_INVALID'
  | 'SESSION_EXPIRED'
  | 'RATE_LIMIT'
  | 'SERVER_ERROR'
  | 'FILING_PAYLOAD_REJECTED'
  | 'PARSE_ERROR'
  | 'DOWNLOAD_INVALID'
  | 'FILE_WRITE_ERROR'
  | 'UNKNOWN';

export interface PeriodNormalized {
  raw?: string;
  type: 'MONTH' | 'QUARTER' | 'YEAR' | 'OTHER';
  month?: number;
  quarter?: number;
  year: number;
}

export interface TaxFiling {
  id: string; // idTKhai or maHoSo unique ID
  procedureCode?: string; // Mã thủ tục / mã nghiệp vụ (vd: 1.008346, 1.007014)
  declarationCode?: string; // Mã tờ khai (vd: 01/GTGT, 05/KK-TNCN, 03/TNDN)
  title: string; // Tên thủ tục / tiêu đề hồ sơ
  taxType: TaxType;
  period?: string; // Kỳ kê khai: Tháng 01/2026, Quý 1/2026, Năm 2025...
  periodNormalized?: PeriodNormalized;
  submittedAt?: string; // Ngày nộp dd/MM/yyyy HH:mm:ss
  filingType: FilingType; // Chính thức (Lần đầu) hoặc Bổ sung
  supplementalNo?: number; // Lần bổ sung (1, 2, 3...)
  isSequenceInferred?: boolean; // true nếu lần bổ sung được suy luận từ trình tự nộp (chronology)
  status?: string; // Trạng thái xử lý (Đã chấp nhận, Chờ xử lý...)
  amountPayable?: bigint | number | string; // Số thuế phải nộp nếu đã bóc tách từ tờ khai / XML
  rawDetailUrl?: string;
  downloadAvailable: boolean;
  // ─── GDT Download Branch Fields (từ trace thực tế) ───────────────────────
  isThueDienTu?: boolean;   // data-is-tdt: Y → /downloadhoso-tdt, N → /downloadhoso
  loaiTraCuu?: string;      // Tham số loaiTraCuu khi isThueDienTu=true
  maTkhai?: string;         // data-ma-tkhai trên nút thao tác của Cổng Thuế
  // Các dạng ID KHÁC xuất hiện trên cùng dòng hồ sơ (vd maHoSo ngắn "G12.18-..."
  // và mã tham chiếu dài "000.701.18.G12-..."). Luồng tải sẽ thử lần lượt từng
  // biến thể với cả 2 khóa maHoSo/idTKhai — trước đây chỉ giữ 1 ID nên nửa số
  // hồ sơ (TNCN, GTGT kỳ cũ) tải không được.
  altIds?: string[];
  source?: 'dvc-ho-so' | 'dvc-etax-html';
  messageId?: string;
  noticeAvailable?: boolean;
  noticeId?: string;
  // ─────────────────────────────────────────────────────────────────────────
  downloadStatus?: 'PENDING' | 'DOWNLOADING' | 'COMPLETED' | 'EXISTING' | 'FAILED';
  downloadError?: string;
  downloadedFiles?: {
    xml?: string;
    pdf?: string;
    other?: string[];
  };
}

export type FilingSourceMode = 'CURRENT' | 'DVC_ETAX_LEGACY';

export interface HistoricalFilingRecord {
  source: 'dvc-etax-html';
  messageId: string;
  transactionId?: string;
  formCode?: string;
  formName: string;
  taxPeriodRaw: string;
  taxPeriodNormalized?: {
    year: number;
    type: 'YEAR' | 'QUARTER' | 'MONTH' | 'OTHER';
    quarter?: number;
    month?: number;
  };
  filingType?: string;
  submissionNo?: number;
  amendmentNo?: number;
  submittedAt?: string;
  taxAuthority?: string;
  status?: string;
  downloadAvailable: boolean;
  noticeAvailable: boolean;
  downloadStatus?: 'PENDING' | 'DOWNLOADING' | 'COMPLETED' | 'EXISTING' | 'FAILED';
  downloadError?: string;
  downloadedFiles?: {
    xml?: string;
    pdf?: string;
    other?: string[];
  };
}

export interface HistoricalLookupCheckpoint {
  taxpayerId: string;
  yearFrom: number;
  yearTo: number;
  currentYear: number;
  currentPage: number;
  discoveredMessageIds: string[];
  downloadedMessageIds: string[];
  failedMessageIds: string[];
  status: 'IN_PROGRESS' | 'PAUSED' | 'AUTH_EXPIRED' | 'COMPLETED' | 'CANCELLED' | 'FAILED';
  updatedAt: string;
}

export interface LegacyFilingScanProgress {
  currentYear: number;
  yearFrom: number;
  yearTo: number;
  currentPage: number;
  totalPages: number;
  totalRecordsInYear: number;
  foundFilingsCount: number;
  downloadedCount: number;
  skippedCount: number;
  errorCount: number;
  status: 'IDLE' | 'SSO_INITIALIZING' | 'SCANNING' | 'DOWNLOADING' | 'COMPLETED' | 'PAUSED' | 'CANCELLED' | 'AUTH_EXPIRED' | 'ERROR';
  errorMessage?: string;
}

export interface FilingMetricItem {
  code?: string;
  label: string;
  value: string;
  type?: 'money' | 'quantity' | 'percentage' | 'integer' | 'decimal' | 'date' | 'identifier' | 'text';
  unit?: string;
  group?: string;
  isHighlight?: boolean;
  isAnomaly?: boolean;
  anomalyMessage?: string;
}

export interface FilingPreviewData {
  filingId: string;
  title: string;
  taxType: TaxType;
  procedureCode?: string;
  declarationCode?: string;
  period?: string;
  submittedAt?: string;
  filingType?: FilingType;
  supplementalNo?: number;
  status?: string;
  taxAuthority?: string;
  xmlAvailable?: boolean;
  pdfAvailable?: boolean;
  metrics: FilingMetricItem[];
  xmlSnippet?: string;
  rawDetails?: Record<string, string>;
}

export type ScanLevel = 'YEAR' | 'QUARTER' | 'MONTH' | 'MULTI_YEAR';

export interface DateRange {
  fromDate: string; // dd/MM/yyyy
  toDate: string;   // dd/MM/yyyy
  label: string;    // vd: 'Năm 2026', 'Quý 1/2026', 'Tháng 03/2026'
  level: ScanLevel;
}

export interface ScanProgressState {
  currentRange: DateRange | null;
  completedRanges: number;
  totalRanges: number;
  foundFilingsCount: number;
  level: ScanLevel;
  status: 'IDLE' | 'SCANNING' | 'NEED_CAPTCHA' | 'COMPLETED' | 'CANCELLED' | 'ERROR';
  errorMessage?: string;
}

export interface CaptchaChallenge {
  challengeId: string;
  purpose: 'LOGIN' | 'SEARCH';
  targetRange?: DateRange;
  imageBase64: string; // Data URL format `data:image/png;base64,...`
  requestReason?: 'INITIAL_SEARCH' | 'NEXT_PAGE' | 'RETRY_INVALID';
  page?: number;
  attempt?: number;
  maxAttempts?: number;
}

export interface DownloadQueueItem {
  filingId: string;
  filing: TaxFiling;
  status: 'PENDING' | 'DOWNLOADING' | 'COMPLETED' | 'EXISTING' | 'FAILED' | 'CANCELLED';
  retries: number;
  progressPercent: number;
  savedPaths?: string[];
  error?: string;
}

export type DownloadState =
  | 'IDLE'
  | 'RUNNING'
  | 'PAUSED'
  | 'AUTH_REQUIRED'
  | 'PAUSED_AUTH_REQUIRED'
  | 'COMPLETED'
  | 'CANCELLED';

export interface DownloadSummary {
  total: number;
  completed: number;
  existing: number;
  failed: number;
  downloading: number;
  pending: number;
  remaining: number;
  isPaused: boolean;
  isCancelled: boolean;
  isRunning: boolean;
  state: DownloadState;
}

export interface UserSessionInfo {
  isLoggedIn: boolean;
  taxCode?: string; // MST
  companyName?: string;
  loginTime?: string;
}

export interface CheckpointData {
  version: string;
  timestamp: string;
  taxCode: string;
  year: number;
  targetDir: string;
  filings: TaxFiling[];
  downloadStates: Record<string, {
    status: 'PENDING' | 'DOWNLOADING' | 'COMPLETED' | 'EXISTING' | 'FAILED';
    savedPaths?: string[];
    hash?: string;
  }>;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  type: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  action: string;
  details?: string;
}

export interface MissingPeriodCheck {
  isCompleteData: boolean;
  taxType: 'VAT' | 'PIT';
  periodType: 'MONTH' | 'QUARTER';
  expectedPeriods: string[];
  foundPeriods: string[];
  missingPeriods: string[];
  note?: string;
}

// ─── PHÂN HỆ GIẤY NỘP TIỀN (GNT - MẪU C1-02/NS) & NGHĨA VỤ THUẾ ───────────
export type AppViewMode = 'FILINGS' | 'PAYMENT_SLIPS' | 'OBLIGATIONS';

export interface PaymentSlipSubItem {
  stt: number;
  soToKhaiQuyetDinh?: string;
  kyThueNgayQd?: string;
  noiDungKhoanNop: string; // vd: Thuế thu nhập từ tiền lương, tiền công
  soTienNguyenTe?: string;
  soTienVND: string;
  maChuong?: string; // vd: 557
  maNDKT?: string;   // vd: 1001 (Tiểu mục)
}

export interface PaymentSlipSignatureInfo {
  signer: string; // vd: CÔNG TY TNHH..., CỤC THUẾ, NGÂN HÀNG...
  signedAt: string; // dd/MM/yyyy HH:mm:ss
}

export interface PaymentSlipRecord {
  id: string; // ctuId (vd: "53864244")
  stt: number;
  maGiaoDich: string; // Số tham chiếu / Mã giao dịch (vd: "11220260357675749")
  maGiaoDichChiTiet?: string;
  lanNop?: string;
  soGnt: string; // Số giấy nộp tiền (vd: "00000370273570901202634340228")
  soTien: number; // vd: 99921049
  soTienFormatted: string; // vd: "99,921,049"
  loaiTien: string; // "VND" | "USD"
  trangThai: string; // "Nộp thuế thành công"
  soChungTu?: string; // "1499981"
  ngayLapGnt?: string; // "17/01/2026 09:53:27"
  ngayGuiGnt?: string; // "17/01/2026 11:36:26"
  ngayNopThue?: string; // "17/01/2026 11:37:02"
  hinhThucNop?: string; // "Nộp tại cổng eTax của TCT"
  tenNganHang?: string; // "Ngân hàng TMCP Đầu tư và Phát triển Việt Nam"
  soTaiKhoan?: string; // "6503056170"
  downloadAvailable: boolean;
  downloadStatus?: 'PENDING' | 'DOWNLOADING' | 'COMPLETED' | 'EXISTING' | 'FAILED';
  downloadError?: string;
  // Phân loại rút gọn từ chi tiết C1-02 (loại thuế theo tiểu mục NDKT + kỳ thuế từng khoản nộp)
  classification?: PaymentSlipClassification;
}

export interface PaymentSlipClassification {
  taxTypes: Array<'VAT' | 'PIT' | 'CIT' | 'FCT' | 'HOUSE_LAND' | 'OTHER'>; // sắc thuế phân loại theo NDKT
  periods: string[];    // kỳ thuế của các khoản nộp (vd "01/07/2026-31/07/2026")
  ndktCodes: string[];  // danh sách tiểu mục NDKT (vd 1701, 1001)
}

export interface PaymentSlipDetail {
  id: string;
  soGnt: string;
  maHieu?: string; // vd: "2620202TSA"
  soChungTu?: string; // vd: "1499981"
  soThamChieu?: string; // vd: "11220260357675749"
  hinhThucNopTien: 'TIEN_MAT' | 'CHUYEN_KHOAN';
  loaiTien: string; // "VND" | "USD"
  nguoiNopThue: string;
  maSoThue: string;
  diaChi?: string;
  tinhTp?: string;
  nganHangTrichTk?: string;
  soTaiKhoanTrich?: string;
  loaiTaiKhoanThu: 'TK_THU_NSNN' | 'TK_TAM_THU' | 'TK_THU_HOI_HOAN_THUE';
  taiKhoanKbnn?: string;
  tinhTpKbnn?: string;
  nganHangUynhiemThu?: string;
  coQuanQuanLyThu?: string;
  items: PaymentSlipSubItem[];
  tongTienVND: string;
  tongTienBangChu?: string;
  signatures: PaymentSlipSignatureInfo[];
  rawHtml?: string;
  // Mức độ toàn vẹn của phần parse bảng chi tiết (từ GntParser.parseDetail):
  // VERIFIED = sum dòng khớp tổng header; PARTIAL/MISMATCH = dữ liệu đáng ngờ;
  // UNKNOWN = không đủ dữ liệu kết luận. UI nên fallback về số tiền danh sách
  // khi tổng rỗng hoặc integrity ≠ VERIFIED.
  detailIntegrity?: 'VERIFIED' | 'PARTIAL' | 'MISMATCH' | 'UNKNOWN';
  // Cảnh báo: nội dung chi tiết trả về KHÔNG khớp giấy nộp tiền đang chọn
  // (số tham chiếu != mã giao dịch) — eTax trả lệch chứng từ do trạng thái
  // phiên DSE. KHÔNG được dùng số liệu này làm số liệu của GNT đang mở.
  suspectedMismatch?: boolean;
}

export type PeriodAnomalyType =
  | 'MISSING_OFFICIAL'
  | 'MULTIPLE_OFFICIAL'
  | 'DISCONTINUOUS_SEQUENCE'
  | 'UNRESOLVED_SEQUENCE';

export interface SavedAccountInfo {
  taxCode: string;
  companyName?: string;
  hasPassword: boolean;
  savedAt: string;
  lastUsedAt: string;
}

export type UpdateState = 'IDLE' | 'CHECKING' | 'AVAILABLE' | 'NOT_AVAILABLE' | 'DOWNLOADING' | 'DOWNLOADED' | 'ERROR';

export interface UpdateInfo {
  state: UpdateState;
  currentVersion: string;
  latestVersion?: string;
  releaseDate?: string;
  releaseNotes?: string;
  downloadPercent?: number;
  downloadSpeed?: string;
  transferredBytes?: number;
  totalBytes?: number;
  error?: string;
}

// ─── API INSPECTOR TYPES (ADMIN / DEVELOPER DIAGNOSTICS) ────────────────
export type ApiInspectorModule =
  | 'AUTH'
  | 'SCAN'
  | 'DOWNLOAD'
  | 'ETAX_GNT'
  | 'VAT'
  | 'PIT'
  | 'SYSTEM';

export interface ApiInspectorEntry {
  id: string;
  timestamp: string; // ISO 8601
  timeFormatted: string; // HH:mm:ss.SSS
  method: string; // GET, POST, etc.
  url: string;
  endpoint: string; // Relative path or concise label (e.g., /tthc/login, /tthc/tchs/downloadhoso)
  module: ApiInspectorModule;
  status: number | 'PENDING' | 'FAILED' | 'TIMEOUT' | 'CANCELLED';
  statusText?: string;
  durationMs?: number;
  requestHeaders: Record<string, string>;
  requestParams?: Record<string, any> | string;
  requestBody?: any;
  responseHeaders?: Record<string, string>;
  responseContentType?: string;
  responseBody?: any;
  responseSize?: number;
  isError?: boolean;
  errorDetail?: {
    message: string;
    code?: string;
    httpStatus?: number;
    stack?: string;
  };
  diagnosticHint?: string; // Gợi ý chẩn đoán & khắc phục tự động
  curl: string; // Lệnh cURL sẵn sàng copy & test
}

export interface AdminAuthStatus {
  isAdmin: boolean;
  isDev: boolean;
  unlockedAt?: string;
}

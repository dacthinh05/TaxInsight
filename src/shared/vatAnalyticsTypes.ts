import { TaxFiling } from './types';

export type VatPeriodType = 'MONTH' | 'QUARTER' | 'YEAR' | 'UNKNOWN';
export type VatDeclarationType = 'ORIGINAL' | 'SUPPLEMENTAL' | 'UNKNOWN';
export type SequenceSource = 'API' | 'XML' | 'DERIVED' | 'UNKNOWN';

export interface VatIndicatorItem {
  code: string; // vd: "22", "23", "24", "25", "34", "35", "40", "43"
  name: string; // Tên chỉ tiêu tiếng Việt
  rawValue: string;
  numericValue: bigint; // Tiền thuế tính bằng Đồng (BigInt để tránh sai số float)
  source: 'API' | 'XML' | 'CALCULATED';
}

export type VatChainWarningCode =
  | 'MISSING_ORIGINAL'
  | 'MISSING_SUPPLEMENT_SEQUENCE'
  | 'UNKNOWN_PERIOD'
  | 'DUPLICATE_VERSION'
  | 'UNPARSEABLE_DECLARATION'
  | 'MISSING_REQUIRED_INDICATOR'
  | 'SCHEMA_UNSUPPORTED'
  | 'VALUE_CHANGED';

export interface VatChainWarning {
  code: VatChainWarningCode;
  message: string;
  severity: 'INFO' | 'WARNING' | 'ERROR';
}

export interface VatDeclarationSnapshot {
  taxpayerId: string;
  submissionId: string;
  formCode: string; // "01/GTGT"
  period: {
    type: VatPeriodType;
    value: string; // "01/2026", "Q1/2026", "2025"
    normalizedKey: string; // "2026-M01", "2026-Q1"
  };
  declarationType: VatDeclarationType;
  supplementalNo?: number; // 1, 2, 3...
  sequenceSource: SequenceSource;
  submittedAt?: string;
  status: string;

  // Các chỉ tiêu cốt lõi (BigInt VND)
  ct22_thueDauVaoKyTruoc: bigint;
  ct23_giaTriMuaVao: bigint;
  ct24_thueMuaVao: bigint;
  ct25_thueKhauTruKyNay: bigint;
  ct34_doanhThuBanRa: bigint;
  ct35_thueBanRa: bigint;
  ct37_dChinhGiamThueKTru?: bigint;
  ct38_dChinhTangThueKTru?: bigint;
  ct40_thuePhaiNop: bigint;
  ct42_thueDeNghiHoanKyNay?: bigint;
  ct43_thueKhauTruChuyenKySau: bigint;

  allIndicators: Record<string, VatIndicatorItem>;
  warnings: VatChainWarning[];
  parseStatus: 'SUCCESS' | 'WARNING' | 'FAILED';
  errorMessage?: string;
  xmlAvailable: boolean;
  rawXml?: string;
}

export interface VatVersionDelta {
  fromVersionLabel: string;
  toVersionLabel: string;
  deltaCt24_thueMuaVao: bigint;
  deltaCt25_thueKhauTruKyNay: bigint;
  deltaCt35_thueBanRa: bigint;
  deltaCt40_thuePhaiNop: bigint;
  deltaCt43_thueKhauTruChuyenKySau: bigint;
  hasChanged: boolean;
}

export interface VatPeriodGroup {
  periodKey: string; // "2026-M01"
  periodLabel: string; // "Tháng 01/2026"
  periodType: VatPeriodType;
  year: number;
  month?: number;
  quarter?: number;

  filings: TaxFiling[];
  snapshots: VatDeclarationSnapshot[];
  finalSnapshot?: VatDeclarationSnapshot;

  hasSupplemental: boolean;
  supplementalCount: number;
  hasValueDelta: boolean;
  deltas: VatVersionDelta[];
  warnings: VatChainWarning[];
  xmlAvailableCount?: number;
  coverageStatus?: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
}

export interface VatAnalyticsSummary {
  taxpayerId: string;
  totalFilingsCount: number;
  totalPeriodsCount: number;
  periodsWithSupplementalCount: number;
  periodsWithWarningCount: number;
  totalXmlAvailableCount?: number;
  coverageRatio?: number; // 0.0 -> 1.0 (vd: 1.0 = 100% hồ sơ có XML)
  coverageStatus?: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
  periodGroups: VatPeriodGroup[];
  analyzedAt: string;
}

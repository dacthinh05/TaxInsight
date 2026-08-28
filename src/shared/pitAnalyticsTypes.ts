import { TaxFiling } from './types';

export interface PitDeclarationSnapshot {
  submissionId: string;
  formCode: string; // "05/KK-TNCN" | "05/QTT-TNCN" | "06/TNCN"
  periodKey: string; // Vd: "2025-M01", "2025-Q02", "2025-YEAR"
  periodLabel: string;
  year: number;
  month?: number;
  quarter?: number;
  isQuarter: boolean;
  isYear: boolean;
  versionType: 'ORIGINAL' | 'SUPPLEMENTAL';
  supplementalNo: number;
  submittedAt?: string;
  status: string;

  // Giá trị ngữ nghĩa của 05/KK-TNCN. Tên property được giữ để tương thích
  // dữ liệu/cache cũ; với TT80 nguồn XML đúng lần lượt là [16], [17], [21],
  // [26], [29], [30], [31].
  ct21_tongSoNguoiLaoDong: bigint; // TT80: [16]
  ct22_caNhanCuTru: bigint;        // TT80: [17]
  ct24_tongThuNhapChiuThue: bigint; // TT80: [21]
  ct27_tongThuNhapChiuThueKhauTru: bigint; // TT80: [26]
  ct31_tongThueTncnDaKhauTru: bigint; // TT80: [29]
  ct32_khauTruCaNhanCuTru: bigint;    // TT80: [30]
  ct33_khauTruCaNhanKhongCuTru: bigint; // TT80: [31]
  ct34_tongThueKhauTru: bigint;        // TT80: [29] = [30] + [31]
  ct35_tongThuePhaiNop: bigint;        // Thuế TNCN phải nộp

  // Chỉ tiêu tờ khai Quyết toán năm 05/QTT-TNCN (nếu là tờ khai quyết toán)
  isFinalization: boolean;
  ct36_qtt_tongThueDaKhauTruTrongNam?: bigint; // TT80: [31]
  ct41_qtt_tongThuePhaiNopTrongNam?: bigint;   // TT80: [40]
  ct44_qtt_tongThueNopThua?: bigint;           // TT80: [41]

  rawXml?: string;
  xmlAvailable?: boolean;
  parseStatus?: 'SUCCESS' | 'FAILED';
  errorMessage?: string;
}

export interface PitPeriodGroup {
  periodKey: string;
  periodLabel: string;
  year: number;
  month?: number;
  quarter?: number;
  periodType: 'MONTH' | 'QUARTER' | 'YEAR';
  snapshots: PitDeclarationSnapshot[];
  finalSnapshot: PitDeclarationSnapshot | null;
  hasSupplemental: boolean;
  supplementalCount: number;
}

export interface PitAnalyticsSummary {
  taxpayerId: string;
  taxpayerName?: string;
  totalFilingsAnalyzed: number;
  periodGroups: PitPeriodGroup[];
  finalizationSnapshot: PitDeclarationSnapshot | null; // Tờ khai 05/QTT-TNCN năm
  analyzedAt: string;
  totalXmlAvailableCount?: number;
  failedXmlCount?: number;
  coverageStatus?: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
  failedXmlDetails?: Array<{ submissionId: string; periodLabel: string; reason: string }>;
}

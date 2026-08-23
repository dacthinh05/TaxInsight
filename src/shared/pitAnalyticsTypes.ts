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

  // Các chỉ tiêu cốt lõi tờ khai 05/KK-TNCN (theo TT 80/2021/TT-BTC)
  ct21_tongSoNguoiLaoDong: bigint;
  ct22_caNhanCuTru: bigint;
  ct24_tongThuNhapChiuThue: bigint;
  ct27_tongThuNhapChiuThueKhauTru: bigint;
  ct31_tongThueTncnDaKhauTru: bigint; // [31] trên một số phiên bản cũ hoặc [34]
  ct32_khauTruCaNhanCuTru: bigint;    // Thuế TNCN đã khấu trừ - cá nhân cư trú
  ct33_khauTruCaNhanKhongCuTru: bigint; // Thuế TNCN đã khấu trừ - cá nhân không cư trú
  ct34_tongThueKhauTru: bigint;        // Tổng số thuế TNCN đã khấu trừ = [32] + [33]
  ct35_tongThuePhaiNop: bigint;        // Thuế TNCN phải nộp

  // Chỉ tiêu tờ khai Quyết toán năm 05/QTT-TNCN (nếu là tờ khai quyết toán)
  isFinalization: boolean;
  ct36_qtt_tongThueDaKhauTruTrongNam?: bigint; // Chỉ tiêu [36] trên 05/QTT-TNCN
  ct41_qtt_tongThuePhaiNopTrongNam?: bigint;   // Chỉ tiêu [41] trên 05/QTT-TNCN
  ct44_qtt_tongThueNopThua?: bigint;           // Chỉ tiêu [44] trên 05/QTT-TNCN

  rawXml?: string;
  xmlAvailable?: boolean;
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
}

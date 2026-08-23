export type CoverageStatus = 'COMPLETE' | 'PARTIAL' | 'UNKNOWN' | 'NOT_SCANNED' | 'FAILED';

export interface DateInterval {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

export interface ScanCoverageRecord {
  coverageId: string;
  taxpayerId: string;
  source: 'GDT_PORTAL' | 'LOCAL_CACHE';
  taxType: string; // 'ALL' | 'VAT' | 'PIT' | 'CIT' | 'FCT'
  submissionDateFrom: string; // YYYY-MM-DD
  submissionDateTo: string;   // YYYY-MM-DD
  scannedAt: string;          // ISO timestamp
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  recordCount: number;
  completedSuccessfully: boolean;
}

export interface YearCoverageEvaluation {
  targetYear: number;
  taxpayerId: string;
  status: CoverageStatus;
  coveredRanges: DateInterval[];
  missingRanges: DateInterval[];
  recordsFoundInYear: number;
  lastScannedAt?: string;
  message: string;
  ctaText?: string;
}

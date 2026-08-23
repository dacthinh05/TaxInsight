import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ParsedSnapshotStore } from '../src/main/persistence/ParsedSnapshotStore';
import { isSafeExtractionPath, sanitizeExcelCellValue, sanitizeFilename } from '../src/shared/sanitizer';
import { parseMoneyToBigInt, formatMoneyVND } from '../src/shared/moneyUtils';
import { TaxFilingParser } from '../src/main/scanner/TaxFilingParser';
import { TaxPaymentMatcher } from '../src/main/engine/TaxPaymentMatcher';
import { TaxObligation, TaxDeadlineResult } from '../src/shared/obligationTypes';
import { PaymentSlipRecord, TaxFiling } from '../src/shared/types';
import { VatDeclarationSnapshot } from '../src/shared/vatAnalyticsTypes';

describe('PRODUCTION AUDIT & HARDENING TEST SUITE', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taxinsight-audit-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  // 1. PARSED SNAPSHOT STORE & NEGATIVE BIGINT
  it('Bug A — ParsedSnapshotStore correctly serializes and restores NEGATIVE BigInts', () => {
    const taxCode = '0101234567';
    const submissionId = 'SUB-NEGATIVE-TEST-001';

    const testSnapshot: Partial<VatDeclarationSnapshot> = {
      taxpayerId: taxCode,
      submissionId,
      formCode: '01/GTGT',
      ct22_thueDauVaoKyTruoc: 10000000n,
      ct37_dChinhGiamThueKTru: -5000000n,
      ct38_dChinhTangThueKTru: 12000000n,
      ct40_thuePhaiNop: 0n,
      xmlAvailable: true
    };

    ParsedSnapshotStore.saveSnapshot(tempDir, taxCode, submissionId, testSnapshot);

    const loaded = ParsedSnapshotStore.getSnapshot<Partial<VatDeclarationSnapshot>>(
      tempDir,
      taxCode,
      submissionId
    );

    expect(loaded).toBeDefined();
    expect(loaded?.ct37_dChinhGiamThueKTru).toBe(-5000000n);
    expect(typeof loaded?.ct37_dChinhGiamThueKTru).toBe('bigint');
    expect(loaded?.ct22_thueDauVaoKyTruoc).toBe(10000000n);
    expect(loaded?.xmlAvailable).toBe(true);
  });

  // 2. EXCEL FORMULA INJECTION & NEGATIVE NUMBERS
  it('Bug B — FormulaSanitizer neutralizes formula injection while preserving real negative numbers', () => {
    expect(sanitizeExcelCellValue('=SUM(A1:A2)')).toBe("'=SUM(A1:A2)");
    expect(sanitizeExcelCellValue('+cmd|/C calc')).toBe("'+cmd|/C calc");
    expect(sanitizeExcelCellValue('-cmd|/C calc')).toBe("'-cmd|/C calc");
    expect(sanitizeExcelCellValue('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)");
    expect(sanitizeExcelCellValue('\t=1+1')).toBe("'\t=1+1");
    expect(sanitizeExcelCellValue('\r=1+1')).toBe("'\r=1+1");
    expect(sanitizeExcelCellValue('\n=1+1')).toBe("'\n=1+1");

    expect(sanitizeExcelCellValue(-100)).toBe(-100);
    expect(sanitizeExcelCellValue('-100')).toBe(-100);
    expect(sanitizeExcelCellValue('-100.50')).toBe(-100.5);
    expect(sanitizeExcelCellValue('123456')).toBe(123456);
    expect(sanitizeExcelCellValue(0)).toBe(0);
  });

  // 3. WINDOWS RESERVED DEVICE NAMES SANITIZATION
  it('Bug C — SanitizeFilename prevents Windows reserved device names collision', () => {
    expect(sanitizeFilename('CON.xml')).toBe('DOC_CON.xml');
    expect(sanitizeFilename('prn.pdf')).toBe('DOC_prn.pdf');
    expect(sanitizeFilename('aux.json')).toBe('DOC_aux.json');
    expect(sanitizeFilename('NUL.xml')).toBe('DOC_NUL.xml');
    expect(sanitizeFilename('COM1.xml')).toBe('DOC_COM1.xml');
    expect(sanitizeFilename('LPT2.pdf')).toBe('DOC_LPT2.pdf');
    expect(sanitizeFilename('NormalFile.xml')).toBe('NormalFile.xml');
  });

  // 4. ZIP-SLIP ATTACK PREVENTION
  it('Bug D — isSafeExtractionPath rejects path traversal and malicious ZIP entries', () => {
    const targetDir = path.resolve('/var/app/storage');

    expect(isSafeExtractionPath(targetDir, 'document.xml')).toBe(true);
    expect(isSafeExtractionPath(targetDir, 'subfolder/document.xml')).toBe(true);

    expect(isSafeExtractionPath(targetDir, '../../etc/passwd')).toBe(false);
    expect(isSafeExtractionPath(targetDir, '..\\..\\Windows\\System32\\calc.exe')).toBe(false);
    expect(isSafeExtractionPath(targetDir, '/etc/shadow')).toBe(false);
  });

  // 5. MONEY UTILS BIGINT PRECISION & DECIMAL PARSING
  it('Bug E — MoneyUtils parses Vietnamese number formats without precision loss', () => {
    expect(parseMoneyToBigInt('1.234.567.890')).toBe(1234567890n);
    expect(parseMoneyToBigInt('1,234,567,890')).toBe(1234567890n);
    expect(parseMoneyToBigInt('-5.000.000')).toBe(-5000000n);
    expect(parseMoneyToBigInt('(5.000.000)')).toBe(-5000000n);
    expect(parseMoneyToBigInt('100.50')).toBe(100n);
    expect(parseMoneyToBigInt('')).toBe(0n);
    expect(parseMoneyToBigInt(null)).toBe(0n);
    expect(parseMoneyToBigInt(undefined)).toBe(0n);

    expect(formatMoneyVND(1234567890n, { showUnit: true })).toBe('1.234.567.890 ₫');
    expect(formatMoneyVND(-5000000n, { showUnit: false })).toBe('-5.000.000');
  });

  // 6. DEDUPLICATION & METADATA MERGE INVARIANT
  it('Bug F — DeduplicateFilings preserves downloadedFiles and resolves supplemental sequence', () => {
    const existing: TaxFiling[] = [
      {
        id: 'FILING-001',
        procedureCode: '1.007014',
        title: 'Khai thuế GTGT',
        taxType: 'VAT',
        period: 'Tháng 01/2025',
        submittedAt: '20/02/2025 09:00',
        filingType: 'ORIGINAL',
        status: 'Đã chấp nhận',
        downloadAvailable: true,
        downloadStatus: 'COMPLETED',
        downloadedFiles: { xml: '/path/to/01.xml', pdf: '/path/to/01.pdf' }
      }
    ];

    const incoming: TaxFiling[] = [
      {
        id: 'FILING-001',
        procedureCode: '1.007014',
        title: 'Khai thuế GTGT (Cập nhật)',
        taxType: 'VAT',
        period: 'Tháng 01/2025',
        submittedAt: '20/02/2025 09:00',
        filingType: 'ORIGINAL',
        status: 'Đã chấp nhận',
        downloadAvailable: true
      },
      {
        id: 'FILING-002',
        procedureCode: '1.008327',
        title: 'Khai bổ sung GTGT',
        taxType: 'VAT',
        period: 'Tháng 01/2025',
        submittedAt: '25/03/2025 10:00',
        filingType: 'SUPPLEMENTAL',
        status: 'Đã tiếp nhận',
        downloadAvailable: true
      }
    ];

    const merged = TaxFilingParser.deduplicateFilings(existing, incoming);

    expect(merged.length).toBe(2);
    const filing1 = merged.find(f => f.id === 'FILING-001')!;
    expect(filing1.downloadStatus).toBe('COMPLETED');
    expect(filing1.downloadedFiles?.xml).toBe('/path/to/01.xml');

    const filing2 = merged.find(f => f.id === 'FILING-002')!;
    expect(filing2.supplementalNo).toBe(1);
  });

  // 7. TAX OBLIGATION MATCHING & NO DOUBLE COUNTING
  it('Bug G — TaxPaymentMatcher allocates payments without double counting across obligations', () => {
    const mockDeadline: TaxDeadlineResult = {
      baseFilingDeadline: '20/02/2025',
      basePaymentDeadline: '20/02/2025',
      effectiveFilingDeadline: '20/02/2025',
      effectivePaymentDeadline: '20/02/2025',
      ruleId: 'RULE-VAT-MONTHLY',
      legalBasis: [],
      extensionApplied: false,
      confidence: 'CONFIRMED',
      isAdjustedForHoliday: false
    };

    const obligations: TaxObligation[] = [
      {
        id: 'OB-01',
        taxCode: '0101234567',
        taxType: 'VAT',
        declarationCode: '01/GTGT',
        title: 'Khai thuế GTGT T01/2025',
        periodKey: '2025-M01',
        periodLabel: 'Tháng 01/2025',
        year: 2025,
        month: 1,
        amountPayable: 10000000n,
        hasSupplemental: false,
        supplementalCount: 0,
        currentVersion: 'Chính thức',
        deadline: mockDeadline,
        status: 'NOT_DUE',
        daysRemaining: 5,
        matchedPaymentAmount: 0n,
        matchedSlips: [],
        discrepancy: 10000000n,
        statusMessage: ''
      },
      {
        id: 'OB-02',
        taxCode: '0101234567',
        taxType: 'VAT',
        declarationCode: '01/GTGT',
        title: 'Khai thuế GTGT T02/2025',
        periodKey: '2025-M02',
        periodLabel: 'Tháng 02/2025',
        year: 2025,
        month: 2,
        amountPayable: 10000000n,
        hasSupplemental: false,
        supplementalCount: 0,
        currentVersion: 'Chính thức',
        deadline: mockDeadline,
        status: 'NOT_DUE',
        daysRemaining: 35,
        matchedPaymentAmount: 0n,
        matchedSlips: [],
        discrepancy: 10000000n,
        statusMessage: ''
      }
    ];

    const paymentSlips: PaymentSlipRecord[] = [
      {
        id: 'GNT-01',
        stt: 1,
        soGnt: 'GNT-2025-001',
        maGiaoDich: 'GD-001',
        ngayNopThue: '15/02/2025',
        soTien: 15000000,
        soTienFormatted: '15,000,000',
        loaiTien: 'VND',
        trangThai: 'Nộp thuế thành công',
        lanNop: '01/2025',
        downloadAvailable: true
      }
    ];

    const matched = TaxPaymentMatcher.matchPayments(obligations, paymentSlips);

    expect(matched[0].status).toBe('PAID_MATCHED');
    expect(matched[0].matchedPaymentAmount).toBe(10000000n);
    expect(matched[0].matchedSlips.length).toBe(1);
    expect(matched[0].matchedSlips[0].allocatedAmount).toBe(10000000n);

    expect(matched[1].status).toBe('NOT_DUE');
    expect(matched[1].matchedPaymentAmount).toBe(0n);
  });
});

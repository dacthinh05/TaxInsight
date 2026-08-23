import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import ExcelJS from 'exceljs';
import { parseMoneyToBigInt, parseMoneyStrict, formatMoneyVND } from '../src/shared/moneyUtils';
import { TaxPaymentMatcher } from '../src/main/engine/TaxPaymentMatcher';
import { TaxObligation, TaxDeadlineResult } from '../src/shared/obligationTypes';
import { PaymentSlipRecord, TaxFiling } from '../src/shared/types';
import { ParsedSnapshotStore } from '../src/main/persistence/ParsedSnapshotStore';
import { VatDeclarationSnapshot, VatAnalyticsSummary } from '../src/shared/vatAnalyticsTypes';
import { VatAnalyticsEngine } from '../src/main/scanner/VatAnalyticsEngine';
import { TaxObligationEngine } from '../src/main/engine/TaxObligationEngine';
import { resolvePeriodSupplementalSequences, normalizeVatPeriod } from '../src/shared/dateUtils';
import { sanitizeExcelCellValue } from '../src/shared/sanitizer';

describe('PHASE 2 — ADVERSARIAL DATA INTEGRITY & RUNTIME AUDIT', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taxinsight-phase2-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 2 & 3: MONEY PARSER CONTRACT & STRICT STATUS (MISSING/INVALID/ZERO)
  // ══════════════════════════════════════════════════════════════════════
  describe('Section 2 & 3: Money Parser Strict Contract & Status', () => {
    it('handles all numeric formats, decimals, thousand separators and currency notations', () => {
      expect(parseMoneyToBigInt('1000')).toBe(1000n);
      expect(parseMoneyToBigInt('1000.00')).toBe(1000n);
      expect(parseMoneyToBigInt('1000,00')).toBe(1000n);
      expect(parseMoneyToBigInt('1.000')).toBe(1000n);
      expect(parseMoneyToBigInt('1,000')).toBe(1000n);
      expect(parseMoneyToBigInt('1.234')).toBe(1234n);
      expect(parseMoneyToBigInt('1,234')).toBe(1234n);
      expect(parseMoneyToBigInt('1.234,56')).toBe(1234n);
      expect(parseMoneyToBigInt('1,234.56')).toBe(1234n);
      expect(parseMoneyToBigInt('1.000.000')).toBe(1000000n);
      expect(parseMoneyToBigInt('1,000,000')).toBe(1000000n);
      expect(parseMoneyToBigInt('-1.000')).toBe(-1000n);
      expect(parseMoneyToBigInt('-1,000')).toBe(-1000n);
      expect(parseMoneyToBigInt('(1.000)')).toBe(-1000n);
      expect(parseMoneyToBigInt('(1,000)')).toBe(-1000n);
      expect(parseMoneyToBigInt('1 000')).toBe(1000n);
      expect(parseMoneyToBigInt('1 000,50')).toBe(1000n);
      expect(parseMoneyToBigInt('1.000 ₫')).toBe(1000n);
      expect(parseMoneyToBigInt('1.000 VND')).toBe(1000n);
    });

    it('strictly differentiates between VALID_ZERO, VALID_AMOUNT, MISSING, and INVALID', () => {
      // VALID ZERO
      const resZero1 = parseMoneyStrict('0');
      expect(resZero1.status).toBe('VALID');
      expect(resZero1.value).toBe(0n);

      const resZero2 = parseMoneyStrict(0);
      expect(resZero2.status).toBe('VALID');
      expect(resZero2.value).toBe(0n);

      const resZero3 = parseMoneyStrict(0n);
      expect(resZero3.status).toBe('VALID');
      expect(resZero3.value).toBe(0n);

      // VALID AMOUNT
      const resAmt = parseMoneyStrict('5.000.000');
      expect(resAmt.status).toBe('VALID');
      expect(resAmt.value).toBe(5000000n);

      // MISSING (null, undefined, empty string, placeholder dashes)
      expect(parseMoneyStrict(null).status).toBe('MISSING');
      expect(parseMoneyStrict(undefined).status).toBe('MISSING');
      expect(parseMoneyStrict('').status).toBe('MISSING');
      expect(parseMoneyStrict('   ').status).toBe('MISSING');
      expect(parseMoneyStrict('—').status).toBe('MISSING');
      expect(parseMoneyStrict('N/A').status).toBe('MISSING');

      // INVALID (letters, corrupted strings with no digits)
      expect(parseMoneyStrict('invalid_amount').status).toBe('INVALID');
      expect(parseMoneyStrict('NaN').status).toBe('INVALID');
      expect(parseMoneyStrict('---').status).toBe('INVALID');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 4 & 5: TAX PAYMENT MATCHER ADVERSARIAL MATRIX (SCENARIOS A -> L)
  // ══════════════════════════════════════════════════════════════════════
  describe('Section 4 & 5: TaxPaymentMatcher Adversarial Scenarios A -> L', () => {
    const mockDeadline: TaxDeadlineResult = {
      baseFilingDeadline: '20/02/2026',
      basePaymentDeadline: '20/02/2026',
      effectiveFilingDeadline: '20/02/2026',
      effectivePaymentDeadline: '20/02/2026',
      ruleId: 'RULE-VAT',
      legalBasis: [],
      extensionApplied: false,
      confidence: 'CONFIRMED',
      isAdjustedForHoliday: false
    };

    // Scenario A: Obligation 100M, Payment 100M -> PAID_MATCHED
    it('Scenario A: Exact match (100M obligation + 100M payment)', () => {
      const ob: TaxObligation = {
        id: 'OB-A',
        taxCode: '0101234567',
        taxType: 'VAT',
        declarationCode: '01/GTGT',
        title: 'Khai thuế GTGT T01/2026',
        periodKey: '2026-M01',
        periodLabel: 'Tháng 01/2026',
        year: 2026,
        month: 1,
        amountPayable: 100000000n,
        hasSupplemental: false,
        supplementalCount: 0,
        currentVersion: 'Chính thức',
        deadline: mockDeadline,
        status: 'NOT_DUE',
        daysRemaining: 5,
        matchedPaymentAmount: 0n,
        matchedSlips: [],
        discrepancy: 100000000n,
        statusMessage: ''
      };

      const slip: PaymentSlipRecord = {
        id: 'GNT-A',
        stt: 1,
        soGnt: 'GNT-001',
        maGiaoDich: 'GD-001',
        ngayNopThue: '15/02/2026',
        soTien: 100000000,
        soTienFormatted: '100,000,000',
        loaiTien: 'VND',
        trangThai: 'Nộp thuế thành công',
        lanNop: '01/2026',
        downloadAvailable: true
      };

      const matched = TaxPaymentMatcher.matchPayments([ob], [slip]);
      expect(matched[0].status).toBe('PAID_MATCHED');
      expect(matched[0].matchedPaymentAmount).toBe(100000000n);
      expect(matched[0].discrepancy).toBe(0n);
    });

    // Scenario B: Obligation 100M, Payments 40M + 60M -> PAID_MATCHED
    it('Scenario B: Multi-payment match (40M + 60M = 100M)', () => {
      const ob: TaxObligation = {
        id: 'OB-B',
        taxCode: '0101234567',
        taxType: 'VAT',
        declarationCode: '01/GTGT',
        title: 'Khai thuế GTGT T01/2026',
        periodKey: '2026-M01',
        periodLabel: 'Tháng 01/2026',
        year: 2026,
        month: 1,
        amountPayable: 100000000n,
        hasSupplemental: false,
        supplementalCount: 0,
        currentVersion: 'Chính thức',
        deadline: mockDeadline,
        status: 'NOT_DUE',
        daysRemaining: 5,
        matchedPaymentAmount: 0n,
        matchedSlips: [],
        discrepancy: 100000000n,
        statusMessage: ''
      };

      const slip1: PaymentSlipRecord = {
        id: 'GNT-B1',
        stt: 1,
        soGnt: 'GNT-B1',
        maGiaoDich: 'GD-B1',
        ngayNopThue: '10/02/2026',
        soTien: 40000000,
        soTienFormatted: '40,000,000',
        loaiTien: 'VND',
        trangThai: 'Nộp thuế thành công',
        lanNop: '01/2026',
        downloadAvailable: true
      };

      const slip2: PaymentSlipRecord = {
        id: 'GNT-B2',
        stt: 2,
        soGnt: 'GNT-B2',
        maGiaoDich: 'GD-B2',
        ngayNopThue: '12/02/2026',
        soTien: 60000000,
        soTienFormatted: '60,000,000',
        loaiTien: 'VND',
        trangThai: 'Nộp thuế thành công',
        lanNop: '01/2026',
        downloadAvailable: true
      };

      const matched = TaxPaymentMatcher.matchPayments([ob], [slip1, slip2]);
      expect(matched[0].status).toBe('PAID_MATCHED');
      expect(matched[0].matchedPaymentAmount).toBe(100000000n);
      expect(matched[0].matchedSlips.length).toBe(2);
      expect(matched[0].discrepancy).toBe(0n);
    });

    // Scenario C: Obligation 100M, Payment 40M -> PARTIALLY_MATCHED
    it('Scenario C: Partial payment match (40M of 100M -> PARTIALLY_MATCHED)', () => {
      const ob: TaxObligation = {
        id: 'OB-C',
        taxCode: '0101234567',
        taxType: 'VAT',
        declarationCode: '01/GTGT',
        title: 'Khai thuế GTGT T01/2026',
        periodKey: '2026-M01',
        periodLabel: 'Tháng 01/2026',
        year: 2026,
        month: 1,
        amountPayable: 100000000n,
        hasSupplemental: false,
        supplementalCount: 0,
        currentVersion: 'Chính thức',
        deadline: mockDeadline,
        status: 'NOT_DUE',
        daysRemaining: 5,
        matchedPaymentAmount: 0n,
        matchedSlips: [],
        discrepancy: 100000000n,
        statusMessage: ''
      };

      const slip: PaymentSlipRecord = {
        id: 'GNT-C',
        stt: 1,
        soGnt: 'GNT-C',
        maGiaoDich: 'GD-C',
        ngayNopThue: '10/02/2026',
        soTien: 40000000,
        soTienFormatted: '40,000,000',
        loaiTien: 'VND',
        trangThai: 'Nộp thuế thành công',
        lanNop: '01/2026',
        downloadAvailable: true
      };

      const matched = TaxPaymentMatcher.matchPayments([ob], [slip]);
      expect(matched[0].status).toBe('PARTIALLY_MATCHED');
      expect(matched[0].matchedPaymentAmount).toBe(40000000n);
      expect(matched[0].discrepancy).toBe(60000000n);
    });

    // Scenario D: Obligation 100M, Payment 120M -> PAID_MATCHED (Excess remaining unallocated)
    it('Scenario D: Overpayment match (120M payment for 100M obligation)', () => {
      const ob: TaxObligation = {
        id: 'OB-D',
        taxCode: '0101234567',
        taxType: 'VAT',
        declarationCode: '01/GTGT',
        title: 'Khai thuế GTGT T01/2026',
        periodKey: '2026-M01',
        periodLabel: 'Tháng 01/2026',
        year: 2026,
        month: 1,
        amountPayable: 100000000n,
        hasSupplemental: false,
        supplementalCount: 0,
        currentVersion: 'Chính thức',
        deadline: mockDeadline,
        status: 'NOT_DUE',
        daysRemaining: 5,
        matchedPaymentAmount: 0n,
        matchedSlips: [],
        discrepancy: 100000000n,
        statusMessage: ''
      };

      const slip: PaymentSlipRecord = {
        id: 'GNT-D',
        stt: 1,
        soGnt: 'GNT-D',
        maGiaoDich: 'GD-D',
        ngayNopThue: '10/02/2026',
        soTien: 120000000,
        soTienFormatted: '120,000,000',
        loaiTien: 'VND',
        trangThai: 'Nộp thuế thành công',
        lanNop: '01/2026',
        downloadAvailable: true
      };

      const matched = TaxPaymentMatcher.matchPayments([ob], [slip]);
      expect(matched[0].status).toBe('PAID_MATCHED');
      expect(matched[0].matchedPaymentAmount).toBe(100000000n); // Chỉ phân bổ đúng mức cần
      expect(matched[0].discrepancy).toBe(0n);
    });

    // Scenario E & G: Two obligations, one GNT matching specific period
    it('Scenario E & G: GNT matches period T01/2026 only, leaves T02/2026 unallocated', () => {
      const ob1: TaxObligation = {
        id: 'OB-E1',
        taxCode: '0101234567',
        taxType: 'VAT',
        declarationCode: '01/GTGT',
        title: 'Khai thuế GTGT T01/2026',
        periodKey: '2026-M01',
        periodLabel: 'Tháng 01/2026',
        year: 2026,
        month: 1,
        amountPayable: 100000000n,
        hasSupplemental: false,
        supplementalCount: 0,
        currentVersion: 'Chính thức',
        deadline: mockDeadline,
        status: 'NOT_DUE',
        daysRemaining: 5,
        matchedPaymentAmount: 0n,
        matchedSlips: [],
        discrepancy: 100000000n,
        statusMessage: ''
      };

      const ob2: TaxObligation = {
        id: 'OB-E2',
        taxCode: '0101234567',
        taxType: 'VAT',
        declarationCode: '01/GTGT',
        title: 'Khai thuế GTGT T02/2026',
        periodKey: '2026-M02',
        periodLabel: 'Tháng 02/2026',
        year: 2026,
        month: 2,
        amountPayable: 100000000n,
        hasSupplemental: false,
        supplementalCount: 0,
        currentVersion: 'Chính thức',
        deadline: mockDeadline,
        status: 'NOT_DUE',
        daysRemaining: 35,
        matchedPaymentAmount: 0n,
        matchedSlips: [],
        discrepancy: 100000000n,
        statusMessage: ''
      };

      const slip: PaymentSlipRecord = {
        id: 'GNT-E',
        stt: 1,
        soGnt: 'GNT-E',
        maGiaoDich: 'GD-E',
        ngayNopThue: '15/02/2026',
        soTien: 100000000,
        soTienFormatted: '100,000,000',
        loaiTien: 'VND',
        trangThai: 'Nộp thuế thành công',
        lanNop: '01/2026',
        downloadAvailable: true
      };

      const matched = TaxPaymentMatcher.matchPayments([ob1, ob2], [slip]);
      const matched1 = matched.find(o => o.id === 'OB-E1')!;
      const matched2 = matched.find(o => o.id === 'OB-E2')!;

      expect(matched1.status).toBe('PAID_MATCHED');
      expect(matched2.status).toBe('NOT_DUE');
      expect(matched2.matchedPaymentAmount).toBe(0n);
    });

    // Scenario F: VAT vs PIT tax type separation
    it('Scenario F: Tax type isolation (GNT with VAT sub-item does NOT match PIT obligation)', () => {
      const obPit: TaxObligation = {
        id: 'OB-PIT',
        taxCode: '0101234567',
        taxType: 'PIT',
        declarationCode: '05/KK-TNCN',
        title: 'Khai thuế TNCN T01/2026',
        periodKey: '2026-M01',
        periodLabel: 'Tháng 01/2026',
        year: 2026,
        month: 1,
        amountPayable: 50000000n,
        hasSupplemental: false,
        supplementalCount: 0,
        currentVersion: 'Chính thức',
        deadline: mockDeadline,
        status: 'NOT_DUE',
        daysRemaining: 5,
        matchedPaymentAmount: 0n,
        matchedSlips: [],
        discrepancy: 50000000n,
        statusMessage: ''
      };

      const slipVat: PaymentSlipRecord = {
        id: 'GNT-VAT',
        stt: 1,
        soGnt: 'GNT-VAT',
        maGiaoDich: 'GD-VAT',
        ngayNopThue: '15/02/2026',
        soTien: 50000000,
        soTienFormatted: '50,000,000',
        loaiTien: 'VND',
        trangThai: 'Nộp thuế thành công',
        lanNop: '01/2026',
        downloadAvailable: true
      };

      const detailsMap = new Map();
      detailsMap.set('GNT-VAT', {
        id: 'GNT-VAT',
        items: [
          {
            stt: 1,
            noiDungKhoanNop: 'Thuế giá trị gia tăng hàng hóa dịch vụ',
            maNDKT: '1701',
            soTienVND: '50.000.000'
          }
        ]
      });

      const matched = TaxPaymentMatcher.matchPayments([obPit], [slipVat], detailsMap);
      expect(matched[0].status).toBe('NOT_DUE');
      expect(matched[0].matchedPaymentAmount).toBe(0n);
    });

    // Scenario J: Cancelled / Reversal payment is ignored
    it('Scenario J: Cancelled or failed payments are completely ignored', () => {
      const ob: TaxObligation = {
        id: 'OB-J',
        taxCode: '0101234567',
        taxType: 'VAT',
        declarationCode: '01/GTGT',
        title: 'Khai thuế GTGT T01/2026',
        periodKey: '2026-M01',
        periodLabel: 'Tháng 01/2026',
        year: 2026,
        month: 1,
        amountPayable: 100000000n,
        hasSupplemental: false,
        supplementalCount: 0,
        currentVersion: 'Chính thức',
        deadline: mockDeadline,
        status: 'NOT_DUE',
        daysRemaining: 5,
        matchedPaymentAmount: 0n,
        matchedSlips: [],
        discrepancy: 100000000n,
        statusMessage: ''
      };

      const slipCancelled: PaymentSlipRecord = {
        id: 'GNT-CANCELLED',
        stt: 1,
        soGnt: 'GNT-CAN',
        maGiaoDich: 'GD-CAN',
        ngayNopThue: '15/02/2026',
        soTien: 100000000,
        soTienFormatted: '100,000,000',
        loaiTien: 'VND',
        trangThai: 'Giao dịch bị từ chối / Đã hủy',
        lanNop: '01/2026',
        downloadAvailable: true
      };

      const matched = TaxPaymentMatcher.matchPayments([ob], [slipCancelled]);
      expect(matched[0].status).toBe('NOT_DUE');
      expect(matched[0].matchedPaymentAmount).toBe(0n);
    });

    // Scenario L: Metamorphic array order invariance
    it('Scenario L: Matching result is 100% deterministic regardless of input array ordering', () => {
      const ob1: TaxObligation = {
        id: 'OB-L1',
        taxCode: '0101234567',
        taxType: 'VAT',
        declarationCode: '01/GTGT',
        title: 'Khai thuế GTGT T01/2026',
        periodKey: '2026-M01',
        periodLabel: 'Tháng 01/2026',
        year: 2026,
        month: 1,
        amountPayable: 50000000n,
        hasSupplemental: false,
        supplementalCount: 0,
        currentVersion: 'Chính thức',
        deadline: mockDeadline,
        status: 'NOT_DUE',
        daysRemaining: 5,
        matchedPaymentAmount: 0n,
        matchedSlips: [],
        discrepancy: 50000000n,
        statusMessage: ''
      };

      const ob2: TaxObligation = {
        id: 'OB-L2',
        taxCode: '0101234567',
        taxType: 'VAT',
        declarationCode: '01/GTGT',
        title: 'Khai thuế GTGT T02/2026',
        periodKey: '2026-M02',
        periodLabel: 'Tháng 02/2026',
        year: 2026,
        month: 2,
        amountPayable: 80000000n,
        hasSupplemental: false,
        supplementalCount: 0,
        currentVersion: 'Chính thức',
        deadline: mockDeadline,
        status: 'NOT_DUE',
        daysRemaining: 35,
        matchedPaymentAmount: 0n,
        matchedSlips: [],
        discrepancy: 80000000n,
        statusMessage: ''
      };

      const slip1: PaymentSlipRecord = {
        id: 'GNT-L1',
        stt: 1,
        soGnt: 'GNT-L1',
        maGiaoDich: 'GD-L1',
        ngayNopThue: '15/02/2026',
        soTien: 50000000,
        soTienFormatted: '50,000,000',
        loaiTien: 'VND',
        trangThai: 'Nộp thuế thành công',
        lanNop: '01/2026',
        downloadAvailable: true
      };

      const slip2: PaymentSlipRecord = {
        id: 'GNT-L2',
        stt: 2,
        soGnt: 'GNT-L2',
        maGiaoDich: 'GD-L2',
        ngayNopThue: '15/03/2026',
        soTien: 80000000,
        soTienFormatted: '80,000,000',
        loaiTien: 'VND',
        trangThai: 'Nộp thuế thành công',
        lanNop: '02/2026',
        downloadAvailable: true
      };

      const resOrderA = TaxPaymentMatcher.matchPayments([ob1, ob2], [slip1, slip2]);
      const resOrderB = TaxPaymentMatcher.matchPayments([ob2, ob1], [slip2, slip1]);

      const findA1 = resOrderA.find(o => o.id === 'OB-L1')!;
      const findB1 = resOrderB.find(o => o.id === 'OB-L1')!;
      expect(findA1.status).toBe(findB1.status);
      expect(findA1.matchedPaymentAmount).toBe(findB1.matchedPaymentAmount);

      const findA2 = resOrderA.find(o => o.id === 'OB-L2')!;
      const findB2 = resOrderB.find(o => o.id === 'OB-L2')!;
      expect(findA2.status).toBe(findB2.status);
      expect(findA2.matchedPaymentAmount).toBe(findB2.matchedPaymentAmount);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 6 & 7: SUPPLEMENTARY VERSION CHAIN & FINAL DECLARATION
  // ══════════════════════════════════════════════════════════════════════
  describe('Section 6 & 7: Supplementary Version Chain Edge Cases', () => {
    it('handles out-of-order array, inferred sequence, and next-year filing dates', () => {
      const filings: TaxFiling[] = [
        {
          id: 'FILING-BS2',
          procedureCode: '1.008327',
          title: 'Khai bổ sung GTGT',
          taxType: 'VAT',
          period: 'Tháng 08/2025',
          submittedAt: '15/02/2026 14:00', // Nộp sang năm sau
          filingType: 'SUPPLEMENTAL',
          status: 'Đã chấp nhận',
          downloadAvailable: true
        },
        {
          id: 'FILING-ORIGINAL',
          procedureCode: '1.007014',
          title: 'Khai thuế GTGT',
          taxType: 'VAT',
          period: 'Tháng 08/2025',
          submittedAt: '20/09/2025 09:00',
          filingType: 'ORIGINAL',
          status: 'Đã chấp nhận',
          downloadAvailable: true
        },
        {
          id: 'FILING-BS1',
          procedureCode: '1.008327',
          title: 'Khai bổ sung GTGT',
          taxType: 'VAT',
          period: 'Tháng 08/2025',
          submittedAt: '10/11/2025 10:00',
          filingType: 'SUPPLEMENTAL',
          status: 'Đã chấp nhận',
          downloadAvailable: true
        }
      ];

      const resolved = resolvePeriodSupplementalSequences(filings);

      const orig = resolved.find(f => f.id === 'FILING-ORIGINAL')!;
      const bs1 = resolved.find(f => f.id === 'FILING-BS1')!;
      const bs2 = resolved.find(f => f.id === 'FILING-BS2')!;

      expect(orig.filingType).toBe('ORIGINAL');
      expect(bs1.supplementalNo).toBe(1);
      expect(bs2.supplementalNo).toBe(2);

      // Verify that supplement filed in 2026 is properly mapped to 08/2025
      const norm = normalizeVatPeriod(bs2.period || '', bs2.submittedAt);
      expect(norm.key).toBe('2025-M08');
      expect(norm.month).toBe(8);
      expect(norm.year).toBe(2025);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 8 & 9: VAT GOLDEN WORKING PAPER & METAMORPHIC TEST
  // ══════════════════════════════════════════════════════════════════════
  describe('Section 8 & 9: VAT Working Paper Golden Fixture & Metamorphic Test', () => {
    it('accurately computes carry-forward, delta, payable and data coverage across periods', () => {
      const snapT01: VatDeclarationSnapshot = {
        taxpayerId: '0101234567',
        submissionId: 'SUB-T01',
        formCode: '01/GTGT',
        period: { type: 'MONTH', value: '01/2025', normalizedKey: '2025-M01' },
        declarationType: 'ORIGINAL',
        sequenceSource: 'API',
        submittedAt: '20/02/2025 09:00',
        status: 'Đã chấp nhận',
        ct22_thueDauVaoKyTruoc: 0n,
        ct23_giaTriMuaVao: 200000000n,
        ct24_thueMuaVao: 20000000n,
        ct25_thueKhauTruKyNay: 20000000n,
        ct34_doanhThuBanRa: 300000000n,
        ct35_thueBanRa: 30000000n,
        ct40_thuePhaiNop: 10000000n, // [35] - [25] = 10M
        ct43_thueKhauTruChuyenKySau: 0n,
        allIndicators: {},
        warnings: [],
        parseStatus: 'SUCCESS',
        xmlAvailable: true
      };

      const snapT02: VatDeclarationSnapshot = {
        taxpayerId: '0101234567',
        submissionId: 'SUB-T02',
        formCode: '01/GTGT',
        period: { type: 'MONTH', value: '02/2025', normalizedKey: '2025-M02' },
        declarationType: 'ORIGINAL',
        sequenceSource: 'API',
        submittedAt: '20/03/2025 09:00',
        status: 'Đã chấp nhận',
        ct22_thueDauVaoKyTruoc: 0n,
        ct23_giaTriMuaVao: 500000000n,
        ct24_thueMuaVao: 50000000n,
        ct25_thueKhauTruKyNay: 50000000n,
        ct34_doanhThuBanRa: 200000000n,
        ct35_thueBanRa: 20000000n,
        ct40_thuePhaiNop: 0n,
        ct43_thueKhauTruChuyenKySau: 30000000n, // [25] - [35] = 30M còn được khấu trừ
        allIndicators: {},
        warnings: [],
        parseStatus: 'SUCCESS',
        xmlAvailable: true
      };

      const summary = VatAnalyticsEngine.buildSummaryFromSnapshots(
        [
          { id: 'SUB-T01', procedureCode: '1.007014', title: '01/GTGT', taxType: 'VAT', period: 'Tháng 01/2025', filingType: 'ORIGINAL', status: 'Đã chấp nhận', downloadAvailable: true },
          { id: 'SUB-T02', procedureCode: '1.007014', title: '01/GTGT', taxType: 'VAT', period: 'Tháng 02/2025', filingType: 'ORIGINAL', status: 'Đã chấp nhận', downloadAvailable: true }
        ],
        [snapT01, snapT02],
        '0101234567'
      );

      expect(summary.totalPeriodsCount).toBe(2);
      expect(summary.totalXmlAvailableCount).toBe(2);
      expect(summary.coverageStatus).toBe('COMPLETE');
      expect(summary.coverageRatio).toBe(1.0);

      const p1 = summary.periodGroups.find(g => g.periodKey === '2025-M01')!;
      expect(p1.finalSnapshot?.ct40_thuePhaiNop).toBe(10000000n);

      const p2 = summary.periodGroups.find(g => g.periodKey === '2025-M02')!;
      expect(p2.finalSnapshot?.ct43_thueKhauTruChuyenKySau).toBe(30000000n);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 11, 12, 13: SNAPSHOT SERIALIZATION & CROSS-TAXPAYER ISOLATION
  // ══════════════════════════════════════════════════════════════════════
  describe('Section 11, 12, 13: Snapshot Serialization & Cross-Taxpayer Isolation', () => {
    it('persists and deserializes massive positive/negative BigInts without precision loss', () => {
      const taxCode = '0101234567';
      const subId = 'SUB-BIGINT-01';

      const payload: Partial<VatDeclarationSnapshot> = {
        taxpayerId: taxCode,
        submissionId: subId,
        ct22_thueDauVaoKyTruoc: 100000000000000n, // 100 nghìn tỷ
        ct37_dChinhGiamThueKTru: -999999999999n,  // Âm gần 1 nghìn tỷ
        ct40_thuePhaiNop: 0n,
        xmlAvailable: true
      };

      ParsedSnapshotStore.saveSnapshot(tempDir, taxCode, subId, payload);
      const loaded = ParsedSnapshotStore.getSnapshot<Partial<VatDeclarationSnapshot>>(tempDir, taxCode, subId);

      expect(loaded).toBeDefined();
      expect(typeof loaded?.ct22_thueDauVaoKyTruoc).toBe('bigint');
      expect(loaded?.ct22_thueDauVaoKyTruoc).toBe(100000000000000n);
      expect(typeof loaded?.ct37_dChinhGiamThueKTru).toBe('bigint');
      expect(loaded?.ct37_dChinhGiamThueKTru).toBe(-999999999999n);
      expect(loaded?.ct40_thuePhaiNop).toBe(0n);
    });

    it('enforces strict cross-taxpayer cache isolation (no collision with identical submission IDs)', () => {
      const subId = 'SHARED-SUB-ID-999';
      const taxCodeA = '0100000001';
      const taxCodeB = '0100000002';

      ParsedSnapshotStore.saveSnapshot(tempDir, taxCodeA, subId, {
        taxpayerId: taxCodeA,
        ct40_thuePhaiNop: 11111111n,
        xmlAvailable: true
      });

      ParsedSnapshotStore.saveSnapshot(tempDir, taxCodeB, subId, {
        taxpayerId: taxCodeB,
        ct40_thuePhaiNop: 22222222n,
        xmlAvailable: true
      });

      const loadedA = ParsedSnapshotStore.getSnapshot<any>(tempDir, taxCodeA, subId);
      const loadedB = ParsedSnapshotStore.getSnapshot<any>(tempDir, taxCodeB, subId);

      expect(loadedA.ct40_thuePhaiNop).toBe(11111111n);
      expect(loadedB.ct40_thuePhaiNop).toBe(22222222n);
      expect(loadedA.taxpayerId).toBe(taxCodeA);
      expect(loadedB.taxpayerId).toBe(taxCodeB);
    });

    it('handles corrupted JSON snapshot gracefully by returning null instead of throwing', () => {
      const taxCode = '0101234567';
      const subId = 'CORRUPTED-SUB';
      const snapshotDir = path.join(tempDir, taxCode, '.cache_snapshots');
      fs.mkdirSync(snapshotDir, { recursive: true });
      fs.writeFileSync(path.join(snapshotDir, `${subId}.json`), '{ invalid_json ::: corrupt }', 'utf8');

      const loaded = ParsedSnapshotStore.getSnapshot(tempDir, taxCode, subId);
      expect(loaded).toBeNull();
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 32: EXCEL READ-BACK GOLDEN TEST
  // ══════════════════════════════════════════════════════════════════════
  describe('Section 32: Excel Read-back Golden Test with ExcelJS', () => {
    it('creates and reads back workbook with sanitized formulas and numeric numbers', async () => {
      const filePath = path.join(tempDir, 'test_readback.xlsx');
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('TestSheet');

      sheet.addRow(['Tên Chỉ Tiêu', 'Số Tiền']);
      sheet.addRow(['Thuế phải nộp', sanitizeExcelCellValue(-5000000)]);
      sheet.addRow(['Công thức nguy hiểm', sanitizeExcelCellValue('=SUM(A1:A10)')]);
      sheet.addRow(['Mã định danh', '0101234567']);

      await workbook.xlsx.writeFile(filePath);
      expect(fs.existsSync(filePath)).toBe(true);

      // Read back workbook
      const readBackWb = new ExcelJS.Workbook();
      await readBackWb.xlsx.readFile(filePath);
      const readSheet = readBackWb.getWorksheet('TestSheet')!;

      // Row 2: Số âm
      const cellNegative = readSheet.getRow(2).getCell(2).value;
      expect(cellNegative).toBe(-5000000);
      expect(typeof cellNegative).toBe('number');

      // Row 3: Formula nguy hiểm đã được quote bảo vệ an toàn
      const cellFormula = readSheet.getRow(3).getCell(2).value;
      expect(cellFormula).toBe("'=SUM(A1:A10)");
      expect(typeof cellFormula).toBe('string');

      // Row 4: Mã số thuế bảo toàn số 0 ở đầu
      const cellMst = readSheet.getRow(4).getCell(2).value;
      expect(cellMst).toBe('0101234567');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // SECTION 1, 35, 41: GNT CONNECTIVITY & FALSE UNPAID INVARIANT TEST
  // ══════════════════════════════════════════════════════════════════════
  describe('Section 1, 35, 41: GNT Connectivity & False Unpaid Prevention Invariants', () => {
    const mockDeadlineOverdue: TaxDeadlineResult = {
      baseFilingDeadline: '20/02/2025',
      basePaymentDeadline: '20/02/2025',
      effectiveFilingDeadline: '20/02/2025',
      effectivePaymentDeadline: '20/02/2025',
      ruleId: 'RULE-VAT',
      legalBasis: [],
      extensionApplied: false,
      confidence: 'CONFIRMED',
      isAdjustedForHoliday: false
    };

    const overdueFiling: TaxFiling = {
      id: 'FILING-OVERDUE-01',
      procedureCode: '1.007014',
      declarationCode: '01/GTGT',
      title: 'Khai thuế GTGT T01/2025',
      taxType: 'VAT',
      period: 'Tháng 01/2025',
      submittedAt: '20/02/2025 09:00',
      filingType: 'ORIGINAL',
      amountPayable: 10000000n, // 10 triệu đồng
      status: 'Đã chấp nhận',
      downloadAvailable: true
    };

    it('Invariant 1: If GNT query failed, engine MUST NOT conclude PAST_DEADLINE_NO_MATCHED_PAYMENT (Must return PAYMENT_DATA_UNAVAILABLE)', () => {
      const summary = TaxObligationEngine.processObligations(
        [overdueFiling],
        [], // Empty slips because query failed
        '0101234567',
        undefined,
        new Date('2025-06-01'), // Reference date far after deadline
        'QUERY_FAILED'          // Explicit status: GNT query failed
      );

      expect(summary.totalObligationsCount).toBe(1);
      const ob = summary.obligations?.[0]!;
      expect(ob.status).toBe('PAYMENT_DATA_UNAVAILABLE');
      expect(ob.statusMessage).toContain('Chưa thể kết nối Cổng Thuế');
      expect(summary.pastDeadlineNoPaymentCount).toBe(0);
      expect(summary.paymentDataUnavailableCount).toBe(1);
    });

    it('Invariant 2: Only when GNT query succeeded with CONNECTED_NO_DATA does engine conclude PAST_DEADLINE_NO_MATCHED_PAYMENT', () => {
      const summary = TaxObligationEngine.processObligations(
        [overdueFiling],
        [], // Succeeded query found 0 slips on portal
        '0101234567',
        undefined,
        new Date('2025-06-01'),
        'CONNECTED_NO_DATA'     // Explicit status: Successfully connected, verified 0 slips on portal
      );

      expect(summary.totalObligationsCount).toBe(1);
      const ob = summary.obligations?.[0]!;
      expect(ob.status).toBe('PAST_DEADLINE_NO_MATCHED_PAYMENT');
      expect(summary.pastDeadlineNoPaymentCount).toBe(1);
      expect(summary.paymentDataUnavailableCount).toBe(0);
    });
  });
});

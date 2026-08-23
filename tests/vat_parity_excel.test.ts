import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ExcelVatReferenceExporter } from '../src/main/exporter/ExcelVatReferenceExporter';
import { VatAnalyticsSummary, VatDeclarationSnapshot, VatPeriodGroup } from '../src/shared/vatAnalyticsTypes';
import { VatFlowEngine } from '../src/shared/vatFlowEngine';

describe('VAT Golden Dataset & Automated Parity Test (UI ↔ Excel Readback)', () => {
  it('should guarantee 100% parity across UI Normalized Model and Excel Readback cells', async () => {
    // ── 1. KHỞI TẠO GOLDEN DATASET TOÀN DIỆN ───────────────────────────
    const mockSnapshots: VatDeclarationSnapshot[] = [
      // T1/2026: Chính thức
      {
        taxpayerId: '0102030405',
        formCode: '01/GTGT',
        period: {
          type: 'MONTH',
          value: '01/2026',
          normalizedKey: '2026-M01'
        },
        declarationType: 'ORIGINAL',
        sequenceSource: 'API',
        submissionId: 'SUB_2026_01_ORIG',
        submittedAt: '20/02/2026 09:00',
        status: 'Đã chấp nhận',
        ct22_thueDauVaoKyTruoc: 100000000n,
        ct23_giaTriMuaVao: 500000000n,
        ct24_thueMuaVao: 50000000n,
        ct25_thueKhauTruKyNay: 50000000n,
        ct34_doanhThuBanRa: 800000000n,
        ct35_thueBanRa: 80000000n,
        ct37_dChinhGiamThueKTru: 0n,
        ct38_dChinhTangThueKTru: 0n,
        ct40_thuePhaiNop: 0n,
        ct42_thueDeNghiHoanKyNay: 0n,
        ct43_thueKhauTruChuyenKySau: 70000000n,
        xmlAvailable: true,
        parseStatus: 'SUCCESS',
        allIndicators: {},
        warnings: []
      },
      // T2/2026: Chính thức + BS lần 1 (Tăng khấu trừ)
      {
        taxpayerId: '0102030405',
        formCode: '01/GTGT',
        period: {
          type: 'MONTH',
          value: '02/2026',
          normalizedKey: '2026-M02'
        },
        declarationType: 'ORIGINAL',
        sequenceSource: 'API',
        submissionId: 'SUB_2026_02_ORIG',
        submittedAt: '20/03/2026 10:00',
        status: 'Đã chấp nhận',
        ct22_thueDauVaoKyTruoc: 70000000n,
        ct23_giaTriMuaVao: 600000000n,
        ct24_thueMuaVao: 60000000n,
        ct25_thueKhauTruKyNay: 60000000n,
        ct34_doanhThuBanRa: 500000000n,
        ct35_thueBanRa: 50000000n,
        ct37_dChinhGiamThueKTru: 0n,
        ct38_dChinhTangThueKTru: 0n,
        ct40_thuePhaiNop: 0n,
        ct42_thueDeNghiHoanKyNay: 0n,
        ct43_thueKhauTruChuyenKySau: 80000000n,
        xmlAvailable: true,
        parseStatus: 'SUCCESS',
        allIndicators: {},
        warnings: []
      },
      {
        taxpayerId: '0102030405',
        formCode: '01/GTGT',
        period: {
          type: 'MONTH',
          value: '02/2026',
          normalizedKey: '2026-M02'
        },
        declarationType: 'SUPPLEMENTAL',
        supplementalNo: 1,
        sequenceSource: 'API',
        submissionId: 'SUB_2026_02_BS1',
        submittedAt: '15/04/2026 14:00',
        status: 'Đã chấp nhận',
        ct22_thueDauVaoKyTruoc: 70000000n,
        ct23_giaTriMuaVao: 750000000n,
        ct24_thueMuaVao: 75000000n,
        ct25_thueKhauTruKyNay: 75000000n,
        ct34_doanhThuBanRa: 500000000n,
        ct35_thueBanRa: 50000000n,
        ct37_dChinhGiamThueKTru: 0n,
        ct38_dChinhTangThueKTru: 0n,
        ct40_thuePhaiNop: 0n,
        ct42_thueDeNghiHoanKyNay: 0n,
        ct43_thueKhauTruChuyenKySau: 95000000n, // [43] tăng 15tr
        xmlAvailable: true,
        parseStatus: 'SUCCESS',
        allIndicators: {},
        warnings: []
      },
      // T3/2026: BS lần 2 phát sinh thuế phải nộp [40]=20tr
      {
        taxpayerId: '0102030405',
        formCode: '01/GTGT',
        period: {
          type: 'MONTH',
          value: '03/2026',
          normalizedKey: '2026-M03'
        },
        declarationType: 'ORIGINAL',
        sequenceSource: 'API',
        submissionId: 'SUB_2026_03_ORIG',
        submittedAt: '20/04/2026 11:00',
        status: 'Đã chấp nhận',
        ct22_thueDauVaoKyTruoc: 95000000n,
        ct23_giaTriMuaVao: 400000000n,
        ct24_thueMuaVao: 40000000n,
        ct25_thueKhauTruKyNay: 40000000n,
        ct34_doanhThuBanRa: 1350000000n,
        ct35_thueBanRa: 135000000n,
        ct37_dChinhGiamThueKTru: 0n,
        ct38_dChinhTangThueKTru: 0n,
        ct40_thuePhaiNop: 0n,
        ct42_thueDeNghiHoanKyNay: 0n,
        ct43_thueKhauTruChuyenKySau: 0n,
        xmlAvailable: true,
        parseStatus: 'SUCCESS',
        allIndicators: {},
        warnings: []
      },
      {
        taxpayerId: '0102030405',
        formCode: '01/GTGT',
        period: {
          type: 'MONTH',
          value: '03/2026',
          normalizedKey: '2026-M03'
        },
        declarationType: 'SUPPLEMENTAL',
        supplementalNo: 2,
        sequenceSource: 'API',
        submissionId: 'SUB_2026_03_BS2',
        submittedAt: '10/05/2026 16:00',
        status: 'Đã chấp nhận',
        ct22_thueDauVaoKyTruoc: 95000000n,
        ct23_giaTriMuaVao: 400000000n,
        ct24_thueMuaVao: 40000000n,
        ct25_thueKhauTruKyNay: 40000000n,
        ct34_doanhThuBanRa: 1550000000n,
        ct35_thueBanRa: 155000000n,
        ct37_dChinhGiamThueKTru: 0n,
        ct38_dChinhTangThueKTru: 0n,
        ct40_thuePhaiNop: 20000000n,
        ct42_thueDeNghiHoanKyNay: 0n,
        ct43_thueKhauTruChuyenKySau: 0n,
        xmlAvailable: true,
        parseStatus: 'SUCCESS',
        allIndicators: {},
        warnings: []
      },
      // Kỳ cũ 09/2025 nộp bổ sung vào 05/2026 làm giảm [43] cũ 30tr
      {
        taxpayerId: '0102030405',
        formCode: '01/GTGT',
        period: {
          type: 'MONTH',
          value: '09/2025',
          normalizedKey: '2025-M09'
        },
        declarationType: 'ORIGINAL',
        sequenceSource: 'API',
        submissionId: 'SUB_2025_09_ORIG',
        submittedAt: '20/10/2025 09:00',
        status: 'Đã chấp nhận',
        ct22_thueDauVaoKyTruoc: 50000000n,
        ct23_giaTriMuaVao: 500000000n,
        ct24_thueMuaVao: 50000000n,
        ct25_thueKhauTruKyNay: 50000000n,
        ct34_doanhThuBanRa: 200000000n,
        ct35_thueBanRa: 20000000n,
        ct37_dChinhGiamThueKTru: 0n,
        ct38_dChinhTangThueKTru: 0n,
        ct40_thuePhaiNop: 0n,
        ct42_thueDeNghiHoanKyNay: 0n,
        ct43_thueKhauTruChuyenKySau: 80000000n,
        xmlAvailable: true,
        parseStatus: 'SUCCESS',
        allIndicators: {},
        warnings: []
      },
      {
        taxpayerId: '0102030405',
        formCode: '01/GTGT',
        period: {
          type: 'MONTH',
          value: '09/2025',
          normalizedKey: '2025-M09'
        },
        declarationType: 'SUPPLEMENTAL',
        supplementalNo: 1,
        sequenceSource: 'API',
        submissionId: 'SUB_2025_09_BS1',
        submittedAt: '05/05/2026 15:30', // Nộp vào Tháng 05/2026!
        status: 'Đã chấp nhận',
        ct22_thueDauVaoKyTruoc: 50000000n,
        ct23_giaTriMuaVao: 200000000n,
        ct24_thueMuaVao: 20000000n,
        ct25_thueKhauTruKyNay: 20000000n,
        ct34_doanhThuBanRa: 200000000n,
        ct35_thueBanRa: 20000000n,
        ct37_dChinhGiamThueKTru: 0n,
        ct38_dChinhTangThueKTru: 0n,
        ct40_thuePhaiNop: 0n,
        ct42_thueDeNghiHoanKyNay: 0n,
        ct43_thueKhauTruChuyenKySau: 50000000n,
        xmlAvailable: true,
        parseStatus: 'SUCCESS',
        allIndicators: {},
        warnings: []
      }
    ];

    // Gom nhóm kỳ
    const periodGroups: VatPeriodGroup[] = [
      {
        periodKey: '2026-M01',
        periodLabel: 'Tháng 01/2026',
        year: 2026,
        month: 1,
        periodType: 'MONTH',
        filings: [],
        snapshots: [mockSnapshots[0]],
        finalSnapshot: mockSnapshots[0],
        hasSupplemental: false,
        supplementalCount: 0,
        hasValueDelta: false,
        deltas: [],
        warnings: []
      },
      {
        periodKey: '2026-M02',
        periodLabel: 'Tháng 02/2026',
        year: 2026,
        month: 2,
        periodType: 'MONTH',
        filings: [],
        snapshots: [mockSnapshots[1], mockSnapshots[2]],
        finalSnapshot: mockSnapshots[2],
        hasSupplemental: true,
        supplementalCount: 1,
        hasValueDelta: true,
        deltas: [],
        warnings: []
      },
      {
        periodKey: '2026-M03',
        periodLabel: 'Tháng 03/2026',
        year: 2026,
        month: 3,
        periodType: 'MONTH',
        filings: [],
        snapshots: [mockSnapshots[3], mockSnapshots[4]],
        finalSnapshot: mockSnapshots[4],
        hasSupplemental: true,
        supplementalCount: 2,
        hasValueDelta: true,
        deltas: [],
        warnings: []
      },
      {
        periodKey: '2025-M09',
        periodLabel: 'Tháng 09/2025',
        year: 2025,
        month: 9,
        periodType: 'MONTH',
        filings: [],
        snapshots: [mockSnapshots[5], mockSnapshots[6]],
        finalSnapshot: mockSnapshots[6],
        hasSupplemental: true,
        supplementalCount: 1,
        hasValueDelta: true,
        deltas: [],
        warnings: []
      }
    ];

    const summary: VatAnalyticsSummary = {
      taxpayerId: '0102030405',
      analyzedAt: new Date().toISOString(),
      totalFilingsCount: 7,
      totalPeriodsCount: 4,
      periodsWithSupplementalCount: 3,
      periodsWithWarningCount: 0,
      periodGroups
    };

    // ── 2. NORMALIZE NĂM 2026 QUA VAT FLOW ENGINE (UI PROJECTION) ──────
    const uiFlow = VatFlowEngine.normalizeYearFlow(summary, 2026, 'COMPLETE');
    expect(uiFlow.flows.length).toBe(12);

    // Kiểm tra UI Model
    const t1 = uiFlow.flows[0];
    expect(t1.openingCt22).toBe(100000000n);
    expect(t1.carryForwardCt43).toBe(70000000n);

    const t2 = uiFlow.flows[1];
    expect(t2.versionLabel).toBe('BS lần 1');
    expect(t2.carryForwardCt43).toBe(95000000n);

    const t3 = uiFlow.flows[2];
    expect(t3.versionLabel).toBe('BS lần 2');
    expect(t3.taxPayableCt40).toBe(20000000n);

    // Kiểm tra Cross-Period Adjustment được bắt
    const crossAdjs = VatFlowEngine.extractCrossPeriodAdjustments(periodGroups);
    const cross2025To2026 = crossAdjs.find(a => a.sourcePeriod.periodKey === '2025-M09');
    expect(cross2025To2026).toBeDefined();
    expect(cross2025To2026?.delta).toBe(30000000n);
    expect(cross2025To2026?.targetIndicator).toBe('[37]');
    expect(cross2025To2026?.impactPeriod?.periodKey).toBe('2026-M05');

    // ── 3. XUẤT FILE EXCEL THẬT RA ĐĨA ──────────────────────────────────
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taxrecord-test-'));
    const exportedExcelPath = await ExcelVatReferenceExporter.exportVatReferenceToExcel(
      summary,
      tempDir,
      '0102030405',
      2026
    );

    expect(fs.existsSync(exportedExcelPath)).toBe(true);

    // ── 4. ĐỌC NGƯỢC FILE EXCEL BẰNG EXCELJS (READBACK PARITY VERIFICATION) ─
    const readWorkbook = new ExcelJS.Workbook();
    await readWorkbook.xlsx.readFile(exportedExcelPath);

    // Verify Sheet 1: 01_WORKING_PAPER_GTGT
    const sheet1 = readWorkbook.getWorksheet('01_WORKING_PAPER_GTGT');
    expect(sheet1).toBeDefined();

    // Row 2: Tháng 01/2026
    const rowT1 = sheet1!.getRow(2);
    expect(rowT1.getCell(1).value).toBe('Tháng 01/2026');
    expect(rowT1.getCell(2).value).toBe('Chính thức');
    expect(rowT1.getCell(3).value).toBe(100000000); // CT22
    expect(rowT1.getCell(4).value).toBe(50000000);  // CT25
    expect(rowT1.getCell(5).value).toBe(80000000);  // CT35
    expect(rowT1.getCell(10).value).toBe(70000000); // CT43

    // Row 3: Tháng 02/2026
    const rowT2 = sheet1!.getRow(3);
    expect(rowT2.getCell(1).value).toBe('Tháng 02/2026');
    expect(rowT2.getCell(2).value).toBe('BS lần 1');
    expect(rowT2.getCell(4).value).toBe(75000000);  // CT25 đã cập nhật theo BS1
    expect(rowT2.getCell(10).value).toBe(95000000); // CT43

    // Row 4: Tháng 03/2026
    const rowT3 = sheet1!.getRow(4);
    expect(rowT3.getCell(1).value).toBe('Tháng 03/2026');
    expect(rowT3.getCell(2).value).toBe('BS lần 2');
    expect(rowT3.getCell(8).value).toBe(20000000);  // CT40 Phải nộp

    // Verify Sheet 3: 03_DIEU_CHINH_XUYEN_KY
    const sheet3 = readWorkbook.getWorksheet('03_DIEU_CHINH_XUYEN_KY');
    expect(sheet3).toBeDefined();
    
    // Row 2: Adjustment của Tháng 02/2026 (Tăng khấu trừ [38] 15tr)
    const adjRow1 = sheet3!.getRow(2);
    expect(adjRow1.getCell(2).value).toBe('Tháng 02/2026');
    expect(adjRow1.getCell(5).value).toBe('Tháng 04/2026');
    expect(adjRow1.getCell(7).value).toBe('[38]');
    expect(adjRow1.getCell(8).value).toBe(15000000);

    // Row 3: Adjustment của Tháng 03/2026 (Tăng thuế phải nộp [40] 20tr)
    const adjRow2 = sheet3!.getRow(3);
    expect(adjRow2.getCell(2).value).toBe('Tháng 03/2026');
    expect(adjRow2.getCell(7).value).toBe('[40]');
    expect(adjRow2.getCell(8).value).toBe(20000000);

    // Row 4: Adjustment của Tháng 09/2025 (Giảm khấu trừ [37] 30tr tác động 05/2026)
    const adjRow3 = sheet3!.getRow(4);
    expect(adjRow3.getCell(2).value).toBe('Tháng 09/2025');
    expect(adjRow3.getCell(5).value).toBe('Tháng 05/2026');
    expect(adjRow3.getCell(7).value).toBe('[37]');
    expect(adjRow3.getCell(8).value).toBe(30000000);

    // Dọn dẹp temp
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

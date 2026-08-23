import ExcelJS from 'exceljs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { ExcelVatReferenceExporter } from '../src/main/exporter/ExcelVatReferenceExporter';
import { VatAnalyticsSummary } from '../src/shared/vatAnalyticsTypes';

describe('Excel VAT Reference Export Tests', () => {
  it('1. Xuất file Excel 3 Sheet chuẩn kiểm toán và kiểm tra cấu trúc', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taxrecord_vat_test_'));

    const mockSummary: VatAnalyticsSummary = {
      taxpayerId: '3702735709',
      totalFilingsCount: 3,
      totalPeriodsCount: 1,
      periodsWithSupplementalCount: 1,
      periodsWithWarningCount: 0,
      analyzedAt: new Date().toISOString(),
      periodGroups: [
        {
          periodKey: '2026-M01',
          periodLabel: '01/2026',
          periodType: 'MONTH',
          year: 2026,
          month: 1,
          filings: [],
          snapshots: [
            {
              submissionId: 'F1',
              taxpayerId: '3702735709',
              period: { value: '01/2026', normalizedKey: '2026-M01', type: 'MONTH' },
              formCode: '01/GTGT',
              declarationType: 'ORIGINAL',
              sequenceSource: 'API',
              status: 'Đã chấp nhận',
              parseStatus: 'SUCCESS',
              submittedAt: '15/02/2026',
              xmlAvailable: true,
              ct22_thueDauVaoKyTruoc: 0n,
              ct23_giaTriMuaVao: 1000000000n,
              ct24_thueMuaVao: 100000000n,
              ct25_thueKhauTruKyNay: 100000000n,
              ct34_doanhThuBanRa: 1500000000n,
              ct35_thueBanRa: 150000000n,
              ct40_thuePhaiNop: 50000000n,
              ct43_thueKhauTruChuyenKySau: 0n,
              allIndicators: {
                '25': { code: '25', name: 'Thuế được khấu trừ', rawValue: '100000000', numericValue: 100000000n, source: 'XML' }
              },
              warnings: []
            },
            {
              submissionId: 'F2',
              taxpayerId: '3702735709',
              period: { value: '01/2026', normalizedKey: '2026-M01', type: 'MONTH' },
              formCode: '01/GTGT',
              declarationType: 'SUPPLEMENTAL',
              supplementalNo: 1,
              sequenceSource: 'API',
              status: 'Đã chấp nhận',
              parseStatus: 'SUCCESS',
              submittedAt: '19/03/2026',
              xmlAvailable: true,
              ct22_thueDauVaoKyTruoc: 0n,
              ct23_giaTriMuaVao: 1100000000n,
              ct24_thueMuaVao: 110000000n,
              ct25_thueKhauTruKyNay: 110000000n,
              ct34_doanhThuBanRa: 1500000000n,
              ct35_thueBanRa: 150000000n,
              ct40_thuePhaiNop: 40000000n,
              ct43_thueKhauTruChuyenKySau: 0n,
              allIndicators: {
                '25': { code: '25', name: 'Thuế được khấu trừ', rawValue: '110000000', numericValue: 110000000n, source: 'XML' }
              },
              warnings: []
            }
          ],
          finalSnapshot: {
            submissionId: 'F2',
            taxpayerId: '3702735709',
            period: { value: '01/2026', normalizedKey: '2026-M01', type: 'MONTH' },
            formCode: '01/GTGT',
            declarationType: 'SUPPLEMENTAL',
            supplementalNo: 1,
            sequenceSource: 'API',
            status: 'Đã chấp nhận',
            parseStatus: 'SUCCESS',
            submittedAt: '19/03/2026',
            xmlAvailable: true,
            ct22_thueDauVaoKyTruoc: 0n,
            ct23_giaTriMuaVao: 1100000000n,
            ct24_thueMuaVao: 110000000n,
            ct25_thueKhauTruKyNay: 110000000n,
            ct34_doanhThuBanRa: 1500000000n,
            ct35_thueBanRa: 150000000n,
            ct40_thuePhaiNop: 40000000n,
            ct43_thueKhauTruChuyenKySau: 0n,
            allIndicators: {},
            warnings: []
          },
          hasSupplemental: true,
          supplementalCount: 1,
          hasValueDelta: true,
          deltas: [],
          warnings: []
        }
      ]
    };

    const outPath = await ExcelVatReferenceExporter.exportVatReferenceToExcel(
      mockSummary,
      tempDir,
      '3702735709',
      2026
    );

    expect(fs.existsSync(outPath)).toBe(true);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(outPath);

    expect(wb.worksheets.length).toBe(3);
    expect(wb.worksheets[0].name).toBe('01_WORKING_PAPER_GTGT');
    expect(wb.worksheets[1].name).toBe('02_LICH_SU_BO_SUNG');
    expect(wb.worksheets[2].name).toBe('03_DIEU_CHINH_XUYEN_KY');

    // Kiểm tra ô tiền trong sheet 1 là kiểu số (number)
    const sheet1 = wb.getWorksheet('01_WORKING_PAPER_GTGT')!;
    const ct40Cell = sheet1.getRow(2).getCell(8); // Column 8: ct40 Thuế Phải Nộp
    expect(typeof ct40Cell.value).toBe('number');
    expect(ct40Cell.value).toBe(40000000);
    expect(ct40Cell.numFmt).toBe('#,##0');

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});

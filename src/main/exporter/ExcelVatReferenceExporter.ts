import ExcelJS from 'exceljs';
import path from 'path';
import { bigIntToExcelNumber } from '../../shared/moneyUtils';
import { sanitizeExcelCellValue, sanitizeFilename } from '../../shared/sanitizer';
import { VatAnalyticsSummary } from '../../shared/vatAnalyticsTypes';
import { VatFlowEngine } from '../../shared/vatFlowEngine';

export class ExcelVatReferenceExporter {
  /**
   * Xuất Bảng Tham Chiếu Kê Khai GTGT Chuẩn Kiểm Toán (Single Source of Truth từ VatFlowEngine)
   */
  public static async exportVatReferenceToExcel(
    summary: VatAnalyticsSummary,
    targetDir: string,
    taxCode: string,
    year: number
  ): Promise<string> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'TaxRecord Auditor';
    workbook.created = new Date();

    const currencyNumFmt = '#,##0';
    const headerFill: ExcelJS.Fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F766E' } // Teal-700
    };
    const headerFont: Partial<ExcelJS.Font> = {
      bold: true,
      color: { argb: 'FFFFFFFF' },
      size: 11
    };

    // Chuẩn hóa dòng chảy thuế GTGT năm mục tiêu (Dùng chung engine với UI)
    const yearFlow = VatFlowEngine.normalizeYearFlow(summary, year, 'COMPLETE');

    // ═════════════════════════════════════════════════════════════════════
    // SHEET 1: 01_WORKING_PAPER_GTGT (Bảng Kiểm Toán Điện Tử)
    // ═════════════════════════════════════════════════════════════════════
    const sheet1 = workbook.addWorksheet('01_WORKING_PAPER_GTGT', {
      views: [{ state: 'frozen', ySplit: 1, showGridLines: true }]
    });

    sheet1.columns = [
      { header: 'Kỳ kiểm toán', key: 'periodLabel', width: 18 },
      { header: 'Phiên bản', key: 'versionLabel', width: 16 },
      { header: 'VAT đầu kỳ [22]', key: 'ct22', width: 20 },
      { header: 'VAT đầu vào [25]', key: 'ct25', width: 20 },
      { header: 'VAT đầu ra [35]', key: 'ct35', width: 20 },
      { header: 'Đ/c Giảm [37]', key: 'ct37', width: 18 },
      { header: 'Đ/c Tăng [38]', key: 'ct38', width: 18 },
      { header: 'Phải nộp [40]', key: 'ct40', width: 20 },
      { header: 'Đề nghị hoàn [42]', key: 'ct42', width: 20 },
      { header: 'Chuyển kỳ sau [43]', key: 'ct43', width: 22 },
      { header: 'Kiểm tra dòng luân chuyển', key: 'flowCheck', width: 28 },
      { header: 'Mã hồ sơ điện tử', key: 'submissionId', width: 24 }
    ];

    const hRow1 = sheet1.getRow(1);
    hRow1.font = headerFont;
    hRow1.fill = headerFill;
    hRow1.alignment = { vertical: 'middle', horizontal: 'center' };
    hRow1.height = 28;

    yearFlow.flows.forEach(f => {
      const snap = f.effectiveSnapshot;
      const flowCheckStr = f.flowCheck.status === 'CONFIRMED'
        ? '✓ Khớp đúng'
        : f.flowCheck.status === 'NEEDS_REVIEW'
        ? `⚠ Lệch [22] vs [43] (${f.flowCheck.note})`
        : '—';

      const row = sheet1.addRow({
        periodLabel: sanitizeExcelCellValue(f.periodLabel),
        versionLabel: sanitizeExcelCellValue(f.versionLabel),
        ct22: snap ? bigIntToExcelNumber(f.openingCt22) : '—',
        ct25: snap ? bigIntToExcelNumber(f.inputVatCt25) : '—',
        ct35: snap ? bigIntToExcelNumber(f.outputVatCt35) : '—',
        ct37: snap ? bigIntToExcelNumber(f.adjustDecreaseCt37) : '—',
        ct38: snap ? bigIntToExcelNumber(f.adjustIncreaseCt38) : '—',
        ct40: snap ? bigIntToExcelNumber(f.taxPayableCt40) : '—',
        ct42: snap ? bigIntToExcelNumber(f.refundCt42) : '—',
        ct43: snap ? bigIntToExcelNumber(f.carryForwardCt43) : '—',
        flowCheck: sanitizeExcelCellValue(flowCheckStr),
        submissionId: sanitizeExcelCellValue(f.evidence?.submissionId || '—')
      });

      row.height = 22;
      row.alignment = { vertical: 'middle' };

      if (snap) {
        ['ct22', 'ct25', 'ct35', 'ct37', 'ct38', 'ct40', 'ct42', 'ct43'].forEach(k => {
          const cell = row.getCell(k);
          cell.numFmt = currencyNumFmt;
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
        });
      }
    });

    // Dòng Tổng Cộng Phát Sinh Cả Năm
    const totalRow = sheet1.addRow({
      periodLabel: `TỔNG PHÁT SINH ${year}`,
      versionLabel: `${yearFlow.periodsWithFiling}/${yearFlow.totalPeriodsInYear} kỳ có hồ sơ`,
      ct22: bigIntToExcelNumber(yearFlow.openingYearBalance),
      ct25: bigIntToExcelNumber(yearFlow.totalInputVat25),
      ct35: bigIntToExcelNumber(yearFlow.totalOutputVat35),
      ct37: bigIntToExcelNumber(yearFlow.totalAdjustDecrease37),
      ct38: bigIntToExcelNumber(yearFlow.totalAdjustIncrease38),
      ct40: bigIntToExcelNumber(yearFlow.totalTaxPayable40),
      ct42: bigIntToExcelNumber(yearFlow.totalRefund42),
      ct43: bigIntToExcelNumber(yearFlow.closingYearBalance),
      flowCheck: 'Số dư cuối năm',
      submissionId: '—'
    });
    totalRow.font = { bold: true, size: 11 };
    totalRow.height = 26;
    ['ct22', 'ct25', 'ct35', 'ct37', 'ct38', 'ct40', 'ct42', 'ct43'].forEach(k => {
      const cell = totalRow.getCell(k);
      cell.numFmt = currencyNumFmt;
      cell.alignment = { vertical: 'middle', horizontal: 'right' };
    });

    sheet1.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet1.columns.length }
    };

    // ═════════════════════════════════════════════════════════════════════
    // SHEET 2: 02_LICH_SU_BO_SUNG (Chuỗi Phiên Bản & Delta Biến Động)
    // ═════════════════════════════════════════════════════════════════════
    const sheet2 = workbook.addWorksheet('02_LICH_SU_BO_SUNG', {
      views: [{ state: 'frozen', ySplit: 1, showGridLines: true }]
    });

    sheet2.columns = [
      { header: 'STT', key: 'stt', width: 7 },
      { header: 'Kỳ kê khai', key: 'periodLabel', width: 16 },
      { header: 'Mẫu biểu', key: 'formCode', width: 12 },
      { header: 'Loại kê khai', key: 'declarationType', width: 15 },
      { header: 'Lần bổ sung', key: 'supplementalNo', width: 14 },
      { header: 'Ngày nộp', key: 'submittedAt', width: 18 },
      { header: 'Mã hồ sơ', key: 'submissionId', width: 22 },
      { header: 'VAT đầu ra (CT35)', key: 'ct35', width: 20 },
      { header: 'VAT mua vào (CT24)', key: 'ct24', width: 20 },
      { header: 'VAT được KT (CT25)', key: 'ct25', width: 20 },
      { header: 'VAT phải nộp (CT40)', key: 'ct40', width: 20 },
      { header: 'VAT chuyển kỳ sau (CT43)', key: 'ct43', width: 22 },
      { header: 'Δ VAT đầu ra', key: 'dCt35', width: 18 },
      { header: 'Δ VAT được KT', key: 'dCt25', width: 18 },
      { header: 'Δ VAT phải nộp', key: 'dCt40', width: 18 },
      { header: 'Δ VAT chuyển kỳ sau', key: 'dCt43', width: 20 },
      { header: 'Nguồn dữ liệu', key: 'source', width: 14 }
    ];

    const hRow2 = sheet2.getRow(1);
    hRow2.font = headerFont;
    hRow2.fill = headerFill;
    hRow2.alignment = { vertical: 'middle', horizontal: 'center' };
    hRow2.height = 28;

    let s2Index = 1;
    summary.periodGroups.forEach(g => {
      g.snapshots.forEach((snap, snapIdx) => {
        let dCt35 = 0;
        let dCt25 = 0;
        let dCt40 = 0;
        let dCt43 = 0;

        if (snapIdx > 0) {
          const prev = g.snapshots[snapIdx - 1];
          dCt35 = bigIntToExcelNumber(snap.ct35_thueBanRa - prev.ct35_thueBanRa);
          dCt25 = bigIntToExcelNumber(snap.ct25_thueKhauTruKyNay - prev.ct25_thueKhauTruKyNay);
          dCt40 = bigIntToExcelNumber(snap.ct40_thuePhaiNop - prev.ct40_thuePhaiNop);
          dCt43 = bigIntToExcelNumber(snap.ct43_thueKhauTruChuyenKySau - prev.ct43_thueKhauTruChuyenKySau);
        }

        const typeStr = snap.declarationType === 'ORIGINAL' ? 'Chính thức' : 'Bổ sung';
        const lanStr = snap.declarationType === 'ORIGINAL' ? '—' : `Lần ${snap.supplementalNo || 1}`;

        const row = sheet2.addRow({
          stt: s2Index++,
          periodLabel: sanitizeExcelCellValue(g.periodLabel),
          formCode: sanitizeExcelCellValue(snap.formCode),
          declarationType: sanitizeExcelCellValue(typeStr),
          supplementalNo: sanitizeExcelCellValue(lanStr),
          submittedAt: sanitizeExcelCellValue(snap.submittedAt || ''),
          submissionId: sanitizeExcelCellValue(snap.submissionId),
          ct35: bigIntToExcelNumber(snap.ct35_thueBanRa),
          ct24: bigIntToExcelNumber(snap.ct24_thueMuaVao),
          ct25: bigIntToExcelNumber(snap.ct25_thueKhauTruKyNay),
          ct40: bigIntToExcelNumber(snap.ct40_thuePhaiNop),
          ct43: bigIntToExcelNumber(snap.ct43_thueKhauTruChuyenKySau),
          dCt35: snapIdx > 0 ? dCt35 : '—',
          dCt25: snapIdx > 0 ? dCt25 : '—',
          dCt40: snapIdx > 0 ? dCt40 : '—',
          dCt43: snapIdx > 0 ? dCt43 : '—',
          source: snap.xmlAvailable ? 'XML Tờ khai' : 'Metadata Cổng'
        });

        row.height = 22;
        row.alignment = { vertical: 'middle' };

        ['ct35', 'ct24', 'ct25', 'ct40', 'ct43'].forEach(k => {
          const cell = row.getCell(k);
          cell.numFmt = currencyNumFmt;
          cell.alignment = { vertical: 'middle', horizontal: 'right' };
        });

        if (snapIdx > 0) {
          ['dCt35', 'dCt25', 'dCt40', 'dCt43'].forEach(k => {
            const cell = row.getCell(k);
            cell.numFmt = currencyNumFmt;
            cell.alignment = { vertical: 'middle', horizontal: 'right' };
          });
        }
      });
    });

    sheet2.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet2.columns.length }
    };

    // ═════════════════════════════════════════════════════════════════════
    // SHEET 3: 03_DIEU_CHINH_XUYEN_KY (Cross-Period Adjustments [37]/[38])
    // ═════════════════════════════════════════════════════════════════════
    const sheet3 = workbook.addWorksheet('03_DIEU_CHINH_XUYEN_KY', {
      views: [{ state: 'frozen', ySplit: 1, showGridLines: true }]
    });

    sheet3.columns = [
      { header: 'STT', key: 'stt', width: 7 },
      { header: 'Kỳ gốc được bổ sung', key: 'sourcePeriod', width: 22 },
      { header: 'Lần bổ sung', key: 'seq', width: 14 },
      { header: 'Ngày nộp BS', key: 'filedDate', width: 18 },
      { header: 'Kỳ chịu tác động', key: 'impactPeriod', width: 20 },
      { header: 'Loại điều chỉnh', key: 'impactType', width: 28 },
      { header: 'Chỉ tiêu ảnh hưởng', key: 'targetInd', width: 20 },
      { header: 'Số tiền điều chỉnh', key: 'delta', width: 22 },
      { header: 'Mô tả nghiệp vụ', key: 'desc', width: 50 },
      { header: 'Mã hồ sơ BS', key: 'submissionId', width: 22 }
    ];

    const hRow3 = sheet3.getRow(1);
    hRow3.font = headerFont;
    hRow3.fill = headerFill;
    hRow3.alignment = { vertical: 'middle', horizontal: 'center' };
    hRow3.height = 28;

    const crossAdjs = VatFlowEngine.extractCrossPeriodAdjustments(summary.periodGroups);
    crossAdjs.forEach((adj, idx) => {
      const row = sheet3.addRow({
        stt: idx + 1,
        sourcePeriod: sanitizeExcelCellValue(adj.sourcePeriod.periodLabel),
        seq: `BS lần ${adj.supplementarySequence}`,
        filedDate: sanitizeExcelCellValue(adj.supplementaryFiledDate || '—'),
        impactPeriod: sanitizeExcelCellValue(adj.impactPeriod?.periodLabel || 'Trong kỳ'),
        impactType: sanitizeExcelCellValue(adj.title),
        targetInd: sanitizeExcelCellValue(adj.targetIndicator || '—'),
        delta: bigIntToExcelNumber(adj.delta),
        desc: sanitizeExcelCellValue(adj.description),
        submissionId: sanitizeExcelCellValue(adj.sourceRecordId)
      });

      row.height = 22;
      row.alignment = { vertical: 'middle' };

      const deltaCell = row.getCell('delta');
      deltaCell.numFmt = currencyNumFmt;
      deltaCell.alignment = { vertical: 'middle', horizontal: 'right' };
    });

    sheet3.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet3.columns.length }
    };

    const fileName = sanitizeFilename(`Working_Paper_GTGT_${taxCode}_${year}_${Date.now()}.xlsx`);
    const outputPath = path.join(targetDir, fileName);

    await workbook.xlsx.writeFile(outputPath);
    return outputPath;
  }
}

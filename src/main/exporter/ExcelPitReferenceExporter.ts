import ExcelJS from 'exceljs';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { PitAnalyticsSummary } from '../../shared/pitAnalyticsTypes';
import { PitFlowEngine } from '../../shared/PitFlowEngine';

export class ExcelPitReferenceExporter {
  public static async exportPitReference(
    summary: PitAnalyticsSummary,
    targetYear: number,
    outputDirectory?: string
  ): Promise<{ success: boolean; filePath?: string; error?: string }> {
    try {
      const yearFlow = PitFlowEngine.normalizeYearFlow(summary, targetYear);
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'TaxRecord - Professional Tax Audit Engine';
      workbook.created = new Date();

      // Palette Màu Kiểm Toán Navy & Emerald
      const COLOR_NAVY = '1E293B';
      const COLOR_TEAL = '0F766E';
      const COLOR_ROW_ALT = 'F1F5F9';
      const COLOR_BORDER = 'CBD5E1';

      // ─── SHEET 1: ĐỐI CHIẾU TNCN NĂM (WORKING PAPER) ─────────────────────
      const ws1 = workbook.addWorksheet(`TNCN_${targetYear}`, {
        views: [{ showGridLines: true }]
      });

      // Title Block
      ws1.mergeCells('A1:H1');
      const titleCell = ws1.getCell('A1');
      titleCell.value = `BẢNG ĐỐI CHIẾU NGHĨA VỤ THUẾ TNCN & TỜ KHAI NĂM ${targetYear}`;
      titleCell.font = { name: 'Segoe UI', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COLOR_NAVY}` } };
      titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
      ws1.getRow(1).height = 36;

      ws1.mergeCells('A2:H2');
      const subCell = ws1.getCell('A2');
      subCell.value = `Mã số thuế: ${summary.taxpayerId} · Phân tích đối chiếu khấu trừ thuế TNCN theo Thông tư 80/2021/TT-BTC`;
      subCell.font = { name: 'Segoe UI', size: 10, italic: true, color: { argb: 'FF64748B' } };
      subCell.alignment = { vertical: 'middle', horizontal: 'center' };
      ws1.getRow(2).height = 20;

      // Table Header (Row 4)
      const headers = [
        'KỲ KÊ KHAI',
        'SỐ LAO ĐỘNG [21]',
        'TỔNG TNCT [24]',
        'KHẤU TRỪ CƯ TRÚ [31]',
        'KHẤU TRỪ K.CƯ TRÚ [32]',
        'TỔNG KHẤU TRỪ [30/34]',
        'HỒ SƠ HIỆU LỰC',
        'GHI CHÚ KỲ'
      ];

      const headerRow = ws1.getRow(4);
      headerRow.values = headers;
      headerRow.height = 28;
      headerRow.font = { name: 'Segoe UI', size: 10.5, bold: true, color: { argb: 'FFFFFFFF' } };
      headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

      for (let col = 1; col <= 8; col++) {
        const c = headerRow.getCell(col);
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COLOR_TEAL}` } };
        c.border = {
          top: { style: 'thin', color: { argb: `FF${COLOR_BORDER}` } },
          left: { style: 'thin', color: { argb: `FF${COLOR_BORDER}` } },
          bottom: { style: 'medium', color: { argb: `FF${COLOR_BORDER}` } },
          right: { style: 'thin', color: { argb: `FF${COLOR_BORDER}` } }
        };
      }

      let currentRowIdx = 5;

      // Render 4 Quarter Blocks
      for (const qBlock of yearFlow.quarterBlocks) {
        // Nếu có các tháng con
        for (const mItem of qBlock.monthFilings) {
          const r = ws1.getRow(currentRowIdx++);
          r.height = 22;
          r.values = [
            `   ├─ ${mItem.periodLabel}`,
            mItem.employeeCountCt21 > 0n ? Number(mItem.employeeCountCt21) : '',
            Number(mItem.totalIncomeCt24),
            Number(mItem.residentTaxCt32),
            Number(mItem.nonResidentTaxCt33),
            Number(mItem.totalWithheldTaxCt34),
            `${mItem.versionLabel} (${mItem.evidence?.formCode || '05/KK'})`,
            mItem.notes || ''
          ];
          r.font = { name: 'Segoe UI', size: 10 };
          r.getCell(1).alignment = { vertical: 'middle', horizontal: 'left' };
          r.getCell(2).alignment = { vertical: 'middle', horizontal: 'right' };
          r.getCell(2).numFmt = '#,##0';
          r.getCell(3).numFmt = '#,##0';
          r.getCell(4).numFmt = '#,##0';
          r.getCell(5).numFmt = '#,##0';
          r.getCell(6).numFmt = '#,##0';
          r.getCell(7).alignment = { vertical: 'middle', horizontal: 'center' };
        }

        // Tờ khai quý (nếu có)
        if (qBlock.quarterFiling) {
          const qItem = qBlock.quarterFiling;
          const r = ws1.getRow(currentRowIdx++);
          r.height = 24;
          r.values = [
            `▼ ${qItem.periodLabel}`,
            qItem.employeeCountCt21 > 0n ? Number(qItem.employeeCountCt21) : '',
            Number(qItem.totalIncomeCt24),
            Number(qItem.residentTaxCt32),
            Number(qItem.nonResidentTaxCt33),
            Number(qItem.totalWithheldTaxCt34),
            `${qItem.versionLabel} (${qItem.evidence?.formCode || '05/KK'})`,
            qItem.notes || ''
          ];
          r.font = { name: 'Segoe UI', size: 10, bold: true };
          r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: `FF${COLOR_ROW_ALT}` } };
          r.getCell(2).alignment = { vertical: 'middle', horizontal: 'right' };
          r.getCell(2).numFmt = '#,##0';
          r.getCell(3).numFmt = '#,##0';
          r.getCell(4).numFmt = '#,##0';
          r.getCell(5).numFmt = '#,##0';
          r.getCell(6).numFmt = '#,##0';
          r.getCell(7).alignment = { vertical: 'middle', horizontal: 'center' };
        } else if (qBlock.monthFilings.length === 0) {
          // Quý chưa có hồ sơ
          const r = ws1.getRow(currentRowIdx++);
          r.height = 22;
          r.values = [`▼ ${qBlock.quarterLabel}`, '', 0, 0, 0, 0, 'Chưa tìm thấy hồ sơ', ''];
          r.font = { name: 'Segoe UI', size: 10, italic: true, color: { argb: 'FF94A3B8' } };
          r.getCell(3).numFmt = '#,##0';
          r.getCell(4).numFmt = '#,##0';
          r.getCell(5).numFmt = '#,##0';
          r.getCell(6).numFmt = '#,##0';
        }
      }

      // ─── FOOTER CỘNG PHÁT SINH NĂM & QUYẾT TOÁN ─────────────────
      currentRowIdx++;
      const totalRow = ws1.getRow(currentRowIdx++);
      totalRow.height = 26;
      totalRow.values = [
        'CỘNG PHÁT SINH CÁC KỲ TRONG NĂM',
        yearFlow.totalEmployeeCount > 0n ? Number(yearFlow.totalEmployeeCount) : '',
        Number(yearFlow.totalIncomeCt24),
        Number(yearFlow.totalResidentTax32),
        Number(yearFlow.totalNonResidentTax33),
        Number(yearFlow.totalWithheldTax34),
        `${yearFlow.periodsCount} kỳ có hồ sơ`,
        ''
      ];
      totalRow.font = { name: 'Segoe UI', size: 10.5, bold: true, color: { argb: `FF${COLOR_NAVY}` } };
      totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      totalRow.getCell(2).alignment = { vertical: 'middle', horizontal: 'right' };
      totalRow.getCell(2).numFmt = '#,##0';
      totalRow.getCell(3).numFmt = '#,##0';
      totalRow.getCell(4).numFmt = '#,##0';
      totalRow.getCell(5).numFmt = '#,##0';
      totalRow.getCell(6).numFmt = '#,##0';

      // Quyết toán năm
      if (yearFlow.finalizationSnapshot) {
        const qttRow = ws1.getRow(currentRowIdx++);
        qttRow.height = 26;
        qttRow.values = [
          `QUYẾT TOÁN NĂM (${yearFlow.finalizationSnapshot.formCode})`,
          yearFlow.finalizationSnapshot.ct21_tongSoNguoiLaoDong > 0n ? Number(yearFlow.finalizationSnapshot.ct21_tongSoNguoiLaoDong) : '',
          Number(yearFlow.finalizationSnapshot.ct24_tongThuNhapChiuThue),
          Number(yearFlow.finalizationSnapshot.ct32_khauTruCaNhanCuTru),
          Number(yearFlow.finalizationSnapshot.ct33_khauTruCaNhanKhongCuTru),
          Number(yearFlow.finalizationWithheldTax36 || 0n),
          `Bản ${yearFlow.finalizationSnapshot.versionType === 'SUPPLEMENTAL' ? `BS lần ${yearFlow.finalizationSnapshot.supplementalNo}` : 'Chính thức'}`,
          'Chỉ tiêu [31/36] trên 05/QTT'
        ];
        qttRow.font = { name: 'Segoe UI', size: 10.5, bold: true, color: { argb: 'FF065F46' } };
        qttRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
        qttRow.getCell(2).alignment = { vertical: 'middle', horizontal: 'right' };
        qttRow.getCell(2).numFmt = '#,##0';
        qttRow.getCell(3).numFmt = '#,##0';
        qttRow.getCell(4).numFmt = '#,##0';
        qttRow.getCell(5).numFmt = '#,##0';
        qttRow.getCell(6).numFmt = '#,##0';

        // Dòng chênh lệch đối chiếu
        const deltaRow = ws1.getRow(currentRowIdx++);
        deltaRow.height = 26;
        const isMatched = yearFlow.auditStatus === 'MATCHED';
        deltaRow.values = [
          'CHÊNH LỆCH (TỔNG KỲ VS QUYẾT TOÁN)',
          '',
          '',
          '',
          '',
          Number(yearFlow.mismatchDelta || 0n),
          isMatched ? '✓ KHỚP 100% (PASS)' : '⚠️ LỆCH SỐ LIỆU',
          isMatched ? 'Số liệu 12 tháng/4 quý khớp với Quyết toán' : 'Cần rà soát lại các tờ khai bổ sung'
        ];
        deltaRow.font = {
          name: 'Segoe UI',
          size: 10.5,
          bold: true,
          color: { argb: isMatched ? 'FF065F46' : 'FF991B1B' }
        };
        deltaRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: isMatched ? 'FFECFDF5' : 'FFFEF2F2' }
        };
        deltaRow.getCell(6).numFmt = '#,##0';
      }

      // Column widths
      ws1.getColumn(1).width = 28;
      ws1.getColumn(2).width = 16;
      ws1.getColumn(3).width = 22;
      ws1.getColumn(4).width = 22;
      ws1.getColumn(5).width = 22;
      ws1.getColumn(6).width = 24;
      ws1.getColumn(7).width = 24;
      ws1.getColumn(8).width = 32;

      // ─── LƯU FILE ───────────────────────────────────────────────
      const exportDir =
        outputDirectory ||
        path.join(app.getPath('downloads'), 'TaxRecord_Exports');

      if (!fs.existsSync(exportDir)) {
        fs.mkdirSync(exportDir, { recursive: true });
      }

      const fileName = `Bang_Doi_Chieu_TNCN_${summary.taxpayerId}_${targetYear}_${Date.now()}.xlsx`;
      const filePath = path.join(exportDir, fileName);

      await workbook.xlsx.writeFile(filePath);
      return { success: true, filePath };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
}

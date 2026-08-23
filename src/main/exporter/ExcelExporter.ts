import ExcelJS from 'exceljs';
import path from 'path';
import { sanitizeExcelCellValue, sanitizeFilename } from '../../shared/sanitizer';
import { TaxFiling } from '../../shared/types';
import { SLIP_TAX_TYPE_LABELS } from '../../shared/gntClassification';

export class ExcelExporter {
  public static async exportFilingsToExcel(
    filings: TaxFiling[],
    targetDir: string,
    taxCode: string,
    year: number
  ): Promise<string> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'TaxRecord Downloader';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet(`Hồ sơ thuế ${year}`, {
      views: [{ showGridLines: true }]
    });

    // Định nghĩa cột
    worksheet.columns = [
      { header: 'STT', key: 'stt', width: 8 },
      { header: 'Mã số thuế', key: 'taxCode', width: 16 },
      { header: 'Loại thuế', key: 'taxType', width: 12 },
      { header: 'Mã tờ khai', key: 'declarationCode', width: 15 },
      { header: 'Mã thủ tục', key: 'procedureCode', width: 15 },
      { header: 'Tên hồ sơ / Tờ khai', key: 'title', width: 45 },
      { header: 'Kỳ tính thuế', key: 'period', width: 18 },
      { header: 'Ngày nộp', key: 'submittedAt', width: 16 },
      { header: 'Lần nộp', key: 'filingType', width: 16 },
      { header: 'Trạng thái Cổng Thuế', key: 'portalStatus', width: 22 },
      { header: 'Trạng thái Tải', key: 'downloadStatus', width: 16 },
      { header: 'File XML', key: 'xmlPath', width: 35 },
      { header: 'File PDF', key: 'pdfPath', width: 35 }
    ];

    // Tạo style cho Header
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF15803D' } // Green-700
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 28;

    // Đổ dữ liệu với bảo vệ chống Formula Injection
    filings.forEach((filing, index) => {
      let filingTypeStr = 'Lần đầu';
      if (filing.filingType === 'SUPPLEMENTAL') {
        filingTypeStr = `Bổ sung lần ${filing.supplementalNo || 1}`;
      }

      let downloadStatusStr = 'Chưa tải';
      if (filing.downloadStatus === 'COMPLETED') downloadStatusStr = 'Đã tải thành công';
      else if (filing.downloadStatus === 'EXISTING') downloadStatusStr = 'Đã có sẵn';
      else if (filing.downloadStatus === 'FAILED') downloadStatusStr = 'Tải thất bại';

      const row = worksheet.addRow({
        stt: index + 1,
        taxCode: sanitizeExcelCellValue(taxCode),
        taxType: sanitizeExcelCellValue(filing.taxType),
        declarationCode: sanitizeExcelCellValue(filing.declarationCode || ''),
        procedureCode: sanitizeExcelCellValue(filing.procedureCode || ''),
        title: sanitizeExcelCellValue(filing.title),
        period: sanitizeExcelCellValue(filing.period || ''),
        submittedAt: sanitizeExcelCellValue(filing.submittedAt || ''),
        filingType: sanitizeExcelCellValue(filingTypeStr),
        portalStatus: sanitizeExcelCellValue(filing.status || ''),
        downloadStatus: sanitizeExcelCellValue(downloadStatusStr),
        xmlPath: sanitizeExcelCellValue(filing.downloadedFiles?.xml ? path.basename(filing.downloadedFiles.xml) : ''),
        pdfPath: sanitizeExcelCellValue(filing.downloadedFiles?.pdf ? path.basename(filing.downloadedFiles.pdf) : '')
      });

      row.height = 22;
      row.alignment = { vertical: 'middle' };

      // Kẻ viền cho các ô
      row.eachCell(cell => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };
      });
    });

    const fileName = sanitizeFilename(`Danh_sach_ho_so_thue_${taxCode}_${year}_${Date.now()}.xlsx`);
    const outputPath = path.join(targetDir, fileName);

    await workbook.xlsx.writeFile(outputPath);
    return outputPath;
  }

  public static async exportPaymentSlipsToExcel(
    slips: any[],
    targetDir: string,
    taxCode: string,
    year: number
  ): Promise<string> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'TaxRecord Downloader';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet(`Giấy nộp tiền ${year}`, {
      views: [{ showGridLines: true }]
    });

    worksheet.columns = [
      { header: 'STT', key: 'stt', width: 8 },
      { header: 'Mã số thuế', key: 'taxCode', width: 16 },
      { header: 'Số chứng từ / GNT', key: 'soChungTu', width: 22 },
      { header: 'Ngày nộp tiền', key: 'ngayNop', width: 18 },
      { header: 'Số tiền nộp (VND)', key: 'soTien', width: 20 },
      { header: 'Loại thuế', key: 'loaiThue', width: 22 },
      { header: 'Kỳ thuế', key: 'kyThue', width: 28 },
      { header: 'Tiểu mục NDKT', key: 'tieuMuc', width: 16 },
      { header: 'Hình thức nộp', key: 'hinhThucNop', width: 26 },
      { header: 'Ngân hàng nộp', key: 'nganHang', width: 30 },
      { header: 'Trạng thái', key: 'trangThai', width: 20 }
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF0F766E' } // Teal-700
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 28;

    slips.forEach((slip, index) => {
      const cls = slip.classification;
      const loaiThueText = (cls?.taxTypes || [])
        .map((t: string) => (SLIP_TAX_TYPE_LABELS as Record<string, string>)[t] || t)
        .join('; ');
      const kyThueText = (cls?.periods || []).join('; ');
      const tieuMucText = (cls?.ndktCodes || []).join(', ');

      const row = worksheet.addRow({
        stt: index + 1,
        taxCode: sanitizeExcelCellValue(taxCode),
        soChungTu: sanitizeExcelCellValue(slip.soChungTu || slip.soGnt || ''),
        ngayNop: sanitizeExcelCellValue(slip.ngayNopThue || slip.ngayLapGnt || ''),
        soTien: Number(slip.soTien || 0),
        loaiThue: sanitizeExcelCellValue(loaiThueText || ''),
        kyThue: sanitizeExcelCellValue(kyThueText || slip.kyThue || ''),
        tieuMuc: sanitizeExcelCellValue(tieuMucText || slip.tieuMuc || ''),
        hinhThucNop: sanitizeExcelCellValue(slip.hinhThucNop || ''),
        nganHang: sanitizeExcelCellValue(slip.tenNganHang || slip.nganHang || ''),
        trangThai: sanitizeExcelCellValue(slip.trangThai || 'Đã nộp NSNN')
      });

      row.height = 22;
      row.alignment = { vertical: 'middle' };
      row.getCell('soTien').numFmt = '#,##0';
    });

    const fileName = sanitizeFilename(`Giay_nop_tien_GNT_${taxCode}_${year}_${Date.now()}.xlsx`);
    const outputPath = path.join(targetDir, fileName);

    await workbook.xlsx.writeFile(outputPath);
    return outputPath;
  }
}

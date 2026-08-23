import * as cheerio from 'cheerio';
import { PaymentSlipDetail, PaymentSlipRecord, PaymentSlipSignatureInfo, PaymentSlipSubItem } from '../../shared/types';

export class PaymentSlipParser {
  /**
   * Phân tích bảng HTML kết quả tra cứu Giấy Nộp Tiền (#allResultTableBody)
   */
  public static parseTableResults(html: string): PaymentSlipRecord[] {
    const results: PaymentSlipRecord[] = [];
    if (!html || typeof html !== 'string') return results;

    const $ = cheerio.load(html);
    const tbody = $('#allResultTableBody');
    if (!tbody.length) return results;

    tbody.find('tr').each((_, tr) => {
      const $tr = $(tr);
      const $tds = $tr.find('td');
      if ($tds.length < 10) return;

      const sttText = $tds.eq(0).text().trim();
      const stt = parseInt(sttText, 10);
      if (isNaN(stt)) return; // Bỏ qua các dòng phụ (như dòng thông báo con)

      const maGiaoDich = $tds.eq(1).text().trim();
      const maGiaoDichChiTiet = $tds.eq(2).text().trim() || undefined;
      const lanNop = $tds.eq(3).text().trim() || undefined;

      // Cột 5: Số giấy nộp tiền và ID chứng từ (ctuId)
      const $soGntLink = $tds.eq(4).find('a');
      const soGnt = ($soGntLink.length ? $soGntLink.text() : $tds.eq(4).text()).trim();
      let ctuId = '';
      const href = $soGntLink.attr('href') || '';
      const ctuMatch = href.match(/chiTietCT\((\d+)\)/) || href.match(/downloadGNT\((\d+)\)/);
      if (ctuMatch) {
        ctuId = ctuMatch[1];
      }
      if (!ctuId) {
        // Tìm trong cột download (thường là cột 19)
        const dlHref = $tr.find('a[href*="downloadGNT"]').attr('href') || '';
        const dlMatch = dlHref.match(/downloadGNT\((\d+)\)/);
        if (dlMatch) {
          ctuId = dlMatch[1];
        }
      }
      if (!ctuId) {
        // Fallback deterministic: cùng một dòng dữ liệu phải sinh CÙNG MỘT id qua mọi lần
        // parse (Date.now() trước đây khiến dedupe/matching thấy phantom duplicates)
        const fbDate = $tds.eq(9).text().trim();
        ctuId = soGnt || `gnt_${stt}_${maGiaoDich}_${lanNop || '1'}_${$tds.eq(5).text().trim()}_${fbDate}`;
      }

      // Cột 6: Số tiền
      const rawSoTien = $tds.eq(5).text().trim().replace(/,/g, '');
      const soTien = parseFloat(rawSoTien) || 0;
      const soTienFormatted = $tds.eq(5).text().trim() || (soTien > 0 ? soTien.toLocaleString('vi-VN') : '0');

      // Cột 7: Loại tiền (VND, USD)
      const loaiTien = $tds.eq(6).text().trim() || 'VND';

      // Cột 8: Trạng thái
      const trangThai = $tds.eq(7).text().trim() || 'Nộp thuế thành công';

      // Cột 9: Số chứng từ
      const soChungTu = $tds.eq(8).text().trim() || undefined;

      // Cột 10, 11, 12: Ngày lập, Ngày gửi, Ngày nộp
      const ngayLapGnt = $tds.eq(9).text().trim() || undefined;
      const ngayGuiGnt = $tds.eq(10).text().trim() || undefined;
      const ngayNopThue = $tds.eq(11).text().trim() || undefined;

      // Cột 16, 17, 18: Hình thức nộp, Ngân hàng, Số tài khoản
      const hinhThucNop = $tds.eq(15).text().trim() || undefined;
      const tenNganHang = $tds.eq(16).text().trim() || undefined;
      const soTaiKhoan = $tds.eq(17).text().trim() || undefined;

      results.push({
        id: ctuId,
        stt,
        maGiaoDich,
        maGiaoDichChiTiet,
        lanNop,
        soGnt,
        soTien,
        soTienFormatted,
        loaiTien,
        trangThai,
        soChungTu,
        ngayLapGnt,
        ngayGuiGnt,
        ngayNopThue,
        hinhThucNop,
        tenNganHang,
        soTaiKhoan,
        downloadAvailable: true
      });
    });

    return results;
  }

  /**
   * Phân tích nội dung chi tiết Mẫu số C1-02/NS từ HTML phản hồi eTax
   */
  public static parseDetailResults(html: string, ctuId: string): PaymentSlipDetail {
    const $ = cheerio.load(html);

    // Trích xuất mã hiệu, số chứng từ
    let maHieu = '';
    const maHieuMatch = html.match(/Mã\s*hiệu:\s*[\s\S]*?<span>([^<]+)<\/span>/i);
    if (maHieuMatch) maHieu = maHieuMatch[1].trim();

    let soChungTu = '';
    const soChungTuMatch = html.match(/Số:\s*[\s\S]*?<span>([^<]+)<\/span>/i);
    if (soChungTuMatch) soChungTu = soChungTuMatch[1].trim();

    let soThamChieu = '';
    const thamChieuMatch = html.match(/Số\s*tham\s*chiếu:\s*[\s\S]*?(\d{10,})/i);
    if (thamChieuMatch) soThamChieu = thamChieuMatch[1].trim();

    // Người nộp thuế & MST
    let nguoiNopThue = '';
    const nntMatch = html.match(/Người\s*nộp\s*thuế:\s*[\s\S]*?text-transform:uppercase;\">([^<]+)<\/span>/i);
    if (nntMatch) nguoiNopThue = nntMatch[1].trim();

    let maSoThue = '';
    const mstMatch = html.match(/Mã\s*số\s*thuế:\s*[\s\S]*?<span[^>]*>(\d{10,14})<\/span>/i);
    if (mstMatch) maSoThue = mstMatch[1].trim();

    let diaChi = '';
    const diaChiMatch = html.match(/Địa\s*chỉ:\s*[\s\S]*?<span[^>]*>([^<]+)<\/span>/i);
    if (diaChiMatch) diaChi = diaChiMatch[1].trim();

    let tinhTp = '';
    const tinhTpMatch = html.match(/Tỉnh,\s*TP:\s*[\s\S]*?<span[^>]*>([^<]+)<\/span>/i);
    if (tinhTpMatch) tinhTp = tinhTpMatch[1].trim();

    // Ngân hàng trích TK & Số tài khoản
    let nganHangTrichTk = '';
    const nhTrichMatch = html.match(/Đề\s*nghị\s*NH\/\s*KBNN:\s*[\s\S]*?<span[^>]*>([^<]+)<\/span>/i);
    if (nhTrichMatch) nganHangTrichTk = nhTrichMatch[1].trim();

    let soTaiKhoanTrich = '';
    const tkTrichMatch = $('#so_tk_nhang').text().trim();
    if (tkTrichMatch) soTaiKhoanTrich = tkTrichMatch;

    // Kho bạc nhà nước & Cơ quan quản lý thu
    let taiKhoanKbnn = '';
    const kbnnMatch = html.match(/Vào\s*tài\s*Khoản\s*KBNN:\s*[\s\S]*?<span[^>]*>([^<]+)<\/span>/i);
    if (kbnnMatch) taiKhoanKbnn = kbnnMatch[1].trim();

    let coQuanQuanLyThu = '';
    const cqThuMatch = html.match(/Cơ\s*quan\s*quản\s*lý\s*thu:\s*[\s\S]*?<span[^>]*>([^<]+)<\/span>/i);
    if (cqThuMatch) coQuanQuanLyThu = cqThuMatch[1].trim();

    let nganHangUynhiemThu = '';
    const nhUntMatch = html.match(/Mở\s*tại\s*NH\s*ủy\s*nhiệm\s*thu:\s*[\s\S]*?<span[^>]*>([^<]+)<\/span>/i);
    if (nhUntMatch) nganHangUynhiemThu = nhUntMatch[1].trim();

    // Bảng chi tiết các khoản nộp (#chungtu_ctiet)
    const items: PaymentSlipSubItem[] = [];
    $('#chungtu_ctiet tbody tr').each((_, tr) => {
      const $tds = $(tr).find('td');
      if ($tds.length >= 7) {
        const stt = parseInt($tds.eq(0).text().trim(), 10);
        if (!isNaN(stt)) {
          const soToKhaiQuyetDinh = $tds.eq(1).text().trim() || undefined;
          const kyThueNgayQd = $tds.eq(2).text().trim() || undefined;
          const noiDungKhoanNop = $tds.eq(3).text().trim();
          const soTienNguyenTe = $tds.eq(4).text().trim() || undefined;
          const soTienVND = $tds.eq(5).text().trim();
          const maChuong = $tds.eq(6).text().trim() || undefined;
          const maNDKT = $tds.eq(7).text().trim() || undefined;

          items.push({
            stt,
            soToKhaiQuyetDinh,
            kyThueNgayQd,
            noiDungKhoanNop,
            soTienNguyenTe,
            soTienVND,
            maChuong,
            maNDKT
          });
        }
      }
    });

    // Tổng tiền
    const tongTienVND = $('#sum').text().trim() || (items.length > 0 ? items[0].soTienVND : '0');
    const tongTienBangChu = $('#sotienbangchu_VND').text().trim() || undefined;

    // Chữ ký số
    const signatures: PaymentSlipSignatureInfo[] = [];
    $('li table').each((_, table) => {
      const text = $(table).text();
      const signerMatch = text.match(/Người\s*ký\s*:\s*([^]+?)(?:Ngày\s*ký|$)/i);
      const dateMatch = text.match(/Ngày\s*ký\s*:\s*(\d{1,2}\/\d{1,2}\/\d{4}\s*\d{1,2}:\d{1,2}:\d{1,2})/i);
      if (signerMatch && dateMatch) {
        signatures.push({
          signer: signerMatch[1].trim(),
          signedAt: dateMatch[1].trim()
        });
      }
    });

    return {
      id: ctuId,
      soGnt: soChungTu || ctuId,
      maHieu: maHieu || undefined,
      soChungTu: soChungTu || undefined,
      soThamChieu: soThamChieu || undefined,
      hinhThucNopTien: 'CHUYEN_KHOAN',
      loaiTien: 'VND',
      nguoiNopThue: nguoiNopThue || 'Người nộp thuế',
      maSoThue: maSoThue || '',
      diaChi: diaChi || undefined,
      tinhTp: tinhTp || undefined,
      nganHangTrichTk: nganHangTrichTk || undefined,
      soTaiKhoanTrich: soTaiKhoanTrich || undefined,
      loaiTaiKhoanThu: 'TK_THU_NSNN',
      taiKhoanKbnn: taiKhoanKbnn || undefined,
      tinhTpKbnn: tinhTp || undefined,
      nganHangUynhiemThu: nganHangUynhiemThu || undefined,
      coQuanQuanLyThu: coQuanQuanLyThu || undefined,
      items,
      tongTienVND,
      tongTienBangChu: tongTienBangChu || undefined,
      signatures,
      rawHtml: html
    };
  }
}

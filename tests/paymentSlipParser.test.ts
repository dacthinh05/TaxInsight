import { describe, expect, it } from 'vitest';
import { PaymentSlipParser } from '../src/main/scanner/PaymentSlipParser';

describe('PaymentSlipParser (eTax Mẫu C1-02/NS)', () => {
  const sampleTableHtml = `
    <table class="result_table">
      <tbody id="allResultTableBody">
        <tr class="" style="height: 35px">
          <td align="center">1&nbsp;</td>
          <td style="text-align: center;">11220260357675749</td>
          <td style="text-align: center;"></td>
          <td style="text-align: center;"></td>
          <td style="text-align: center;"><a href="javascript: chiTietCT(53864244);" title="Xem chi tiết">00000370273570901202634340228</a></td>
          <td style="text-align: right;">99,921,049</td>
          <td style="text-align: center;">VND</td>
          <td style="text-align: center;">Nộp thuế thành công</td>
          <td style="text-align: center;">1499981</td>
          <td style="text-align: center;">17/01/2026 09:53:27</td>
          <td style="text-align: center;">17/01/2026 11:36:26</td>
          <td style="text-align: center;">17/01/2026 11:37:02</td>
          <td style="text-align: center;"></td>
          <td style="text-align: center;"></td>
          <td style="text-align: center;"></td>
          <td style="text-align: left;">Nộp tại cổng eTax của TCT</td>
          <td style="text-align: left;">Ngân hàng TMCP Đầu tư và Phát triển Việt Nam</td>
          <td style="text-align: center;">6503056170</td>
          <td style="text-align: center;"><a href="javascript: downloadGNT(53864244);">Tải về</a></td>
          <td style="text-align: center;"></td>
        </tr>
        <tr class="" style="height: 35px">
          <td align="center">2&nbsp;</td>
          <td style="text-align: center;">11220260355249027</td>
          <td style="text-align: center;"></td>
          <td style="text-align: center;"></td>
          <td style="text-align: center;"><a href="javascript: chiTietCT(53688311);" title="Xem chi tiết">00000370273570901202634164540</a></td>
          <td style="text-align: right;">3,952,858</td>
          <td style="text-align: center;">VND</td>
          <td style="text-align: center;">Nộp thuế thành công</td>
          <td style="text-align: center;">1191806</td>
          <td style="text-align: center;">06/01/2026 10:30:38</td>
          <td style="text-align: center;">06/01/2026 13:03:52</td>
          <td style="text-align: center;">06/01/2026 13:04:01</td>
          <td style="text-align: center;"></td>
          <td style="text-align: center;"></td>
          <td style="text-align: center;"></td>
          <td style="text-align: left;">Nộp tại cổng eTax của TCT</td>
          <td style="text-align: left;">Ngân hàng TMCP Đầu tư và Phát triển Việt Nam</td>
          <td style="text-align: center;">6503056170</td>
          <td style="text-align: center;"><a href="javascript: downloadGNT(53688311);">Tải về</a></td>
          <td style="text-align: center;"></td>
        </tr>
      </tbody>
    </table>
  `;

  const sampleDetailHtml = `
    <div>
      <p>Mã hiệu: <span>2620202TSA</span></p>
      <p>Số: <span>1499981</span></p>
      <span>Số tham chiếu: 11220260357675749</span>
      <div>Người nộp thuế: <span style="text-transform:uppercase;">CÔNG TY TNHH CÔNG NGHIỆP CARBOTEC (VN)</span></div>
      <span>Mã số thuế: <span style="color: #2E2E2E;">3702735709</span></span>
      <p>Địa chỉ: <span>Lô số 19-2, Đường số 11</span></p>
      <p>Tỉnh, TP: <span>Thành phố Hồ Chí Minh</span></p>
      <p>Đề nghị NH/ KBNN: <span>Ngân hàng TMCP Đầu tư và Phát triển Việt Nam</span> trích TK số: <span id="so_tk_nhang">6503056170</span></p>
      <p>Vào tài Khoản KBNN: <span>Kho bạc Nhà nước Khu vực II</span></p>
      <p>Cơ quan quản lý thu: <span>Thuế Thành phố Hồ Chí Minh 02</span></p>

      <table id="chungtu_ctiet">
        <tbody>
          <tr>
            <td>1</td>
            <td>0406097974970001</td>
            <td>00/12/2025</td>
            <td>Thuế thu nhập từ tiền lương, tiền công.</td>
            <td></td>
            <td>99,921,049</td>
            <td>557</td>
            <td>1001</td>
          </tr>
        </tbody>
      </table>

      <span id="sum">99,921,049</span>
      <span id="sotienbangchu_VND">Chín mươi chín triệu chín trăm hai mươi mốt nghìn không trăm bốn mươi chín đồng</span>

      <ul>
        <li>
          <table>
            <tr><td>Người ký : CÔNG TY TNHH CÔNG NGHIỆP CARBOTEC (VN)</td></tr>
            <tr><td>Ngày ký : 17/01/2026 11:36:18</td></tr>
          </table>
        </li>
        <li>
          <table>
            <tr><td>Người ký : CỤC THUẾ</td></tr>
            <tr><td>Ngày ký : 17/01/2026 11:36:19</td></tr>
          </table>
        </li>
      </ul>
    </div>
  `;

  it('should parse payment slip table results accurately', () => {
    const results = PaymentSlipParser.parseTableResults(sampleTableHtml);
    expect(results).toHaveLength(2);

    expect(results[0].id).toBe('53864244');
    expect(results[0].soGnt).toBe('00000370273570901202634340228');
    expect(results[0].maGiaoDich).toBe('11220260357675749');
    expect(results[0].soTien).toBe(99921049);
    expect(results[0].soTienFormatted).toBe('99,921,049');
    expect(results[0].loaiTien).toBe('VND');
    expect(results[0].soChungTu).toBe('1499981');
    expect(results[0].ngayNopThue).toBe('17/01/2026 11:37:02');
    expect(results[0].soTaiKhoan).toBe('6503056170');

    expect(results[1].id).toBe('53688311');
    expect(results[1].soTien).toBe(3952858);
  });

  it('should parse payment slip detail Mẫu C1-02/NS accurately', () => {
    const detail = PaymentSlipParser.parseDetailResults(sampleDetailHtml, '53864244');

    expect(detail.id).toBe('53864244');
    expect(detail.maHieu).toBe('2620202TSA');
    expect(detail.soChungTu).toBe('1499981');
    expect(detail.soThamChieu).toBe('11220260357675749');
    expect(detail.nguoiNopThue).toBe('CÔNG TY TNHH CÔNG NGHIỆP CARBOTEC (VN)');
    expect(detail.maSoThue).toBe('3702735709');
    expect(detail.soTaiKhoanTrich).toBe('6503056170');
    expect(detail.taiKhoanKbnn).toBe('Kho bạc Nhà nước Khu vực II');
    expect(detail.coQuanQuanLyThu).toBe('Thuế Thành phố Hồ Chí Minh 02');

    expect(detail.items).toHaveLength(1);
    expect(detail.items[0].noiDungKhoanNop).toBe('Thuế thu nhập từ tiền lương, tiền công.');
    expect(detail.items[0].soTienVND).toBe('99,921,049');
    expect(detail.items[0].maChuong).toBe('557');
    expect(detail.items[0].maNDKT).toBe('1001');

    expect(detail.tongTienVND).toBe('99,921,049');
    expect(detail.signatures).toHaveLength(2);
    expect(detail.signatures[0].signer).toBe('CÔNG TY TNHH CÔNG NGHIỆP CARBOTEC (VN)');
    expect(detail.signatures[0].signedAt).toBe('17/01/2026 11:36:18');
  });
});

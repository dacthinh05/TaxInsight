import { describe, expect, it } from 'vitest';
import { buildC102Html } from '../src/main/exporter/C102PdfTemplate';
import { PaymentSlipDetail } from '../src/shared/types';

describe('Mẫu C1-02/NS PDF Template Generator (C102PdfTemplate)', () => {
  const sampleDetail: PaymentSlipDetail = {
    id: '53864244',
    soGnt: '00000370273570901202634340228',
    maHieu: '2620202TSA',
    soChungTu: '1499981',
    soThamChieu: '11220260357675749',
    hinhThucNopTien: 'CHUYEN_KHOAN',
    loaiTien: 'VND',
    nguoiNopThue: 'CÔNG TY TNHH CÔNG NGHIỆP CARBOTEC (VN)',
    maSoThue: '3702735709',
    diaChi: 'Lô số 19-2, Đường số 11, KCN Protrade',
    tinhTp: 'Bình Dương',
    nganHangTrichTk: 'Ngân hàng TMCP Đầu tư và Phát triển Việt Nam',
    soTaiKhoanTrich: '6503056170',
    loaiTaiKhoanThu: 'TK_THU_NSNN',
    taiKhoanKbnn: '7111',
    tinhTpKbnn: 'Kho bạc Nhà nước Khu vực II',
    coQuanQuanLyThu: 'Thuế Thành phố Hồ Chí Minh 02',
    items: [
      {
        stt: 1,
        soToKhaiQuyetDinh: '0406097974970001',
        kyThueNgayQd: '00/12/2025',
        noiDungKhoanNop: 'Thuế thu nhập từ tiền lương, tiền công.',
        soTienNguyenTe: '',
        soTienVND: '99,921,049',
        maChuong: '557',
        maNDKT: '1001'
      }
    ],
    tongTienVND: '99,921,049',
    tongTienBangChu: 'Chín mươi chín triệu chín trăm hai mươi mốt nghìn không trăm bốn mươi chín đồng',
    signatures: [
      {
        signer: 'CÔNG TY TNHH CÔNG NGHIỆP CARBOTEC (VN)',
        signedAt: '17/01/2026 11:36:18'
      },
      {
        signer: 'CỤC THUẾ',
        signedAt: '17/01/2026 11:36:19'
      },
      {
        signer: 'NGÂN HÀNG THƯƠNG MẠI CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN VIỆT NAM',
        signedAt: '17/01/2026 11:37:02'
      }
    ]
  };

  it('1. Generates valid full HTML structure for C1-02/NS', () => {
    const html = buildC102Html(sampleDetail);

    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="vi">');
    expect(html).toContain('Mẫu số C1-02/NS');
    expect(html).toContain('Thông tư 84/2016/TT-BTC');
    expect(html).toContain('Giấy nộp tiền vào Ngân sách Nhà nước');
    expect(html).toContain('3702735709');
    expect(html).toContain('CÔNG TY TNHH CÔNG NGHIỆP CARBOTEC (VN)');
    expect(html).toContain('1499981');
    expect(html).toContain('11220260357675749');
    expect(html).toContain('6503056170');
    expect(html).toContain('99,921,049');
    expect(html).toContain('1001');
    expect(html).toContain('557');
    expect(html).toContain('Chín mươi chín triệu');
    expect(html).toContain('CỤC THUẾ');
  });

  it('2. Properly computes and formats fallback total if tongTienVND is empty or 0', () => {
    const detailWithoutTotal: PaymentSlipDetail = {
      ...sampleDetail,
      tongTienVND: '',
      items: [
        {
          stt: 1,
          noiDungKhoanNop: 'Thuế GTGT',
          soTienVND: '50,000,000',
          kyThueNgayQd: '11/2025',
          maChuong: '557',
          maNDKT: '1701'
        },
        {
          stt: 2,
          noiDungKhoanNop: 'Thuế TNCN',
          soTienVND: '30,000,000',
          kyThueNgayQd: '11/2025',
          maChuong: '557',
          maNDKT: '1001'
        }
      ]
    };

    const html = buildC102Html(detailWithoutTotal);
    expect(html).toContain('80,000,000');
  });

  it('3. Handles degenerate slip with empty items cleanly without crashing', () => {
    const emptyDetail: PaymentSlipDetail = {
      ...sampleDetail,
      items: [],
      tongTienVND: '15,000,000'
    };

    const html = buildC102Html(emptyDetail);
    expect(html).toContain('Khoản nộp thuế vào Ngân sách Nhà nước');
    expect(html).toContain('15,000,000');
  });

  it('4. Escapes special HTML characters to prevent XSS/rendering breakage', () => {
    const xssDetail: PaymentSlipDetail = {
      ...sampleDetail,
      nguoiNopThue: 'CÔNG TY <TEST & "SPECIAL">',
      diaChi: '123 Đường "A" & <B>'
    };

    const html = buildC102Html(xssDetail);
    expect(html).not.toContain('<TEST & "SPECIAL">');
    expect(html).toContain('CÔNG TY &lt;TEST &amp; &quot;SPECIAL&quot;&gt;');
    expect(html).toContain('123 Đường &quot;A&quot; &amp; &lt;B&gt;');
  });
});

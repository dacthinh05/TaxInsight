export type GdtResponseKind =
  | 'GNT_QUERY_PAGE'
  | 'GNT_LIST'
  | 'GNT_DETAIL'
  | 'DOWNLOAD'
  | 'LOGIN_PAGE'
  | 'PLUGIN_GATE'
  | 'PORTAL_ERROR'
  | 'UNKNOWN';

export class GdtResponseClassifier {
  /**
   * Phân loại cấu trúc và ý nghĩa của response HTML từ Cổng Thuế
   */
  public static classify(htmlOrBuffer: string | Buffer, contentType?: string): GdtResponseKind {
    if (!htmlOrBuffer) return 'UNKNOWN';

    // 1. Kiểm tra nếu là binary download (PDF, Excel, Zip)
    if (Buffer.isBuffer(htmlOrBuffer)) {
      const header4 = htmlOrBuffer.slice(0, 4).toString('utf-8');
      if (header4.startsWith('%PDF')) return 'DOWNLOAD';
      if (header4.startsWith('PK\x03\x04')) return 'DOWNLOAD';
    }

    const text = typeof htmlOrBuffer === 'string' ? htmlOrBuffer : htmlOrBuffer.toString('utf-8');

    // 2. Kiểm tra nếu là trang Login / Session Expired
    if (
      text.includes('name="tenDN"') ||
      text.includes('name="matKhau"') ||
      text.includes('Đăng nhập Hệ thống Dịch vụ công') ||
      text.includes('Phiên làm việc đã hết hạn') ||
      text.includes('corpUserLoginProc') && text.includes('captcha')
    ) {
      return 'LOGIN_PAGE';
    }

    // 3. Trang dữ liệu GNT - kiểm tra TRƯỚC plugin gate vì mọi trang eTax
    // đều include script plugin (hwcrypto/plugin_websocket) nên không thể
    // dùng tên script làm dấu hiệu phân loại
    if (
      text.includes('GIẤY NỘP TIỀN VÀO NGÂN SÁCH NHÀ NƯỚC') ||
      text.includes('Mẫu số C1- 02/NS') ||
      text.includes('Mẫu số C1-02/NS') ||
      text.includes('id="chungtu_ctiet"') ||
      text.includes('viewC102From')
    ) {
      return 'GNT_DETAIL';
    }

    if (
      text.includes('id="allResultTableBody"') ||
      text.includes('chiTietCT(') ||
      text.includes('downloadGNT(') ||
      (text.includes('Số tham chiếu/ Mã giao dịch') && text.includes('Số giấy nộp tiền') && text.includes('<tbody'))
    ) {
      return 'GNT_LIST';
    }

    if (
      text.includes('Tra cứu giấy nộp tiền') ||
      text.includes('traCuuChungTu()') ||
      text.includes('name="type_tax"') ||
      text.includes('Nộp tại Cổng eTax của TCT')
    ) {
      return 'GNT_QUERY_PAGE';
    }

    // 4. Plugin Gate THẬT: trang chỉ có modal kiểm tra plugin, không có dữ liệu
    // (đã loại trừ ở trên vì data pages luôn return sớm)
    if (
      text.includes('checkInstall(8768)') ||
      text.includes('corpPluginProc') ||
      text.includes('Hệ thống đang thực hiện kiểm tra bản cập nhật')
    ) {
      return 'PLUGIN_GATE';
    }

    // 5. Lỗi hệ thống hoặc error page
    if (
      text.includes('error_page.jsp') ||
      text.includes('Đã có lỗi hệ thống xảy ra') ||
      text.includes('HTTP Status 500') ||
      text.includes('HTTP Status 404')
    ) {
      return 'PORTAL_ERROR';
    }

    return 'UNKNOWN';
  }
}

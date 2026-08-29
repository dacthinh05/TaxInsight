export const PORTAL_CONFIG = {
  BASE_URL: 'https://dichvucong.gdt.gov.vn',
  LOGIN_URL: 'https://dichvucong.gdt.gov.vn/tthc/login',
  LOGIN_API: 'https://dichvucong.gdt.gov.vn/tthc/loginLDAP',
  CAPTCHA_URL: 'https://dichvucong.gdt.gov.vn/tthc/login/getCaptcha',
  CAPTCHA_SEARCH_URL: 'https://dichvucong.gdt.gov.vn/tthc/login/getCaptcha',
  HOME_URL: 'https://dichvucong.gdt.gov.vn/tthc/home',
  TCHS_URL: 'https://dichvucong.gdt.gov.vn/tthc/tchs',
  SEARCH_API: 'https://dichvucong.gdt.gov.vn/tthc/ho-so/search',
  VALIDATE_TKHAI_API: 'https://dichvucong.gdt.gov.vn/tthc/tchs/validateIdTkhai',
  DOWNLOAD_API: 'https://dichvucong.gdt.gov.vn/tthc/tchs/downloadhoso',
  // Form fallback được render trực tiếp trên trang chi tiết hồ sơ.
  DOWNLOAD_FORM_API: 'https://dichvucong.gdt.gov.vn/tthc/downloadhoso',
  // Luồng tải từng tài liệu đính kèm được chính trang chi tiết hồ sơ sử dụng.
  ATTACHMENT_LIST_API: 'https://dichvucong.gdt.gov.vn/tthc/tchs/data-tai-lieu-dkem',
  ATTACHMENT_DOWNLOAD_API: 'https://dichvucong.gdt.gov.vn/tthc/tchs/download-tai-lieu-dkem',
  // Nhánh tải hồ sơ Thuế Điện Tử (isThueDienTu=true): /downloadhoso-tdt?loaiTraCuu=<value>
  DOWNLOAD_TDT_API: 'https://dichvucong.gdt.gov.vn/tthc/tchs/downloadhoso-tdt',
  DETAIL_FILE_URL: 'https://dichvucong.gdt.gov.vn/tthc/tchs/files/detail',
  // ─── Phân hệ Giấy Nộp Tiền (eTax SSO & GNT) ──────────────────────────────
  SSO_REDIRECT_API: 'https://dichvucong.gdt.gov.vn/tthc/sso/redirect-to-service',
  ETAX_BASE_URL: 'https://thuedientu.gdt.gov.vn',
  ETAX_REQUEST_API: 'https://thuedientu.gdt.gov.vn/etaxnnt/Request',
  // Nhóm giấy nộp tiền gửi lên tham số type_tax khi tra cứu ('01' = GNT vào NSNN).
  // Nếu portal bổ sung nhóm khác (02...) cần mở rộng thành danh sách và gom nhiều đợt tra cứu.
  GNT_TYPE_TAX: '01',
  // ─────────────────────────────────────────────────────────────────────────
  // JavaScript production của DVC gọi onChangePage(page, 10) và gửi field
  // `size=10`. Dùng 20/pageSize khiến fallback xác định trang cuối sai khi
  // fragment HTML thiếu/đổi phần tổng trang.
  DEFAULT_PAGE_SIZE: 10,
  MAX_PAGE_RESULTS_SUSPICIOUS_THRESHOLD: 10,
  REQUEST_TIMEOUT_MS: 30000,
  // Cổng Thuế hiện rate-limit endpoint tải rất gắt (thực tế request thứ ba
  // trong < 1 giây đã trả 429). Tải tuần tự để mỗi hồ sơ có đủ ngân sách thử
  // đúng ID/payload mà không bị worker khác chiếm hạn mức.
  DOWNLOAD_CONCURRENCY: 1,
  MAX_RETRIES: 3,
  RETRY_BASE_DELAY_MS: 2000
};

export const PROCEDURE_MAPPING: Record<string, { type: 'VAT' | 'PIT' | 'CIT' | 'FCT' | 'HOUSE_LAND' | 'REFUND' | 'REPORT' | 'OTHER'; standardName: string }> = {
  // ─── GTGT (VAT) ──────────────────────────────────────────────────────────
  '1.007014': { type: 'VAT', standardName: '01/GTGT - Tờ khai thuế GTGT khấu trừ' },
  '1.007015': { type: 'VAT', standardName: '04/GTGT - Tờ khai thuế GTGT trực tiếp' },
  '1.007016': { type: 'VAT', standardName: '02/GTGT - Tờ khai thuế GTGT dự án đầu tư' },
  '1.008324': { type: 'VAT', standardName: '02/GTGT - Tờ khai thuế GTGT dự án đầu tư' },
  '01/GTGT': { type: 'VAT', standardName: '01/GTGT - Tờ khai thuế GTGT khấu trừ' },
  '02/GTGT': { type: 'VAT', standardName: '02/GTGT - Tờ khai thuế GTGT dự án' },
  '03/GTGT': { type: 'VAT', standardName: '03/GTGT - Tờ khai thuế GTGT tỷ lệ %' },
  '04/GTGT': { type: 'VAT', standardName: '04/GTGT - Tờ khai thuế GTGT trực tiếp' },
  '05/GTGT': { type: 'VAT', standardName: '05/GTGT - Tờ khai thuế GTGT vãng lai' },

  // ─── HOÀN THUẾ (REFUND) ──────────────────────────────────────────────────
  '1.007037': { type: 'REFUND', standardName: 'Hoàn thuế GTGT của doanh nghiệp, tổ chức' },
  '1.007039': { type: 'REFUND', standardName: 'Hoàn thuế GTGT đối với hàng hóa, dịch vụ xuất khẩu' },

  // ─── TNCN (PIT) ──────────────────────────────────────────────────────────
  '1.008347': { type: 'PIT', standardName: '05/KK-TNCN - Tờ khai quyết toán thuế TNCN' },
  '2.002235': { type: 'PIT', standardName: '05/KK-TNCN - Tờ khai thuế TNCN khấu trừ' },
  '2.002237': { type: 'PIT', standardName: 'Khai thuế TNCN trực tiếp với CQT' },
  '2.002233': { type: 'PIT', standardName: '02/QTT-TNCN - Quyết toán thuế TNCN' },
  '1.008309': { type: 'PIT', standardName: '05/QTT-TNCN - Quyết toán thuế TNCN' },
  '1.008340': { type: 'PIT', standardName: '06/KK-TNCN - Tờ khai khấu trừ thuế TNCN' },
  '05/KK-TNCN': { type: 'PIT', standardName: '05/KK-TNCN - Tờ khai khấu trừ thuế TNCN' },
  '02/KK-TNCN': { type: 'PIT', standardName: '02/KK-TNCN - Tờ khai quyết toán thuế TNCN' },
  '02/QTT-TNCN': { type: 'PIT', standardName: '02/QTT-TNCN - Quyết toán thuế TNCN' },
  '05/QTT-TNCN': { type: 'PIT', standardName: '05/QTT-TNCN - Quyết toán thuế TNCN' },
  '02TH': { type: 'OTHER', standardName: '02TH - Bảng tổng hợp đăng ký người phụ thuộc' },
  '1.008346': { type: 'CIT', standardName: '03/TNDN - Quyết toán thuế TNDN' },
  '1.007026': { type: 'CIT', standardName: '04/TNDN - Khai thuế TNDN theo tỷ lệ' },
  '1.008335': { type: 'CIT', standardName: 'Khai thuế TNDN chuyển nhượng BĐS' },
  '03/TNDN': { type: 'CIT', standardName: '03/TNDN - Tờ khai quyết toán thuế TNDN' },
  '02/TNDN': { type: 'CIT', standardName: '02/TNDN - Tờ khai thuế TNDN' },
  '04/TNDN': { type: 'CIT', standardName: '04/TNDN - Tờ khai thuế TNDN' },
  '03-1A/TNDN': { type: 'CIT', standardName: '03-1A/TNDN - Phụ lục KQ HĐSXKD' },

  // ─── THUẾ NHÀ THẦU NƯỚC NGOÀI (FCT) ─────────────────────────────────────
  '1.008333': { type: 'FCT', standardName: '01/NTNN - Thuế nhà thầu nước ngoài' },
  '1.008344': { type: 'FCT', standardName: '02/NTNN - Quyết toán thuế nhà thầu nước ngoài' },
  '01/NTNN': { type: 'FCT', standardName: '01/NTNN - Tờ khai thuế nhà thầu nước ngoài' },
  '02/NTNN': { type: 'FCT', standardName: '02/NTNN - Quyết toán thuế nhà thầu nước ngoài' },
  '03/NTNN': { type: 'FCT', standardName: '03/NTNN - Tờ khai thuế nhà thầu nước ngoài' },
  '04/NTNN': { type: 'FCT', standardName: '04/NTNN - Tờ khai thuế nhà thầu nước ngoài' },
  '01/NTNN-TT80': { type: 'FCT', standardName: '01/NTNN - Tờ khai thuế nhà thầu nước ngoài' },
  // ─── THUẾ NHÀ ĐẤT & PHI NÔNG NGHIỆP (HOUSE_LAND) ────────────────────────
  '01/TK-SDDPNN': { type: 'HOUSE_LAND', standardName: '01/TK-SDDPNN - Khai thuế SD đất phi nông nghiệp' },
  '02/TK-SDDPNN': { type: 'HOUSE_LAND', standardName: '02/TK-SDDPNN - Khai tổng hợp thuế SDĐPNN' },
  '01/TM-TMD': { type: 'HOUSE_LAND', standardName: 'Khai tiền thuê đất, thuê mặt nước' },

  // ─── THỦ TỤC & BÁO CÁO & KHÁC ──────────────────────────────────────────
  '1.008500': { type: 'OTHER', standardName: '20-ĐK-TH-TCT - Đăng ký người phụ thuộc' },
  '1.008503': { type: 'OTHER', standardName: 'Thay đổi thông tin đăng ký thuế' },
  '1.008498': { type: 'OTHER', standardName: 'Đăng ký thuế lần đầu' },
  '20-ĐK-TH-TCT': { type: 'OTHER', standardName: '20-ĐK-TH-TCT - Đăng ký người phụ thuộc' },
  'BC26/AC': { type: 'REPORT', standardName: 'BC26/AC - Báo cáo tình hình sử dụng hóa đơn' },
  'BCTC': { type: 'REPORT', standardName: 'BCTC - Báo cáo tài chính' },
  'TT200': { type: 'REPORT', standardName: 'TT200 - Bộ Báo cáo tài chính' },
  'TT133': { type: 'REPORT', standardName: 'TT133 - Bộ Báo cáo tài chính' }
};

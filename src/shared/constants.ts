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
  // Nhánh tải hồ sơ Thuế Điện Tử (isThueDienTu=true): /downloadhoso-tdt?loaiTraCuu=<value>
  DOWNLOAD_TDT_API: 'https://dichvucong.gdt.gov.vn/tthc/tchs/downloadhoso-tdt',
  DETAIL_FILE_URL: 'https://dichvucong.gdt.gov.vn/tthc/tchs/files/detail',
  // ─── Phân hệ Giấy Nộp Tiền (eTax SSO & GNT) ──────────────────────────────
  SSO_REDIRECT_API: 'https://dichvucong.gdt.gov.vn/tthc/sso/redirect-to-service',
  ETAX_BASE_URL: 'https://thuedientu.gdt.gov.vn',
  ETAX_REQUEST_API: 'https://thuedientu.gdt.gov.vn/etaxnnt/Request',
  // ─────────────────────────────────────────────────────────────────────────
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_RESULTS_SUSPICIOUS_THRESHOLD: 20, // Server GDT giới hạn cứng 20 bản ghi/trang -> Nếu đủ 20 bản ghi thì bắt buộc tự động phân rã tháng
  REQUEST_TIMEOUT_MS: 30000,
  DOWNLOAD_CONCURRENCY: 2,
  MAX_RETRIES: 3,
  RETRY_BASE_DELAY_MS: 2000
};

export const PROCEDURE_MAPPING: Record<string, { type: 'VAT' | 'PIT' | 'CIT' | 'FCT' | 'REFUND' | 'REPORT' | 'OTHER'; standardName: string }> = {
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

  // ─── TNDN (CIT) ──────────────────────────────────────────────────────────
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

  // ─── THỦ TỤC & BÁO CÁO & KHÁC ──────────────────────────────────────────
  '1.008500': { type: 'OTHER', standardName: '20-ĐK-TH-TCT - Đăng ký người phụ thuộc' },
  '1.008503': { type: 'OTHER', standardName: 'Thay đổi thông tin đăng ký thuế' },
  '1.008498': { type: 'OTHER', standardName: 'Đăng ký thuế lần đầu' },
  '20-ĐK-TH-TCT': { type: 'OTHER', standardName: '20-ĐK-TH-TCT - Đăng ký người phụ thuộc' },
  'BC26/AC': { type: 'REPORT', standardName: 'BC26/AC - Báo cáo tình hình sử dụng hóa đơn' },
  'BCTC': { type: 'REPORT', standardName: 'BCTC - Báo cáo tài chính' }
};

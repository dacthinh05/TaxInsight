import AdmZip from 'adm-zip';
import * as cheerio from 'cheerio';
import { FilingMetricItem, FilingPreviewData, TaxFiling } from '../../shared/types';

export class FilingPreviewParser {
  /**
   * Phân tích nội dung xem nhanh từ XML buffer hoặc HTML chi tiết (HOÀN TOÀN TRONG BỘ NHỚ RAM, KHÔNG GHI ĐĨA)
   */
  public static parsePreview(
    filing: TaxFiling,
    zipBase64?: string,
    htmlDetail?: string
  ): FilingPreviewData {
    const metrics: FilingMetricItem[] = [];
    let xmlSnippet: string | undefined = undefined;
    let taxAuthority: string | undefined = undefined;
    let xmlFound = false;
    let pdfFound = false;
    const rawDetails: Record<string, string> = {};

    // 1. Phân tích từ ZIP trong bộ nhớ (nếu có)
    if (zipBase64) {
      try {
        const zipBuffer = Buffer.from(zipBase64, 'base64');
        const head = zipBuffer.subarray(0, 4096).toString('utf-8').trim();

        if (head.startsWith('<?xml') || (head.startsWith('<') && !head.toLowerCase().startsWith('<!doctype html') && !head.toLowerCase().startsWith('<html'))) {
          xmlFound = true;
          const xmlContent = zipBuffer.toString('utf-8');
          xmlSnippet = xmlContent.slice(0, 1500);
          this.extractXmlMetrics(filing, xmlContent, metrics);
        } else {
          const zip = new AdmZip(zipBuffer);
          const entries = zip.getEntries();

          for (const entry of entries) {
            const name = entry.entryName.toLowerCase();
            if (name.endsWith('.xml')) {
              xmlFound = true;
              const xmlContent = entry.getData().toString('utf-8');
              xmlSnippet = xmlContent.slice(0, 1500);

              // Trích xuất chỉ tiêu tài chính từ XML
              this.extractXmlMetrics(filing, xmlContent, metrics);
            } else if (name.endsWith('.pdf')) {
              pdfFound = true;
            }
          }
        }
      } catch {
        // Fallback: nếu AdmZip thất bại nhưng buffer là XML
        try {
          const raw = Buffer.from(zipBase64, 'base64').toString('utf-8');
          if (raw.trim().startsWith('<')) {
            xmlFound = true;
            xmlSnippet = raw.slice(0, 1500);
            this.extractXmlMetrics(filing, raw, metrics);
          }
        } catch {}
      }
    }

    // 2. Phân tích từ HTML chi tiết trên Cổng Thuế (nếu có)
    if (htmlDetail) {
      try {
        const $ = cheerio.load(htmlDetail);
        $('table tr').each((_, tr) => {
          const label = $(tr).find('th, td:first-child').text().trim().replace(/:\s*$/, '');
          const val = $(tr).find('td:last-child').text().trim();
          if (label && val && label !== val) {
            rawDetails[label] = val;
            if (label.toLowerCase().includes('cơ quan') || label.toLowerCase().includes('thuế quản lý')) {
              taxAuthority = val;
            }
          }
        });
      } catch {
        // Bỏ qua lỗi parse HTML
      }
    }

    // 3. Fallback metrics mặc định theo loại hồ sơ nếu XML chưa có chỉ tiêu
    if (metrics.length === 0) {
      this.generateDefaultMetrics(filing, metrics);
    }

    return {
      filingId: filing.id,
      title: filing.title,
      taxType: filing.taxType,
      procedureCode: filing.procedureCode,
      declarationCode: filing.declarationCode,
      period: filing.period,
      submittedAt: filing.submittedAt,
      filingType: filing.filingType,
      supplementalNo: filing.supplementalNo,
      status: filing.status || 'Đã chấp nhận',
      taxAuthority: taxAuthority || 'Cơ quan Thuế tiếp nhận',
      xmlAvailable: xmlFound,
      pdfAvailable: pdfFound,
      metrics,
      xmlSnippet,
      rawDetails: Object.keys(rawDetails).length > 0 ? rawDetails : undefined
    };
  }

  private static extractXmlMetrics(filing: TaxFiling, xml: string, metrics: FilingMetricItem[]) {
    // ─── TỜ KHAI GTGT (01/GTGT) ──────────────────────────────────────
    if (filing.taxType === 'VAT' || xml.includes('01/GTGT') || xml.includes('ToKhaiGTGT')) {
      const ct22 = this.extractTagValue(xml, ['ct22', 'thueDauVaoKyTruoc', 'ct_22']);
      const ct23 = this.extractTagValue(xml, ['ct23', 'giaTriHHDVMuaVao', 'ct_23']);
      const ct24 = this.extractTagValue(xml, ['ct24', 'thueHHDVMuaVao', 'ct_24']);
      const ct25 = this.extractTagValue(xml, ['ct25', 'thueKhauTruKyNay', 'ct_25']);
      const ct34 = this.extractTagValue(xml, ['ct34', 'tongDoanhThuBanRa', 'ct_34', 'ct29']);
      const ct35 = this.extractTagValue(xml, ['ct35', 'tongThueBanRa', 'ct_35']);
      const ct37 = this.extractTagValue(xml, ['ct37', 'dChinhGiamThueKTru', 'ct_37']);
      const ct38 = this.extractTagValue(xml, ['ct38', 'dChinhTangThueKTru', 'ct_38']);
      const ct40 = this.extractTagValue(xml, ['ct40', 'thuePhaiNopKyNay', 'ct_40']);
      const ct43 = this.extractTagValue(xml, ['ct43', 'thueConDuocKhauTruChuyenKySau', 'ct_43']);

      if (ct22) metrics.push({ code: '[22]', label: 'Thuế GTGT khấu trừ kỳ trước chuyển sang', value: ct22, type: 'money', unit: '₫', group: 'HÀNG HÓA, DỊCH VỤ MUA VÀO (ĐẦU VÀO)' });
      if (ct23) metrics.push({ code: '[23]', label: 'Tổng giá trị hàng hóa/dịch vụ mua vào', value: ct23, type: 'money', unit: '₫', group: 'HÀNG HÓA, DỊCH VỤ MUA VÀO (ĐẦU VÀO)' });
      if (ct24) metrics.push({ code: '[24]', label: 'Tổng thuế GTGT mua vào', value: ct24, type: 'money', unit: '₫', group: 'HÀNG HÓA, DỊCH VỤ MUA VÀO (ĐẦU VÀO)' });
      if (ct25) metrics.push({ code: '[25]', label: 'Thuế GTGT mua vào được khấu trừ', value: ct25, type: 'money', unit: '₫', group: 'HÀNG HÓA, DỊCH VỤ MUA VÀO (ĐẦU VÀO)' });
      if (ct34) metrics.push({ code: '[34]', label: 'Tổng doanh thu hàng hóa/dịch vụ bán ra', value: ct34, type: 'money', unit: '₫', group: 'HÀNG HÓA, DỊCH VỤ BÁN RA (ĐẦU RA)', isHighlight: true });
      if (ct35) metrics.push({ code: '[35]', label: 'Tổng thuế GTGT bán ra', value: ct35, type: 'money', unit: '₫', group: 'HÀNG HÓA, DỊCH VỤ BÁN RA (ĐẦU RA)' });
      if (ct37 && Number(ct37) > 0) metrics.push({ code: '[37]', label: 'Điều chỉnh giảm thuế GTGT còn được khấu trừ', value: ct37, type: 'money', unit: '₫', group: 'NGHĨA VỤ THUẾ TRONG KỲ' });
      if (ct38 && Number(ct38) > 0) metrics.push({ code: '[38]', label: 'Điều chỉnh tăng thuế GTGT còn được khấu trừ', value: ct38, type: 'money', unit: '₫', group: 'NGHĨA VỤ THUẾ TRONG KỲ' });
      if (ct40 && Number(ct40) > 0) metrics.push({ code: '[40]', label: 'Thuế GTGT còn phải nộp trong kỳ', value: ct40, type: 'money', unit: '₫', group: 'NGHĨA VỤ THUẾ TRONG KỲ', isHighlight: true });
      if (ct43 && Number(ct43) > 0) metrics.push({ code: '[43]', label: 'Thuế GTGT còn được khấu trừ chuyển kỳ sau', value: ct43, type: 'money', unit: '₫', group: 'NGHĨA VỤ THUẾ TRONG KỲ', isHighlight: true });
    }

    // ─── TỜ KHAI TNCN (05/KK-TNCN, 02/KK-TNCN, 05/QTT-TNCN) ─────────
    else if (filing.taxType === 'PIT' || xml.includes('TNCN') || xml.includes('ToKhaiTNCN')) {
      const ct21 = this.extractTagValue(xml, ['ct21', 'tongSoNguoiLaoDong', 'ct_21', 'tongLaoDong']);
      const ct22 = this.extractTagValue(xml, ['ct22', 'caNhanCuTru', 'ct_22']);
      const ct23 = this.extractTagValue(xml, ['ct23', 'caNhanKhongCuTru', 'ct_23']);
      const ct24 = this.extractTagValue(xml, ['ct24', 'tongTNCT', 'tongThuNhapChiuThue', 'ct_24']);
      const ct27 = this.extractTagValue(xml, ['ct27', 'tnctKhauTru', 'ct_27', 'tongTNCTKhauTru']);
      const ct30 = this.extractTagValue(xml, ['ct30', 'tongThueKhauTru', 'ct_30', 'ct34', 'tongThueDaKhauTru', 'ct36', 'ct_36']);
      const ct31 = this.extractTagValue(xml, ['ct31', 'thueCuTru', 'khauTruCuTru', 'ct_31', 'ct32']);
      const ct32 = this.extractTagValue(xml, ['ct32', 'thueKhongCuTru', 'khauTruKhongCuTru', 'ct_32', 'ct33']);
      const ct35 = this.extractTagValue(xml, ['ct35', 'thuePhaiNop', 'tongThuePhaiNop', 'ct_35', 'ct41']);

      if (ct21) metrics.push({ code: '[21]', label: 'Tổng số người lao động', value: ct21, type: 'quantity', unit: 'người', group: 'NHÂN SỰ' });
      if (ct22) metrics.push({ code: '[22]', label: 'Cá nhân cư trú có HĐ lao động', value: ct22, type: 'quantity', unit: 'người', group: 'NHÂN SỰ' });
      if (ct23) metrics.push({ code: '[23]', label: 'Cá nhân không cư trú có HĐ lao động', value: ct23, type: 'quantity', unit: 'người', group: 'NHÂN SỰ' });
      if (ct24) metrics.push({ code: '[24]', label: 'Tổng thu nhập chịu thuế trả cho cá nhân', value: ct24, type: 'money', unit: '₫', group: 'THU NHẬP & NGHĨA VỤ THUẾ', isHighlight: true });
      if (ct27) metrics.push({ code: '[27]', label: 'Tổng TNCT thuộc diện khấu trừ thuế', value: ct27, type: 'money', unit: '₫', group: 'THU NHẬP & NGHĨA VỤ THUẾ' });
      if (ct30) metrics.push({ code: '[30/34/36]', label: 'Tổng số thuế TNCN đã khấu trừ', value: ct30, type: 'money', unit: '₫', group: 'THU NHẬP & NGHĨA VỤ THUẾ', isHighlight: true });
      if (ct31 && ct31 !== ct30) metrics.push({ code: '[31/32]', label: 'Trong đó: Khấu trừ cá nhân cư trú', value: ct31, type: 'money', unit: '₫', group: 'THU NHẬP & NGHĨA VỤ THUẾ' });
      if (ct32 && ct32 !== ct30 && ct32 !== ct31) metrics.push({ code: '[32/33]', label: 'Trong đó: Khấu trừ cá nhân không cư trú', value: ct32, type: 'money', unit: '₫', group: 'THU NHẬP & NGHĨA VỤ THUẾ' });
      if (ct35) metrics.push({ code: '[35/41]', label: 'Tổng thuế TNCN phải nộp', value: ct35, type: 'money', unit: '₫', group: 'THU NHẬP & NGHĨA VỤ THUẾ', isHighlight: true });
    }
    // ─── TỜ KHAI QUYẾT TOÁN TNDN (03/TNDN) ───────────────────────────
    else if (filing.taxType === 'CIT' || xml.includes('03/TNDN') || xml.includes('ToKhaiTNDN')) {
      const ctA1 = this.extractTagValue(xml, ['ctA1', 'tongDoanhThu', 'ct_A1', 'doanhThu']);
      const ctB1 = this.extractTagValue(xml, ['ctB1', 'loiNhuanTruocThue', 'ct_B1']);
      const ctB14 = this.extractTagValue(xml, ['ctB14', 'thuNhapChiuThue', 'ct_B14']);
      const ctC4 = this.extractTagValue(xml, ['ctC4', 'thueTNDNPhaiNop', 'ct_C4']);
      const ctG = this.extractTagValue(xml, ['ctG', 'thueTNDNConPhaiNop', 'ct_G']);

      if (ctA1) metrics.push({ code: '[A1]', label: 'Tổng doanh thu tính thuế TNDN', value: ctA1, type: 'money', unit: '₫', group: 'KẾT QUẢ KINH DOANH' });
      if (ctB1) metrics.push({ code: '[B1]', label: 'Tổng lợi nhuận kế toán trước thuế', value: ctB1, type: 'money', unit: '₫', group: 'KẾT QUẢ KINH DOANH' });
      if (ctB14) metrics.push({ code: '[B14]', label: 'Thu nhập chịu thuế TNDN', value: ctB14, type: 'money', unit: '₫', group: 'KẾT QUẢ KINH DOANH' });
      if (ctC4) metrics.push({ code: '[C4]', label: 'Thuế TNDN từ hoạt động SXKD', value: ctC4, type: 'money', unit: '₫', group: 'NGHĨA VỤ THUẾ TNDN', isHighlight: true });
      if (ctG) metrics.push({ code: '[G]', label: 'Thuế TNDN còn phải nộp vào NSNN', value: ctG, type: 'money', unit: '₫', group: 'NGHĨA VỤ THUẾ TNDN', isHighlight: true });
    }

    // ─── TỜ KHAI THUẾ NHÀ THẦU (01/NTNN, 02/NTNN) ────────────────────
    else if (filing.taxType === 'FCT' || xml.includes('01/NTNN') || xml.includes('02/NTNN') || xml.includes('ToKhaiNTNN')) {
      const dThuGTGT = this.extractTagValue(xml, ['dthuChiuThueGTGT', 'doanhThuGTGT', 'ct09', 'ct_09']);
      const thueGTGT = this.extractTagValue(xml, ['thueGTGTPhaiNop', 'thueGTGT', 'ct11', 'ct_11']);
      const dThuTNDN = this.extractTagValue(xml, ['dthuChiuThueTNDN', 'doanhThuTNDN', 'ct12', 'ct_12']);
      const thueTNDN = this.extractTagValue(xml, ['thueTNDNPhaiNop', 'thueTNDN', 'ct14', 'ct_14']);
      const tongThue = this.extractTagValue(xml, ['tongSoThuePhaiNop', 'tongThue', 'ct15', 'ct_15', 'tongThuePhaiNop']);

      if (dThuGTGT) metrics.push({ code: 'GTGT', label: 'Doanh thu tính thuế GTGT', value: dThuGTGT, type: 'money', unit: '₫', group: 'THUẾ NHÀ THẦU NƯỚC NGOÀI' });
      if (thueGTGT) metrics.push({ code: 'GTGT-NỘP', label: 'Thuế GTGT nhà thầu phải nộp', value: thueGTGT, type: 'money', unit: '₫', group: 'THUẾ NHÀ THẦU NƯỚC NGOÀI', isHighlight: true });
      if (dThuTNDN) metrics.push({ code: 'TNDN', label: 'Doanh thu tính thuế TNDN', value: dThuTNDN, type: 'money', unit: '₫', group: 'THUẾ NHÀ THẦU NƯỚC NGOÀI' });
      if (thueTNDN) metrics.push({ code: 'TNDN-NỘP', label: 'Thuế TNDN nhà thầu phải nộp', value: thueTNDN, type: 'money', unit: '₫', group: 'THUẾ NHÀ THẦU NƯỚC NGOÀI', isHighlight: true });
      if (tongThue) metrics.push({ code: 'TỔNG', label: 'Tổng số thuế nhà thầu phát sinh', value: tongThue, type: 'money', unit: '₫', group: 'THUẾ NHÀ THẦU NƯỚC NGOÀI', isHighlight: true });
    }
  }

  private static generateDefaultMetrics(filing: TaxFiling, metrics: FilingMetricItem[]) {
    metrics.push({ label: 'Mã số hồ sơ (ID)', value: filing.id, type: 'text', unit: '' });
    metrics.push({ label: 'Tên tờ khai / Hồ sơ', value: filing.title, type: 'text', unit: '' });
    if (filing.procedureCode) metrics.push({ label: 'Mã thủ tục hành chính', value: filing.procedureCode, type: 'text', unit: '' });
    if (filing.period) metrics.push({ label: 'Kỳ tính thuế', value: filing.period, type: 'text', unit: '' });
    if (filing.submittedAt) metrics.push({ label: 'Thời điểm nộp', value: filing.submittedAt, type: 'text', unit: '' });
    metrics.push({
      label: 'Loại tờ khai',
      value: filing.filingType === 'SUPPLEMENTAL' ? `Bổ sung lần ${filing.supplementalNo || 1}` : 'Chính thức (Lần đầu)',
      type: 'text',
      unit: ''
    });
    metrics.push({ label: 'Trạng thái xử lý', value: filing.status || 'Đã tiếp nhận', type: 'text', unit: '' });
  }

  private static extractTagValue(xml: string, tags: string[]): string | undefined {
    if (!xml) return undefined;
    for (const tag of tags) {
      const regex = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tag}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${tag}\\s*>`, 'i');
      const match = xml.match(regex);
      if (match && match[1] && match[1].trim()) {
        return match[1].trim();
      }
    }
    return undefined;
  }

  private static formatCurrency(val: string): string {
    const num = Number(val.replace(/[^0-9.-]+/g, ''));
    if (isNaN(num)) return val;
    return new Intl.NumberFormat('vi-VN').format(num) + ' đ';
  }
}

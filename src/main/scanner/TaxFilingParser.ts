import * as cheerio from "cheerio";
import { PROCEDURE_MAPPING } from "../../shared/constants";
import { parseFilingPeriod, resolvePeriodSupplementalSequences } from "../../shared/dateUtils";
import { FilingType, PeriodNormalized, TaxFiling, TaxType } from "../../shared/types";

export class TaxFilingParser {
  public static classifyTaxType(code?: string, title?: string, declarationCode?: string): TaxType {
    // 1. Kiểm tra mapping trực tiếp theo mã thủ tục
    if (code && PROCEDURE_MAPPING[code]) {
      return PROCEDURE_MAPPING[code].type;
    }
    // 2. Kiểm tra mapping theo mẫu tờ khai (vd: 01/GTGT, 05/KK-TNCN...)
    if (declarationCode && PROCEDURE_MAPPING[declarationCode]) {
      return PROCEDURE_MAPPING[declarationCode].type;
    }

    // 3. Chuẩn hóa không dấu cho chuỗi tổng hợp (code + title + declarationCode)
    const combined = `${code || ''} ${title || ''} ${declarationCode || ''}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd');

    // 3. Ưu tiên: Thủ tục Đăng ký thuế / Người phụ thuộc / Thay đổi thông tin (không phải tờ khai thuế)
    if (
      combined.includes('nguoi phu thuoc') ||
      combined.includes('dang ky thue') ||
      combined.includes('thay doi thong tin') ||
      combined.includes('20-dk') ||
      code === '1.008500' ||
      code === '1.008503' ||
      code === '1.008498'
    ) {
      return 'OTHER';
    }

    // 4. Ưu tiên: Hoàn thuế tách riêng thành nhóm độc lập
    if (
      code === '1.007037' ||
      code === '1.007039' ||
      combined.includes('hoan thue') ||
      combined.includes('hoan-thue')
    ) {
      return 'REFUND';
    }

    // Acronym tiếng Anh (VAT/PIT/CIT) chỉ nhận diện khi viết HOA trong chuỗi
    // GỐC: tiếng Việt không viết hoa giữa từ, nên "Vật tư" (→ "vat tu" sau bỏ
    // dấu) không bao giờ có 'VAT' hoa. Trước đây includes('vat') khớp nhầm cả
    // "vật tư" khiến tờ khai REPORT/CIT/OTHER bị misclassify thành VAT.
    const originalCombined = `${code || ''} ${title || ''} ${declarationCode || ''}`;
    const hasAcronym = (acr: string): boolean =>
      new RegExp(`(^|[^A-Za-z0-9])${acr}([^A-Za-z0-9]|$)`).test(originalCombined);

    if (
      combined.includes('gtgt') ||
      combined.includes('gia tri gia tang') ||
      hasAcronym('VAT') ||
      combined.includes('01/gtgt') ||
      combined.includes('02/gtgt') ||
      combined.includes('03/gtgt') ||
      combined.includes('04/gtgt')
    ) {
      return 'VAT';
    }

    if (
      combined.includes('tncn') ||
      combined.includes('thu nhap ca nhan') ||
      hasAcronym('PIT') ||
      combined.includes('05/kk-tncn') ||
      combined.includes('02/kk-tncn') ||
      combined.includes('02/qtt-tncn') ||
      combined.includes('05/qtt-tncn')
    ) {
      return 'PIT';
    }

    if (
      combined.includes('tndn') ||
      combined.includes('thu nhap doanh nghiep') ||
      hasAcronym('CIT') ||
      combined.includes('03/tndn') ||
      combined.includes('02/tndn') ||
      combined.includes('04/tndn')
    ) {
      return 'CIT';
    }

    // Thuế Nhà Thầu Nước Ngoài (FCT - 01/NTNN, 02/NTNN, 03/NTNN, 04/NTNN, 1.008344, 1.008333...)
    if (
      combined.includes('nha thau') ||
      combined.includes('ntnn') ||
      combined.includes('fct') ||
      combined.includes('01/ntnn') ||
      combined.includes('02/ntnn') ||
      combined.includes('03/ntnn') ||
      combined.includes('04/ntnn') ||
      code === '1.008344' ||
      code === '1.008333'
    ) {
      return 'FCT';
    }

    // Thuế Nhà đất & các khoản thu về đất (HOUSE_LAND - thuế nhà đất, SDĐPNN, tiền sử dụng/thuê đất)
    if (
      combined.includes('nha dat') ||
      combined.includes('su dung dat') ||
      combined.includes('tien su dung dat') ||
      combined.includes('thue dat') ||
      combined.includes('thue mat nuoc') ||
      combined.includes('sddpnn') ||
      combined.includes('/sddpnn')
    ) {
      return 'HOUSE_LAND';
    }

    if (
      combined.includes('bao cao') ||
      combined.includes('thong bao') ||
      combined.includes('bctc') ||
      combined.includes('bc26') ||
      combined.includes('hoa don') ||
      combined.includes('bien lai')
    ) {
      return 'REPORT';
    }

    return 'OTHER';
  }

  public static parseFilingType(
    text?: string,
    procedureCode?: string,
    declarationCode?: string,
    title?: string
  ): { filingType: FilingType; supplementalNo?: number; isSequenceInferred?: boolean } {
    if (!text && !procedureCode && !declarationCode && !title) {
      return { filingType: 'UNKNOWN' };
    }

    const combined = `${text || ''} ${procedureCode || ''} ${declarationCode || ''} ${title || ''}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'd')
      .trim();

    if (!combined) {
      return { filingType: 'UNKNOWN' };
    }

    // 1. Khai bổ sung (1.008327 hoặc có chữ bổ sung / BS)
    // Số lần BS phải đứng ngay sau "bổ sung/bs [lần]" và KHÔNG được là phần đầu
    // của một mã tài liệu ("bổ sung 05/QTT-TNCN" → 5, "bs 12/2026" → 12 là BẮT
    // SAI — số theo sau bởi '/' là mã tờ khai, không phải số lần).
    const bsNumberMatch = combined.match(/(?:bo\s*sung|\bbs\b)(?:\s*lan|\s*l)?\s*(\d{1,2})(?![/\d])/i);
    if (bsNumberMatch) {
      return { filingType: 'SUPPLEMENTAL', supplementalNo: parseInt(bsNumberMatch[1], 10), isSequenceInferred: false };
    }
    if (combined.includes('bo sung') || /\bbs\b/i.test(combined) || combined.includes('1.008327')) {
      return { filingType: 'SUPPLEMENTAL' };
    }

    // 2. Hoàn thuế
    if (combined.includes('hoan thue') || combined.includes('1.007037') || combined.includes('1.007039')) {
      return { filingType: 'REFUND' };
    }

    // 3. Quyết toán thuế (03/TNDN, 05/QTT-TNCN, 02/QTT-TNCN, 1.008346, 1.008309, 2.002233...)
    // Chú ý: Tờ khai khấu trừ/kê khai (05/KK-TNCN, 02/KK-TNCN, 06/KK-TNCN, 1.008347, 2.002235)
    // TUYỆT ĐỐI KHÔNG phải là quyết toán thuế (FINALIZATION).
    const isExplicitKk =
      /0[256]\/kk|kk-tncn/i.test(declarationCode || '') ||
      combined.includes('05/kk') ||
      combined.includes('02/kk') ||
      combined.includes('06/kk') ||
      combined.includes('1.008347') ||
      combined.includes('2.002235');

    if (
      !isExplicitKk && (
        combined.includes('quyet toan') ||
        combined.includes('qtt') ||
        combined.includes('03/tndn') ||
        combined.includes('05/qtt-tncn') ||
        combined.includes('02/qtt-tncn') ||
        combined.includes('1.008346') ||
        combined.includes('1.008309') ||
        combined.includes('2.002233')
      )
    ) {
      return { filingType: 'FINALIZATION' };
    }

    // 4. Khai lần đầu / chính thức
    if (combined.includes('lan dau') || combined.includes('chinh thuc') || /\bct\b/i.test(combined)) {
      return { filingType: 'ORIGINAL' };
    }

    // 5. Nếu là các thủ tục hành chính chung chung không rõ kỳ nộp
    if (combined.includes('thu tuc') || combined.includes('dieu chinh thong tin') || combined.includes('thay doi')) {
      return { filingType: 'UNKNOWN' };
    }

    return { filingType: 'PERIODIC' };
  }

  public static parseJsonSearchResults(data: unknown): TaxFiling[] {
    const filings: TaxFiling[] = [];
    if (!data) return filings;
    let items: any[] = [];
    if (Array.isArray(data)) {
      items = data;
    } else if (typeof data === "object" && data !== null) {
      const obj = data as any;
      if (Array.isArray(obj.data)) items = obj.data;
      else if (Array.isArray(obj.items)) items = obj.items;
      else if (Array.isArray(obj.rows)) items = obj.rows;
      else if (Array.isArray(obj.content)) items = obj.content;
      else if (Array.isArray(obj.list)) items = obj.list;
    }
    for (const item of items) {
      const id = item.idTKhai || item.maHoSo || item.id || item.maGiaoDich;
      if (!id) continue;
      const title = item.tenTTHC || item.tenToKhai || item.title || item.tenHoSo || "H\u1ed3 s\u01a1 thu\u1ebf";
      const procedureCode = item.maTTHC || item.maNghiepVu || item.maToKhai;
      const declarationCode = item.maToKhai ? String(item.maToKhai).trim() : undefined;
      const taxType = this.classifyTaxType(procedureCode, title, declarationCode);
      const periodText = item.kyTinhThue || item.kyKeKhai || item.period || "";
      const periodNorm = parseFilingPeriod(periodText || title);
      const typeInfo = this.parseFilingType(item.lanNop || item.loaiToKhai || title, procedureCode, declarationCode, title);
      let submittedAt: string | undefined;
      const rawDate = item.ngayNop || item.ngayGui || item.ngayTiepNhan;
      if (rawDate && typeof rawDate === "string" && rawDate.match(/\d{1,2}\/\d{1,2}\/\d{4}/)) {
        submittedAt = rawDate.trim();
      }
      filings.push({
        id: String(id).trim(),
        procedureCode: procedureCode ? String(procedureCode).trim() : undefined,
        declarationCode: item.maToKhai ? String(item.maToKhai).trim() : undefined,
        title: String(title).trim(),
        taxType,
        period: periodNorm?.raw || (periodText && periodText !== 'Không xác định' && periodText !== '—' ? periodText : undefined),
        periodNormalized: periodNorm,
        submittedAt,
        filingType: typeInfo.filingType,
        supplementalNo: typeInfo.supplementalNo,
        status: item.trangThai || item.tenTrangThai || "\u0110\u00e3 ti\u1ebfp nh\u1eadn",
        downloadAvailable: true,
        isThueDienTu: item.isThueDienTu != null ? Boolean(item.isThueDienTu) : undefined,
        loaiTraCuu: item.loaiTraCuu || undefined,
        maTkhai: item.maTkhai || item.maTKhai || undefined,
        altIds: Array.isArray(item.altIds) ? item.altIds.map((v: unknown) => String(v).trim()).filter(Boolean) : undefined
      });
    }
    return resolvePeriodSupplementalSequences(filings);
  }

  public static parseHtmlSearchResults(html: string): TaxFiling[] {
    const filings: TaxFiling[] = [];
    if (!html || typeof html !== "string") return filings;
    const $ = cheerio.load(html);
    $("script, style, noscript").remove();

    $("tr").each((_, tr) => {
      const $tr = $(tr);
      if ($tr.find("th").length > 0) return;
      const $tds = $tr.find("td");
      if ($tds.length < 3) return;
      const rowHtml = $tr.html() || "";

      // ─── Thu THẬP MỌI dạng ID trên dòng (không chỉ 1): cùng một hồ sơ có thể
      // mang maHoSo ngắn (G12.18-YYMMDD-...) và mã tham chiếu dài
      // (000.701.18.G12-YYMMDD-...) — endpoint tải chỉ nhận đúng một trong hai.
      const idCandidates: string[] = [];

      const $withDataMaHoSo = $tr.find("[data-ma-ho-so], [data-mahoso], [data-id], [data-id-tkhai], [data-idtkhai], [data-id-hoso], [data-idhoso]").first();
      if ($withDataMaHoSo.length) {
        const dataId = (
          $withDataMaHoSo.attr("data-ma-ho-so") ||
          $withDataMaHoSo.attr("data-mahoso") ||
          $withDataMaHoSo.attr("data-id") ||
          $withDataMaHoSo.attr("data-id-tkhai") ||
          $withDataMaHoSo.attr("data-idtkhai") ||
          $withDataMaHoSo.attr("data-id-hoso") ||
          $withDataMaHoSo.attr("data-idhoso") ||
          ""
        ).trim();
        if (dataId) idCandidates.push(dataId);
      }

      const m = rowHtml.match(/(?:files\/detail\/|idTKhai=|maHoSo=|(?:downloadHoSo|downloadHoSoTdt|taiHoSo|chiTiet)\s*\(\s*['"]?)([0-9a-zA-Z.\-_]+)/i);
      if (m) idCandidates.push(m[1]);

      const m2 = rowHtml.match(/\b(\d{3}\.\d{3}\.\d{2}\.[A-Z0-9]+-\d+-\d+)\b/);
      if (m2) idCandidates.push(m2[1]);

      // Định dạng maHoSo TDT ngắn: G12.18-260720-00116072
      const mTdt = rowHtml.match(/\b(G\d{2}\.\d{2}-\d{6}-\d{6,12})\b/);
      if (mTdt) idCandidates.push(mTdt[1]);

      // Mã tờ khai (data-ma-tkhai trên nút thao tác, vd "864", "842") là metadata mẫu tờ khai,
      // được lưu vào filing.maTkhai, KHÔNG đưa vào idCandidates để tránh gửi nhầm ID số mẫu.
      const $maTkhai = $tr.find("[data-ma-tkhai]").first();
      const maTkhai = ($maTkhai.attr("data-ma-tkhai") || "").trim();

      // Chỉ dùng chuỗi số tổng quát khi dòng không có bất kỳ ID có cấu trúc
      // nào. Bản HTML thật có cả MST và maTkhai; đưa MST vào altIds tạo thêm
      // request sai và thường làm TNCN hết deadline trước khi tới khóa đúng.
      if (idCandidates.length === 0) {
        const m3 = rowHtml.match(/\b(\d{8,18})\b/);
        if (m3) idCandidates.push(m3[1]);
      }

      const uniqueIds = idCandidates.map(v => String(v).trim()).filter(Boolean)
        .filter((v, i, arr) => arr.indexOf(v) === i);
      const filingId = uniqueIds[0] || "";
      const altIds = uniqueIds.slice(1, 5);
      if (!filingId) return;

      let isThueDienTu: boolean | undefined;
      let loaiTraCuu: string | undefined;

      // Cờ thật của Cổng Thuế hiện nay: data-is-tdt="Y"/"N" trên các nút thao tác.
      // Trước đây chỉ tìm data-is-thue-dien-tu/... nên không đọc được, khiến mọi
      // hồ sơ rơi vào nhánh TDT trước (treo ~80s) thay vì nhánh chuẩn.
      const $tdtFlag = $tr.find("[data-is-tdt]").first();
      if ($tdtFlag.length) {
        const rawFlag = ($tdtFlag.attr("data-is-tdt") || "").trim().toUpperCase();
        if (rawFlag === "Y" || rawFlag === "N") {
          isThueDienTu = rawFlag === "Y";
        }
      }

      const $dl = $tr.find("[data-is-thue-dien-tu], [data-isthuedientu], [data-thue-dien-tu], [data-thuedientu], [data-tdt]").first();
      if (isThueDienTu === undefined && $dl.length) {
        const rawTdt = $dl.attr("data-is-thue-dien-tu") ||
          $dl.attr("data-isthuedientu") ||
          $dl.attr("data-thue-dien-tu") ||
          $dl.attr("data-thuedientu") ||
          $dl.attr("data-tdt") ||
          "";
        isThueDienTu = rawTdt.toLowerCase() === "true" || rawTdt === "1";
        loaiTraCuu = $dl.attr("data-loai-tra-cuu") || $dl.attr("data-loaitracuu") || undefined;
      }

      if (isThueDienTu === undefined) {
        if (
          /(?:downloadHoSo|taiHoSo)\s*\(\s*[^,]+,\s*['"]?(?:true|1)['"]?/i.test(rowHtml) ||
          /downloadHoSoTdt/i.test(rowHtml) ||
          /loaiTraCuu/i.test(rowHtml) ||
          /thue-dien-tu|thuedientu/i.test(rowHtml)
        ) {
          isThueDienTu = true;
        }
      }

      if (!loaiTraCuu) {
        const mLoai = rowHtml.match(/(?:downloadHoSo|downloadHoSoTdt)\s*\([^,]+,[^,]+,\s*['"]?([^'",\)\s]+)['"]?\)/i) ||
          rowHtml.match(/loaiTraCuu['"]?\s*[:=,]\s*['"]?(\d+)/i) ||
          rowHtml.match(/loaiTraCuu=([^&"'\s]+)/i);
        if (mLoai) loaiTraCuu = mLoai[1];
      }

      const cells: string[] = [];
      $tds.each((__, td) => {
        let text = $(td).text() || "";
        text = text.replace(/<!--[\s\S]*?-->/g, "").replace(/-->|<!--/g, "").trim();
        cells.push(text);
      });
      const rawRowText = cells.join(" ");

      // ─── 4. Tên thủ tục & Mã nghiệp vụ (Cột 3) ──────────────────────────
      let title = cells[3] || cells[2] || cells[1] || "Hồ sơ thuế";
      title = title.replace(/<!--[\s\S]*?-->/g, "").replace(/-->|<!--/g, "").trim();
      let procedureCode: string | undefined;
      const cm = title.match(/^([0-9.]+)\s*-\s*(.*)$/);
      if (cm) { procedureCode = cm[1].trim(); title = cm[2].trim(); }

      // ─── 5. Mẫu tờ khai (Cột 4: 01/GTGT, 03/TNDN, 05/KK-TNCN...) ─────────
      let declarationCode: string | undefined;
      const toKhaiText = cells[4] || "";
      const toKhaiMatch = toKhaiText.match(/^([0-9a-zA-Z\/\-_]+)/);
      if (toKhaiMatch) {
        declarationCode = toKhaiMatch[1].trim();
      }

      const taxType = this.classifyTaxType(procedureCode, title, declarationCode);

      // KHÔNG còn mặc định ép TNCN đi nhánh TDT: khi thiếu cờ data-is-tdt,
      // để undefined để luồng tải đi nhánh CHUẨN trước (TDT chỉ là fallback) —
      // trước đây nhánh TDT treo ~80s ăn hết deadline 60s khiến TNCN không bao
      // giờ kịp chạy nhánh chuẩn.

      // ─── 6. Kỳ kê khai (Cột 5: 07/2025, 2025, 01/2026...) ──────────────────
      let periodNorm: PeriodNormalized | undefined;
      let rawPeriod = "";

      // Ưu tiên 1: Cột 5 (Kỳ tính thuế)
      if (cells[5]) {
        periodNorm = parseFilingPeriod(cells[5]);
        if (periodNorm) rawPeriod = cells[5];
      }
      // Ưu tiên 2: Tiêu đề hoặc Cột 4
      if (!periodNorm && title) {
        periodNorm = parseFilingPeriod(title);
      }
      if (!periodNorm && cells[4]) {
        periodNorm = parseFilingPeriod(cells[4]);
      }

      // ─── 7. Lần nộp & Lần bổ sung (Cột 6: Loại tờ khai, Cột 7: Lần bổ sung) ─
      let typeInfo = this.parseFilingType(cells[6] || rawRowText, procedureCode, declarationCode, title);
      if (cells[7] && !isNaN(parseInt(cells[7], 10)) && parseInt(cells[7], 10) > 0) {
        typeInfo = {
          filingType: 'SUPPLEMENTAL',
          supplementalNo: parseInt(cells[7], 10)
        };
      }

      // ─── 8. Ngày nộp (Cột 10: 31/03/2026 15:02) ─────────────────────────────
      let submittedAt: string | undefined;
      if (cells[10] && cells[10].match(/\b\d{1,2}\/\d{1,2}\/\d{4}/)) {
        submittedAt = cells[10].trim();
      } else {
        for (const cell of cells) {
          const dm = cell.match(/\b\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{1,2}(?::\d{1,2})?)?\b/);
          if (dm) { submittedAt = dm[0]; break; }
        }
      }

      // ─── 9. Trạng thái xử lý (Cột 11: Đã chấp nhận, Đã trả kết quả...) ─────
      let status: string | undefined;
      if (cells[11] && cells[11].length > 2 && !cells[11].includes('<!--')) {
        status = cells[11].trim();
      } else {
        for (let i = cells.length - 1; i >= 0; i--) {
          const c = cells[i];
          if (c && !c.includes("-->") && !c.includes("<!--") && !c.match(/^\d+$/) && !c.match(/\b\d{1,2}\/\d{1,2}\/\d{4}\b/) && c.length > 2) {
            status = c; break;
          }
        }
      }
      if (!status || status.includes("-->") || status.includes("<!--")) status = "Đã chấp nhận";

      filings.push({
        id: filingId.trim(),
        procedureCode,
        declarationCode,
        title: title || "Hồ sơ thuế",
        taxType,
        period: periodNorm?.raw || rawPeriod || undefined,
        periodNormalized: periodNorm,
        submittedAt,
        filingType: typeInfo.filingType,
        supplementalNo: typeInfo.supplementalNo,
        isSequenceInferred: typeInfo.isSequenceInferred,
        status: status.trim(),
        downloadAvailable: true,
        isThueDienTu,
        loaiTraCuu,
        maTkhai: maTkhai || undefined,
        altIds: altIds.length > 0 ? altIds : undefined
      });
    });

    return resolvePeriodSupplementalSequences(filings);
  }

  public static parseHtmlPaginationInfo(html: string): { totalPages: number; totalRecords: number; currentPage: number } {
    if (!html || typeof html !== "string") {
      return { totalPages: 1, totalRecords: 0, currentPage: 1 };
    }
    const $ = cheerio.load(html);

    // 1. Tổng số trang từ #totalPage hoặc attr max của #gotoPageInput hoặc các nút pagination
    let totalPages = 1;
    const totalPageEl = $("#totalPage").text().trim();
    if (totalPageEl && !isNaN(parseInt(totalPageEl, 10))) {
      totalPages = parseInt(totalPageEl, 10);
    } else {
      const maxAttr = $("#gotoPageInput").attr("max");
      if (maxAttr && !isNaN(parseInt(maxAttr, 10))) {
        totalPages = parseInt(maxAttr, 10);
      } else {
        // Fallback kiểm tra các số trong pagination: <a onclick="onChangePage(2, 10)">2</a>
        $(".pagination .page-item a").each((_, a) => {
          const num = parseInt($(a).text().trim(), 10);
          if (!isNaN(num) && num > totalPages) {
            totalPages = num;
          }
        });
      }
    }

    // 2. Trang hiện tại từ value của #gotoPageInput hoặc li.page-item.active
    let currentPage = 1;
    const curVal = $("#gotoPageInput").val();
    if (curVal && !isNaN(parseInt(String(curVal), 10))) {
      currentPage = parseInt(String(curVal), 10);
    } else {
      const activeText = $(".pagination .page-item.active").text().trim();
      if (activeText && !isNaN(parseInt(activeText, 10))) {
        currentPage = parseInt(activeText, 10);
      }
    }

    // 3. Tổng số bản ghi
    let totalRecords = 0;
    const recordsMatch = html.match(/Tổng\s*số\s*bản\s*ghi:\s*<span[^>]*>(\d+)<\/span>/i) ||
                         html.match(/Tổng\s*số\s*bản\s*ghi:\s*(\d+)/i) ||
                         html.match(/totalRows\s*=\s*(\d+)/i);
    if (recordsMatch) {
      totalRecords = parseInt(recordsMatch[1], 10);
    }

    return {
      totalPages: Math.max(1, totalPages),
      totalRecords: Math.max(0, totalRecords),
      currentPage: Math.max(1, currentPage)
    };
  }

  public static deduplicateFilings(existing: TaxFiling[], incoming: TaxFiling[]): TaxFiling[] {
    const map = new Map<string, TaxFiling>();
    for (const f of existing) map.set(f.id, f);
    for (const f of incoming) {
      if (!map.has(f.id)) {
        map.set(f.id, f);
      } else {
        const curr = map.get(f.id)!;
        map.set(f.id, {
          ...curr,
          ...f,
          downloadStatus: curr.downloadStatus || f.downloadStatus,
          downloadedFiles: curr.downloadedFiles || f.downloadedFiles,
          isThueDienTu: f.isThueDienTu ?? curr.isThueDienTu,
          loaiTraCuu: f.loaiTraCuu ?? curr.loaiTraCuu,
          altIds: Array.from(new Set([...(curr.altIds || []), ...(f.altIds || [])])).slice(0, 5)
        });
      }
    }
    return resolvePeriodSupplementalSequences(Array.from(map.values()));
  }
}

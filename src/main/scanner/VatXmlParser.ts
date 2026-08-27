import { normalizeVatPeriod } from '../../shared/dateUtils';
import { parseMoneyToBigInt } from '../../shared/moneyUtils';
import { TaxFiling } from '../../shared/types';
import {
  VatChainWarning,
  VatDeclarationSnapshot,
  VatDeclarationType,
  VatIndicatorItem,
  VatPeriodType
} from '../../shared/vatAnalyticsTypes';

export const VAT_INDICATOR_NAMES: Record<string, string> = {
  '22': 'Thuế GTGT còn được khấu trừ kỳ trước chuyển sang',
  '23': 'Tổng giá trị hàng hoá, dịch vụ mua vào',
  '24': 'Tổng thuế GTGT của hàng hoá, dịch vụ mua vào',
  '25': 'Tổng thuế GTGT được khấu trừ kỳ này',
  '26': 'Hàng hoá, dịch vụ bán ra không chịu thuế GTGT',
  '27': 'Hàng hoá, dịch vụ bán ra chịu thuế suất 0%',
  '28': 'Hàng hoá, dịch vụ bán ra chịu thuế suất 5%',
  '29': 'Hàng hoá, dịch vụ bán ra chịu thuế suất 10%',
  '34': 'Tổng doanh thu hàng hoá, dịch vụ bán ra',
  '35': 'Tổng thuế GTGT của hàng hoá, dịch vụ bán ra',
  '36': 'Thuế GTGT phát sinh trong kỳ',
  '37': 'Điều chỉnh giảm thuế GTGT còn được khấu trừ của các kỳ trước',
  '38': 'Điều chỉnh tăng thuế GTGT còn được khấu trừ của các kỳ trước',
  '40': 'Thuế GTGT còn phải nộp trong kỳ',
  '41': 'Thuế GTGT chưa khấu trừ hết kỳ này',
  '42': 'Thuế GTGT đề nghị hoàn',
  '43': 'Thuế GTGT còn được khấu trừ chuyển kỳ sau'
};

export class VatXmlParser {
  /**
   * Phân tích nội dung XML của tờ khai GTGT 01/GTGT
   */
  public static parseVatXml(
    xmlContent: string,
    filing: TaxFiling,
    taxpayerId: string
  ): VatDeclarationSnapshot {
    const indicators: Record<string, VatIndicatorItem> = {};
    const warnings: VatChainWarning[] = [];

    // 1. Trích xuất loại tờ khai và lần bổ sung từ XML nếu có
    let declarationType: VatDeclarationType = filing.filingType === 'SUPPLEMENTAL' ? 'SUPPLEMENTAL' : 'ORIGINAL';
    let supplementalNo = filing.supplementalNo;
    let sequenceSource: 'API' | 'XML' | 'DERIVED' | 'UNKNOWN' = 'API';

    // Tìm tag soLan trong XML (hỗ trợ cả namespace prefix: <tns:soLan>...)
    const soLanMatch = xmlContent.match(/<(?:[a-zA-Z0-9_]+:)?soLan[^>]*>(\d+)<\/(?:[a-zA-Z0-9_]+:)?soLan\s*>/i) ||
                        xmlContent.match(/<(?:[a-zA-Z0-9_]+:)?lanBS[^>]*>(\d+)<\/(?:[a-zA-Z0-9_]+:)?lanBS\s*>/i) ||
                        xmlContent.match(/<(?:[a-zA-Z0-9_]+:)?soLanBS[^>]*>(\d+)<\/(?:[a-zA-Z0-9_]+:)?soLanBS\s*>/i);
    if (soLanMatch) {
      const parsedLan = parseInt(soLanMatch[1], 10);
      if (!isNaN(parsedLan)) {
        if (parsedLan > 0) {
          declarationType = 'SUPPLEMENTAL';
          supplementalNo = parsedLan;
          sequenceSource = 'XML';
        } else if (parsedLan === 0) {
          declarationType = 'ORIGINAL';
          supplementalNo = undefined;
          sequenceSource = 'XML';
        }
      }
    }

    // 2. Trích xuất kỳ kê khai từ XML
    let periodType: VatPeriodType = 'UNKNOWN';
    let periodVal = filing.period || '';
    let normalizedKey = '';

    const kyKKMatch = xmlContent.match(/<(?:[a-zA-Z0-9_]+:)?kyKKhai[^>]*>([^<]+)<\/(?:[a-zA-Z0-9_]+:)?kyKKhai\s*>/i) ||
                      xmlContent.match(/<(?:[a-zA-Z0-9_]+:)?kyTinhThue[^>]*>([^<]+)<\/(?:[a-zA-Z0-9_]+:)?kyTinhThue\s*>/i);
    if (kyKKMatch && kyKKMatch[1].trim()) {
      periodVal = kyKKMatch[1].trim();
    }

    // Chuẩn hóa kỳ kê khai
    const norm = this.normalizePeriod(periodVal, filing.submittedAt);
    periodType = norm.type;
    periodVal = norm.label;
    normalizedKey = norm.key;

    // 3. Trích xuất các chỉ tiêu [22] -> [43] (Ưu tiên vùng CTietTKhaiChinh hoặc CTietKHBS chính thống, hỗ trợ namespace XML)
    const mainSectionMatch = xmlContent.match(/<(?:[a-zA-Z0-9_]+:)?CTietTKhaiChinh[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_]+:)?CTietTKhaiChinh\s*>/i) ||
                             xmlContent.match(/<(?:[a-zA-Z0-9_]+:)?CTietKHBS[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_]+:)?CTietKHBS\s*>/i) ||
                             xmlContent.match(/<(?:[a-zA-Z0-9_]+:)?BangChiTiet[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9_]+:)?BangChiTiet\s*>/i);
    const targetXml = mainSectionMatch ? mainSectionMatch[1] : xmlContent;
    const extractedCt22 = this.findTag(targetXml, ['ct22', 'thueDauVaoKyTruoc', 'ct_22', 'ct22_thueDauVao']) || this.findTag(xmlContent, ['ct22']);
    const extractedCt23 = this.findTag(targetXml, ['ct23', 'giaTriHHDVMuaVao', 'ct_23', 'ct23_giaTriHHDVMuaVao']) || this.findTag(xmlContent, ['ct23']);
    const extractedCt24 = this.findTag(targetXml, ['ct24', 'thueHHDVMuaVao', 'ct_24', 'ct24_thueHHDVMuaVao']) || this.findTag(xmlContent, ['ct24']);
    const extractedCt25 = this.findTag(targetXml, ['ct25', 'thueKhauTruKyNay', 'ct_25', 'ct25_thueKhauTruKyNay']) || this.findTag(xmlContent, ['ct25']);
    const extractedCt26 = this.findTag(targetXml, ['ct26', 'hhdvBanKhongChiuThue', 'ct_26']) || this.findTag(xmlContent, ['ct26']);
    const extractedCt27 = this.findTag(targetXml, ['ct27', 'hhdvBanChiuThue0', 'ct_27']) || this.findTag(xmlContent, ['ct27']);
    const extractedCt28 = this.findTag(targetXml, ['ct28', 'hhdvBanChiuThue5', 'ct_28']) || this.findTag(xmlContent, ['ct28']);
    const extractedCt29 = this.findTag(targetXml, ['ct29', 'hhdvBanChiuThue10', 'ct_29']) || this.findTag(xmlContent, ['ct29']);
    const extractedCt34 = this.findTag(targetXml, ['ct34', 'tongDoanhThuBanRa', 'ct_34', 'ct34_tongDoanhThuBanRa']) || this.findTag(xmlContent, ['ct34']);
    const extractedCt35 = this.findTag(targetXml, ['ct35', 'tongThueBanRa', 'ct_35', 'ct35_tongThueBanRa']) || this.findTag(xmlContent, ['ct35']);
    const extractedCt36 = this.findTag(targetXml, ['ct36', 'thuePhatSinhKyNay', 'ct_36']) || this.findTag(xmlContent, ['ct36']);
    const extractedCt37 = this.findTag(targetXml, ['ct37', 'dChinhGiamThueKTru', 'ct_37', 'ct37_dChinhGiamThueKTru', 'ct37_dChinhGiam']) || this.findTag(xmlContent, ['ct37']);
    const extractedCt38 = this.findTag(targetXml, ['ct38', 'dChinhTangThueKTru', 'ct_38', 'ct38_dChinhTangThueKTru', 'ct38_dChinhTang']) || this.findTag(xmlContent, ['ct38']);
    const extractedCt40 = this.findTag(targetXml, ['ct40', 'thuePhaiNopKyNay', 'ct_40', 'ct40_thuePhaiNopKyNay', 'ct40_thuePhaiNop']) || this.findTag(xmlContent, ['ct40']);
    const extractedCt41 = this.findTag(targetXml, ['ct41', 'thueChuaKTruHetKyNay', 'ct_41', 'ct41_thueChuaKTruHetKyNay', 'ct41_thueChuaKTruHet']) || this.findTag(xmlContent, ['ct41']);
    const extractedCt42 = this.findTag(targetXml, ['ct42', 'thueDeNghiHoanKyNay', 'ct_42', 'ct42_thueDeNghiHoanKyNay', 'ct42_thueDeNghiHoan']) || this.findTag(xmlContent, ['ct42']);
    const extractedCt43 = this.findTag(targetXml, ['ct43', 'thueConDuocKhauTruChuyenKySau', 'ct_43', 'ct43_thueConDuocKhauTruChuyenKySau', 'ct43_thueKhauTruChuyenKySau', 'ct43_thueConDuocKT']) || this.findTag(xmlContent, ['ct43']);

    // Đăng ký vào allIndicators
    const rawMap: Record<string, string | undefined> = {
      '22': extractedCt22,
      '23': extractedCt23,
      '24': extractedCt24,
      '25': extractedCt25,
      '26': extractedCt26,
      '27': extractedCt27,
      '28': extractedCt28,
      '29': extractedCt29,
      '34': extractedCt34,
      '35': extractedCt35,
      '36': extractedCt36,
      '37': extractedCt37,
      '38': extractedCt38,
      '40': extractedCt40,
      '41': extractedCt41,
      '42': extractedCt42,
      '43': extractedCt43
    };

    for (const [code, val] of Object.entries(rawMap)) {
      if (val !== undefined && val !== '') {
        indicators[code] = {
          code,
          name: VAT_INDICATOR_NAMES[code] || `Chỉ tiêu [${code}]`,
          rawValue: val,
          numericValue: parseMoneyToBigInt(val),
          source: 'XML'
        };
      }
    }

    const ct22Big = parseMoneyToBigInt(extractedCt22);
    const ct23Big = parseMoneyToBigInt(extractedCt23);
    const ct24Big = parseMoneyToBigInt(extractedCt24);
    const ct25Big = parseMoneyToBigInt(extractedCt25);
    const ct34Big = parseMoneyToBigInt(extractedCt34);
    const ct35Big = parseMoneyToBigInt(extractedCt35);
    const ct37Big = parseMoneyToBigInt(extractedCt37);
    const ct38Big = parseMoneyToBigInt(extractedCt38);
    const ct40Big = parseMoneyToBigInt(extractedCt40);
    const ct42Big = parseMoneyToBigInt(extractedCt42);
    const ct43Big = parseMoneyToBigInt(extractedCt43);

    // Không khớp CHỈ TIÊU nào (schema lạ / fallback BangChiTiet bắt sai vùng):
    // các con số 0n bên dưới là FABRICATED, không phải dữ liệu thật. Trước đây
    // vẫn trả SUCCESS/xmlAvailable=true khiến analytics nhân bản mười sự im
    // lặng thành số liệu 0đ.
    const noIndicatorsExtracted = Object.keys(indicators).length === 0;

    return {
      taxpayerId,
      submissionId: filing.id,
      formCode: filing.declarationCode || '01/GTGT',
      period: {
        type: periodType,
        value: periodVal,
        normalizedKey
      },
      declarationType,
      supplementalNo,
      sequenceSource,
      submittedAt: filing.submittedAt,
      status: filing.status || 'Đã chấp nhận',
      ct22_thueDauVaoKyTruoc: ct22Big,
      ct23_giaTriMuaVao: ct23Big,
      ct24_thueMuaVao: ct24Big,
      ct25_thueKhauTruKyNay: ct25Big,
      ct34_doanhThuBanRa: ct34Big,
      ct35_thueBanRa: ct35Big,
      ct37_dChinhGiamThueKTru: ct37Big,
      ct38_dChinhTangThueKTru: ct38Big,
      ct40_thuePhaiNop: ct40Big,
      ct42_thueDeNghiHoanKyNay: ct42Big,
      ct43_thueKhauTruChuyenKySau: ct43Big,
      allIndicators: indicators,
      warnings,
      parseStatus: noIndicatorsExtracted ? 'WARNING' : 'SUCCESS',
      errorMessage: noIndicatorsExtracted
        ? 'XML có nội dung nhưng không trích xuất được chỉ tiêu nào (schema không nhận diện) — số liệu 0 là placeholder, KHÔNG phải số thật'
        : undefined,
      xmlAvailable: true,
      rawXml: xmlContent.slice(0, 4000)
    };
  }

  /**
   * Tạo snapshot mặc định từ metadata hồ sơ khi chưa có file XML
   */
  public static createDefaultSnapshot(
    filing: TaxFiling,
    taxpayerId: string
  ): VatDeclarationSnapshot {
    const norm = this.normalizePeriod(filing.period || '', filing.submittedAt);
    return {
      taxpayerId,
      submissionId: filing.id,
      formCode: filing.declarationCode || '01/GTGT',
      period: {
        type: norm.type,
        value: norm.label,
        normalizedKey: norm.key
      },
      declarationType: filing.filingType === 'SUPPLEMENTAL' ? 'SUPPLEMENTAL' : 'ORIGINAL',
      supplementalNo: filing.supplementalNo,
      sequenceSource: 'API',
      submittedAt: filing.submittedAt,
      status: filing.status || 'Đã chấp nhận',
      ct22_thueDauVaoKyTruoc: 0n,
      ct23_giaTriMuaVao: 0n,
      ct24_thueMuaVao: 0n,
      ct25_thueKhauTruKyNay: 0n,
      ct34_doanhThuBanRa: 0n,
      ct35_thueBanRa: 0n,
      ct40_thuePhaiNop: 0n,
      ct43_thueKhauTruChuyenKySau: 0n,
      allIndicators: {},
      warnings: [],
      parseStatus: 'WARNING',
      errorMessage: 'Chưa tải file XML để trích xuất chỉ tiêu chi tiết',
      xmlAvailable: false
    };
  }

  private static findTag(xml: string, tags: string[]): string | undefined {
    for (const tag of tags) {
      // Sử dụng strict tag boundary hỗ trợ cả tag có namespace hoặc không có: <ct22>, <tns:ct22>, <CT22>...
      const regex = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tag}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${tag}\\s*>`, 'i');
      const match = xml.match(regex);
      if (match && match[1] !== undefined) {
        return match[1].trim();
      }
    }
    return undefined;
  }

  /**
   * Chuẩn hóa kỳ kê khai — delegate về normalizeVatPeriod dùng chung trong shared/dateUtils
   * để đảm bảo hành vi nhất quán (range ngày, sửa năm 2202, fallbackDate) với phần còn lại
   * của hệ thống. Trước đây bản copy cục bộ thiếu các fix đó khiến key kỳ lệch nhau.
   */
  public static normalizePeriod(rawPeriod: string, fallbackDate?: string): {
    type: VatPeriodType;
    label: string;
    key: string;
    year: number;
    month?: number;
    quarter?: number;
  } {
    return normalizeVatPeriod(rawPeriod, fallbackDate);
  }
}

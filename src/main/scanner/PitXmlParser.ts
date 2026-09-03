import { TaxFiling } from '../../shared/types';
import { PitDeclarationSnapshot } from '../../shared/pitAnalyticsTypes';
import { normalizeVatPeriod } from '../../shared/dateUtils';
import { parseMoneyToBigInt } from '../../shared/moneyUtils';

export class PitXmlParser {
  private static findTag(xml: string, tagNames: string[]): string | undefined {
    if (!xml) return undefined;
    for (const tag of tagNames) {
      // Hỗ trợ cả tag có namespace hoặc không có: <ct21>, <tns:ct21>, <CT21>...
      // Boundary chặt: sau tên tag phải là whitespace, '/', hoặc '>' — trước đây
      // 'ct32' khớp cả <ct320>, 'ct31' khớp <ct310> → chỉ tiêu sai âm thầm.
      const regex = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${tag}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${tag}\\s*>`, 'i');
      const match = xml.match(regex);
      if (match && match[1] !== undefined) {
        return match[1].trim();
      }
    }
    return undefined;
  }

  private static parseBigIntSafe(val: string | undefined): bigint {
    if (!val) return 0n;
    return parseMoneyToBigInt(val);
  }

  /**
   * Phân tích nội dung XML của tờ khai 05/KK-TNCN hoặc 05/QTT-TNCN
   */
  public static parsePitXml(
    xmlContent: string,
    filing: TaxFiling,
    taxpayerId: string
  ): PitDeclarationSnapshot | null {
    if (!xmlContent || typeof xmlContent !== 'string') return null;

    try {
      const isFinalization =
        filing.filingType === 'FINALIZATION' ||
        filing.title.toLowerCase().includes('quyết toán') ||
        (filing.declarationCode || '').includes('05/QTT') ||
        xmlContent.includes('05/QTT-TNCN') ||
        xmlContent.includes('05_QTT_TNCN');

      // 1. Trích xuất loại tờ khai và lần bổ sung từ XML nếu có
      let versionType: 'ORIGINAL' | 'SUPPLEMENTAL' = filing.filingType === 'SUPPLEMENTAL' ? 'SUPPLEMENTAL' : 'ORIGINAL';
      let supplementalNo = filing.supplementalNo || 0;

      const soLanMatch = xmlContent.match(/<(?:[a-zA-Z0-9_]+:)?soLan[^>]*>(\d+)<\/(?:[a-zA-Z0-9_]+:)?soLan\s*>/i) ||
                         xmlContent.match(/<(?:[a-zA-Z0-9_]+:)?lanBS[^>]*>(\d+)<\/(?:[a-zA-Z0-9_]+:)?lanBS\s*>/i) ||
                         xmlContent.match(/<(?:[a-zA-Z0-9_]+:)?soLanBS[^>]*>(\d+)<\/(?:[a-zA-Z0-9_]+:)?soLanBS\s*>/i);
      if (soLanMatch) {
        const parsedLan = parseInt(soLanMatch[1], 10);
        if (!isNaN(parsedLan)) {
          if (parsedLan > 0) {
            versionType = 'SUPPLEMENTAL';
            supplementalNo = parsedLan;
          } else if (parsedLan === 0) {
            versionType = 'ORIGINAL';
            supplementalNo = 0;
          }
        }
      }

      // 2. Trích xuất kỳ kê khai từ XML nếu có
      let rawPeriod = filing.period || filing.periodNormalized?.raw || '';
      const kyKKMatch = xmlContent.match(/<(?:[a-zA-Z0-9_]+:)?kyKKhai[^>]*>([^<]+)<\/(?:[a-zA-Z0-9_]+:)?kyKKhai\s*>/i) ||
                        xmlContent.match(/<(?:[a-zA-Z0-9_]+:)?kyTinhThue[^>]*>([^<]+)<\/(?:[a-zA-Z0-9_]+:)?kyTinhThue\s*>/i);
      if (kyKKMatch && kyKKMatch[1].trim()) {
        rawPeriod = kyKKMatch[1].trim();
      }

      const norm = normalizeVatPeriod(rawPeriod, filing.submittedAt);
      const xmlFormId = this.findTag(xmlContent, ['maTKhai']) || '';
      const xmlFormName = this.findTag(xmlContent, ['tenTKhai']) || '';
      const isTt80Schema =
        ['864', '953'].includes(xmlFormId.trim()) ||
        /TT80\s*\/\s*2021|Thông tư số 80\/2021/i.test(xmlFormName);

      // ─── TỜ KHAI KHẤU TRỪ KỲ 05/KK-TNCN (Thông tư 80/2021/TT-BTC & TT92) ───
      let ct21 = 0n; // Tổng số lao động (người)
      let ct22 = 0n; // Cá nhân cư trú có HĐLĐ (người)
      let ct24 = 0n; // Tổng thu nhập chịu thuế (TNCT) trả cho cá nhân
      let ct27 = 0n; // Tổng TNCT trả cho cá nhân thuộc diện phải khấu trừ
      let ct31 = 0n; // Thuế TNCN khấu trừ của cá nhân cư trú
      let ct32 = 0n; // Thuế TNCN khấu trừ của cá nhân không cư trú
      let ct34 = 0n; // Tổng số thuế TNCN đã khấu trừ
      let ct35 = 0n; // Thuế phải nộp

      // ─── TỜ KHAI QUYẾT TOÁN NĂM 05/QTT-TNCN ───
      let ct36_qtt: bigint | undefined = undefined;
      let ct41_qtt: bigint | undefined = undefined;
      let ct44_qtt: bigint | undefined = undefined;

      // 1. Quét thẻ số lao động (người) - [21], [22]
      const val21 = this.findTag(xmlContent, ['ct16', 'ct21', 'soLaoDong', 'tongSoLaoDong', 'ct_21', 'ct_16']);
      const val22 = this.findTag(xmlContent, ['ct17', 'ct22', 'caNhanCuTru', 'ct_22', 'ct_17']);

      // 2. Quét thẻ Tổng thu nhập chịu thuế (TNCT) - [24], [27]
      const val24 = isTt80Schema
        ? this.findTag(xmlContent, [isFinalization ? 'ct23' : 'ct21', 'ct24', 'tongTNCT', 'tongThuNhapChiuThue', 'ct_24', 'ct_21', 'ct_23'])
        : this.findTag(xmlContent, ['ct24', 'ct21', 'ct23', 'tongTNCT', 'tongThuNhapChiuThue', 'ct_24']);
      const val27 = isTt80Schema
        ? this.findTag(xmlContent, [isFinalization ? 'ct28' : 'ct26', 'ct27', 'tnctKhauTru', 'ct_27', 'ct_26', 'ct_28'])
        : this.findTag(xmlContent, ['ct27', 'ct26', 'ct28', 'tnctKhauTru', 'ct_27']);

      if (val21 !== undefined) ct21 = this.parseBigIntSafe(val21);
      if (val22 !== undefined) ct22 = this.parseBigIntSafe(val22);
      if (val24 !== undefined) ct24 = this.parseBigIntSafe(val24);
      if (val27 !== undefined) ct27 = this.parseBigIntSafe(val27);

      if (!isFinalization) {
        if (isTt80Schema) {
          // Mẫu 05/KK-TNCN TT80/2021 (maTKhai=864):
          // [16] tổng số NLĐ; [17] cá nhân cư trú có HĐLĐ;
          // [21] tổng TNCT; [26] tổng TNCT thuộc diện khấu trừ;
          // [29] tổng thuế đã khấu trừ = [30] cư trú + [31] không cư trú.
          const totalWithheld = this.findTag(xmlContent, ['ct29', 'ct30', 'ct34', 'tongThueDaKhauTru', 'tongThueKhauTru', 'ct_29', 'ct_34']);
          const residentWithheld = this.findTag(xmlContent, ['ct30', 'ct31', 'ct32', 'thueCuTru', 'ct_30', 'ct_31']);
          const nonResidentWithheld = this.findTag(xmlContent, ['ct31', 'ct32', 'ct33', 'thueKhongCuTru', 'ct_31', 'ct_32']);
          ct31 = this.parseBigIntSafe(residentWithheld);
          ct32 = this.parseBigIntSafe(nonResidentWithheld);
          ct34 = this.parseBigIntSafe(totalWithheld);
          if (ct34 === 0n && (ct31 > 0n || ct32 > 0n)) ct34 = ct31 + ct32;
          ct35 = ct34;
        } else {
        // ─── XỬ LÝ CHO TỜ KHAI KỲ 05/KK-TNCN ───
        // TT80: <ct30> là Tổng thuế khấu trừ, <ct31> là Cư trú, <ct32> là Không cư trú, <ct33> là Thuế phải nộp
        // TT92: <ct34> là Tổng thuế khấu trừ, <ct32> là Cư trú, <ct33> là Không cư trú, <ct35> là Thuế phải nộp
        const valCt30 = this.findTag(xmlContent, ['ct30', 'tongThueKhauTru', 'ct_30']);
        const valCt31 = this.findTag(xmlContent, ['ct31', 'thueCuTru', 'khauTruCuTru', 'ct_31']);
        const valCt32 = this.findTag(xmlContent, ['ct32', 'thueKhongCuTru', 'khauTruKhongCuTru', 'ct_32']);
        const valCt33 = this.findTag(xmlContent, ['ct33', 'thueKhongCuTru92', 'ct_33']);
        const valCt34 = this.findTag(xmlContent, ['ct34', 'tongThueDaKhauTru', 'ct_34']);
        const valCt35 = this.findTag(xmlContent, ['ct35', 'thuePhaiNop', 'tongThuePhaiNop', 'ct_35']);

        if (valCt31 !== undefined) {
          ct31 = this.parseBigIntSafe(valCt31);
        }
        if (valCt32 !== undefined) {
          // Nếu đã có ct31 thì ct32 là Không cư trú (TT80)
          // Nếu không có ct31 mà có ct33 thì ct32 là Cư trú, ct33 là Không cư trú (TT92)
          if (valCt31 !== undefined) {
            ct32 = this.parseBigIntSafe(valCt32);
          } else if (valCt33 !== undefined) {
            ct31 = this.parseBigIntSafe(valCt32);
            ct32 = this.parseBigIntSafe(valCt33);
          } else {
            ct31 = this.parseBigIntSafe(valCt32);
          }
        }

        if (valCt30 !== undefined && this.parseBigIntSafe(valCt30) > 0n) {
          ct34 = this.parseBigIntSafe(valCt30);
        } else if (valCt34 !== undefined && this.parseBigIntSafe(valCt34) > 0n) {
          ct34 = this.parseBigIntSafe(valCt34);
        }

        // Tự động suy luận nếu có tổng mà thiếu thành phần hoặc ngược lại
        if (ct34 === 0n && (ct31 > 0n || ct32 > 0n)) {
          ct34 = ct31 + ct32;
        }
        if (ct31 === 0n && ct34 > 0n && ct32 === 0n) {
          ct31 = ct34; // Mặc định phần lớn khấu trừ rơi vào cá nhân cư trú
        }

        // Thuế phải nộp: ưu tiên ct35 (TT92) hoặc ct33 (TT80), fallback sang ct34
        if (valCt35 !== undefined && this.parseBigIntSafe(valCt35) > 0n) {
          ct35 = this.parseBigIntSafe(valCt35);
        } else {
          ct35 = ct34;
        }
        }
      } else {
        if (isTt80Schema) {
          // Mẫu 05/QTT-TNCN TT80/2021 (maTKhai=953):
          // [31] tổng thuế đã khấu trừ = [32] cư trú + [33] không cư trú;
          // [40] số thuế còn phải nộp; [41] số thuế nộp thừa.
          const totalWithheld = this.findTag(xmlContent, ['ct31', 'ct30', 'ct36', 'tongThueDaKhauTru', 'ct_31', 'ct_36']);
          const residentWithheld = this.findTag(xmlContent, ['ct32', 'ct31', 'thueCuTru', 'ct_32']);
          const nonResidentWithheld = this.findTag(xmlContent, ['ct33', 'thueKhongCuTru', 'ct_33']);
          const additionalPayable = this.findTag(xmlContent, ['ct40', 'ct41', 'ct35', 'thuePhaiNopQTT', 'ct_40', 'ct_41']);
          const overpaid = this.findTag(xmlContent, ['ct41', 'ct44', 'thueNopThuaQTT', 'ct_41', 'ct_44']);
          ct31 = this.parseBigIntSafe(residentWithheld);
          ct32 = this.parseBigIntSafe(nonResidentWithheld);
          ct34 = this.parseBigIntSafe(totalWithheld);
          if (ct34 === 0n && (ct31 > 0n || ct32 > 0n)) ct34 = ct31 + ct32;
          ct35 = this.parseBigIntSafe(additionalPayable);
          ct36_qtt = ct34;
          ct41_qtt = ct35;
          ct44_qtt = this.parseBigIntSafe(overpaid);
        } else {
        // ─── XỬ LÝ CHO TỜ KHAI QUYẾT TOÁN NĂM 05/QTT-TNCN ───
        // TT80:
        // [30] / [36]: Tổng số thuế TNCN đã khấu trừ
        // [31]: Thuế TNCN đã khấu trừ của cá nhân cư trú có HĐLĐ
        // [32]: Thuế TNCN đã khấu trừ của cá nhân cư trú không HĐLĐ (hoặc cư trú TT92)
        // [33]: Thuế TNCN đã khấu trừ của cá nhân không cư trú
        // [41]: Tổng số thuế TNCN còn phải nộp quyết toán
        // [44]: Tổng số thuế TNCN nộp thừa
        const val30_qtt = this.findTag(xmlContent, ['ct30', 'ct36', 'tongThueKhauTruTrongNam', 'ct_30', 'ct_36']);
        const val31_qtt = this.findTag(xmlContent, ['ct31', 'thueCuTruCoHDLD', 'ct_31']);
        const val32_qtt = this.findTag(xmlContent, ['ct32', 'thueKhauTruCuTruTrongNam', 'ct_32']);
        const val33_qtt = this.findTag(xmlContent, ['ct33', 'thueKhauTruKhongCuTruTrongNam', 'ct_33']);
        const val41_qtt = this.findTag(xmlContent, ['ct41', 'tongThuePhaiNopQTT', 'ct_41', 'ct35']);
        const val44_qtt = this.findTag(xmlContent, ['ct44', 'tongThueNopThuaQTT', 'ct_44']);

        const val31Big = val31_qtt !== undefined ? this.parseBigIntSafe(val31_qtt) : 0n;
        const val32Big = val32_qtt !== undefined ? this.parseBigIntSafe(val32_qtt) : 0n;
        const val33Big = val33_qtt !== undefined ? this.parseBigIntSafe(val33_qtt) : 0n;

        if (val31_qtt !== undefined && val32_qtt !== undefined) {
          ct31 = val31Big + val32Big; // Tổng cư trú = có HĐLĐ + không có HĐLĐ
        } else if (val32_qtt !== undefined) {
          ct31 = val32Big;
        } else if (val31_qtt !== undefined) {
          ct31 = val31Big;
        }

        if (val33_qtt !== undefined) ct32 = val33Big;
        if (val41_qtt !== undefined) ct41_qtt = this.parseBigIntSafe(val41_qtt);
        if (val44_qtt !== undefined) ct44_qtt = this.parseBigIntSafe(val44_qtt);

        if (val30_qtt !== undefined && this.parseBigIntSafe(val30_qtt) > 0n) {
          ct36_qtt = this.parseBigIntSafe(val30_qtt);
          ct34 = ct36_qtt;
        } else if (ct31 > 0n || ct32 > 0n) {
          ct34 = ct31 + ct32;
          ct36_qtt = ct34;
        }
        }
      }

      const formCode = isFinalization
        ? '05/QTT-TNCN'
        : filing.declarationCode || '05/KK-TNCN';

      return {
        submissionId: filing.id,
        formCode,
        periodKey: isFinalization ? `${norm.year}-YEAR` : norm.key,
        periodLabel: isFinalization ? `Quyết toán năm ${norm.year}` : norm.label,
        year: norm.year,
        month: isFinalization ? undefined : norm.month,
        quarter: isFinalization ? undefined : norm.quarter,
        isQuarter: norm.type === 'QUARTER' && !isFinalization,
        isYear: isFinalization,
        versionType,
        supplementalNo,
        submittedAt: filing.submittedAt,
        status: filing.status || 'Đã tiếp nhận',
        ct21_tongSoNguoiLaoDong: ct21,
        ct22_caNhanCuTru: ct22,
        ct24_tongThuNhapChiuThue: ct24,
        ct27_tongThuNhapChiuThueKhauTru: ct27,
        ct31_tongThueTncnDaKhauTru: ct34,
        ct32_khauTruCaNhanCuTru: ct31,
        ct33_khauTruCaNhanKhongCuTru: ct32,
        ct34_tongThueKhauTru: ct34,
        ct35_tongThuePhaiNop: ct35,
        isFinalization,
        ct36_qtt_tongThueDaKhauTruTrongNam: ct36_qtt,
        ct41_qtt_tongThuePhaiNopTrongNam: ct41_qtt,
        ct44_qtt_tongThueNopThua: ct44_qtt,
        rawXml: xmlContent,
        xmlAvailable: true
      };
    } catch {
      return null;
    }
  }
}

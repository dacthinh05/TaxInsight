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

      const rawPeriod = filing.period || filing.periodNormalized?.raw || '';
      const norm = normalizeVatPeriod(rawPeriod, filing.submittedAt);

      // ─── TỜ KHAI KHẤU TRỪ KỲ 05/KK-TNCN (Thông tư 80/2021/TT-BTC & TT92) ───
      let ct21 = 0n; // Tổng số lao động (người)
      let ct22 = 0n; // Cá nhân cư trú có HĐLĐ (người)
      let ct24 = 0n; // Tổng thu nhập chịu thuế (TNCT) trả cho cá nhân
      let ct27 = 0n; // Tổng TNCT trả cho cá nhân thuộc diện phải khấu trừ
      let ct31 = 0n; // Thuế TNCN khấu trừ của cá nhân cư trú (hoặc ct29/ct31)
      let ct32 = 0n; // Thuế TNCN khấu trừ của cá nhân không cư trú (hoặc ct30/ct32)
      let ct34 = 0n; // Tổng số thuế TNCN đã khấu trừ (ct30 trên TT80 hoặc ct34/ct31 trên TT92)
      let ct35 = 0n; // Thuế phải nộp

      // ─── TỜ KHAI QUYẾT TOÁN NĂM 05/QTT-TNCN ───
      let ct36_qtt: bigint | undefined = undefined;
      let ct41_qtt: bigint | undefined = undefined;
      let ct44_qtt: bigint | undefined = undefined;

      // 1. Quét thẻ số lao động (người) - [21], [22]
      const val21 = this.findTag(xmlContent, ['ct21', 'soLaoDong', 'tongSoLaoDong', 'ct_21']);
      const val22 = this.findTag(xmlContent, ['ct22', 'caNhanCuTru', 'ct_22']);

      // 2. Quét thẻ Tổng thu nhập chịu thuế (TNCT) - [24], [27]
      const val24 = this.findTag(xmlContent, ['ct24', 'tongTNCT', 'tongThuNhapChiuThue', 'ct_24']);
      const val27 = this.findTag(xmlContent, ['ct27', 'tnctKhauTru', 'ct_27']);

      if (val21 !== undefined) ct21 = this.parseBigIntSafe(val21);
      if (val22 !== undefined) ct22 = this.parseBigIntSafe(val22);
      if (val24 !== undefined) ct24 = this.parseBigIntSafe(val24);
      if (val27 !== undefined) ct27 = this.parseBigIntSafe(val27);

      if (!isFinalization) {
        // ─── XỬ LÝ CHO TỜ KHAI KỲ 05/KK-TNCN ───
        // TT80: <ct30> là Tổng thuế khấu trừ, <ct31> là Cư trú, <ct32> là Không cư trú
        // TT92: <ct34> là Tổng thuế khấu trừ, <ct32> là Cư trú, <ct33> là Không cư trú
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
          // Nếu không có ct31 mà có ct33 thì ct32 là Cư trú (TT92)
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
        } else if (valCt35 !== undefined && this.parseBigIntSafe(valCt35) > 0n) {
          ct34 = this.parseBigIntSafe(valCt35);
        }

        // Tự động suy luận nếu có tổng mà thiếu thành phần hoặc ngược lại
        if (ct34 === 0n && (ct31 > 0n || ct32 > 0n)) {
          ct34 = ct31 + ct32;
        }
        if (ct31 === 0n && ct34 > 0n && ct32 === 0n) {
          ct31 = ct34; // Mặc định phần lớn khấu trừ rơi vào cá nhân cư trú
        }
        ct35 = ct34;
      } else {
        // ─── XỬ LÝ CHO TỜ KHAI QUYẾT TOÁN NĂM 05/QTT-TNCN ───
        // TT80:
        // [31] / [36]: Tổng số thuế TNCN đã khấu trừ
        // [32]: Thuế TNCN đã khấu trừ của cá nhân cư trú
        // [33]: Thuế TNCN đã khấu trừ của cá nhân không cư trú
        // [41]: Tổng số thuế TNCN phải nộp quyết toán
        // [44]: Tổng số thuế TNCN nộp thừa
        const val36_qtt = this.findTag(xmlContent, ['ct36', 'tongThueKhauTruTrongNam', 'ct_36', 'ct31']);
        const val32_qtt = this.findTag(xmlContent, ['ct32', 'thueKhauTruCuTruTrongNam', 'ct_32']);
        const val33_qtt = this.findTag(xmlContent, ['ct33', 'thueKhauTruKhongCuTruTrongNam', 'ct_33']);
        const val41_qtt = this.findTag(xmlContent, ['ct41', 'tongThuePhaiNopQTT', 'ct_41', 'ct35']);
        const val44_qtt = this.findTag(xmlContent, ['ct44', 'tongThueNopThuaQTT', 'ct_44']);

        if (val36_qtt !== undefined) ct36_qtt = this.parseBigIntSafe(val36_qtt);
        if (val32_qtt !== undefined) ct31 = this.parseBigIntSafe(val32_qtt);
        if (val33_qtt !== undefined) ct32 = this.parseBigIntSafe(val33_qtt);
        if (val41_qtt !== undefined) ct41_qtt = this.parseBigIntSafe(val41_qtt);
        if (val44_qtt !== undefined) ct44_qtt = this.parseBigIntSafe(val44_qtt);

        if (ct36_qtt !== undefined && ct36_qtt > 0n) {
          ct34 = ct36_qtt;
        } else if (ct31 > 0n || ct32 > 0n) {
          ct34 = ct31 + ct32;
          ct36_qtt = ct34;
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
        versionType: filing.filingType === 'SUPPLEMENTAL' ? 'SUPPLEMENTAL' : 'ORIGINAL',
        supplementalNo: filing.supplementalNo || 0,
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

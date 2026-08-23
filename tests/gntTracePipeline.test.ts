import { describe, expect, it } from 'vitest';
import { GntMoneyParser } from '../src/main/scanner/GntMoneyParser';
import { GntPeriodNormalizer } from '../src/main/scanner/GntPeriodNormalizer';
import { DseFormStateParser } from '../src/main/portal/DseFormStateParser';
import { GdtResponseClassifier } from '../src/main/portal/GdtResponseClassifier';
import { GntParser } from '../src/main/scanner/GntParser';
import { TaxNdktClassifier } from '../src/main/engine/TaxNdktClassifier';
import { TaxPaymentMatcher } from '../src/main/engine/TaxPaymentMatcher';
import { TaxObligation } from '../src/shared/obligationTypes';

describe('GDT GNT TRACE-DRIVEN PIPELINE', () => {
  // ── 1. GNT LIST PARSING FIXTURE (TỪ TRACE THỰC TẾ) ──────────────────────
  const sampleListHtml = `
    <table id="data_content_onday">
      <tbody id="allResultTableBody">
        <tr>
          <td align="center">1</td>
          <td style="text-align: center;">11220260357675749</td>
          <td style="text-align: center;"></td>
          <td style="text-align: center;"></td>
          <td style="text-align: center;"><a href="javascript: chiTietCT(53864244);">00000370273570901202634340228</a></td>
          <td style="text-align: right;">99,921,049</td>
          <td style="text-align: center;">VND</td>
          <td style="text-align: center;">Nộp thuế thành công</td>
          <td style="text-align: center;">1499981</td>
          <td style="text-align: center;">17/01/2026 09:53:27</td>
          <td style="text-align: center;">17/01/2026 11:36:26</td>
          <td style="text-align: center;">17/01/2026 11:37:02</td>
          <td><a href="javascript: uploadBke('53864244');">Upload</a></td>
          <td></td>
          <td></td>
          <td style="text-align: left;">Nộp tại cổng eTax của TCT</td>
          <td style="text-align: left;">Ngân hàng TMCP Đầu tư và Phát triển Việt Nam</td>
          <td style="text-align: center;">6503056170</td>
          <td><a href="javascript: downloadGNT(53864244);">Tải về</a></td>
          <td></td>
        </tr>
        <tr>
          <td align="center">2</td>
          <td style="text-align: center;">11220260355249027</td>
          <td></td><td></td>
          <td style="text-align: center;"><a href="javascript: chiTietCT(53688311);">00000370273570901202634164540</a></td>
          <td style="text-align: right;">3,952,858</td>
          <td style="text-align: center;">VND</td>
          <td style="text-align: center;">Nộp thuế thành công</td>
          <td style="text-align: center;">1191806</td>
          <td style="text-align: center;">06/01/2026 10:30:38</td>
          <td style="text-align: center;">06/01/2026 13:03:52</td>
          <td style="text-align: center;">06/01/2026 13:04:01</td>
          <td></td><td></td><td></td>
          <td style="text-align: left;">Nộp tại cổng eTax của TCT</td>
          <td style="text-align: left;">Ngân hàng TMCP Đầu tư và Phát triển Việt Nam</td>
          <td style="text-align: center;">6503056170</td>
          <td><a href="javascript: downloadGNT(53688311);">Tải về</a></td>
          <td></td>
        </tr>
      </tbody>
    </table>
  `;

  it('1. Parses GNT List table accurately from captured trace HTML', () => {
    const records = GntParser.parseList(sampleListHtml);
    expect(records).toHaveLength(2);

    const r1 = records[0];
    expect(r1.ctuId).toBe('53864244');
    expect(r1.transactionRef).toBe('11220260357675749');
    expect(r1.gntNo).toBe('00000370273570901202634340228');
    expect(r1.amount.status).toBe('VALID');
    expect(r1.amount.value).toBe(99921049n);
    expect(r1.statusNormalized).toBe('PAID_SUCCESS');
    expect(r1.bankDocumentNo).toBe('1499981');
    expect(r1.createdAt).toBe('17/01/2026 09:53:27');
    expect(r1.sentAt).toBe('17/01/2026 11:36:26');
    expect(r1.paidAt).toBe('17/01/2026 11:37:02');
    expect(r1.bankName).toBe('Ngân hàng TMCP Đầu tư và Phát triển Việt Nam');
    expect(r1.bankAccount).toBe('6503056170');
    expect(r1.canDownload).toBe(true);

    const r2 = records[1];
    expect(r2.ctuId).toBe('53688311');
    expect(r2.amount.value).toBe(3952858n);
  });

  // ── 2. GNT DETAIL PARSING FIXTURE (TỪ TRACE THỰC TẾ) ────────────────────
  const sampleDetailHtml = `
    <div>
      <p>Mã hiệu: <span>2620202TSA</span></p>
      <p>Số: <span>1499981</span></p>
      <p>Số tham chiếu: 11220260357675749</p>
      <p>GIẤY NỘP TIỀN VÀO NGÂN SÁCH NHÀ NƯỚC</p>
      <p>Người nộp thuế: <span style="text-transform:uppercase;">CÔNG TY TNHH CÔNG NGHIỆP CARBOTEC (VN)</span></p>
      <p>Mã số thuế: <span>3702735709</span></p>
      <p>Địa chỉ: <span>Lô số 19-2, Đường số 11, KCN Protrade</span></p>
      <p>Đề nghị NH/ KBNN: <span>Ngân hàng TMCP Đầu tư và Phát triển Việt Nam</span></p>
      <span id="so_tk_nhang">6503056170</span>
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
          <tr>
            <td colspan="4">Tổng tiền</td>
            <td></td>
            <td><span id="sum">99,921,049</span></td>
            <td></td><td></td>
          </tr>
        </tbody>
      </table>
      <span id="sotienbangchu_VND">Chín mươi chín triệu chín trăm hai mươi mốt nghìn không trăm bốn mươi chín đồng</span>
      
      <li>
        <table>
          <tr><td>Người ký :</td><td>CÔNG TY TNHH CÔNG NGHIỆP CARBOTEC (VN)</td></tr>
          <tr><td>Ngày ký :</td><td>17/01/2026 11:36:18</td></tr>
        </table>
      </li>
      <li>
        <table>
          <tr><td>Người ký :</td><td>CỤC THUẾ</td></tr>
          <tr><td>Ngày ký :</td><td>17/01/2026 11:36:19</td></tr>
        </table>
      </li>
      <li>
        <table>
          <tr><td>Người ký :</td><td>NGÂN HÀNG THƯƠNG MẠI CỔ PHẦN ĐẦU TƯ VÀ PHÁT TRIỂN VIỆT NAM</td></tr>
          <tr><td>Ngày ký :</td><td>17/01/2026 11:37:02</td></tr>
        </table>
      </li>
    </div>
  `;

  it('2. Parses GNT Detail Mẫu C1-02/NS allocations and signatures accurately', () => {
    const detail = GntParser.parseDetail(sampleDetailHtml, '53864244');
    expect(detail.id).toBe('53864244');
    expect(detail.symbolCode).toBe('2620202TSA');
    expect(detail.documentNo).toBe('1499981');
    expect(detail.transactionRef).toBe('11220260357675749');
    expect(detail.taxpayerName).toBe('CÔNG TY TNHH CÔNG NGHIỆP CARBOTEC (VN)');
    expect(detail.taxpayerId).toBe('3702735709');
    expect(detail.debitAccount).toBe('6503056170');
    expect(detail.allocations).toHaveLength(1);

    const al = detail.allocations[0];
    expect(al.sequence).toBe(1);
    expect(al.referenceDocumentNo).toBe('0406097974970001');
    expect(al.taxPeriodRaw).toBe('00/12/2025');
    expect(al.description).toBe('Thuế thu nhập từ tiền lương, tiền công.');
    expect(al.originalAmount.status).toBe('MISSING'); // Blank original amount
    expect(al.vndAmount.status).toBe('VALID');
    expect(al.vndAmount.value).toBe(99921049n);
    expect(al.chapterCode).toBe('557');
    expect(al.ndktCode).toBe('1001');
    expect(al.inferredTaxType).toBe('PIT');
    expect(al.normalizedPeriod?.month).toBe(12);
    expect(al.normalizedPeriod?.year).toBe(2025);

    // Total Integrity Check
    expect(detail.totalVndAmount.value).toBe(99921049n);
    expect(detail.detailIntegrity).toBe('VERIFIED');

    // Signatures
    expect(detail.signatures).toHaveLength(3);
    expect(detail.signatures[0].signerName).toContain('CARBOTEC');
    expect(detail.signatures[1].signerName).toBe('CỤC THUẾ');
    expect(detail.signatures[2].signerName).toContain('NGÂN HÀNG');
  });

  // ── 3. DSE FORM STATE PARSER FIXTURE ─────────────────────────────────────
  it('3. Extracts runtime DSE form state without static guessing', () => {
    const htmlWithForm = `
      <form id="reportForm" action="/etaxnnt/Request">
        <input type="hidden" name="dse_sessionId" value="brdeZfZhx1B5e9imPisbYAW" />
        <input type="hidden" name="dse_applicationId" value="-1" />
        <input type="hidden" name="dse_operationName" value="corpQueryTaxProc" />
        <input type="hidden" name="dse_pageId" value="6" />
        <input type="hidden" name="dse_processorState" value="viewQueryPage" />
        <input type="hidden" name="dse_processorId" value="EWIGIUJSBZEDBFCOGFDXGTASFMGGCEEQCRAGGADP" />
        <input type="hidden" name="dse_errorPage" value="/etax/query_tax_information.jsp" />
      </form>
    `;
    const state = DseFormStateParser.extractDseFormState(htmlWithForm);
    expect(state.sessionId).toBe('brdeZfZhx1B5e9imPisbYAW');
    expect(state.applicationId).toBe('-1');
    expect(state.operationName).toBe('corpQueryTaxProc');
    expect(state.pageId).toBe('6');
    expect(state.processorId).toBe('EWIGIUJSBZEDBFCOGFDXGTASFMGGCEEQCRAGGADP');
    expect(state.processorState).toBe('viewQueryPage');
  });

  // ── 4. TAX NDKT CLASSIFIER & CONFLICT DETECTION ─────────────────────────
  it('4. Classifies NDKT codes and detects hard tax type conflicts', () => {
    expect(TaxNdktClassifier.classify('1001').taxType).toBe('PIT');
    expect(TaxNdktClassifier.classify('1003').taxType).toBe('PIT');
    expect(TaxNdktClassifier.classify('1701').taxType).toBe('VAT');
    expect(TaxNdktClassifier.classify('1052').taxType).toBe('CIT');
    expect(TaxNdktClassifier.classify('1055').taxType).toBe('FCT');
    expect(TaxNdktClassifier.classify('9999').taxType).toBe('UNKNOWN');

    // Hard Conflict: PIT vs VAT must be true
    expect(TaxNdktClassifier.hasTaxTypeConflict('PIT', 'VAT')).toBe(true);
    expect(TaxNdktClassifier.hasTaxTypeConflict('VAT', 'PIT')).toBe(true);
    expect(TaxNdktClassifier.hasTaxTypeConflict('PIT', 'PIT')).toBe(false);
    expect(TaxNdktClassifier.hasTaxTypeConflict('UNKNOWN', 'VAT')).toBe(false); // Unknown is not a conflict
  });

  function createMockObligation(partial: Partial<TaxObligation>): TaxObligation {
    return {
      id: partial.id || 'ob_mock',
      taxCode: partial.taxCode || '3702735709',
      taxType: partial.taxType || 'VAT',
      declarationCode: partial.declarationCode || '01/GTGT',
      title: partial.title || 'Tờ khai thuế',
      periodKey: partial.periodKey || '2025-M12',
      periodLabel: partial.periodLabel || '12/2025',
      year: partial.year || 2025,
      month: partial.month,
      quarter: partial.quarter,
      amountPayable: partial.amountPayable || 0n,
      hasSupplemental: false,
      supplementalCount: 0,
      currentVersion: 'Chính thức',
      deadline: partial.deadline || {
        baseFilingDeadline: '20/01/2026',
        basePaymentDeadline: '20/01/2026',
        effectiveFilingDeadline: '20/01/2026',
        effectivePaymentDeadline: '20/01/2026',
        ruleId: null,
        legalBasis: [],
        extensionApplied: false,
        confidence: 'CONFIRMED',
        isAdjustedForHoliday: false
      },
      status: partial.status || 'PAST_DEADLINE_NO_MATCHED_PAYMENT',
      daysRemaining: -10,
      matchedPaymentAmount: 0n,
      matchedSlips: [],
      discrepancy: partial.amountPayable || 0n,
      statusMessage: ''
    };
  }

  // ── 5. ADVERSARIAL: TAX TYPE CONFLICT REJECTION ─────────────────────────
  it('5. Strictly rejects payment match when NDKT conflicts with candidate declaration', () => {
    const vatObligation = createMockObligation({
      id: 'ob_vat_12_2025',
      taxType: 'VAT',
      periodLabel: 'Tháng 12/2025',
      month: 12,
      year: 2025,
      amountPayable: 99921049n
    });

    // GNT có cùng số tiền và cùng tháng 12/2025 nhưng NDKT là 1001 (TNCN)
    const gntRecord: any = {
      id: '53864244',
      stt: 1,
      soGnt: '1499981',
      soTien: 99921049,
      soTienFormatted: '99,921,049',
      trangThai: 'Nộp thuế thành công',
      ngayNopThue: '17/01/2026 11:37:02'
    };

    const gntDetail: any = {
      id: '53864244',
      soGnt: '1499981',
      tongTienVND: '99,921,049',
      items: [
        {
          stt: 1,
          kyThueNgayQd: '00/12/2025',
          noiDungKhoanNop: 'Thuế thu nhập từ tiền lương, tiền công.',
          soTienVND: '99,921,049',
          maNDKT: '1001' // PIT
        }
      ]
    };

    const detailMap = new Map<string, any>([['53864244', gntDetail]]);
    const matched = TaxPaymentMatcher.matchPayments([vatObligation], [gntRecord], detailMap);

    // BẮT BUỘC KHÔNG ĐƯỢC MATCH vì xung đột sắc thuế PIT vs VAT
    expect(matched[0].matchedPaymentAmount).toBe(0n);
    expect(matched[0].matchedSlips).toHaveLength(0);
    expect(matched[0].status).toBe('PAST_DEADLINE_NO_MATCHED_PAYMENT');
  });

  // ── 6. ADVERSARIAL: METAMORPHIC TEST (ARRAY SHUFFLE) ─────────────────────
  it('6. Metamorphic test: Array order shuffle does not change matching outcomes', () => {
    const ob1 = createMockObligation({
      id: 'ob_1',
      taxType: 'PIT',
      periodLabel: 'Tháng 11/2025',
      month: 11,
      year: 2025,
      amountPayable: 10000000n
    });

    const ob2 = createMockObligation({
      id: 'ob_2',
      taxType: 'PIT',
      periodLabel: 'Tháng 12/2025',
      month: 12,
      year: 2025,
      amountPayable: 20000000n
    });

    const slip1: any = { id: 's1', soGnt: 'GNT1', soTien: 10000000, trangThai: 'Nộp thuế thành công', ngayNopThue: '15/12/2025' };
    const slip2: any = { id: 's2', soGnt: 'GNT2', soTien: 20000000, trangThai: 'Nộp thuế thành công', ngayNopThue: '15/01/2026' };

    const detail1: any = { id: 's1', tongTienVND: '10,000,000', items: [{ stt: 1, kyThueNgayQd: '00/11/2025', soTienVND: '10,000,000', maNDKT: '1001' }] };
    const detail2: any = { id: 's2', tongTienVND: '20,000,000', items: [{ stt: 1, kyThueNgayQd: '00/12/2025', soTienVND: '20,000,000', maNDKT: '1001' }] };
    const map = new Map<string, any>([['s1', detail1], ['s2', detail2]]);

    const resForward = TaxPaymentMatcher.matchPayments([ob1, ob2], [slip1, slip2], map);
    const resReverse = TaxPaymentMatcher.matchPayments([ob2, ob1], [slip2, slip1], map);

    expect(resForward[0].matchedPaymentAmount).toBe(10000000n);
    expect(resForward[1].matchedPaymentAmount).toBe(20000000n);
    expect(resReverse[0].matchedPaymentAmount).toBe(10000000n);
    expect(resReverse[1].matchedPaymentAmount).toBe(20000000n);
  });

  // ── 7. COVERAGE SUMMARY CALCULATION ──────────────────────────────────────
  it('7. Calculates accurate GNT coverage summary', () => {
    const slips: any[] = [
      { id: '1', soTien: 50000000, trangThai: 'Nộp thuế thành công' },
      { id: '2', soTien: 20000000, trangThai: 'Nộp thuế thành công' }
    ];
    const details = new Map<string, any>([
      ['1', { id: '1', tongTienVND: '50,000,000', items: [{ stt: 1, soTienVND: '50,000,000' }] }]
    ]);

    const summary = TaxPaymentMatcher.calculateCoverageSummary(slips, details);
    expect(summary.listCount).toBe(2);
    expect(summary.detailRequested).toBe(2);
    expect(summary.detailParsed).toBe(1);
    expect(summary.status).toBe('PARTIAL');
  });
});

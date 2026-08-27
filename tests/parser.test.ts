import { describe, expect, it } from 'vitest';
import { TaxFilingParser } from '../src/main/scanner/TaxFilingParser';
import { TaxFiling } from '../src/shared/types';

describe('TaxFilingParser & DOM Integrity', () => {
  it('should classify tax types accurately based on procedure code and title', () => {
    expect(TaxFilingParser.classifyTaxType('1.007014', 'Khai thuế GTGT')).toBe('VAT');
    expect(TaxFilingParser.classifyTaxType('1.008346', 'Khai quyết toán TNDN')).toBe('CIT');
    expect(TaxFilingParser.classifyTaxType('1.008347', 'Khấu trừ thuế TNCN')).toBe('PIT');
    expect(TaxFilingParser.classifyTaxType('1.008333', 'Thuế nhà thầu Mẫu 01/NTNN', '01/NTNN')).toBe('FCT');
    expect(TaxFilingParser.classifyTaxType('1.008344', 'Khai thuế nhà thầu nước ngoài 01/NTNN')).toBe('FCT');
    expect(TaxFilingParser.classifyTaxType(undefined, 'Tờ khai thuế NTNN mẫu 02/NTNN', '02/NTNN')).toBe('FCT');
    expect(TaxFilingParser.classifyTaxType(undefined, 'Báo cáo tình hình sử dụng hóa đơn BC26')).toBe('REPORT');
    expect(TaxFilingParser.classifyTaxType(undefined, 'Thủ tục gia hạn thuế')).toBe('OTHER');
  });

  it('should parse filing types strictly without guessing (Original vs Supplemental vs UNKNOWN)', () => {
    expect(TaxFilingParser.parseFilingType('Khai lần đầu')).toEqual({ filingType: 'ORIGINAL' });
    expect(TaxFilingParser.parseFilingType('Tờ khai chính thức')).toEqual({ filingType: 'ORIGINAL' });
    expect(TaxFilingParser.parseFilingType('Bổ sung lần 1')).toEqual({ filingType: 'SUPPLEMENTAL', supplementalNo: 1, isSequenceInferred: false });
    expect(TaxFilingParser.parseFilingType('BS lần 3')).toEqual({ filingType: 'SUPPLEMENTAL', supplementalNo: 3, isSequenceInferred: false });
    expect(TaxFilingParser.parseFilingType('BS')).toEqual({ filingType: 'SUPPLEMENTAL' });
    // Unknown cases must not default to SUPPLEMENTAL 1 or ORIGINAL
    expect(TaxFilingParser.parseFilingType('Đăng ký thuế lần đầu cho người phụ thuộc')).toEqual({ filingType: 'ORIGINAL' });
    expect(TaxFilingParser.parseFilingType('Thủ tục điều chỉnh thông tin')).toEqual({ filingType: 'UNKNOWN' });
    expect(TaxFilingParser.parseFilingType('')).toEqual({ filingType: 'UNKNOWN' });
  });

  it('should clean HTML comments and avoid garbage like --> --> <!-- in portal status', () => {
    const dirtyHtml = `
      <table>
        <tbody>
          <tr>
            <td>1</td>
            <td>3702735709</td>
            <td>1.008500</td>
            <td><a href="/tthc/tchs/files/detail/000.701.18.G12-251226-27110000025488?loai=">1.008500 - Đăng ký thuế lần đầu cho NPT</a></td>
            <td><!-- comment 1 --> <!-- comment 2 --> Đã tiếp nhận <!-- comment 3 --></td>
          </tr>
        </tbody>
      </table>
    `;

    const filings = TaxFilingParser.parseHtmlSearchResults(dirtyHtml);
    expect(filings).toHaveLength(1);
    expect(filings[0].id).toBe('000.701.18.G12-251226-27110000025488');
    expect(filings[0].status).not.toContain('-->');
    expect(filings[0].status).not.toContain('<!--');
    expect(filings[0].status).toBe('Đã tiếp nhận');
  });

  it('should set submittedAt to undefined if portal has missing/invalid date instead of fabricating', () => {
    const noDateHtml = `
      <table>
        <tbody>
          <tr>
            <td>1</td>
            <td>3702735709</td>
            <td>1.007014</td>
            <td><a href="/tthc/tchs/files/detail/000.701.18.G12-251219-27110000132363?loai=">1.007014 - Khai thuế GTGT</a></td>
            <td>---</td>
            <td>Đã chấp nhận</td>
          </tr>
        </tbody>
      </table>
    `;

    const filings = TaxFilingParser.parseHtmlSearchResults(noDateHtml);
    expect(filings).toHaveLength(1);
    expect(filings[0].submittedAt).toBeUndefined();
  });

  it('should DEDUPLICATE by filing ID while preserving ALL supplemental versions', () => {
    const list1: TaxFiling[] = [
      {
        id: 'FILING_01_LAN_DAU',
        title: '01/GTGT T01/2026',
        taxType: 'VAT',
        filingType: 'ORIGINAL',
        downloadAvailable: true
      },
      {
        id: 'FILING_01_BS_1',
        title: '01/GTGT T01/2026 Bổ sung 1',
        taxType: 'VAT',
        filingType: 'SUPPLEMENTAL',
        supplementalNo: 1,
        downloadAvailable: true
      }
    ];

    const list2: TaxFiling[] = [
      {
        id: 'FILING_01_BS_1',
        title: '01/GTGT T01/2026 Bổ sung 1',
        taxType: 'VAT',
        filingType: 'SUPPLEMENTAL',
        supplementalNo: 1,
        downloadAvailable: true
      },
      {
        id: 'FILING_02_LAN_DAU',
        title: '01/GTGT T02/2026',
        taxType: 'VAT',
        filingType: 'ORIGINAL',
        downloadAvailable: true
      }
    ];

    const merged = TaxFilingParser.deduplicateFilings(list1, list2);
    expect(merged).toHaveLength(3);
    expect(merged.map(m => m.id)).toEqual(['FILING_01_LAN_DAU', 'FILING_01_BS_1', 'FILING_02_LAN_DAU']);
  });

  it('should correctly parse PIT and TDT filing indicators from portal HTML', () => {
    const html = `
      <table>
        <tbody>
          <tr data-ma-ho-so="000.701.18.G12-251219-27110000999999">
            <td>1</td>
            <td>0100109106</td>
            <td>1.008347</td>
            <td><a href="javascript:void(0)" onclick="downloadHoSo('000.701.18.G12-251219-27110000999999', true, '1')">1.008347 - Khai thuế thu nhập cá nhân</a></td>
            <td>05/KK-TNCN</td>
            <td>Quý 4/2025</td>
            <td>Tờ khai chính thức</td>
            <td>Đã chấp nhận</td>
            <td>20/01/2026</td>
          </tr>
        </tbody>
      </table>
    `;

    const filings = TaxFilingParser.parseHtmlSearchResults(html);
    expect(filings).toHaveLength(1);
    expect(filings[0].id).toBe('000.701.18.G12-251219-27110000999999');
    expect(filings[0].taxType).toBe('PIT');
    expect(filings[0].declarationCode).toBe('05/KK-TNCN');
    expect(filings[0].isThueDienTu).toBe(true);
    expect(filings[0].maTkhai).toBeUndefined();
    expect(filings[0].altIds).toBeUndefined();
  });
  it('should keep the portal tax-form key without adding the taxpayer ID as a download variant', () => {
    const html = `
      <table><tbody><tr>
        <td>1</td>
        <td>
          <i data-ma-tkhai="864" data-ma-ho-so="G12.18-260720-00118136" data-is-tdt="N"></i>
        </td>
        <td>G12.18-260720-00118136</td>
        <td>2.002235 - Khai thuế thu nhập cá nhân</td>
        <td>05/KK-TNCN - Tờ khai thuế thu nhập cá nhân</td>
        <td>Q2/2026</td><td>Chính thức</td><td>0</td><td>1</td>
        <td>Cơ quan thuế</td><td>20/07/2026</td><td>Đã chấp nhận</td>
      </tr></tbody></table>
    `;
    const [filing] = TaxFilingParser.parseHtmlSearchResults(html);
    expect(filing.id).toBe('G12.18-260720-00118136');
    expect(filing.maTkhai).toBe('864');
    expect(filing.altIds).toEqual(['864']);
    expect(filing.altIds).not.toContain('3701415632');
    expect(filing.isThueDienTu).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { VatXmlParser } from '../src/main/scanner/VatXmlParser';
import { TaxFiling } from '../src/shared/types';

describe('VAT XML Parser Tests', () => {
  it('1. Parse file XML Thông tư 80/2021/TT-BTC chuẩn', () => {
    const mockXml = `<?xml version="1.0" encoding="UTF-8"?>
<HSoThueDTu>
  <TTinChung>
    <kyKKhai>01/2026</kyKKhai>
    <soLan>0</soLan>
  </TTinChung>
  <CTietTKhaiChinh>
    <ct22>50000000</ct22>
    <ct23>1000000000</ct23>
    <ct24>100000000</ct24>
    <ct25>95000000</ct25>
    <ct34>1500000000</ct34>
    <ct35>150000000</ct35>
    <ct40>5000000</ct40>
    <ct43>0</ct43>
  </CTietTKhaiChinh>
</HSoThueDTu>`;

    const filing: TaxFiling = {
      id: 'TK_001',
      title: 'Tờ khai thuế GTGT',
      taxType: 'VAT',
      declarationCode: '01/GTGT',
      period: '01/2026',
      submittedAt: '15/02/2026 10:30',
      filingType: 'ORIGINAL',
      downloadAvailable: true
    };

    const snapshot = VatXmlParser.parseVatXml(mockXml, filing, '3702735709');

    expect(snapshot.period.normalizedKey).toBe('2026-M01');
    expect(snapshot.declarationType).toBe('ORIGINAL');
    expect(snapshot.ct22_thueDauVaoKyTruoc).toBe(50000000n);
    expect(snapshot.ct23_giaTriMuaVao).toBe(1000000000n);
    expect(snapshot.ct24_thueMuaVao).toBe(100000000n);
    expect(snapshot.ct25_thueKhauTruKyNay).toBe(95000000n);
    expect(snapshot.ct34_doanhThuBanRa).toBe(1500000000n);
    expect(snapshot.ct35_thueBanRa).toBe(150000000n);
    expect(snapshot.ct40_thuePhaiNop).toBe(5000000n);
    expect(snapshot.ct43_thueKhauTruChuyenKySau).toBe(0n);
    expect(snapshot.allIndicators['25'].name).toBe('Tổng thuế GTGT được khấu trừ kỳ này');
  });

  it('2. Parse tờ khai Bổ sung lần 2', () => {
    const mockXmlBs = `<?xml version="1.0" encoding="UTF-8"?>
<HSoThueDTu>
  <TTinChung>
    <kyKKhai>01/2026</kyKKhai>
    <soLan>2</soLan>
  </TTinChung>
  <CTietTKhaiChinh>
    <ct22>50000000</ct22>
    <ct24>120000000</ct24>
    <ct25>120000000</ct25>
    <ct35>180000000</ct35>
    <ct40>10000000</ct40>
    <ct43>0</ct43>
  </CTietTKhaiChinh>
</HSoThueDTu>`;

    const filing: TaxFiling = {
      id: 'TK_002',
      title: 'Tờ khai bổ sung GTGT',
      taxType: 'VAT',
      declarationCode: '01/GTGT',
      period: '01/2026',
      submittedAt: '14/07/2026 14:20',
      filingType: 'SUPPLEMENTAL',
      supplementalNo: 2,
      downloadAvailable: true
    };

    const snapshot = VatXmlParser.parseVatXml(mockXmlBs, filing, '3702735709');

    expect(snapshot.declarationType).toBe('SUPPLEMENTAL');
    expect(snapshot.supplementalNo).toBe(2);
    expect(snapshot.ct25_thueKhauTruKyNay).toBe(120000000n);
    expect(snapshot.ct35_thueBanRa).toBe(180000000n);
    expect(snapshot.ct40_thuePhaiNop).toBe(10000000n);
  });

  it('3. Parse file XML có XML Namespaces (tns:, dvc:)', () => {
    const mockXmlNs = `<?xml version="1.0" encoding="UTF-8"?>
<tns:HSoThueDTu xmlns:tns="http://kekhaithue.gdt.gov.vn">
  <tns:TTinChung>
    <tns:kyKKhai>02/2026</tns:kyKKhai>
    <tns:soLan>1</tns:soLan>
  </tns:TTinChung>
  <tns:CTietTKhaiChinh>
    <tns:ct22>30000000</tns:ct22>
    <tns:ct23>500000000</tns:ct23>
    <tns:ct24>50000000</tns:ct24>
    <tns:ct25>50000000</tns:ct25>
    <tns:ct34>800000000</tns:ct34>
    <tns:ct35>80000000</tns:ct35>
    <tns:ct40>0</tns:ct40>
    <tns:ct43>0</tns:ct43>
  </tns:CTietTKhaiChinh>
</tns:HSoThueDTu>`;

    const filing: TaxFiling = {
      id: 'TK_NS_003',
      title: 'Tờ khai bổ sung GTGT',
      taxType: 'VAT',
      declarationCode: '01/GTGT',
      period: '02/2026',
      submittedAt: '20/03/2026 09:00',
      filingType: 'ORIGINAL',
      downloadAvailable: true
    };

    const snapshot = VatXmlParser.parseVatXml(mockXmlNs, filing, '3702735709');

    expect(snapshot.period.normalizedKey).toBe('2026-M02');
    expect(snapshot.declarationType).toBe('SUPPLEMENTAL');
    expect(snapshot.supplementalNo).toBe(1);
    expect(snapshot.ct22_thueDauVaoKyTruoc).toBe(30000000n);
    expect(snapshot.ct25_thueKhauTruKyNay).toBe(50000000n);
    expect(snapshot.ct34_doanhThuBanRa).toBe(800000000n);
    expect(snapshot.ct35_thueBanRa).toBe(80000000n);
    expect(snapshot.parseStatus).toBe('SUCCESS');
    expect(snapshot.xmlAvailable).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { FilingPreviewParser } from '../src/main/scanner/FilingPreviewParser';
import { TaxFiling } from '../src/shared/types';

describe('Filing Quick Preview In-Memory Parser', () => {
  it('1. Extracts VAT declaration indicators from XML in RAM', () => {
    const mockFiling: TaxFiling = {
      id: '000.701.18.G12-251219-27110000132363',
      title: 'Khai thuế GTGT đối với phương pháp khấu trừ',
      taxType: 'VAT',
      period: 'Tháng 11/2025',
      submittedAt: '19/12/2025 14:59',
      filingType: 'ORIGINAL',
      downloadAvailable: true
    };

    const mockXml = `
      <HSoThueDTu>
        <TTinChung>
          <maTKhai>01/GTGT</maTKhai>
          <tenTKhai>Tờ khai thuế giá trị gia tăng</tenTKhai>
        </TTinChung>
        <CTieuTKhaiChinh>
          <ct22>15000000</ct22>
          <ct23>500000000</ct23>
          <ct24>50000000</ct24>
          <ct25>50000000</ct25>
          <ct34>800000000</ct34>
          <ct35>80000000</ct35>
          <ct40>15000000</ct40>
          <ct43>0</ct43>
        </CTieuTKhaiChinh>
      </HSoThueDTu>
    `;

    // Package into base64 zip in memory
    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    zip.addFile('01_GTGT.xml', Buffer.from(mockXml, 'utf-8'));
    const zipBase64 = zip.toBuffer().toString('base64');

    const preview = FilingPreviewParser.parsePreview(mockFiling, zipBase64);

    expect(preview.filingId).toBe(mockFiling.id);
    expect(preview.title).toBe(mockFiling.title);
    expect(preview.period).toBe('Tháng 11/2025');
    expect(preview.xmlAvailable).toBe(true);

    const ct34 = preview.metrics.find(m => m.code === '[34]');
    expect(ct34).toBeDefined();
    expect(ct34?.value).toBe('800000000');
    expect(ct34?.type).toBe('money');

    const ct40 = preview.metrics.find(m => m.code === '[40]');
    expect(ct40).toBeDefined();
    expect(ct40?.value).toBe('15000000');
    expect(ct40?.type).toBe('money');
  });

  it('2. Extracts PIT declaration indicators from XML in RAM', () => {
    const mockFiling: TaxFiling = {
      id: '000.701.18.G12-251226-27110000025488',
      title: 'Tờ khai khấu trừ thuế thu nhập cá nhân',
      taxType: 'PIT',
      period: 'Quý 3/2025',
      filingType: 'ORIGINAL',
      downloadAvailable: true
    };

    const mockXml = `
      <HSoThueDTu>
        <TTinChung>
          <maTKhai>05/KK-TNCN</maTKhai>
        </TTinChung>
        <CTieuTKhaiChinh>
          <ct21>45</ct21>
          <ct22>40</ct22>
          <ct27>650000000</ct27>
          <ct31>28000000</ct31>
        </CTieuTKhaiChinh>
      </HSoThueDTu>
    `;

    const AdmZip = require('adm-zip');
    const zip = new AdmZip();
    zip.addFile('05_KK_TNCN.xml', Buffer.from(mockXml, 'utf-8'));
    const zipBase64 = zip.toBuffer().toString('base64');

    const preview = FilingPreviewParser.parsePreview(mockFiling, zipBase64);

    expect(preview.taxType).toBe('PIT');
    const ct21 = preview.metrics.find(m => m.code === '[21]');
    expect(ct21?.value).toBe('45');
    expect(ct21?.type).toBe('quantity');
    expect(ct21?.unit).toBe('người');
    expect(ct21?.group).toBe('NHÂN SỰ');

    const ct27 = preview.metrics.find(m => m.code === '[27]');
    expect(ct27?.value).toBe('650000000');
    expect(ct27?.type).toBe('money');
    expect(ct27?.group).toBe('THU NHẬP & NGHĨA VỤ THUẾ');
  });

  it('3. Generates fallback metadata for other filings without XML', () => {
    const mockFiling: TaxFiling = {
      id: '000.701.18.G12-251110-27110000075616',
      title: 'Hoàn thuế giá trị gia tăng đối với hàng hóa, dịch vụ xuất khẩu',
      taxType: 'REFUND',
      period: 'Năm 2025',
      filingType: 'ORIGINAL',
      downloadAvailable: true
    };

    const preview = FilingPreviewParser.parsePreview(mockFiling);

    expect(preview.metrics.length).toBeGreaterThan(0);
    expect(preview.metrics.some(m => m.label.includes('Mã số hồ sơ'))).toBe(true);
  });
});

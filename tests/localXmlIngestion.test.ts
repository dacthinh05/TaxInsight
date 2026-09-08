import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';
import { LocalXmlIngestionEngine } from '../src/main/files/LocalXmlIngestionEngine';
import { VatXmlParser } from '../src/main/scanner/VatXmlParser';
import { PitXmlParser } from '../src/main/scanner/PitXmlParser';
import { PitFlowEngine } from '../src/shared/PitFlowEngine';

describe('LocalXmlIngestionEngine Tests', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tax_xml_test_'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  const sampleVatXml = `<?xml version="1.0" encoding="UTF-8"?>
<HSoThueDTu>
  <TTinChung>
    <mst>0101234567</mst>
    <tenNNT>CÔNG TY TNHH MINH BẢO</tenNNT>
    <maTKhai>01/GTGT</maTKhai>
    <kyKKhai>01/2026</kyKKhai>
    <soLan>0</soLan>
    <ngayNop>15/02/2026 09:15:00</ngayNop>
  </TTinChung>
  <CTietTKhaiChinh>
    <ct22>20000000</ct22>
    <ct23>500000000</ct23>
    <ct24>50000000</ct24>
    <ct25>50000000</ct25>
    <ct34>800000000</ct34>
    <ct35>80000000</ct35>
    <ct40>10000000</ct40>
    <ct43>0</ct43>
  </CTietTKhaiChinh>
</HSoThueDTu>`;

  const sampleVatSupplementalXml = `<?xml version="1.0" encoding="UTF-8"?>
<HSoThueDTu>
  <TTinChung>
    <mst>0101234567</mst>
    <tenNNT>CÔNG TY TNHH MINH BẢO</tenNNT>
    <maTKhai>01/GTGT</maTKhai>
    <kyKKhai>01/2026</kyKKhai>
    <soLan>1</soLan>
    <ngayNop>20/03/2026 14:00:00</ngayNop>
  </TTinChung>
  <CTietTKhaiChinh>
    <ct22>20000000</ct22>
    <ct23>600000000</ct23>
    <ct24>60000000</ct24>
    <ct25>60000000</ct25>
    <ct34>800000000</ct34>
    <ct35>80000000</ct35>
    <ct40>0</ct40>
    <ct43>0</ct43>
  </CTietTKhaiChinh>
</HSoThueDTu>`;

  const samplePitQttXml = `<?xml version="1.0" encoding="UTF-8"?>
<HSoThueDTu>
  <TTinChung>
    <mst>0101234567</mst>
    <tenNNT>CÔNG TY TNHH MINH BẢO</tenNNT>
    <maTKhai>05/QTT-TNCN</maTKhai>
    <kyKKhai>2025</kyKKhai>
    <soLan>0</soLan>
    <ngayNop>28/03/2026 11:20:00</ngayNop>
  </TTinChung>
  <CTietTKhaiChinh>
    <ct21>15</ct21>
    <ct24>1200000000</ct24>
    <ct27>600000000</ct27>
    <ct36>30000000</ct36>
    <ct41>5000000</ct41>
  </CTietTKhaiChinh>
</HSoThueDTu>`;

  it('1. parseXmlContent bóc tách chính xác tờ khai 01/GTGT chính thức', () => {
    const filePath = path.join(tempDir, '01_GTGT_T01_2026.xml');
    fs.writeFileSync(filePath, sampleVatXml, 'utf-8');

    const entry = LocalXmlIngestionEngine.parseXmlContent(sampleVatXml, filePath);
    expect(entry).not.toBeNull();
    expect(entry?.taxCode).toBe('0101234567');
    expect(entry?.declarationCode).toBe('01/GTGT');
    expect(entry?.taxType).toBe('VAT');
    expect(entry?.periodNormalized?.year).toBe(2026);
    expect(entry?.periodNormalized?.month).toBe(1);
    expect(entry?.filingType).toBe('ORIGINAL');
    expect(entry?.supplementalNo).toBe(0);
    expect(entry?.filing.source).toBe('local-xml');
    expect(entry?.filing.downloadedFiles?.xml).toBe(filePath);

    // Xác minh VatXmlParser parse được chỉ tiêu chuẩn xác từ filing này
    const snapshot = VatXmlParser.parseVatXml(sampleVatXml, entry!.filing, entry!.taxCode);
    expect(snapshot.ct22_thueDauVaoKyTruoc).toBe(20000000n);
    expect(snapshot.ct40_thuePhaiNop).toBe(10000000n);
  });

  it('2. parseXmlContent nhận diện đúng tờ khai GTGT bổ sung lần 1', () => {
    const filePath = path.join(tempDir, '01_GTGT_T01_2026_BS1.xml');
    fs.writeFileSync(filePath, sampleVatSupplementalXml, 'utf-8');

    const entry = LocalXmlIngestionEngine.parseXmlContent(sampleVatSupplementalXml, filePath);
    expect(entry).not.toBeNull();
    expect(entry?.filingType).toBe('SUPPLEMENTAL');
    expect(entry?.supplementalNo).toBe(1);
    expect(entry?.filing.title).toContain('Bổ sung lần 1');
  });

  it('3. parseXmlContent nhận diện đúng tờ khai quyết toán TNCN 05/QTT-TNCN', () => {
    const filePath = path.join(tempDir, '05_QTT_TNCN_2025.xml');
    fs.writeFileSync(filePath, samplePitQttXml, 'utf-8');

    const entry = LocalXmlIngestionEngine.parseXmlContent(samplePitQttXml, filePath);
    expect(entry).not.toBeNull();
    expect(entry?.declarationCode).toBe('05/QTT-TNCN');
    expect(entry?.taxType).toBe('PIT');
    expect(entry?.periodNormalized?.year).toBe(2025);
    expect(entry?.periodNormalized?.type).toBe('YEAR');

    const snapshot = PitXmlParser.parsePitXml(samplePitQttXml, entry!.filing, entry!.taxCode);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.isFinalization).toBe(true);
    expect(snapshot?.ct21_tongSoNguoiLaoDong).toBe(15n);
    expect(snapshot?.ct24_tongThuNhapChiuThue).toBe(1200000000n);
  });

  it('4. ingestDirectory quét đệ quy các thư mục con và tệp ZIP', async () => {
    // Tạo cấu trúc thư mục lồng nhau
    const subDir1 = path.join(tempDir, 'Q1_2026');
    const subDir2 = path.join(tempDir, 'Q2_2026', 'nested');
    fs.mkdirSync(subDir1, { recursive: true });
    fs.mkdirSync(subDir2, { recursive: true });

    fs.writeFileSync(path.join(subDir1, 'vat_t1.xml'), sampleVatXml, 'utf-8');
    fs.writeFileSync(path.join(subDir2, 'vat_t1_bs.xml'), sampleVatSupplementalXml, 'utf-8');

    // Tạo thêm 1 file ZIP chứa tờ khai TNCN
    const zip = new AdmZip();
    zip.addFile('pit_qtt.xml', Buffer.from(samplePitQttXml, 'utf-8'));
    const zipPath = path.join(tempDir, 'extra_filings.zip');
    zip.writeZip(zipPath);

    // Ghi 1 file rác (không phải XML)
    fs.writeFileSync(path.join(tempDir, 'notes.txt'), 'Ghi chú của kế toán', 'utf-8');

    const workspaceDir = path.join(tempDir, 'workspace');
    fs.mkdirSync(workspaceDir, { recursive: true });

    const result = await LocalXmlIngestionEngine.ingestDirectory(tempDir, workspaceDir);

    expect(result.success).toBe(true);
    expect(result.importedCount).toBe(3); // 2 file XML + 1 file XML trong ZIP
    expect(result.primaryTaxCode).toBe('0101234567');
    expect(result.years).toContain(2026);
    expect(result.years).toContain(2025);

    // Kiểm tra file XML đã được sao chép vào workspace chuẩn
    const destDir = path.join(workspaceDir, '0101234567_2026');
    expect(fs.existsSync(destDir)).toBe(true);
    const manifestPath = path.join(destDir, '.tax_manifest.json');
    expect(fs.existsSync(manifestPath)).toBe(true);
    const manifestJson = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(Object.keys(manifestJson).length).toBeGreaterThanOrEqual(1);
  });
});

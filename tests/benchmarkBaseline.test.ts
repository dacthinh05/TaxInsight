import { describe, expect, it } from 'vitest';
import { BenchmarkHarness } from '../src/main/engine/BenchmarkHarness';
import { VatXmlParser } from '../src/main/scanner/VatXmlParser';
import { PitXmlParser } from '../src/main/scanner/PitXmlParser';
import { VatFlowEngine } from '../src/shared/vatFlowEngine';
import { TaxFiling } from '../src/shared/types';
import AdmZip from 'adm-zip';

describe('PHASE A — Baseline Performance Measurement', () => {
  const generateMockVatXml = (period: string, ct22: number, ct35: number, ct43: number) => `<?xml version="1.0" encoding="UTF-8"?>
  <HSoThueDTu>
    <TTinChung>
      <maTKhai>01/GTGT</maTKhai>
      <kyKKhai>${period}</kyKKhai>
    </TTinChung>
    <CTietTKhaiChinh>
      <ct22>${ct22}</ct22>
      <ct23>500000000</ct23>
      <ct24>50000000</ct24>
      <ct25>50000000</ct25>
      <ct34>600000000</ct34>
      <ct35>${ct35}</ct35>
      <ct43>${ct43}</ct43>
    </CTietTKhaiChinh>
  </HSoThueDTu>`;

  it('Measure Baseline XML Parse (5, 20, 50, 100 records)', () => {
    BenchmarkHarness.clear();
    const counts = [5, 20, 50, 100];

    for (const count of counts) {
      for (let i = 0; i < count; i++) {
        const xml = generateMockVatXml(`0${(i % 12) + 1}/2025`, 10000000 * i, 15000000 * i, 5000000 * i);
        const filing: TaxFiling = {
          id: `BENCH_VAT_${i}`,
          procedureCode: '1.008346',
          declarationCode: '01/GTGT',
          title: 'Tờ khai thuế GTGT',
          taxType: 'VAT',
          period: `Tháng 0${(i % 12) + 1}/2025`,
          submittedAt: '20/02/2025 08:30:00',
          filingType: 'ORIGINAL',
          status: 'Đã chấp nhận',
          downloadAvailable: true
        };

        BenchmarkHarness.measureSync(`BASELINE_XML_PARSE_${count}`, () => {
          return VatXmlParser.parseVatXml(xml, filing, '3702735709');
        });
      }

      const report = BenchmarkHarness.getReport(`BASELINE_XML_PARSE_${count}`);
      expect(report).not.toBeNull();
      expect(report?.samplesCount).toBe(count);
      console.log(`[Baseline Report] XML Parse ${count} records: Avg = ${report?.avgMs}ms, P95 = ${report?.p95Ms}ms, Max = ${report?.maxMs}ms, Total = ${report?.totalMs}ms`);
    }
  });

  it('Measure Full Zip vs Fast Entry XML Extraction', () => {
    // Tạo mock ZIP chứa 1 file XML (2KB) và 2 file PDF dummy (mỗi file 500KB)
    const zip = new AdmZip();
    const xmlContent = generateMockVatXml('06/2025', 10000000, 20000000, 5000000);
    zip.addFile('ToKhai_01_GTGT.xml', Buffer.from(xmlContent, 'utf-8'));
    zip.addFile('ThongBaoTiepNhan.pdf', Buffer.alloc(500 * 1024, 0));
    zip.addFile('BanTheHien.pdf', Buffer.alloc(500 * 1024, 0));
    const zipBuffer = zip.toBuffer();

    // 1. Full extraction baseline
    for (let i = 0; i < 10; i++) {
      BenchmarkHarness.measureSync('FULL_ZIP_EXTRACT', () => {
        const z = new AdmZip(zipBuffer);
        const entries = z.getEntries();
        for (const entry of entries) {
          if (entry.entryName.endsWith('.xml')) {
            return entry.getData().toString('utf-8');
          }
        }
        return null;
      });
    }

    const report = BenchmarkHarness.getReport('FULL_ZIP_EXTRACT');
    expect(report).not.toBeNull();
    expect(report?.samplesCount).toBe(10);
    console.log(`[Baseline Report] Full Zip Extraction: Avg = ${report?.avgMs}ms, P95 = ${report?.p95Ms}ms, Max = ${report?.maxMs}ms`);
  });
});

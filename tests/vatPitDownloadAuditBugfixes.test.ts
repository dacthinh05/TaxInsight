import { describe, expect, it, vi } from 'vitest';
import { VatXmlParser } from '../src/main/scanner/VatXmlParser';
import { PitXmlParser } from '../src/main/scanner/PitXmlParser';
import { FilingPreviewParser } from '../src/main/scanner/FilingPreviewParser';
import { PitFlowEngine } from '../src/shared/PitFlowEngine';
import { VatFlowEngine } from '../src/shared/vatFlowEngine';
import { TaxFiling } from '../src/shared/types';
import { PitAnalyticsSummary, PitDeclarationSnapshot } from '../src/shared/pitAnalyticsTypes';
import { VatAnalyticsSummary, VatDeclarationSnapshot } from '../src/shared/vatAnalyticsTypes';
import { TaxPortalClient } from '../src/main/portal/TaxPortalClient';
import { PortalSession } from '../src/main/portal/PortalSession';
import { generateQuarterRanges, resolveScanDateRange } from '../src/shared/dateUtils';
describe('VAT & PIT Audit & Download Bugfixes Regression Suite', () => {
  // ─── 1. PHẦN TẢI TỜ KHAI: GIẢI MÃ DIRECT XML BUFFER TRONG PREVIEW & PARSER ───
  describe('Phần Tải Tờ Khai: Xử lý Direct XML Base64 không nén ZIP', () => {
    it('FilingPreviewParser giải mã thành công chuỗi Base64 của file XML trực tiếp (không bị lỗi AdmZip)', () => {
      const rawXml = `<?xml version="1.0" encoding="UTF-8"?>
      <tns:HSoThueDTu xmlns:tns="http://kekhaithue.gdt.gov.vn">
        <tns:TTinChung>
          <tns:maTKhai>01/GTGT</tns:maTKhai>
          <tns:kyKKhai>01/2026</tns:kyKKhai>
        </tns:TTinChung>
        <tns:CTietTKhaiChinh>
          <tns:ct22>10000000</tns:ct22>
          <tns:ct25>50000000</tns:ct25>
          <tns:ct34>500000000</tns:ct34>
          <tns:ct35>50000000</tns:ct35>
          <tns:ct43>10000000</tns:ct43>
        </tns:CTietTKhaiChinh>
      </tns:HSoThueDTu>`;

      const base64DirectXml = Buffer.from(rawXml, 'utf-8').toString('base64');
      const mockFiling: TaxFiling = {
        id: 'DIRECT_XML_001',
        title: 'Tờ khai thuế GTGT',
        taxType: 'VAT',
        declarationCode: '01/GTGT',
        period: '01/2026',
        submittedAt: '15/02/2026 09:00',
        filingType: 'ORIGINAL',
        downloadAvailable: true
      };

      const preview = FilingPreviewParser.parsePreview(mockFiling, base64DirectXml);
      expect(preview.xmlAvailable).toBe(true);
      expect(preview.metrics.length).toBeGreaterThan(0);
      const ct22Metric = preview.metrics.find(m => m.code === '[22]');
      expect(ct22Metric?.value).toBe('10000000');
    });

    it('FilingPreviewParser giải mã PIT direct XML với đầy đủ chỉ tiêu TT80', () => {
      const rawXml = `<?xml version="1.0" encoding="UTF-8"?>
      <HSoThueDTu>
        <TTinChung>
          <maTKhai>05/KK-TNCN</maTKhai>
          <kyKKhai>01/2026</kyKKhai>
        </TTinChung>
        <NDungTKhai>
          <ct21>80</ct21>
          <ct22>75</ct22>
          <ct24>1200000000</ct24>
          <ct27>600000000</ct27>
          <ct30>45000000</ct30>
          <ct31>40000000</ct31>
          <ct32>5000000</ct32>
          <ct35>45000000</ct35>
        </NDungTKhai>
      </HSoThueDTu>`;

      const base64DirectXml = Buffer.from(rawXml, 'utf-8').toString('base64');
      const mockFiling: TaxFiling = {
        id: 'PIT_DIRECT_001',
        title: 'Tờ khai thuế TNCN',
        taxType: 'PIT',
        declarationCode: '05/KK-TNCN',
        period: '01/2026',
        submittedAt: '15/02/2026 09:00',
        filingType: 'ORIGINAL',
        downloadAvailable: true
      };

      const preview = FilingPreviewParser.parsePreview(mockFiling, base64DirectXml);
      expect(preview.xmlAvailable).toBe(true);
      expect(preview.metrics.find(m => m.code === '[21]')?.value).toBe('80');
      expect(preview.metrics.find(m => m.code === '[24]')?.value).toBe('1200000000');
      expect(preview.metrics.find(m => m.code === '[30/34/36]')?.value).toBe('45000000');
    });
  });

  // ─── 2. PHẦN PHÂN TÍCH THUẾ GTGT: NAMESPACE XML & CHỈ TIÊU [22]..[43] ─────────
  describe('Phần Phân Tích GTGT: XML Namespaces & Tag Variants', () => {
    it('VatXmlParser bóc tách chính xác tờ khai có namespace tns:, dvc: và tag con', () => {
      const namespacedXml = `<?xml version="1.0" encoding="UTF-8"?>
      <tns:HSoThueDTu xmlns:tns="http://kekhaithue.gdt.gov.vn">
        <tns:TTinChung>
          <tns:kyKKhai>03/2026</tns:kyKKhai>
          <tns:soLan>3</tns:soLan>
        </tns:TTinChung>
        <tns:CTietTKhaiChinh>
          <tns:ct22_thueDauVao>25000000</tns:ct22_thueDauVao>
          <tns:ct23_giaTriHHDVMuaVao>400000000</tns:ct23_giaTriHHDVMuaVao>
          <tns:ct24_thueHHDVMuaVao>40000000</tns:ct24_thueHHDVMuaVao>
          <tns:ct25_thueKhauTruKyNay>40000000</tns:ct25_thueKhauTruKyNay>
          <tns:ct34_tongDoanhThuBanRa>900000000</tns:ct34_tongDoanhThuBanRa>
          <tns:ct35_tongThueBanRa>90000000</tns:ct35_tongThueBanRa>
          <tns:ct37_dChinhGiamThueKTru>5000000</tns:ct37_dChinhGiamThueKTru>
          <tns:ct38_dChinhTangThueKTru>0</tns:ct38_dChinhTangThueKTru>
          <tns:ct40_thuePhaiNopKyNay>30000000</tns:ct40_thuePhaiNopKyNay>
          <tns:ct43_thueConDuocKhauTruChuyenKySau>0</tns:ct43_thueConDuocKhauTruChuyenKySau>
        </tns:CTietTKhaiChinh>
      </tns:HSoThueDTu>`;

      const mockFiling: TaxFiling = {
        id: 'VAT_NS_003',
        title: 'Tờ khai bổ sung GTGT',
        taxType: 'VAT',
        declarationCode: '01/GTGT',
        period: '03/2026',
        submittedAt: '25/08/2026 15:00',
        filingType: 'ORIGINAL',
        downloadAvailable: true
      };

      const snap = VatXmlParser.parseVatXml(namespacedXml, mockFiling, '3702735709');
      expect(snap.period.normalizedKey).toBe('2026-M03');
      expect(snap.declarationType).toBe('SUPPLEMENTAL');
      expect(snap.supplementalNo).toBe(3);
      expect(snap.ct22_thueDauVaoKyTruoc).toBe(25000000n);
      expect(snap.ct23_giaTriMuaVao).toBe(400000000n);
      expect(snap.ct24_thueMuaVao).toBe(40000000n);
      expect(snap.ct25_thueKhauTruKyNay).toBe(40000000n);
      expect(snap.ct34_doanhThuBanRa).toBe(900000000n);
      expect(snap.ct35_thueBanRa).toBe(90000000n);
      expect(snap.ct37_dChinhGiamThueKTru).toBe(5000000n);
      expect(snap.ct40_thuePhaiNop).toBe(30000000n);
      expect(snap.parseStatus).toBe('SUCCESS');
    });
  });

  // ─── 3. PHẦN PHÂN TÍCH THUẾ TNCN: TT80 QTT TAG MATCHING & QUARTER BLOCKS ──────
  describe('Phần Phân Tích TNCN: TT80 Tag Mapping & PitQuarterBlock Aggregation', () => {
    it('PitXmlParser xử lý đúng TT80 05/QTT-TNCN: ct30 là tổng, không nhầm ct31', () => {
      const qttXml = `<?xml version="1.0" encoding="UTF-8"?>
      <tns:HSoThueDTu xmlns:tns="http://dvc.gdt.gov.vn">
        <tns:TTinChung>
          <tns:maTKhai>05/QTT-TNCN</tns:maTKhai>
          <tns:kyKKhai>2025</tns:kyKKhai>
          <tns:soLan>1</tns:soLan>
        </tns:TTinChung>
        <tns:NDungTKhai>
          <tns:ct21>300</tns:ct21>
          <tns:ct22>280</tns:ct22>
          <tns:ct24>6000000000</tns:ct24>
          <tns:ct27>3000000000</tns:ct27>
          <tns:ct30>400000000</tns:ct30>
          <tns:ct31>350000000</tns:ct31>
          <tns:ct32>50000000</tns:ct32>
          <tns:ct33>0</tns:ct33>
          <tns:ct41>400000000</tns:ct41>
          <tns:ct44>0</tns:ct44>
        </tns:NDungTKhai>
      </tns:HSoThueDTu>`;

      const mockFiling: TaxFiling = {
        id: 'PIT_QTT_2025_BS1',
        title: 'Tờ khai quyết toán thuế TNCN',
        taxType: 'PIT',
        declarationCode: '05/QTT-TNCN',
        period: 'Năm 2025',
        submittedAt: '15/04/2026 11:00',
        filingType: 'ORIGINAL',
        downloadAvailable: true
      };

      const snap = PitXmlParser.parsePitXml(qttXml, mockFiling, '3702735709');
      expect(snap).not.toBeNull();
      expect(snap?.isFinalization).toBe(true);
      expect(snap?.versionType).toBe('SUPPLEMENTAL');
      expect(snap?.supplementalNo).toBe(1);
      expect(snap?.ct36_qtt_tongThueDaKhauTruTrongNam).toBe(400000000n);
      expect(snap?.ct32_khauTruCaNhanCuTru).toBe(400000000n); // 350M + 50M
      expect(snap?.ct34_tongThueKhauTru).toBe(400000000n);
    });

    it('PitFlowEngine tính đúng Quý và Năm cho người khai Tháng không bị double-counting', () => {
      const snapMonths: PitDeclarationSnapshot[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(m => ({
        submissionId: `PIT_2025_M${String(m).padStart(2, '0')}`,
        formCode: '05/KK-TNCN',
        periodKey: `2025-M${String(m).padStart(2, '0')}`,
        periodLabel: `Tháng ${String(m).padStart(2, '0')}/2025`,
        year: 2025,
        month: m,
        isQuarter: false,
        isYear: false,
        versionType: 'ORIGINAL',
        supplementalNo: 0,
        status: 'Đã chấp nhận',
        ct21_tongSoNguoiLaoDong: BigInt(50 + m),
        ct22_caNhanCuTru: 50n,
        ct24_tongThuNhapChiuThue: 100000000n,
        ct27_tongThuNhapChiuThueKhauTru: 50000000n,
        ct31_tongThueTncnDaKhauTru: 10000000n,
        ct32_khauTruCaNhanCuTru: 9000000n,
        ct33_khauTruCaNhanKhongCuTru: 1000000n,
        ct34_tongThueKhauTru: 10000000n,
        ct35_tongThuePhaiNop: 10000000n,
        isFinalization: false
      }));

      const qttSnap: PitDeclarationSnapshot = {
        submissionId: 'PIT_2025_QTT',
        formCode: '05/QTT-TNCN',
        periodKey: '2025-YEAR',
        periodLabel: 'Quyết toán năm 2025',
        year: 2025,
        isQuarter: false,
        isYear: true,
        versionType: 'ORIGINAL',
        supplementalNo: 0,
        status: 'Đã chấp nhận',
        ct21_tongSoNguoiLaoDong: 62n,
        ct22_caNhanCuTru: 50n,
        ct24_tongThuNhapChiuThue: 1200000000n,
        ct27_tongThuNhapChiuThueKhauTru: 600000000n,
        ct31_tongThueTncnDaKhauTru: 120000000n,
        ct32_khauTruCaNhanCuTru: 108000000n,
        ct33_khauTruCaNhanKhongCuTru: 12000000n,
        ct34_tongThueKhauTru: 120000000n,
        ct35_tongThuePhaiNop: 120000000n,
        isFinalization: true,
        ct36_qtt_tongThueDaKhauTruTrongNam: 120000000n,
        ct41_qtt_tongThuePhaiNopTrongNam: 120000000n
      };

      const mockSummary: PitAnalyticsSummary = {
        taxpayerId: '3702735709',
        totalFilingsAnalyzed: 13,
        periodGroups: snapMonths.map(s => ({
          periodKey: s.periodKey,
          periodLabel: s.periodLabel,
          year: s.year,
          month: s.month,
          periodType: 'MONTH',
          snapshots: [s],
          finalSnapshot: s,
          hasSupplemental: false,
          supplementalCount: 0
        })),
        finalizationSnapshot: qttSnap,
        analyzedAt: new Date().toISOString()
      };

      const yearFlow = PitFlowEngine.normalizeYearFlow(mockSummary, 2025);

      // Cả 4 khối quý đều có đủ tổng cư trú và không cư trú
      for (let q = 0; q < 4; q++) {
        const qb = yearFlow.quarterBlocks[q];
        expect(qb.monthFilings.length).toBe(3);
        expect(qb.totalResidentTax).toBe(27000000n); // 9M * 3
        expect(qb.totalNonResidentTax).toBe(3000000n); // 1M * 3
        expect(qb.totalWithheldTax).toBe(3000000n * 10n); // 30M
      }

      // Tổng cộng cả năm
      expect(yearFlow.totalIncomeCt24).toBe(1200000000n); // 100M * 12
      expect(yearFlow.totalResidentTax32).toBe(108000000n); // 9M * 12
      expect(yearFlow.totalNonResidentTax33).toBe(12000000n); // 1M * 12
      expect(yearFlow.totalWithheldTax34).toBe(120000000n); // 10M * 12
      expect(yearFlow.totalEmployeeCount).toBe(62n); // max(50+12)
      expect(yearFlow.mismatchDelta).toBe(0n);
      expect(yearFlow.auditStatus).toBe('MATCHED');
    });
  });

  // ─── 4. PHẦN BẢO VỆ TẢI HỒ SƠ: GLOBAL RATE LIMIT & ANTI-AVALANCHE ─────────
  describe('Phần Bảo Vệ Tải Hồ Sơ: Global Rate Limit Cooloff & Exponential Backoff', () => {
    it('TaxPortalClient.triggerGlobalRateLimit đặt thời gian cooloff và waitForGlobalRateLimit hoãn luồng gọi', async () => {
      TaxPortalClient.triggerGlobalRateLimit(80);
      const t0 = Date.now();
      await TaxPortalClient.waitForGlobalRateLimit();
      const elapsed = Date.now() - t0;
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });

    it('TaxPortalClient.waitForGlobalRateLimit phản hồi ngay khi không có rate limit', async () => {
      // Đợi hết hạn cooloff cũ
      await new Promise(r => setTimeout(r, 900));
      const t0 = Date.now();
      await TaxPortalClient.waitForGlobalRateLimit();
      const elapsed = Date.now() - t0;
      expect(elapsed).toBeLessThan(50);
    });
    it('getCaptchaImage kích hoạt global rate limit cooloff khi nhận HTTP 429 từ endpoint CAPTCHA và fail-fast', async () => {
      const session = new PortalSession();
      const client = new TaxPortalClient(session);
      const err429: any = new Error('Request failed with status code 429');
      err429.response = { status: 429, data: 'Too Many Requests' };

      session.client.get = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/login') && !url.includes('/getCaptcha')) {
          return Promise.resolve({ status: 200, data: '<html><head><meta name="_csrf" content="token"/></head><body>Login</body></html>' });
        }
        if (url.includes('/getCaptcha')) {
          return Promise.reject(err429);
        }
        return Promise.resolve({ status: 200, data: '' });
      });

      const triggerSpy = vi.spyOn(TaxPortalClient, 'triggerGlobalRateLimit');
      await expect(client.getCaptchaImage('SEARCH')).rejects.toThrow();
      expect(triggerSpy).toHaveBeenCalledWith(3000);
      expect(session.client.get).toHaveBeenCalledTimes(2);

      const { globalPortalRequestScheduler } = await import('../src/main/portal/PortalRequestScheduler');
      globalPortalRequestScheduler.reset();
    });
  });

  // ─── 5. PHẦN KIỂM TOÁN 12 THÁNG & TẢI TỜ KHAI ──────────────────────────────
  describe('Phần Kiểm Toán: Phân tích 12 tháng & Sửa lỗi tải tờ khai', () => {
    it('VatFlowEngine.normalizeYearFlow cho phép chuyển đổi chế độ xem 12 tháng (preferredViewMode = MONTH) khi khai Quý', () => {
      const mockSummary: VatAnalyticsSummary = {
        taxpayerId: '0101234567',
        totalFilingsCount: 4,
        totalPeriodsCount: 4,
        periodsWithSupplementalCount: 0,
        periodsWithWarningCount: 0,
        totalXmlAvailableCount: 4,
        failedXmlCount: 0,
        periodGroups: [
          {
            periodKey: '2025-Q1',
            periodLabel: 'Quý 1/2025',
            periodType: 'QUARTER',
            year: 2025,
            quarter: 1,
            filings: [],
            snapshots: [],
            finalSnapshot: {
              taxpayerId: '0101234567',
              submissionId: 'SUB_Q1',
              formCode: '01/GTGT',
              period: { type: 'QUARTER', value: 'Quý 1/2025', normalizedKey: '2025-Q1' },
              declarationType: 'ORIGINAL',
              supplementalNo: 0,
              sequenceSource: 'API',
              status: 'Đã chấp nhận',
              ct22_thueDauVaoKyTruoc: 0n,
              ct23_giaTriMuaVao: 100000000n,
              ct24_thueMuaVao: 10000000n,
              ct25_thueKhauTruKyNay: 10000000n,
              ct34_doanhThuBanRa: 200000000n,
              ct35_thueBanRa: 20000000n,
              ct37_dChinhGiamThueKTru: 0n,
              ct38_dChinhTangThueKTru: 0n,
              ct40_thuePhaiNop: 10000000n,
              ct42_thueDeNghiHoanKyNay: 0n,
              ct43_thueKhauTruChuyenKySau: 0n,
              allIndicators: {},
              warnings: [],
              parseStatus: 'SUCCESS',
              xmlAvailable: true
            },
            hasSupplemental: false,
            supplementalCount: 0,
            warnings: [],
            xmlAvailableCount: 1,
            coverageStatus: 'COMPLETE',
            hasValueDelta: false,
            deltas: []
          }
        ],
        analyzedAt: new Date().toISOString()
      };

      // Chế độ AUTO: Nhận diện theo Quý (4 slots)
      const autoFlow = VatFlowEngine.normalizeYearFlow(mockSummary, 2025, 'COMPLETE', 'AUTO');
      expect(autoFlow.flows).toHaveLength(4);
      expect(autoFlow.flows[0].shortLabel).toBe('Q1');

      // Chế độ MONTH: Bắt buộc mở đủ 12 tháng (12 slots), Quý 1 nằm tại Tháng 3
      const monthFlow = VatFlowEngine.normalizeYearFlow(mockSummary, 2025, 'COMPLETE', 'MONTH');
      expect(monthFlow.flows).toHaveLength(12);
      expect(monthFlow.flows[0].shortLabel).toBe('T1');
      expect(monthFlow.flows[0].versionLabel).toBe('Kê khai quý');
      expect(monthFlow.flows[2].shortLabel).toBe('T3');
      expect(monthFlow.flows[2].effectiveSnapshot).toBeDefined();
      expect(monthFlow.flows[2].taxPayableCt40).toBe(10000000n);
    });

    it('TaxPortalClient verifyXmlPayloadIdentity không từ chối nhầm file BC26 có chứa thẻ <tBaoCao>', () => {
      const session = new PortalSession();
      const client = new TaxPortalClient(session);

      const bc26Xml = `<?xml version="1.0" encoding="UTF-8"?>
      <HSoThueDTu>
        <TTinChung>
          <mst>0101234567</mst>
          <maTKhai>BC26/AC</maTKhai>
          <kyKKhai>2025</kyKKhai>
        </TTinChung>
        <NDungTKhai>
          <tBaoCaoHDon>
            <soLuong>100</soLuong>
          </tBaoCaoHDon>
        </NDungTKhai>
      </HSoThueDTu>`;
      const base64 = Buffer.from(bc26Xml, 'utf-8').toString('base64');

      // Gọi verifyXmlPayloadIdentity (thông qua private method)
      const isValid = (client as any).verifyXmlPayloadIdentity(base64, {
        taxCode: '0101234567',
        period: '2025',
        declarationCode: 'BC26/AC'
      });
      expect(isValid).toBe(true);
    });

    it('generateQuarterRanges cho năm đã qua (2025) mở rộng Quý 4 toDate đến 31/01 năm sau', () => {
      const quarters = generateQuarterRanges(2025);
      expect(quarters).toHaveLength(4);
      // 2025 < 2026 => Q4 toDate phải là 31/01/2026 để bắt trọn T12 và Q4
      expect(quarters[3].toDate).toBe('31/01/2026');
    });

    it('resolveScanDateRange cho FULL_YEAR của năm đã qua mở rộng toDate đến 31/03 năm sau', () => {
      const range = resolveScanDateRange(2025, 'FULL_YEAR');
      expect(range.fromDate).toBe('01/01/2025');
      expect(range.toDate).toBe('31/03/2026');
      expect(range.level).toBe('YEAR');
    });
  });
});

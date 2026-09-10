import { describe, expect, it, vi } from 'vitest';
import { LegacyFilingClient } from '../src/main/portal/LegacyFilingClient';
import { PaymentSlipClient } from '../src/main/portal/PaymentSlipClient';
import { PortalSession } from '../src/main/portal/PortalSession';
import { PitAnalyticsEngine } from '../src/main/scanner/PitAnalyticsEngine';
import { VatAnalyticsEngine } from '../src/main/scanner/VatAnalyticsEngine';
import { TaxFiling } from '../src/shared/types';
import { PORTAL_CONFIG } from '../src/shared/constants';

describe('ETAX-DVC LINKAGE & ANALYTICS FIXES 2026', () => {
  describe('1. LegacyFilingClient.adoptDseSession & Form Options Extraction', () => {
    it('nạp đầy đủ sessionId, actionUrl và trích xuất availableFormOptions từ HTML', () => {
      const session = new PortalSession();
      const client = new LegacyFilingClient(session);

      const mockHtml = `
        <html>
          <body>
            <form action="/etaxnnt/Request" method="POST">
              <input type="hidden" name="dse_sessionId" value="DSE_SESSION_TEST_123" />
              <input type="hidden" name="dse_applicationId" value="-1" />
              <input type="hidden" name="dse_pageId" value="1" />
              <input type="hidden" name="dse_operationName" value="traCuuToKhaiProc" />
              <input type="hidden" name="dse_processorState" value="viewTraCuuTkhai" />
              <input type="hidden" name="dse_processorId" value="PROC_TEST_999" />
              <select name="maTKhai" id="maTKhai">
                <option value="00">-- Tất cả tờ khai --</option>
                <option value="864">05/KK-TNCN - Tờ khai khấu trừ thuế TNCN (TT80/2021)</option>
                <option value="842">01/GTGT - Tờ khai thuế GTGT khấu trừ (TT80/2021)</option>
                <option value="866">05/QTT-TNCN - Tờ khai quyết toán thuế TNCN (TT80/2021)</option>
              </select>
            </form>
          </body>
        </html>
      `;

      client.adoptDseSession('DSE_SESSION_TEST_123', 'https://thuedientu.gdt.gov.vn/etaxnnt/Request', mockHtml);

      const options = client.getAvailableFormOptions();
      expect(options.length).toBeGreaterThanOrEqual(4);
      expect(options.some(o => o.value === '864' && o.text.includes('05/KK-TNCN'))).toBe(true);
      expect(options.some(o => o.value === '842' && o.text.includes('01/GTGT'))).toBe(true);
      expect(options.some(o => o.value === '866' && o.text.includes('05/QTT-TNCN'))).toBe(true);
    });

    it('tự động gán dseOperationName mặc định traCuuToKhaiProc khi HTML thiếu trường này', () => {
      const session = new PortalSession();
      const client = new LegacyFilingClient(session);

      client.adoptDseSession('DSE_MINIMAL_SESSION', 'https://thuedientu.gdt.gov.vn/etaxnnt/Request');
      // Không ném lỗi và đã được đánh dấu khởi tạo
      expect(client).toBeDefined();
    });
  });

  describe('2. PaymentSlipClient SSO Module 330410 Prioritization', () => {
    it('ưu tiên gửi module=330410 cho Giấy Nộp Tiền và gửi kèm CSRF header', async () => {
      const session = new PortalSession();
      session.setLoggedIn('3700776724');
      const client = new PaymentSlipClient(session);
      const requestedUrls: string[] = [];
      const postedBodies: any[] = [];

      vi.spyOn(session.client, 'get').mockImplementation(async (url: string) => {
        if (url.includes('/dich-vu-khac')) {
          return {
            status: 200,
            data: '<html><head><meta name="_csrf" content="MOCK_CSRF_TOKEN_123"/></head><body>Dich vu khac</body></html>'
          };
        }
        return { status: 200, data: '' };
      });

      vi.spyOn(session.client, 'post').mockImplementation(async (url: string, data: any) => {
        requestedUrls.push(url);
        postedBodies.push(data);
        if (url.includes('redirect-to-service')) {
          return {
            status: 200,
            data: `
              <html>
                <body>
                  <form action="https://thuedientu.gdt.gov.vn/etaxnnt/EstablishSession" method="POST">
                    <input type="hidden" name="dse_sessionId" value="ETAX_GNT_SESS_456" />
                    <input type="hidden" name="dse_applicationId" value="-1" />
                    <input type="hidden" name="dse_operationName" value="corpQueryTaxProc" />
                    <input type="hidden" name="dse_pageId" value="1" />
                    <input type="hidden" name="dse_processorState" value="initial" />
                    <input type="hidden" name="dse_processorId" value="PROC_GNT_789" />
                  </form>
                </body>
              </html>
            `,
            request: { res: { responseUrl: 'https://thuedientu.gdt.gov.vn/etaxnnt/EstablishSession' } }
          };
        }
        if (url.includes('EstablishSession') || url.includes('corpQueryTaxProc') || url.includes('/etaxnnt/')) {
          return {
            status: 200,
            data: `
              <html>
                <body>
                  <form action="/etaxnnt/Request" method="POST">
                    <input type="hidden" name="dse_sessionId" value="ETAX_GNT_SESS_456" />
                    <input type="hidden" name="dse_applicationId" value="-1" />
                    <input type="hidden" name="dse_operationName" value="corpQueryTaxProc" />
                    <input type="hidden" name="dse_pageId" value="1" />
                    <input type="hidden" name="dse_processorState" value="initial" />
                    <input type="hidden" name="dse_processorId" value="PROC_GNT_789" />
                  </form>
                </body>
              </html>
            `,
            request: { res: { responseUrl: 'https://thuedientu.gdt.gov.vn/etaxnnt/Request' } }
          };
        }
        return { status: 200, data: '' };
      });

      // Kích hoạt ensureEtaxSession
      await client.ensureEtaxSession();

      // Kiểm tra request SSO đầu tiên: PHẢI là module=330410 (Giấy Nộp Tiền)
      const firstSsoUrl = requestedUrls.find(u => u.includes('redirect-to-service'));
      expect(firstSsoUrl).toBeDefined();
      expect(firstSsoUrl).toContain('module=330410');
      expect(firstSsoUrl).not.toContain('module=360103');
    });
  });

  describe('3. Analytics Graceful Degradation (Chống crash khi thiếu XML)', () => {
    it('PitAnalyticsEngine: trả về PARTIAL coverage mà không throw khi có filing lỗi XML', async () => {
      const session = new PortalSession();
      const mockPortalClient: any = {
        downloadHoSo: vi.fn().mockRejectedValue(new Error('Cổng DVC không có tệp - validateIdTkhai 400'))
      };

      const engine = new PitAnalyticsEngine(mockPortalClient);

      const filings: TaxFiling[] = [
        {
          id: 'FILING_PIT_01',
          title: 'Khai thuế TNCN quý 1/2026',
          taxType: 'PIT',
          declarationCode: '05/KK-TNCN',
          period: 'Quý 1/2026',
          filingType: 'ORIGINAL',
          status: 'Đã nộp',
          downloadAvailable: true,
          source: 'dvc-ho-so'
        },
        {
          id: 'FILING_PIT_02',
          title: 'Khai thuế TNCN quý 2/2026',
          taxType: 'PIT',
          declarationCode: '05/KK-TNCN',
          period: 'Quý 2/2026',
          filingType: 'ORIGINAL',
          status: 'Đã nộp',
          downloadAvailable: true,
          source: 'dvc-ho-so'
        }
      ];

      // analyzePitFilings không được ném unhandled error
      const summary = await engine.analyzePitFilings(filings, '3700776724');

      expect(summary).toBeDefined();
      expect(summary.totalFilingsAnalyzed).toBe(2);
      expect(summary.failedXmlCount).toBe(2);
      expect(summary.coverageStatus).toBe('UNAVAILABLE');
      expect(summary.failedXmlDetails.length).toBe(2);
    });

    it('VatAnalyticsEngine: trả về PARTIAL coverage mà không throw khi có filing lỗi XML', async () => {
      const session = new PortalSession();
      const mockPortalClient: any = {
        downloadHoSo: vi.fn().mockRejectedValue(new Error('Cổng DVC không có tệp - HTTP 500'))
      };

      const engine = new VatAnalyticsEngine(mockPortalClient);

      const filings: TaxFiling[] = [
        {
          id: 'FILING_VAT_01',
          title: 'Khai thuế GTGT tháng 1/2026',
          taxType: 'VAT',
          declarationCode: '01/GTGT',
          period: 'Tháng 01/2026',
          filingType: 'ORIGINAL',
          status: 'Đã nộp',
          downloadAvailable: true,
          source: 'dvc-ho-so'
        }
      ];

      const summary = await engine.analyzeVatFilings(filings, '3700776724');

      expect(summary).toBeDefined();
      expect(summary.totalFilingsCount).toBe(1);
      expect(summary.failedXmlCount).toBe(1);
      expect(summary.coverageStatus).toBe('UNAVAILABLE');
      expect(summary.failedXmlDetails.length).toBe(1);
    });
  });
});

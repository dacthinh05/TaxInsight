import { describe, expect, it, vi } from 'vitest';
import { LegacyFilingClient } from '../src/main/portal/LegacyFilingClient';
import { PortalSession } from '../src/main/portal/PortalSession';
import { TaxFiling } from '../src/shared/types';

describe('LegacyFilingClient: resolveAndDownloadFiling Fixes Suite', () => {
  it('1. Đảm bảo gọi ensureEtaxSession trước khi lọc availableFormOptions', async () => {
    const session = new PortalSession();
    const client = new LegacyFilingClient(session);

    let sessionEnsured = false;
    vi.spyOn(client, 'ensureEtaxSession').mockImplementation(async () => {
      sessionEnsured = true;
      (client as any).availableFormOptions = [
        { value: '842', text: '01/GTGT - TỜ KHAI THUẾ GTGT (TT80/2021)', kieuKy: 'M' },
        { value: '01', text: '01/GTGT - Tờ khai thuế GTGT', kieuKy: 'Q' }
      ];
    });

    const querySpy = vi.spyOn(client, 'queryFilings').mockResolvedValue({
      filings: [
        {
          id: '11320260199887766',
          messageId: '11320260199887766',
          declarationCode: '01/GTGT',
          title: '01/GTGT-TỜ KHAI THUẾ GIÁ TRỊ GIA TĂNG (TT80/2021)',
          period: '07/2026',
          periodNormalized: { type: 'MONTH', year: 2026, month: 7, raw: '07/2026' },
          submittedAt: '20/08/2026 07:41:15',
          filingType: 'ORIGINAL',
          taxType: 'VAT',
          downloadAvailable: true
        }
      ],
      historicalRecords: [],
      pagination: { currentPage: 1, totalPages: 1, totalRecords: 1, hasNextPage: false },
      isEmpty: false,
      isFormChanged: false
    });

    const downloadSpy = vi.spyOn(client, 'downloadFiling').mockResolvedValue({
      dataBuffer: Buffer.from('<xml>OK</xml>'),
      fileName: '01_GTGT_07_2026.xml',
      contentType: 'application/xml'
    });

    const filing: TaxFiling = {
      id: 'G12.18-260820-00005022',
      declarationCode: '01/GTGT',
      title: 'Khai thuế GTGT đối với phương pháp khấu trừ đối với hoạt động sản xuất kinh doanh',
      period: 'Tháng 07/2026',
      periodNormalized: { type: 'MONTH', year: 2026, month: 7, raw: 'Tháng 07/2026' },
      submittedAt: '20/08/2026 07:41',
      filingType: 'ORIGINAL',
      supplementalNo: 0,
      taxType: 'VAT',
      downloadAvailable: true
    };

    const res = await client.resolveAndDownloadFiling('3700776724-ql', filing);

    expect(sessionEnsured).toBe(true);
    expect(querySpy).toHaveBeenCalled();
    // Khẳng định truy vấn ưu tiên mã 842 (khớp kieuKy: M cho tờ khai tháng)
    const firstCallOpts = querySpy.mock.calls[0][1];
    expect(firstCallOpts?.maTKhai).toBe('842');
    expect(firstCallOpts?.kieuKy).toBe('M');
    // Khẳng định toDate cho năm hiện tại không bao giờ là tương lai 31/12/2026
    expect(firstCallOpts?.toDate).not.toBe('31/12/2026');
    expect(downloadSpy).toHaveBeenCalledWith('11320260199887766', undefined);
    expect(res.fileName).toBe('01_GTGT_07_2026.xml');
  });

  it('2. Ưu tiên filing.maTkhai từ DVC nếu đã được trích xuất sẵn từ trước', async () => {
    const session = new PortalSession();
    const client = new LegacyFilingClient(session);

    vi.spyOn(client, 'ensureEtaxSession').mockImplementation(async () => {
      (client as any).availableFormOptions = [
        { value: '864', text: '05/KK-TNCN - Tờ khai khấu trừ thuế TNCN (TT80/2021)', kieuKy: 'M' },
        { value: '05', text: '05/KK-TNCN - Tờ khai khấu trừ thuế TNCN', kieuKy: 'Q' }
      ];
    });

    const querySpy = vi.spyOn(client, 'queryFilings').mockResolvedValue({
      filings: [
        {
          id: '20120260000997415',
          messageId: '20120260000997415',
          declarationCode: '05/KK-TNCN',
          title: '05/KK-TNCN-Tờ khai khấu trừ thuế TNCN',
          period: '07/2026',
          periodNormalized: { type: 'MONTH', year: 2026, month: 7, raw: '07/2026' },
          submittedAt: '20/08/2026 08:30:00',
          filingType: 'ORIGINAL',
          taxType: 'PIT',
          downloadAvailable: true
        }
      ],
      historicalRecords: [],
      pagination: { currentPage: 1, totalPages: 1, totalRecords: 1, hasNextPage: false },
      isEmpty: false,
      isFormChanged: false
    });

    vi.spyOn(client, 'downloadFiling').mockResolvedValue({
      dataBuffer: Buffer.from('<xml>TNCN</xml>'),
      fileName: '05_KK_TNCN.xml',
      contentType: 'application/xml'
    });

    const filing: TaxFiling = {
      id: 'G12.18-260820-00007788',
      maTkhai: '864',
      declarationCode: '05/KK-TNCN',
      title: 'Khai thuế TNCN khấu trừ',
      period: 'Tháng 07/2026',
      periodNormalized: { type: 'MONTH', year: 2026, month: 7, raw: 'Tháng 07/2026' },
      submittedAt: '20/08/2026 08:30',
      filingType: 'ORIGINAL',
      supplementalNo: 0,
      taxType: 'PIT',
      downloadAvailable: true
    };

    await client.resolveAndDownloadFiling('3700776724-ql', filing);

    expect(querySpy).toHaveBeenCalled();
    const firstCallOpts = querySpy.mock.calls[0][1];
    expect(firstCallOpts?.maTKhai).toBe('864');
    expect(firstCallOpts?.kieuKy).toBe('M');
  });

  it('3. Ưu tiên khớp bản ghi eTax có cùng ngày nộp khi có nhiều bản ghi cùng kỳ', async () => {
    const session = new PortalSession();
    const client = new LegacyFilingClient(session);

    vi.spyOn(client, 'ensureEtaxSession').mockResolvedValue();

    vi.spyOn(client, 'queryFilings').mockResolvedValue({
      filings: [
        {
          id: 'msg_other_day',
          messageId: 'msg_other_day',
          declarationCode: '01/GTGT',
          title: '01/GTGT',
          period: '07/2026',
          submittedAt: '15/08/2026 10:00:00',
          filingType: 'ORIGINAL',
          taxType: 'VAT',
          downloadAvailable: true
        },
        {
          id: 'msg_exact_day',
          messageId: 'msg_exact_day',
          declarationCode: '01/GTGT',
          title: '01/GTGT',
          period: '07/2026',
          submittedAt: '20/08/2026 07:41:00',
          filingType: 'ORIGINAL',
          taxType: 'VAT',
          downloadAvailable: true
        }
      ],
      historicalRecords: [],
      pagination: { currentPage: 1, totalPages: 1, totalRecords: 2, hasNextPage: false },
      isEmpty: false,
      isFormChanged: false
    });

    const downloadSpy = vi.spyOn(client, 'downloadFiling').mockResolvedValue({
      dataBuffer: Buffer.from('<xml>EXACT</xml>'),
      fileName: 'exact.xml',
      contentType: 'application/xml'
    });

    const filing: TaxFiling = {
      id: 'G12.18-260820-00005022',
      declarationCode: '01/GTGT',
      title: 'Khai thuế GTGT',
      period: 'Tháng 07/2026',
      submittedAt: '20/08/2026 07:41',
      filingType: 'ORIGINAL',
      taxType: 'VAT',
      downloadAvailable: true
    };

    await client.resolveAndDownloadFiling('3700776724-ql', filing);

    expect(downloadSpy).toHaveBeenCalledWith('msg_exact_day', undefined);
  });
});

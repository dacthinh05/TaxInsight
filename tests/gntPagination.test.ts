import { describe, expect, it, vi } from 'vitest';
import { PaymentSlipClient } from '../src/main/portal/PaymentSlipClient';
import { PortalSession } from '../src/main/portal/PortalSession';
import { PaymentSlipRecord } from '../src/shared/types';

describe('GNT Multi-Page Pagination Suite', () => {
  it('should automatically paginate through multiple pages and deduplicate records', async () => {
    const mockSession = new PortalSession();
    const client = new PaymentSlipClient(mockSession);

    const page1Records: PaymentSlipRecord[] = Array.from({ length: 10 }, (_, i) => ({
      id: `CTU_${i + 1}`,
      stt: i + 1,
      maGiaoDich: `TX_${i + 1}`,
      soGnt: `GNT_${i + 1}`,
      soTien: (i + 1) * 1000000,
      soTienFormatted: `${i + 1}.000.000`,
      loaiTien: 'VND',
      trangThai: 'Nộp thuế thành công',
      ngayLapGnt: '15/01/2026',
      downloadAvailable: true
    }));

    const page2Records: PaymentSlipRecord[] = Array.from({ length: 10 }, (_, i) => ({
      id: `CTU_${i + 11}`,
      stt: i + 11,
      maGiaoDich: `TX_${i + 11}`,
      soGnt: `GNT_${i + 11}`,
      soTien: (i + 11) * 1000000,
      soTienFormatted: `${i + 11}.000.000`,
      loaiTien: 'VND',
      trangThai: 'Nộp thuế thành công',
      ngayLapGnt: '15/02/2026',
      downloadAvailable: true
    }));

    const page3Records: PaymentSlipRecord[] = Array.from({ length: 3 }, (_, i) => ({
      id: `CTU_${i + 21}`,
      stt: i + 21,
      maGiaoDich: `TX_${i + 21}`,
      soGnt: `GNT_${i + 21}`,
      soTien: (i + 21) * 1000000,
      soTienFormatted: `${i + 21}.000.000`,
      loaiTien: 'VND',
      trangThai: 'Nộp thuế thành công',
      ngayLapGnt: '15/03/2026',
      downloadAvailable: true
    }));

    // Mock queryPaymentSlips
    vi.spyOn(client, 'queryPaymentSlips').mockImplementation(async (query) => {
      const page = query.page || 1;
      if (page === 1) return { success: true, data: page1Records };
      if (page === 2) return { success: true, data: page2Records };
      if (page === 3) return { success: true, data: page3Records };
      return { success: true, data: [] };
    });

    const mockRange = { fromDate: '01/01/2026', toDate: '31/12/2026', label: '2026', level: 'YEAR' as const };
    const allSlips = await client.searchPaymentSlips(mockRange);

    expect(allSlips).toHaveLength(23);
    expect(allSlips[0].id).toBe('CTU_1');
    expect(allSlips[9].id).toBe('CTU_10');
    expect(allSlips[10].id).toBe('CTU_11');
    expect(allSlips[22].id).toBe('CTU_23');
  });

  it('should terminate single-page results via zero-new-records guard (no hardcoded page size)', async () => {
    const mockSession = new PortalSession();
    const client = new PaymentSlipClient(mockSession);

    const singlePageRecords: PaymentSlipRecord[] = [
      {
        id: 'CTU_ONLY_1',
        stt: 1,
        maGiaoDich: 'TX_001',
        soGnt: 'GNT_001',
        soTien: 5000000,
        soTienFormatted: '5.000.000',
        loaiTien: 'VND',
        trangThai: 'Nộp thuế thành công',
        downloadAvailable: true
      },
      {
        id: 'CTU_ONLY_2',
        stt: 2,
        maGiaoDich: 'TX_002',
        soGnt: 'GNT_002',
        soTien: 8000000,
        soTienFormatted: '8.000.000',
        loaiTien: 'VND',
        trangThai: 'Nộp thuế thành công',
        downloadAvailable: true
      }
    ];

    // Trang 2+ trả về cùng dữ liệu (server lặp trang cuối) -> guard "không có bản ghi mới" phải dừng
    const spy = vi.spyOn(client, 'queryPaymentSlips').mockResolvedValue({
      success: true,
      data: singlePageRecords
    });

    const mockRange = { fromDate: '01/01/2026', toDate: '31/12/2026', label: '2026', level: 'YEAR' as const };
    const results = await client.searchPaymentSlips(mockRange);

    expect(results).toHaveLength(2);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('should collect all pages regardless of page size (e.g. 12-record pages)', async () => {
    const mockSession = new PortalSession();
    const client = new PaymentSlipClient(mockSession);

    const mkRecords = (from: number, count: number) => Array.from({ length: count }, (_, i) => ({
      id: `CTU_${from + i}`,
      stt: from + i,
      maGiaoDich: `TX_${from + i}`,
      soGnt: `GNT_${from + i}`,
      soTien: 1000000,
      soTienFormatted: '1.000.000',
      loaiTien: 'VND',
      trangThai: 'Nộp thuế thành công',
      ngayLapGnt: '15/01/2026',
      downloadAvailable: true
    }));

    vi.spyOn(client, 'queryPaymentSlips').mockImplementation(async (query) => {
      const page = query.page || 1;
      if (page === 1) return { success: true, data: mkRecords(1, 12) };
      if (page === 2) return { success: true, data: mkRecords(13, 12) };
      if (page === 3) return { success: true, data: mkRecords(25, 7) };
      return { success: true, data: [] };
    });

    const mockRange = { fromDate: '01/01/2026', toDate: '31/12/2026', label: '2026', level: 'YEAR' as const };
    const all = await client.searchPaymentSlips(mockRange);

    expect(all).toHaveLength(31);
  });

  it('should THROW instead of silently returning partial data when a mid-page fails', async () => {
    const mockSession = new PortalSession();
    const client = new PaymentSlipClient(mockSession);

    const fullPage = Array.from({ length: 20 }, (_, i) => ({
      id: `CTU_${i + 1}`,
      stt: i + 1,
      maGiaoDich: `TX_${i + 1}`,
      soGnt: `GNT_${i + 1}`,
      soTien: 1000000,
      soTienFormatted: '1.000.000',
      loaiTien: 'VND',
      trangThai: 'Nộp thuế thành công',
      ngayLapGnt: '15/01/2026',
      downloadAvailable: true
    })) as PaymentSlipRecord[];

    vi.spyOn(client, 'queryPaymentSlips').mockImplementation(async (query) => {
      if ((query.page || 1) === 1) return { success: true, data: fullPage };
      return { success: false, data: [], error: 'Lỗi kết nối', errorCode: 'CONNECTIVITY_ERROR' };
    });

    const mockRange = { fromDate: '01/01/2026', toDate: '31/12/2026', label: '2026', level: 'YEAR' as const };

    await expect(client.searchPaymentSlips(mockRange)).rejects.toMatchObject({ errorCode: 'CONNECTIVITY_ERROR' });
  });

  it('should terminate immediately on page 1 with 0 calls to page 2 when page 1 has 0 records', async () => {
    const mockSession = new PortalSession();
    const client = new PaymentSlipClient(mockSession);

    const spy = vi.spyOn(client, 'queryPaymentSlips').mockResolvedValue({
      success: true,
      data: []
    });

    const mockRange = { fromDate: '01/01/2026', toDate: '31/12/2026', label: '2026', level: 'YEAR' as const };
    const results = await client.searchPaymentSlips(mockRange);

    expect(results).toHaveLength(0);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should treat valid eTax query page with no data as success with 0 records', async () => {
    const mockSession = new PortalSession();
    const client = new PaymentSlipClient(mockSession);

    client.setManualSessionState({
      sessionId: 'TEST_SESSION_123',
      applicationId: '-1',
      pageId: '1',
      operationName: 'corpQueryTaxProc',
      processorState: 'viewQueryPage',
      processorId: 'TEST_PROC_123'
    });

    const mockEmptyHtml = `
      <html>
        <body>
          <form name="corpQueryTaxProc" action="/etaxnnt/Request">
            <input type="hidden" name="dse_sessionId" value="TEST_SESSION_123" />
            <input type="hidden" name="dse_operationName" value="corpQueryTaxProc" />
            <input type="hidden" name="type_tax" value="01" />
            <input type="text" name="ngay_lap_tu_ngay" value="01/01/2026" />
            <div class="message">Không tìm thấy kết quả thỏa mãn điều kiện tìm kiếm.</div>
          </form>
        </body>
      </html>
    `;

    mockSession.client.post = vi.fn().mockResolvedValue({
      status: 200,
      data: mockEmptyHtml
    });

    const res = await client.queryPaymentSlips({
      startDate: '01/01/2026',
      endDate: '31/12/2026',
      page: 1
    });

    expect(res.success).toBe(true);
    expect(res.data).toEqual([]);
  });

  it('should return error when eTax query response contains NullPointerException or system error', async () => {
    const mockSession = new PortalSession();
    const client = new PaymentSlipClient(mockSession);

    client.setManualSessionState({
      sessionId: 'TEST_SESSION_123',
      applicationId: '-1',
      pageId: '1',
      operationName: 'corpQueryTaxProc',
      processorState: 'viewQueryPage',
      processorId: 'TEST_PROC_123'
    });

    const mockNpeHtml = `
      <html>
        <body>
          <h1>500 Internal Server Error</h1>
          <pre>java.lang.NullPointerException at vn.gov.gdt.etax...</pre>
        </body>
      </html>
    `;

    mockSession.client.post = vi.fn().mockResolvedValue({
      status: 200,
      data: mockNpeHtml
    });

    const res = await client.queryPaymentSlips({
      startDate: '01/01/2026',
      endDate: '31/12/2026',
      page: 1
    });

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('ETAX_SYSTEM_ERROR');
    expect(res.error).toContain('NullPointerException');
  });
});

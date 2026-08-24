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

  it('should stop pagination if page contains fewer than 10 records', async () => {
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

    const spy = vi.spyOn(client, 'queryPaymentSlips').mockResolvedValue({
      success: true,
      data: singlePageRecords
    });

    const mockRange = { fromDate: '01/01/2026', toDate: '31/12/2026', label: '2026', level: 'YEAR' as const };
    const results = await client.searchPaymentSlips(mockRange);

    expect(results).toHaveLength(2);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it } from 'vitest';
import { PitXmlParser } from '../src/main/scanner/PitXmlParser';
import { PitFlowEngine } from '../src/shared/PitFlowEngine';
import { PitAnalyticsSummary, PitDeclarationSnapshot } from '../src/shared/pitAnalyticsTypes';
import { TaxFiling } from '../src/shared/types';

describe('PIT XML Parser & Flow Engine Test Suite', () => {
  it('1. Bóc tách XML tờ khai 05/KK-TNCN chính thức và bổ sung', () => {
    const mockXml = `<?xml version="1.0" encoding="UTF-8"?>
    <HSoThueDTu>
      <TTinChung>
        <maTKhai>05/KK-TNCN</maTKhai>
        <kyKKhai>01/2025</kyKKhai>
      </TTinChung>
      <NDungTKhai>
        <ct21>120</ct21>
        <ct22>115</ct22>
        <ct32>14500000</ct32>
        <ct33>2000000</ct33>
        <ct34>16500000</ct34>
        <ct35>16500000</ct35>
      </NDungTKhai>
    </HSoThueDTu>`;

    const mockFiling: TaxFiling = {
      id: 'PIT_2025_01_ORIGINAL',
      procedureCode: '1.008346',
      declarationCode: '05/KK-TNCN',
      title: 'Tờ khai khấu trừ thuế thu nhập cá nhân',
      taxType: 'PIT',
      period: 'Tháng 01/2025',
      submittedAt: '18/02/2025 09:15:00',
      filingType: 'ORIGINAL',
      status: 'Đã chấp nhận',
      downloadAvailable: true
    };

    const snap = PitXmlParser.parsePitXml(mockXml, mockFiling, '3702735709');
    expect(snap).not.toBeNull();
    expect(snap?.ct21_tongSoNguoiLaoDong).toBe(120n);
    expect(snap?.ct32_khauTruCaNhanCuTru).toBe(14500000n);
    expect(snap?.ct33_khauTruCaNhanKhongCuTru).toBe(2000000n);
    expect(snap?.ct34_tongThueKhauTru).toBe(16500000n);
    expect(snap?.ct35_tongThuePhaiNop).toBe(16500000n);
  });

  it('2. Bóc tách XML tờ khai Quyết toán năm 05/QTT-TNCN', () => {
    const mockXml = `<?xml version="1.0" encoding="UTF-8"?>
    <HSoThueDTu>
      <TTinChung>
        <maTKhai>05/QTT-TNCN</maTKhai>
        <kyKKhai>2025</kyKKhai>
      </TTinChung>
      <NDungTKhai>
        <ct21>150</ct21>
        <ct32>180000000</ct32>
        <ct33>12000000</ct33>
        <ct36>192000000</ct36>
        <ct41>192000000</ct41>
      </NDungTKhai>
    </HSoThueDTu>`;

    const mockFiling: TaxFiling = {
      id: 'PIT_2025_QTT_ORIGINAL',
      procedureCode: '1.008346',
      declarationCode: '05/QTT-TNCN',
      title: 'Tờ khai quyết toán thuế thu nhập cá nhân',
      taxType: 'PIT',
      period: 'Năm 2025',
      submittedAt: '30/03/2026 14:20:00',
      filingType: 'FINALIZATION',
      status: 'Đã chấp nhận',
      downloadAvailable: true
    };

    const snap = PitXmlParser.parsePitXml(mockXml, mockFiling, '3702735709');
    expect(snap).not.toBeNull();
    expect(snap?.isFinalization).toBe(true);
    expect(snap?.ct36_qtt_tongThueDaKhauTruTrongNam).toBe(192000000n);
  });

  it('3. Kịch bản Hỗn Hợp: Tháng 1-4 khai Tháng, từ Quý 2 khai Quý (Q2, Q3, Q4) -> Tính tổng chính xác và đối chiếu Quyết toán', () => {
    const createSnap = (opts: {
      periodKey: string;
      periodLabel: string;
      month?: number;
      quarter?: number;
      isQuarter: boolean;
      resident: bigint;
      nonResident: bigint;
    }): PitDeclarationSnapshot => ({
      submissionId: `SUB_${opts.periodKey}`,
      formCode: '05/KK-TNCN',
      periodKey: opts.periodKey,
      periodLabel: opts.periodLabel,
      year: 2025,
      month: opts.month,
      quarter: opts.quarter,
      isQuarter: opts.isQuarter,
      isYear: false,
      versionType: 'ORIGINAL',
      supplementalNo: 0,
      status: 'Đã chấp nhận',
      ct21_tongSoNguoiLaoDong: 100n,
      ct22_caNhanCuTru: 95n,
      ct24_tongThuNhapChiuThue: 500000000n,
      ct27_tongThuNhapChiuThueKhauTru: 200000000n,
      ct31_tongThueTncnDaKhauTru: opts.resident + opts.nonResident,
      ct32_khauTruCaNhanCuTru: opts.resident,
      ct33_khauTruCaNhanKhongCuTru: opts.nonResident,
      ct34_tongThueKhauTru: opts.resident + opts.nonResident,
      ct35_tongThuePhaiNop: opts.resident + opts.nonResident,
      isFinalization: false
    });

    const snapshots: PitDeclarationSnapshot[] = [
      // Quý 1: T1, T2, T3 (khai tháng)
      createSnap({ periodKey: '2025-M01', periodLabel: 'Tháng 01/2025', month: 1, isQuarter: false, resident: 10000000n, nonResident: 0n }),
      createSnap({ periodKey: '2025-M02', periodLabel: 'Tháng 02/2025', month: 2, isQuarter: false, resident: 12000000n, nonResident: 0n }),
      createSnap({ periodKey: '2025-M03', periodLabel: 'Tháng 03/2025', month: 3, isQuarter: false, resident: 11000000n, nonResident: 1000000n }),

      // Quý 2: T4 (khai tháng cuối) + Quý 2 (bắt đầu khai quý)
      createSnap({ periodKey: '2025-M04', periodLabel: 'Tháng 04/2025', month: 4, isQuarter: false, resident: 14000000n, nonResident: 0n }),
      createSnap({ periodKey: '2025-Q02', periodLabel: 'Quý 2/2025', quarter: 2, isQuarter: true, resident: 30000000n, nonResident: 2000000n }),

      // Quý 3 & 4 (khai quý)
      createSnap({ periodKey: '2025-Q03', periodLabel: 'Quý 3/2025', quarter: 3, isQuarter: true, resident: 45000000n, nonResident: 0n }),
      createSnap({ periodKey: '2025-Q04', periodLabel: 'Quý 4/2025', quarter: 4, isQuarter: true, resident: 52000000n, nonResident: 3000000n })
    ];

    const qttSnapshot: PitDeclarationSnapshot = {
      submissionId: 'SUB_2025_QTT',
      formCode: '05/QTT-TNCN',
      periodKey: '2025-YEAR',
      periodLabel: 'Quyết toán năm 2025',
      year: 2025,
      isQuarter: false,
      isYear: true,
      versionType: 'ORIGINAL',
      supplementalNo: 0,
      status: 'Đã chấp nhận',
      ct21_tongSoNguoiLaoDong: 120n,
      ct22_caNhanCuTru: 115n,
      ct24_tongThuNhapChiuThue: 2000000000n,
      ct27_tongThuNhapChiuThueKhauTru: 1000000000n,
      ct31_tongThueTncnDaKhauTru: 180000000n,
      ct32_khauTruCaNhanCuTru: 174000000n,
      ct33_khauTruCaNhanKhongCuTru: 6000000n,
      ct34_tongThueKhauTru: 180000000n,
      ct35_tongThuePhaiNop: 180000000n,
      isFinalization: true,
      ct36_qtt_tongThueDaKhauTruTrongNam: 180000000n,
      ct41_qtt_tongThuePhaiNopTrongNam: 180000000n
    };

    const mockSummary: PitAnalyticsSummary = {
      taxpayerId: '3702735709',
      totalFilingsAnalyzed: 7,
      periodGroups: snapshots.map(s => ({
        periodKey: s.periodKey,
        periodLabel: s.periodLabel,
        year: s.year,
        month: s.month,
        quarter: s.quarter,
        periodType: s.isQuarter ? 'QUARTER' : 'MONTH',
        snapshots: [s],
        finalSnapshot: s,
        hasSupplemental: false,
        supplementalCount: 0
      })),
      finalizationSnapshot: qttSnapshot,
      analyzedAt: new Date().toISOString()
    };

    const result = PitFlowEngine.normalizeYearFlow(mockSummary, 2025);

    // Kiểm tra cấu trúc 4 khối Quý
    expect(result.quarterBlocks.length).toBe(4);

    // Quý 1: Có 3 tháng con (T1, T2, T3)
    expect(result.quarterBlocks[0].monthFilings.length).toBe(3);
    expect(result.quarterBlocks[0].totalWithheldTax).toBe(10000000n + 12000000n + 12000000n);

    // Quý 2: Có 1 tháng con (T4) + 1 tờ khai Quý 2
    expect(result.quarterBlocks[1].hasHybridFiling).toBe(true);
    expect(result.quarterBlocks[1].monthFilings.length).toBe(1);
    expect(result.quarterBlocks[1].quarterFiling).not.toBeNull();
    expect(result.quarterBlocks[1].totalWithheldTax).toBe(14000000n + 32000000n);

    // Quý 3 & Quý 4: Chỉ có tờ khai Quý
    expect(result.quarterBlocks[2].quarterFiling?.totalWithheldTaxCt34).toBe(45000000n);
    expect(result.quarterBlocks[3].quarterFiling?.totalWithheldTaxCt34).toBe(55000000n);

    // Tổng khấu trừ cả năm = 34tr (Q1) + 46tr (Q2) + 45tr (Q3) + 55tr (Q4) = 180.000.000 đ
    expect(result.totalWithheldTax34).toBe(180000000n);

    // Đối chiếu với Tờ khai Quyết toán năm (180.000.000 đ)
    expect(result.finalizationWithheldTax36).toBe(180000000n);
    expect(result.mismatchDelta).toBe(0n);
    expect(result.auditStatus).toBe('MATCHED');
  });
});

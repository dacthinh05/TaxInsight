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

  it('1b. Ánh xạ đúng chỉ tiêu 05/KK-TNCN TT80 maTKhai=864 từ XML thực tế', () => {
    const tt80Xml = `<?xml version="1.0" encoding="UTF-8"?>
      <HSoThueDTu>
        <TTinChung>
          <TTinTKhaiThue>
            <TKhaiThue>
              <maTKhai>864</maTKhai>
              <tenTKhai>TK khấu trừ thuế thu nhập cá nhân Mẫu 05/KK-TNCN (TT80/2021)</tenTKhai>
              <KyKKhaiThue><kyKKhai>11/2025</kyKKhai></KyKKhaiThue>
            </TKhaiThue>
          </TTinTKhaiThue>
        </TTinChung>
        <CTieuTKhaiChinh>
          <ct16>1817</ct16>
          <ct17>1789</ct17>
          <ct21>20058722974</ct21>
          <ct26>11011650470</ct26>
          <ct29>114075169</ct29>
          <ct30>114075169</ct30>
          <ct31>0</ct31>
        </CTieuTKhaiChinh>
      </HSoThueDTu>`;
    const filing: TaxFiling = {
      id: 'PIT_TT80_864',
      declarationCode: '05/KK-TNCN',
      title: 'Tờ khai khấu trừ thuế thu nhập cá nhân',
      taxType: 'PIT',
      period: '11/2025',
      filingType: 'ORIGINAL',
      downloadAvailable: true
    };

    const snap = PitXmlParser.parsePitXml(tt80Xml, filing, '0000000000');
    expect(snap).not.toBeNull();
    expect(snap?.ct21_tongSoNguoiLaoDong).toBe(1817n);
    expect(snap?.ct22_caNhanCuTru).toBe(1789n);
    expect(snap?.ct24_tongThuNhapChiuThue).toBe(20058722974n);
    expect(snap?.ct27_tongThuNhapChiuThueKhauTru).toBe(11011650470n);
    expect(snap?.ct31_tongThueTncnDaKhauTru).toBe(114075169n);
    expect(snap?.ct32_khauTruCaNhanCuTru).toBe(114075169n);
    expect(snap?.ct33_khauTruCaNhanKhongCuTru).toBe(0n);
    expect(snap?.ct34_tongThueKhauTru).toBe(114075169n);
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

  it('4. TT80 05/QTT-TNCN với <ct30> (tổng) và <ct31> (cư trú có HĐLĐ) -> Lấy đúng tổng ct30, không nhầm ct31', () => {
    const mockXmlQtt = `<?xml version="1.0" encoding="UTF-8"?>
    <HSoThueDTu xmlns:dvc="http://dvc.gdt.gov.vn">
      <dvc:TTinChung>
        <dvc:maTKhai>05/QTT-TNCN</dvc:maTKhai>
        <dvc:kyKKhai>2025</dvc:kyKKhai>
        <dvc:soLan>0</dvc:soLan>
      </dvc:TTinChung>
      <dvc:NDungTKhai>
        <dvc:ct21>200</dvc:ct21>
        <dvc:ct22>190</dvc:ct22>
        <dvc:ct24>3500000000</dvc:ct24>
        <dvc:ct27>1500000000</dvc:ct27>
        <dvc:ct30>250000000</dvc:ct30>
        <dvc:ct31>200000000</dvc:ct31>
        <dvc:ct32>50000000</dvc:ct32>
        <dvc:ct41>250000000</dvc:ct41>
      </dvc:NDungTKhai>
    </HSoThueDTu>`;

    const mockFiling: TaxFiling = {
      id: 'PIT_2025_QTT_TT80',
      procedureCode: '1.008346',
      declarationCode: '05/QTT-TNCN',
      title: 'Tờ khai quyết toán thuế thu nhập cá nhân',
      taxType: 'PIT',
      period: 'Năm 2025',
      submittedAt: '28/03/2026 10:00:00',
      filingType: 'FINALIZATION',
      status: 'Đã chấp nhận',
      downloadAvailable: true
    };

    const snap = PitXmlParser.parsePitXml(mockXmlQtt, mockFiling, '3702735709');
    expect(snap).not.toBeNull();
    expect(snap?.isFinalization).toBe(true);
    // ct36_qtt phải là 250.000.000 (từ ct30), KHÔNG PHẢI 200.000.000 (từ ct31)
    expect(snap?.ct36_qtt_tongThueDaKhauTruTrongNam).toBe(250000000n);
    expect(snap?.ct32_khauTruCaNhanCuTru).toBe(250000000n); // 200M (có HĐ) + 50M (không HĐ)
    expect(snap?.ct34_tongThueKhauTru).toBe(250000000n);
    expect(snap?.versionType).toBe('ORIGINAL');
    expect(snap?.supplementalNo).toBe(0);
  });

  it('5. Kiểm tra PitQuarterBlock tính đủ totalResidentTax và totalNonResidentTax cho người khai Tháng', () => {
    const snapT1: PitDeclarationSnapshot = {
      submissionId: 'SUB_T1',
      formCode: '05/KK-TNCN',
      periodKey: '2025-M01',
      periodLabel: 'Tháng 01/2025',
      year: 2025,
      month: 1,
      isQuarter: false,
      isYear: false,
      versionType: 'ORIGINAL',
      supplementalNo: 0,
      status: 'Đã chấp nhận',
      ct21_tongSoNguoiLaoDong: 50n,
      ct22_caNhanCuTru: 48n,
      ct24_tongThuNhapChiuThue: 500000000n,
      ct27_tongThuNhapChiuThueKhauTru: 200000000n,
      ct31_tongThueTncnDaKhauTru: 25000000n,
      ct32_khauTruCaNhanCuTru: 20000000n,
      ct33_khauTruCaNhanKhongCuTru: 5000000n,
      ct34_tongThueKhauTru: 25000000n,
      ct35_tongThuePhaiNop: 25000000n,
      isFinalization: false
    };

    const snapT2: PitDeclarationSnapshot = {
      ...snapT1,
      submissionId: 'SUB_T2',
      periodKey: '2025-M02',
      periodLabel: 'Tháng 02/2025',
      month: 2,
      ct21_tongSoNguoiLaoDong: 60n,
      ct32_khauTruCaNhanCuTru: 30000000n,
      ct33_khauTruCaNhanKhongCuTru: 2000000n,
      ct34_tongThueKhauTru: 32000000n
    };

    const snapT3: PitDeclarationSnapshot = {
      ...snapT1,
      submissionId: 'SUB_T3',
      periodKey: '2025-M03',
      periodLabel: 'Tháng 03/2025',
      month: 3,
      ct21_tongSoNguoiLaoDong: 55n,
      ct32_khauTruCaNhanCuTru: 28000000n,
      ct33_khauTruCaNhanKhongCuTru: 3000000n,
      ct34_tongThueKhauTru: 31000000n
    };

    const mockSummary: PitAnalyticsSummary = {
      taxpayerId: '3702735709',
      totalFilingsAnalyzed: 3,
      periodGroups: [snapT1, snapT2, snapT3].map(s => ({
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
      finalizationSnapshot: null,
      analyzedAt: new Date().toISOString()
    };

    const result = PitFlowEngine.normalizeYearFlow(mockSummary, 2025);
    const q1Block = result.quarterBlocks[0];

    // Khối Quý 1 tổng hợp từ T1, T2, T3
    expect(q1Block.monthFilings.length).toBe(3);
    expect(q1Block.quarterFiling).toBeNull();
    expect(q1Block.maxEmployeeCount).toBe(60n); // max(50, 60, 55)
    expect(q1Block.totalResidentTax).toBe(20000000n + 30000000n + 28000000n); // 78M
    expect(q1Block.totalNonResidentTax).toBe(5000000n + 2000000n + 3000000n); // 10M
    expect(q1Block.totalWithheldTax).toBe(88000000n);
    expect(result.totalResidentTax32).toBe(78000000n);
    expect(result.totalNonResidentTax33).toBe(10000000n);
    expect(result.totalWithheldTax34).toBe(88000000n);
  });

  it('6. BUGFIX: Tờ khai 05/KK-TNCN có thủ tục 1.008347 hoặc chứa chữ quyết toán không bị coi là finalization', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <HSoThueDTu>
      <TTinChung>
        <maTKhai>864</maTKhai>
        <kyKKhai>Q1/2026</kyKKhai>
      </TTinChung>
      <NDungTKhai>
        <ct21>50</ct21>
        <ct34>5000000</ct34>
      </NDungTKhai>
    </HSoThueDTu>`;

    const filingWithOldMeta: TaxFiling = {
      id: 'PIT_05KK_SUSPICIOUS',
      procedureCode: '1.008347',
      declarationCode: '05/KK-TNCN',
      title: '05/KK-TNCN - Tờ khai quyết toán thuế TNCN', // Giả sử metadata cũ chứa chữ quyết toán
      taxType: 'PIT',
      period: 'Quý 1/2026',
      submittedAt: '20/04/2026 10:00:00',
      filingType: 'ORIGINAL',
      downloadAvailable: true
    };

    const snap = PitXmlParser.parsePitXml(xml, filingWithOldMeta, '0123456789');
    expect(snap).not.toBeNull();
    expect(snap?.isFinalization).toBe(false);
    expect(snap?.formCode).toBe('05/KK-TNCN');
    expect(snap?.isQuarter).toBe(true);
    expect(snap?.isYear).toBe(false);
    expect(snap?.periodLabel).toBe('Quý 1/2026');
  });
});

import { describe, expect, it } from "vitest";
import { GntParser } from "../src/main/scanner/GntParser";
import { TaxNdktClassifier } from "../src/main/engine/TaxNdktClassifier";
import { TaxPaymentMatcher } from "../src/main/engine/TaxPaymentMatcher";
import { TaxObligation, TaxDeadlineResult } from "../src/shared/obligationTypes";
import { PaymentSlipRecord, PaymentSlipDetail, PaymentSlipSubItem } from "../src/shared/types";

function mockObligation(partial: Partial<TaxObligation>): TaxObligation {
  const deadline: TaxDeadlineResult = {
    baseFilingDeadline: "20/01/2026",
    basePaymentDeadline: "20/01/2026",
    effectiveFilingDeadline: "20/01/2026",
    effectivePaymentDeadline: "20/01/2026",
    ruleId: null,
    legalBasis: [],
    extensionApplied: false,
    confidence: "CONFIRMED",
    isAdjustedForHoliday: false
  };

  return {
    id: partial.id || "ob_mock",
    taxCode: partial.taxCode || "3702735709",
    taxType: partial.taxType || "VAT",
    declarationCode: partial.declarationCode || "01/GTGT",
    title: "Tờ khai thuế",
    periodKey: "2025-M12",
    periodLabel: "12/2025",
    year: partial.year || 2025,
    month: partial.month,
    quarter: partial.quarter,
    amountPayable: partial.amountPayable || 0n,
    hasSupplemental: false,
    supplementalCount: 0,
    currentVersion: "Chính thức",
    deadline: partial.deadline || deadline,
    status: partial.status || "PAST_DEADLINE_NO_MATCHED_PAYMENT",
    daysRemaining: -10,
    matchedPaymentAmount: 0n,
    matchedSlips: [],
    discrepancy: partial.amountPayable || 0n,
    statusMessage: ""
  };
}

function mockSlip(id: string, amount: number, status: string, paidAt?: string): PaymentSlipRecord {
  return {
    id,
    stt: 1,
    soGnt: id,
    maGiaoDich: "TXN-" + id,
    soTien: amount,
    soTienFormatted: String(amount),
    trangThai: status,
    ngayNopThue: paidAt || "17/01/2026 11:37:02",
    downloadAvailable: true,
    loaiTien: "VND"
  };
}

function mockDetail(id: string, totalVnd: string, items: PaymentSlipSubItem[]): PaymentSlipDetail {
  return {
    id,
    soGnt: id,
    tongTienVND: totalVnd,
    hinhThucNopTien: "CHUYEN_KHOAN",
    loaiTien: "VND",
    nguoiNopThue: "CÔNG TY TEST",
    maSoThue: "3702735709",
    loaiTaiKhoanThu: "TK_THU_NSNN",
    signatures: [],
    items
  };
}

function makeListHtml(status: string): string {
  return `<table id="data_content_onday"><tbody id="allResultTableBody"><tr>
    <td align="center">1</td><td>TXN001</td><td></td><td></td>
    <td><a href="javascript: chiTietCT(100);">GNT001</a></td>
    <td>50,000,000</td><td>VND</td><td>${status}</td><td>DOC001</td>
    <td>17/01/2026</td><td>17/01/2026</td><td>17/01/2026</td>
    <td></td><td></td><td></td>
    <td>Nộp tại cổng eTax của TCT</td><td>BIDV</td><td>12345678</td>
    <td><a href="javascript: downloadGNT(100);">Tải về</a></td><td></td>
  </tr></tbody></table>`;
}

function makeDetailHtml(rows: string, total: string): string {
  return `<div>
    <p>Người nộp thuế: <span style="text-transform:uppercase;">CÔNG TY TEST</span></p>
    <p>Mã số thuế: <span>3702735709</span></p>
    <table id="chungtu_ctiet"><tbody>
      ${rows}
      <tr><td colspan="4">Tổng tiền</td><td></td><td><span id="sum">${total}</span></td><td></td><td></td></tr>
    </tbody></table>
  </div>`;
}

// ── FIX 1: P0 Status Bug ──────────────────────────────────────────────────────
describe("FIX 1 (P0): Status substring order", () => {
  it("Nộp thuế thành công → PAID_SUCCESS", () => {
    expect(GntParser.parseList(makeListHtml("Nộp thuế thành công"))[0].statusNormalized).toBe("PAID_SUCCESS");
  });
  it("Không thành công → FAILED (not PAID_SUCCESS)", () => {
    const r = GntParser.parseList(makeListHtml("Không thành công"));
    expect(r[0].statusNormalized).toBe("FAILED");
    expect(r[0].statusNormalized).not.toBe("PAID_SUCCESS");
  });
  it("Nộp thuế không thành công → FAILED", () => {
    expect(GntParser.parseList(makeListHtml("Nộp thuế không thành công"))[0].statusNormalized).toBe("FAILED");
  });
  it("Thất bại → FAILED", () => {
    expect(GntParser.parseList(makeListHtml("Thất bại"))[0].statusNormalized).toBe("FAILED");
  });
  it("Hủy → FAILED", () => {
    expect(GntParser.parseList(makeListHtml("Hủy"))[0].statusNormalized).toBe("FAILED");
  });
  it("Đang xử lý → PENDING", () => {
    expect(GntParser.parseList(makeListHtml("Đang xử lý"))[0].statusNormalized).toBe("PENDING");
  });
});

// ── FIX 2: Detail Integrity ───────────────────────────────────────────────────
describe("FIX 2 (P1): detailIntegrity strict VERIFIED", () => {
  it("Valid single row + correct total → VERIFIED", () => {
    const html = makeDetailHtml(
      "<tr><td>1</td><td>TK001</td><td>00/12/2025</td><td>Thuế TNCN</td><td></td><td>50,000,000</td><td>557</td><td>1001</td></tr>",
      "50,000,000"
    );
    expect(GntParser.parseDetail(html, "c1").detailIntegrity).toBe("VERIFIED");
  });
  it("Row with INVALID amount text → PARTIAL (not VERIFIED)", () => {
    const html = makeDetailHtml(
      `<tr><td>1</td><td>TK001</td><td>00/12/2025</td><td>Thuế</td><td></td><td>50,000,000</td><td>557</td><td>1001</td></tr>
       <tr><td>2</td><td>TK002</td><td>00/12/2025</td><td>Thuế</td><td></td><td>NOT_A_NUMBER</td><td>557</td><td>1001</td></tr>`,
      "50,000,000"
    );
    const r = GntParser.parseDetail(html, "c2");
    expect(r.detailIntegrity).toBe("PARTIAL");
    expect(r.detailIntegrity).not.toBe("VERIFIED");
  });
  it("Duplicate rows same signature + sum khớp tổng → VERIFIED (2 đợt nộp giống nhau là dữ liệu THẬT)", () => {
    const html = makeDetailHtml(
      `<tr><td>1</td><td>TK001</td><td>00/12/2025</td><td>Thuế TNCN</td><td></td><td>50,000,000</td><td>557</td><td>1001</td></tr>
       <tr><td>2</td><td>TK001</td><td>00/12/2025</td><td>Thuế TNCN</td><td></td><td>50,000,000</td><td>557</td><td>1001</td></tr>`,
      "100,000,000"
    );
    // Audit round 2: duplicate signature KHÔNG còn ép PARTIAL — 2 khoản hợp lệ
    // trùng kỳ+tiểu mục+số tiền (nộp 2 đợt) là dữ liệu thật. Parse hỏng nhân
    // đôi dòng vẫn bị bắt ở bước so sum (→ MISMATCH).
    expect(GntParser.parseDetail(html, "c3").detailIntegrity).toBe("VERIFIED");
  });
  it("Sum mismatch → MISMATCH", () => {
    const html = makeDetailHtml(
      "<tr><td>1</td><td>TK001</td><td>00/12/2025</td><td>Thuế</td><td></td><td>50,000,000</td><td>557</td><td>1001</td></tr>",
      "99,000,000"
    );
    expect(GntParser.parseDetail(html, "c4").detailIntegrity).toBe("MISMATCH");
  });
});

// ── FIX 3: POSSIBLE → NEEDS_REVIEW ───────────────────────────────────────────
describe("FIX 3 (P1): POSSIBLE match stays NEEDS_REVIEW not PAID_MATCHED", () => {
  it("Header-only with no period info → not PAID_MATCHED", () => {
    const ob = mockObligation({ id: "ob_vat", taxType: "VAT", month: 12, year: 2025, amountPayable: 50000000n });
    const slip = mockSlip("s1", 50000000, "Nộp thuế thành công");
    const result = TaxPaymentMatcher.matchPayments([ob], [slip], new Map());
    expect(result[0].matchedPaymentAmount).toBe(0n);
    expect(result[0].status).not.toBe("PAID_MATCHED");
  });
  it("Failed GNT cannot match → matchedAmount stays 0", () => {
    const ob = mockObligation({ id: "ob_vat", taxType: "VAT", month: 12, year: 2025, amountPayable: 50000000n });
    const slip = mockSlip("s1", 50000000, "Không thành công");
    const detail = mockDetail("s1", "50,000,000", [{ stt: 1, kyThueNgayQd: "00/12/2025", soTienVND: "50,000,000", noiDungKhoanNop: "Thuế", maNDKT: "1701" }]);
    const result = TaxPaymentMatcher.matchPayments([ob], [slip], new Map([["s1", detail]]));
    expect(result[0].matchedPaymentAmount).toBe(0n);
  });
});

// ── FIX 4: UNKNOWN NDKT blocked ──────────────────────────────────────────────
describe("FIX 4 (P1): UNKNOWN NDKT cannot auto-match EXACT/HIGH", () => {
  it("NDKT 9999 → no auto-match", () => {
    const ob = mockObligation({ id: "ob_vat", taxType: "VAT", month: 12, year: 2025, amountPayable: 50000000n });
    const slip = mockSlip("s1", 50000000, "Nộp thuế thành công");
    const detail = mockDetail("s1", "50,000,000", [{ stt: 1, kyThueNgayQd: "00/12/2025", soTienVND: "50,000,000", noiDungKhoanNop: "Thuế", maNDKT: "9999" }]);
    const result = TaxPaymentMatcher.matchPayments([ob], [slip], new Map([["s1", detail]]));
    expect(result[0].matchedPaymentAmount).toBe(0n);
    expect(result[0].status).not.toBe("PAID_MATCHED");
  });
  it("KNOWN NDKT 1701 (VAT) → match succeeds", () => {
    const ob = mockObligation({ id: "ob_vat", taxType: "VAT", month: 12, year: 2025, amountPayable: 50000000n });
    const slip = mockSlip("s1", 50000000, "Nộp thuế thành công");
    const detail = mockDetail("s1", "50,000,000", [{ stt: 1, kyThueNgayQd: "00/12/2025", soTienVND: "50,000,000", noiDungKhoanNop: "Thuế GTGT", maNDKT: "1701" }]);
    const result = TaxPaymentMatcher.matchPayments([ob], [slip], new Map([["s1", detail]]));
    expect(result[0].matchedPaymentAmount).toBe(50000000n);
    expect(result[0].status).toBe("PAID_MATCHED");
  });
});

// ── FIX 5: Declaration Reference ──────────────────────────────────────────────
describe("FIX 5 (P1): Declaration reference scoring", () => {
  it("soToKhaiQuyetDinh match boosts score → PAID_MATCHED", () => {
    const ob = mockObligation({ id: "ob_pit", taxType: "PIT", declarationCode: "05/KK-TNCN", month: 12, year: 2025, amountPayable: 99921049n });
    const slip = mockSlip("s1", 99921049, "Nộp thuế thành công");
    const detail = mockDetail("s1", "99,921,049", [{ stt: 1, soToKhaiQuyetDinh: "05/KK-TNCN", kyThueNgayQd: "00/12/2025", soTienVND: "99,921,049", noiDungKhoanNop: "Thuế TNCN", maNDKT: "1001" }]);
    const result = TaxPaymentMatcher.matchPayments([ob], [slip], new Map([["s1", detail]]));
    expect(result[0].matchedPaymentAmount).toBe(99921049n);
    expect(result[0].status).toBe("PAID_MATCHED");
    expect(result[0].matchedSlips[0].matchReason).toContain("05/KK-TNCN");
  });
});

// ── Money Conservation ────────────────────────────────────────────────────────
describe("Money Conservation (Mục #56, #57)", () => {
  it("3 GNT cover 1 obligation = 100m exactly", () => {
    const ob = mockObligation({ id: "ob", taxType: "VAT", month: 12, year: 2025, amountPayable: 100000000n });
    const s1 = mockSlip("s1", 30000000, "Nộp thuế thành công");
    const s2 = mockSlip("s2", 20000000, "Nộp thuế thành công");
    const s3 = mockSlip("s3", 50000000, "Nộp thuế thành công");
    const d1 = mockDetail("s1", "30,000,000", [{ stt: 1, kyThueNgayQd: "00/12/2025", soTienVND: "30,000,000", noiDungKhoanNop: "Thuế", maNDKT: "1701" }]);
    const d2 = mockDetail("s2", "20,000,000", [{ stt: 1, kyThueNgayQd: "00/12/2025", soTienVND: "20,000,000", noiDungKhoanNop: "Thuế", maNDKT: "1701" }]);
    const d3 = mockDetail("s3", "50,000,000", [{ stt: 1, kyThueNgayQd: "00/12/2025", soTienVND: "50,000,000", noiDungKhoanNop: "Thuế", maNDKT: "1701" }]);
    const result = TaxPaymentMatcher.matchPayments([ob], [s1, s2, s3], new Map([["s1",d1],["s2",d2],["s3",d3]]));
    expect(result[0].matchedPaymentAmount).toBe(100000000n);
    expect(result[0].discrepancy).toBe(0n);
    expect(result[0].status).toBe("PAID_MATCHED");
    const totalAllocated = result[0].matchedSlips.reduce((s, m) => s + m.allocatedAmount, 0n);
    expect(totalAllocated).toBe(100000000n);
  });
  it("No-double-count: same GNT used once across 2 obligations", () => {
    const ob1 = mockObligation({ id: "ob1", taxType: "VAT", month: 11, year: 2025, amountPayable: 50000000n });
    const ob2 = mockObligation({ id: "ob2", taxType: "VAT", month: 12, year: 2025, amountPayable: 50000000n });
    const slip = mockSlip("s1", 50000000, "Nộp thuế thành công");
    const detail = mockDetail("s1", "50,000,000", [{ stt: 1, kyThueNgayQd: "00/11/2025", soTienVND: "50,000,000", noiDungKhoanNop: "Thuế", maNDKT: "1701" }]);
    const result = TaxPaymentMatcher.matchPayments([ob1, ob2], [slip], new Map([["s1", detail]]));
    const total = result.reduce((s, o) => s + o.matchedPaymentAmount, 0n);
    expect(total).toBeLessThanOrEqual(50000000n);
  });
  it("Partial payment: discrepancy = amountPayable - matched", () => {
    const ob = mockObligation({ id: "ob", taxType: "VAT", month: 12, year: 2025, amountPayable: 100000000n });
    const slip = mockSlip("s1", 60000000, "Nộp thuế thành công");
    const detail = mockDetail("s1", "60,000,000", [{ stt: 1, kyThueNgayQd: "00/12/2025", soTienVND: "60,000,000", noiDungKhoanNop: "Thuế", maNDKT: "1701" }]);
    const result = TaxPaymentMatcher.matchPayments([ob], [slip], new Map([["s1", detail]]));
    expect(result[0].matchedPaymentAmount).toBe(60000000n);
    expect(result[0].discrepancy).toBe(40000000n);
    expect(result[0].status).toBe("PARTIALLY_MATCHED");
  });
  it("Idempotent: running matcher twice returns same result", () => {
    const ob = mockObligation({ id: "ob", taxType: "VAT", month: 12, year: 2025, amountPayable: 50000000n });
    const slip = mockSlip("s1", 50000000, "Nộp thuế thành công");
    const detail = mockDetail("s1", "50,000,000", [{ stt: 1, kyThueNgayQd: "00/12/2025", soTienVND: "50,000,000", noiDungKhoanNop: "Thuế", maNDKT: "1701" }]);
    const m = new Map([["s1", detail]]);
    const r1 = TaxPaymentMatcher.matchPayments([ob], [slip], m);
    const r2 = TaxPaymentMatcher.matchPayments([ob], [slip], m);
    expect(r1[0].matchedPaymentAmount).toBe(r2[0].matchedPaymentAmount);
    expect(r1[0].status).toBe(r2[0].status);
  });
});

// ── NDKT Classifier edge cases ────────────────────────────────────────────────
describe("NDKT Classifier edge cases", () => {
  it("2862 → OTHER", () => expect(TaxNdktClassifier.classify("2862").taxType).toBe("OTHER"));
  it("9999 → UNKNOWN", () => expect(TaxNdktClassifier.classify("9999").taxType).toBe("UNKNOWN"));
  it("UNKNOWN no conflict with VAT", () => expect(TaxNdktClassifier.hasTaxTypeConflict("UNKNOWN", "VAT")).toBe(false));
  it("OTHER no conflict with VAT", () => expect(TaxNdktClassifier.hasTaxTypeConflict("OTHER", "VAT")).toBe(false));
});


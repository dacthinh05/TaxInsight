---
title: "Phase 5: Kiểm thử Toàn diện & Xác minh Thực tế"
description: "Xây dựng bộ test suite tự động kiểm chứng 4 phân hệ được sửa đổi, đảm bảo 100% test suites của dự án đều pass không có hồi quy"
status: pending
priority: P1
effort: "4h"
tags: [test, vitest, regression, verification]
created: 2026-09-10
---

# Phase 5: Kiểm thử Toàn diện & Xác minh Thực tế

## Context & Problem

Các thay đổi trong Phase 1 đến Phase 4 liên quan đến các module cốt lõi: IPC Handlers, SSO handoff, `LegacyFilingClient`, `PaymentSlipClient`, `VatAnalyticsEngine`, và `PitAnalyticsEngine`.
Cần một bộ kiểm thử tự động toàn diện để:
1. Xác nhận hợp đồng và hành vi mới hoạt động chính xác.
2. Bảo đảm toàn bộ 60 test suites hiện có (519 tests) không bị phá vỡ (Zero-Regression).

## Requirements

1. **Xây dựng Test Suite Mới (`tests/etaxDvcLinkageAndAnalyticsFixes.test.ts`):**
   - **Test 1:** Xác nhận `legacyFiling:openAuthWindow` mở cửa sổ ở chế độ `FILING`, cấu hình module `360103` và tiêu đề Tờ Khai Thuế.
   - **Test 2:** Xác nhận `paymentSlips:openAuthWindow` mở cửa sổ ở chế độ `GNT`, cấu hình module `330410` và tiêu đề Giấy Nộp Tiền.
   - **Test 3:** Xác nhận request SSO DVC gửi `_csrf` qua header `X-XSRF-TOKEN`, body là chuỗi rỗng `''`.
   - **Test 4:** Kiểm tra `LegacyFilingClient.adoptDseSession` trích xuất chính xác danh mục `availableFormOptions` từ HTML.
   - **Test 5:** Kiểm tra `PitAnalyticsEngine` và `VatAnalyticsEngine` khi một tệp XML thất bại: engine bắt lỗi an toàn, trả về kết quả `PARTIAL` thay vì throw unhandled error.
2. **Chạy Toàn bộ Kiểm thử Hệ thống:**
   - Thực thi `npx vitest run` trên toàn bộ thư mục `tests/`.
   - Kiểm tra lỗi biên dịch TypeScript qua `npx tsc --noEmit` hoặc tương đương.

## Related Files

- `tests/etaxDvcLinkageAndAnalyticsFixes.test.ts`: Bộ test suite kiểm thử hợp đồng mới.
- Toàn bộ các file trong `tests/`.

## Success Verification

- [ ] Toàn bộ các bài test mới trong `tests/etaxDvcLinkageAndAnalyticsFixes.test.ts` đều PASS 100%.
- [ ] Toàn bộ 60 test suites hiện hữu đều PASS 100%.
- [ ] Không có bất kỳ cảnh báo lỗi cú pháp hoặc kiểu dữ liệu TypeScript nào.

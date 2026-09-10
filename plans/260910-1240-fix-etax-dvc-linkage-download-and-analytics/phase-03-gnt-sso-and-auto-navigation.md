---
title: "Phase 3: Chuẩn hóa Tra cứu & Tải Giấy Nộp Tiền"
description: "Sửa thứ tự module SSO trong PaymentSlipClient, loại bỏ lỗi CSRF 403, hoàn thiện cơ chế nhảy module tự động vào corpQueryTaxProc"
status: pending
priority: P1
effort: "4h"
tags: [payment-slip, gnt, sso, etax, corpQueryTaxProc]
created: 2026-09-10
---

# Phase 3: Chuẩn hóa Tra cứu & Tải Giấy Nộp Tiền

## Context & Problem

Trong phân hệ Giấy Nộp Tiền (C1-02/NS):
1. Tại `PaymentSlipClient.ts:259`, client lại ưu tiên gửi SSO `module=360103` (Tra cứu tờ khai) trước rồi mới fallback sang `module=330410` (Tra cứu GNT). Điều này gây đảo lộn phiên làm việc, đưa người dùng sang màn hình tờ khai thay vì màn hình Giấy nộp tiền.
2. Quá trình gửi request SSO POST lên Cổng DVC cần đảm bảo chuẩn mực: gửi token qua `X-XSRF-TOKEN`, body rỗng, tránh bị chặn bởi Spring Security.
3. Khi eTax chuyển hướng về trang chủ `corpIndexProc`, hệ thống cần kích hoạt lệnh nhảy `corpJumpProc -> corpQueryTaxProc` để mở sẵn form tra cứu GNT, không để tiến trình bị dừng ở trang chủ.

## Requirements

1. **Chuẩn hóa Module SSO trong `PaymentSlipClient.ts`:**
   - Đặt `module=330410` làm endpoint SSO mặc định và ưu tiên số 1 cho Giấy Nộp Tiền.
   - Gửi header `X-XSRF-TOKEN: csrfToken`, body rỗng `''`.
2. **Cơ chế Chuyển tiếp Tự động (Auto-Jump) sang `corpQueryTaxProc`:**
   - Trong `followRedirectChain` của `PaymentSlipClient`, khi chạm trang chủ `corpIndexProc` hoặc `corporateHomeProc`, dừng vòng lặp redirect và chủ động thực hiện POST `corpJumpProc` để mở `corpQueryTaxProc`.
   - Nạp trạng thái DSE đầy đủ (`sessionId`, `applicationId`, `operationName = 'corpQueryTaxProc'`, `processorState`).
3. **Tra cứu & Bóc tách Dữ liệu Bảng kê GNT:**
   - Đảm bảo hàm `queryPaymentSlips` gửi đúng các tham số tra cứu (`ngay_lap_tu_ngay`, `ngay_lap_den_ngay`, `type_tax = '01'`).
   - Sử dụng `GntParser.parseList` để trích xuất đầy đủ danh sách `PaymentSlipRecord[]` và cập nhật vào bảng giao diện.

## Related Files

- `src/main/portal/PaymentSlipClient.ts`: Sửa thứ tự module SSO và luồng chuyển tiếp vào `corpQueryTaxProc`.

## Success Verification

- [ ] `PaymentSlipClient` gửi đúng `module=330410` khi bắt đầu handshake SSO.
- [ ] Chuyển tiếp thành công vào màn hình `corpQueryTaxProc`, không bị kẹt ở `corpIndexProc`.
- [ ] Tra cứu và trích xuất thành công danh sách Giấy Nộp Tiền trong khoảng ngày chỉ định.

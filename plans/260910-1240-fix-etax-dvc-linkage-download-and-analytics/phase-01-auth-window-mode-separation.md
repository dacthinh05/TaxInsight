---
title: "Phase 1: Phân tách Cửa sổ Xác thực eTax Tờ khai & GNT"
description: "Tách biệt độc lập luồng SSO Module 360103 (Tờ khai) và Module 330410 (GNT), sửa lỗi 403 CSRF body param, tự động điều hướng từ trang chủ corpIndexProc"
status: pending
priority: P1
effort: "4h"
tags: [ipc, auth-window, sso, etax, dvc, csrf]
created: 2026-09-10
---

# Phase 1: Phân tách Cửa sổ Xác thực eTax Tờ khai & GNT

## Context & Problem

Hiện tại, cả hai phân hệ **Tờ khai thuế** (`legacyFiling:openAuthWindow`) và **Giấy nộp tiền** (`paymentSlips:openAuthWindow`) đều dùng chung hàm `triggerPaymentAuthWindow`.
Hàm này bị hardcode toàn bộ cho phân hệ Giấy nộp tiền:
1. Title cửa sổ và Banner hiển thị: *"⚡ TaxInsight: Đang chuyển tiếp sang phân hệ Tra cứu Giấy Nộp Tiền (eTax)..."* kể cả khi người dùng đang bấm tải tờ khai thuế.
2. Gửi request SSO với `module=330410` (Giấy Nộp Tiền), khiến eTax không mở màn hình Tra cứu tờ khai (`traCuuToKhaiProc` - `module=360103`).
3. Gửi kèm field `_csrf` trong body request POST lên `/tthc/sso/redirect-to-service`, dẫn đến lỗi Spring Security HTTP 403 Forbidden trên Cổng DVC.
4. Điều kiện giải tỏa cửa sổ (`settleAuthWindow`) chỉ lắng nghe bảng Giấy nộp tiền (`isGntForm`), khiến luồng xác thực tờ khai bị treo 120 giây rồi văng timeout.

## Requirements

1. **Tái cấu trúc thành `triggerEtaxAuthWindow(options: { mode: 'FILING' | 'GNT', fromDate?: string, toDate?: string, forceInteractive?: boolean })`:**
   - **Chế độ `FILING` (Tờ khai thuế):**
     - Tiêu đề: `"Xác Thực Phiên Làm Việc eTax (Tra Cứu Tờ Khai Thuế) - TaxInsight"`.
     - Banner hướng dẫn: `"⚡ TaxInsight: Đang kết nối phân hệ Tra cứu Tờ khai thuế (eTax)..."`.
     - Endpoint SSO: `/tthc/sso/redirect-to-service?module=360103`.
     - Nhận diện trang eTax: Bắt DSE state khi form chứa `select[name="maTKhai"]`, `traCuuToKhaiProc` hoặc khi đã có `dse_sessionId`.
     - Tự động nhảy từ trang chủ `corpIndexProc` sang `traCuuToKhaiProc`.
     - Gọi `legacyFilingClient.adoptDseSession(dseSessionId, currentUrl, html)` truyền đầy đủ 3 tham số để nạp danh mục `availableFormOptions`.
   - **Chế độ `GNT` (Giấy nộp tiền):**
     - Tiêu đề: `"Xác Thực Phiên Làm Việc eTax (Tra Cứu Giấy Nộp Tiền) - TaxInsight"`.
     - Banner hướng dẫn: `"⚡ TaxInsight: Đang kết nối phân hệ Tra cứu Giấy Nộp Tiền (eTax)..."`.
     - Endpoint SSO: `/tthc/sso/redirect-to-service?module=330410`.
     - Nhận diện trang eTax: Bắt DSE state và form GNT (`corpQueryTaxProc`).
     - Tự động nhảy từ trang chủ `corpIndexProc` sang `corpQueryTaxProc`.
2. **Loại bỏ `_csrf` trong body của request SSO DVC:**
   - Chỉ truyền CSRF token qua header `X-XSRF-TOKEN: csrf`.
   - Body để chuỗi rỗng `''` theo chuẩn Spring Security của Cổng DVC.
3. **Cập nhật IPC Handlers trong `src/main/ipc/ipcHandlers.ts`:**
   - `legacyFiling:openAuthWindow`: gọi `triggerEtaxAuthWindow({ mode: 'FILING', forceInteractive: options?.forceInteractive ?? true })`.
   - `paymentSlips:openAuthWindow`: gọi `triggerEtaxAuthWindow({ mode: 'GNT', forceInteractive: params?.forceInteractive ?? true, ... })`.

## Related Files

- `src/main/ipc/ipcHandlers.ts`: Tái cấu trúc hàm mở cửa sổ xác thực eTax, hỗ trợ tham số `mode`.

## Success Verification

- [ ] Gọi `legacyFiling:openAuthWindow` mở cửa sổ mang tiêu đề *"Xác Thực Phiên Làm Việc eTax (Tra Cứu Tờ Khai Thuế)"*.
- [ ] Gọi `paymentSlips:openAuthWindow` mở cửa sổ mang tiêu đề *"Xác Thực Phiên Làm Việc eTax (Tra Cứu Giấy Nộp Tiền)"*.
- [ ] Request POST tới `redirect-to-service` không gửi `_csrf` trong body, không bị lỗi HTTP 403 Forbidden.
- [ ] Khi eTax đưa về `corpIndexProc`, script tự động chuyển tiếp tới đúng form mục tiêu tương ứng với `mode`.

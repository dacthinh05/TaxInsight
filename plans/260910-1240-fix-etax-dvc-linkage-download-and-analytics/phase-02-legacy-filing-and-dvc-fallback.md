---
title: "Phase 2: Hoàn thiện Fallback eTax & Tải Tờ khai Thuế"
description: "Đồng bộ đầy đủ DSE State, HTML form options trong LegacyFilingClient, tối ưu hóa thuật toán khớp tờ khai eTax khi DVC báo lỗi 400"
status: pending
priority: P1
effort: "4h"
tags: [legacy-filing, download-manager, etax, fallback, dvc-400]
created: 2026-09-10
---

# Phase 2: Hoàn thiện Fallback eTax & Tải Tờ khai Thuế

## Context & Problem

Khi Cổng DVC từ chối mở gói tệp (`validateIdTkhai` trả `"400"` hoặc `/downloadhoso` trả HTTP 500 do tờ khai nộp qua kênh eTax), `DownloadManager` kích hoạt fallback sang `LegacyFilingClient.resolveAndDownloadFiling`.
Tuy nhiên:
1. `adoptDseSession` trong `LegacyFilingClient` trước đây chỉ nhận `sessionId`, không nhận `html` và `currentUrl`. Điều này làm `this.availableFormOptions` rỗng, hệ thống không biết mã form eTax tương ứng của tờ khai `05/KK-TNCN` (mã `864`) hay `01/GTGT` (mã `842`) để tra cứu.
2. Dải ngày tra cứu trên eTax (`qryToDate`) khi tính toán cho năm hiện hành cần đảm bảo không vượt quá ngày hôm nay để tránh bị server eTax từ chối truy vấn.
3. Khi người dùng xác thực thành công qua cửa sổ eTax và retry, `DownloadManager` cần tải tệp XML thành công và lưu có tổ chức vào thư mục máy tính.

## Requirements

1. **Nâng cấp `adoptDseSession` trong `LegacyFilingClient.ts`:**
   ```ts
   public adoptDseSession(sessionId: string, currentUrl?: string, html?: string): void
   ```
   - Nạp `sessionId` vào `currentFormState.dseSessionId`.
   - Nếu có `currentUrl`, gán cho `currentFormState.actionUrl`.
   - Nếu có `html`, phân tích bằng `EtaxFormStateParser.parse(html)` để trích xuất đầy đủ `dseApplicationId`, `dsePageId`, `dseProcessorState`, và đặc biệt là `formOptions` vào `this.availableFormOptions`.
   - Đặt cờ `isEtaxInitialized = true`.
2. **Củng cố Thuật toán Khớp Tờ khai eTax (`resolveAndDownloadFiling`):**
   - Ưu tiên tìm theo `messageId` nếu hồ sơ đã có sẵn.
   - Thử theo mã tờ khai đã biết (`filing.maTkhai`), danh mục `availableFormOptions` khớp với `declarationCode` (ví dụ `05/KK-TNCN`, `05/QTT-TNCN`, `01/GTGT`).
   - Fallback tra cứu toàn bộ với mã `'00'` kèm đúng `kieuKy` (Tháng/Quý/Năm).
   - Khớp hồ sơ eTax tìm được theo: `id`, `altIds`, hoặc `kỳ tính thuế + mã tờ khai` (tránh nhầm lẫn giữa Tờ khai chính thức và Tờ khai bổ sung).
3. **Đảm bảo Tải & Lưu tệp trong `DownloadManager.ts`:**
   - Sau khi tải thành công buffer tệp XML từ eTax, lưu trữ tệp qua `FileOrganizer` với cấu trúc chuẩn `MST/Năm/Loại_thuế/`, tạo `manifest.json`.

## Related Files

- `src/main/portal/LegacyFilingClient.ts`: Cập nhật `adoptDseSession` và logic tra cứu tải tờ khai eTax.
- `src/main/downloader/DownloadManager.ts`: Kiểm tra luồng gọi fallback khi DVC báo 400.

## Success Verification

- [ ] `LegacyFilingClient.adoptDseSession` nạp đầy đủ danh mục form eTax khi nhận HTML.
- [ ] Hồ sơ bị DVC báo 400 được tìm thấy trên eTax và tải thành công nội dung XML.
- [ ] Tệp tải về được lưu đúng thư mục và cập nhật trạng thái `COMPLETED` trên giao diện.

---
phase: 2
title: "UI Drag & Drop Overlay & Import Buttons"
status: completed
priority: P1
effort: "1.5h"
dependencies: [1]
---

# Phase 2: UI Drag & Drop Overlay & Import Buttons

## Overview
Xây dựng giao diện Drag & Drop toàn ứng dụng trong renderer: khi người dùng kéo file hoặc folder từ Windows Explorer vào cửa sổ ứng dụng, giao diện hiển thị một overlay mờ với biểu tượng và chỉ dẫn trực quan. Bổ sung nút "Nhập XML từ máy" vào thanh công cụ để người dùng có thể nhấp chọn thư mục hoặc chọn file thủ công.

## Requirements
- Functional:
  - Bắt các sự kiện `dragenter`, `dragover`, `dragleave`, `drop` trên container gốc của ứng dụng.
  - Hiển thị Drag & Drop Overlay với animation mượt mà, ngăn chặn hành vi mặc định của Electron/Chromium (tránh mở file trực tiếp trong tab).
  - Trích xuất danh sách file paths từ `dataTransfer.files`.
  - Nút "Nhập XML từ máy" (với dropdown chọn: "Chọn thư mục..." hoặc "Chọn các file XML...") trên `ScanCommandBar.tsx`.
  - Modal / Toast hiển thị tiến trình nhập và kết quả tóm tắt: "Đã nhận diện thành công 16 tờ khai (12 GTGT, 4 TNCN) thuộc MST: 0101234567 năm 2026".
- Non-functional:
  - Thiết kế hiện đại chuẩn Tailwind CSS + Lucide Icons, đồng bộ với phong cách thiết kế của TaxInsight.

## Related Code Files
- Modify: `src/renderer/App.tsx`, `src/renderer/components/ScanCommandBar.tsx`
- Create: `src/renderer/components/DragDropOverlay.tsx` (hoặc tích hợp inline trong App.tsx)

## Implementation Steps
1. Tạo component hoặc hook quản lý Drag & Drop toàn cục trong `App.tsx`.
2. Bổ sung nút "Nhập XML từ máy" trên `ScanCommandBar.tsx`.
3. Khi người dùng thả file/folder hoặc chọn dialog, gọi IPC sang main process.
4. Xử lý phản hồi từ main process: cập nhật `session.taxCode` (nếu chưa đăng nhập), nạp danh sách vào `filings`, cập nhật `selectedYear`, và kích hoạt kiểm tra chuỗi kỳ.

## Success Criteria
- [x] Kéo thả file/thư mục vào bất kỳ vị trí nào trên cửa sổ ứng dụng đều kích hoạt overlay dropzone đẹp mắt.
- [x] Thả file hoàn tất hiển thị popup kết quả rõ ràng và nạp dữ liệu vào bảng hồ sơ.

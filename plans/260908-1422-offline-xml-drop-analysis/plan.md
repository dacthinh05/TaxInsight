---
title: "offline-xml-drop-analysis"
description: "Kéo thả (Drag & Drop) và Chọn thư mục/file XML có sẵn trên máy để phân tích thuế GTGT và TNCN Offline tức thì"
status: completed
priority: P1
effort: "4h"
tags: ["offline-xml", "drag-and-drop", "analytics", "vat", "pit"]
created: 2026-09-08
---

# offline-xml-drop-analysis

## Overview
Cho phép người dùng kéo thả (Drag & Drop) cả thư mục hoặc nhiều file XML tờ khai thuế (hỗ trợ cả file nén `.zip` tải từ Cổng Thuế) vào phần mềm, hoặc bấm nút "Chọn thư mục / file XML có sẵn trên máy". Hệ thống tự động quét đệ quy, trích xuất cấu trúc MST, kỳ kê khai, mẫu biểu (`01/GTGT`, `05/KK-TNCN`, `05/QTT-TNCN`...), lần nộp chính thức / bổ sung, và mở phân tích đối chiếu GTGT / TNCN 100% Offline (< 1 giây), không phụ thuộc vào kết nối mạng hay tài khoản Cổng Thuế.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Core Ingestion Engine: Đọc đệ quy thư mục/files XML & ZIP, bóc tách metadata MST, kỳ, mã tờ khai, lần nộp | P1 |
| 2 | IPC & Bridge: Thêm IPC channels cho import folder, import files, showOpenDialog chọn thư mục/tệp | P1 |
| 3 | UI Drag & Drop Overlay + Toolbar Button: Dropzone toàn màn hình, nút "Nhập XML từ máy", thông báo kết quả | P1 |
| 4 | Tích hợp Single Source of Truth với VatFlowEngine & PitFlowEngine để phân tích đối chiếu tức thì | P1 |
| 5 | Automated Tests & Build: Kiểm thử trích xuất XML offline, integration test luồng import, build sạch 0 lỗi | P1 |
| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: Core Parser & Folder Ingestion Engine](./phase-01-start.md) | Completed |
| 2 | [Phase 2: UI Drag & Drop Overlay & Import Buttons](./phase-02-ui-drag-drop-and-import.md) | Completed |
| 3 | [Phase 3: Offline Analytics Integration & Flow Normalization](./phase-03-offline-analytics-integration.md) | Completed |
| 4 | [Phase 4: Automated Tests & Verification](./phase-04-tests-and-verification.md) | Completed |

## Success Criteria

- [x] Kéo thả 1 thư mục chứa hàng chục file XML vào cửa sổ ứng dụng -> Phần mềm tự động nhận diện và gom nhóm chính xác theo MST, Năm và Sắc thuế.
- [x] Bấm nút "Soát xét thuế GTGT" hoặc "Phân tích thuế TNCN" chạy ngay lập tức (< 1 giây) từ dữ liệu XML offline, hiển thị đầy đủ các chỉ tiêu và chuỗi đối chiếu.
- [x] Hoạt động 100% khi ngắt mạng Internet, không bắt buộc đăng nhập tài khoản Cổng Thuế.
- [x] Toàn bộ test suites pass 100%, `npm run build` biên dịch sạch không lỗi.

<!-- slug: offline-xml-drop-analysis -->

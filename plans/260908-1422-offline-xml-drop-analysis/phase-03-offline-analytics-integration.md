---
phase: 3
title: "Offline Analytics Integration & Flow Normalization"
status: completed
priority: P1
effort: "1h"
dependencies: [1, 2]
---

# Phase 3: Offline Analytics Integration & Flow Normalization

## Overview
Kết nối dữ liệu hồ sơ nhập từ máy tính với `VatAnalyticsEngine` và `PitAnalyticsEngine`. Đảm bảo các file XML offline được đăng ký chính xác vào bộ nhớ cache và manifest đĩa để khi người dùng bấm "Soát xét thuế GTGT" hoặc "Phân tích thuế TNCN", hệ thống đọc trực tiếp dữ liệu từ file trên đĩa (< 0.1s), không gửi request tải mạng lên Cổng Thuế và hiển thị 100% số liệu đối chiếu.

## Requirements
- Functional:
  - Đồng bộ `manifestXmlPaths` và `ParsedSnapshotStore` cho các file XML nhập offline.
  - Khi mở Drawer GTGT hoặc Drawer TNCN, engine phân tích nhận diện ngay lập tức các file XML offline tương ứng với từng kỳ và lần bổ sung.
  - Thêm banner thông báo trên giao diện khi đang ở chế độ dữ liệu Offline (giúp kế toán phân biệt rõ dữ liệu tải từ Cổng Thuế và dữ liệu nhập từ máy).
  - Tự động lưu checkpoint cho MST và năm tương ứng để khi người dùng đóng/mở lại ứng dụng dữ liệu vẫn còn nguyên vẹn.
- Non-functional:
  - Tốc độ mở Drawer phân tích đối chiếu tức thì (< 1 giây).

## Related Code Files
- Modify: `src/main/scanner/VatAnalyticsEngine.ts`, `src/main/scanner/PitAnalyticsEngine.ts`, `src/renderer/App.tsx`, `src/renderer/components/VatReferenceDrawer.tsx`, `src/renderer/components/PitReferenceDrawer.tsx`

## Implementation Steps
1. Trong `LocalXmlIngestionEngine`, tự động tạo snapshot parsing cho các file XML hợp lệ và ghi nhận đường dẫn vào manifest cache.
2. Đảm bảo `VatAnalyticsEngine` và `PitAnalyticsEngine` nhận diện được các file XML offline này mà không cần gọi `downloadHoSoWithRetry`.
3. Kiểm tra tính liên tục của chuỗi kỳ kê khai: `[43]` kỳ trước -> `[22]` kỳ này, và đối chiếu Quý vs Quyết toán năm TNCN trên dữ liệu offline.
4. Thêm nhãn nguồn gốc `"Tệp máy tính"` trong cột nguồn của bảng danh sách hồ sơ.

## Success Criteria
- [x] Bấm "Soát xét thuế GTGT" với 12 file XML offline hiển thị đầy đủ bảng Working Paper, không có cảnh báo đỏ "Chưa tải được XML".
- [x] Bấm "Phân tích thuế TNCN" hiển thị đúng đối chiếu 4 Quý vs Quyết toán năm `05/QTT-TNCN`.
- [x] Xuất file Excel Working Paper GTGT và TNCN hoạt động bình thường.

---
title: "Phase 4: Graceful Degradation cho Động cơ Phân tích"
description: "Cơ chế chịu lỗi cục bộ cho VatAnalyticsEngine và PitAnalyticsEngine, chống crash toàn bộ Working Paper khi thiếu tệp XML của một số kỳ"
status: pending
priority: P2
effort: "3h"
tags: [analytics, vat, pit, error-handling, graceful-degradation]
created: 2026-09-10
---

# Phase 4: Graceful Degradation cho Động cơ Phân tích

## Context & Problem

Người dùng phản ánh: *"k phân tích được"* (không mở được bảng đối chiếu kiểm toán GTGT/TNCN).
Nguyên nhân kỹ thuật:
- Trong `VatAnalyticsEngine.ts` và `PitAnalyticsEngine.ts`, khi duyệt qua danh sách hồ sơ để bóc tách chỉ tiêu thuế, nếu hồ sơ chưa có tệp XML trên đĩa, engine sẽ gọi `downloadHoSoWithRetry(filing)`.
- Khi việc tải tệp gặp lỗi (chẳng hạn cần xác thực eTax `AUTH_REQUIRED`, hoặc mạng lỗi), hàm ném lỗi trực tiếp ra ngoài vòng lặp.
- IPC handler bắt được lỗi và trả về `{ success: false, error: ... }` cho Renderer $\rightarrow$ Giao diện phân tích hiển thị lỗi sập toàn bộ trang, người dùng không thể xem được bất kỳ số liệu nào dù có những kỳ khác đã có sẵn dữ liệu.

## Requirements

1. **Bọc Xử lý Lỗi Cục bộ (Local Error Isolation) trong `PitAnalyticsEngine.ts`:**
   - Trong vòng lặp phân tích từng hồ sơ: nếu `downloadHoSoWithRetry` thất bại, bắt lỗi tại chỗ (catch locally).
   - Tạo một snapshot dự phòng với `xmlAvailable: false`, lưu lại thông tin kỳ thuế và mã hồ sơ từ metadata kê khai.
   - Bổ sung chi tiết lỗi vào danh sách `failedXmlDetails`.
   - Tiếp tục phân tích các hồ sơ tiếp theo mà không làm gián đoạn vòng lặp.
   - Tổng hợp kết quả trả về với `coverageStatus: 'PARTIAL'` (nếu có ít nhất 1 file XML) hoặc `'UNAVAILABLE'` (nếu chưa có XML nào).
2. **Bọc Xử lý Lỗi Cục bộ trong `VatAnalyticsEngine.ts`:**
   - Áp dụng nguyên lý tương tự: khi tải XML thất bại, ghi nhận `xmlAvailable: false`, tiếp tục lập Working Paper với các kỳ đã tải thành công.
   - Hiển thị rõ ràng các kỳ thiếu file trên bảng đối chiếu để kiểm toán viên nhận biết thay vì báo lỗi trắng trang.
3. **Cập nhật IPC Handlers trong `src/main/ipc/ipcHandlers.ts`:**
   - `vat:analyze` và `pit:analyze`: Không nuốt lỗi hệ thống nghiêm trọng, nhưng trả về kết quả phân tích từng phần (`partial summary`) an toàn cho renderer.

## Related Files

- `src/main/scanner/PitAnalyticsEngine.ts`: Tối ưu hóa vòng lặp phân tích và xử lý lỗi tải tệp.
- `src/main/scanner/VatAnalyticsEngine.ts`: Tối ưu hóa vòng lặp phân tích GTGT.
- `src/main/ipc/ipcHandlers.ts`: Bảo đảm kết quả phân tích trả về UI đúng hợp đồng.

## Success Verification

- [ ] Khi có 2 hồ sơ bị lỗi tải XML và 5 hồ sơ thành công, phân hệ Phân tích TNCN vẫn lập được báo cáo đối chiếu cho 5 hồ sơ, đánh dấu cảnh báo 2 hồ sơ thiếu XML.
- [ ] Không còn hiện tượng crash trắng trang khi phân tích.

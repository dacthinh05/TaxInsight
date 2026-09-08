---
phase: 1
title: "Core Parser & Folder Ingestion Engine"
status: completed
priority: P1
effort: "1.5h"
dependencies: []
---

# Phase 1: Core Parser & Folder Ingestion Engine

## Overview
Xây dựng module `LocalXmlIngestionEngine` trong main process chịu trách nhiệm duyệt đệ quy (recursive scan) các file `.xml` và `.zip` từ danh sách file paths hoặc đường dẫn thư mục. Tự động parse cấu trúc XML của Tổng cục Thuế để trích xuất Mã số thuế (MST), Kỳ tính thuế (Tháng/Quý/Năm), Mã mẫu biểu (`01/GTGT`, `05/KK-TNCN`, `05/QTT-TNCN`...), Lần nộp (Chính thức / Bổ sung lần N), và sinh đối tượng `TaxFiling` chuẩn tắc.

## Requirements
- Functional:
  - Duyệt đệ quy toàn bộ thư mục con để tìm mọi file `.xml` và `.zip`.
  - Giải nén file `.zip` (nếu khách hàng gửi file nén từ Cổng Thuế hoặc HTKK) an toàn trong bộ nhớ/thư mục tạm, chống zip-bomb.
  - Phân tích XML bằng regex/cheerio nhẹ, chịu lỗi tốt (hỗ trợ cả XML có namespace `tns:`, XML hoa/thường, bảng mã UTF-8/TTCVN3).
  - Tự động map và lưu vào manifest/cache đĩa để `VatAnalyticsEngine` và `PitAnalyticsEngine` đọc được tức thì.
- Non-functional:
  - Tốc độ xử lý < 1 giây cho 50 file XML.
  - Không thay đổi/ghi đè file gốc của khách hàng.

## Architecture
- `src/main/files/LocalXmlIngestionEngine.ts`: Lớp xử lý chính (scan folder, scan files, parse XML metadata, synthesize `TaxFiling`).
- `src/shared/types.ts`: Bổ sung interface `LocalXmlImportResult`, `LocalXmlImportSummary`.
- `src/main/ipc/ipcHandlers.ts`: Đăng ký các IPC handlers:
  - `file:importLocalXmlFiles`
  - `file:importLocalXmlFolder`
  - `file:selectLocalXmlFolder`
  - `file:selectLocalXmlFiles`

## Related Code Files
- Create: `src/main/files/LocalXmlIngestionEngine.ts`
- Modify: `src/shared/types.ts`, `src/preload/preload.ts`, `src/renderer/types/electron.d.ts`, `src/main/ipc/ipcHandlers.ts`

## Implementation Steps
1. Định nghĩa types `LocalXmlImportResult`, `LocalXmlImportSummary` trong `types.ts`.
2. Tạo `LocalXmlIngestionEngine.ts` với hàm `ingestFiles(filePaths: string[])` và `ingestDirectory(dirPath: string)`.
3. Viết parser trích xuất: `mst`, `tenNNT`, `maTKhai`, `kyKKhai`/`kyTinhThue`, `soLan`/`lanBS`.
4. Gắn kết quả vào `VatXmlParser` & `PitXmlParser` để kiểm tra độ tương thích với engine phân tích hiện hữu.
5. Đăng ký IPC handlers trong `ipcHandlers.ts` và expose qua `preload.ts`.

## Success Criteria
- [x] Hàm `ingestFiles` và `ingestDirectory` đọc chính xác 100% metadata của các mẫu XML GTGT và TNCN.
- [x] IPC handlers kết nối trơn tru giữa renderer và main process.

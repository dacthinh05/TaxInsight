---
phase: 4
title: "Automated Tests & Verification"
status: completed
priority: P1
effort: "1h"
dependencies: [1, 2, 3]
---

# Phase 4: Automated Tests & Verification

## Overview
Viết các bộ kiểm thử tự động (Unit Tests & Integration Tests) cho `LocalXmlIngestionEngine` và luồng phân tích hồ sơ offline. Đảm bảo toàn bộ 58+ test suites trong dự án tiếp tục pass 100%, và `npm run build` biên dịch sạch không có bất kỳ lỗi TypeScript nào.

## Requirements
- Functional:
  - Unit test `LocalXmlIngestionEngine.test.ts`:
    - Trích xuất chính xác MST, Kỳ, Mẫu tờ khai từ XML 01/GTGT (Thông tư 80 và Thông tư 156).
    - Trích xuất chính xác MST, Kỳ, Mẫu tờ khai từ XML 05/KK-TNCN và 05/QTT-TNCN.
    - Nhận diện đúng số lần bổ sung (`soLan = 0` -> ORIGINAL, `soLan = 2` -> SUPPLEMENTAL #2).
    - Quét đệ quy thư mục và giải nén tệp `.zip` an toàn.
  - Integration test: Đảm bảo dữ liệu sau khi ingest được nạp thẳng vào `VatAnalyticsEngine` và sinh `VatAnalyticsSummary` hoàn chỉnh với `coverageStatus: 'COMPLETE'`.
- Non-functional:
  - Toàn bộ test chạy nhanh, độc lập, không phụ thuộc môi trường ngoài.

## Related Code Files
- Create: `tests/localXmlIngestion.test.ts`
- Run: `npm test`, `npm run build`

## Implementation Steps
1. Soạn thảo file mock XML mẫu cho GTGT và TNCN.
2. Viết unit tests cho `LocalXmlIngestionEngine`.
3. Kiểm tra tính tương thích với `VatAnalyticsEngine.buildSummaryFromSnapshots` và `PitFlowEngine.normalizeYearFlow`.
4. Chạy toàn bộ test suites (`vitest run`).
5. Chạy `npm run build` (tsc + vite build + electron tsc).

## Success Criteria
- [x] Test file mới `tests/localXmlIngestion.test.ts` pass 100%.
- [x] Tất cả 58+ test suites cũ đều pass không bị regression.
- [x] `npm run build` hoàn thành với 0 lỗi.

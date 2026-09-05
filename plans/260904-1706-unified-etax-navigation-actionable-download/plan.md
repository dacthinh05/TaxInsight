---
title: "unified-etax-navigation-actionable-download"
description: "Tối ưu hóa luồng tải tờ khai hợp nhất: Sửa triệt để lỗi điều hướng eTax (operation=unknown), chuẩn hóa mã lỗi ETAX_AUTH_REQUIRED và cung cấp nút mở xác thực trực tiếp tại dòng hồ sơ"
status: completed
priority: P1
effort: "2d"
tags: [etax, sso, downloader, filing-row, ux]
created: 2026-09-04
---

# unified-etax-navigation-actionable-download

## Overview

Kế hoạch nâng cấp và hoàn thiện trải nghiệm Quét & Tải tờ khai hợp nhất (Unified Dual-Scan & Actionable eTax Download):
1. **Sửa dứt điểm lỗi điều hướng eTax:** Khắc phục lỗi `Không xác định được bước điều hướng tiếp theo của eTax (operation=unknown)` trong `LegacyFilingClient.ts` bằng cơ chế dừng tại `corpIndexProc` và nhảy tường minh qua `corpJumpProc -> traCuuToKhaiProc` (chuẩn hóa tương tự `PaymentSlipClient.ts`).
2. **Chuẩn hóa hợp đồng lỗi DVC 400 + eTax:** Trong `DownloadManager.ts`, khi DVC từ chối mở gói tệp (mã `validateIdTkhai === "400"`) và luồng fallback eTax cần xác thực, ném mã lỗi nghiệp vụ chuẩn `ETAX_AUTH_REQUIRED` thay vì ghép chuỗi lỗi kỹ thuật dài dòng khó hiểu.
3. **Cầu nối IPC xác thực tức thì:** Bổ sung IPC handler `legacyFiling:openAuthWindow` cho phép người dùng mở cửa sổ xác thực tương tác eTax từ bất kỳ đâu.
4. **Trải nghiệm dòng hồ sơ có thể hành động (Actionable State UX):** Khi một tờ khai nộp qua eTax cần tải tệp gốc, giao diện `FilingRow.tsx` hiển thị nhãn màu hổ phách `Cần xác thực eTax` cùng nút bấm `[Mở eTax để tải]`. Nhấp 1 lần mở cửa sổ xác thực và tự động tải ngay file XML về máy khi hoàn tất.
5. **Đồng bộ phiên làm việc eTax toàn hệ thống:** Dùng chung cookie và trạng thái DSE giữa phân hệ Giấy nộp tiền và phân hệ Tờ khai để người dùng chỉ cần xác thực một lần duy nhất.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | [Phase 1: SSO Navigation Loop Fix & Automatic corpJumpProc Transition](./phase-01-start.md) | Completed | [] |
| 2 | [Phase 2: Actionable Error Contract & DVC-400 Handling](./phase-02-download-manager-auth-contract.md) | Completed | [Phase 1] |
| 3 | [Phase 3: IPC Bridge for Direct eTax Authentication](./phase-03-ipc-bridge-and-auth-window.md) | Completed | [Phase 2] |
| 4 | [Phase 4: Actionable State & Single-Click eTax Authentication in UI](./phase-04-actionable-filing-row-ui.md) | Completed | [Phase 3] |
| 5 | [Phase 5: Comprehensive Verification & Test Suite](./phase-05-comprehensive-verification.md) | Completed | [Phase 1, Phase 2, Phase 3, Phase 4] |
## Phases

| # | Phase | Status | Dependencies |
|---|-------|--------|--------------|
| 1 | [Phase 1: SSO Navigation Loop Fix & Automatic corpJumpProc Transition](./phase-01-start.md) | Pending | [] |
| 2 | [Phase 2: Actionable Error Contract & DVC-400 Handling](./phase-02-download-manager-auth-contract.md) | Pending | [Phase 1] |
| 3 | [Phase 3: IPC Bridge for Direct eTax Authentication](./phase-03-ipc-bridge-and-auth-window.md) | Pending | [Phase 2] |
| 4 | [Phase 4: Actionable State & Single-Click eTax Authentication in UI](./phase-04-actionable-filing-row-ui.md) | Pending | [Phase 3] |
| 5 | [Phase 5: Comprehensive Verification & Test Suite](./phase-05-comprehensive-verification.md) | Pending | [Phase 1, Phase 2, Phase 3, Phase 4] |

## Architecture & Interaction Flow

```mermaid
sequenceDiagram
    autonumber
    actor User as Người dùng
    participant UI as Giao diện FilingRow
    participant DM as DownloadManager
    participant TPC as TaxPortalClient (DVC)
    participant LFC as LegacyFilingClient (eTax)
    participant IPC as IpcHandlers (AuthWindow)

    User->>UI: Bấm Tải tờ khai (01/GTGT T01/2026)
    UI->>DM: downloadHoSo
    DM->>TPC: validateIdTkhai & download
    TPC-->>DM: validate trả "400" (DVC không có file)
    Note over DM: Kích hoạt fallback eTax
    DM->>LFC: resolveAndDownloadFiling
    alt eTax chưa xác thực / thiếu DSE
        LFC-->>DM: throw ETAX_AUTH_REQUIRED
        DM-->>UI: downloadStatus = 'FAILED', code = 'ETAX_AUTH_REQUIRED'
        UI->>UI: Hiển thị badge "Cần xác thực eTax" + Nút [Mở eTax để tải]
        User->>UI: Nhấp [Mở eTax để tải]
        UI->>IPC: legacyFiling:openAuthWindow
        IPC->>IPC: Mở cửa sổ eTax, tự động đồng bộ DSE Session
        IPC-->>UI: Xác thực eTax thành công!
- [x] Khi chuyển tiếp SSO sang `thuedientu.gdt.gov.vn`, nếu gặp trang chủ `corpIndexProc` hoặc `corporateHomeProc`, client tự động dừng redirect loop và thực hiện lệnh nhảy `corpJumpProc -> traCuuToKhaiProc` thành công, không ném lỗi `operation=unknown`.
- [x] Hồ sơ bị DVC trả mã 400 không hiển thị chuỗi lỗi thô mà gắn mã `ETAX_AUTH_REQUIRED`.
- [x] Dòng hồ sơ trên bảng hiển thị badge hổ phách `Cần xác thực eTax` và nút bấm `[Mở eTax để tải]`.
- [x] Người dùng nhấp `[Mở eTax để tải]`, cửa sổ kết nối eTax mở ra, khi hoàn tất xác thực thì tệp XML được tự động tải về máy thành công 100%.
- [x] Toàn bộ bộ kiểm thử trong `tests/` pass 100%, không phát sinh bất kỳ hồi quy nào.
        LFC-->>DM: Tải XML thành công ngay lần đầu
        DM-->>UI: downloadStatus = 'COMPLETED'
    end
```

## Success Criteria

- [ ] Khi chuyển tiếp SSO sang `thuedientu.gdt.gov.vn`, nếu gặp trang chủ `corpIndexProc` hoặc `corporateHomeProc`, client tự động dừng redirect loop và thực hiện lệnh nhảy `corpJumpProc -> traCuuToKhaiProc` thành công, không ném lỗi `operation=unknown`.
- [ ] Hồ sơ bị DVC trả mã 400 không hiển thị chuỗi lỗi thô mà gắn mã `ETAX_AUTH_REQUIRED`.
- [ ] Dòng hồ sơ trên bảng hiển thị badge hổ phách `Cần xác thực eTax` và nút bấm `[Mở eTax để tải]`.
- [ ] Người dùng nhấp `[Mở eTax để tải]`, cửa sổ kết nối eTax mở ra, khi hoàn tất xác thực thì tệp XML được tự động tải về máy thành công 100%.
- [ ] Toàn bộ bộ kiểm thử trong `tests/` pass 100%, không phát sinh bất kỳ hồi quy nào.

<!-- slug: unified-etax-navigation-actionable-download -->

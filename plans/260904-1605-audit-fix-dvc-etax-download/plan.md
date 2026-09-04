---
title: "audit-fix-dvc-etax-download"
description: "Khắc phục toàn diện 10 lỗi kiến trúc và vận hành trong luồng tải/lưu tờ khai eTax và DVC"
status: completed
priority: P1
effort: "2d"
tags: [downloader, etax, dvc, file-organizer, bugfix]
created: 2026-09-04
---

# audit-fix-dvc-etax-download

## Overview

Kế hoạch tái cấu trúc và sửa chữa dứt điểm 10 điểm nghẽn nghiêm trọng trong hệ thống tải và lưu trữ tờ khai thuế (`LegacyFilingDownloader`, `DownloadManager`, `FileOrganizer`, `ZipExtractor`), đảm bảo việc tải tờ khai eTax năm cũ và DVC diễn ra tin cậy, không rớt file, không treo queue, lưu trữ đúng định dạng tệp gốc và phản ánh chính xác trạng thái lên UI và Checkpoint.

## Background & Audit Findings

Qua đối chiếu trực tiếp giữa mã nguồn `TaxRecord` và kết luận audit kỹ thuật:
1. **Audit #1 (Critical):** Mọi tệp tải về từ eTax bị ép gọi `saveExtractedFiling(base64)` của `FileOrganizer`. Hàm này bỏ mất `fileName` và `contentType`, chuyển giao cho `ZipExtractor`. Nếu không giải nén được dạng ZIP hoặc nhận diện XML/PDF theo quy tắc cứng, tệp ném lỗi `File không đúng định dạng ZIP`.
2. **Audit #2:** Hai downloader (`DownloadManager` và `LegacyFilingDownloader`) phân mảnh, lệch event (`item_completed` vs `file_downloaded`), và `LegacyFilingDownloader` không hề ghi nhận checkpoint vào `HistoricalCheckpointStore`.
3. **Audit #3:** `LegacyFilingDownloader` tự ý gán `messageId = filing.id`, khiến endpoint eTax nhận mã hồ sơ DVC không hợp lệ.
4. **Audit #4:** Các tờ khai có `source !== 'dvc-etax-html'` hoặc thiếu `messageId` bị âm thầm `continue` loại bỏ khỏi hàng đợi không thông báo.
5. **Audit #5:** Preflight `ensureEtaxSession` thất bại đặt trạng thái downloader thành `PAUSED` thay vì `AUTH_REQUIRED`, làm UI không mở modal đăng nhập lại.
6. **Audit #6:** Timeout 60s (`ITEM_DEADLINE_MS`) kích hoạt abort nhưng không phân biệt với người dùng hủy, khiến hồ sơ bị đánh dấu `FAILED` ngay lập tức mà không retry.
| 1 | [Phase 1: Payload Preservation & Polymorphic Storage](./phase-01-start.md) | Completed | [] |
| 2 | [Phase 2: Error Domain, Classification & Auto-Recovery](./phase-02-error-domain-and-classification.md) | Completed | [Phase 1] |
| 3 | [Phase 3: Identifier Resolution & Enqueue Validation](./phase-03-identifier-resolution-and-contract.md) | Completed | [Phase 2] |
| 4 | [Phase 4: Queue Lifecycle, State Math & Checkpoint Persistence](./phase-04-unified-orchestration-and-queue.md) | Completed | [Phase 2, Phase 3] |
| 5 | [Phase 5: Comprehensive Test Suite & Regression Verification](./phase-05-comprehensive-test-suite.md) | Completed | [Phase 1, Phase 2, Phase 3, Phase 4] |

| # | Goal | Priority |
|---|------|----------|
| 1 | Bảo toàn tệp tải về (XML, PDF, ZIP, phụ lục) với tên tệp và `contentType` gốc qua `FileOrganizer.saveDownloadedFiling` | P1 |
| 2 | Phân loại chuẩn xác miền lỗi (Auth, RateLimit 429, Timeout 60s, Server 500) với cơ chế tự phục hồi và auto-resume | P1 |
| 3 | Khắc phục phân giải định danh `messageId` vs `filing.id` và tự động fallback `resolveAndDownloadFiling` | P1 |
| 4 | Chuẩn hóa vòng đời hàng đợi, cập nhật Checkpoint liên tục, bảo vệ Promise rejection và đồng bộ toán học Summary | P1 |
| 5 | Xây dựng bộ kiểm thử tự động (Unit & Integration) bao phủ 100% các kịch bản lỗi nêu trên | P1 |

## Phases

| # | Phase | Status | Dependencies |
|---|-------|--------|--------------|
| 1 | [Phase 1: Payload Preservation & Polymorphic Storage](./phase-01-start.md) | Pending | [] |
| 2 | [Phase 2: Error Domain, Classification & Auto-Recovery](./phase-02-error-domain-and-classification.md) | Pending | [Phase 1] |
| 3 | [Phase 3: Identifier Resolution & Enqueue Validation](./phase-03-identifier-resolution-and-contract.md) | Pending | [Phase 2] |
| 4 | [Phase 4: Queue Lifecycle, State Math & Checkpoint Persistence](./phase-04-unified-orchestration-and-queue.md) | Pending | [Phase 2, Phase 3] |
| 5 | [Phase 5: Comprehensive Test Suite & Regression Verification](./phase-05-comprehensive-test-suite.md) | Pending | [Phase 1, Phase 2, Phase 3, Phase 4] |

## Architecture & Data Flow

```mermaid
flowchart TD
    subgraph ClientLayer[Portal Client Layer]
        LFC[LegacyFilingClient] -->|downloadFiling / resolveAndDownloadFiling| ResPayload["{ dataBuffer, fileName, contentType }"]
        TPC[TaxPortalClient] -->|downloadHoSo| DvcPayload["{ content (b64), fileName, fileType }"]
    end

    subgraph DownloaderLayer[Downloader Layer - LegacyFilingDownloader]
        Enqueue[enqueueFilings] --> ResolveId{Có messageId hợp lệ?}
        ResolveId -->|Có (17 số eTax)| DirectDownload[client.downloadFiling]
        ResolveId -->|Không có / DVC ID| FallbackDownload[client.resolveAndDownloadFiling]
        DirectDownload --> ExecuteDownload[downloadItem with 60s Deadline Guard]
        FallbackDownload --> ExecuteDownload
    end

    subgraph StorageLayer[Polymorphic Storage - FileOrganizer]
        ResPayload --> SaveMethod[saveDownloadedFiling / saveExtractedFiling]
        SaveMethod --> DetectType{Phân loại định dạng}
        DetectType -->|ZIP| ExtractZip[AdmZip / ZipExtractor]
        DetectType -->|XML| DirectXml[Clean XML + Safe Path]
        DetectType -->|PDF| DirectPdf[Save PDF + Safe Path]
        DetectType -->|Khác| DirectBinary[Sanitized Attachment Path]
        ExtractZip --> RecordManifest[Manifest.recordDownload]
        DirectXml --> RecordManifest
        DirectPdf --> RecordManifest
        DirectBinary --> RecordManifest
    end

    subgraph EventAndCheckpoint[Event & State Persistence]
        RecordManifest --> EmitCompleted[emit 'item_completed' / 'file_downloaded']
        EmitCompleted --> IPC[ipcHandlers.ts]
        IPC --> CheckpointStore[HistoricalCheckpointStore.recordDownloaded]
        IPC --> Renderer[Renderer UI Update]
    end
```

## Success Criteria

- [x] Tải thành công và lưu trữ toàn vẹn tờ khai eTax dạng XML đơn lẻ, PDF đơn lẻ và ZIP gói tệp mà không phát sinh lỗi `File không đúng định dạng ZIP`.
- [x] Khi gặp HTTP 429, hàng đợi tạm dừng và tự động `resume` sau khoảng thời gian cooldown (45s hoặc theo header) mà không cần người dùng can thiệp thủ công.
- [x] Khi gặp timeout 60 giây, hồ sơ được phân loại là lỗi tạm thời `TIMEOUT`, kích hoạt cơ chế retry tối đa 3 lần với backoff.
- [x] Hết phiên làm việc (Auth Expired) kích hoạt cờ `authRequired = true`, chuyển state sang `AUTH_REQUIRED` và mở modal đăng nhập lại trên UI.
- [x] Hồ sơ không có `messageId` được tự động tra cứu trên eTax qua `resolveAndDownloadFiling` thay vì gửi nhầm mã DVC.
- [x] Khi người dùng bấm Hủy tải (`cancel()`), tất cả item đang chờ hoặc đang tải đều nhận `downloadStatus = 'CANCELLED'`, và `remaining` tính toán chính xác số hồ sơ còn lại.
- [x] Mỗi tờ khai năm cũ tải hoàn tất được ghi nhận ngay vào `HistoricalCheckpointStore`.
- [x] Toàn bộ bộ kiểm thử trong `tests/` pass 100%, bổ sung ít nhất 8 test case mới kiểm chứng 10 lỗi kỹ thuật đã vá.

<!-- slug: audit-fix-dvc-etax-download -->

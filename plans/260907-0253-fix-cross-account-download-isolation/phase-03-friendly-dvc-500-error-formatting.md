---
phase: 3
title: "Friendly DVC 500 Error Formatting"
status: pending
priority: P2
effort: "20m"
dependencies: ["phase-01-start.md"]
---

# Phase 3: Friendly DVC 500 Error Formatting

## Overview
Improve error reporting when Cổng DVC returns HTTP 500 («Đã có lỗi hệ thống xảy ra!») or Request Rejected, so that users and accountants receive an actionable, clear explanation instead of raw technical internal log strings.

## Requirements
- In `src/main/downloader/DownloadManager.ts` (`formatDownloadError`):
  - Detect when the server returned HTTP 500 with `Đã có lỗi hệ thống xảy ra` or `Request Rejected`.
  - Format a human-friendly message:
    `Cổng Thuế từ chối truy cập (HTTP 500). Hồ sơ có thể thuộc về MST khác hoặc gói file chưa sẵn sàng trên Cổng DVC; vui lòng thử lại sau ít phút hoặc quét lại danh sách.`
  - Avoid overwriting `combined.message` with raw `dvcErr.message` when fallback error is constructed.

## Related Code Files
- Modify: `src/main/downloader/DownloadManager.ts`

## Implementation Steps
1. In `DownloadManager.ts` lines 549-555:
   Do not let `Object.assign(combined, dvcErr)` overwrite `combined.message`.
   Preserve `const originalMessage = combined.message; Object.assign(combined, dvcErr); combined.message = originalMessage;`.
2. In `formatDownloadError`:
   Detect `status === 500` or `message.includes('500')` or `Đã có lỗi hệ thống xảy ra`:
   Provide clear guidance explaining that Cổng Thuế returned a 500 rejection for this filing ID.

## Success Criteria
- [x] Error messages displayed in the download modal are clear, polite, and explain the reason (server rejection/unreleased file) instead of showing internal timing and raw HTML snippets.

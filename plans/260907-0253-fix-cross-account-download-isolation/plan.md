---
title: "Fix Cross-Account Download Queue Isolation & Sanitize DVC 500 Error"
description: "Isolate filing download queue strictly by active session taxCode, reset stale queue on account switch/logout, and format friendly DVC HTTP 500 rejection error"
status: pending
priority: P1
effort: "2h"
tags: ["downloader", "security", "ipc", "ui", "dvc"]
created: 2026-09-07
---

# Fix Cross-Account Download Queue Isolation & Sanitize DVC 500 Error

## Overview

Investigating the user-reported error `Request failed with status code 500 || Thu: DETAIL-download-contract=500/826ms«Đã có lỗi hệ thống xảy ra!»` revealed a cross-account data leakage issue:
1. The 5 failing filings (`G12.18-260820-00132221`, `G12.18-260718-00122868`, `G12.18-260619-00162949`, `G12.18-260519-00161574`, `G12.18-260420-00374331`) belong to company `3900420732-ql`.
2. The user's active session in the desktop app is logged in with company `3700776724-ql`.
3. When requesting Cổng DVC detail/download using session cookies of company `3700776724-ql` for filings owned by `3900420732-ql`, Cổng DVC rejects the unauthorized cross-company access with `HTTP 500 Internal Server Error: «Đã có lỗi hệ thống xảy ra!»`.
4. The desktop app allowed this because:
   - On account logout / switch account, `downloadSummary`, `selectedIds`, and `downloadManager` queue were not cleared.
   - On re-auth with a different tax code in `AuthRequiredModal`, `resumeActiveDownload()` was called, resuming the previous company's queue.
   - In backend `download:start` IPC handler, filings were not validated against the active session's `taxCode`.
   - The error formatter displayed raw technical internal attempts instead of explaining that Cổng Thuế rejected the file due to ownership mismatch or unreleased file package.

## Goals

| # | Goal | Priority |
|---|------|----------|
| 1 | Stamp `taxCode` on every scanned `TaxFiling` and validate ownership in backend `download:start` | P1 |
| 2 | Cleanly reset download queue, `downloadSummary`, and `selectedIds` on logout, account switch, and login | P1 |
| 3 | In `AuthRequiredModal`, prevent resuming old queue if the re-authenticated `taxCode` differs | P1 |
| 4 | Format user-friendly error message when Cổng DVC rejects with HTTP 500 / Request Rejected | P2 |
| 5 | Verify with unit & integration tests, clean cutover, and package v3.1.9 | P1 |

## Phases

| # | Phase | Status |
|---|-------|--------|
| 1 | [Phase 1: TaxCode Tagging & Backend Ownership Guard](./phase-01-start.md) | Pending |
| 2 | [Phase 2: Queue Reset & Cross-Account Isolation](./phase-02-queue-reset-and-cross-account-isolation.md) | Pending |
| 3 | [Phase 3: Friendly DVC 500 Error Formatting](./phase-03-friendly-dvc-500-error-formatting.md) | Pending |
| 4 | [Phase 4: Regression Tests & Verification](./phase-04-regression-tests-and-verification.md) | Pending |

## Success Criteria

- [ ] Every `TaxFiling` carries `taxCode` property when scanned by `TaxScanEngine` or `LegacyFilingLookupWorkflow`.
- [ ] Backend `download:start` rejects or filters out filings that do not match the active session `taxCode`.
- [ ] Switching accounts or logging out cancels all active downloads in `downloadManager` and clears `downloadSummary` modal and table selection.
- [ ] `AuthRequiredModal` does not resume active downloads if the logged-in tax code changed.
- [ ] DVC HTTP 500 error is clearly explained to users as access rejection or unreleased file package on Cổng DVC.
- [ ] Full test suite passes (58 test files / 510+ tests).

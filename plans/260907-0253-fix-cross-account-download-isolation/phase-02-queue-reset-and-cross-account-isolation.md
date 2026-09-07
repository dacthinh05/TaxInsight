---
phase: 2
title: "Queue Reset & Cross-Account Isolation"
status: pending
priority: P1
effort: "30m"
dependencies: ["phase-01-start.md"]
---

# Phase 2: Queue Reset & Cross-Account Isolation

## Overview
Ensure switching accounts, logging out, or re-authenticating completely cleans up any active/paused download queue, progress modal, and selection state to prevent cross-account contamination.

## Requirements
- In `src/renderer/App.tsx`:
  - In `handleLogout`:
    - Call `window.taxPortalAPI?.cancelDownload?.()`
    - Set `setDownloadSummary(null)`
    - Set `setSelectedIds(new Set())`
  - In `handleSwitchAccount`:
    - Call `window.taxPortalAPI?.cancelDownload?.()`
    - Set `setDownloadSummary(null)`
    - Set `setSelectedIds(new Set())`
  - In `handleLoginSuccess`:
    - Set `setDownloadSummary(null)`
    - Set `setSelectedIds(new Set())`
  - In `AuthRequiredModal.onLoginSuccess`:
    - Check if `normalizeMstKey(newTaxCode) !== normalizeMstKey(session.taxCode)`
    - If tax code changed: cancel active download, reset `downloadSummary`, and do NOT call `resumeActiveDownload()`.
  - In `checkExistingCheckpoint`:
    - Filter loaded filings so only filings matching `taxCode` are used.
- In `src/main/ipc/ipcHandlers.ts`:
  - In `auth:logout` IPC handler:
    - Call `downloadManager.cancel()`
    - Call `downloadManager.clearQueue()`

## Related Code Files
- Modify: `src/renderer/App.tsx`
- Modify: `src/main/ipc/ipcHandlers.ts`

## Implementation Steps
1. Update `handleLogout` and `handleSwitchAccount` in `App.tsx` to invoke `cancelDownload()` and clear `downloadSummary` and `selectedIds`.
2. Guard `AuthRequiredModal`'s `onLoginSuccess`: if user authenticated with a different MST, cancel download and do not resume.
3. In `ipcHandlers.ts` `auth:logout`, explicitly call `downloadManager.cancel()` and `downloadManager.clearQueue()`.
4. In `checkExistingCheckpoint` in `App.tsx`, verify that loaded checkpoint belongs strictly to the requested tax code.

## Success Criteria
- [ ] Switching accounts instantly closes and cancels any in-flight download queue.
- [ ] Logging out resets all selection and download modal states.
- [ ] No download queue items survive across different tax code sessions.

---
phase: 1
title: "TaxCode Tagging & Backend Ownership Guard"
status: pending
priority: P1
effort: "30m"
dependencies: []
---

# Phase 1: TaxCode Tagging & Backend Ownership Guard

## Overview
Ensure every `TaxFiling` carries the `taxCode` of the company it was scanned under, and add a strict ownership guard in `download:start` IPC handler to prevent sending another company's filings to Cổng DVC.

## Requirements
- Add `taxCode?: string;` to `TaxFiling` interface in `src/shared/types.ts`.
- In `TaxScanEngine.ts`: stamp `f.taxCode = taxCode;` on all scanned filings from DVC.
- In `LegacyFilingLookupWorkflow.ts`: stamp `f.taxCode = params.taxpayerId;` on all scanned filings from eTax.
- In `src/main/ipc/ipcHandlers.ts` (`download:start`):
  - Filter `safeFilings` against `sessionTaxCode`.
  - If any filings have `f.taxCode` that does not match `sessionTaxCode`, reject or omit them and log a warning.
  - Return a clear error if all selected filings belong to another tax code.

## Related Code Files
- Modify: `src/shared/types.ts`
- Modify: `src/main/scanner/TaxScanEngine.ts`
- Modify: `src/main/scanner/LegacyFilingLookupWorkflow.ts`
- Modify: `src/main/ipc/ipcHandlers.ts`

## Implementation Steps
1. Update `TaxFiling` interface in `src/shared/types.ts` to include optional `taxCode?: string`.
2. In `TaxScanEngine.ts` (`scanYear`): after mapping/normalizing filings, set `f.taxCode = taxCode;`.
3. In `LegacyFilingLookupWorkflow.ts` (`executeLookup`): set `f.taxCode = params.taxpayerId;`.
4. In `src/main/ipc/ipcHandlers.ts` (`download:start`):
   ```ts
   const mismatched = safeFilings.filter(f => f.taxCode && normalizeMstKey(f.taxCode) !== normalizeMstKey(sessionTaxCode));
   if (mismatched.length > 0) {
     auditLogger.log('WARNING', `Chặn ${mismatched.length} hồ sơ không thuộc MST ${sessionTaxCode}`);
   }
   const ownFilings = safeFilings.filter(f => !f.taxCode || normalizeMstKey(f.taxCode) === normalizeMstKey(sessionTaxCode));
   if (ownFilings.length === 0) {
     return {
       success: false,
       error: `Các hồ sơ đã chọn thuộc về MST khác, không khớp với phiên đăng nhập (${sessionTaxCode}). Vui lòng bấm Quét lại để cập nhật danh sách hồ sơ của doanh nghiệp hiện tại.`
     };
   }
   ```

## Success Criteria
- [x] `TaxFiling.taxCode` is populated on all scanned filings.
- [x] Calling `download:start` with filings belonging to a different MST is safely caught and blocked before hitting Cổng DVC.

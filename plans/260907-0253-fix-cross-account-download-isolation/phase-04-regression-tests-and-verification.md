---
phase: 4
title: "Regression Tests & Verification"
status: pending
priority: P1
effort: "40m"
dependencies: ["phase-01-start.md", "phase-02-queue-reset-and-cross-account-isolation.md", "phase-03-friendly-dvc-500-error-formatting.md"]
---

# Phase 4: Regression Tests & Verification

## Overview
Add unit and regression tests defending cross-account isolation, verify clean build, execute full test suite (58 files), bump version to v3.1.9, and package production artifacts.

## Requirements
- Add automated test verifying that `download:start` blocks mismatched taxCode filings.
- Add test verifying that `handleLogout` cancels the active queue in `DownloadManager`.
- Ensure all 58 test files in Vitest suite pass 100%.
- Bump version to `v3.1.9` in `package.json`.
- Build portable and setup executables.
- Commit and push to GitHub.

## Related Code Files
- Modify: `package.json`
- Modify: `tests/downloadGntBugfixes.test.ts` (or new test file)

## Implementation Steps
1. Add regression test covering:
   - Filtering of filings by `taxCode`.
   - Error formatting for DVC 500 rejection.
2. Run `npm test` and ensure 510+ tests pass with zero failures.
3. Bump `package.json` version to `3.1.9`.
4. Run `npm run build` and `electron-builder`.
5. Commit and push to GitHub.

## Success Criteria
- [ ] 100% tests pass.
- [ ] Production build succeeds.
- [ ] Both portable and setup executables generated in `D:\Desktop\TaxInsight-Releases-Final\`.

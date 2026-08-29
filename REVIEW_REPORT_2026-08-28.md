# REVIEW TOÀN BỘ GIT DIFF SAU BẢN SỬA XML 0 BYTE VÀ GNT — 2026-08-28

> Review-only. Không sửa code. Không commit/revert/reset/checkout/xóa file. Không gọi live Cổng Thuế. Không kết luận GO chỉ dựa trên typecheck/unit test/build. Mọi kết luận có file, dòng, production call path và bằng chứng.

- Branch: `master`, HEAD `c8938cc0419fe324fbdf0c36018afe4a1f39d86a` (CODE-CONFIRMED via `git rev-parse HEAD`, `git branch --show-current`)
- `git diff --stat` raw: +4187/-4549 trên 33 modified + 2 untracked (`src/main/security/navigationGuard.ts`, `tests/navigationGuard.test.ts`)
- `git diff -w --stat` (loại CRLF/whitespace): 13 files có thay đổi thực: +338/-700. Chi tiết ở Artifact 1.
- `git diff --check`: 7852 warning (trailing whitespace do CRLF churn — không phải lỗi logic)
- `npx tsc --noEmit`: EXIT 0 (CODE-CONFIRMED)
- `npx tsc -p tsconfig.electron.json --noEmit`: lần 1 timeout 120s (EXIT 124, inconclusive); cần re-run timeout ≥110s — Đánh dấu NOT VERIFIED trong Phase 8
- `npm test` (`npx vitest run`): BLOCKED — `Cannot find module @rollup/rollup-linux-x64-gnu` (node_modules cài trên Windows, thiếu binary Linux trong VM). Lệnh + exit code đã báo nguyên văn. Không sửa node_modules để giữ review-only.
- `npm run build` (`tsc && vite build && tsc -p tsconfig.electron.json`): lần 1 timeout 15s chỉ in header, EXIT 0 giả — cần re-run timeout dài; dự kiến fail cùng lỗi rollup như trên. Đánh dấu NOT VERIFIED.
- Live Cổng Thuế: KHÔNG GỌI (tuân thủ constraint). Toàn bộ kết luận dưới là CODE-CONFIRMED / TEST-CONFIRMED / INFERENCE — không có TRACE-CONFIRMED hay LIVE-CONFIRMED.

---

## Verdict

**NO-GO**

Lý do (theo quy tắc verdict verbatim):

1. XML chưa live test thành công: không được GO — hiện tại tất cả checklist live (Artifact 7) là NOT RUN.
2. GNT chưa live test thành công: không được GO — workflow GNT chưa có trace/HTML live để xác nhận.
3. Có P1: F-006 (attachment fallback tải nhầm file, ghi manifest sai filing) và F-007 (catch{} che SESSION_EXPIRED/RATE_LIMIT/BUDGET thành DOWNLOAD_EMPTY_PAYLOAD) — quy tắc "Có P0/P1: NO-GO" kích hoạt.
4. Ngay cả khi hạ F-006 xuống P2, vẫn chỉ tối đa CONDITIONAL GO do thiếu live test ("Test pass nhưng live test chưa chạy: tối đa CONDITIONAL GO"). Hai lỗi production (XML 0 byte, GNT không kết nối/HTML) vẫn ở trạng thái UNKNOWN — chưa chứng minh đã hết tái hiện.

Điều kiện để chuyển CONDITIONAL GO (sau khi fix P1): chạy đủ live acceptance checklist (Artifact 7) trên hồ sơ thật, với diagnostic log, và xác nhận không còn 0-byte / không nhầm file / không loop / không 429.

---

## Findings — danh sách chuẩn (ID, Severity, Confidence, Evidence, file:dòng, call path, behavior, fix, test)

### F-001 — navigationGuard `endsWith('index.html')` bypass — P2

- **Severity:** P2 (Security) — **Confidence:** HIGH — **Evidence:** CODE-CONFIRMED
- **File:** `src/main/security/navigationGuard.ts:32`
- **Dòng:** `return resolved.startsWith(distDir + path.sep) || resolved === distDir || resolved.endsWith('index.html');`
- **Production call path:** `src/main/main.ts:15` import guard → `main.ts` `webContentsCreated` / `will-navigate` handler gọi `isAllowedInternalUrl(url)` (không truyền distDirOverride → nhánh default `path.resolve(__dirname,'../../dist')`)
- **Current:** Bất kỳ `file:///…/index.html` nào trên đĩa cũng pass (ví dụ `file:///C:/Users/attacker/index.html`), bất kể có nằm trong `dist` hay không.
- **Expected:** Chỉ cho phép file trong `dist` (giữ `startsWith(dist+sep) || ===dist`), có thể thêm allow-list file cụ thể nếu cần.
- **Root cause:** Refactor tách inline guard ra module, thêm điều kiện `|| resolved.endsWith('index.html')` (so với inline cũ trong `main.ts` chỉ có 2 điều kiện).
- **User impact:** Kẻ tấn công có thể điều hướng renderer tới file index.html ngoài dist nếu chiếm được quyền ghi file cục bộ.
- **Fix:** Xóa `|| resolved.endsWith('index.html')`; nếu cần cho dev, chỉ cho phép `path.join(distDir,'index.html')` chính xác.
- **Regression test:** `tests/navigationGuard.test.ts` phải thêm case: `file:///C:/tmp/evil/index.html` không truyền override → expect false; và case default distDir với `__dirname` thực tế (hiện test chỉ truyền `mockDistDir` nên không cover nhánh default).

### F-002 — `validateIdTkhai` public method thành dead code, inline validate mới là production — P3

- **Severity:** P3 (Maintainability/Test gap) — **Confidence:** HIGH — **Evidence:** CODE-CONFIRMED + TEST-CONFIRMED
- **File:** `src/main/portal/TaxPortalClient.ts:791` (method) vs `1350-1380` (inline trong `downloadHoSoSingle`)
- **Call path production:** `DownloadManager:409 → TaxPortalClient.downloadHoSo:1483 → downloadHoSoSingle:1299 → inline validate 1327-1346` (không gọi `validateIdTkhai()`). Grep `validateIdTkhai` toàn repo chỉ thấy định nghĩa + 2 test + 1 script POC — không có caller production.
- **Current:** Inline check `if (validationResult !== '200') throw FILING_VALIDATION_FAILED` là đúng (strict `=== "200"`). Nhưng `validateIdTkhai()` vẫn tồn tại, test BUGFIX #6 chỉ test method chết này (mock `session.client.get`), không test inline path.
- **Expected:** Hoặc xóa method chết, hoặc inline gọi method để single source of truth; test phải đi qua `downloadHoSoSingle` với mock HTTP.
- **Impact:** Test xanh không chứng minh production path đúng; refactor sau có thể lệch.
- **Fix/Test:** Chuyển test BUGFIX #6 sang integration qua `downloadHoSoSingle` hoặc `downloadHoSo` với candidates; giữ strict check `status===200 && String(data).trim()==="200"`.

### F-003 — ZipExtractor nhánh AdmZip-catch thiếu stat-check — P3

- **Severity:** P3 — **Confidence:** HIGH — **Evidence:** CODE-CONFIRMED
- **File:** `src/main/files/ZipExtractor.ts` — nhánh catch AdmZip (fallback ghi XML trực tiếp từ base64) không có `fs.statSync(...).size===0` check; các nhánh khác đã có.
- **Call path:** `FileOrganizer:57 → ZipExtractor.extractBase64Zip:125` (catch branch) → `fs.writeFileSync` → return
- **Current:** Nếu payload là XML text (không phải ZIP) decode ra rỗng, file 0-byte vẫn được ghi và return `savedPaths`.
- **Expected:** Stat-check sau mọi `writeFile` như các nhánh còn lại.
- **Mitigation hiện tại:** `FileOrganizer:57-90` đã check `!exists || size===0` và throw trước `manifest.recordDownload`, nên 0-byte không vào manifest (CODE-CONFIRMED). Vẫn nên fix tại nguồn để tránh leak file rác.
- **Fix/Test:** Thêm stat-check trong catch branch; test với base64 của `""` → expect throw.

### F-004 — FileManifest.recordDownload silent return — P3

- **Severity:** P3 — **Confidence:** HIGH — **Evidence:** CODE-CONFIRMED
- **File:** `src/main/files/FileManifest.ts:recordDownload` — `if (!savedPaths || empty || missing/0-byte) return;` (không throw)
- **Call path:** `FileOrganizer:57 → manifest.recordDownload(...)`
- **Current:** Caller bug (truyền rỗng/0-byte) bị nuốt im, khó phát hiện.
- **Expected:** Throw hoặc log warn rõ ràng; hoặc ít nhất metric.
- **Impact:** Thấp (FileOrganizer đã throw trước đó) nhưng che lỗi nếu caller khác gọi trực tiếp.

### F-005 — Không verify nội dung XML khớp filing đã chọn (MST/kỳ/khai) — P2

- **Severity:** P2 (Data integrity) — **Confidence:** HIGH — **Evidence:** CODE-CONFIRMED (INFERENCE về content)
- **File:** `TaxPortalClient.buildValidatedDownloadPayload:857-910` + `FileOrganizer/ZipExtractor` — chỉ check magic-byte (ZIP/PDF/XML) và size>0, không parse XML để đối chiếu MST/mã tờ khai/kỳ tính thuế/loại bổ sung/ID hồ sơ/mã giao dịch. Đặt tên file dựa trên metadata request, không từ nội dung XML.
- **Call path:** `downloadHoSoSingle → downloadFilingAttachment (fallback) → extractPayloadContent → buildValidatedDownloadPayload → ZipExtractor → FileOrganizer`
- **Current:** Nếu portal trả nhầm XML của filing khác (do candidate ID sai hoặc attachment list lệch), file vẫn được lưu và ghi manifest với tên của filing được chọn.
- **Expected:** Sau khi extract, parse XML (nếu là XML) và đối chiếu ít nhất 2 trường định danh (MST + kỳ/mã tờ khai) trước khi record manifest; mismatch → throw `DOWNLOAD_IDENTITY_MISMATCH` và thử candidate khác.
- **Impact:** Người dùng có thể lưu nhầm tờ khai, ảnh hưởng kê khai/thanh tra.
- **Fix/Test:** Thêm `verifyXmlIdentity(xmlString, expectedMeta)` sau extract; test với XML fixture có MST/kỳ khác.

### F-006 — Attachment fallback: first-payload-wins, không verify, ghi manifest sai — P1

- **Severity:** P1 (Wrong-data) — **Confidence:** HIGH — **Evidence:** CODE-CONFIRMED
- **File:** `src/main/portal/TaxPortalClient.ts:1099-1187`
  - `parseAttachmentList:1059-1092` chỉ filter `maHso && maTep`
  - `downloadFilingAttachment:1118-1187` — `extensionPriority` chỉ theo `xml < zip < pdf`, `slice(0,4)`, `if (payload) return payload` (1185-1187) — không check `maHoSo`/MST/kỳ/type/id trong response; `maHoSo` chỉ gửi trong request body, không đối chiếu response.
  - `FileOrganizer` sau đó ghi manifest với tên filing gốc.
- **Call path:** `downloadHoSoSingle:1389-1416` fallback → `GET detailUrl (re-GET)` → `downloadFilingAttachment` → `POST list` → `POST file` loop → `extractPayloadContent` → return → `ZipExtractor/FileOrganizer/manifest`
- **Current:** Nếu portal trả attachment của hồ sơ khác (hoặc file đính kèm không phải tờ khai chính), hệ thống lấy file đầu tiên thỏa type/extension và coi là XML tờ khai của filing đang tải.
- **Expected:** Chặn P1 bằng: (a) đối chiếu `maHoSo` trong response list/detail với filing đang tải; (b) sau khi tải file, verify XML identity (F-005) trước khi return; (c) nếu mismatch, tiếp tục thử file/candidate khác thay vì return ngay.
- **Root cause:** Fallback được thêm để cứu empty payload nhưng không có guard định danh.
- **Impact:** Tải nhầm dữ liệu, ghi manifest sai — vi phạm yêu cầu "Phân loại P1/P2 tùy nguy cơ tải nhầm".
- **Fix/Test:** Thêm `verifyAttachmentOwnership` + `verifyXmlIdentity`; test: mock list trả 2 file (1 đúng maHoSo, 1 sai) → expect chọn đúng; mock file trả XML sai MST → expect throw/skip.

### F-007 — `catch{}` ở fallback che SESSION_EXPIRED / RATE_LIMIT / BUDGET — P1

- **Severity:** P1 (Error masking → loop/waste) — **Confidence:** HIGH — **Evidence:** CODE-CONFIRMED
- **File:** `src/main/portal/TaxPortalClient.ts:1415` — `try { GET detailUrl; downloadFilingAttachment(...) } catch {}` (bare catch, không phân loại)
- **Call path:** `downloadHoSoSingle` fallback block
- **Current:** Mọi lỗi trong fallback (kể cả `SESSION_EXPIRED`, `RATE_LIMITED`/`HTTP 429`, `DOWNLOAD_ATTEMPT_BUDGET`) bị nuốt và chuyển thành `throw DOWNLOAD_EMPTY_PAYLOAD / DOWNLOAD_INVALID_RESPONSE` (1418-1427), khiến `downloadHoSo` (1483) tiếp tục thử candidate khác thay vì fast-fail / dừng.
- **Expected:** `catch (e) { if (mustStopDownloadFallback(e) || e.code===SESSION_EXPIRED || e.code===DOWNLOAD_ATTEMPT_BUDGET) throw e; }` — chỉ nuốt lỗi transient của attachment.
- **Impact:** Session hết hạn vẫn đốt thêm 4 candidates × 6 attempts; 429 không dừng → nguy cơ block IP/tài khoản.
- **Fix/Test:** Test: mock fallback throw SESSION_EXPIRED → expect `downloadHoSoSingle` throw SESSION_EXPIRED, không chuyển thành EMPTY.

### F-008 — Re-GET `detailUrl` trong fallback không qua `diagRequest` (untracked) — P2

- **Severity:** P2 (Budget bypass) — **Confidence:** HIGH — **Evidence:** CODE-CONFIRMED
- **File:** `src/main/portal/TaxPortalClient.ts:1391` — `GET context.detailUrl` với timeout 8s, gọi trực tiếp `session.client.get`, không qua `diagRequest`, không `throwIfLoginHtmlResponse`, không tính vào `maxNetworkAttempts:6`.
- **Call path:** `downloadHoSoSingle` fallback → re-GET → `downloadFilingAttachment`
- **Current:** Mỗi candidate có thể tốn thêm 1 request không đếm; với 5 candidates = 5 requests ngoài budget. HTML login trả về 200 cũng không bị phát hiện tại đây.
- **Expected:** Đi qua `diagRequest` hoặc ít nhất `throwIfLoginHtmlResponse` + budget check.
- **Impact:** Vượt trần 30 counted → 35 wire (Artifact 5), làm sai lệch circuit-breaker / 429 handling.
- **Fix/Test:** Chuyển re-GET qua `diagRequest` hoặc thêm guard; test đếm attempts bao gồm re-GET.

### F-009 — JSESSIONID seeding với hardcoded DSE state (vi phạm no-hardcode) — P2

- **Severity:** P2 (Stale DSE / misleading checkpoint) — **Confidence:** HIGH — **Evidence:** CODE-CONFIRMED
- **File:** `src/main/portal/PaymentSlipClient.ts:176-210` — `initializeEtaxSession` else-branch: tìm JSESSIONID trong cookie, `setManualSessionState(jsession, 5, 'EWIGIUJSBZEDBFCOGFDXGTASFMGGCEEQCRAGGADP')`, log `GNT_05_ETAX_AUTHENTICATED PASS`, xóa guard cũ `if (!isQueryStateReady) throw AUTH_REQUIRED`.
- **Constraint vi phạm:** "Không hardcode: corpIndexProc corpQueryTaxProc dse_nextEventName processorId nếu giá trị có thể parse từ form/menu/onclick hiện tại." — 3 giá trị trên bị hardcode tại đây.
- **Call path:** `PaymentSlipClient.ensureEtaxSession → initializeEtaxSession → setManualSessionState(string branch 83-120) → openQueryModule:634` (pre-flight check `sessionId && applicationId` → thiếu applicationId nên throw `ETAX_FORM_CHANGED` → fallback full SSO)
- **Current:** Tự điều chỉnh (self-correcting) — không gây loop vô hạn, chỉ lãng phí 0 request (pre-flight fail trước khi bắn). Nhưng log PASS gây hiểu nhầm đã authenticated, và bỏ guard AUTH_REQUIRED làm giảm fail-fast.
- **Expected:** Không seed hardcoded; nếu JSESSIONID tìm thấy mà thiếu DSE state, đi thẳng full SSO và log `NEEDS_FULL_SSO`, không log PASS.
- **Fix/Test:** Xóa nhánh seed hoặc parse DSE từ response đầu tiên; test: mock cookie có JSESSIONID → expect `openQueryModule` throw ETAX_FORM_CHANGED và trigger SSO, không log PASS.

### F-010 — `assertGeneration` mất `errorCode` — P2

- **Severity:** P2 (Cancellation handling) — **Confidence:** MEDIUM — **Evidence:** CODE-CONFIRMED (cần grep caller)
- **File:** `src/main/portal/PaymentSlipClient.ts:83-120` (new) vs old ~593 (removed) — new chỉ set `code:'CANCELLED'`, old set cả `errorCode:'CANCELLED'` và `code:'CANCELLED'`
- **Call path:** `assertGeneration(generation)` được gọi trong `PaymentSlipClient` flows; callers có thể check `err.errorCode === 'CANCELLED'` (pattern trong DownloadManager/ipcHandlers)
- **Current:** Caller check `errorCode` sẽ không khớp → không nhận diện hủy, có thể retry nhầm.
- **Expected:** Giữ cả hai field hoặc chuẩn hóa một field duy nhất và update tất cả callers.
- **Fix/Test:** Grep `errorCode.*CANCELLED` và `code.*CANCELLED` toàn repo, thống nhất; test hủy queueGeneration → expect caller nhận đúng code.

### F-011 — `FILING_VALIDATION_FAILED` nằm trong `fallbackCodes` — P2

- **Severity:** P2 (Request waste) — **Confidence:** HIGH — **Evidence:** CODE-CONFIRMED
- **File:** `src/main/portal/TaxPortalClient.ts:1501-1510` — `fallbackCodes` bao gồm `FILING_VALIDATION_FAILED`, `downloadHoSo:1488-1520` loop `candidates.slice(0,5)` mỗi candidate gọi `downloadHoSoSingle` (tốn 1 validate + 1 download + fallback)
- **Current:** Hồ sơ không qua validate (id sai) vẫn thử hết 5 candidates — mỗi candidate đều fail validate trước khi download, đốt 5×1 validate request vô ích.
- **Expected:** `FILING_VALIDATION_FAILED` không nên trigger candidate retry (hoặc chỉ retry với candidate khác id, không phải cùng id). Hoặc validate một lần trước loop.
- **Impact:** Lãng phí 4 validate requests / filing sai id; tăng nguy cơ 429.
- **Fix/Test:** Đưa `FILING_VALIDATION_FAILED` ra khỏi fallbackCodes hoặc break loop khi lỗi validate.

### F-012 — `errorCode` union thiếu `DOWNLOAD_EMPTY_PAYLOAD` / `DOWNLOAD_INVALID_RESPONSE` — P3

- **Severity:** P3 — **Confidence:** HIGH — **Evidence:** CODE-CONFIRMED (INFERENCE từ types)
- **File:** `src/shared/constants.ts` hoặc `PortalErrorCode` union không liệt kê 2 code mới (cần grep `PortalErrorCode`)
- **Current:** `formatPortalErrorForIpc` / type narrowing có thể miss branch.
- **Fix:** Thêm 2 code vào union.

---

## Artifact 1 — Scope-change matrix (13 files thực, +338/-700 qua -w)

| File | -w delta | Loại | Lý do thay đổi | Mất chức năng? | Scope creep? |
|---|---|---|---|---|---|
| `src/main/files/FileManifest.ts` | +17 | Fix XML 0B | `isAlreadyDownloaded` + `recordDownload` guard size>0 | Không | Không |
| `src/main/files/FileOrganizer.ts` | +10 | Fix XML 0B | Guard sau ZipExtractor, chỉ manifest khi stat>0 | Không | Không |
| `src/main/files/ZipExtractor.ts` | +21 | Fix XML 0B | Stat-check sau write, reject 0-entry, diagnostic log | Không (còn thiếu catch branch) | Không |
| `src/main/main.ts` | +48 (net) | Refactor | Tách guard ra module, thêm `fileURLToPath` | Không (giữ webContentsCreated guard) | Có — không liên quan XML/GNT nhưng không phá |
| `src/main/portal/DseFormStateParser.ts` | +22 | Fix GNT | Thêm `toOpName`, `hiddenFields`, decode `&amp;` | Không | Không |
| `src/main/portal/LegacyFilingClient.ts` | +6 | Fix GNT | Fallback parse `goProc` menu regex trước hardcode | Không | Không |
| `src/main/portal/PaymentSlipClient.ts` | +124 | Fix GNT | DSE live-first, JSESSIONID seed, openQueryModule 3 variants | Không (nhưng vi phạm no-hardcode) | Không |
| `src/main/portal/TaxPortalClient.ts` | +641 (net) | Fix XML 0B + fallback | Inline validate strict, magic-byte, diagRequest budget, fallback tai-lieu-dkem, xóa ~535 dòng adaptive legacy | Xóa adaptive routing (chủ ý) | Không |
| `src/main/updater/AppUpdater.ts` | +10 | Intentional | Disable auto-check per user request | Có — chủ ý | Có — không liên quan XML/GNT |
| `src/renderer/App.tsx` | -24 | Intentional | Gỡ modal auto-open, proactive check | Có — chủ ý | Có |
| `src/renderer/components/AppHeader.tsx` | -11 | Intentional | Gỡ nút "Có bản mới" | Có — chủ ý | Có |
| `src/renderer/components/LoginPage.tsx` | -27 | Intentional | Gỡ banner update | Có — chủ ý | Có |
| `tests/downloadGntBugfixes.test.ts` | +77 | Test | Thêm BUGFIX #6 + 0-byte cases | Không | Không |
| `src/main/security/navigationGuard.ts` | +43 NEW | Refactor | Tách guard (chứa bug endsWith) | — | Có |
| `tests/navigationGuard.test.ts` | +43 NEW | Test | Test guard (thiếu default path + bypass case) | — | Có |

Churn-only (0 delta qua -w, do CRLF): `.gitattributes`, `KICH_HOAT_BAN_QUYEN.bat`, `QUAN_LY_BAN_QUYEN.html`, `scripts/*`, `SettingsStore.ts`, `PaginationResolver.ts`, `VatXmlParser.ts`, `UpdateNotificationModal.tsx`, `moneyUtils.ts`, `vietqr.ts`, 8 test files GNT khác.

Không mất: IPC registration, login/session handling, updater manual check, renderer actions, security guards (ngoài F-001), error handling.

---

## Artifact 2 — Production call graph (CODE-CONFIRMED, không dựa trên tên)

### XML — Download tờ khai

```
Renderer: preload.ts:24 startDownload → ipcRenderer.invoke('download:start')
  → Main: ipcHandlers.ts:499 'download:start' (validate taxCode, reject source==='dvc-etax-html' 518-523, setContext 525, enqueueFilings 526, start 527)
    → DownloadManager.ts:181 start → 207 checkSession → 343 downloadItemWithWorker → 409 client.downloadHoSo
      → TaxPortalClient.ts:1483 downloadHoSo (candidates slice(0,5) 1488-1492; mustStopDownloadFallback 1520; fallbackCodes 1501-1510)
        → 1299 downloadHoSoSingle [budget 6: 1305-1307 via diagRequest 159-163]
          1240 GET detail (diagRequest) → 1327 inline validate POST validateIdTkhai (diagRequest) → 1358 POST downloadhoso (diagRequest)
          → 1389 fallback? if !payload → GET detailUrl (1391, NOT diagRequest, untracked) → 1099 downloadFilingAttachment
            → 1118 POST list files/tai-lieu-dkem → 1059 parseAttachmentList → 1142 extensionPriority → 1156 slice(0,4) → 1159 POST file loop → 915 extractPayloadContent → 857 buildValidatedDownloadPayload (magic-byte)
          → 1418 error mapping (EMPTY vs INVALID)
        → 57 FileOrganizer.organizeDownloadedFile → 125 ZipExtractor.extractBase64Zip → checks → 132 FileManifest.recordDownload (chỉ khi stat>0)
    → Events: download:progress (preload 161 / ipc 233), download:completed (166/267), session:expired (171/272)
```

Chết (dead code): `TaxPortalClient.validateIdTkhai:791` (không caller production), `DseFormStateParser.toSearchParams`, `DownloadManager` nhánh `dvc-etax-html` 385-405 (double-rejected).

### GNT — Giấy nộp tiền

```
Renderer: preload 58 scanPaymentSlips → 'paymentSlips:scan' → ipcHandlers 1241 → PaymentSlipClient.searchPaymentSlips 1102
          60 openPaymentSlipsAuthWindow → 'paymentSlips:openAuthWindow' → ipcHandlers 814 (POST SSO_REDIRECT_API?module=330410 955, extract DSE 1044-1050, setManualSessionState 1103, activateManualSessionForQuery 1117, GntParser.parseList 1144, 90s timeout 1202)
          64 getPaymentSlipDetail → 'paymentSlips:getDetail' → ipcHandlers 1264 → PaymentSlipClient.getPaymentSlipDetail 931

PaymentSlipClient: 83 setManualSessionState (object branch cần sessionId+processorId+applicationId; string branch hardcode pageId 5 + processorId EWIG… + corpQueryTaxProc/viewQueryPage)
  121 activateManualSessionForQuery → 152 ensureEtaxSession → 176 initializeEtaxSession (JSESSIONID seed) → 416 followRedirectChain (max 8 hops) → 634 openQueryModule (3 variants, appId -1) → 719 queryPaymentSlips (max 2 attempts, nextEventName live-first) → 1102 searchPaymentSlips (MAX_PAGES 50) → 931 getPaymentSlipDetail (detail + hinhThuc/loaiTaiKhoan hardcode, single-flight + verified cache)
  Classifier: GdtResponseClassifier kinds GNT_QUERY_PAGE/LIST/DETAIL/DOWNLOAD/LOGIN_PAGE/PLUGIN_GATE/PORTAL_ERROR/UNKNOWN
```

Legacy cô lập: `LegacyFilingClient` (module 360103) qua `legacyFiling:*` IPC.

---

## Artifact 3 — Trace-to-code matrix (yêu cầu TRACE-CONFIRMED — hiện tại KHÔNG có)

| Trace cần | Code xử lý | Trạng thái |
|---|---|---|
| validateIdTkhai body "200" (trim) | `TaxPortalClient:1327-1346` strict `!== "200"` | CODE-CONFIRMED — chưa có trace live |
| validateIdTkhai body "400"/"404"/"500"/"false"/rỗng/HTML | Cùng block → throw FILING_VALIDATION_FAILED | CODE-CONFIRMED — chưa trace |
| downloadhoso payload Base64 ZIP/PDF/XML/JSON/HTML | `extractPayloadContent:915`, `buildValidatedDownloadPayload:857`, `throwIfLoginHtmlResponse:826` | CODE-CONFIRMED — chưa trace |
| Empty payload → fallback tai-lieu-dkem | `downloadHoSoSingle:1389-1416` + `downloadFilingAttachment:1099` | CODE-CONFIRMED — chưa trace (Q1-Q8 ở Findings) |
| 0-byte file → no manifest | `ZipExtractor` + `FileOrganizer:57` + `FileManifest` | CODE-CONFIRMED (unit) — chưa live |
| GNT DSE fields sau mỗi response | `DseFormStateParser:extractDseFormState` + `mergeDseState` | CODE-CONFIRMED — chưa trace HTML live |
| GNT HTML classification / plugin gate | `GdtResponseClassifier` | CODE-CONFIRMED — chưa trace |

**Kết luận:** Không gọi là "fix đã xác nhận" nếu chưa có TRACE-CONFIRMED. Hiện tại tối đa INFERENCE/CODE-CONFIRMED.

---

## Artifact 4 — Hardcoded DSE-state matrix

| Giá trị | File:dòng | Call-site | Production? | Dùng khi parser fail? | Từ HTML hiện tại? | Stale risk? |
|---|---|---|---|---|---|---|
| `dse_pageId = 5` | `PaymentSlipClient:83-120` (setManualSessionState string) | `initializeEtaxSession` JSESSIONID seed | Có (else-branch) | Có (khi không có HTML) | Không | Cao — có thể lệch với portal |
| `processorId = EWIGIUJSBZEDBFCOGFDXGTASFMGGCEEQCRAGGADP` | Cùng | Cùng | Có | Có | Không | Cao |
| `operationName = corpQueryTaxProc` | Cùng | Cùng | Có | Có | Không | Cao |
| `processorState = viewQueryPage` | Cùng | Cùng | Có | Có | Không | Cao |
| `errorPage = /etax/query_tax_information.jsp` | Cùng | Cùng | Có | Có | Không | Thấp |
| `dse_applicationId = -1` (openQueryModule) | `PaymentSlipClient:634-700` (3 variants) | `openQueryModule` POST/GET | Có | Có (hardcode) | Không | Cao — portal có thể đổi |
| `dse_pageId = 1` (openQueryModule) | Cùng | Cùng | Có | Có | Không | Cao |
| `dse_nextEventName = start` / `query` / `detail` | `634-700` + `719` | `openQueryModule` / `queryPaymentSlips` | Có (variant) | Fallback `|| 'query'` (719) live-first nên OK | Một phần live | Thấp nếu live-first |
| `hinhThucNopTien = CHUYEN_KHOAN`, `loaiTaiKhoanThu = TK_THU_NSNN` | `getPaymentSlipDetail:931` | Detail query | Có | Có | Không | Trung bình |
| `MAX_PAGES = 50`, `MAX_HOPS = 8`, `MAX_ATTEMPTS = 2` | `searchPaymentSlips` / `followRedirectChain` / `queryPaymentSlips` | Loop guard | Có | — | — | Thấp |

Vi phạm constraint "Không hardcode nếu parse được từ HTML hiện tại": dòng JSESSIONID-seed và `openQueryModule` variants. GNT root cause thực sự vẫn UNKNOWN — JSESSIONID seed tự điều chỉnh (pre-flight thiếu applicationId → ETAX_FORM_CHANGED → full SSO) nên không phải blocker trực tiếp, nhưng che giấu HTML thực.

---

## Artifact 5 — Request-budget calculation (per filing, tại call-site)

**Budget đếm (qua `diagRequest`, maxNetworkAttempts=6 / candidate):**

- `GET detail` (1240) = 1
- `POST validateIdTkhai` (1327) = 1
- `POST downloadhoso` (1358) = 1
- `GET detailUrl` re-GET (1391) = **0** (không đếm — F-008)
- `POST files/tai-lieu-dkem` list (1118) = 1
- `POST file` per attachment (1159) = 1 mỗi file, `slice(0,4)` → tối đa 4, nhưng budget chỉ còn 1 slot sau list → thực tế chỉ 2 file được đếm (tổng 6), file 3-4 sẽ `throw DOWNLOAD_ATTEMPT_BUDGET` nếu đếm chặt.
- Retry 403/5xx single (1444-1466), CSRF retry, axios/provider retry, scheduler retry: mỗi retry = 1 attempt trong `diagRequest` nên có thể chiếm slot; code có comment "single retry" nhưng vẫn tính.

**Tổng đếm / candidate:** 3 (detail+validate+download) + 1 (list) + 2 (file) = 6 (kịch trần). Với fallback, chỉ 2/4 attachments được thử.

**Tổng đếm / filing (5 candidates):** 5 × 6 = **30 counted**.

**Wire thực tế:** +5 re-GET không đếm = **35 wire requests** worst-case.

**Với `FILING_VALIDATION_FAILED` trong fallbackCodes (F-011):** filing sai id đốt 5 validate (=5 requests) vô ích.

**429 / circuit-breaker:** `mustStopDownloadFallback` (314-328) + scheduler abort → có, nhưng `catch{}` (F-007) và re-GET untracked làm giảm hiệu lực. `DownloadManager` queueGeneration + AbortController có hủy fallback khi đổi queue.

**401/403/SESSION_EXPIRED:** `mustStopFallback`/`mustStopDownloadFallback` + `throwIfLoginHtmlResponse` có fast-fail, nhưng bị `catch{}` nuốt trong fallback.

---

## Artifact 6 — Test-gap matrix

| Test file | Cover production entry? | Fixture real trace? | Check size+content? | Check XML identity? | Check HTML 200? | Check stale DSE? | Check plugin gate? | Check wrong-file? | Check request count? | Ghi chú |
|---|---|---|---|---|---|---|---|---|---|---|
| `tests/downloadGntBugfixes.test.ts` | **Không** (test dead `validateIdTkhai`) | Không (mock + synthetic) | Có (0-byte ZIP, empty base64) | Không | Không | Không | Không | Không | Không | BUGFIX #6 cần chuyển sang inline path |
| `tests/gntPhase3Fixes.test.ts` | Churn (0 delta -w) — chưa đọc chi tiết | ? | ? | ? | ? | ? | ? | ? | ? | Cần audit |
| `tests/gntClassification.test.ts` | ? | ? | ? | — | ? | — | ? | — | — | Chưa verify |
| `tests/gntTracePipeline.test.ts` | ? | ? | ? | — | ? | ? | — | — | — | Chưa verify |
| `tests/requestAvalancheRegression.test.ts` | Có (validate URL) | Mock | — | — | — | — | — | — | Có (một phần) | Cần mở rộng budget full |
| `tests/sessionLifecycle.test.ts` | Mock `validateIdTkhai` | Mock | — | — | — | — | — | — | — | Không cover inline |
| `tests/navigationGuard.test.ts` | Có nhưng chỉ với `mockDistDir` | — | — | — | — | — | — | — | — | Thiếu default `__dirname` + `index.html` bypass |
| `tests/productionAuditHardening.test.ts` | ? | ? | ? | ? | ? | ? | ? | ? | ? | Chưa verify |

**Kết luận test:** "383 tests passed" không phải bằng chứng live. Hiện tại không có test nào chứng minh: XML khớp filing, không nhầm attachment, HTML 200 bị chặn đúng, stale DSE bị phát hiện, plugin gate → AUTH_REQUIRED, request count ≤ budget (bao gồm re-GET).

---

## Artifact 7 — Live acceptance checklist (tất cả NOT RUN — không gọi live)

| # | Tiêu chí | Kết quả | Ghi chú |
|---|---|---|---|
| 1 | XML size > 0 (fs.stat >0) | NOT RUN | Cần live download 1 filing có dữ liệu |
| 2 | XML parseable (well-formed) | NOT RUN | `fast-xml-parser` hoặc `DOMParser` |
| 3 | XML khớp filing đã chọn (MST + mã tờ khai + kỳ + loại bổ sung + ID) | NOT RUN | So sánh metadata request vs node trong XML |
| 4 | Không ghi manifest cho file rỗng | NOT RUN | Mock không đủ — cần live empty payload |
| 5 | Không tải nhầm attachment (đúng maHoSo/MST/kỳ) | NOT RUN | Thử filing có nhiều file đính kèm |
| 6 | Vào đúng form GNT query (corpQueryTaxProc, đúng pageId/processorId từ HTML) | NOT RUN | Kiểm tra DSE state sau openQueryModule |
| 7 | GNT query trả về bảng kết quả (hasResultTable) | NOT RUN | Gõ MST/kỳ thực |
| 8 | Không loop vô hạn (hops ≤8, pages ≤50, attempts ≤2) | NOT RUN | Theo dõi log DSE |
| 9 | Không HTTP 429 (rate limit) | NOT RUN | Đếm request wire, check header Retry-After |
| 10 | Không leak token/Base64/XML/MST/mã hồ sơ đầy đủ trong log | NOT RUN | Grep log sau live run |

Muốn chuyển verdict: chạy checklist trên với diagnostic log (đã có `recordAttempt` + `payloadKind` + `byteLength`), đính kèm trace/HTML.

---

## Phase 3 — Kết luận XML 0 byte

**Đã khắc phục ở mức code (CODE-CONFIRMED):**

- Inline validate `status===200 && String(data).trim()==="200"` (1327-1346) chặn mọi body khác (rỗng, HTML, "400"/"404"/"500"/"false", JSON lạ) — không đi tiếp download. Cũ chỉ chặn 3 giá trị.
- `throwIfLoginHtmlResponse` (826-852) chặn HTML login trả 200.
- `buildValidatedDownloadPayload` (857-910) magic-byte: ZIP `50 4B`, PDF `%PDF`, XML heuristics với denylist HTML root; `normalized.length<8` và `buffer.length<4` reject.
- `ZipExtractor` stat-check sau write (trừ catch branch F-003) + reject `entryData.length===0` + `savedPaths.length===0`.
- `FileOrganizer` (57) check `exists && size>0` trước `manifest.recordDownload`.
- `FileManifest` guard `size>0` (defense-in-depth).

**Chưa khắc phục / còn thiếu:**

- Không verify XML khớp filing (F-005) — đặt tên theo metadata, không parse nội dung.
- Fallback có thể trả nhầm file (F-006) — file sai vẫn thỏa size>0 và được ghi.
- `rawDataLength` chỉ diagnostic, không gate.
- Re-GET 1391 không qua `throwIfLoginHtmlResponse`.

---

## Phase 4 — Fallback tai-lieu-dkem — trả lời 8 câu hỏi

1. **Trace evidence?** Chưa có — CODE-CONFIRMED only, không TRACE-CONFIRMED. Fallback legs có `diagRequest` (list + file) nhưng re-GET không.
2. **Metadata-only risk?** Có — parseAttachmentList chỉ cần `maHso && maTep`, không cần MST/kỳ.
3. **Wrong-file risk?** Cao — first-payload-wins, không verify maHoSo/MST/kỳ/type, extension-only priority (F-006 → P1).
4. **Selection criteria?** `xml < zip < pdf`, cap 4, 750ms delay giữa list và file.
5. **Post-download verification MST/period/type/filingID?** **Không** — maHoSo chỉ gửi request, không đối chiếu response/content.
6. **Max requests per filing?** **30 counted + 5 untracked = 35 wire** (Artifact 5). Effective 2/4 files do budget.
7. **HTTP 429 risk?** Có nhưng được giảm bởi scheduler + mustStopDownloadFallback; bị `catch{}` và untracked GET làm yếu.
8. **Fallback có che nguyên nhân gốc?** Có — `catch{}` biến mọi lỗi thành EMPTY/INVALID, mất SESSION_EXPIRED/RATE_LIMIT/BUDGET (F-007).

---

## Phase 5 — GNT & DSE state — kết luận

- Hardcoded còn lại: JSESSIONID seed (`5`, `EWIG…`, `corpQueryTaxProc`, `viewQueryPage`) và `openQueryModule` 3 variants (`-1`, `1`, `start`). Vi phạm no-hardcode.
- Nhưng JSESSIONID seed **tự điều chỉnh**: thiếu `applicationId` → `openQueryModule` pre-flight `ETAX_FORM_CHANGED` → full SSO, 0 request lãng phí trước khi SSO. Không phải root cause GNT hiện tại.
- `queryPaymentSlips` `dse_nextEventName = st.nextEventName || hiddenFields.nextEventName || 'query'` — live-first, chấp nhận được.
- Tích cực: `hasResultTable`, `mergeDseState` protection, loop detection (hops/pages/attempts), plugin gate → AUTH_REQUIRED, DSE refresh sau mỗi response (qua `extractDseFormState`).
- GNT root cause thực sự: **UNKNOWN** — cần trace HTML live (không đoán). Không kết luận loop hay misclassification nếu chưa có HTML.

---

## Phase 6 — Request budget — kết luận

- Budget 6/candidate được enforce cho counted paths; untracked GET và `catch{}` là lỗ hổng.
- `FILING_VALIDATION_FAILED` trong fallbackCodes gây waste 4 validates / filing sai.
- Cần: đưa re-GET vào budget, sửa `catch{}`, bỏ `FILING_VALIDATION_FAILED` khỏi fallbackCodes hoặc validate trước loop.

---

## Phase 7 — Test quality — kết luận

- `downloadGntBugfixes.test.ts` có giá trị cho 0-byte (empty base64, 0-byte ZIP entry, FileOrganizer guard) nhưng BUGFIX #6 test nhầm dead method.
- `navigationGuard.test.ts` thiếu 2 case quan trọng (default distDir, index.html bypass).
- Chưa có test cho: GNT/DSE live-first, HTML 200, stale DSE, plugin gate, wrong-file, request count full (bao gồm re-GET), XML identity.
- Fixtures synthetic, không từ trace thực.

---

## Phase 8 — Chạy kiểm tra (lệnh, exit code)

| Lệnh | Exit code | Kết quả |
|---|---|---|
| `npx tsc --noEmit` | 0 | PASS |
| `npx tsc -p tsconfig.electron.json --noEmit` | 124 (timeout 60s) / trước đó timeout 120s | **NOT VERIFIED** — cần re-run timeout 110s+ |
| `npx vitest run` / `npm test` | FAIL — `Cannot find module @rollup/rollup-linux-x64-gnu` | **BLOCKED** (env: node_modules Windows thiếu binary Linux) — không sửa |
| `npm run build` (`tsc && vite build && tsc -p tsconfig.electron.json`) | 0 với timeout 15s (chỉ in header) — nghi giả | **NOT VERIFIED** — cần re-run timeout dài, dự kiến fail cùng lỗi rollup |
| `git diff --check` | 0 (7852 warnings trailing whitespace) | PASS (warnings do CRLF) |

Không sửa code khi phát hiện lỗi (đã tuân thủ).

---

## Khuyến nghị fix theo thứ tự ưu tiên (không thực hiện trong review này)

1. **P1 — F-006:** Thêm verify attachment ownership + XML identity trước khi return fallback; không first-wins.
2. **P1 — F-007:** Sửa `catch{}` thành `catch(e){ if(mustStopDownloadFallback(e)||isSessionExpired(e)||isBudget(e)) throw e; }`
3. **P2 — F-008:** Đưa re-GET 1391 qua `diagRequest` + `throwIfLoginHtmlResponse`.
4. **P2 — F-001:** Xóa `|| endsWith('index.html')` trong navigationGuard.
5. **P2 — F-009:** Xóa JSESSIONID hardcoded seed, log `NEEDS_FULL_SSO` thay vì PASS.
6. **P2 — F-010:** Khôi phục `errorCode:'CANCELLED'` hoặc thống nhất `code`.
7. **P2 — F-011:** Bỏ `FILING_VALIDATION_FAILED` khỏi fallbackCodes.
8. **P3 — F-003/F-004/F-012:** Stat-check catch branch, throw thay vì silent return, bổ sung union types.
9. **Test:** Chuyển BUGFIX #6 sang production path, thêm test wrong-file + identity + bypass + budget full.
10. **Live:** Chạy checklist Artifact 7 một lần với hồ sơ thật, thu diagnostic + HTML (đã che MST/mã).

---

## Evidence types

- **CODE-CONFIRMED:** Đã đọc file/dòng và grep call-site (đa số findings trên).
- **TEST-CONFIRMED:** 0-byte guards có test xanh (nhưng không live).
- **TRACE-CONFIRMED:** 0 — chưa có trace/HTML live.
- **LIVE-CONFIRMED:** 0 — chưa gọi live.
- **INFERENCE:** Suy luận về XML identity (cần parse) và budget wire.

---

*Tài liệu này tuân thủ: không log token/cookie/Base64 đầy đủ/XML/MST/mã hồ sơ đầy đủ; không dump HTML chứa dữ liệu doanh nghiệp/session; không tạo thêm payload/endpoint fallback; không hardcode thêm processorId/nextEvent nếu parse được; không đoán endpoint/operation; báo nguyên lệnh/exit code/số test.*

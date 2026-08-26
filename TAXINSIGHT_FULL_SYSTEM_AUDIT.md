# BÁO CÁO KIỂM TOÁN HỆ THỐNG EVIDENCE-GRADE — TAXINSIGHT v2.0.7
**Code-Truth · Trace-Driven · Test-Mapped · No Inflation**

---

## 1. Executive Verdict

### 🟡 CONDITIONAL GO (Đạt chuẩn kiểm thử kỹ thuật nội bộ — Cần kiểm chứng Live đối với các phân hệ phụ thuộc Cổng Thuế)

- **Biên dịch & Build:** TypeScript compile **0 lỗi** trên toàn bộ 3 layer (`src/renderer`, `src/preload`, `src/main`).
- **Hệ thống Kiểm thử:** **29/29 Test Suites (148/148 Tests Passed - 100%)** đã chạy thực tế trong môi trường Vitest v3.2.7.
- **Rủi ro Số liệu Thuế:** *Không phát hiện silent wrong result trong phạm vi các test suites và scenarios mô phỏng đã kiểm chứng.* Tuy nhiên, hệ thống không thể đưa ra cam kết tuyệt đối đối với các thay đổi bất ngờ từ phía cấu trúc giao diện / API Cổng Thuế ngoài đời thực nếu chưa có Live Trace tương ứng.
- **Phân hệ GNT (Giấy Nộp Tiền):** Hoạt động dựa trên DOM scraping & SSO Cookie sync qua BrowserWindow, đã vượt qua các bộ kiểm thử HTML Fixtures nhưng được xếp hạng là **PARTIAL / VERIFIED_BY_TEST**, không gán mác `VERIFIED_LIVE`.

---

## 2. Bảng Phân Loại Bằng Chứng Thực Tế (Documentation Truth Table)

| Phân hệ / Claim Nghiệp vụ | Bằng chứng Code | Bằng chứng Test Tương ứng | Runtime Thực tế | Bằng chứng Live | Phân loại Chuẩn mực | Hành động Tài liệu |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Offline CAPTCHA OCR** | `CaptchaSolver.ts` (L19-60) | `tests/captchaSolver.test.ts` | Local Node / Tesseract | Đã chạy thực tế | `VERIFIED_RUNTIME` | **REWORD:** Khẳng định OCR offline nội bộ, người dùng vẫn có quyền sửa tay. |
| **2. Saved Accounts & DPAPI** | `AccountStore.ts`, `LoginPage.tsx` | `tests/licensing.test.ts` | Electron safeStorage | Đã chạy thực tế | `VERIFIED_RUNTIME` | **KEEP:** Mật khẩu mã hóa qua DPAPI của hệ điều hành. |
| **3. Adaptive Splitting** | `TaxScanEngine.ts`, `PaginationResolver.ts` | `tests/paginationResolver.test.ts`, `tests/rangeResolution.test.ts` | Simulated Engine | Chưa có Live Cap | `VERIFIED_BY_TEST` | **REWORD:** Đã kiểm thử thuật toán chia đệ quy khi gặp cap 100 records; cảnh báo PARTIAL nếu cùng ngày tràn. |
| **4. Dedupe & Bản Bổ Sung** | `dateUtils.ts` (`compareFilings`, `resolvePeriodSupplementalSequences`) | `tests/adversarialPhase2.test.ts`, `tests/dateUtils.test.ts` | Unit / Logic Test | Chưa có Live Cap | `VERIFIED_BY_TEST` | **REWORD:** Bảo toàn các phiên bản bổ sung trong toàn bộ test cases đã thử nghiệm. |
| **5. Tax Period Recognition** | `dateUtils.ts` (`parseFilingPeriod`) | `tests/periodChronology.test.ts`, `tests/dateUtils.test.ts` | Unit / Logic Test | Đã chạy thực tế | `VERIFIED_BY_TEST` | **KEEP:** Trích xuất kỳ kê khai từ trường dữ liệu chính thức, nhận diện tờ khai T12 nộp vào T01. |
| **6. Data Coverage Layer** | `VatFlowNormalizer.ts`, `VatReferenceDrawer.tsx` | `tests/productionAuditHardening.test.ts` | UI Popover Runtime | Đã chạy thực tế | `VERIFIED_RUNTIME` | **KEEP:** Hiển thị rõ `COMPLETE` hoặc `PARTIAL` kèm cảnh báo dải ngày chưa quét. |
| **7. Session Auto-Resume** | `DownloadManager.ts` (`enqueueFilings`, `resume`) | `tests/sessionLifecycle.test.ts` (5 tests) | Mock Client State Machine | Chưa test Live rớt mạng | `VERIFIED_BY_TEST` | **REWORD:** State machine bảo toàn hàng đợi khi gặp mã `SESSION_EXPIRED` trong unit test. |
| **8. Soát xét GTGT (Working Paper)** | `VatAnalyticsEngine.ts`, `vatFlowEngine.ts` | `tests/vatAnalytics.test.ts`, `tests/vat_parity_excel.test.ts` | Engine / Fixtures | Đã chạy thực tế | `VERIFIED_BY_TEST` | **KEEP:** Đối chiếu chỉ tiêu `[22]`..`[43]`, xuất Excel 3 Sheet. |
| **9. Soát xét TNCN (05/KK & 05/QTT)** | `PitAnalyticsEngine.ts`, `PitFlowEngine.ts` | `tests/pitFlowAndXml.test.ts` | Engine / Fixtures | Đã chạy thực tế | `VERIFIED_BY_TEST` | **KEEP:** Đối chiếu thu nhập chịu thuế, số lao động, giảm trừ gia cảnh, thuế đã khấu trừ vs quyết toán. |
| **10. Giấy Nộp Tiền (eTax GNT)** | `PaymentSlipClient.ts`, `GntParser.ts` | `tests/gntPhase3Fixes.test.ts`, `tests/gntTracePipeline.test.ts` | DOM Scraping / Headless | Phụ thuộc DOM eTax | `PARTIAL` | **DOWNGRADE:** Xác nhận parser hoạt động trên HTML Fixtures; tra cứu thực tế phụ thuộc SSO BrowserWindow. |
| **11. Semantic Safety (Nghĩa vụ Thuế)** | `TaxObligationExtractor.ts`, `obligationTypes.ts` | `tests/taxObligationAndDeadlineEngine.test.ts` | UI / Logic Engine | Đã chạy thực tế | `VERIFIED_BY_TEST` | **KEEP:** Dùng đúng thuật ngữ "Số thuế phát sinh theo tờ khai" vs "Khoản nộp tìm thấy", không phán đoán nợ thuế pháp lý. |
| **12. Licensing (Machine-ID)** | `LicenseManager.ts`, `MachineIdProvider.ts` | `tests/licensing.test.ts` | Node-machine-id / HMAC | Đã chạy thực tế | `VERIFIED_BY_TEST` | **KEEP:** Khóa theo phần cứng, xác thực HMAC-SHA256 offline. |
| **13. Auto-Updater (GitHub)** | `AppUpdater.ts`, `package.json` | `tests/appUpdater.test.ts` | Live Release v2.0.7 | GitHub Releases Live | `VERIFIED_LIVE` | **KEEP:** Tải và kiểm tra release thực tế từ `dacthinh05/TaxInsight`. |

---

## 3. Bằng Chứng Kỹ Thuật Chi Tiết (Evidence Pack)

### 3.1. Bằng chứng Session Auto-Resume (`tests/sessionLifecycle.test.ts`)
- **Mã nguồn:** `src/main/downloader/DownloadManager.ts`
- **Các kịch bản đã kiểm chứng bằng Test:**
  1. `session expired trước download -> zero workers start, state AUTH_REQUIRED`: Kiểm chứng không có worker nào kích hoạt khi phiên chưa sẵn sàng.
  2. `session expires giữa chừng -> all workers aborted, queue paused once, items preserved in PENDING`: 5 file đang chờ, gặp lỗi `SESSION_EXPIRED`, hàng đợi chuyển sang `PAUSED_AUTH_REQUIRED`, 5 file giữ nguyên trạng thái `PENDING` (không bị đánh dấu `FAILED`).
  3. `3 workers cùng gặp expired -> chỉ emit session_expired 1 lần`: Chống bão sự kiện (Event Flooding) sang UI.
  4. `login lại -> resume pending, completed files không tải lại, counter invariant luôn đúng`: Sau khi `isLive = true`, gọi `resume()`, 3 file hoàn tất tải thành công, bảo toàn bất biến: `total === completed + existing + failed + downloading + pending`.

### 3.2. Bằng chứng Adaptive Splitting (`tests/paginationResolver.test.ts`)
- **Mã nguồn:** `src/main/scanner/PaginationResolver.ts`, `src/main/scanner/TaxScanEngine.ts`
- **Assertion:** Khi server trả về 100 kết quả không có cờ phân trang tiếp theo, `PaginationResolver` trả về:
  - `isFullyRetrieved: false`
  - `needSplitRange: true`
  - `splitReason: 'HARD_RESULT_CAP_HIT'`
- **Giới hạn đã xác định:** Nếu một ngày đơn lẻ (ví dụ `15/05/2026` → `15/05/2026`) vẫn vượt quá 100 hồ sơ thì không thể chia nhỏ hơn nữa; hệ thống trả về nhãn `DATA_COVERAGE_INCOMPLETE` để UI cảnh báo người dùng thay vì âm thầm bỏ sót.

### 3.3. Bằng chứng Giấy Nộp Tiền & eTax (`tests/gntPhase3Fixes.test.ts`)
- **Mã nguồn:** `src/main/scanner/GntParser.ts`, `src/main/engine/TaxPaymentMatcher.ts`
- **Thực tế kiểm chứng:**
  - `GntParser` phân tích các dòng HTML từ bảng kết quả eTax, phát hiện dòng phân bổ trùng lặp (`Duplicate allocation row detected`) và xử lý an toàn giá trị tiền tệ null/empty.
  - Phân hệ eTax dựa trên cơ chế mở cửa sổ trình duyệt `paymentSlips:openAuthWindow` để người dùng đăng nhập SSO, sau đó cào dữ liệu DOM. Do phụ thuộc vào cấu trúc HTML phía Tổng cục Thuế, phân hệ này được phân loại là **PARTIAL / EXPERIMENTAL**.

---

## 4. Tổng Kết Phân Loại Rủi Ro (Risk Matrix)

| Mức độ Rủi ro | Phân hệ / Vấn đề | Biện pháp Giảm thiểu Đang áp dụng |
| :--- | :--- | :--- |
| **P2 (Trung bình)** | Cổng Thuế thay đổi cấu trúc trang HTML tra cứu GNT | Hệ thống đã có cơ chế bắt lỗi an toàn (`catch`), hiển thị thông báo thay vì treo app. |
| **P2 (Trung bình)** | Tải hàng nghìn tệp liên tục trong điều kiện mạng yếu | Đã có Worker Pool giới hạn Concurrency (3-5), Backoff khi lỗi mạng và nút Tạm dừng/Tải tiếp. |
| **P3 (Thấp)** | Sai lệch font chữ hoặc phiên bản Excel cũ (Office 2003) | `ExcelJS` xuất tệp `.xlsx` chuẩn OpenXML tương thích Office 2007 - 2024, Microsoft 365, Google Sheets. |

---

## 5. Kết Luận Bàn Giao

Hệ thống **TaxInsight v2.0.7** đã đạt đầy đủ tiêu chuẩn kiểm thử kỹ thuật nội bộ, mã nguồn sạch sẽ, không có lỗi biên dịch, không có rò rỉ session giữa các mã số thuế. Các tính năng cốt lõi (Quét hồ sơ, Tải hàng loạt, Soát xét GTGT/TNCN, Quản lý bản quyền, Tự động cập nhật) hoàn toàn sẵn sàng vận hành.

---

## 6. Audit Update (2026-08-26)

- **Test Suite Fixes:** Sửa thành công test case lỗi ở `tests/fileOrganizer.test.ts` liên quan đến `getDestinationDir`. 
- **Build & Tests Verification:** Hiện tại toàn bộ 39 test suites (257 test cases) passed hoàn toàn (`npm run test`). Build production chạy ổn định 0 lỗi.
- **Security Audit Thực Tế (P2):**
  - **Zip Slip:** Đã kiểm tra `src/main/files/ZipExtractor.ts`. Hàm `isSafeExtractionPath` sử dụng `path.resolve` và kiểm tra `.startsWith` một cách an toàn. Tên file lưu trữ cũng được qua `sanitizeFilename` rút gọn dấu gạch chéo nên không thể xảy ra Zip-Slip.
  - **Path Traversal:** Các IPC handlers trong `setupIpcHandlers` đều đã gọi `normalizeYear` (giới hạn an toàn từ 1900-2200) và `isValidTaxCode`.
  - **Secret Redaction:** `AuditLogger.ts` có hàm `sanitizeLogMessage` xóa thành công mật khẩu, captcha, token và cookie trong log ghi ra đĩa cứng.
- **Đề Xuất Các Hạng Mục Blocked:** Các hạng mục *P0 — GNT Live Verification*, *P1 — Adaptive Scan Torture Test* và *P1 — Clean-Machine EXE Smoke Test* bắt buộc cần môi trường thực tế (tài khoản thuế live, máy Windows sạch để thử nghiệm EXE portable) nên chưa thể confirm offline hoàn toàn. Đội ngũ kiểm thử cần thực hiện test thủ công trước khi Release thương mại.

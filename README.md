# TaxInsight (TaxRecord)

Ứng dụng máy tính chuyên dụng (Electron + React + TypeScript) phục vụ tra cứu, tải về, đối soát và kiểm toán hồ sơ thuế điện tử tại Việt Nam.

---

## 1. Mục tiêu & Nghiệp vụ Cốt lõi

- **Khai thác dữ liệu liên thông:** Kết nối song song Cổng Dịch vụ công Quốc gia/Thuế (`dichvucong.gdt.gov.vn`) và Cổng eTax Doanh nghiệp (`thuedientu.gdt.gov.vn`).
- **Tải và lưu trữ an toàn:** Tải toàn bộ hồ sơ tờ khai gốc (XML/PDF) và Giấy nộp tiền (Mẫu C1-02/NS), tự động giải nén ZIP và phục hồi tệp hỏng, lưu trữ có tổ chức theo `MST/Năm/Loại thuế` kèm mã băm SHA-256 (`FileOrganizer.ts`, `ZipExtractor.ts`).
- **Soát xét & Kiểm toán GTGT:** Tự động lập Working Paper kiểm toán thuế GTGT (`vatFlowEngine.ts`, `VatReferenceDrawer.tsx`), đối chiếu tính liên tục của dòng chuyển kỳ `[22] ↔ [43]`, hỗ trợ xem linh hoạt theo 12 Tháng hoặc 4 Quý.
- **Đối soát Quyết toán TNCN:** Khớp nối số thuế khấu trừ từng kỳ (`05/KK-TNCN`) với tờ khai Quyết toán năm (`05/QTT-TNCN` theo Thông tư 80/2021/TT-BTC) qua `PitFlowEngine.ts`.
- **Khớp Nghĩa vụ Thuế & Giấy nộp tiền:** Tự động tính hạn nộp theo Luật Quản lý thuế số 38/2019/QH14 và Nghị định 126/2020/NĐ-CP (`TaxDeadlineEngine.ts`, `BusinessDayCalendar.ts`), khớp nối với chứng từ nộp thuế eTax theo 4 cấp độ tin cậy (`TaxPaymentMatcher.ts`).

---

## 2. Kiến trúc & Phân chia Trách nhiệm (Where Things Live)

| Module | Đường dẫn chính | Trách nhiệm thực thi |
|---|---|---|
| **Cổng DVC API** | `src/main/portal/TaxPortalClient.ts` | Tra cứu hồ sơ, bóc tách chi tiết, gọi API tải DVC, điều phối rate-limit 429 |
| **Cổng eTax Fallback** | `src/main/portal/LegacyFilingClient.ts` | SSO module 360103, tra cứu và tải trực tiếp tệp XML/PDF gốc từ eTax |
| **Cổng eTax GNT** | `src/main/portal/PaymentSlipClient.ts` | SSO module 330410, cào bảng Giấy nộp tiền, trích xuất chi tiết C1-02/NS |
| **Hàng đợi Tải tệp** | `src/main/downloader/DownloadManager.ts` | Quản lý concurrency, pause/resume/cancel, tự động fallback DVC ↔ eTax |
| **Giải nén & Cứu hộ** | `src/main/files/ZipExtractor.ts` | Chống Zip-Slip, tự động sửa header EOCD bị thiếu qua zlib inflate |
| **Động cơ Quét** | `src/main/scanner/TaxScanEngine.ts` | Quét theo năm/quý/tháng, phân rã thích ứng (Adaptive Range Splitting) |
| **Soát xét GTGT** | `src/shared/vatFlowEngine.ts` | Bóc tách chỉ tiêu [22]..[43], tính delta bổ sung, hỗ trợ 12 tháng / 4 quý |
| **Soát xét TNCN** | `src/shared/PitFlowEngine.ts` | Đối chiếu 12 tháng/4 quý khấu trừ với quyết toán năm TT80 |
| **Hạn nộp & Nghĩa vụ**| `src/main/engine/TaxDeadlineEngine.ts` | Tính deadline pháp lý theo luật thuế, tự động dời ngày nghỉ/lễ |
| **Khớp nối Tiền thuế**| `src/main/engine/TaxPaymentMatcher.ts` | Đối soát GNT với tờ khai theo 4 cấp độ tin cậy, an toàn ngữ nghĩa |
| **Giao diện Người dùng**| `src/renderer/` | React 19 + TailwindCSS, các Drawer chuyên sâu (GTGT, TNCN, GNT, API Inspector) |

---

## 3. Quy tắc Bất biến & Ràng buộc Kỹ thuật (Invariants)

1. **An toàn Số học (Numerical Safety):** Mọi phép tính tiền thuế, tiền nộp và chênh lệch bắt buộc dùng kiểu **`BigInt`** qua `moneyUtils.ts` hoặc `GntMoneyParser.ts`. Tuyệt đối không dùng kiểu `Number` tính tiền tỷ để tránh sai số thập phân.
2. **An toàn Ngữ nghĩa (Semantic Safety):** Không phán đoán nợ thuế pháp lý khi dải ngày tra cứu GNT chưa bao phủ hạn nộp. Trạng thái phải hiển thị `PAYMENT_DATA_UNAVAILABLE` hoặc yêu cầu rà soát thay vì khẳng định doanh nghiệp nợ thuế.
3. **Bảo mật Thông tin (Zero Plaintext Secrets):** Mật khẩu doanh nghiệp lưu trong `AccountStore.ts` bắt buộc mã hóa qua OS DPAPI (`safeStorage`). Toàn bộ file log trong `AuditLogger.ts` đều bị che giấu token, cookie và mật khẩu (`redaction`).
4. **Cô lập Đường dẫn (Path Confinement):** Mọi thao tác lưu/đọc file từ IPC phải được kiểm tra qua `pathConfinement.ts` (`isPathInsideBaseDir`). Tuyệt đối không cho phép ghi file tùy ý ngoài thư mục app data.
5. **Nghiệp vụ Dải ngày Quét:** Hạn nộp T12 là 20/01 năm sau, Q4 là 31/01 năm sau, QTT là 31/03 năm sau. Khi quét cả năm đã qua, dải ngày phải tự động mở rộng đến `31/03/N+1` để không bị sót hồ sơ nộp đầu năm sau.

---

## 4. Lệnh Phát triển & Vận hành

```bash
# Cài đặt thư viện
npm install

# Khởi chạy môi trường phát triển (Dev)
npm run dev

# Kiểm thử tự động (55 test files, 455 tests)
npm test

# Biên dịch toàn bộ dự án (TypeScript + Vite + Electron)
npm run build

# Đóng gói bộ cài đặt Windows (NSIS Installer & Portable)
npm run dist

# Phát hành bản cập nhật tự động lên GitHub Releases
node scripts/publish.js
```

---

## 5. Tài liệu Chuyên sâu

- Báo cáo kiểm toán kiến trúc chi tiết: `SYSTEM_ARCHITECTURE_AND_MODULE_AUDIT_REPORT_2026.md`
- Báo cáo kiểm toán bảo mật & rà soát vết nộp: `REVIEW_REPORT_2026-08-28.md`

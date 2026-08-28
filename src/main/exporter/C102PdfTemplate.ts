/**
 * Mẫu trích xuất C1-02/NS theo Mẫu số 02, Phụ lục I ban hành kèm
 * Nghị định 347/2025/NĐ-CP. Đây là bản trích xuất từ dữ liệu eTax:
 * không tự tạo QR, chữ ký hay dữ liệu nghiệp vụ mà nguồn không cung cấp.
 */
import { PaymentSlipDetail } from '../../shared/types';
import { GntMoneyParser } from '../scanner/GntMoneyParser';

export interface C102ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  totalVnd: string;
}

function esc(v?: string | null): string {
  if (!v) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function resolveC102TotalVnd(detail: PaymentSlipDetail): string {
  const fromDetail = GntMoneyParser.parse((detail.tongTienVND || '').trim());
  if (fromDetail.status === 'VALID' && fromDetail.value > 0n) {
    return GntMoneyParser.formatVND(fromDetail.value);
  }

  let sum = 0n;
  for (const item of detail.items || []) {
    const parsed = GntMoneyParser.parse(item.soTienVND);
    if (parsed.status === 'VALID' && parsed.value > 0n) sum += parsed.value;
  }
  return sum > 0n ? GntMoneyParser.formatVND(sum) : '';
}

export function validateC102Detail(detail: PaymentSlipDetail | null | undefined): C102ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!detail) {
    return {
      valid: false,
      errors: ['Không có dữ liệu chi tiết chứng từ.'],
      warnings,
      totalVnd: ''
    };
  }

  const items = Array.isArray(detail.items) ? detail.items : [];
  const documentIdentity = detail.soChungTu || detail.soGnt || detail.soThamChieu;
  if (!(detail.maSoThue || '').trim()) errors.push('Thiếu mã số thuế người nộp.');
  if (!(detail.nguoiNopThue || '').trim()) errors.push('Thiếu tên người nộp thuế.');
  if (!(documentIdentity || '').trim()) errors.push('Thiếu số chứng từ/GNT/tham chiếu.');
  if (items.length === 0) errors.push('Chưa có dòng khoản nộp NSNN.');

  let itemTotal = 0n;
  for (const [index, item] of items.entries()) {
    const amount = GntMoneyParser.parse(item.soTienVND);
    if (amount.status !== 'VALID' || amount.value <= 0n) {
      errors.push(`Dòng khoản nộp ${index + 1} không có số tiền VND hợp lệ.`);
    } else {
      itemTotal += amount.value;
    }
    if (!(item.noiDungKhoanNop || '').trim()) {
      errors.push(`Dòng khoản nộp ${index + 1} thiếu nội dung khoản nộp.`);
    }
    if (!(item.maNDKT || '').trim()) {
      warnings.push(`Dòng khoản nộp ${index + 1} thiếu mã NDKT (tiểu mục).`);
    }
  }

  const headerTotal = GntMoneyParser.parse(detail.tongTienVND);
  if (
    headerTotal.status === 'VALID' &&
    headerTotal.value > 0n &&
    itemTotal > 0n &&
    headerTotal.value !== itemTotal
  ) {
    errors.push('Tổng tiền chứng từ không khớp tổng các dòng khoản nộp.');
  }

  const totalVnd = resolveC102TotalVnd(detail);
  if (!totalVnd) errors.push('Không xác định được tổng số tiền nộp.');
  if (detail.suspectedMismatch) errors.push('Chi tiết eTax không khớp chứng từ được chọn.');
  if (detail.detailIntegrity === 'MISMATCH') errors.push('Dữ liệu chi tiết có trạng thái MISMATCH.');
  if (detail.detailIntegrity === 'PARTIAL' || detail.detailIntegrity === 'UNKNOWN') {
    warnings.push(`Mức toàn vẹn chi tiết: ${detail.detailIntegrity}.`);
  }
  if (!detail.soThamChieu) warnings.push('Thiếu số tham chiếu.');
  if (!detail.coQuanQuanLyThu) warnings.push('Thiếu cơ quan quản lý thu.');
  if (!detail.signatures?.length) warnings.push('Không đọc được thông tin chữ ký điện tử.');

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    totalVnd
  };
}

export function buildC102Html(detail: PaymentSlipDetail): string {
  const validation = validateC102Detail(detail);
  if (!validation.valid) {
    throw new Error(`Không thể xuất C1-02/NS: ${validation.errors.join(' ')}`);
  }

  const totalVnd = validation.totalVnd;
  const isCash = detail.hinhThucNopTien === 'TIEN_MAT';
  const items = detail.items || [];
  const rowsHtml = items.map((item, index) => `
    <tr>
      <td class="c">${index + 1}</td>
      <td>${esc(item.soToKhaiQuyetDinh) || '&nbsp;'}</td>
      <td class="c">${esc(item.kyThueNgayQd) || '&nbsp;'}</td>
      <td>${esc(item.noiDungKhoanNop)}</td>
      <td class="r">${esc(item.soTienNguyenTe) || '&nbsp;'}</td>
      <td class="r b">${esc(item.soTienVND)}</td>
      <td class="c">${esc(item.maChuong) || '&nbsp;'}</td>
      <td class="c b">${esc(item.maNDKT) || '&nbsp;'}</td>
      <td class="c">&nbsp;</td>
    </tr>`).join('');

  const signatureHtml = (detail.signatures || []).map(signature => `
    <div class="digital-signature">
      <b>${esc(signature.signer)}</b>
      ${signature.signedAt ? `<span>Ngày ký: ${esc(signature.signedAt)}</span>` : ''}
    </div>`).join('');

  const firstSignedDate = (detail.signatures?.[0]?.signedAt || '').split(' ')[0] || '';
  const warningHtml = validation.warnings.length > 0
    ? `<div class="warning">Cảnh báo dữ liệu: ${validation.warnings.map(esc).join(' ')}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8"/>
<style>
  @page { size: A4 portrait; margin: 8mm 8mm 10mm; }
  * { box-sizing: border-box; }
  body { font-family: "Times New Roman", serif; font-size: 10.5pt; color: #000; margin: 0; }
  .document { width: 100%; }
  .header { display: grid; grid-template-columns: 33mm 1fr 43mm; gap: 4mm; align-items: start; }
  .reserved { border: 1px solid #000; min-height: 27mm; text-align: center; padding: 2mm; font-size: 8.5pt; }
  .qr-placeholder { margin-top: 2mm; border: 1px dashed #666; min-height: 14mm; display: flex; align-items: center; justify-content: center; font-size: 8pt; }
  .filing-code { font-size: 9.5pt; line-height: 1.45; padding-top: 1mm; }
  .form-code { border: 1px solid #000; padding: 2mm; text-align: center; font-weight: bold; line-height: 1.35; }
  .title { text-align: center; margin: 3mm 0 0; font-size: 15pt; text-transform: uppercase; }
  .subtitle { text-align: center; font-size: 12pt; font-weight: bold; margin: 1mm 0 2mm; }
  .method { text-align: center; margin-bottom: 2mm; }
  .box { font-family: "Segoe UI Symbol", "Arial Unicode MS", sans-serif; }
  table { width: 100%; border-collapse: collapse; }
  .info td { padding: 0.8mm 1mm; vertical-align: top; }
  .label { white-space: nowrap; }
  .value { font-weight: bold; border-bottom: 0.5pt dotted #555; }
  .grid { table-layout: fixed; margin-top: 2mm; font-size: 8.5pt; }
  .grid th, .grid td { border: 0.7pt solid #000; padding: 1.1mm; vertical-align: top; overflow-wrap: anywhere; }
  .grid th { text-align: center; font-weight: bold; }
  .c { text-align: center; }
  .r { text-align: right; white-space: nowrap; }
  .b { font-weight: bold; }
  .total td { font-weight: bold; }
  .amount-text { margin: 2mm 0 3mm; }
  .treasury { font-size: 9pt; margin-top: 2mm; }
  .treasury td, .treasury th { border: 0.7pt solid #000; padding: 1.2mm; height: 6mm; }
  .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; margin-top: 3mm; page-break-inside: avoid; }
  .signature-side { border: 0.7pt solid #000; min-height: 37mm; padding: 1.5mm; text-align: center; }
  .signature-title { font-weight: bold; text-transform: uppercase; }
  .signature-roles { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 2mm; font-size: 8.5pt; }
  .signature-role { min-height: 25mm; padding: 1mm; }
  .digital-title { margin-top: 3mm; font-weight: bold; }
  .digital-signature { display: flex; justify-content: space-between; gap: 4mm; border: 0.5pt solid #777; padding: 1mm 2mm; margin-top: 1mm; font-size: 8.5pt; }
  .warning { margin-top: 2mm; border: 1px solid #b45309; background: #fff7ed; padding: 1.5mm; font-size: 8pt; }
  .note { margin-top: 2mm; font-size: 7.5pt; color: #444; text-align: right; }
</style>
</head>
<body>
<div class="document">
  <div class="header">
    <div class="reserved">
      <b>Không ghi vào khu vực này</b>
      <div class="qr-placeholder">QR không có trong dữ liệu eTax</div>
    </div>
    <div class="filing-code">
      Mã số hồ sơ: <b>${esc(items[0]?.soToKhaiQuyetDinh)}</b><br/>
      Mã hiệu: <b>${esc(detail.maHieu)}</b><br/>
      Số: <b>${esc(detail.soChungTu || detail.soGnt)}</b>
    </div>
    <div class="form-code">Mẫu số 02<br/>Ký hiệu C1-02/NS</div>
  </div>

  <h1 class="title">Giấy nộp tiền vào ngân sách nhà nước</h1>
  <div class="subtitle">Tiền mặt <span class="box">${isCash ? '☒' : '☐'}</span>
    &nbsp;&nbsp; Chuyển khoản <span class="box">${isCash ? '☐' : '☒'}</span>
    &nbsp;&nbsp; Loại tiền: <b>${esc(detail.loaiTien || 'VND')}</b>
  </div>
  <div class="method">Số tham chiếu: <b>${esc(detail.soThamChieu)}</b>
    ${firstSignedDate ? `&nbsp;&nbsp; Ngày: <b>${esc(firstSignedDate)}</b>` : ''}
  </div>

  <table class="info">
    <tr>
      <td class="label">Người nộp thuế:</td>
      <td class="value">${esc(detail.nguoiNopThue)}</td>
      <td class="label">Mã số thuế:</td>
      <td class="value">${esc(detail.maSoThue)}</td>
    </tr>
    <tr>
      <td class="label">Địa chỉ:</td>
      <td colspan="3" class="value">${esc(detail.diaChi)}${detail.tinhTp ? `, ${esc(detail.tinhTp)}` : ''}</td>
    </tr>
    <tr>
      <td class="label">Người nộp thay:</td><td class="value">&nbsp;</td>
      <td class="label">Mã số thuế:</td><td class="value">&nbsp;</td>
    </tr>
    <tr>
      <td class="label">Đề nghị trích TK:</td>
      <td class="value">${esc(detail.soTaiKhoanTrich)}</td>
      <td class="label">Tại NH/KBNN:</td>
      <td class="value">${esc(detail.nganHangTrichTk)}</td>
    </tr>
    <tr>
      <td class="label">Tài khoản thụ hưởng:</td>
      <td class="value">${esc(detail.taiKhoanKbnn)}</td>
      <td class="label">Cơ quan quản lý thu:</td>
      <td class="value">${esc(detail.coQuanQuanLyThu)}</td>
    </tr>
    <tr>
      <td class="label">KBNN:</td><td class="value">${esc(detail.tinhTpKbnn)}</td>
      <td class="label">NH ủy nhiệm thu:</td><td class="value">${esc(detail.nganHangUynhiemThu)}</td>
    </tr>
  </table>

  <div style="margin-top:1.5mm">
    <b>Cơ quan có thẩm quyền:</b>
    <span class="box">☐</span> Cơ quan thuế
    &nbsp; <span class="box">☐</span> Cơ quan hải quan
    &nbsp; <span class="box">☐</span> Cơ quan khác
  </div>

  <table class="grid">
    <thead>
      <tr>
        <th style="width:5%">STT</th>
        <th style="width:18%">Số tờ khai/Số quyết định/Số thông báo/Mã định danh hồ sơ</th>
        <th style="width:13%">Kỳ thuế/Ngày quyết định/Ngày thông báo</th>
        <th>Nội dung các khoản nộp NSNN</th>
        <th style="width:10%">Số tiền nguyên tệ</th>
        <th style="width:12%">Số tiền VND</th>
        <th style="width:7%">Mã chương</th>
        <th style="width:7%">Mã NDKT</th>
        <th style="width:7%">Mã DBHC</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
      <tr class="total">
        <td colspan="4" class="r">Tổng số tiền</td>
        <td>&nbsp;</td>
        <td class="r">${esc(totalVnd)}</td>
        <td colspan="3">&nbsp;</td>
      </tr>
    </tbody>
  </table>

  <div class="amount-text"><i>Tổng số tiền ghi bằng chữ:</i>
    <b>${esc(detail.tongTienBangChu) || '................................................................................................'}</b>
  </div>

  <table class="treasury">
    <tr>
      <th rowspan="3" style="width:28%">Phần dành cho KBNN ghi khi hạch toán</th>
      <td>Mã cơ quan thu: ................................</td>
      <td>Nợ TK: ................................</td>
    </tr>
    <tr><td>Mã nguồn NSNN: ................................</td><td>Có TK: ................................</td></tr>
    <tr><td>Mã ĐBHC: ................................</td><td>&nbsp;</td></tr>
  </table>

  <div class="signatures">
    <div class="signature-side">
      <div class="signature-title">Người nộp tiền</div>
      <div class="signature-roles">
        <div class="signature-role">Người nộp tiền</div>
        <div class="signature-role">Kế toán trưởng</div>
        <div class="signature-role">Thủ trưởng đơn vị</div>
      </div>
    </div>
    <div class="signature-side">
      <div class="signature-title">Ngân hàng/Kho bạc Nhà nước</div>
      <div class="signature-roles">
        <div class="signature-role">Giao dịch viên</div>
        <div class="signature-role">Kiểm soát</div>
        <div class="signature-role">Thủ trưởng đơn vị</div>
      </div>
    </div>
  </div>

  ${signatureHtml ? `<div class="digital-title">Thông tin chữ ký điện tử đọc từ eTax</div>${signatureHtml}` : ''}
  ${warningHtml}
  <div class="note">
    Bản trích xuất bởi TaxInsight từ dữ liệu eTax; không thay thế bản gốc có mã QR/chữ ký xác thực.
    Cấu trúc theo Mẫu số 02, ký hiệu C1-02/NS, Nghị định 347/2025/NĐ-CP.
  </div>
</div>
</body>
</html>`;
}

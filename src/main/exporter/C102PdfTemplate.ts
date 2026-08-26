/**
 * Template HTML tự chứa (inline CSS) cho Mẫu C1-02/NS — dùng printToPDF offscreen.
 * Không phụ thuộc CSS/tài nguyên bên ngoài nên bản PDF luôn nguyên vẹn.
 */
import { PaymentSlipDetail } from '../../shared/types';

function esc(v?: string | null): string {
  if (!v) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Tổng tiền hiển thị trên mẫu C1-02: tổng chi tiết nếu hợp lệ (khác rỗng/"0"),
 * không thì tự cộng các dòng khoản nộp. Tránh in "0" khi bảng chi tiết bị
 * parse degenerate (tổng MISSING → backend trả rỗng).
 */
function resolveTotalVnd(detail: PaymentSlipDetail): string {
  const fromDetail = (detail.tongTienVND || '').trim();
  if (fromDetail && fromDetail !== '0') return fromDetail;
  let sum = 0;
  for (const it of detail.items) {
    const n = Number((it.soTienVND || '').replace(/[,.]/g, ''));
    if (Number.isFinite(n)) sum += n;
  }
  return sum > 0 ? String(sum) : '';
}

export function buildC102Html(detail: PaymentSlipDetail): string {
  const totalVnd = resolveTotalVnd(detail);
  const rowsHtml = detail.items.length > 0
    ? detail.items.map((it, idx) => `
        <tr>
          <td class="c">${idx + 1}</td>
          <td>${esc(it.soToKhaiQuyetDinh) || '&nbsp;'}</td>
          <td class="c">${esc(it.kyThueNgayQd) || '&nbsp;'}</td>
          <td>${esc(it.noiDungKhoanNop) || '&nbsp;'}</td>
          <td class="r">&nbsp;</td>
          <td class="r b">${esc(it.soTienVND)}</td>
          <td class="c">${esc(it.maChuong) || '&nbsp;'}</td>
          <td class="c b">${esc(it.maNDKT) || '&nbsp;'}</td>
          <td class="c">&nbsp;</td>
        </tr>`).join('')
    : `
        <tr>
          <td class="c">1</td><td>&nbsp;</td><td>&nbsp;</td>
          <td>Khoản nộp thuế vào Ngân sách Nhà nước</td>
          <td class="r">&nbsp;</td>
          <td class="r b">${esc(totalVnd) || '&nbsp;'}</td>
          <td class="c">&nbsp;</td><td class="c">&nbsp;</td><td class="c">&nbsp;</td>
        </tr>`;

  const sigHtml = detail.signatures.length > 0
    ? detail.signatures.map(s => `
        <div class="sig">
          <div>Người ký: <b>${esc(s.signer)}</b></div>
          ${s.signedAt ? `<div>Ngày ký: ${esc(s.signedAt)}</div>` : ''}
        </div>`).join('')
    : '';

  const ngayNt = (detail.signatures[0]?.signedAt || '').split(' ')[0] || '';

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8"/>
<style>
  @page { size: A4 portrait; margin: 12mm 10mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Times New Roman', Tahoma, serif; font-size: 11.5pt; color: #000; margin: 0; }
  .wrap { padding: 0 2mm; }

  .top { display: flex; justify-content: space-between; gap: 8mm; margin-bottom: 4mm; }
  .top .left { flex: 1.2; font-style: italic; font-size: 10.5pt; line-height: 1.45; }
  .top .left u { text-decoration: none; border-bottom: 1px solid #000; padding: 0 6px; }
  .top .right { flex: 0 0 52mm; text-align: center; font-size: 10pt; line-height: 1.35; }
  .mau-box { display: inline-block; border: 1px solid #000; padding: 2mm 4mm; font-weight: bold; letter-spacing: .3px; }
  .small { font-size: 9pt; }

  h1.title { text-align: center; font-size: 15pt; text-transform: uppercase; margin: 2mm 0 1mm; letter-spacing: .5px; }
  h2.sub { text-align: center; font-size: 12.5pt; font-weight: bold; margin: 0 0 3mm; }
  .so-ct { text-align: center; font-style: italic; font-size: 11pt; margin-bottom: 4mm; }

  .info { width: 100%; border-collapse: collapse; margin-bottom: 4mm; font-size: 11.5pt; }
  .info td { vertical-align: top; padding: 1.1mm 1mm; }
  .info .lbl::after { content: ':'; }
  .info .v { font-weight: bold; }

  table.grid { width: 100%; border-collapse: collapse; font-size: 10pt; margin-top: 2mm; }
  table.grid th, table.grid td { border: 0.7pt solid #000; padding: 1.4mm 1.6mm; vertical-align: top; }
  table.grid th { background: #f0f0f0; text-align: center; font-weight: bold; line-height: 1.25; }
  td.c { text-align: center; } td.r { text-align: right; white-space: nowrap; } td.b { font-weight: bold; }
  tr.total td { font-weight: bold; background: #fafafa; }
  td.total-label { text-align: right; font-style: italic; font-weight: bold; }

  .bang-chu { margin-top: 3mm; font-size: 11.5pt; }
  .bang-chu i.lbl { font-style: italic; }
  .bang-chu b.val { text-transform: uppercase; text-decoration: underline; }

  .kbnn { margin-top: 5mm; width: 100%; border-collapse: collapse; font-size: 10.5pt; }
  .kbnn td, .kbnn th { border: 0.7pt solid #000; padding: 1.6mm; height: 7mm; }
  .kbnn th { text-align: center; font-weight: bold; }

  .signs { display: flex; justify-content: space-between; gap: 6mm; margin-top: 6mm; page-break-inside: avoid; }
  .sign-col { flex: 1; text-align: center; font-size: 10.5pt; }
  .sign-col .role { font-weight: bold; text-transform: uppercase; margin-bottom: 14mm; }
  .sign-line { margin-top: 20mm; border-top: 1px dotted #555; display: inline-block; padding-top: 1mm; min-width: 42mm; font-style: italic; }

  .sig-block { border: 0.9pt solid #444; padding: 2mm 3mm; margin-top: 2.5mm; font-size: 10pt; background:#fcfcfc; }
  .sig-title { font-weight: bold; margin: 4mm 0 1mm; font-size: 10.5pt; }

  .gen-note { margin-top: 6mm; font-size: 8.5pt; color: #555; text-align: right; font-style: italic; }
</style>
</head>
<body>
<div class="wrap">

  <div class="top">
    <div class="left">
      Cơ quan quản lý thu: <u>${esc(detail.coQuanQuanLyThu) || '....................'}</u><br/>
      Mã CQ thuế: ....................<br/>
      <span class="small">Đề nghị trích tài khoản NGÂN HÀNG / KHO BÁC:</span><br/>
      <span class="small">Số TK: <b>${esc(detail.soTaiKhoanTrich)}</b> — Tại: <b>${esc(detail.nganHangTrichTk)}</b></span>
    </div>
    <div class="right">
      <span class="mau-box">Mẫu số C1-02/NS</span><br/>
      <span class="small">(Ban hành theo Thông tư 84/2016/TT-BTC)</span>
    </div>
  </div>

  <h1 class="title">Giấy nộp tiền vào Ngân sách Nhà nước</h1>
  <div class="so-ct">Số: <b>${esc(detail.soChungTu)}</b>${ngayNt ? ` &nbsp;·&nbsp; Ngày ${esc(ngayNt)}` : ''}</div>

  <table class="info">
    <tr>
      <td style="width:22%"><span class="lbl">Người nộp thuế</span></td>
      <td class="v" style="text-transform:uppercase">${esc(detail.nguoiNopThue)}</td>
      <td style="width:16%"><span class="lbl">Mã số thuế</span></td>
      <td class="v">${esc(detail.maSoThue)}</td>
    </tr>
    <tr>
      <td><span class="lbl">Địa chỉ</span></td>
      <td colspan="3">${esc(detail.diaChi)}${detail.tinhTp ? `, ${esc(detail.tinhTp)}` : ''}</td>
    </tr>
    <tr>
      <td><span class="lbl">Hình thức nộp</span></td>
      <td class="v">&#9745; Chuyển khoản &nbsp;&nbsp; &#9744; Tiền mặt &nbsp;·&nbsp; ${esc(detail.loaiTien || 'VND')}</td>
      <td><span class="lbl">Vào TK KBNN</span></td>
      <td class="v">${esc(detail.taiKhoanKbnn)}${detail.tinhTpKbnn ? ` — KBNN ${esc(detail.tinhTpKbnn)}` : ''}</td>
    </tr>
  </table>

  <table class="grid">
    <thead>
      <tr>
        <th style="width:6%">STT</th>
        <th style="width:19%">Số tờ khai / Số quyết định / Số thông báo / Mã định danh hồ sơ (ID)</th>
        <th style="width:13%">Kỳ thuế / Ngày quyết định / Ngày thông báo</th>
        <th>Nội dung các khoản nộp NSNN</th>
        <th style="width:11%">Số tiền nguyên tệ</th>
        <th style="width:14%">Số tiền VND</th>
        <th style="width:7%">Mã chương</th>
        <th style="width:8%">Mã NDKT (TM)</th>
        <th style="width:8%">Mã DBHC</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
      <tr class="total">
        <td colspan="4" class="total-label">TỔNG SỐ TIỀN:</td>
        <td class="r">&nbsp;</td>
        <td class="r">${esc(totalVnd) || '&nbsp;'}</td>
        <td colspan="3">&nbsp;</td>
      </tr>
    </tbody>
  </table>

  <div class="bang-chu">
    <i class="lbl">Tổng số tiền ghi bằng chữ:</i>
    <b class="val">${esc(detail.tongTienBangChu)}</b>
  </div>

  <table class="kbnn">
    <tr><th style="width:30%">PHẦN DÀNH CHO KBNN GHI KHI HẠCH TOÁN</th><th>&nbsp;</th><th style="width:24%">Nợ TK: ..........</th></tr>
    <tr><td rowspan="2">&nbsp;</td><td>Mã CQ thuế: ..........</td><td>Có TK: ..........</td></tr>
    <tr><td>Mã nguồn NSNN: ..........</td><td>&nbsp;</td></tr>
  </table>

  <div class="signs">
    <div class="sign-col">
      <div class="role">Đối tượng nộp tiền</div>
      <div class="small" style="margin-bottom:2mm">Ngày ..... tháng ..... năm .....</div>
      <span class="sign-line">Người nộp tiền</span>
    </div>
    <div class="sign-col">
      <div class="role">Ngân hàng (KBNN)</div>
      <div class="small" style="margin-bottom:2mm">Ngày ..... tháng ..... năm .....</div>
      <span class="sign-line">Kế toán trưởng</span>
    </div>
  </div>

  ${sigHtml ? `<div class="sig-title">Xác thực chữ ký số điện tử:</div>${sigHtml}` : ''}

  <div class="gen-note">Trích xuất bởi TaxInsight — Giấy Nộp Tiền số ${esc(detail.soGnt)} · Mã tham chiếu ${esc(detail.soThamChieu)}</div>
</div>
</body>
</html>`;
}

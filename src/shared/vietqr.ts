/**
 * Chuẩn hóa mã chuỗi EMVCo VietQR (Napas 247) chuyển khoản ngân hàng
 * Cho phép quét trực tiếp từ MỌI app ngân hàng (MB, VCB, BIDV, Techcombank, TPBank, MoMo...)
 */

function formatTLV(tag: string, value: string): string {
  // Độ dài TLV theo chuẩn EMVCo tính bằng BYTE UTF-8, không phải số ký tự JS
  // Dùng TextEncoder (chuẩn Browser + Node) thay vì Buffer để an toàn khi
  // bundle vào Electron renderer (contextIsolation, không có Node globals)
  const byteLen = new TextEncoder().encode(value).length;
  const len = byteLen.toString().padStart(2, '0');
  return `${tag}${len}${value}`;
}

/**
 * Loại dấu tiếng Việt và ký tự ngoài ASCII — Napas/EMVCo chỉ chấp nhận ASCII
 * trong tên thành phố/nội dung; giữ nguyên sẽ lệch offset và bị app ngân hàng từ chối
 */
function toAsciiSafe(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\x20-\x7E]/g, '');
}

function crc16(data: string): string {
  let crc = 0xFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function generateVietQrEmvCoPayload(options: {
  bankBin: string; // '970422' cho MBBank
  accountNo: string; // '0817567008'
  accountName?: string; // 'NGUYEN DAC THINH'
  amount?: number;
  memo?: string;
}): string {
  const { bankBin, accountNo, amount, memo, accountName } = options;

  // Tag 38: Beneficiary info
  const sub00 = formatTLV('00', 'A000000727'); // Napas GUID
  const bankAndAcc = formatTLV('00', bankBin) + formatTLV('01', accountNo);
  const sub01 = formatTLV('01', bankAndAcc);
  const sub02 = formatTLV('02', 'QRIBFTTA'); // Napas 247 Instant Transfer
  const tag38Value = sub00 + sub01 + sub02;
  const tag38 = formatTLV('38', tag38Value);

  let payload = '';
  payload += formatTLV('00', '01'); // Version
  payload += formatTLV('01', amount ? '12' : '11'); // 12 = Dynamic (có số tiền), 11 = Static
  payload += tag38;
  payload += formatTLV('53', '704'); // VND Currency Code

  if (amount && amount > 0) {
    payload += formatTLV('54', String(Math.round(amount)));
  }

  payload += formatTLV('58', 'VN'); // Tag 58: Country code
  payload += formatTLV('59', toAsciiSafe((accountName || 'NGUYEN DAC THINH').trim()).toUpperCase()); // Tag 59: Merchant Name (Bắt buộc chuẩn EMVCo/Napas)
  payload += formatTLV('60', 'HA NOI'); // Tag 60: Merchant City (Bắt buộc chuẩn EMVCo/Napas)

  if (memo && memo.trim()) {
    const tag08 = formatTLV('08', toAsciiSafe(memo.trim()));
    payload += formatTLV('62', tag08);
  }

  // Tag 63: CRC16
  payload += '6304';
  const crc = crc16(payload);
  return payload + crc;
}

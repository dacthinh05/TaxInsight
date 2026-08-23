import { describe, expect, it } from 'vitest';
import { generateVietQrEmvCoPayload } from '../src/shared/vietqr';

describe('VietQR Napas 247 EMVCo Generator', () => {
  it('tạo chuỗi EMVCo hợp lệ cho MB Bank 0817567008 với đầy đủ Tag 59 và Tag 60', () => {
    const payload = generateVietQrEmvCoPayload({
      bankBin: '970422',
      accountNo: '0817567008',
      accountName: 'NGUYEN DAC THINH',
      amount: 490000,
      memo: 'TR 8C8E0D47'
    });

    expect(payload).toBeDefined();
    expect(payload.startsWith('000201')).toBe(true);
    expect(payload).toContain('A000000727'); // Napas GUID
    expect(payload).toContain('970422'); // MB Bank BIN
    expect(payload).toContain('0817567008'); // STK
    expect(payload).toContain('490000'); // Amount
    expect(payload).toContain('NGUYEN DAC THINH'); // Tag 59: Merchant Name
    expect(payload).toContain('HA NOI'); // Tag 60: Merchant City
    expect(payload).toContain('TR 8C8E0D47'); // Memo
  });
});

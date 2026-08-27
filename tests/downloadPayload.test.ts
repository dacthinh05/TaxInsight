import { describe, expect, it } from 'vitest';
import { PortalSession } from '../src/main/portal/PortalSession';
import { TaxPortalClient } from '../src/main/portal/TaxPortalClient';

describe('Tax filing download payload decoding', () => {
  const extract = (value: unknown) => {
    const client = new TaxPortalClient(new PortalSession());
    return (client as any).extractPayloadContent(value, 'FILING-01');
  };

  it('decodes JSON returned as an arraybuffer without treating it as a ZIP', () => {
    const base64 = 'UEsDBBQAAAAIAAAABAAAAA=';
    const result = extract(Buffer.from(JSON.stringify({ content: base64, fileName: 'ho-so.zip' })));

    expect(result).toEqual({
      content: base64,
      fileName: 'ho-so.zip',
      fileType: 'application/zip'
    });
  });

  it('preserves a binary ZIP response', () => {
    const binary = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01, 0x02]);
    const result = extract(binary);

    expect(result?.fileType).toBe('application/zip');
    expect(result?.content).toBe(binary.toString('base64'));
  });

  it('preserves a binary PDF response', () => {
    const binary = Buffer.from('%PDF-1.7 fake content');
    const result = extract(binary);

    expect(result?.fileName).toBe('files_FILING-01.pdf');
    expect(result?.fileType).toBe('application/pdf');
    expect(result?.content).toBe(binary.toString('base64'));
  });
  it('decodes quoted URL-safe Base64 returned by the portal', () => {
    const base64 = 'UEsDBBQAAAAIAAAABAAAAA=';
    const result = extract(JSON.stringify(base64.replace(/\+/g, '-').replace(/\//g, '_')));

    expect(Buffer.from(result?.content || '', 'base64')).toEqual(Buffer.from(base64, 'base64'));
  });
});

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

  it('extracts CSRF token from portal meta tags and script variables', () => {
    const client = new TaxPortalClient(new PortalSession());
    const sampleHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta name="csrf-token" content="GMllQCb9U_eLBP94B1eOpciXSXE4W-PCSOUx9fCsC4QJbCUvKPtceETJZ8amZ8hLP3q6wamjZBAJPYXvKoAJw8OfbbQ-WEZO"/>
        <meta name="csrf-header" content="X-XSRF-TOKEN"/>
      </head>
      <body>
        <script>
          var token = "GMllQCb9U_eLBP94B1eOpciXSXE4W-PCSOUx9fCsC4QJbCUvKPtceETJZ8amZ8hLP3q6wamjZBAJPYXvKoAJw8OfbbQ-WEZO";
        </script>
      </body>
      </html>
    `;
    const token = client.extractCsrfFromHtml(sampleHtml);
    expect(token).toBe('GMllQCb9U_eLBP94B1eOpciXSXE4W-PCSOUx9fCsC4QJbCUvKPtceETJZ8amZ8hLP3q6wamjZBAJPYXvKoAJw8OfbbQ-WEZO');
  });

  it('correctly extracts TNCN declaration download response matching GDT format', () => {
    const sampleZipBase64 = 'UEsDBBQAAAAIAAAABAAAAA==';
    const serverResponse = {
      fileName: 'files_000.701.18.G12-260210-27110000007182.zip',
      fileType: 'application/zip',
      content: sampleZipBase64
    };
    const client = new TaxPortalClient(new PortalSession());
    const payload = (client as any).extractPayloadContent(
      Buffer.from(JSON.stringify(serverResponse)),
      '000.701.18.G12-260210-27110000007182'
    );
    expect(payload).toEqual({
      fileName: 'files_000.701.18.G12-260210-27110000007182.zip',
      fileType: 'application/zip',
      content: sampleZipBase64
    });
  });
});

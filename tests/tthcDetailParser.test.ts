import { describe, expect, it } from 'vitest';
import { TthcDetailParser } from '../src/main/portal/TthcDetailParser';

describe('TthcDetailParser — trace-derived download actions', () => {
  const pageUrl = 'https://dichvucong.gdt.gov.vn/tthc/tchs/files/detail/MASKED?loai=';

  it('parses downloadHoSo(this) metadata without treating onclick or href="#" as a URL', () => {
    const parsed = TthcDetailParser.parse(`
      <html>
        <head>
          <meta name="_csrf" content="fixture-token" />
          <meta name="_csrf_header" content="X-XSRF-TOKEN" />
        </head>
        <body>
          <a href="#"
             onclick="downloadHoSo(this); return false;"
             data-mahoso="G12.18-260509-00037623"
             data-is-thue-dien-tu="false">Tải xuống</a>
        </body>
      </html>
    `, pageUrl);

    expect(parsed.filingAction).toEqual({
      kind: 'filing',
      maHoSo: 'G12.18-260509-00037623',
      isThueDienTu: false,
      loaiTraCuu: undefined
    });
    expect(parsed.csrf).toMatchObject({
      token: 'fixture-token',
      headerName: 'X-XSRF-TOKEN',
      source: 'meta',
      pageUrl
    });
  });

  it('parses TDT metadata and preserves loaiTraCuu from the same element', () => {
    const parsed = TthcDetailParser.parse(`
      <input type="hidden" name="_csrf" value="hidden-token" />
      <a href="#" onclick="downloadHoSo(this); return false;"
         data-mahoso="000.713.18.G12-260304-27070000025169"
         data-is-thue-dien-tu="true"
         data-loaitracuu="2">Tải</a>
    `, pageUrl);

    expect(parsed.filingAction).toMatchObject({
      kind: 'filing',
      maHoSo: '000.713.18.G12-260304-27070000025169',
      isThueDienTu: true,
      loaiTraCuu: '2'
    });
    expect(parsed.csrf?.source).toBe('hidden-input');
  });

  it('parses notice and attachment actions separately from the main filing action', () => {
    const parsed = TthcDetailParser.parse(`
      <meta name="csrf-token" content="fixture-token" />
      <a href="#" onclick="downloadHoSo(this); return false;"
         data-mahoso="G12.18-260509-00037623"
         data-is-thue-dien-tu="false">Tải hồ sơ</a>
      <a href="#" onclick="downloadThongBao(this); return false;"
         data-id="NOTICE_01" data-loaitbao="accepted">Tải thông báo</a>
      <button data-mahs="G12.18-260509-00037623"
              data-matep="FILE_01"
              data-mst="MASKED"
              data-magdich="TX_01">Tài liệu</button>
    `, pageUrl);

    expect(parsed.noticeActions).toEqual([
      expect.objectContaining({
        kind: 'notice',
        idThongBao: 'NOTICE_01',
        loaiThongBao: 'accepted'
      })
    ]);
    expect(parsed.attachments).toEqual([
      {
        kind: 'attachment',
        maHso: 'G12.18-260509-00037623',
        maTep: 'FILE_01',
        mst: 'MASKED',
        maGdich: 'TX_01'
      }
    ]);
  });

  it.each([
    'downloadHoSo(this)',
    'downloadThongBao(this)',
    'return false',
    'javascript:void(0)',
    '#'
  ])('rejects JavaScript-like or non-identifier data-mahoso value: %s', maHoSo => {
    const parsed = TthcDetailParser.parse(`
      <meta name="_csrf" content="fixture-token" />
      <a href="#" onclick="downloadHoSo(this); return false;"
         data-mahoso="${maHoSo}"
         data-is-thue-dien-tu="false">Tải</a>
    `, pageUrl);
    expect(parsed.filingAction).toBeUndefined();
  });

  it('keeps missing data-is-thue-dien-tu as unknown instead of guessing a route', () => {
    const parsed = TthcDetailParser.parse(`
      <meta name="_csrf" content="fixture-token" />
      <a href="#" onclick="downloadHoSo(this); return false;"
         data-mahoso="G12.18-260509-00037623">Tải</a>
    `, pageUrl);
    expect(parsed.filingAction?.isThueDienTu).toBeUndefined();
  });

  it('parses data-mahoso from parent container when button itself has no data-mahoso', () => {
    const parsed = TthcDetailParser.parse(`
      <meta name="_csrf" content="fixture-token" />
      <table>
        <tr data-mahoso="G12.18-260509-00037623">
          <td>
            <button id="btnDownload" onclick="downloadHoSo(this)">Tải hồ sơ</button>
          </td>
        </tr>
      </table>
    `, pageUrl);
    expect(parsed.filingAction).toEqual({
      kind: 'filing',
      maHoSo: 'G12.18-260509-00037623',
      isThueDienTu: undefined,
      loaiTraCuu: undefined
    });
  });

  it('parses direct identifier argument in onclick handler', () => {
    const parsed = TthcDetailParser.parse(`
      <meta name="_csrf" content="fixture-token" />
      <a href="javascript:void(0)" onclick="downloadHoSo('G12.18-260509-00037623')">Tải</a>
    `, pageUrl);
    expect(parsed.filingAction?.maHoSo).toBe('G12.18-260509-00037623');
  });

  it('parses identifier from hidden form input when download button has no direct attribute', () => {
    const parsed = TthcDetailParser.parse(`
      <meta name="_csrf" content="fixture-token" />
      <input type="hidden" id="maHoSo" name="maHoSo" value="G12.18-260509-00037623" />
      <button class="btn-download-hoso" onclick="downloadHoSo(this)">Tải về</button>
    `, pageUrl);
    expect(parsed.filingAction?.maHoSo).toBe('G12.18-260509-00037623');
  });
});

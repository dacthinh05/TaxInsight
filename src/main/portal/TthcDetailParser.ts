import * as cheerio from 'cheerio';

export interface CsrfContext {
  origin: string;
  token: string;
  headerName?: string;
  source: 'hidden-input' | 'meta' | 'inline-script';
  obtainedAt: number;
  pageUrl: string;
}

export type DownloadAction =
  | {
      kind: 'filing';
      maHoSo: string;
      isThueDienTu?: boolean;
      loaiTraCuu?: string;
    }
  | {
      kind: 'notice';
      idThongBao: string;
      isThueDienTu?: boolean;
      loaiTraCuu?: string;
      loaiThongBao?: string;
    }
  | {
      kind: 'attachment';
      maHso: string;
      maTep: string;
      mst?: string;
      maGdich?: string;
    };

export interface TthcDetailParseResult {
  filingAction?: Extract<DownloadAction, { kind: 'filing' }>;
  noticeActions: Array<Extract<DownloadAction, { kind: 'notice' }>>;
  attachments: Array<Extract<DownloadAction, { kind: 'attachment' }>>;
  csrf?: CsrfContext;
}

export class TthcDetailParser {
  private static isSafeIdentifier(value: string): boolean {
    const clean = String(value || '').trim();
    if (!clean || clean.length > 160) return false;
    if (
      clean === '#' ||
      /javascript:|return\s+false|downloadHoSo\s*\(|downloadThongBao\s*\(/i.test(clean) ||
      /[<>"'();{}]/.test(clean)
    ) {
      return false;
    }
    return /^[A-Za-z0-9._-]+$/.test(clean);
  }

  private static parseBooleanAttribute(value: string | undefined): boolean | undefined {
    if (value === undefined) return undefined;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    return undefined;
  }

  private static firstAttribute(
    $element: cheerio.Cheerio<any>,
    names: string[]
  ): string | undefined {
    for (const name of names) {
      const value = $element.attr(name);
      if (value !== undefined && value.trim()) return value.trim();
    }
    return undefined;
  }

  public static parse(html: string, pageUrl: string): TthcDetailParseResult {
    const $ = cheerio.load(String(html || ''));
    const noticeActions: Array<Extract<DownloadAction, { kind: 'notice' }>> = [];
    const attachments: Array<Extract<DownloadAction, { kind: 'attachment' }>> = [];
    let filingAction: Extract<DownloadAction, { kind: 'filing' }> | undefined;

    $('[onclick], [data-mahoso], [data-ma-hoso], [data-ma-hs], [data-id]').each((_, element) => {
      const $element = $(element);
      const onclick = ($element.attr('onclick') || '').replace(/\s+/g, ' ').trim();
      const href = ($element.attr('href') || '').replace(/\s+/g, ' ').trim();
      const idAttr = ($element.attr('id') || '').toLowerCase();
      const classAttr = ($element.attr('class') || '').toLowerCase();

      const isFiling =
        /^(?:downloadHoSo|downloadhoso|taiHoSo|taiToKhai|downTkhai|downTKhai)\b/i.test(onclick) ||
        /^(?:javascript:)?(?:downloadHoSo|downloadhoso|taiHoSo|taiToKhai)\b/i.test(href) ||
        idAttr.includes('downloadhoso') ||
        idAttr.includes('btndownload') ||
        classAttr.includes('btn-download-hoso') ||
        Boolean($element.attr('data-mahoso') || $element.attr('data-ma-hoso'));

      const isNotice =
        /^(?:downloadThongBao|downloadthongbao|taiThongBao)\b/i.test(onclick) ||
        /^(?:javascript:)?(?:downloadThongBao|downloadthongbao)\b/i.test(href) ||
        idAttr.includes('downloadthongbao') ||
        classAttr.includes('btn-download-tbao');

      if (!isFiling && !isNotice) return;

      const isThueDienTu = this.parseBooleanAttribute(
        this.firstAttribute($element, [
          'data-is-thue-dien-tu',
          'data-isthuedientu',
          'data-is-tdt'
        ])
      );
      const loaiTraCuu = this.firstAttribute($element, [
        'data-loaitracuu',
        'data-loai-tra-cuu'
      ]);

      if (isFiling) {
        let maHoSo = this.firstAttribute($element, [
          'data-mahoso',
          'data-ma-hoso',
          'data-ma-hs',
          'data-id',
          'data-hoso',
          'data-ma'
        ]);
        if (!maHoSo && onclick) {
          const argMatch = onclick.match(/(?:downloadHoSo|downloadhoso|taiHoSo|downTkhai)\s*\(\s*(?:this\s*,\s*)?['"]?([A-Za-z0-9._-]+)['"]?/i);
          if (argMatch && argMatch[1] !== 'this') {
            maHoSo = argMatch[1];
          }
        }
        if (!filingAction && maHoSo && this.isSafeIdentifier(maHoSo)) {
          filingAction = {
            kind: 'filing',
            maHoSo,
            isThueDienTu,
            loaiTraCuu
          };
        }
        return;
      }

      const idThongBao = this.firstAttribute($element, [
        'data-id',
        'data-idtbao',
        'data-id-tbao'
      ]);
      if (idThongBao && this.isSafeIdentifier(idThongBao)) {
        noticeActions.push({
          kind: 'notice',
          idThongBao,
          isThueDienTu,
          loaiTraCuu,
          loaiThongBao: this.firstAttribute($element, [
            'data-loaitbao',
            'data-loai-tbao'
          ])
        });
      }
    });

    $('[data-mahs], [data-ma-hs]').each((_, element) => {
      const $element = $(element);
      const maHso = this.firstAttribute($element, ['data-mahs', 'data-ma-hs']);
      const maTep = this.firstAttribute($element, ['data-matep', 'data-ma-tep']);
      if (!maHso || !maTep || !this.isSafeIdentifier(maHso) || !this.isSafeIdentifier(maTep)) {
        return;
      }
      attachments.push({
        kind: 'attachment',
        maHso,
        maTep,
        mst: this.firstAttribute($element, ['data-mst']),
        maGdich: this.firstAttribute($element, ['data-magdich', 'data-ma-gdich'])
      });
    });

    const metaToken =
      $('meta[name="_csrf"]').attr('content')?.trim() ||
      $('meta[name="csrf-token"]').attr('content')?.trim() ||
      $('meta[name="csrf_token"]').attr('content')?.trim();
    const hiddenToken = $('input[name="_csrf"]').first().attr('value')?.trim();
    const inlineToken =
      String(html || '').match(/\b(?:const|let|var)\s+token\s*=\s*["']([^"']+)["']/i)?.[1]?.trim();
    const token = metaToken || hiddenToken || inlineToken;
    const source: CsrfContext['source'] | undefined = metaToken
      ? 'meta'
      : hiddenToken
        ? 'hidden-input'
        : inlineToken
          ? 'inline-script'
          : undefined;
    const declaredHeader =
      $('meta[name="_csrf_header"]').attr('content')?.trim() ||
      $('meta[name="csrf-header"]').attr('content')?.trim();

    let csrf: CsrfContext | undefined;
    if (token && source) {
      let origin = '';
      try {
        origin = new URL(pageUrl).origin;
      } catch {}
      csrf = {
        origin,
        token,
        headerName: declaredHeader || 'X-XSRF-TOKEN',
        source,
        obtainedAt: Date.now(),
        pageUrl
      };
    }

    return {
      filingAction,
      noticeActions,
      attachments,
      csrf
    };
  }
}

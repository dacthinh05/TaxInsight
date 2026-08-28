import * as cheerio from 'cheerio';
import { parseFilingPeriod } from '../../shared/dateUtils';
import { FilingType, HistoricalFilingRecord, TaxFiling, TaxType } from '../../shared/types';
import { TaxFilingParser } from './TaxFilingParser';

export interface EtaxPaginationInfo {
  currentPage: number;
  totalPages: number;
  totalRecords: number;
  hasNextPage: boolean;
  nextPageNumber?: number;
}

export interface EtaxParseResult {
  filings: TaxFiling[];
  historicalRecords: HistoricalFilingRecord[];
  pagination: EtaxPaginationInfo;
  isEmpty: boolean;
  isFormChanged: boolean;
  errorMessage?: string;
}

type ColumnMap = Partial<Record<
  'stt' | 'maGiaoDich' | 'tenTKhai' | 'kyThue' | 'loaiTKhai' |
  'lanNop' | 'lanBoSung' | 'ngayNop' | 'guiPhuLuc' | 'noiNop' |
  'trangThai' | 'thongBao',
  number
>>;

export class EtaxFilingResultParser {
  private static normalizeHeader(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private static getCell(cells: string[], index?: number): string {
    return index === undefined ? '' : (cells[index] || '').replace(/\s+/g, ' ').trim();
  }

  private static extractCallArgument(
    rowHtml: string,
    functionNames: string[]
  ): string | undefined {
    const names = functionNames.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const match = rowHtml.match(
      new RegExp(`(?:${names})\\s*\\(\\s*(?:(['"])([^'"<>\\r\\n]{1,256})\\1|([A-Za-z0-9._-]{5,64}))`, 'i')
    );
    const value = (match?.[2] || match?.[3])?.trim();
    if (!value || !/^[^\s"'<>()[\]{}]{1,256}$/.test(value)) return undefined;
    return value;
  }

  public static parse(html: string): EtaxParseResult {
    const emptyPagination: EtaxPaginationInfo = {
      currentPage: 1,
      totalPages: 1,
      totalRecords: 0,
      hasNextPage: false
    };
    if (!html || typeof html !== 'string') {
      return {
        filings: [],
        historicalRecords: [],
        pagination: emptyPagination,
        isEmpty: false,
        isFormChanged: true,
        errorMessage: 'HTML kết quả eTax rỗng'
      };
    }

    const $ = cheerio.load(html);
    const pageText = $.root().text().replace(/\s+/g, ' ').trim();
    const noData = /không có dữ liệu|không tìm thấy (?:dữ liệu|kết quả)|không có bản ghi/i.test(pageText);
    const pagination = this.parsePagination($, html);

    let $table = $('#allResultTableBody').first().closest('table');
    if (!$table.length) {
      $('table').each((_, table) => {
        if ($table.length) return;
        const mapped = this.mapHeaderColumns($, $(table));
        if (mapped.tenTKhai !== undefined && mapped.kyThue !== undefined) {
          $table = $(table);
        }
      });
    }

    if (!$table.length) {
      return {
        filings: [],
        historicalRecords: [],
        pagination,
        isEmpty: noData,
        isFormChanged: !noData,
        errorMessage: noData ? undefined : 'Không tìm thấy bảng kết quả tờ khai theo cấu trúc đã biết'
      };
    }

    const columnMap = this.mapHeaderColumns($, $table);
    const requiredColumns: Array<keyof ColumnMap> = ['tenTKhai', 'kyThue'];
    const missingColumns = requiredColumns.filter(name => columnMap[name] === undefined);
    if (missingColumns.length > 0) {
      return {
        filings: [],
        historicalRecords: [],
        pagination,
        isEmpty: noData,
        isFormChanged: !noData,
        errorMessage: noData ? undefined : `Bảng kết quả thiếu cột bắt buộc: ${missingColumns.join(', ')}`
      };
    }

    let $rows = $table.find('tbody#allResultTableBody > tr');
    if (!$rows.length) $rows = $table.find('tbody > tr');
    const filings: TaxFiling[] = [];
    const historicalRecords: HistoricalFilingRecord[] = [];
    const seenMessageIds = new Set<string>();
    let candidateRowCount = 0;

    $rows.each((_, row) => {
      const $row = $(row);
      if ($row.find('th').length > 0) return;
      const $cells = $row.children('td');
      if (!$cells.length) return;

      const rowText = $row.text().replace(/\s+/g, ' ').trim();
      if (!rowText || /không có dữ liệu/i.test(rowText)) return;
      candidateRowCount++;

      const cells: string[] = [];
      $cells.each((__, cell) => {
        cells.push($(cell).text().replace(/\s+/g, ' ').trim());
      });
      const rowHtml = $row.html() || '';
      const messageId =
        this.extractCallArgument(rowHtml, ['downloadTkhai', 'downTkhai', 'downTKhai', 'downloadTKhai', 'taiTkhai', 'taiTKhai', 'downFile', 'downloadFile', 'taiToKhai']) ||
        $row.find('[data-messageid]').attr('data-messageid')?.trim() ||
        $row.find('[data-id]').attr('data-id')?.trim();
      if (!messageId || seenMessageIds.has(messageId)) return;
      seenMessageIds.add(messageId);

      const noticeId = this.extractCallArgument(
        rowHtml,
        ['thongBao', 'downloadTBao', 'downloadThongBao', 'viewTBao', 'downTBao']
      );
      const transactionId = this.getCell(cells, columnMap.maGiaoDich);
      const titleCell = $cells.eq(columnMap.tenTKhai!);
      const $downloadLink = titleCell.find('a[onclick*="Tkhai"], a[onclick*="TKhai"], a[onclick*="down"], a[onclick*="tai"]').first();
      const rawTitle = ($downloadLink.length ? $downloadLink.text() : titleCell.text())
        .replace(/\s+/g, ' ')
        .trim();
      if (!rawTitle) return;

      const formCodeMatch = rawTitle.match(
        /^\s*((?:\d{1,3}(?:[-/][A-Z0-9]+)+)|(?:\d{2,4}[A-Z]{2,}(?:[-/][A-Z0-9]+)*))(?=\s*[-–:]|\s|$)/i
      );
      const formCode = formCodeMatch?.[1]?.toUpperCase();
      const rawPeriod = this.getCell(cells, columnMap.kyThue);
      const periodNormalized = parseFilingPeriod(rawPeriod) || undefined;
      const rawFilingType = this.getCell(cells, columnMap.loaiTKhai);
      const rawSubmissionNo = this.getCell(cells, columnMap.lanNop);
      const rawAmendmentNo = this.getCell(cells, columnMap.lanBoSung);
      const submissionNo = Number.parseInt(rawSubmissionNo, 10);
      const amendmentNo = Number.parseInt(rawAmendmentNo, 10);

      let filingType: FilingType = 'ORIGINAL';
      let supplementalNo: number | undefined;
      if (
        (Number.isFinite(amendmentNo) && amendmentNo > 0) ||
        /bổ sung|bo sung/i.test(rawFilingType)
      ) {
        filingType = 'SUPPLEMENTAL';
        supplementalNo = Number.isFinite(amendmentNo) && amendmentNo > 0 ? amendmentNo : 1;
      } else if (/quyết toán|quyet toan/i.test(rawTitle)) {
        filingType = 'FINALIZATION';
      }

      const submittedAt = this.getCell(cells, columnMap.ngayNop);
      const taxAuthority = this.getCell(cells, columnMap.noiNop);
      const status = this.getCell(cells, columnMap.trangThai);
      const taxType: TaxType = TaxFilingParser.classifyTaxType(undefined, rawTitle, formCode);

      const filing: TaxFiling = {
        id: messageId,
        declarationCode: formCode,
        title: rawTitle,
        taxType,
        period: periodNormalized?.raw || rawPeriod || undefined,
        periodNormalized,
        submittedAt: submittedAt || undefined,
        filingType,
        supplementalNo,
        status: status || undefined,
        downloadAvailable: true,
        source: 'dvc-etax-html',
        messageId,
        noticeAvailable: Boolean(noticeId),
        noticeId
      };

      const historicalRecord: HistoricalFilingRecord = {
        source: 'dvc-etax-html',
        messageId,
        transactionId: transactionId || undefined,
        formCode,
        formName: rawTitle,
        taxPeriodRaw: rawPeriod,
        taxPeriodNormalized: periodNormalized,
        filingType: rawFilingType || undefined,
        submissionNo: Number.isFinite(submissionNo) ? submissionNo : undefined,
        amendmentNo: supplementalNo,
        submittedAt: submittedAt || undefined,
        taxAuthority: taxAuthority || undefined,
        status: status || undefined,
        downloadAvailable: true,
        noticeAvailable: Boolean(noticeId)
      };

      filings.push(filing);
      historicalRecords.push(historicalRecord);
    });

    const parserFailed = candidateRowCount > 0 && filings.length === 0 && !noData;
    return {
      filings,
      historicalRecords,
      pagination,
      isEmpty: noData || candidateRowCount === 0,
      isFormChanged: parserFailed,
      errorMessage: parserFailed
        ? 'Có dòng kết quả nhưng không lấy được messageId từ downloadTkhai(...)'
        : undefined
    };
  }

  private static parsePagination($: cheerio.CheerioAPI, html: string): EtaxPaginationInfo {
    let currentPage = 1;
    let totalPages = 1;
    let totalRecords = 0;
    const text = $('#currAcc').text().replace(/\s+/g, ' ').trim();
    const pageMatch =
      text.match(/Trang\s*(\d+)\s*\/\s*(\d+)/i) ||
      html.match(/Trang\s*(\d+)\s*\/\s*<b>\s*(\d+)\s*<\/b>/i);
    if (pageMatch) {
      currentPage = Math.max(1, Number(pageMatch[1]) || 1);
      totalPages = Math.max(currentPage, Number(pageMatch[2]) || 1);
    }

    const totalMatch =
      text.match(/Có\s*(\d+)\s*bản ghi/i) ||
      html.match(/Có\s*<b>\s*(\d+)\s*<\/b>\s*bản ghi/i);
    if (totalMatch) totalRecords = Math.max(0, Number(totalMatch[1]) || 0);

    const pageCandidates: number[] = [];
    for (const match of html.matchAll(/gotoPage\s*\(\s*(\d+)/gi)) {
      pageCandidates.push(Number(match[1]));
    }
    for (const match of html.matchAll(/[?&]pn=(\d+)/gi)) {
      pageCandidates.push(Number(match[1]));
    }
    const maxCandidate = Math.max(0, ...pageCandidates.filter(Number.isFinite));
    if (!pageMatch && maxCandidate > 0) totalPages = Math.max(currentPage, maxCandidate);

    const hasNextPage = currentPage < totalPages;
    return {
      currentPage,
      totalPages,
      totalRecords,
      hasNextPage,
      nextPageNumber: hasNextPage ? currentPage + 1 : undefined
    };
  }

  private static mapHeaderColumns(
    $: cheerio.CheerioAPI,
    $table: cheerio.Cheerio<any>
  ): ColumnMap {
    const map: ColumnMap = {};
    let $headers = $table.find('thead tr').last().children('th, td');
    if (!$headers.length) {
      $headers = $table.find('tr').filter((_, row) => $(row).find('th').length > 0).first().children('th, td');
    }

    $headers.each((index, element) => {
      const text = this.normalizeHeader($(element).text());
      if (text.includes('stt')) map.stt = index;
      else if (text.includes('ma giao dich') || text.includes('ma gd')) map.maGiaoDich = index;
      else if (text.includes('gui phu luc')) map.guiPhuLuc = index;
      else if (text.includes('loai to khai') || text.includes('loai tk')) map.loaiTKhai = index;
      else if (
        (text.includes('to khai') && !text.includes('loai to khai')) ||
        text === 'phu luc' ||
        text.startsWith('to khai/phu luc')
      ) map.tenTKhai = index;
      else if (text.includes('ky tinh thue') || text.includes('ky thue')) map.kyThue = index;
      else if (text.includes('lan bo sung') || text === 'bo sung') map.lanBoSung = index;
      else if (text.includes('lan nop')) map.lanNop = index;
      else if (text.includes('ngay nop')) map.ngayNop = index;
      else if (text.includes('noi nop') || text.includes('co quan thue')) map.noiNop = index;
      else if (text.includes('trang thai') || text.includes('tien trinh')) map.trangThai = index;
      else if (text.includes('thong bao')) map.thongBao = index;
    });
    return map;
  }
}

import { describe, expect, it } from 'vitest';
import { GntParser } from '../src/main/scanner/GntParser';

function buildListHtml(headers: string[], rows: string): string {
  return `<html><body>
    <table id="allResultTable">
      <thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead>
      <tbody id="allResultTableBody">${rows}</tbody>
    </table>
  </body></html>`;
}

describe('GntParser.parseList - column mapping & rowspan', () => {
  it('parses amount from STANDARD layout (regression guard)', () => {
    const headers = ['STT', 'Mã giao dịch', 'Mã giao dịch chi tiết', 'Lần nộp', 'Số giấy nộp tiền', 'Số tiền', 'Loại tiền', 'Trạng thái', 'Số chứng từ', 'Ngày lập GNT', 'Ngày gửi GNT', 'Ngày nộp thuế'];
    const rows = `
      <tr>
        <td>1</td><td>11220260386114377</td><td></td><td>1</td>
        <td><a href="javascript:chiTietCT(999)">00000380115720906202637887099</a></td>
        <td>370,760</td><td>VND</td><td>Nộp thuế thành công</td><td>2026081350610021</td>
        <td>30/06/2026</td><td>30/06/2026</td><td>30/06/2026</td>
      </tr>`;
    const list = GntParser.parseList(buildListHtml(headers, rows));
    expect(list).toHaveLength(1);
    expect(list[0].amount.value).toBe(370760n);
    expect(list[0].ctuId).toBe('999');
  });

  it('parses amount correctly when eTax REORDERS columns (header mapping)', () => {
    // Bảng đổi cấu trúc: Số tiền dời sang cột khác, cột cũ chứa số chứng từ
    const headers = ['STT', 'Số giấy nộp tiền', 'Mã giao dịch', 'Lần nộp', 'Số chứng từ', 'Trạng thái', 'Loại tiền', 'Số tiền', 'Ngày nộp thuế', 'Ngày lập GNT'];
    const rows = `
      <tr>
        <td>1</td>
        <td><a href="javascript:chiTietCT(888)">00000380115720906202637887099</a></td>
        <td>11220260386114377</td><td>1</td>
        <td>2026081350610021</td><td>Nộp thuế thành công</td><td>VND</td>
        <td>370,760</td><td>30/06/2026</td><td>30/06/2026</td>
      </tr>`;
    const list = GntParser.parseList(buildListHtml(headers, rows));
    expect(list).toHaveLength(1);
    expect(list[0].amount.value).toBe(370760n);
    expect(list[0].statusNormalized).toBe('PAID_SUCCESS');
  });

  it('rowspan grouping: second submission row keeps its OWN amount (no column drift)', () => {
    const headers = ['STT', 'Mã giao dịch', 'Số giấy nộp tiền', 'Lần nộp', 'Số tiền', 'Loại tiền', 'Trạng thái', 'Ngày nộp thuế'];
    const rows = `
      <tr>
        <td>1</td>
        <td rowspan="2">11220260386114377</td>
        <td><a href="javascript:chiTietCT(111)">GNT-A</a></td>
        <td>1</td>
        <td>2,994,376,737</td>
        <td>VND</td>
        <td>Nộp thuế thành công</td>
        <td>30/06/2026</td>
      </tr>
      <tr>
        <td>2</td>
        <td><a href="javascript:chiTietCT(222)">GNT-B</a></td>
        <td>2</td>
        <td>370,760</td>
        <td>VND</td>
        <td>Nộp thuế thành công</td>
        <td>01/07/2026</td>
      </tr>`;
    const list = GntParser.parseList(buildListHtml(headers, rows));
    expect(list).toHaveLength(2);

    // Dòng 2: cột bị trôi 1 vị trí do ô mã GD rowspan — số tiền phải vẫn
    // đọc đúng 370.760 của chính dòng đó (code cũ đọc cells[5]="VND" → sai)
    const second = list.find(r => r.ctuId === '222')!;
    expect(second).toBeDefined();
    expect(second.amount.value).toBe(370760n);
    expect(second.transactionRef).toBe('11220260386114377');
    expect(second.statusNormalized).toBe('PAID_SUCCESS');
    expect(second.paidAt).toBe('01/07/2026');
    expect(second.currency).toBe('VND');

    const first = list.find(r => r.ctuId === '111')!;
    expect(first.amount.value).toBe(2994376737n);
  });
});

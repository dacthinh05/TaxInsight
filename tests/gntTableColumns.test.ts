import { describe, expect, it } from 'vitest';
import * as cheerio from 'cheerio';
import { resolveAllocationColumns } from '../src/main/scanner/GntTableColumns';

describe('resolveAllocationColumns', () => {
  it('giữ layout mặc định khi không có header', () => {
    const $ = cheerio.load('<table id="chungtu_ctiet"><tbody><tr><td>1</td></tr></tbody></table>');
    const col = resolveAllocationColumns($);
    expect(col.ndkt).toBe(7);
    expect(col.chapter).toBe(6);
    expect(col.vndAmount).toBe(5);
  });

  it('dò đúng cột Chương/Tiểu mục theo text header dù bị đổi thứ tự', () => {
    const $ = cheerio.load(`
      <table id="chungtu_ctiet">
        <thead>
          <tr>
            <th>STT</th><th>Tiểu mục NDKT</th><th>Kỳ thuế</th><th>Nội dung</th>
            <th>Số tiền (Nguyên tệ)</th><th>Số tiền (VNĐ)</th><th>Chương</th><th>Ghi chú</th>
          </tr>
        </thead>
        <tbody><tr><td>1</td><td>1051</td><td>2026</td><td>x</td><td>1.000</td><td>1.000</td><td>754</td><td>-</td></tr></tbody>
      </table>
    `);
    const col = resolveAllocationColumns($);
    expect(col.ndkt).toBe(1);   // 'Tiểu mục NDKT' đứng ở vị trí 1
    expect(col.chapter).toBe(6);
  });

  it('header < 8 cột -> dùng mặc định an toàn', () => {
    const $ = cheerio.load(`
      <table id="chungtu_ctiet">
        <thead><tr><th>Tiểu mục</th><th>Chương</th></tr></thead>
      </table>
    `);
    const col = resolveAllocationColumns($);
    expect(col.ndkt).toBe(7);
    expect(col.chapter).toBe(6);
  });
});

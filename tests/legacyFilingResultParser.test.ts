import { describe, expect, it } from 'vitest';
import { EtaxFilingResultParser } from '../src/main/scanner/EtaxFilingResultParser';

describe('Legacy Filing: EtaxFilingResultParser Suite', () => {
  const sampleTraceResultHtml = `
    <div id="currAcc" align="right" class="table_headerto">
      &nbsp;1&nbsp;<a href="/etaxnnt/Request?pn=2">2</a>&nbsp;<a href="/etaxnnt/Request?pn=3">3</a>&nbsp;<a href="/etaxnnt/Request?pn=4">4</a>&nbsp;<a href="/etaxnnt/Request?pn=5">5</a>&nbsp;
      Trang 1/<b>5</b>. Có <b>45</b> bản ghi. Đến trang <input id="gotoPageNO_listTKhai" type="text" size="1"/>&nbsp;<a href="javascript:gotoPage(5, 'gotoPageNO_listTKhai');"><img src="/etaxnnt/static/images/pagination_go.gif"/></a>
    </div>

    <table id="data_content_onday" width="150%" border="0" cellspacing="0" cellpadding="0" class="md_list2">
      <thead>
        <tr class="header">
          <th width="3%">STT</th>
          <th width="8%">Mã giao dịch</th>
          <th width="15%">Tờ khai/Phụ lục</th>
          <th width="5%">Kỳ tính thuế</th>
          <th width="5%">Loại tờ khai</th>
          <th width="4%">Lần nộp</th>
          <th width="4%">Lần bổ sung</th>
          <th width="5%">Ngày nộp</th>
          <th width="3%">Gửi phụ lục</th>
          <th width="8%">Nơi nộp</th>
          <th width="10%">Tiến trình giải quyết hồ sơ (Trạng thái)</th>
          <th width="7%">Tải thông báo</th>
        </tr>
      </thead>
      <tbody id="allResultTableBody">
        <tr>
          <td align="center">1</td>
          <td align="left">11320220168134306</td>
          <td align="left">
            <a title="Tải tệp tờ khai về" onclick="downloadTkhai('11320220168134306');">
              02TH-Bảng tổng hợp đăng ký người phụ thuộc giảm trừ gia cảnh
            </a>
          </td>
          <td align="center">2022</td>
          <td align="center">Chính thức</td>
          <td align="center">16</td>
          <td align="center">0</td>
          <td align="center">16/12/2022 08:46:14</td>
          <td align="center"></td>
          <td align="left">Thuế Thành phố Hồ Chí Minh</td>
          <td align="left">Đã cấp mã số thuế cho người phụ thuộc thành công</td>
          <td align="center">
            <a href="#" onclick="thongBao('11320220168134306'); return false;">Thông báo</a>
          </td>
        </tr>
        <tr>
          <td align="center">2</td>
          <td align="left">11220220162879653</td>
          <td align="left">
            <a title="Tải tệp tờ khai về" onclick="downloadTkhai('11220220162879653');">
              01/NTNN- Tờ khai thuế nhà thầu nước ngoài(TT80/2021)
            </a>
          </td>
          <td align="center">19/10/2022</td>
          <td align="center">Chính thức</td>
          <td align="center">1</td>
          <td align="center">0</td>
          <td align="center">24/10/2022 14:41:32</td>
          <td align="center">
            <a href="#" title="Gửi phụ lục" onclick="gui_phu_luc('11220220162879653');">
              <img src="/etaxnnt/static/images/upload.bmp" />
            </a>
          </td>
          <td align="left">Thuế Thành phố Hồ Chí Minh</td>
          <td align="left">Cơ quan thuế chấp nhận hồ sơ khai thuế điện tử của NNT</td>
          <td align="center">
            <a href="#" onclick="thongBao('11220220162879653'); return false;">Thông báo</a>
          </td>
        </tr>
        <tr>
          <td align="center">3</td>
          <td align="left">11320220160829999</td>
          <td align="left">
            <a title="Tải tệp tờ khai về" onclick="downloadTkhai('11320220160829999');">
              01/GTGT-TỜ KHAI THUẾ GIÁ TRỊ GIA TĂNG (TT80/2021)(00-Hoạt động sản xuất kinh doanh thông thường-)
            </a>
          </td>
          <td align="center">Q3/2022</td>
          <td align="center">Chính thức</td>
          <td align="center">1</td>
          <td align="center">0</td>
          <td align="center">14/10/2022 07:49:01</td>
          <td align="center"></td>
          <td align="left">Thuế Thành phố Hồ Chí Minh</td>
          <td align="left">Cơ quan thuế chấp nhận hồ sơ khai thuế điện tử của NNT</td>
          <td align="center">
            <a href="#" onclick="thongBao('11320220160829999'); return false;">Thông báo</a>
          </td>
        </tr>
        <tr>
          <td align="center">4</td>
          <td align="left">11320220160829945</td>
          <td align="left">
            <a title="Tải tệp tờ khai về" onclick="downloadTkhai('11320220160829945');">
              01/GTGT-TỜ KHAI THUẾ GIÁ TRỊ GIA TĂNG (TT80/2021)(00-Hoạt động sản xuất kinh doanh thông thường-)
            </a>
          </td>
          <td align="center">12/2022</td>
          <td align="center">Bổ sung</td>
          <td align="center">2</td>
          <td align="center">1</td>
          <td align="center">20/01/2023 10:15:00</td>
          <td align="center"></td>
          <td align="left">Thuế Thành phố Hồ Chí Minh</td>
          <td align="left">Cơ quan thuế chấp nhận hồ sơ khai thuế điện tử của NNT</td>
          <td align="center">
            <a href="#" onclick="thongBao('11320220160829945'); return false;">Thông báo</a>
          </td>
        </tr>
      </tbody>
    </table>
  `;

  it('1. Trích xuất chính xác thông tin phân trang từ banner #currAcc', () => {
    const res = EtaxFilingResultParser.parse(sampleTraceResultHtml);
    expect(res.pagination.currentPage).toBe(1);
    expect(res.pagination.totalPages).toBe(5);
    expect(res.pagination.totalRecords).toBe(45);
    expect(res.pagination.hasNextPage).toBe(true);
    expect(res.pagination.nextPageNumber).toBe(2);
    expect(res.isEmpty).toBe(false);
  });

  it('2. Parse danh sách hồ sơ chính xác từ trace thực tế', () => {
    const res = EtaxFilingResultParser.parse(sampleTraceResultHtml);
    expect(res.filings).toHaveLength(4);
    expect(res.historicalRecords).toHaveLength(4);

    // Row 1: 02TH
    const f1 = res.filings[0];
    expect(f1.id).toBe('11320220168134306');
    expect(f1.declarationCode).toBe('02TH');
    expect(f1.taxType).toBe('OTHER');
    expect(f1.periodNormalized?.year).toBe(2022);
    expect(f1.periodNormalized?.type).toBe('YEAR');
    expect(f1.filingType).toBe('ORIGINAL');
    expect(f1.submittedAt).toBe('16/12/2022 08:46:14');
    expect(f1.status).toBe('Đã cấp mã số thuế cho người phụ thuộc thành công');
    expect(f1.source).toBe('dvc-etax-html');
    expect(f1.downloadAvailable).toBe(true);
    expect(f1.noticeAvailable).toBe(true);
    expect(f1.noticeId).toBe('11320220168134306');

    // Row 2: 01/NTNN (FCT)
    const f2 = res.filings[1];
    expect(f2.id).toBe('11220220162879653');
    expect(f2.declarationCode).toBe('01/NTNN');
    expect(f2.taxType).toBe('FCT');
    expect(f2.periodNormalized?.year).toBe(2022);

    // Row 3: 01/GTGT Q3/2022
    const f3 = res.filings[2];
    expect(f3.id).toBe('11320220160829999');
    expect(f3.declarationCode).toBe('01/GTGT');
    expect(f3.taxType).toBe('VAT');
    expect(f3.periodNormalized?.year).toBe(2022);
    expect(f3.periodNormalized?.quarter).toBe(3);
    expect(f3.periodNormalized?.type).toBe('QUARTER');
    expect(f3.filingType).toBe('ORIGINAL');

    // Row 4: 01/GTGT 12/2022 Bổ sung L1
    const f4 = res.filings[3];
    expect(f4.id).toBe('11320220160829945');
    expect(f4.periodNormalized?.year).toBe(2022);
    expect(f4.periodNormalized?.month).toBe(12);
    expect(f4.periodNormalized?.type).toBe('MONTH');
    expect(f4.filingType).toBe('SUPPLEMENTAL');
    expect(f4.supplementalNo).toBe(1);
  });

  it('3. Xử lý bảng kết quả rỗng không có dữ liệu', () => {
    const emptyHtml = `
      <table class="md_list2">
        <tbody id="allResultTableBody">
          <tr><td colspan="12"><strong>Không có dữ liệu!</strong></td></tr>
        </tbody>
      </table>
    `;
    const res = EtaxFilingResultParser.parse(emptyHtml);
    expect(res.filings).toHaveLength(0);
    expect(res.isEmpty).toBe(true);
  });

  it('4. Deduplicate nếu trên cùng trang có ID trùng lặp', () => {
    const duplicateHtml = `
      <table class="md_list2">
        <thead><tr>
          <th>STT</th><th>Mã giao dịch</th><th>Tờ khai/Phụ lục</th>
          <th>Kỳ tính thuế</th><th>Loại tờ khai</th><th>Lần nộp</th>
          <th>Lần bổ sung</th><th>Ngày nộp</th><th>Gửi phụ lục</th>
          <th>Nơi nộp</th><th>Trạng thái</th><th>Thông báo</th>
        </tr></thead>
        <tbody id="allResultTableBody">
          <tr>
            <td>1</td><td>11320220168134306</td>
            <td><a onclick="downloadTkhai('11320220168134306');">01/GTGT</a></td>
            <td>2022</td><td>Chính thức</td><td>1</td><td>0</td><td>16/12/2022</td><td></td><td>CQT</td><td>Đã nhận</td><td></td>
          </tr>
          <tr>
            <td>2</td><td>11320220168134306</td>
            <td><a onclick="downloadTkhai('11320220168134306');">01/GTGT</a></td>
            <td>2022</td><td>Chính thức</td><td>1</td><td>0</td><td>16/12/2022</td><td></td><td>CQT</td><td>Đã nhận</td><td></td>
          </tr>
        </tbody>
      </table>
    `;
    const res = EtaxFilingResultParser.parse(duplicateHtml);
    expect(res.filings).toHaveLength(1);
    expect(res.isFormChanged).toBe(false);
  });

  it('5. Không dùng mã giao dịch làm messageId khi thiếu downloadTkhai', () => {
    const html = `
      <table>
        <thead><tr>
          <th>Mã giao dịch</th><th>Tờ khai/Phụ lục</th><th>Kỳ tính thuế</th>
        </tr></thead>
        <tbody id="allResultTableBody">
          <tr><td>123456789</td><td>01/GTGT - Tờ khai GTGT</td><td>Q1/2022</td></tr>
        </tbody>
      </table>
    `;
    const res = EtaxFilingResultParser.parse(html);
    expect(res.filings).toHaveLength(0);
    expect(res.isEmpty).toBe(false);
    expect(res.isFormChanged).toBe(true);
    expect(res.errorMessage).toContain('messageId');
  });

  it('6. Hỗ trợ messageId có dấu gạch ngang, gạch dưới và dấu chấm', () => {
    const html = `
      <table>
        <thead><tr>
          <th>Tờ khai/Phụ lục</th><th>Kỳ tính thuế</th>
        </tr></thead>
        <tbody id="allResultTableBody">
          <tr>
            <td><a onclick="downloadTkhai('MSG_2022-01.abc')">01/GTGT - Tờ khai GTGT</a></td>
            <td>Q1/2022</td>
          </tr>
        </tbody>
      </table>
    `;
    const res = EtaxFilingResultParser.parse(html);
    expect(res.filings[0]?.messageId).toBe('MSG_2022-01.abc');
  });
});

import { describe, expect, it } from 'vitest';
import { EtaxFormStateParser } from '../src/main/portal/EtaxFormStateParser';

describe('Legacy Filing: EtaxFormStateParser Suite', () => {
  const sampleTraCuuFormHtml = `
    <!DOCTYPE html>
    <html>
    <head><title>Tra cứu tờ khai</title></head>
    <body>
      <script type="text/javascript">
        function dmTKhai(maTKhai, kieuKy){
          this.maTKhai = maTKhai;
          this.kieuKy = kieuKy;
        }
        var arrTKhai = new Array();
        arrTKhai['--'] = new dmTKhai ('--','null');
        arrTKhai['01'] = new dmTKhai ('01','Q');
        arrTKhai['842'] = new dmTKhai ('842','M');
        arrTKhai['03'] = new dmTKhai ('03','Y');
        arrTKhai['302'] = new dmTKhai ('302','Y');
        arrTKhai['864'] = new dmTKhai ('864','M');
        arrTKhai['953'] = new dmTKhai ('953','Y');
        arrTKhai['41'] = new dmTKhai ('41','D');
      </script>

      <form name="traCuuKhaiForm" method="post" action="/etaxnnt/Request" id='traCuuKhaiForm'>
        <input type="hidden" name="dse_sessionId" value="5LuU5PNqEIX7UmUkuYsyXuS" />
        <input type="hidden" name="dse_applicationId" value="-1" />
        <input type="hidden" name="dse_operationName" value="traCuuToKhaiProc" />
        <input type="hidden" name="dse_pageId" value="10" />
        <input type="hidden" name="dse_processorState" value="viewTraCuuTkhai" />
        <input type="hidden" name="dse_processorId" value="ETEVHAJNFXIYGLINHVGCBNEGATBIJRJGFUAKEKJR" />
        <input type="hidden" name="dse_errorPage" value="error_page.jsp" />
        <input type="hidden" name="dse_nextEventName" value="" />
        <input type="hidden" name="pn" value="1" />

        <select id="maTKhai" name="maTKhai">
          <option value="00">--Tất cả--</option>
          <option value="--">THUẾ GIÁ TRỊ GIA TĂNG</option>
          <option value="01">01/GTGT - Tờ khai thuế GTGT</option>
          <option value="842">01/GTGT - TỜ KHAI THUẾ GTGT (TT80/2021)</option>
          <option value="03">03/TNDN - Tờ khai quyết toán thuế TNDN</option>
        </select>
        <input id='qryFromDate' type="text" value="" name="qryFromDate" />
        <input id='qryToDate' type="text" value="" name="qryToDate" />
      </form>
    </body>
    </html>
  `;

  it('1. Trích xuất chính xác toàn bộ DSE dynamic fields từ HTML form tra cứu', () => {
    const state = EtaxFormStateParser.parse(sampleTraCuuFormHtml);

    expect(state.dseSessionId).toBe('5LuU5PNqEIX7UmUkuYsyXuS');
    expect(state.dseApplicationId).toBe('-1');
    expect(state.dsePageId).toBe('10');
    expect(state.dseOperationName).toBe('traCuuToKhaiProc');
    expect(state.dseProcessorState).toBe('viewTraCuuTkhai');
    expect(state.dseProcessorId).toBe('ETEVHAJNFXIYGLINHVGCBNEGATBIJRJGFUAKEKJR');
    expect(state.dseErrorPage).toBe('error_page.jsp');
    expect(state.actionUrl).toBe('/etaxnnt/Request');
    expect(state.isSessionExpired).toBe(false);
    expect(state.isErrorPage).toBe(false);
  });

  it('2. Trích xuất danh mục tờ khai và mapping kieuKy từ Javascript', () => {
    const state = EtaxFormStateParser.parse(sampleTraCuuFormHtml);

    expect(state.formOptions).toBeDefined();
    expect(state.formOptions!.length).toBeGreaterThan(0);

    const opt01 = state.formOptions!.find(o => o.value === '01');
    expect(opt01).toBeDefined();
    expect(opt01?.kieuKy).toBe('Q');

    const opt842 = state.formOptions!.find(o => o.value === '842');
    expect(opt842).toBeDefined();
    expect(opt842?.kieuKy).toBe('M');

    const opt03 = state.formOptions!.find(o => o.value === '03');
    expect(opt03).toBeDefined();
    expect(opt03?.kieuKy).toBe('Y');
  });

  it('3. Tạo search params chuẩn x-www-form-urlencoded bảo toàn hidden fields và cập nhật tham số', () => {
    const state = EtaxFormStateParser.parse(sampleTraCuuFormHtml);
    const params = EtaxFormStateParser.buildSearchParams(state, {
      maTKhai: '842',
      kieuKy: 'M',
      qryFromDate: '01/01/2022',
      qryToDate: '31/12/2022',
      pn: 2,
      nextEventName: 'query'
    });

    expect(params.get('dse_sessionId')).toBe('5LuU5PNqEIX7UmUkuYsyXuS');
    expect(params.get('dse_operationName')).toBe('traCuuToKhaiProc');
    expect(params.get('dse_processorState')).toBe('viewTraCuuTkhai');
    expect(params.get('dse_processorId')).toBe('ETEVHAJNFXIYGLINHVGCBNEGATBIJRJGFUAKEKJR');
    expect(params.get('dse_nextEventName')).toBe('query');
    expect(params.get('pn')).toBe('2');
    expect(params.get('maTKhai')).toBe('842');
    expect(params.get('kieuKy')).toBe('M');
    expect(params.get('qryFromDate')).toBe('01/01/2022');
    expect(params.get('qryToDate')).toBe('31/12/2022');
  });

  it('4. Phát hiện chính xác khi phiên làm việc hết hạn', () => {
    const expiredHtml = `
      <div id="modalCanBoThueLogin">
        <input name="tenDNCbt" />
        <input name="matKhauCbt" />
        <p>Hết phiên làm việc. Vui lòng đăng nhập lại</p>
      </div>
    `;
    const state = EtaxFormStateParser.parse(expiredHtml);
    expect(state.isSessionExpired).toBe(true);
    expect(state.errorMessage).toContain('hết hạn');
  });

  it('5. Phát hiện lỗi máy chủ (NPE / Error Page)', () => {
    const errorHtml = `
      <html>
        <body>
          <h1>java.lang.NullPointerException</h1>
          <p>Đã có lỗi hệ thống xảy ra!</p>
        </body>
      </html>
    `;
    const state = EtaxFormStateParser.parse(errorHtml);
    expect(state.isErrorPage).toBe(true);
  });

  it('6. Thiếu processorId phải báo FORM_CHANGED và không tự đoán giá trị', () => {
    const html = sampleTraCuuFormHtml.replace(
      /<input type="hidden" name="dse_processorId"[^>]+\/>/,
      ''
    );
    const state = EtaxFormStateParser.parse(html);
    expect(state.dseProcessorId).toBeUndefined();
    expect(state.isFormChanged).toBe(false);
    expect(() => EtaxFormStateParser.buildSearchParams(state, {
      maTKhai: '00',
      kieuKy: 'Q',
      qryFromDate: '01/01/2022',
      qryToDate: '31/12/2022'
    })).toThrow(/processorId/);
  });

  it('7. Không thu thập control disabled/checkbox chưa chọn vào form state', () => {
    const html = sampleTraCuuFormHtml.replace(
      '</form>',
      `
        <input type="hidden" name="disabledSecret" value="must-not-send" disabled />
        <input type="checkbox" name="uncheckedFlag" value="Y" />
        <input type="checkbox" name="checkedFlag" value="Y" checked />
      </form>`
    );
    const state = EtaxFormStateParser.parse(html);
    expect(state.formValues.disabledSecret).toBeUndefined();
    expect(state.formValues.uncheckedFlag).toBeUndefined();
    expect(state.formValues.checkedFlag).toBe('Y');
  });
});

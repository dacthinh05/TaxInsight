import * as cheerio from 'cheerio';

export interface EtaxFormOption {
  value: string;
  text: string;
  kieuKy?: string;
}

export interface EtaxFormState {
  actionUrl: string;
  dseSessionId: string;
  dseApplicationId: string;
  dsePageId: string;
  dseOperationName: string;
  dseProcessorState: string;
  dseProcessorId?: string;
  dseNextEventName?: string;
  dseErrorPage?: string;
  pn?: string;
  hiddenFields: Record<string, string>;
  formValues: Record<string, string>;
  formOptions?: EtaxFormOption[];
  isSessionExpired?: boolean;
  isErrorPage?: boolean;
  isFormChanged?: boolean;
  errorMessage?: string;
}

export class EtaxFormStateParser {
  private static formChanged(message: string): Error {
    const error = new Error(message);
    Object.assign(error, { code: 'FORM_CHANGED' });
    return error;
  }

  /**
   * Parse đúng form DSE đang hoạt động. Không mặc định page/application/state:
   * mọi giá trị phụ thuộc phiên phải xuất phát từ response HTML hiện tại.
   */
  public static parse(html: string): EtaxFormState {
    const result: EtaxFormState = {
      actionUrl: '',
      dseSessionId: '',
      dseApplicationId: '',
      dsePageId: '',
      dseOperationName: '',
      dseProcessorState: '',
      hiddenFields: {},
      formValues: {},
      formOptions: [],
      isSessionExpired: false,
      isErrorPage: false,
      isFormChanged: false
    };

    if (!html || typeof html !== 'string') {
      result.isErrorPage = true;
      result.isFormChanged = true;
      result.errorMessage = 'HTML response rỗng';
      return result;
    }

    const lowerHtml = html.toLowerCase();
    const $ = cheerio.load(html);
    const normalizedText = $.root().text().replace(/\s+/g, ' ').trim().toLowerCase();
    const hasLoginControls = Boolean(
      $('form input[name="tenDN"], form input[name="matKhau"], form input[name="tenDNCbt"], form input[name="matKhauCbt"]').length
    );
    const hasLoginOperation = Boolean(
      $('form[action*="login"], input[value="corpUserLoginProc"], input[name="dse_operationName"][value="corpUserLoginProc"]').length
    );

    if (
      normalizedText.includes('hết phiên làm việc') ||
      normalizedText.includes('phiên làm việc đã hết hạn') ||
      normalizedText.includes('vui lòng đăng nhập lại') ||
      lowerHtml.includes('modalcanbothuelogin') ||
      (hasLoginControls && hasLoginOperation)
    ) {
      result.isSessionExpired = true;
      result.errorMessage = 'Phiên làm việc eTax đã hết hạn';
    }

    if (
      lowerHtml.includes('nullpointerexception') ||
      normalizedText.includes('đã có lỗi hệ thống xảy ra') ||
      normalizedText.includes('system error')
    ) {
      result.isErrorPage = true;
      result.errorMessage = 'Lỗi hệ thống máy chủ eTax';
    }

    const scriptTexts: string[] = [];
    $('script').each((_, element) => {
      const script = $(element).html();
      if (script) scriptTexts.push(script);
    });
    const allScripts = scriptTexts.join('\n');

    const periodByFormCode: Record<string, string> = {};
    const dmRegex = /arrTKhai\s*\[\s*['"]([^'"]+)['"]\s*\]\s*=\s*new\s+dmTKhai\s*\(\s*['"][^'"]*['"]\s*,\s*['"]([^'"]*)['"]\s*\)/gi;
    let dmMatch: RegExpExecArray | null;
    while ((dmMatch = dmRegex.exec(allScripts)) !== null) {
      const code = dmMatch[1].trim();
      const periodType = dmMatch[2].trim();
      if (code && periodType && periodType.toLowerCase() !== 'null') {
        periodByFormCode[code] = periodType;
      }
    }

    const forms = $('form').toArray();
    let selectedForm: any;
    let selectedScore = -1;
    for (const form of forms) {
      const $form = $(form);
      const idAndName = `${$form.attr('id') || ''} ${$form.attr('name') || ''}`.toLowerCase();
      let score = 0;
      if (idAndName.includes('tracuukhai')) score += 100;
      if ($form.find('input[name="dse_sessionId"]').length) score += 30;
      if ($form.find('input[name="dse_operationName"]').length) score += 25;
      if ($form.find('input[name="dse_processorState"]').length) score += 20;
      if ($form.find('select[name="maTKhai"]').length) score += 20;
      if (score > selectedScore) {
        selectedScore = score;
        selectedForm = form;
      }
    }

    const collectControl = (element: any) => {
      const $control = $(element);
      if ($control.is('[disabled]')) return;
      const name = ($control.attr('name') || '').trim();
      if (!name) return;

      const tag = element.tagName.toLowerCase();
      if (tag === 'input') {
        const type = ($control.attr('type') || 'text').toLowerCase();
        if (['submit', 'button', 'reset', 'image', 'file'].includes(type)) return;
        if ((type === 'checkbox' || type === 'radio') && !$control.is(':checked')) return;
        const value = $control.attr('value') ?? (type === 'checkbox' || type === 'radio' ? 'on' : '');
        result.formValues[name] = value;
        if (type === 'hidden') result.hiddenFields[name] = value;
        return;
      }

      if (tag === 'select') {
        const $selected = $control.find('option:selected').first();
        const $option = $selected.length ? $selected : $control.find('option').first();
        result.formValues[name] = $option.attr('value') ?? '';
        return;
      }

      if (tag === 'textarea') {
        result.formValues[name] = $control.text();
      }
    };

    if (selectedForm) {
      const $form = $(selectedForm);
      result.actionUrl = ($form.attr('action') || '').trim();
      $form.find('input, select, textarea').each((_, element) => collectControl(element));

      $form.find('select[name="maTKhai"], select#maTKhai').first().find('option').each((_, option) => {
        const $option = $(option);
        const value = ($option.attr('value') || '').trim();
        const text = $option.text().replace(/\s+/g, ' ').trim();
        if (!value || value === '--') return;
        result.formOptions!.push({
          value,
          text,
          kieuKy: periodByFormCode[value]
        });
      });
    } else {
      // Một số trang handoff chỉ chứa hidden controls mà không bọc trong form.
      $('input[type="hidden"]').each((_, element) => collectControl(element));
    }

    const getDynamicField = (name: string): string => {
      const controlValue = result.formValues[name];
      if (controlValue !== undefined && controlValue !== '') return controlValue;

      // Fallback chỉ đọc assignment JavaScript rõ ràng, không quét text/cell.
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const assignment = allScripts.match(
        new RegExp(`(?:document\\.[a-zA-Z0-9_]+\\.|[a-zA-Z0-9_]+\\.)?${escapedName}(?:\\.value)?\\s*=\\s*["']([^"']+)["']`, 'i')
      );
      if (assignment?.[1]) return assignment[1];

      if (result.actionUrl) {
        try {
          const action = new URL(result.actionUrl, 'https://thuedientu.gdt.gov.vn');
          return action.searchParams.get(name) || '';
        } catch {}
      }
      return '';
    };

    result.dseSessionId = getDynamicField('dse_sessionId');
    result.dseApplicationId = getDynamicField('dse_applicationId');
    result.dsePageId = getDynamicField('dse_pageId');
    result.dseOperationName = getDynamicField('dse_operationName');
    result.dseProcessorState = getDynamicField('dse_processorState');
    result.dseProcessorId = getDynamicField('dse_processorId') || undefined;
    result.dseNextEventName = getDynamicField('dse_nextEventName') || undefined;
    result.dseErrorPage = getDynamicField('dse_errorPage') || undefined;
    result.pn = getDynamicField('pn') || undefined;

    if (result.dseSessionId) {
      if (!result.actionUrl) result.actionUrl = '/etaxnnt/Request';
      if (!result.dseApplicationId) result.dseApplicationId = '-1';
      if (!result.dsePageId) result.dsePageId = '1';
      if (!result.dseOperationName) result.dseOperationName = 'traCuuToKhaiProc';
      if (!result.dseProcessorState) result.dseProcessorState = 'initial';
    }

    const appearsToBeDseResponse =
      lowerHtml.includes('dse_sessionid') ||
      lowerHtml.includes('dse_operationname') ||
      lowerHtml.includes('/etaxnnt/request');
    if (
      appearsToBeDseResponse &&
      !result.isSessionExpired &&
      !result.isErrorPage &&
      (
        !result.dseSessionId
      )
    ) {
      result.isFormChanged = true;
      result.errorMessage = 'Cấu trúc form eTax đã thay đổi hoặc thiếu trạng thái DSE bắt buộc';
    }

    return result;
  }

  public static buildSearchParams(
    state: EtaxFormState,
    searchParams: {
      maTKhai: string;
      tenTKhai?: string;
      kieuKy?: string;
      ma_gd?: string;
      qryFromDate: string;
      qryToDate: string;
      pn?: number | string;
      nextEventName?: string;
    }
  ): URLSearchParams {
    const missing = [
      ['actionUrl', state.actionUrl],
      ['dse_sessionId', state.dseSessionId],
      ['dse_applicationId', state.dseApplicationId],
      ['dse_pageId', state.dsePageId],
      ['dse_operationName', state.dseOperationName],
      ['dse_processorState', state.dseProcessorState],
      ['dse_processorId', state.dseProcessorId]
    ].filter(([, value]) => !value).map(([name]) => name);
    if (missing.length > 0 || state.isFormChanged) {
      throw this.formChanged(`Form tra cứu eTax thiếu trường bắt buộc: ${missing.join(', ') || 'unknown'}`);
    }
    if (state.dseOperationName !== 'traCuuToKhaiProc') {
      throw this.formChanged(`Sai operation màn hình tra cứu: ${state.dseOperationName}`);
    }

    const periodType = searchParams.kieuKy || state.formValues?.kieuKy || 'Q';

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(state.hiddenFields || {})) {
      params.set(key, value);
    }

    params.set('dse_sessionId', state.dseSessionId);
    params.set('dse_applicationId', state.dseApplicationId);
    params.set('dse_pageId', state.dsePageId);
    params.set('dse_operationName', state.dseOperationName);
    params.set('dse_processorState', state.dseProcessorState);
    if (state.dseProcessorId) params.set('dse_processorId', state.dseProcessorId);
    if (state.dseErrorPage) params.set('dse_errorPage', state.dseErrorPage);
    params.set('dse_nextEventName', searchParams.nextEventName || 'query');

    params.set('pn', String(searchParams.pn ?? state.pn ?? '1'));
    params.set('maTKhai', searchParams.maTKhai);
    params.set('tenTKhai', searchParams.tenTKhai || '');
    params.set('kieuKy', periodType);
    params.set('ma_gd', searchParams.ma_gd || '');
    params.set('qryFromDate', searchParams.qryFromDate);
    params.set('qryToDate', searchParams.qryToDate);
    return params;
  }
}

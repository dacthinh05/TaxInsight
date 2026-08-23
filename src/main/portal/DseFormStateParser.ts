export interface DseFormState {
  sessionId: string;
  applicationId?: string;
  pageId?: string;
  operationName?: string;
  processorState?: string;
  processorId?: string;
  errorPage?: string;
  nextEventName?: string;
  actionUrl?: string;
}

export class DseFormStateParser {
  /**
   * Bóc tách toàn diện trạng thái DSE runtime từ HTML phản hồi của Cổng Thuế
   * Tuyệt đối không hard-code các giá trị mẫu từ trace.
   */
  public static extractDseFormState(html: string): DseFormState {
    const result: DseFormState = {
      sessionId: ''
    };

    if (!html || typeof html !== 'string') return result;

    const extractField = (name: string): string | undefined => {
      // 1. Dạng <input ... name="dse_xxx" value="yyy" ...> hoặc đảo thứ tự
      const regex1 = new RegExp(`name=["']${name}["'][^>]*?value=["']([^"']*)["']`, 'i');
      const regex2 = new RegExp(`value=["']([^"']*)["'][^>]*?name=["']${name}["']`, 'i');
      const m = html.match(regex1) || html.match(regex2);
      if (m) return m[1];

      // 2. Dạng gán trong JavaScript (ví dụ: goProcForm.dse_operationName.value = '...')
      const regexJs = new RegExp(`(?:var\\s+|window\\.)?${name}\\s*=\\s*["']([^"']+)["']`, 'i');
      const mJs = html.match(regexJs);
      if (mJs) return mJs[1];

      // 3. Dạng URL query param (ví dụ: &dse_sessionId=brdeZfZhx1B5e9imPisbYAW)
      const regexUrl = new RegExp(`[?&]${name}=([^&"'#\\s]+)`, 'i');
      const mUrl = html.match(regexUrl);
      if (mUrl) return decodeURIComponent(mUrl[1]);

      return undefined;
    };

    result.sessionId = extractField('dse_sessionId') || '';
    result.applicationId = extractField('dse_applicationId');
    result.pageId = extractField('dse_pageId');
    result.operationName = extractField('dse_operationName');
    result.processorState = extractField('dse_processorState');
    result.processorId = extractField('dse_processorId');
    result.errorPage = extractField('dse_errorPage');
    result.nextEventName = extractField('dse_nextEventName');

    // Bóc tách action url của form chính (mainForm, reportForm hoặc viewC102From)
    const actionMatch = html.match(/<form[^>]*?action=["']([^"']+)["']/i);
    if (actionMatch) {
      result.actionUrl = actionMatch[1];
    }

    return result;
  }

  /**
   * Chuyển đổi DseFormState thành URLSearchParams để gửi POST Request x-www-form-urlencoded
   */
  public static toSearchParams(dse: DseFormState, nextEventName?: string): URLSearchParams {
    const params = new URLSearchParams();
    if (dse.sessionId) params.append('dse_sessionId', dse.sessionId);
    if (dse.applicationId !== undefined) params.append('dse_applicationId', dse.applicationId);
    if (dse.operationName) params.append('dse_operationName', dse.operationName);
    if (dse.pageId !== undefined) params.append('dse_pageId', dse.pageId);
    if (dse.processorState) params.append('dse_processorState', dse.processorState);
    if (dse.processorId) params.append('dse_processorId', dse.processorId);
    if (dse.errorPage) params.append('dse_errorPage', dse.errorPage);
    params.append('dse_nextEventName', nextEventName || dse.nextEventName || '');
    return params;
  }
}

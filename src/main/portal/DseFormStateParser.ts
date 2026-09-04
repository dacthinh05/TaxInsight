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
  toOpName?: string;
  hiddenFields?: Record<string, string>;
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
      // 1. Dạng <input ... name="dse_xxx" value="yyy" ...> hoặc đảo thứ tự (hỗ trợ cả có nháy và không nháy)
      const regex1 = new RegExp(`name=["']?${name}["']?[^>]*?value=(?:["']([^"']*)["']|([^\\s>]+))`, 'i');
      const regex2 = new RegExp(`value=(?:["']([^"']*)["']|([^\\s>]+))[^>]*?name=["']?${name}["']?`, 'i');
      const m1 = html.match(regex1);
      if (m1) return (m1[1] !== undefined ? m1[1] : m1[2]) ?? '';
      const m2 = html.match(regex2);
      if (m2) return (m2[1] !== undefined ? m2[1] : m2[2]) ?? '';

      // 2. Dạng gán trong JavaScript (ví dụ: goProcForm.dse_operationName.value = '...')
      const regexJs = new RegExp(`(?:var\\s+|window\\.|goProcForm\\.)?${name}\\s*(?:\\.value)?\\s*=\\s*["']([^"']+)["']`, 'i');
      const mJs = html.match(regexJs);
      if (mJs) return mJs[1];

      // 3. Dạng URL query param (ví dụ: &dse_sessionId=brdeZfZhx1B5e9imPisbYAW)
      const regexUrl = new RegExp(`[?&]${name}=([^&"'#\\s]+)`, 'i');
      const mUrl = html.match(regexUrl);
      if (mUrl) return decodeURIComponent(mUrl[1]);

      return undefined;
    };

    result.sessionId = extractField('dse_sessionId') || extractField('sessionId') || '';
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

    result.toOpName = extractField('toOpName');

    // Bóc tách toàn bộ hidden inputs
    const hiddenFields: Record<string, string> = {};
    const inputRe = /<input\b[^>]*>/gi;
    let mInput: RegExpExecArray | null;
    while ((mInput = inputRe.exec(html))) {
      const tag = mInput[0];
      const name = tag.match(/\bname=["']?([^"'\s>]+)["']?/i)?.[1];
      if (!name) continue;
      const type = tag.match(/\btype=["']?([^"'\s>]+)["']?/i)?.[1]?.toLowerCase();
      if (type === 'hidden' || !type) {
        const valMatch = tag.match(/\bvalue=(?:["']([^"']*)["']|([^"'\s>]+))/i);
        const val = ((valMatch ? (valMatch[1] !== undefined ? valMatch[1] : valMatch[2]) : '') || '').replace(/&amp;/g, '&');
        hiddenFields[name] = val;
      }
    }
    if (Object.keys(hiddenFields).length > 0) {
      result.hiddenFields = hiddenFields;
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

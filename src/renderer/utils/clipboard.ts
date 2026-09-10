import { TaxPortalAPI } from '../../preload/preload';

/**
 * Sao chép văn bản vào clipboard hệ thống với cơ chế 3 lớp (fallback đa tầng):
 * 1. Native Electron IPC qua window.taxPortalAPI.copyToClipboard (tin cậy 100%, không phụ thuộc Secure Context hay Focus).
 * 2. Async Clipboard API chuẩn của trình duyệt (navigator.clipboard.writeText).
 * 3. Fallback textarea ẩn qua document.execCommand('copy').
 */
export async function copyText(text: string): Promise<boolean> {
  const content = text == null ? '' : String(text);

  const globalScope = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : undefined);

  // Lớp 1: Native Electron IPC
  if (globalScope && 'taxPortalAPI' in globalScope) {
    const candidate = globalScope.taxPortalAPI;
    if (candidate && typeof candidate === 'object' && 'copyToClipboard' in candidate) {
      const copyFn = candidate.copyToClipboard;
      if (typeof copyFn === 'function') {
        try {
          const res = await copyFn(content);
          if (res?.success) {
            return true;
          }
        } catch {
          // Tiếp tục fallback lớp 2 nếu IPC gặp sự cố
        }
      }
    }
  }

  // Lớp 2: Browser Async Clipboard API
  const nav = typeof navigator !== 'undefined' ? navigator : (globalScope && 'navigator' in globalScope ? (globalScope.navigator as Navigator | undefined) : undefined);
  if (nav?.clipboard && typeof nav.clipboard.writeText === 'function') {
    try {
      await nav.clipboard.writeText(content);
      return true;
    } catch {
      // Tiếp tục fallback lớp 3 nếu trình duyệt chặn quyền hoặc không trong Secure Context
    }
  }

  // Lớp 3: Fallback DOM execCommand
  const doc = typeof document !== 'undefined' ? document : (globalScope && 'document' in globalScope ? (globalScope.document as Document | undefined) : undefined);
  if (doc) {
    try {
      const textarea = doc.createElement('textarea');
      textarea.value = content;
      textarea.style.position = 'fixed';
      textarea.style.left = '-9999px';
      textarea.style.top = '-9999px';
      textarea.style.opacity = '0';
      textarea.setAttribute('readonly', '');
      doc.body.appendChild(textarea);
      textarea.select();
      textarea.setSelectionRange(0, textarea.value.length);
      const successful = doc.execCommand('copy');
      doc.body.removeChild(textarea);
      return successful;
    } catch {
      return false;
    }
  }

  return false;
}

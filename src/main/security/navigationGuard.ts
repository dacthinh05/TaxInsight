import path from 'path';
import { fileURLToPath } from 'url';

export const ALLOWED_DEV_SERVER_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/;
export const ALLOWED_EXTERNAL_HOSTS: Record<string, true> = {
  'github.com': true,
  'www.github.com': true,
  'img.vietqr.io': true,
  'dichvucong.gdt.gov.vn': true,
  'thuedientu.gdt.gov.vn': true
};

export function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && (
      Boolean(ALLOWED_EXTERNAL_HOSTS[url.hostname.toLowerCase()]) ||
      url.hostname.toLowerCase().endsWith('.gdt.gov.vn')
    );
  } catch {
    return false;
  }
}

export function isAllowedInternalUrl(rawUrl: string, distDirOverride?: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol === 'file:') {
      // Chỉ cho phép file trong thư mục dist của app (không cho phép file index.html ngoài dist)
      const resolved = path.resolve(fileURLToPath(rawUrl));
      const distDir = distDirOverride ? path.resolve(distDirOverride) : path.resolve(__dirname, '../../dist');
      return resolved.startsWith(distDir + path.sep) || resolved === distDir;
    }
    if (u.protocol === 'http:' || u.protocol === 'https:') {
      // Dev server + host portal thuế (auth popup điều hướng trong dichvucong.gdt.gov.vn)
      if (ALLOWED_DEV_SERVER_RE.test(rawUrl)) return true;
      return u.hostname === 'dichvucong.gdt.gov.vn' || u.hostname.endsWith('.gdt.gov.vn');
    }
    return false;
  } catch {
    return false;
  }
}

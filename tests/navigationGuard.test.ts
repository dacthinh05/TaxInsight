import { describe, it, expect } from 'vitest';
import path from 'path';
import { isAllowedExternalUrl, isAllowedInternalUrl } from '../src/main/security/navigationGuard';

describe('Navigation Guard Security Suite', () => {
  describe('isAllowedExternalUrl', () => {
    it('cho phép các host tin cậy trong danh sách allowlist', () => {
      expect(isAllowedExternalUrl('https://dichvucong.gdt.gov.vn/tthc/login')).toBe(true);
      expect(isAllowedExternalUrl('https://thuedientu.gdt.gov.vn/etaxnnt/Request')).toBe(true);
      expect(isAllowedExternalUrl('https://hcm.gdt.gov.vn/portal')).toBe(true);
      expect(isAllowedExternalUrl('https://github.com/dacthinh05/TaxInsight')).toBe(true);
      expect(isAllowedExternalUrl('https://img.vietqr.io/image/970415-123456.png')).toBe(true);
    });

    it('từ chối các host không an toàn hoặc giao thức http không bảo mật', () => {
      expect(isAllowedExternalUrl('http://dichvucong.gdt.gov.vn')).toBe(false);
      expect(isAllowedExternalUrl('https://malicious-site.com')).toBe(false);
      expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false);
      expect(isAllowedExternalUrl('file:///C:/Windows/System32/cmd.exe')).toBe(false);
    });
  });

  describe('isAllowedInternalUrl (Windows & Cross-platform)', () => {
    const mockDistDir = path.resolve('D:/Desktop/TaxRecord/dist');

    it('chấp nhận file:/// URL trên ổ đĩa Windows (C:, D:)', () => {
      const validUrl = 'file:///D:/Desktop/TaxRecord/dist/index.html';
      expect(isAllowedInternalUrl(validUrl, mockDistDir)).toBe(true);
    });

    it('chấp nhận URL dev server localhost và 127.0.0.1', () => {
      expect(isAllowedInternalUrl('http://localhost:5173/')).toBe(true);
      expect(isAllowedInternalUrl('http://127.0.0.1:3000/')).toBe(true);
      expect(isAllowedInternalUrl('https://dichvucong.gdt.gov.vn/tthc/dich-vu-khac')).toBe(true);
    });

    it('từ chối file:/// nằm ngoài thư mục dist', () => {
      const forbiddenUrl = 'file:///C:/Windows/System32/calc.exe';
      expect(isAllowedInternalUrl(forbiddenUrl, mockDistDir)).toBe(false);
    });
  });

  describe('F-001 — startsWith có path.sep, không bị bypass bằng thư mục cùng tiền tố', () => {
    const mockDistDir = path.resolve('D:/Desktop/TaxRecord/dist');

    it('từ chối thư mục cùng tiền tố dist (dist-evil) dù startsWith(distDir) cũ sẽ lọt', () => {
      expect(isAllowedInternalUrl('file:///D:/Desktop/TaxRecord/dist-evil/index.html', mockDistDir)).toBe(false);
    });

    it('chấp nhận chính xác distDir (resolved === distDir)', () => {
      expect(isAllowedInternalUrl('file:///D:/Desktop/TaxRecord/dist', mockDistDir)).toBe(true);
    });

    it('không truyền distDirOverride -> file:/// ngoài dist mặc định vẫn bị từ chối', () => {
      expect(isAllowedInternalUrl('file:///C:/tmp/evil/index.html')).toBe(false);
    });
  });
});

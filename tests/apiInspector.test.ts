import { describe, it, expect, beforeEach, vi } from 'vitest';
import axios, { AxiosInstance } from 'axios';
import { ApiInspectorManager } from '../src/main/inspector/ApiInspectorManager';

describe('ApiInspectorManager Core Suite', () => {
  let manager: ApiInspectorManager;
  let mockSender: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    manager = ApiInspectorManager.getInstance();
    manager.clearEntries();
    mockSender = vi.fn();
    manager.setRendererSender(mockSender);
  });

  describe('1. Admin PIN Verification & Status', () => {
    it('should only allow the development PIN and reject former hardcoded backdoors', () => {
      expect(manager.verifyAdminPin('admin')).toEqual({ success: true });
      expect(manager.verifyAdminPin('888888').success).toBe(false);
      expect(manager.verifyAdminPin('taxinsight@admin2026').success).toBe(false);
      expect(manager.verifyAdminPin('123456').success).toBe(false);
    });

    it('should reject incorrect PINs', () => {
      const res = manager.verifyAdminPin('wrong_pin');
      expect(res.success).toBe(false);
      expect(res.error).toBe('Mã PIN quản trị viên không chính xác.');
    });

    it('should return admin status after successful unlock', () => {
      manager.verifyAdminPin('admin');
      const status = manager.getAdminStatus();
      expect(status.isAdmin).toBe(true);
      expect(status.unlockedAt).toBeDefined();
    });
  });

  describe('2. Axios Interceptors & Traffic Capture', () => {
    it('should capture outgoing requests and mask passwords', async () => {
      const instance: AxiosInstance = axios.create();
      manager.attachAxios(instance);

      // Create a mock adapter or fake call with adapter
      instance.defaults.adapter = async (config) => {
        return {
          data: { status: 'success', totalRecords: 10 },
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          config
        };
      };

      await instance.post(
        'https://dichvucong.gdt.gov.vn/tthc/login',
        {
          mst: '0101234567',
          matKhau: 'SuperSecret123',
          captcha: 'ABCD'
        },
        {
          headers: {
            'X-XSRF-TOKEN': 'csrf-secret',
            Authorization: 'Bearer access-secret'
          }
        }
      );

      const entries = manager.getEntries();
      expect(entries.length).toBe(1);

      const entry = entries[0];
      expect(entry.method).toBe('POST');
      expect(entry.endpoint).toBe('/tthc/login');
      expect(entry.module).toBe('AUTH');
      expect(entry.status).toBe(200);
      expect(entry.requestBody).toBeDefined();

      // Ensure password was masked
      expect((entry.requestBody as any).matKhau).toBe('******');
      expect((entry.requestBody as any).captcha).toBe('******');
      expect((entry.requestBody as any).mst).toBe('0101234567');
      expect(entry.requestHeaders?.['X-XSRF-TOKEN']).toBe('******');
      expect(entry.requestHeaders?.Authorization).toBe('******');

      // Verify cURL command was generated
      expect(entry.curl).toContain('curl -X POST');
      expect(entry.curl).toContain('https://dichvucong.gdt.gov.vn/tthc/login');
      expect(entry.curl).not.toContain('SuperSecret123');
      expect(entry.curl).not.toContain('access-secret');
      expect(entry.curl).not.toContain('csrf-secret');
      expect(mockSender).toHaveBeenCalledWith(
        'inspector:new_entry',
        expect.objectContaining({ id: entry.id, status: 'PENDING' })
      );
      expect(mockSender).toHaveBeenCalledWith(
        'inspector:entry_updated',
        expect.objectContaining({ id: entry.id, status: 200 })
      );
    });

    it('should NOT generate false-positive CSRF diagnostic hint on 200 OK HTML containing csrf tags', async () => {
      const instance: AxiosInstance = axios.create();
      manager.attachAxios(instance);

      instance.defaults.adapter = async (config) => {
        return {
          data: '<html><head><meta name="csrf-token" content="abc123xyz" /></head><body>Home Page</body></html>',
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/html' },
          config
        };
      };

      await instance.get('https://dichvucong.gdt.gov.vn/tthc/tchs');

      const entries = manager.getEntries();
      expect(entries.length).toBe(1);
      const entry = entries[0];
      expect(entry.status).toBe(200);
      expect(entry.isError).toBe(false);
      expect(entry.diagnosticHint).toBeUndefined();
    });

    it('should capture HTTP 403 error and generate CSRF diagnostic hint', async () => {
      const instance: AxiosInstance = axios.create();
      manager.attachAxios(instance);

      instance.defaults.adapter = async (config) => {
        const err: any = new Error('Request failed with status code 403');
        err.isAxiosError = true;
        err.response = {
          data: 'Invalid CSRF Token',
          status: 403,
          statusText: 'Forbidden',
          headers: { 'content-type': 'text/html' },
          config
        };
        err.config = config;
        throw err;
      };

      try {
        await instance.get('https://dichvucong.gdt.gov.vn/tthc/tchs/tchs-tkhai');
      } catch {
        // Expected error
      }

      const entries = manager.getEntries();
      expect(entries.length).toBe(1);

      const entry = entries[0];
      expect(entry.status).toBe(403);
      expect(entry.isError).toBe(true);
      expect(entry.module).toBe('SCAN');
      expect(entry.diagnosticHint).toBeDefined();
      expect(entry.diagnosticHint).toContain('CSRF_OR_SESSION_REJECTED');
    });

    it('should capture HTTP 429 error and generate Rate Limit diagnostic hint', async () => {
      const instance: AxiosInstance = axios.create();
      manager.attachAxios(instance);

      instance.defaults.adapter = async (config) => {
        const err: any = new Error('Request failed with status code 429');
        err.isAxiosError = true;
        err.response = {
          data: 'Too Many Requests',
          status: 429,
          statusText: 'Too Many Requests',
          headers: {},
          config
        };
        err.config = config;
        throw err;
      };

      try {
        await instance.post('https://dichvucong.gdt.gov.vn/tthc/download');
      } catch {
        // Expected error
      }

      const entries = manager.getEntries();
      expect(entries.length).toBe(1);
      const entry = entries[0];
      expect(entry.status).toBe(429);
      expect(entry.module).toBe('DOWNLOAD');
      expect(entry.diagnosticHint).toContain('RATE LIMIT');
    });
  });

  describe('3. Buffer Management & Export', () => {
    it('should clear entries and emit clear event', () => {
      const instance: AxiosInstance = axios.create();
      manager.attachAxios(instance);

      instance.defaults.adapter = async (config) => ({
        data: 'ok',
        status: 200,
        statusText: 'OK',
        headers: {},
        config
      });

      manager.clearEntries();
      expect(manager.getEntries()).toHaveLength(0);
      expect(mockSender).toHaveBeenCalledWith('inspector:cleared', {});
    });

    it('should export formatted JSON string', async () => {
      const instance: AxiosInstance = axios.create();
      manager.attachAxios(instance);

      instance.defaults.adapter = async (config) => ({
        data: { msg: 'hello' },
        status: 200,
        statusText: 'OK',
        headers: {},
        config
      });

      await instance.get('https://thuedientu.gdt.gov.vn/etaxnnt/Request');

      const jsonStr = manager.exportEntriesJson();
      const parsed = JSON.parse(jsonStr);
      expect(parsed).toBeDefined();
      expect(Array.isArray(parsed.entries)).toBe(true);
      expect(parsed.entries.length).toBe(1);
      expect(parsed.entries[0].module).toBe('ETAX_GNT');
    });

    it('redacts SSO/CSRF/DSE secrets from URL, endpoint, cURL, body and response HTML', async () => {
      const instance: AxiosInstance = axios.create();
      manager.attachAxios(instance);

      instance.defaults.adapter = (async (config: any) => ({
        data: `
          <html><body>
            <input name="dse_sessionId" value="response-dse-secret" />
            <input value="response-csrf-secret" name="_csrf" />
            <script>const state = {"code":"response-code-secret"};</script>
          </body></html>
        `,
        status: 200,
        statusText: 'OK',
        headers: {
          'content-type': 'text/html',
          'set-cookie': ['JSESSIONID=response-cookie-secret']
        },
        config
      })) as any;

      await instance.post(
        'https://thuedientu.gdt.gov.vn/etaxnnt/?code=query-code-secret&vnconnect=query-vn-secret&dse_sessionId=query-dse-secret',
        {
          _csrf: 'body-csrf-secret',
          code: 'body-code-secret',
          dse_sessionId: 'body-dse-secret'
        },
        {
          headers: {
            Cookie: 'JSESSIONID=request-cookie-secret'
          }
        }
      );

      const exported = manager.exportEntriesJson();
      for (const secret of [
        'query-code-secret',
        'query-vn-secret',
        'query-dse-secret',
        'body-csrf-secret',
        'body-code-secret',
        'body-dse-secret',
        'request-cookie-secret',
        'response-cookie-secret',
        'response-dse-secret',
        'response-csrf-secret',
        'response-code-secret'
      ]) {
        expect(exported).not.toContain(secret);
      }
      const parsed = JSON.parse(exported);
      expect(parsed.entries[0].url).toContain('code=******');
      expect(parsed.entries[0].endpoint).toContain('dse_sessionId=******');
      expect(parsed.entries[0].curl).not.toContain('query-code-secret');
    });
  });
});

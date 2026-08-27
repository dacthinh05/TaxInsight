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
    it('should verify default admin PINs correctly', () => {
      expect(manager.verifyAdminPin('admin')).toEqual({ success: true });
      expect(manager.verifyAdminPin('888888')).toEqual({ success: true });
      expect(manager.verifyAdminPin('taxinsight@admin2026')).toEqual({ success: true });
      expect(manager.verifyAdminPin('686868')).toEqual({ success: true });
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

      await instance.post('https://dichvucong.gdt.gov.vn/tthc/login', {
        mst: '0101234567',
        matKhau: 'SuperSecret123',
        captcha: 'ABCD'
      });

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
      expect((entry.requestBody as any).mst).toBe('0101234567');

      // Verify cURL command was generated
      expect(entry.curl).toContain('curl -X POST');
      expect(entry.curl).toContain('https://dichvucong.gdt.gov.vn/tthc/login');
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
      expect(entry.diagnosticHint).toContain('CSRF LỆCH');
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
  });
});

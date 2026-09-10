import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { copyText } from '../src/renderer/utils/clipboard';

interface MockTaxPortalAPI {
  copyToClipboard?: (text: string) => Promise<{ success: boolean; error?: string }>;
}

interface MockGlobalScope {
  taxPortalAPI?: MockTaxPortalAPI;
}

const testGlobal = globalThis as unknown as MockGlobalScope;

describe('Clipboard utility (copyText)', () => {
  const originalTaxPortalAPI = testGlobal.taxPortalAPI;
  const originalNavigator = globalThis.navigator;
  const originalDocument = globalThis.document;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    testGlobal.taxPortalAPI = originalTaxPortalAPI;
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true
    });
  });

  it('Tier 1: should successfully copy using window.taxPortalAPI.copyToClipboard', async () => {
    const mockCopyToClipboard = vi.fn().mockResolvedValue({ success: true });
    testGlobal.taxPortalAPI = {
      copyToClipboard: mockCopyToClipboard
    };

    const result = await copyText('TR-2CAD-58BE-E366-64EC');
    expect(result).toBe(true);
    expect(mockCopyToClipboard).toHaveBeenCalledWith('TR-2CAD-58BE-E366-64EC');
  });

  it('Tier 2: should fallback to navigator.clipboard.writeText when taxPortalAPI returns failure', async () => {
    const mockCopyToClipboard = vi.fn().mockResolvedValue({ success: false });
    testGlobal.taxPortalAPI = {
      copyToClipboard: mockCopyToClipboard
    };

    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText: mockWriteText } },
      configurable: true,
      writable: true
    });

    const result = await copyText('TR-2CAD-58BE-E366-64EC');
    expect(result).toBe(true);
    expect(mockCopyToClipboard).toHaveBeenCalledWith('TR-2CAD-58BE-E366-64EC');
    expect(mockWriteText).toHaveBeenCalledWith('TR-2CAD-58BE-E366-64EC');
  });

  it('Tier 2: should work with navigator.clipboard when taxPortalAPI is absent', async () => {
    delete testGlobal.taxPortalAPI;

    const mockWriteText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText: mockWriteText } },
      configurable: true,
      writable: true
    });

    const result = await copyText('0817567008');
    expect(result).toBe(true);
    expect(mockWriteText).toHaveBeenCalledWith('0817567008');
  });

  it('Tier 3: should fallback to document.execCommand when navigator.clipboard throws', async () => {
    delete testGlobal.taxPortalAPI;

    const mockWriteText = vi.fn().mockRejectedValue(new Error('Permission denied'));
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText: mockWriteText } },
      configurable: true,
      writable: true
    });

    const mockExecCommand = vi.fn().mockReturnValue(true);
    const fakeBody = {
      appendChild: vi.fn(),
      removeChild: vi.fn()
    };
    const fakeDocument = {
      createElement: vi.fn().mockReturnValue({
        style: {},
        setAttribute: vi.fn(),
        select: vi.fn(),
        setSelectionRange: vi.fn(),
        value: ''
      }),
      body: fakeBody,
      execCommand: mockExecCommand
    };

    Object.defineProperty(globalThis, 'document', {
      value: fakeDocument,
      configurable: true,
      writable: true
    });

    const result = await copyText('TR-TEST-1234');
    expect(result).toBe(true);
    expect(mockExecCommand).toHaveBeenCalledWith('copy');

    Object.defineProperty(globalThis, 'document', {
      value: originalDocument,
      configurable: true,
      writable: true
    });
  });

  it('should handle empty/null string gracefully', async () => {
    const mockCopyToClipboard = vi.fn().mockResolvedValue({ success: true });
    testGlobal.taxPortalAPI = {
      copyToClipboard: mockCopyToClipboard
    };

    const result = await copyText('');
    expect(result).toBe(true);
    expect(mockCopyToClipboard).toHaveBeenCalledWith('');
  });
});

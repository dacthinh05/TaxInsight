import { describe, expect, it } from 'vitest';
import { AppUpdater } from '../src/main/updater/AppUpdater';

describe('Auto-Updater Module Test Suite', () => {
  it('khởi tạo singleton AppUpdater thành công với version 2.0.0', () => {
    const updater = AppUpdater.getInstance();
    expect(updater).toBeDefined();
    const status = updater.getStatus();
    expect(status.state).toBe('IDLE');
    expect(status.currentVersion).toBe('2.0.0');
  });

  it('xử lý trạng thái khi kiểm tra cập nhật an toàn không gây crash', async () => {
    const updater = AppUpdater.getInstance();
    const result = await updater.checkForUpdates();
    expect(result).toBeDefined();
    expect(['IDLE', 'CHECKING', 'AVAILABLE', 'NOT_AVAILABLE', 'ERROR']).toContain(result.state);
  });
});

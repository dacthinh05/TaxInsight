import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  friendlyUpdaterError,
  hasCompleteWindowsUpdateAssets,
  normalizeReleaseVersion
} from '../src/main/updater/UpdaterReleaseGuard';

describe('UpdaterReleaseGuard', () => {
  it('so sánh phiên bản theo từng segment số', () => {
    expect(compareVersions('2.7.3', '2.7.1')).toBe(1);
    expect(compareVersions('2.7.3', '2.7.3')).toBe(0);
    expect(compareVersions('2.7.3', '2.8.0')).toBe(-1);
    expect(compareVersions('2.10.0', '2.9.9')).toBe(1);
  });

  it('chuẩn hóa tag GitHub có tiền tố v', () => {
    expect(normalizeReleaseVersion('v2.7.3')).toBe('2.7.3');
  });

  it('chỉ coi release hoàn chỉnh khi có latest.yml và installer exe', () => {
    expect(hasCompleteWindowsUpdateAssets({
      assets: [
        { name: 'latest.yml' },
        { name: 'TaxInsight-Setup-2.7.4.exe' },
        { name: 'TaxInsight-Setup-2.7.4.exe.blockmap' }
      ]
    })).toBe(true);

    expect(hasCompleteWindowsUpdateAssets({
      assets: [{ name: 'TaxInsight-Setup-2.7.1.exe.blockmap' }]
    })).toBe(false);
  });

  it('ẩn stack trace 404 latest.yml khỏi thông báo người dùng', () => {
    const message = friendlyUpdaterError(
      new Error('Cannot find latest.yml in the latest release artifacts: HttpError: 404 Headers: {...}')
    );
    expect(message).toContain('thiếu latest.yml');
    expect(message).not.toContain('Headers');
    expect(message).not.toContain('HttpError');
  });
});

export interface GithubReleaseAsset {
  name?: string;
}

export interface GithubLatestRelease {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string;
  assets?: GithubReleaseAsset[];
}

function parseVersion(version: string): number[] {
  const normalized = String(version || '')
    .trim()
    .replace(/^v/i, '')
    .split('-')[0];

  if (!/^\d+(?:\.\d+)*$/.test(normalized)) return [];
  return normalized.split('.').map(part => Number(part));
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (a.length === 0 || b.length === 0) return 0;

  const size = Math.max(a.length, b.length);
  for (let i = 0; i < size; i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

export function normalizeReleaseVersion(tagName?: string): string {
  return String(tagName || '').trim().replace(/^v/i, '');
}

export function hasCompleteWindowsUpdateAssets(release: GithubLatestRelease): boolean {
  const names = (release.assets || [])
    .map(asset => String(asset.name || '').trim().toLowerCase())
    .filter(Boolean);

  const hasMetadata = names.includes('latest.yml');
  const hasInstaller = names.some(name => name.endsWith('.exe') && !name.endsWith('.exe.blockmap'));
  return hasMetadata && hasInstaller;
}

export function friendlyUpdaterError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error || '');
  const lower = raw.toLowerCase();

  if (
    lower.includes('latest.yml') &&
    (lower.includes('404') || lower.includes('cannot find'))
  ) {
    return 'Máy chủ cập nhật chưa có gói cài đặt hoàn chỉnh (thiếu latest.yml). Phiên bản hiện tại vẫn có thể sử dụng bình thường.';
  }
  if (lower.includes('404')) {
    return 'Không tìm thấy gói cập nhật trên máy chủ. Phiên bản hiện tại vẫn có thể sử dụng bình thường.';
  }
  if (
    lower.includes('enotfound') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('timeout') ||
    lower.includes('network')
  ) {
    return 'Không thể kết nối máy chủ cập nhật. Vui lòng kiểm tra Internet và thử lại sau.';
  }
  if (lower.includes('authentication token') || lower.includes('unauthorized') || lower.includes('forbidden')) {
    return 'Máy chủ cập nhật từ chối truy cập gói phát hành. Vui lòng liên hệ quản trị viên.';
  }

  return 'Không thể kiểm tra bản cập nhật lúc này. Phiên bản hiện tại vẫn có thể sử dụng bình thường.';
}

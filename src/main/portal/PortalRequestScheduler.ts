import { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { PORTAL_CONFIG } from '../../shared/constants';

export interface PortalRequestSchedulerPolicy {
  maxConcurrent: number;
  minStartIntervalMs: number;
  defaultCooldownMs: number;
  maxRetryAfterMs: number;
}

interface SchedulerPermit {
  release: () => void;
}

interface QueueEntry {
  resolve: (permit: SchedulerPermit) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  aborted: boolean;
  detachAbort?: () => void;
}

interface HostState {
  active: number;
  lastStartedAt: number;
  cooldownUntil: number;
  queue: QueueEntry[];
  timer?: NodeJS.Timeout;
}

const DEFAULT_POLICY: PortalRequestSchedulerPolicy = {
  // DVC production bắt đầu trả 429 khi phân trang liên tiếp chỉ cách nhau
  // khoảng 1 giây. Tuần tự hóa toàn bộ nhóm GDT và đặt nhịp nền đủ chậm để
  // scan/download/SSO không tranh nhau quota của cùng một phiên/IP.
  maxConcurrent: 1,
  minStartIntervalMs: 750,
  // Khi server không gửi Retry-After, 3.5 giây là quá ngắn: live trace cho
  // thấy request kế tiếp vẫn bị 429. Chờ 30 giây trước đúng một lần phục hồi.
  defaultCooldownMs: 30000,
  maxRetryAfterMs: 120000
};

const PERMIT_KEY = '__taxInsightRequestPermit';

function createCancelledError(): Error {
  const error = new Error('Tác vụ mạng đã bị hủy trước khi gửi request');
  Object.assign(error, { code: 'CANCELLED' });
  return error;
}

/**
 * Bộ điều phối duy nhất cho toàn bộ request đến hệ thống GDT/eTax.
 *
 * Scheduler kiểm soát concurrency, pacing, cooldown HTTP 429 và AbortSignal
 * giữa tất cả client/engine dùng chung PortalSession.
 */
export class PortalRequestScheduler {
  private readonly policy: PortalRequestSchedulerPolicy;
  private readonly states = new Map<string, HostState>();

  constructor(policy: Partial<PortalRequestSchedulerPolicy> = {}) {
    this.policy = { ...DEFAULT_POLICY, ...policy };
  }

  public async acquire(rawUrl: string, signal?: AbortSignal): Promise<SchedulerPermit> {
    const groupKey = this.resolveGroupKey(rawUrl);
    if (!groupKey) return { release: () => undefined };
    if (signal?.aborted) throw createCancelledError();

    const state = this.getState(groupKey);
    return new Promise<SchedulerPermit>((resolve, reject) => {
      const entry: QueueEntry = {
        resolve,
        reject,
        signal,
        aborted: false
      };

      if (signal) {
        const onAbort = () => {
          if (entry.aborted) return;
          entry.aborted = true;
          reject(createCancelledError());
          this.pump(groupKey);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        entry.detachAbort = () => signal.removeEventListener('abort', onAbort);
      }

      state.queue.push(entry);
      this.pump(groupKey);
    });
  }

  public triggerCooldown(rawUrl: string, cooldownMs = this.policy.defaultCooldownMs): void {
    const groupKey = this.resolveGroupKey(rawUrl);
    if (!groupKey) return;
    const state = this.getState(groupKey);
    const boundedCooldown = Math.max(0, Math.min(cooldownMs, this.policy.maxRetryAfterMs));
    state.cooldownUntil = Math.max(state.cooldownUntil, Date.now() + boundedCooldown);
    this.pump(groupKey);
  }

  public triggerCooldownFromHeaders(rawUrl: string, headers?: Record<string, unknown>): number {
    const retryAfter = this.parseRetryAfterMs(headers?.['retry-after'] ?? headers?.['Retry-After']);
    const cooldownMs = retryAfter ?? this.policy.defaultCooldownMs;
    this.triggerCooldown(rawUrl, cooldownMs);
    return cooldownMs;
  }

  public async waitForCooldown(rawUrl: string, signal?: AbortSignal): Promise<void> {
    const groupKey = this.resolveGroupKey(rawUrl);
    if (!groupKey) return;

    while (true) {
      if (signal?.aborted) throw createCancelledError();
      const remaining = this.getState(groupKey).cooldownUntil - Date.now();
      if (remaining <= 0) return;
      await this.abortableDelay(remaining, signal);
    }
  }

  public getSnapshot(rawUrl: string): {
    active: number;
    queued: number;
    cooldownRemainingMs: number;
    lastStartedAt: number;
  } {
    const groupKey = this.resolveGroupKey(rawUrl);
    if (!groupKey) {
      return { active: 0, queued: 0, cooldownRemainingMs: 0, lastStartedAt: 0 };
    }
    const state = this.getState(groupKey);
    return {
      active: state.active,
      queued: state.queue.filter(entry => !entry.aborted).length,
      cooldownRemainingMs: Math.max(0, state.cooldownUntil - Date.now()),
      lastStartedAt: state.lastStartedAt
    };
  }

  public reset(): void {
    for (const state of this.states.values()) {
      if (state.timer) clearTimeout(state.timer);
      for (const entry of state.queue) {
        entry.detachAbort?.();
        if (!entry.aborted) entry.reject(createCancelledError());
      }
    }
    this.states.clear();
  }

  private resolveGroupKey(rawUrl: string): string | null {
    try {
      const url = new URL(rawUrl, PORTAL_CONFIG.BASE_URL);
      const host = url.hostname.toLowerCase();
      // DVC và eTax dùng chung nhóm để chuỗi SSO không tạo burst qua hai host.
      if (host === 'gdt.gov.vn' || host.endsWith('.gdt.gov.vn')) return 'gdt.gov.vn';
      return null;
    } catch {
      return null;
    }
  }

  private getState(groupKey: string): HostState {
    let state = this.states.get(groupKey);
    if (!state) {
      state = {
        active: 0,
        lastStartedAt: 0,
        cooldownUntil: 0,
        queue: []
      };
      this.states.set(groupKey, state);
    }
    return state;
  }

  private pump(groupKey: string): void {
    const state = this.getState(groupKey);
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = undefined;
    }

    while (state.queue.length > 0 && state.queue[0].aborted) {
      state.queue.shift()?.detachAbort?.();
    }
    if (state.queue.length === 0 || state.active >= this.policy.maxConcurrent) return;

    const now = Date.now();
    const cooldownRemaining = state.cooldownUntil - now;
    const pacingRemaining = state.lastStartedAt
      ? this.policy.minStartIntervalMs - (now - state.lastStartedAt)
      : 0;
    const waitMs = Math.max(cooldownRemaining, pacingRemaining, 0);
    if (waitMs > 0) {
      state.timer = setTimeout(() => {
        state.timer = undefined;
        this.pump(groupKey);
      }, waitMs);
      return;
    }

    const entry = state.queue.shift();
    if (!entry) return;
    entry.detachAbort?.();
    if (entry.aborted || entry.signal?.aborted) {
      if (!entry.aborted) entry.reject(createCancelledError());
      this.pump(groupKey);
      return;
    }

    state.active += 1;
    state.lastStartedAt = Date.now();
    let released = false;
    entry.resolve({
      release: () => {
        if (released) return;
        released = true;
        state.active = Math.max(0, state.active - 1);
        this.pump(groupKey);
      }
    });

    // Nếu còn slot, lần bắt đầu kế tiếp vẫn phải đi qua khoảng pacing.
    this.pump(groupKey);
  }

  private parseRetryAfterMs(value: unknown): number | null {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    if (!text) return null;

    const seconds = Number(text);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(Math.ceil(seconds * 1000), this.policy.maxRetryAfterMs);
    }

    const retryAt = Date.parse(text);
    if (Number.isNaN(retryAt)) return null;
    return Math.min(Math.max(0, retryAt - Date.now()), this.policy.maxRetryAfterMs);
  }

  private abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(createCancelledError());
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(createCancelledError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }
}

export const globalPortalRequestScheduler = new PortalRequestScheduler();

/**
 * Permit được giữ đến khi response/error hoàn tất, do đó concurrency phản ánh
 * số kết nối đang thực sự hoạt động chứ không chỉ thời điểm bắt đầu.
 */
export function attachPortalRequestScheduler(client: AxiosInstance): void {
  client.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
    const rawUrl = new URL(config.url || '', config.baseURL || PORTAL_CONFIG.BASE_URL).toString();
    const permit = await globalPortalRequestScheduler.acquire(
      rawUrl,
      config.signal as AbortSignal | undefined
    );
    (config as any)[PERMIT_KEY] = permit;
    return config;
  });

  client.interceptors.response.use(
    response => {
      const config = response.config as any;
      const permit = config?.[PERMIT_KEY] as SchedulerPermit | undefined;
      if (response.status === 429) {
        const rawUrl = new URL(config.url || '', config.baseURL || PORTAL_CONFIG.BASE_URL).toString();
        globalPortalRequestScheduler.triggerCooldownFromHeaders(rawUrl, response.headers as Record<string, unknown>);
      }
      permit?.release();
      if (config) delete config[PERMIT_KEY];
      return response;
    },
    error => {
      const config = error?.config as any;
      const permit = config?.[PERMIT_KEY] as SchedulerPermit | undefined;
      if (error?.response?.status === 429 && config) {
        const rawUrl = new URL(config.url || '', config.baseURL || PORTAL_CONFIG.BASE_URL).toString();
        globalPortalRequestScheduler.triggerCooldownFromHeaders(
          rawUrl,
          error.response.headers as Record<string, unknown>
        );
      }
      permit?.release();
      if (config) delete config[PERMIT_KEY];
      return Promise.reject(error);
    }
  );
}

import { describe, expect, it } from 'vitest';
import { PortalRequestScheduler } from '../src/main/portal/PortalRequestScheduler';

describe('PortalRequestScheduler chống HTTP 429 và Request Avalanche', () => {
  it('giới hạn concurrency và giãn thời điểm bắt đầu request trên toàn nhóm GDT', async () => {
    const scheduler = new PortalRequestScheduler({
      maxConcurrent: 2,
      minStartIntervalMs: 25,
      defaultCooldownMs: 40
    });
    const url = 'https://dichvucong.gdt.gov.vn/tthc/tchs/downloadhoso';
    const starts: number[] = [];

    const first = await scheduler.acquire(url);
    starts.push(Date.now());

    const secondPromise = scheduler.acquire('https://thuedientu.gdt.gov.vn/etaxnnt/Request').then(permit => {
      starts.push(Date.now());
      return permit;
    });
    const thirdPromise = scheduler.acquire(url).then(permit => {
      starts.push(Date.now());
      return permit;
    });

    await new Promise(resolve => setTimeout(resolve, 8));
    expect(scheduler.getSnapshot(url).active).toBe(1);
    expect(scheduler.getSnapshot(url).queued).toBe(2);

    const second = await secondPromise;
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(18);
    expect(scheduler.getSnapshot(url).active).toBe(2);

    first.release();
    const third = await thirdPromise;
    expect(starts[2] - starts[1]).toBeGreaterThanOrEqual(18);

    second.release();
    third.release();
    expect(scheduler.getSnapshot(url).active).toBe(0);
    scheduler.reset();
  });

  it('tôn trọng Retry-After và không đánh thức đồng loạt sau cooldown', async () => {
    const scheduler = new PortalRequestScheduler({
      maxConcurrent: 2,
      minStartIntervalMs: 20,
      defaultCooldownMs: 30
    });
    const url = 'https://thuedientu.gdt.gov.vn/etaxnnt/Request';
    const cooldown = scheduler.triggerCooldownFromHeaders(url, { 'retry-after': '0.05' });
    expect(cooldown).toBe(50);

    const starts: number[] = [];
    const startedAt = Date.now();
    const firstPromise = scheduler.acquire(url).then(permit => {
      starts.push(Date.now());
      return permit;
    });
    const secondPromise = scheduler.acquire(url).then(permit => {
      starts.push(Date.now());
      return permit;
    });

    const first = await firstPromise;
    const second = await secondPromise;
    expect(starts[0] - startedAt).toBeGreaterThanOrEqual(40);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(10);

    first.release();
    second.release();
    scheduler.reset();
  });

  it('loại request đã bị hủy khỏi hàng đợi', async () => {
    const scheduler = new PortalRequestScheduler({
      maxConcurrent: 1,
      minStartIntervalMs: 1
    });
    const url = 'https://dichvucong.gdt.gov.vn/tthc/ho-so/search';
    const first = await scheduler.acquire(url);
    const controller = new AbortController();
    const queued = scheduler.acquire(url, controller.signal);
    controller.abort();

    await expect(queued).rejects.toMatchObject({ code: 'CANCELLED' });
    first.release();
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(scheduler.getSnapshot(url).queued).toBe(0);
    scheduler.reset();
  });
});

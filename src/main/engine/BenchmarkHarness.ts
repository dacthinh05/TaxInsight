import { performance } from 'perf_hooks';

export interface BenchmarkMetric {
  name: string;
  samplesCount: number;
  totalMs: number;
  avgMs: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  minMs: number;
}

export class BenchmarkHarness {
  private static metrics = new Map<string, number[]>();

  public static record(metricName: string, durationMs: number) {
    if (!this.metrics.has(metricName)) {
      this.metrics.set(metricName, []);
    }
    this.metrics.get(metricName)!.push(durationMs);
  }

  public static measureSync<T>(metricName: string, fn: () => T): T {
    const start = performance.now();
    try {
      const res = fn();
      const end = performance.now();
      this.record(metricName, end - start);
      return res;
    } catch (err) {
      const end = performance.now();
      this.record(`${metricName}_ERROR`, end - start);
      throw err;
    }
  }

  public static async measureAsync<T>(metricName: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      const res = await fn();
      const end = performance.now();
      this.record(metricName, end - start);
      return res;
    } catch (err) {
      const end = performance.now();
      this.record(`${metricName}_ERROR`, end - start);
      throw err;
    }
  }

  public static getReport(metricName: string): BenchmarkMetric | null {
    const samples = this.metrics.get(metricName);
    if (!samples || samples.length === 0) return null;

    const sorted = [...samples].sort((a, b) => a - b);
    const count = sorted.length;
    const total = sorted.reduce((sum, v) => sum + v, 0);
    const avg = total / count;
    const min = sorted[0];
    const max = sorted[count - 1];

    const median = count % 2 === 0
      ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2
      : sorted[Math.floor(count / 2)];

    const p95Idx = Math.min(count - 1, Math.floor(count * 0.95));
    const p95 = sorted[p95Idx];

    return {
      name: metricName,
      samplesCount: count,
      totalMs: Math.round(total * 100) / 100,
      avgMs: Math.round(avg * 100) / 100,
      medianMs: Math.round(median * 100) / 100,
      p95Ms: Math.round(p95 * 100) / 100,
      maxMs: Math.round(max * 100) / 100,
      minMs: Math.round(min * 100) / 100
    };
  }

  public static clear() {
    this.metrics.clear();
  }
}

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { PNG } from 'pngjs';
import jpeg from 'jpeg-js';
import * as ort from 'onnxruntime-web';

export interface OnnxSolveResult {
  text: string;
  confidence: number;
  charConfs: number[];
  latencyMs: number;
  accepted: boolean;
}

const CHARSET = '0123456789abcdefghijklmnopqrstuvwxyz';
const TARGET_WIDTH = 150;
const TARGET_HEIGHT = 38;
const CAPTCHA_LEN = 5;

export class OnnxCaptchaEngine {
  private static sessionPromise: Promise<ort.InferenceSession> | null = null;

  /**
   * Xác định đường dẫn file model tax_captcha.onnx (hoàn toàn OFFLINE).
   * Hỗ trợ cả dev mode và packaged Electron app.
   */
  private static getModelPath(): string {
    const candidates = [
      process.resourcesPath ? path.join(process.resourcesPath, 'resources', 'models', 'tax_captcha.onnx') : '',
      process.resourcesPath ? path.join(process.resourcesPath, 'models', 'tax_captcha.onnx') : '',
      typeof app !== 'undefined' && app?.getAppPath ? path.join(app.getAppPath(), 'resources', 'models', 'tax_captcha.onnx') : '',
      path.join(process.cwd(), 'resources', 'models', 'tax_captcha.onnx'),
      path.join(__dirname, '..', '..', '..', 'resources', 'models', 'tax_captcha.onnx')
    ].filter(Boolean);

    for (const p of candidates) {
      if (fs.existsSync(p)) return p;
    }

    return path.join(process.cwd(), 'resources', 'models', 'tax_captcha.onnx');
  }

  /**
   * Khởi tạo và tái sử dụng InferenceSession của onnxruntime-web (WASM).
   */
  private static async getSession(): Promise<ort.InferenceSession> {
    if (!this.sessionPromise) {
      this.sessionPromise = (async () => {
        const modelPath = this.getModelPath();
        if (!fs.existsSync(modelPath)) {
          throw new Error(`[OnnxCaptchaEngine] Không tìm thấy file model ONNX tại: ${modelPath}`);
        }
        const modelBuffer = fs.readFileSync(modelPath);
        const session = await ort.InferenceSession.create(new Uint8Array(modelBuffer), {
          executionProviders: ['wasm'],
          graphOptimizationLevel: 'all'
        });
        return session;
      })().catch(err => {
        this.sessionPromise = null;
        throw err;
      });
    }
    return this.sessionPromise;
  }

  /**
   * Giải mã ảnh PNG/JPEG sang Grayscale Float32Array chuẩn hóa [1, 1, 38, 150].
   * Sử dụng nội suy Bilinear chính xác cao.
   */
  public static preprocessImage(buffer: Buffer): Float32Array | null {
    try {
      let width = 0;
      let height = 0;
      let data: Uint8Array | Buffer;

      try {
        const png = PNG.sync.read(buffer);
        width = png.width;
        height = png.height;
        data = png.data;
      } catch {
        const raw = jpeg.decode(buffer, { useTArray: true });
        width = raw.width;
        height = raw.height;
        data = raw.data;
      }

      if (!width || !height || !data) return null;

      const out = new Float32Array(TARGET_WIDTH * TARGET_HEIGHT);

      for (let y = 0; y < TARGET_HEIGHT; y++) {
        const sy = (y / (TARGET_HEIGHT - 1)) * (height - 1);
        const y0 = Math.floor(sy);
        const y1 = Math.min(height - 1, y0 + 1);
        const fy = sy - y0;

        for (let x = 0; x < TARGET_WIDTH; x++) {
          const sx = (x / (TARGET_WIDTH - 1)) * (width - 1);
          const x0 = Math.floor(sx);
          const x1 = Math.min(width - 1, x0 + 1);
          const fx = sx - x0;

          const idx00 = (y0 * width + x0) * 4;
          const idx01 = (y0 * width + x1) * 4;
          const idx10 = (y1 * width + x0) * 4;
          const idx11 = (y1 * width + x1) * 4;

          const g00 = (data[idx00] * 299 + data[idx00 + 1] * 587 + data[idx00 + 2] * 114) / 1000;
          const g01 = (data[idx01] * 299 + data[idx01 + 1] * 587 + data[idx01 + 2] * 114) / 1000;
          const g10 = (data[idx10] * 299 + data[idx10 + 1] * 587 + data[idx10 + 2] * 114) / 1000;
          const g11 = (data[idx11] * 299 + data[idx11 + 1] * 587 + data[idx11 + 2] * 114) / 1000;

          const gray = g00 * (1 - fx) * (1 - fy) +
                       g01 * fx * (1 - fy) +
                       g10 * (1 - fx) * fy +
                       g11 * fx * fy;

          // Chuẩn hóa [-1.0, 1.0] (khớp với training dataset)
          out[y * TARGET_WIDTH + x] = (gray / 255.0 - 0.5) / 0.5;
        }
      }

      return out;
    } catch {
      return null;
    }
  }

  /**
   * Thực hiện nhận diện mã CAPTCHA bằng mô hình ONNX qua WASM.
   */
  public static async solve(imageBufferOrBase64: Buffer | string): Promise<OnnxSolveResult> {
    const t0 = performance.now();

    let rawBuffer: Buffer;
    if (typeof imageBufferOrBase64 === 'string') {
      const clean = imageBufferOrBase64.replace(/^data:image\/\w+;base64,/, '').trim();
      rawBuffer = Buffer.from(clean, 'base64');
    } else {
      rawBuffer = imageBufferOrBase64;
    }

    const floatData = this.preprocessImage(rawBuffer);
    if (!floatData) {
      return {
        text: '',
        confidence: 0,
        charConfs: [],
        latencyMs: performance.now() - t0,
        accepted: false
      };
    }

    try {
      const session = await this.getSession();
      const tensor = new ort.Tensor('float32', floatData, [1, 1, TARGET_HEIGHT, TARGET_WIDTH]);
      const results = await session.run({ input: tensor });
      const outputData = results.output.data as Float32Array;

      let text = '';
      const charConfs: number[] = [];

      for (let pos = 0; pos < CAPTCHA_LEN; pos++) {
        const offset = pos * CHARSET.length;
        let maxVal = -Infinity;
        let maxIdx = 0;

        for (let c = 0; c < CHARSET.length; c++) {
          const val = outputData[offset + c];
          if (val > maxVal) {
            maxVal = val;
            maxIdx = c;
          }
        }

        let sumExp = 0;
        for (let c = 0; c < CHARSET.length; c++) {
          sumExp += Math.exp(outputData[offset + c] - maxVal);
        }

        const conf = Math.round((1.0 / sumExp) * 1000) / 10;
        text += CHARSET[maxIdx];
        charConfs.push(conf);
      }

      const meanConf = Math.round((charConfs.reduce((a, b) => a + b, 0) / charConfs.length) * 10) / 10;
      const latencyMs = Math.round((performance.now() - t0) * 100) / 100;

      // Cổng an toàn: độ dài chuẩn 5 ký tự và độ tự tin >= 65%
      const accepted = text.length === CAPTCHA_LEN && meanConf >= 65;

      return {
        text,
        confidence: meanConf,
        charConfs,
        latencyMs,
        accepted
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[OnnxCaptchaEngine] Lỗi khi chạy inference ONNX:', msg);
      return {
        text: '',
        confidence: 0,
        charConfs: [],
        latencyMs: performance.now() - t0,
        accepted: false
      };
    }
  }

  /**
   * Giải phóng tài nguyên session WASM khi ứng dụng đóng.
   */
  public static async terminate(): Promise<void> {
    if (this.sessionPromise) {
      try {
        const session = await this.sessionPromise;
        await session.release();
      } catch {}
      this.sessionPromise = null;
    }
  }
}

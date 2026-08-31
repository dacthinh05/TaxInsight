import { EventEmitter } from 'events';
import { CaptchaChallenge, DateRange } from '../../shared/types';
import { CaptchaSolver } from '../scanner/CaptchaSolver';
import { TaxPortalClient } from './TaxPortalClient';

export class CaptchaManager extends EventEmitter {
  private client: TaxPortalClient;
  private pendingResolver: ((captcha: string) => void) | null = null;
  private pendingRejecter: ((err: Error) => void) | null = null;
  private autoSolveEnabled = true;

  constructor(client: TaxPortalClient) {
    super();
    this.client = client;
  }

  public setAutoSolve(enabled: boolean) {
    this.autoSolveEnabled = enabled;
  }

  /**
   * Tạo một thử thách CAPTCHA:
   * 1. Thử tự động giải mã offline qua CaptchaSolver
   * 2. Chỉ tự gửi khi đa số pipeline OCR cùng đồng thuận mạnh.
   * 3. Nếu không giải được hoặc bị lỗi -> emit sự kiện cho modal người dùng nhập tay
   */
  public async requestCaptcha(
    purpose: 'LOGIN' | 'SEARCH',
    targetRange?: DateRange,
    forceManual = false,
    context: Pick<CaptchaChallenge, 'requestReason' | 'page' | 'attempt' | 'maxAttempts'> = {}
  ): Promise<string> {
    const challengeId = `chal_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    let latestImageBase64 = '';

    // 1. Thử tự động lấy ảnh và giải qua ONNX / Ensemble (tối đa 2 lần thử nếu ảnh đầu không đủ tin cậy)
    const maxAutoAttempts = this.autoSolveEnabled && !forceManual ? 2 : 1;
    for (let autoAttempt = 1; autoAttempt <= maxAutoAttempts; autoAttempt++) {
      try {
        latestImageBase64 = await this.client.getCaptchaImage(purpose);
        if (this.autoSolveEnabled && !forceManual && latestImageBase64) {
          const result = await CaptchaSolver.solveDetailed(latestImageBase64);
          if (CaptchaSolver.isSafeForAutoSubmit(result)) {
            console.log(
              `[CaptchaManager] CAPTCHA đạt cổng tự động (lần ${autoAttempt}, ${result.reason}, conf=${result.confidence}%)`
            );
            return result.text;
          }
          console.log(
            `[CaptchaManager] Tự giải CAPTCHA lần ${autoAttempt} chưa đạt cổng an toàn (${result.reason}, conf=${result.confidence}%)`
          );
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[CaptchaManager] Tự giải CAPTCHA lần ${autoAttempt} thất bại:`, msg);
      }
    }

    // 2. Fallback sang modal thủ công nếu chưa giải được tự động
    const challenge: CaptchaChallenge = {
      challengeId,
      purpose,
      targetRange,
      imageBase64: latestImageBase64,
      ...context
    };

    return new Promise<string>((resolve, reject) => {
      this.pendingResolver = resolve;
      this.pendingRejecter = reject;
      this.emit('challenge', challenge);
    });
  }

  public submitCaptcha(captcha: string) {
    if (this.pendingResolver) {
      this.pendingResolver(captcha.trim().toLowerCase());
      this.pendingResolver = null;
      this.pendingRejecter = null;
    }
  }

  public cancel(reason = 'Yêu cầu CAPTCHA đã bị hủy') {
    if (this.pendingRejecter) {
      this.pendingRejecter(new Error(reason));
      this.pendingResolver = null;
      this.pendingRejecter = null;
    }
  }
}

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
   * 2. Nếu giải được chuỗi 4-6 ký tự hợp lệ -> trả về ngay (Zero-friction 1-Click)
   * 3. Nếu không giải được hoặc bị lỗi -> emit sự kiện cho modal người dùng nhập tay
   */
  public async requestCaptcha(purpose: 'LOGIN' | 'SEARCH', targetRange?: DateRange, forceManual = false): Promise<string> {
    const imageBase64 = await this.client.getCaptchaImage(purpose);
    const challengeId = `chal_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    // 1. Thử tự động giải nếu bật autoSolve và không bị ép buộc manual
    // Engine mới tự kiểm soát chất lượng qua Acceptance Gate: kết quả rỗng
    // nghĩa là bằng chứng nhận diện yếu -> chủ động chuyển nhập tay thay vì submit mò
    if (this.autoSolveEnabled && !forceManual && imageBase64) {
      try {
        const result = await CaptchaSolver.solveDetailed(imageBase64);
        if (result.accepted && result.text.length >= 3 && result.text.length <= 6) {
          console.log(
            `[CaptchaManager] Tự giải CAPTCHA OK (${result.reason}, conf=${result.confidence}%): ${result.text}`
          );
          return result.text;
        }
        console.log(
          `[CaptchaManager] Tự giải CAPTCHA không đủ tin cậy (${result.reason}, conf=${result.confidence}%) -> chuyển nhập tay`
        );
      } catch (err: any) {
        console.warn('[CaptchaManager] Tự giải CAPTCHA thất bại, chuyển sang nhập tay:', err.message);
      }
    }

    // 2. Fallback sang modal thủ công
    const challenge: CaptchaChallenge = {
      challengeId,
      purpose,
      targetRange,
      imageBase64
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

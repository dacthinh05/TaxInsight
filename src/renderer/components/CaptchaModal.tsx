import React, { useEffect, useRef, useState } from 'react';
import { Calendar, CheckCircle2, KeyRound, ShieldCheck, Sparkles, X } from 'lucide-react';
import { CaptchaChallenge } from '../../shared/types';

interface CaptchaModalProps {
  challenge: CaptchaChallenge;
  onSubmit: (captcha: string) => void;
  onCancel: () => void;
}

export const CaptchaModal: React.FC<CaptchaModalProps> = ({ challenge, onSubmit, onCancel }) => {
  const [captchaInput, setCaptchaInput] = useState('');
  const [isSolving, setIsSolving] = useState(false);
  const [isAutoFilled, setIsAutoFilled] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isNextPage = challenge.requestReason === 'NEXT_PAGE';
  const isRetry = challenge.requestReason === 'RETRY_INVALID';

  useEffect(() => {
    // Tự động giải khi modal xuất hiện (nếu có base64)
    if (challenge.imageBase64 && window.taxPortalAPI?.solveCaptcha) {
      setIsSolving(true);
      setIsAutoFilled(false);
      window.taxPortalAPI
        .solveCaptcha(challenge.imageBase64)
        .then(res => {
          if (res?.success && res.text) {
            setCaptchaInput(res.text);
            setIsAutoFilled(true);
          }
        })
        .catch(() => {})
        .finally(() => {
          setIsSolving(false);
          inputRef.current?.focus();
        });
    } else {
      inputRef.current?.focus();
    }
  }, [challenge.imageBase64]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!captchaInput.trim()) return;
    onSubmit(captchaInput.trim().toLowerCase());
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-fadeIn select-none">
      <div className="bg-white w-full max-w-[440px] rounded-2xl shadow-2xl border border-slate-200 overflow-hidden animate-scaleUp">
        {/* ─── 1. Header ────────────────────────────────────────── */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center border border-teal-100 shadow-2xs shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-[15px] leading-tight">
                {isRetry
                  ? 'Mã CAPTCHA chưa chính xác'
                  : isNextPage
                    ? `Xác nhận trang ${challenge.page || ''}`.trim()
                    : 'Xác Nhận Tra Cứu Cổng Thuế'}
              </h3>
              <p className="text-[11.5px] text-slate-500 mt-0.5">
                {isNextPage
                  ? 'Cổng Thuế yêu cầu mã xác nhận để tải trang tiếp theo'
                  : isRetry
                    ? `Thử lại lần ${challenge.attempt || 2}/${challenge.maxAttempts || 3} với ảnh mới`
                    : 'Nhập mã bảo mật để đồng bộ dữ liệu'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="w-8 h-8 rounded-lg hover:bg-slate-200/70 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-colors cursor-pointer"
            title="Đóng (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ─── 2. Content Body ──────────────────────────────────── */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {challenge.targetRange && (
            <div className="bg-slate-50/90 border border-slate-200/90 p-3 rounded-xl flex items-center space-x-3 text-xs text-slate-700 shadow-2xs">
              <div className="w-8 h-8 rounded-lg bg-teal-100/60 text-teal-800 flex items-center justify-center shrink-0 border border-teal-200/50">
                <Calendar className="w-4 h-4" />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-slate-500 block text-[10.5px] font-medium">Khoảng thời gian quét:</span>
                <div className="flex items-center flex-wrap gap-1.5 mt-0.5">
                  <span className="font-bold text-slate-900 font-mono text-[12.5px]">
                    {challenge.targetRange.fromDate} → {challenge.targetRange.toDate}
                  </span>
                  {challenge.targetRange.label && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-teal-50 text-teal-800 font-semibold text-[11px] border border-teal-200/80">
                      {challenge.targetRange.label}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {isNextPage && (
            <div className="rounded-xl border border-sky-200 bg-sky-50/80 p-3 text-[11.5px] leading-relaxed text-sky-900 flex items-start space-x-2">
              <span className="font-bold">ℹ</span>
              <span>Cổng Thuế yêu cầu mã mới khi chuyển sang trang kế tiếp. Dữ liệu trang trước đã được lưu lại đầy đủ.</span>
            </div>
          )}

          {isRetry && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3 text-[11.5px] leading-relaxed text-amber-950 flex items-start space-x-2">
              <span className="font-bold">⚠️</span>
              <span>Mã xác thực trước đó không khớp hoặc đã hết hạn. Đã tự động đổi ảnh mới.</span>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <span>Mã xác nhận (CAPTCHA)</span>
              </label>
              {isSolving ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-teal-50 text-teal-700 border border-teal-200 animate-pulse">
                  <Sparkles className="w-3 h-3 text-teal-600" />
                  <span>AI đang giải mã...</span>
                </span>
              ) : isAutoFilled && captchaInput ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 shadow-2xs">
                  <Sparkles className="w-3 h-3 text-emerald-600" />
                  <span>Tự động nhận diện</span>
                </span>
              ) : null}
            </div>

            {/* Khối Nhập + Ảnh CAPTCHA ngang đồng bộ */}
            <div className="flex items-stretch gap-2.5">
              {/* Input field */}
              <div className="relative flex-1">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5 pointer-events-none" />
                <input
                  ref={inputRef}
                  type="text"
                  value={captchaInput}
                  onChange={e => {
                    setCaptchaInput(e.target.value.toLowerCase());
                    setIsAutoFilled(false);
                  }}
                  placeholder="Nhập mã..."
                  maxLength={6}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  className="w-full h-11 pl-10 pr-9 bg-slate-50 border border-slate-300 rounded-xl text-[15px] font-mono font-bold text-slate-900 tracking-wider focus:outline-none focus:ring-2 focus:ring-teal-600/40 focus:border-teal-600 focus:bg-white transition-all placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400 placeholder:text-xs shadow-2xs"
                  required
                />
                {captchaInput.length >= 4 && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 absolute right-3 top-3.5" />
                )}
              </div>

              {/* Vùng xem ảnh CAPTCHA */}
              <div className="h-11 px-2 bg-slate-100/90 border border-slate-300 rounded-xl shadow-2xs flex items-center justify-center shrink-0 min-w-[130px] overflow-hidden">
                {challenge.imageBase64 ? (
                  <img
                    src={challenge.imageBase64}
                    alt="CAPTCHA"
                    className="h-8 w-auto max-w-[120px] object-contain rounded select-none pointer-events-none"
                  />
                ) : (
                  <span className="text-xs text-slate-400">Đang tải ảnh...</span>
                )}
              </div>
            </div>
            <p className="text-[11px] text-slate-500 leading-tight">
              Bấm <kbd className="px-1 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] font-mono border border-slate-300">Enter</kbd> để tiếp tục hoặc sửa lại nếu AI nhận diện chưa chuẩn.
            </p>
          </div>

          {/* ─── 3. Action Buttons ─────────────────────────────────── */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 h-10 px-4 bg-white hover:bg-slate-100 active:bg-slate-200 text-slate-700 font-semibold rounded-xl text-xs transition-colors cursor-pointer border border-slate-300 shadow-2xs"
            >
              Hủy bỏ (Esc)
            </button>
            <button
              type="submit"
              disabled={!captchaInput.trim()}
              className="flex-1 h-10 px-4 bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white font-bold rounded-xl text-xs shadow-xs hover:shadow transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
            >
              <span>Xác nhận</span>
              <kbd className="px-1.5 py-0.5 bg-teal-800 text-teal-100 rounded text-[10px] font-mono border border-teal-600">↵ Enter</kbd>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

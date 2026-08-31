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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4 animate-fadeIn select-none">
      <div className="bg-white w-full max-w-[420px] rounded-2xl shadow-2xl border border-slate-200/90 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-700 flex items-center justify-center border border-teal-100">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm leading-tight">
                {isRetry
                  ? 'CAPTCHA trước chưa được chấp nhận'
                  : isNextPage
                    ? `Xác nhận trang kết quả ${challenge.page || ''}`.trim()
                    : 'Xác Nhận Tra Cứu'}
              </h3>
              <span className="text-[11px] text-slate-500">
                {isNextPage
                  ? 'Mã mới cho trang kế tiếp, không phải vòng lặp đăng nhập'
                  : isRetry
                    ? `Thử lại ${challenge.attempt || 2}/${challenge.maxAttempts || 3} với ảnh mới`
                    : 'Mã bảo mật Cổng Thuế Điện Tử'}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {challenge.targetRange && (
            <div className="bg-slate-50 border border-slate-200/80 px-3 py-2 rounded-xl flex items-center space-x-2.5 text-xs text-slate-700">
              <Calendar className="w-4 h-4 text-teal-700 shrink-0" />
              <div className="truncate">
                <span className="text-slate-500 block text-[10.5px]">Khoảng thời gian:</span>
                <span className="font-semibold text-slate-900">
                  {challenge.targetRange.fromDate} → {challenge.targetRange.toDate}
                </span>
                {challenge.targetRange.label && (
                  <span className="text-teal-700 font-medium ml-1.5 text-[11px]">
                    ({challenge.targetRange.label})
                  </span>
                )}
              </div>
            </div>
          )}

          {isNextPage && (
            <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-[11.5px] leading-relaxed text-sky-900">
              Cổng Thuế yêu cầu CAPTCHA mới khi chuyển sang trang kết quả tiếp theo.
              Dữ liệu ở trang trước đã được giữ lại.
            </div>
          )}

          {isRetry && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-950">
              Mã vừa nhập không khớp hoặc đã hết hạn. Ứng dụng chỉ thử tối đa
              {' '}{challenge.maxAttempts || 3} lần rồi dừng, không lặp vô hạn.
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-700">
                Mã xác thực (CAPTCHA)
              </label>
              {isSolving ? (
                <span className="text-[11px] text-teal-700 font-medium flex items-center space-x-1 animate-pulse">
                  <Sparkles className="w-3 h-3" />
                  <span>Đang tự nhận diện...</span>
                </span>
              ) : isAutoFilled && captchaInput ? (
                <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200/80">
                  <Sparkles className="w-3 h-3 text-emerald-600" />
                  <span>Tự động nhận diện</span>
                </span>
              ) : null}
            </div>

            {/* Khối Nhập + Ảnh Liền khối ngang */}
            <div className="flex items-center space-x-2">
              <div className="relative flex-1">
                <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
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
                  className="w-full h-11 pl-9 pr-8 bg-slate-50 border border-slate-300 rounded-xl text-sm font-mono font-bold text-slate-800 tracking-wider focus:outline-none focus:ring-2 focus:ring-teal-600 focus:bg-white transition-all placeholder:font-sans placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400 placeholder:text-xs"
                  required
                />
                {captchaInput.length >= 4 && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 absolute right-2.5 top-3.5" />
                )}
              </div>

              {/* Vùng xem ảnh CAPTCHA */}
              <div className="h-11 px-2 flex items-center justify-center bg-slate-50 border border-slate-300 rounded-xl shadow-2xs">
                {challenge.imageBase64 ? (
                  <img
                    src={challenge.imageBase64}
                    alt="CAPTCHA"
                    className="h-8 max-w-[120px] object-contain rounded"
                  />
                ) : (
                  <span className="text-xs text-slate-400 px-3">Đang tải mã...</span>
                )}
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center space-x-2.5 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 h-9.5 px-3 border border-slate-200 hover:bg-slate-50 text-slate-700 font-medium rounded-xl text-xs transition-colors cursor-pointer"
            >
              Hủy bỏ (Esc)
            </button>
            <button
              type="submit"
              disabled={!captchaInput.trim()}
              className="flex-1 h-9.5 px-4 bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white font-semibold rounded-xl text-xs shadow-xs transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center gap-1.5"
            >
              <span>Xác nhận</span>
              <kbd className="px-1.5 py-0.5 bg-teal-800 text-teal-200 rounded text-[10px] font-mono border border-teal-600">↵ Enter</kbd>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

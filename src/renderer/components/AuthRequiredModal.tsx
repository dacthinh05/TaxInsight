import React, { useEffect, useState } from 'react';
import { AlertTriangle, Eye, EyeOff, Lock, RefreshCw, ShieldAlert, User, X } from 'lucide-react';

interface AuthRequiredModalProps {
  initialTaxCode?: string;
  onLoginSuccess: (taxCode: string) => void;
  onCancel: () => void;
}

export const AuthRequiredModal: React.FC<AuthRequiredModalProps> = ({
  initialTaxCode = '',
  onLoginSuccess,
  onCancel
}) => {
  const [taxCode, setTaxCode] = useState(initialTaxCode);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [captchaText, setCaptchaText] = useState('');
  const [captchaImg, setCaptchaImg] = useState<string | null>(null);
  const [isLoadingCaptcha, setIsLoadingCaptcha] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadCaptcha = async () => {
    setIsLoadingCaptcha(true);
    setErrorMessage(null);
    try {
      if (window.taxPortalAPI) {
        const res = await window.taxPortalAPI.getCaptcha();
        if (res.success && res.imageBase64) {
          setCaptchaImg(res.imageBase64);
        }
      }
    } catch (err: any) {
      setErrorMessage('Không thể tải mã CAPTCHA: ' + err.message);
    } finally {
      setIsLoadingCaptcha(false);
    }
  };

  useEffect(() => {
    loadCaptcha();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taxCode.trim() || !password || !captchaText.trim()) {
      setErrorMessage('Vui lòng nhập đầy đủ MST, Mật khẩu và Mã CAPTCHA');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      if (window.taxPortalAPI) {
        const res = await window.taxPortalAPI.login({
          taxCode: taxCode.trim(),
          password,
          captcha: captchaText.trim()
        });

        if (res.success) {
          onLoginSuccess(taxCode.trim());
        } else {
          setErrorMessage(res.message || 'Đăng nhập không thành công, vui lòng thử lại');
          loadCaptcha();
          setCaptchaText('');
        }
      } else {
        onLoginSuccess(taxCode.trim());
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi kết nối khi đăng nhập');
      loadCaptcha();
      setCaptchaText('');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/70 backdrop-blur-xs p-4 animate-fadeIn">
      <div className="bg-white w-full max-w-md rounded-2xl shadow-2xl border border-red-200 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-red-700 to-amber-700 p-4 text-white flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <ShieldAlert className="w-5 h-5 text-amber-300 animate-pulse" />
            <div>
              <h3 className="font-bold text-sm">Phiên Đăng Nhập Đã Hết Hạn</h3>
              <p className="text-[11px] text-amber-100">Cổng Thuế yêu cầu đăng nhập lại để tiếp tục tải</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="text-white/80 hover:text-white transition-colors"
            title="Hủy phiên"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-3.5">
          {errorMessage && (
            <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs flex items-start space-x-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Mã số thuế / Tài khoản
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={taxCode}
                onChange={e => setTaxCode(e.target.value)}
                placeholder="VD: 3702735709"
                className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Mật khẩu
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full pl-9 pr-9 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 focus:outline-none"
              >
                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-700 mb-1">
              Mã xác thực (CAPTCHA)
            </label>
            <div className="flex items-center space-x-2 mb-2">
              <div className="flex-1 h-10 bg-slate-100 border border-slate-300 rounded-lg flex items-center justify-center overflow-hidden">
                {isLoadingCaptcha ? (
                  <RefreshCw className="w-4 h-4 text-emerald-600 animate-spin" />
                ) : captchaImg ? (
                  <img src={captchaImg} alt="CAPTCHA" className="h-full object-contain" />
                ) : (
                  <span className="text-xs text-slate-400">Không có ảnh</span>
                )}
              </div>
              <button
                type="button"
                onClick={loadCaptcha}
                disabled={isLoadingCaptcha}
                className="px-2.5 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 rounded-lg text-xs font-medium flex items-center space-x-1"
                title="Lấy mã khác"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingCaptcha ? 'animate-spin' : ''}`} />
                <span>Đổi mã</span>
              </button>
            </div>
            <input
              type="text"
              value={captchaText}
              onChange={e => setCaptchaText(e.target.value)}
              placeholder="Nhập mã CAPTCHA ở trên"
              maxLength={6}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck="false"
              style={{ textTransform: 'none' }}
              className="w-full px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono font-bold tracking-widest text-center normal-case focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white"
              required
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onCancel}
              className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg text-xs transition-colors"
            >
              Hủy tải
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-1.5 bg-emerald-700 hover:bg-emerald-800 active:scale-98 text-white font-bold rounded-lg text-xs flex items-center space-x-1.5 transition-all shadow-xs disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Đang xác thực...</span>
                </>
              ) : (
                <span>Đăng nhập & Tiếp tục tải</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

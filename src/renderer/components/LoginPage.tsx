import React, { useEffect, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  ChevronDown,
  Clock,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  RefreshCw,
  ShieldCheck,
  Trash2,
  User,
  Users
} from 'lucide-react';
import appIconUrl from '/icon.png?url';
import { SavedAccountInfo } from '../../shared/types';

interface LoginPageProps {
  onLoginSuccess: (taxCode: string) => void;
  initialTaxCode?: string;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess, initialTaxCode }) => {
  const [taxCode, setTaxCode] = useState(() => initialTaxCode || localStorage.getItem('saved_mst') || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [captchaText, setCaptchaText] = useState('');
  const [captchaImg, setCaptchaImg] = useState<string | null>(null);
  const [isLoadingCaptcha, setIsLoadingCaptcha] = useState(false);
  const [isAutoSolved, setIsAutoSolved] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rememberTaxCode, setRememberTaxCode] = useState(true);
  const [savePassword, setSavePassword] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorField, setErrorField] = useState<'CAPTCHA' | 'PASSWORD' | 'TAX_CODE' | 'SESSION' | 'GENERAL' | null>(null);
  const [savedAccounts, setSavedAccounts] = useState<SavedAccountInfo[]>([]);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [appVersion, setAppVersion] = useState('2.5.0');

  const passwordInputRef = React.useRef<HTMLInputElement>(null);
  const captchaInputRef = React.useRef<HTMLInputElement>(null);
  const taxCodeInputRef = React.useRef<HTMLInputElement>(null);

  // Chống race khi loadCaptcha bị gọi chồng (double-click ảnh captcha, refresh khi đang load):
  // response của request cũ phải bị bỏ qua, không đè ảnh/text của request mới
  const captchaReqRef = React.useRef(0);

  // Debounce + staleness guard cho việc tự điền mật khẩu theo MST đang gõ
  const credLookupTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tải danh sách tài khoản đã lưu
  const loadSavedAccounts = async () => {
    if (window.taxPortalAPI?.getSavedAccounts) {
      try {
        const list = await window.taxPortalAPI.getSavedAccounts();
        setSavedAccounts(list || []);
      } catch {}
    }
  };

  useEffect(() => {
    loadSavedAccounts();
    if (window.taxPortalAPI?.getAppVersion) {
      window.taxPortalAPI.getAppVersion().then(res => {
        if (res?.success && res.version) {
          setAppVersion(res.version);
        }
      });
    }
  }, []);

  // Nếu có initialTaxCode hoặc taxCode mặc định, tự động load password nếu đã lưu
  useEffect(() => {
    if (taxCode.trim() && window.taxPortalAPI?.getAccountCredentials) {
      window.taxPortalAPI.getAccountCredentials({ taxCode: taxCode.trim() }).then(creds => {
        if (creds?.password) {
          setPassword(creds.password);
          setSavePassword(true);
        }
      });
    }
  }, []);

  const loadCaptcha = async () => {
    const reqId = ++captchaReqRef.current;
    setIsLoadingCaptcha(true);
    setIsAutoSolved(false);
    try {
      if (window.taxPortalAPI) {
        const res = await window.taxPortalAPI.getCaptcha();
        // Request cũ về sau -> bỏ qua, giữ nguyên kết quả của request mới nhất
        if (reqId !== captchaReqRef.current) return;
        if (res.success && res.imageBase64) {
          setCaptchaImg(res.imageBase64);
          // Tự động nhận diện CAPTCHA qua OCR offline thông minh
          if (window.taxPortalAPI.solveCaptcha) {
            window.taxPortalAPI
              .solveCaptcha(res.imageBase64)
              .then(solveRes => {
                if (reqId !== captchaReqRef.current) return;
                if (solveRes?.success && solveRes.text) {
                  setCaptchaText(solveRes.text);
                  setIsAutoSolved(true);
                }
              })
              .catch(() => {});
          }
        } else {
          generateMockCaptcha();
        }
      } else {
        generateMockCaptcha();
      }
    } catch {
      if (reqId === captchaReqRef.current) generateMockCaptcha();
    } finally {
      if (reqId === captchaReqRef.current) setIsLoadingCaptcha(false);
    }
  };

  const generateMockCaptcha = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 120;
    canvas.height = 40;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, 0, 120, 40);
      ctx.font = 'bold 20px monospace';
      ctx.fillStyle = '#0f766e';
      ctx.fillText('i3dqr', 25, 28);
      setCaptchaImg(canvas.toDataURL('image/png'));
      setCaptchaText('i3dqr');
      setIsAutoSolved(true);
    }
  };

  useEffect(() => {
    loadCaptcha();
  }, []);

  // Chọn tài khoản từ danh sách đã lưu
  const handleSelectAccount = async (account: SavedAccountInfo) => {
    setTaxCode(account.taxCode);
    setIsAccountMenuOpen(false);
    setErrorMessage(null);
    setErrorField(null);

    if (window.taxPortalAPI?.getAccountCredentials) {
      const creds = await window.taxPortalAPI.getAccountCredentials({ taxCode: account.taxCode });
      if (creds?.password) {
        setPassword(creds.password);
        setSavePassword(true);
      } else {
        setPassword('');
      }
    }

    // Tải captcha mới và tự giải
    loadCaptcha();
  };

  // Xóa tài khoản khỏi danh sách đã lưu
  const handleRemoveAccount = async (e: React.MouseEvent, accountTaxCode: string) => {
    e.stopPropagation();
    if (window.taxPortalAPI?.removeSavedAccount) {
      await window.taxPortalAPI.removeSavedAccount({ taxCode: accountTaxCode });
      await loadSavedAccounts();
      if (taxCode.trim().toLowerCase() === accountTaxCode.toLowerCase()) {
        setPassword('');
      }
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanMst = taxCode.trim();
    if (!cleanMst) {
      setErrorMessage('Vui lòng nhập Mã số thuế');
      setErrorField('TAX_CODE');
      taxCodeInputRef.current?.focus();
      return;
    }
    if (!password) {
      setErrorMessage('Vui lòng nhập Mật khẩu đăng nhập');
      setErrorField('PASSWORD');
      passwordInputRef.current?.focus();
      return;
    }
    if (!captchaText.trim()) {
      setErrorMessage('Vui lòng nhập Mã xác thực (CAPTCHA)');
      setErrorField('CAPTCHA');
      captchaInputRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setErrorField(null);

    try {
      if (rememberTaxCode) {
        localStorage.setItem('saved_mst', cleanMst);
      } else {
        localStorage.removeItem('saved_mst');
      }

      if (window.taxPortalAPI) {
        const res = await window.taxPortalAPI.login({
          taxCode: cleanMst,
          password,
          captcha: captchaText.trim()
        });

        if (res.success) {
          // Lưu tài khoản & mật khẩu (nếu người dùng tùy chọn lưu)
          if (window.taxPortalAPI.saveAccount) {
            await window.taxPortalAPI.saveAccount({
              taxCode: cleanMst,
              password,
              savePassword: Boolean(savePassword)
            });
          }
          onLoginSuccess(cleanMst);
        } else {
          const field = (res as any).errorField || 'GENERAL';
          setErrorMessage(res.message || 'Đăng nhập không thành công, vui lòng kiểm tra lại thông tin');
          setErrorField(field);

          // Tải mã CAPTCHA mới
          loadCaptcha();

          if (field === 'CAPTCHA') {
            setCaptchaText('');
            setTimeout(() => {
              captchaInputRef.current?.focus();
            }, 100);
          } else if (field === 'PASSWORD') {
            setTimeout(() => {
              passwordInputRef.current?.focus();
              passwordInputRef.current?.select();
            }, 100);
          } else if (field === 'TAX_CODE') {
            setTimeout(() => {
              taxCodeInputRef.current?.focus();
            }, 100);
          }
        }
      } else {
        onLoginSuccess(cleanMst);
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi kết nối khi đăng nhập');
      setErrorField('GENERAL');
      loadCaptcha();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4 select-none">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-md border border-slate-200 overflow-hidden">
        
        {/* Header */}
        <div className="px-8 pt-8 pb-3 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-slate-50 border border-slate-200 mb-3 shadow-2xs p-1">
            <img
              src={appIconUrl}
              alt="TaxInsight Logo"
              className="w-full h-full object-contain"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          </div>
          <div className="flex items-center justify-center space-x-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 font-sans">TaxInsight</h1>
            <span className="text-xs text-slate-400 font-normal">v{appVersion}</span>
          </div>
          <p className="text-xs text-slate-500 font-normal mt-1">
            Hệ Thống Soát Xét & Đối Chiếu Hồ Sơ Thuế Điện Tử
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="px-8 pb-7 space-y-4">
          {errorMessage && (
            <div className={`p-3.5 rounded-xl border text-xs leading-relaxed flex items-start space-x-2.5 shadow-2xs ${
              errorField === 'CAPTCHA'
                ? 'bg-amber-50/90 border-amber-300 text-amber-950'
                : errorField === 'PASSWORD'
                ? 'bg-red-50/90 border-red-300 text-red-950'
                : errorField === 'TAX_CODE'
                ? 'bg-orange-50/90 border-orange-300 text-orange-950'
                : 'bg-red-50/90 border-red-300 text-red-950'
            }`}>
              <div className="shrink-0 mt-0.5">
                {errorField === 'CAPTCHA' ? (
                  <ShieldCheck className="w-4 h-4 text-amber-700" />
                ) : errorField === 'PASSWORD' ? (
                  <KeyRound className="w-4 h-4 text-red-700" />
                ) : errorField === 'TAX_CODE' ? (
                  <Building2 className="w-4 h-4 text-orange-700" />
                ) : (
                  <Lock className="w-4 h-4 text-red-700" />
                )}
              </div>
              <div className="space-y-0.5">
                <div className="font-bold text-[12px]">
                  {errorField === 'CAPTCHA'
                    ? 'Mã xác thực CAPTCHA không đúng'
                    : errorField === 'PASSWORD'
                    ? 'Mật khẩu hoặc MST không chính xác'
                    : errorField === 'TAX_CODE'
                    ? 'Mã số thuế không hợp lệ'
                    : 'Đăng nhập không thành công'}
                </div>
                <div className="text-[11.5px] opacity-90">{errorMessage}</div>
              </div>
            </div>
          )}

          {/* Ô Mã Số Thuế + Dropdown Chọn Nhanh MST */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-semibold text-slate-700">
                Mã số thuế / Tài khoản
              </label>
              {savedAccounts.length > 0 && (
                <button
                  type="button"
                  onClick={() => setIsAccountMenuOpen(!isAccountMenuOpen)}
                  className="text-[11.5px] text-teal-700 hover:text-teal-900 font-semibold flex items-center space-x-1 cursor-pointer"
                >
                  <Users className="w-3.5 h-3.5" />
                  <span>Chọn MST đã lưu ({savedAccounts.length}) ▾</span>
                </button>
              )}
            </div>

            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                ref={taxCodeInputRef}
                type="text"
                value={taxCode}
                onChange={e => {
                  const newVal = e.target.value;
                  setTaxCode(newVal);
                  if (errorField === 'TAX_CODE') setErrorField(null);

                  // Khi gõ MST khác, kiểm tra xem có password đã lưu không.
                  // Debounce 250ms + chỉ áp dụng nếu MST KHÔNG ĐỔI trong lúc chờ response
                  // (trước đây response của trạng thái gõ dở về sau đè mật khẩu sai vào ô).
                  if (window.taxPortalAPI) {
                    if (credLookupTimerRef.current) clearTimeout(credLookupTimerRef.current);
                    credLookupTimerRef.current = setTimeout(() => {
                      window.taxPortalAPI!
                        .getAccountCredentials({ taxCode: newVal.trim() })
                        .then(creds => {
                          if (creds?.password && taxCode.trim() === newVal.trim()) {
                            setPassword(creds.password);
                          }
                        })
                        .catch(() => {});
                    }, 250);
                  }
                }}
                placeholder="VD: 3702735709"
                className={`w-full pl-9 pr-8 py-2 rounded-lg text-sm font-mono text-slate-900 focus:outline-none transition-all ${
                  errorField === 'TAX_CODE'
                    ? 'bg-red-50/30 border-2 border-red-500 ring-2 ring-red-200'
                    : 'bg-slate-50 border border-slate-300 focus:ring-2 focus:ring-teal-600 focus:bg-white'
                }`}
                required
              />
              {savedAccounts.length > 0 && (
                <button
                  type="button"
                  onClick={() => setIsAccountMenuOpen(!isAccountMenuOpen)}
                  className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-700"
                  title="Danh sách tài khoản đã lưu"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              )}

              {/* Menu Popup Chọn Nhanh MST */}
              {isAccountMenuOpen && savedAccounts.length > 0 && (
                <div className="absolute left-0 right-0 top-10.5 z-30 bg-white border border-slate-200 rounded-xl shadow-2xl py-1 text-xs max-h-56 overflow-y-auto animate-fadeIn divide-y divide-slate-100">
                  <div className="px-3 py-1.5 bg-slate-50 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    TÀI KHOẢN ĐÃ LƯU TRÊN MÁY NÀY
                  </div>
                  {savedAccounts.map(acc => (
                    <div
                      key={acc.taxCode}
                      onClick={() => handleSelectAccount(acc)}
                      className="px-3 py-2 hover:bg-teal-50 flex items-center justify-between transition-colors cursor-pointer group"
                    >
                      <div className="truncate">
                        <div className="font-mono font-bold text-slate-900 group-hover:text-teal-900 text-xs">
                          {acc.taxCode}
                        </div>
                        <div className="text-[11px] text-slate-500 flex items-center space-x-1.5 mt-0.5">
                          {acc.hasPassword ? (
                            <span className="text-emerald-700 font-medium">● Đã lưu mật khẩu</span>
                          ) : (
                            <span className="text-slate-400">○ Chưa lưu mật khẩu</span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleRemoveAccount(e, acc.taxCode)}
                        className="p-1 text-slate-300 hover:text-red-600 rounded transition-colors"
                        title="Xóa tài khoản khỏi danh sách"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Ô Mật Khẩu */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Mật khẩu
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              <input
                ref={passwordInputRef}
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => {
                  setPassword(e.target.value);
                  if (errorField === 'PASSWORD') setErrorField(null);
                }}
                placeholder="••••••••••••"
                className={`w-full pl-9 pr-10 py-2 rounded-lg text-sm text-slate-900 focus:outline-none transition-all ${
                  errorField === 'PASSWORD'
                    ? 'bg-red-50/30 border-2 border-red-500 ring-2 ring-red-200'
                    : 'bg-slate-50 border border-slate-300 focus:ring-2 focus:ring-teal-600 focus:bg-white'
                }`}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 focus:outline-none transition-colors"
                title={showPassword ? 'Ẩn mật khẩu' : 'Hiển thị mật khẩu'}
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4 text-teal-700" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
            {errorField === 'PASSWORD' && (
              <p className="text-[11px] text-red-600 font-medium mt-1">
                ⚠️ Mật khẩu không chính xác. Hãy kiểm tra lại phím CapsLock hoặc mật khẩu đã lưu.
              </p>
            )}
          </div>

          {/* CAPTCHA SECTION */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-700">
                Mã xác thực (CAPTCHA)
              </label>
              {isLoadingCaptcha ? (
                <span className="text-[11px] text-teal-600 font-medium flex items-center space-x-1 animate-pulse">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  <span>Đang tải mã...</span>
                </span>
              ) : isAutoSolved && captchaText && errorField !== 'CAPTCHA' ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200">
                  <span>✓ Đã nhận diện</span>
                </span>
              ) : null}
            </div>

            <div className="flex items-center space-x-2">
              <div className="relative flex-1">
                <input
                  ref={captchaInputRef}
                  type="text"
                  value={captchaText}
                  onChange={e => {
                    setCaptchaText(e.target.value);
                    setIsAutoSolved(false);
                    if (errorField === 'CAPTCHA') setErrorField(null);
                  }}
                  placeholder="Nhập mã xác thực"
                  className={`w-full px-3.5 py-2 rounded-lg text-sm font-mono tracking-widest uppercase focus:outline-none transition-all ${
                    errorField === 'CAPTCHA'
                      ? 'bg-amber-50/40 border-2 border-amber-500 ring-2 ring-amber-200 font-bold text-amber-950'
                      : 'bg-slate-50 border border-slate-300 focus:ring-2 focus:ring-teal-600 focus:bg-white'
                  }`}
                  required
                />
              </div>

              {/* Khối hiển thị ảnh CAPTCHA */}
              <div
                onClick={loadCaptcha}
                className="h-10 px-2 bg-slate-100 border border-slate-300 rounded-lg flex items-center justify-center cursor-pointer hover:bg-slate-200/80 transition-colors shrink-0 shadow-2xs"
                title="Nhấp để làm mới mã CAPTCHA"
              >
                {captchaImg ? (
                  <img
                    src={captchaImg}
                    alt="CAPTCHA"
                    className="h-8 object-contain rounded"
                  />
                ) : (
                  <div className="w-20 h-8 flex items-center justify-center text-slate-400">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={loadCaptcha}
                disabled={isLoadingCaptcha}
                className="h-10 w-10 flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors shrink-0 cursor-pointer"
                title="Tải lại mã CAPTCHA"
              >
                <RefreshCw className={`w-4 h-4 ${isLoadingCaptcha ? 'animate-spin text-teal-600' : ''}`} />
              </button>
            </div>
            {errorField === 'CAPTCHA' && (
              <p className="text-[11px] text-amber-800 font-semibold mt-1">
                ⚠️ Mã CAPTCHA chưa chính xác. Đã đổi mã mới bên trên, hãy nhìn hình và nhập lại.
              </p>
            )}
          </div>

          {/* Tùy Chọn Ghi Nhớ & Lưu Mật Khẩu */}
          <div className="space-y-1.5 pt-1">
            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={rememberTaxCode}
                onChange={e => setRememberTaxCode(e.target.checked)}
                className="w-4 h-4 text-teal-700 rounded border-slate-300 focus:ring-teal-500 cursor-pointer"
              />
              <span className="text-xs text-slate-600">Ghi nhớ Mã số thuế này</span>
            </label>

            <label className="flex items-center space-x-2 cursor-pointer">
              <input
                type="checkbox"
                checked={savePassword}
                onChange={e => setSavePassword(e.target.checked)}
                className="w-4 h-4 text-teal-700 rounded border-slate-300 focus:ring-teal-500 cursor-pointer"
              />
              <span className="text-xs text-slate-600">
                Lưu mật khẩu trên thiết bị này
              </span>
            </label>
          </div>

          {/* Nút Đăng Nhập */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white font-semibold rounded-lg text-sm shadow-xs transition-colors flex items-center justify-center space-x-2 disabled:opacity-50 cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Đang xác thực phiên làm việc…</span>
              </>
            ) : (
              <span>Đăng nhập Cổng Thuế</span>
            )}
          </button>
        </form>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 text-center text-xs text-slate-500">
          Hỗ trợ quét tự động tờ khai, GNT và đối chiếu báo cáo thuế GTGT
        </div>
      </div>
    </div>
  );
};

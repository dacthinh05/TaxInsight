import React from 'react';
import { Activity, ArrowUpCircle, Clock, CreditCard, FileText, FolderOpen, History, KeyRound, LogOut, RotateCcw, Scale, ShieldCheck } from 'lucide-react';
import { AppViewMode, SavedAccountInfo, UserSessionInfo } from '../../shared/types';
import appIconUrl from '/icon.png?url';

interface AppHeaderProps {
  session: UserSessionInfo;
  viewMode: AppViewMode;
  onViewModeChange: (mode: AppViewMode) => void;
  onOpenFolder: () => void;
  onSelectDirectory?: () => void;
  onResetDirectory?: () => void;
  baseDir?: string;
  onOpenLogs: () => void;
  onLogout: () => void;
  onSwitchAccount?: (taxCode: string) => void;
  onOpenLicense?: () => void;
  onCheckUpdate?: () => void;
  onOpenInspector?: () => void;
  inspectorErrorCount?: number;
  hasNewUpdate?: boolean;
  isLicenseActivated?: boolean;
  isTrial?: boolean;
  licenseTierLabel?: string;
  logsCount?: number;
}

export const AppHeader: React.FC<AppHeaderProps> = ({
  session,
  viewMode,
  onViewModeChange,
  onOpenFolder,
  onSelectDirectory,
  onResetDirectory,
  baseDir = '',
  onOpenLogs,
  onLogout,
  onSwitchAccount,
  onOpenLicense,
  onCheckUpdate,
  onOpenInspector,
  inspectorErrorCount = 0,
  hasNewUpdate = false,
  isLicenseActivated = false,
  isTrial = false,
  licenseTierLabel = '',
  logsCount = 0
}) => {
  const [savedAccounts, setSavedAccounts] = React.useState<SavedAccountInfo[]>([]);
  const [isSwitchMenuOpen, setIsSwitchMenuOpen] = React.useState(false);
  const [isFolderMenuOpen, setIsFolderMenuOpen] = React.useState(false);
  const [appVersion, setAppVersion] = React.useState(__APP_VERSION__);
  const [versionClicks, setVersionClicks] = React.useState(0);

  const handleVersionClick = () => {
    const next = versionClicks + 1;
    if (next >= 5) {
      setVersionClicks(0);
      if (onOpenInspector) onOpenInspector();
    } else {
      setVersionClicks(next);
      setTimeout(() => setVersionClicks(0), 2500);
    }
  };

  React.useEffect(() => {
    if (window.taxPortalAPI?.getAppVersion) {
      window.taxPortalAPI.getAppVersion().then(res => {
        if (res?.success && res.version) {
          setAppVersion(res.version);
        }
      });
    }
  }, []);

  React.useEffect(() => {
    if (session.isLoggedIn && window.taxPortalAPI?.getSavedAccounts) {
      window.taxPortalAPI.getSavedAccounts().then(list => {
        setSavedAccounts(list || []);
      });
    }
  }, [session.isLoggedIn]);

  return (
    <header className="h-12 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-4 z-40 select-none shrink-0 shadow-xs">
      {/* 1. Left Branding: Logo + Tên ứng dụng + MST */}
      <div className="flex items-center space-x-2.5 shrink-0">
        <div className="w-7 h-7 rounded-lg bg-teal-950/80 border border-teal-600/30 flex items-center justify-center p-0.5 shadow-xs shrink-0 overflow-hidden">
          <img
            src={appIconUrl}
            alt="TaxInsight Logo"
            className="w-full h-full object-contain"
            onError={(e) => {
              const target = e.currentTarget;
              if (!target.src.endsWith('icon.svg')) {
                target.src = './icon.svg';
              }
            }}
          />
        </div>
        <div className="flex items-center space-x-2 whitespace-nowrap">
          <div className="flex items-center space-x-1.5">
            <h1 className="text-sm font-bold text-white tracking-tight">TaxInsight</h1>
            <span className="px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-teal-500/15 text-teal-300 border border-teal-500/25 tracking-wider uppercase">
              Pro
            </span>
            <span
              onClick={handleVersionClick}
              className="text-xs text-slate-400 font-normal hover:text-teal-300 transition-colors cursor-pointer select-none ml-0.5"
              title="Nhấp 5 lần để mở API Inspector (Admin / Dev)"
            >
              v{appVersion}
            </span>
          </div>

          {/* Interactive MST Dropdown (Đổi nhanh MST) */}
          {session.taxCode && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsSwitchMenuOpen(!isSwitchMenuOpen)}
                className="text-[11.5px] font-mono flex items-center space-x-1 px-2 py-0.5 border border-slate-700/80 hover:border-slate-600 hover:bg-slate-800/80 rounded-md transition-all cursor-pointer bg-slate-950/40"
                title="Bấm để đổi nhanh sang Mã số thuế khác"
              >
                <span className="text-slate-400 font-sans text-[10.5px]">MST:</span>
                <span className="text-teal-400 font-bold tracking-wide">{session.taxCode}</span>
                <span className="text-slate-400 text-[10px] ml-0.5">▾</span>
              </button>
              {/* Dropdown Menu Đổi Nhanh MST */}
              {isSwitchMenuOpen && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute left-0 top-9 z-50 w-72 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-1 text-xs animate-fadeIn divide-y divide-slate-800 text-slate-200"
                >
                  <div className="px-3 py-1.5 bg-slate-950/60 text-[10.5px] font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                    <span>ĐỔI NHANH MÃ SỐ THUẾ</span>
                    <span className="text-[10px] text-teal-400 font-normal">({savedAccounts.length} MST)</span>
                  </div>

                  <div className="max-h-56 overflow-y-auto divide-y divide-slate-800/60">
                    {savedAccounts.map(acc => {
                      const isCurrent = acc.taxCode.toLowerCase() === (session.taxCode || '').toLowerCase();
                      return (
                        <div
                          key={acc.taxCode}
                          onClick={() => {
                            setIsSwitchMenuOpen(false);
                            if (!isCurrent) {
                              if (onSwitchAccount) {
                                onSwitchAccount(acc.taxCode);
                              } else {
                                onLogout();
                              }
                            }
                          }}
                          className={`px-3 py-2 flex items-center justify-between transition-colors cursor-pointer ${
                            isCurrent ? 'bg-teal-950/60 text-teal-300 font-semibold' : 'hover:bg-slate-800/90 text-slate-200'
                          }`}
                        >
                          <div className="truncate">
                            <div className="font-mono text-xs flex items-center space-x-1.5">
                              <span>{acc.taxCode}</span>
                              {isCurrent && (
                                <span className="px-1.5 py-0.2 rounded text-[9.5px] bg-teal-800/80 text-teal-200 border border-teal-600/60">
                                  Hiện hành
                                </span>
                              )}
                            </div>
                            <div className="text-[10.5px] text-slate-400 mt-0.5">
                              {acc.hasPassword ? '● Có sẵn mật khẩu' : '○ Nhập mật khẩu khi vào'}
                            </div>
                          </div>
                          {!isCurrent && (
                            <span className="text-teal-400 text-xs font-semibold hover:underline shrink-0 ml-2">
                              Chuyển →
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="p-1.5 bg-slate-950/40">
                    <button
                      type="button"
                      onClick={() => {
                        setIsSwitchMenuOpen(false);
                        onLogout();
                      }}
                      className="w-full py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[11.5px] font-medium flex items-center justify-center space-x-1 transition-colors cursor-pointer"
                    >
                      <span>+ Đăng nhập MST mới</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Center Segmented View Switcher (Core v2.0: Tờ khai & Hồ sơ, Nghĩa vụ theo tờ khai) */}
      {session.isLoggedIn && (
        <div className="flex items-center bg-slate-950/80 p-0.5 rounded-lg border border-slate-800 text-xs shrink-0 whitespace-nowrap shadow-inner">
          <button
            type="button"
            onClick={() => onViewModeChange('FILINGS')}
            className={`px-3 py-1.5 rounded-md font-semibold transition-all flex items-center space-x-1.5 cursor-pointer ${
              viewMode === 'FILINGS'
                ? 'bg-teal-700 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <FileText className="w-3.5 h-3.5 shrink-0" />
            <span>Tờ khai & Hồ sơ</span>
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('PAYMENT_SLIPS')}
            className={`px-3 py-1.5 rounded-md font-semibold transition-all flex items-center space-x-1.5 cursor-pointer ${
              viewMode === 'PAYMENT_SLIPS'
                ? 'bg-teal-700 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <CreditCard className="w-3.5 h-3.5 shrink-0" />
            <span>Giấy nộp tiền</span>
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('OBLIGATIONS')}
            className={`px-3 py-1.5 rounded-md font-semibold transition-all flex items-center space-x-1.5 cursor-pointer ${
              viewMode === 'OBLIGATIONS'
                ? 'bg-teal-700 text-white shadow-xs'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Scale className="w-3.5 h-3.5 shrink-0" />
            <span>Nghĩa vụ theo tờ khai</span>
          </button>
        </div>
      )}

      {/* Action Navigation */}
      <div className="flex items-center space-x-1.5 shrink-0 whitespace-nowrap">
        {onOpenLicense && (
          <button
            type="button"
            onClick={onOpenLicense}
            className={`h-8 px-2.5 rounded-md text-xs font-semibold flex items-center space-x-1.5 transition-all cursor-pointer ${
              !isTrial && isLicenseActivated
                ? 'bg-teal-950/80 text-teal-300 border border-teal-700/80 hover:bg-teal-900'
                : isTrial && isLicenseActivated
                ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-700/80 hover:bg-emerald-900'
                : 'bg-gradient-to-r from-amber-500/20 to-teal-500/20 text-amber-300 border border-amber-500/40 hover:border-amber-400'
            }`}
            title="Quản lý bản quyền phần mềm TaxRecord"
          >
            {isTrial && isLicenseActivated ? (
              <>
                <Clock className="w-3.5 h-3.5 text-emerald-300" />
                <span>{licenseTierLabel || 'Dùng thử 7 ngày'}</span>
              </>
            ) : isLicenseActivated ? (
              <>
                <ShieldCheck className="w-3.5 h-3.5 text-teal-300" />
                <span>Bản quyền Pro</span>
              </>
            ) : (
              <>
                <KeyRound className="w-3.5 h-3.5 text-amber-300" />
                <span>Kích hoạt bản quyền</span>
              </>
            )}
          </button>
        )}

        {/* Folder Options Dropdown */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setIsFolderMenuOpen(!isFolderMenuOpen)}
            className="h-8 px-2.5 rounded-md text-xs text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700/60 flex items-center space-x-1.5 transition-colors cursor-pointer"
            title="Thư mục lưu trữ hồ sơ tải về"
          >
            <FolderOpen className="w-3.5 h-3.5 text-teal-400" />
            <span className="hidden sm:inline">Thư mục tải ▾</span>
          </button>

          {isFolderMenuOpen && (
            <div className="absolute right-0 top-10 z-50 w-72 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl py-2 text-xs animate-fadeIn divide-y divide-slate-800/80">
              <div className="px-3 pb-2">
                <div className="text-[10.5px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  Vị trí lưu trữ hiện tại
                </div>
                <div className="font-mono text-[11px] text-teal-300 bg-slate-950/80 p-2 rounded-md border border-slate-800 break-all select-all">
                  {baseDir || 'Thư mục mặc định'}
                </div>
              </div>

              <div className="py-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsFolderMenuOpen(false);
                    onOpenFolder();
                  }}
                  className="w-full px-3 py-2 text-left hover:bg-slate-800 flex items-center space-x-2 text-slate-200 font-medium transition-colors cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4 text-teal-400 shrink-0" />
                  <div>
                    <div className="font-semibold text-slate-100 text-[12px]">Mở thư mục hiện tại</div>
                    <div className="text-[10.5px] text-slate-400">Xem các tệp đã tải của MST đang chọn</div>
                  </div>
                </button>

                {onSelectDirectory && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsFolderMenuOpen(false);
                      onSelectDirectory();
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-slate-800 flex items-center space-x-2 text-slate-200 font-medium transition-colors cursor-pointer"
                  >
                    <FolderOpen className="w-4 h-4 text-amber-400 shrink-0" />
                    <div>
                      <div className="font-semibold text-amber-300 text-[12px]">Đổi thư mục lưu trữ...</div>
                      <div className="text-[10.5px] text-slate-400">Chọn ổ đĩa / thư mục khác trên máy</div>
                    </div>
                  </button>
                )}

                {onResetDirectory && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsFolderMenuOpen(false);
                      onResetDirectory();
                    }}
                    className="w-full px-3 py-2 text-left hover:bg-slate-800 flex items-center space-x-2 text-slate-200 font-medium transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-4 h-4 text-slate-400 shrink-0" />
                    <div>
                      <div className="font-semibold text-slate-300 text-[12px]">Đặt lại mặc định</div>
                      <div className="text-[10.5px] text-slate-500">Khôi phục về thư mục Downloads hệ thống</div>
                    </div>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>



        <button
          type="button"
          onClick={onOpenLogs}
          className="h-8 px-2.5 rounded-md text-xs text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700/60 flex items-center space-x-1.5 transition-colors relative cursor-pointer"
          title="Xem nhật ký hoạt động hệ thống"
        >
          <History className="w-3.5 h-3.5 text-slate-400" />
          <span className="hidden sm:inline">Nhật ký</span>
          {logsCount > 0 && (
            <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
          )}
        </button>

        <div className="h-4 w-px bg-slate-800 mx-1" />

        <button
          type="button"
          onClick={onLogout}
          className="h-8 px-2.5 rounded-md text-xs text-slate-400 hover:text-red-300 hover:bg-red-950/40 border border-transparent hover:border-red-900/50 flex items-center space-x-1.5 transition-colors cursor-pointer"
          title="Đăng xuất khỏi Cổng Thuế"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Đăng xuất</span>
        </button>
      </div>
    </header>
  );
};

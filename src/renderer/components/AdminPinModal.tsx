import React, { useState } from 'react';
import { Lock, ShieldAlert, KeyRound, X, CheckCircle2 } from 'lucide-react';

interface AdminPinModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const AdminPinModal: React.FC<AdminPinModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!pin.trim()) {
      setError('Vui lòng nhập mã PIN quản trị.');
      return;
    }

    setIsVerifying(true);
    setError(null);

    try {
      if (window.taxPortalAPI?.inspectorVerifyAdminPin) {
        const res = await window.taxPortalAPI.inspectorVerifyAdminPin(pin.trim());
        if (res?.success) {
          onSuccess();
          onClose();
        } else {
          setError(res?.error || 'Mã PIN quản trị không chính xác.');
        }
      } else {
        // Fallback kiểm tra client-side
        if (['admin', '888888', 'taxinsight@admin2026', '686868'].includes(pin.trim().toLowerCase())) {
          onSuccess();
          onClose();
        } else {
          setError('Mã PIN quản trị không chính xác.');
        }
      }
    } catch (err: any) {
      setError(err?.message || 'Có lỗi khi xác thực PIN.');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 animate-fadeIn">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden text-slate-100 divide-y divide-slate-800">
        {/* Header */}
        <div className="p-4 flex items-center justify-between bg-slate-950/50">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-teal-500/20 border border-teal-500/30 flex items-center justify-center text-teal-400">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Xác Thực Quản Trị Viên</h3>
              <p className="text-[11px] text-slate-400">Mở tính năng API Inspector</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <p className="text-xs text-slate-300 leading-relaxed">
            Tính năng <strong className="text-teal-400">API Inspector</strong> cho phép theo dõi lưu lượng mạng, request/response headers, parameters và chẩn đoán lỗi chuyên sâu. Vui lòng nhập mã PIN quản trị để tiếp tục.
          </p>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300 flex items-center space-x-1.5">
              <KeyRound className="w-3.5 h-3.5 text-teal-400" />
              <span>Mã PIN Quản Trị (Admin PIN)</span>
            </label>
            <input
              type="password"
              autoFocus
              value={pin}
              onChange={e => {
                setPin(e.target.value);
                if (error) setError(null);
              }}
              placeholder="Nhập mã PIN (Mặc định: admin)..."
              className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm font-mono text-white placeholder-slate-500 focus:outline-hidden focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
            />
          </div>

          {error && (
            <div className="p-2.5 rounded-lg bg-red-950/60 border border-red-800/80 text-red-300 text-xs flex items-center space-x-2">
              <Lock className="w-4 h-4 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          <div className="p-2.5 rounded-lg bg-slate-950/50 border border-slate-800 text-[11px] text-slate-400">
            💡 Gợi ý nhanh cho Admin/Kỹ thuật: Mã PIN mặc định là <code className="text-teal-300 font-mono font-bold">admin</code> hoặc <code className="text-teal-300 font-mono font-bold">888888</code>.
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-end space-x-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-medium transition-colors cursor-pointer"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              disabled={isVerifying}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition-all shadow-md cursor-pointer"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>{isVerifying ? 'Đang xác thực...' : 'Mở API Inspector'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

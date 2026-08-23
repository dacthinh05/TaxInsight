import React from 'react';
import { Activity, Clock, ShieldCheck, X } from 'lucide-react';
import { AuditLogEntry } from '../../shared/types';

interface AuditLogDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  logs: AuditLogEntry[];
}

export const AuditLogDrawer: React.FC<AuditLogDrawerProps> = ({ isOpen, onClose, logs }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs animate-fadeIn">
      <div className="bg-white w-full max-w-md h-full shadow-2xl flex flex-col border-l border-slate-200">
        {/* Header */}
        <div className="p-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Activity className="w-5 h-5 text-emerald-400" />
            <h3 className="font-bold text-sm">Nhật Ký Thao Tác (Audit Log)</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Security Notice */}
        <div className="p-3 bg-slate-100 border-b border-slate-200 text-[11px] text-slate-600 flex items-center space-x-2">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>Bảo mật: Tuyệt đối không lưu mật khẩu, session secret hoặc mã CAPTCHA.</span>
        </div>

        {/* Log List */}
        <div className="flex-1 overflow-auto p-4 space-y-2.5">
          {logs.length === 0 ? (
            <div className="text-center text-slate-400 py-10 text-xs">
              Chưa có sự kiện nào được ghi nhận.
            </div>
          ) : (
            logs.map(log => {
              let badgeColor = 'bg-slate-100 text-slate-700 border-slate-200';
              if (log.type === 'SUCCESS') badgeColor = 'bg-emerald-50 text-emerald-800 border-emerald-200';
              else if (log.type === 'WARNING') badgeColor = 'bg-amber-50 text-amber-800 border-amber-200';
              else if (log.type === 'ERROR') badgeColor = 'bg-red-50 text-red-800 border-red-200';

              return (
                <div
                  key={log.id}
                  className={`p-3 rounded-lg border text-xs space-y-1 ${badgeColor}`}
                >
                  <div className="flex items-center justify-between text-[10px] opacity-75">
                    <span className="font-bold uppercase tracking-wider">{log.type}</span>
                    <span className="flex items-center space-x-1">
                      <Clock className="w-3 h-3" />
                      <span>{log.timestamp}</span>
                    </span>
                  </div>
                  <div className="font-medium text-slate-900">{log.action}</div>
                  {log.details && (
                    <div className="text-[11px] text-slate-600 font-mono break-all">
                      {log.details}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

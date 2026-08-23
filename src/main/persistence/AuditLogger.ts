import fs from 'fs';
import path from 'path';
import { AuditLogEntry } from '../../shared/types';

export class AuditLogger {
  private logFilePath: string;
  private memoryLogs: AuditLogEntry[] = [];
  private maxMemoryLogs = 500;

  constructor(baseDir: string) {
    this.logFilePath = path.join(baseDir, 'audit_activity.log');
  }

  public setBaseDir(baseDir: string) {
    this.logFilePath = path.join(baseDir, 'audit_activity.log');
  }

  public log(type: AuditLogEntry['type'], action: string, details?: string): AuditLogEntry {
    const entry: AuditLogEntry = {
      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: new Date().toLocaleString('vi-VN'),
      type,
      action: this.sanitizeLogMessage(action),
      details: details ? this.sanitizeLogMessage(details) : undefined
    };

    this.memoryLogs.unshift(entry);
    if (this.memoryLogs.length > this.maxMemoryLogs) {
      this.memoryLogs.pop();
    }

    this.appendToFile(entry);
    return entry;
  }

  public getLogs(): AuditLogEntry[] {
    return [...this.memoryLogs];
  }

  public clearLogs() {
    this.memoryLogs = [];
    // Xóa cả file log trên đĩa — trước đây chỉ xóa buffer trong RAM
    // khiến audit_activity.log tăng trưởng không giới hạn dù user đã "xóa log"
    try {
      if (fs.existsSync(this.logFilePath)) {
        fs.writeFileSync(this.logFilePath, '', 'utf-8');
      }
    } catch {
      // Tránh crash
    }
  }

  private sanitizeLogMessage(msg: string): string {
    if (!msg) return '';
    return msg
      .replace(/password=[^&\s]+/gi, 'password=[REDACTED]')
      .replace(/matkhau=[^&\s]+/gi, 'matKhau=[REDACTED]')
      .replace(/captcha=[^&\s]+/gi, 'captcha=[REDACTED]')
      .replace(/token=[^&\s]+/gi, 'token=[REDACTED]')
      .replace(/cookie:[^\n]+/gi, 'Cookie: [REDACTED]');
  }

  private appendToFile(entry: AuditLogEntry) {
    try {
      const dir = path.dirname(this.logFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const logLine = `[${entry.timestamp}] [${entry.type}] ${entry.action}${entry.details ? ' - ' + entry.details : ''}\n`;
      fs.appendFileSync(this.logFilePath, logLine, 'utf-8');
    } catch {
      // Tránh crash
    }
  }
}

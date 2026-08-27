import { contextBridge, ipcRenderer } from 'electron';
import { AdminAuthStatus, ApiInspectorEntry, CaptchaChallenge, DateRange, ScanProgressState, TaxFiling, TaxType } from '../shared/types';

const api = {
  // Auth
  getCaptcha: () => ipcRenderer.invoke('auth:getCaptcha'),
  solveCaptcha: (imageBase64: string) => ipcRenderer.invoke('auth:solveCaptcha', { imageBase64 }),
  login: (credentials: { taxCode: string; password: string; captcha: string }) =>
    ipcRenderer.invoke('auth:login', credentials),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getSession: () => ipcRenderer.invoke('auth:getSession'),
  checkSession: () => ipcRenderer.invoke('auth:checkSession'),

  // Scan
  startScan: (params: { year: number; taxType: TaxType; scope?: string; mstUyQuyen?: string; limitToToday?: boolean; customRange?: DateRange }) =>
    ipcRenderer.invoke('scan:start', params),
  submitCaptcha: (captcha: string) => ipcRenderer.invoke('scan:submitCaptcha', { captcha }),
  cancelScan: () => ipcRenderer.invoke('scan:cancel'),
  getFilingPreview: (filing: TaxFiling) => ipcRenderer.invoke('filing:getPreview', { filing }),

  // Download
  startDownload: (params: { filings: TaxFiling[]; taxCode?: string; year?: number }) =>
    ipcRenderer.invoke('download:start', params),
  pauseDownload: () => ipcRenderer.invoke('download:pause'),
  resumeDownload: () => ipcRenderer.invoke('download:resume'),
  cancelDownload: () => ipcRenderer.invoke('download:cancel'),
  getDownloadSummary: () => ipcRenderer.invoke('download:getSummary'),

  // Files & Export
  getBaseDir: () => ipcRenderer.invoke('file:getBaseDir'),
  selectDirectory: () => ipcRenderer.invoke('file:selectDirectory'),
  resetDirectory: () => ipcRenderer.invoke('file:resetDirectory'),
  setDirectory: (customPath: string) => ipcRenderer.invoke('file:setDirectory', { customPath }),
  openPath: (targetPath: string) => ipcRenderer.invoke('file:openPath', { targetPath }),
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', { url }),
  exportExcel: (params: { filings: TaxFiling[]; year: number }) =>
    ipcRenderer.invoke('file:exportExcel', params),

  // Phân hệ Phân Tích Chuyên Sâu GTGT (VAT Analytics)
  analyzeVat: (params: { filings: TaxFiling[] }) =>
    ipcRenderer.invoke('vat:analyze', params),
  cancelVatAnalytics: () =>
    ipcRenderer.invoke('vat:cancel'),
  exportVatReferenceExcel: (params: { summary: any; year: number }) =>
    ipcRenderer.invoke('vat:exportExcel', params),

  // Phân hệ Phân Tích Chuyên Sâu TNCN (PIT Analytics)
  analyzePit: (params: { filings: TaxFiling[] }) =>
    ipcRenderer.invoke('pit:analyze', params),
  cancelPitAnalytics: () =>
    ipcRenderer.invoke('pit:cancel'),
  exportPitReferenceExcel: (params: { summary: any; year: number }) =>
    ipcRenderer.invoke('pit:exportExcel', params),

  // Phân hệ Giấy Nộp Tiền (eTax)
  scanPaymentSlips: (params: { range: DateRange; options?: { maGiaoDich?: string; soGnt?: string; trangThai?: string; page?: number } }) =>
    ipcRenderer.invoke('paymentSlips:scan', params),
  openPaymentSlipsAuthWindow: () =>
    ipcRenderer.invoke('paymentSlips:openAuthWindow'),
  getPaymentSlipsDiagnostics: () =>
    ipcRenderer.invoke('paymentSlips:getDiagnostics'),
  getPaymentSlipDetail: (params: { ctuId: string; soGnt?: string; maGiaoDich?: string }) =>
    ipcRenderer.invoke('paymentSlips:getDetail', params),
  exportPaymentSlipsExcel: (params: { paymentSlips: any[]; year: number }) =>
    ipcRenderer.invoke('paymentSlips:exportExcel', params),
  exportPaymentSlipPdf: (params: { ctuId: string; soGnt?: string; maGiaoDich?: string; customFilename?: string }) =>
    ipcRenderer.invoke('paymentSlips:exportPdf', params),
    getPaymentSlipsStatistics: (params: { paymentSlips: any[] }) =>
      ipcRenderer.invoke('paymentSlips:statistics', params),
  exportPaymentSlipsStatsExcel: (params: { stats: any; year: number }) =>
    ipcRenderer.invoke('paymentSlips:exportStats', params),
  getGntCheckpoint: (params: { taxCode: string; year: number }) =>
    ipcRenderer.invoke('gntCheckpoint:get', params),
  saveGntCheckpoint: (params: { taxCode: string; year: number; paymentSlips: any[]; dateRange?: any }) =>
    ipcRenderer.invoke('gntCheckpoint:save', params),
  clearGntCheckpoint: (params: { taxCode: string; year: number }) =>
    ipcRenderer.invoke('gntCheckpoint:clear', params),

  // App info
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),

  // Checkpoint & Audit
  getCheckpoint: (params: { taxCode: string; year: number }) =>
    ipcRenderer.invoke('checkpoint:get', params),
  clearCheckpoint: (params: { taxCode: string; year: number }) =>
    ipcRenderer.invoke('checkpoint:clear', params),
  getAuditLogs: () => ipcRenderer.invoke('audit:getLogs'),

  // Licensing
  getLicenseStatus: () => ipcRenderer.invoke('license:getStatus'),
  activateLicense: (params: { licenseKey: string }) => ipcRenderer.invoke('license:activate', params),
  getMachineId: () => ipcRenderer.invoke('license:getMachineId'),

  // Saved Accounts & Quick Switch
  getSavedAccounts: () => ipcRenderer.invoke('accounts:getSaved'),
  saveAccount: (params: { taxCode: string; password?: string; companyName?: string; savePassword?: boolean }) =>
    ipcRenderer.invoke('accounts:save', params),
  getAccountCredentials: (params: { taxCode: string }) =>
    ipcRenderer.invoke('accounts:getCredentials', params),
  removeSavedAccount: (params: { taxCode: string }) =>
    ipcRenderer.invoke('accounts:remove', params),

  // Event Listeners
  onCaptchaRequired: (callback: (challenge: CaptchaChallenge) => void) => {
    const handler = (_: any, data: CaptchaChallenge) => callback(data);
    ipcRenderer.on('scan:captcha_required', handler);
    return () => ipcRenderer.removeListener('scan:captcha_required', handler);
  },
  onScanProgress: (callback: (state: ScanProgressState) => void) => {
    const handler = (_: any, data: ScanProgressState) => callback(data);
    ipcRenderer.on('scan:progress', handler);
    return () => ipcRenderer.removeListener('scan:progress', handler);
  },
  onDownloadProgress: (callback: (data: any) => void) => {
    const handler = (_: any, data: any) => callback(data);
    ipcRenderer.on('download:progress', handler);
    return () => ipcRenderer.removeListener('download:progress', handler);
  },
  onDownloadCompleted: (callback: (summary: any) => void) => {
    const handler = (_: any, data: any) => callback(data);
    ipcRenderer.on('download:completed', handler);
    return () => ipcRenderer.removeListener('download:completed', handler);
  },
  onSessionExpired: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('session:expired', handler);
    return () => ipcRenderer.removeListener('session:expired', handler);
  },
  onNewLog: (callback: (log: any) => void) => {
    const handler = (_: any, data: any) => callback(data);
    ipcRenderer.on('audit:new_log', handler);
    return () => ipcRenderer.removeListener('audit:new_log', handler);
  },
  onVatProgress: (callback: (data: { current: number; total: number; message: string }) => void) => {
    const handler = (_: any, data: any) => callback(data);
    ipcRenderer.on('vat:progress', handler);
    return () => ipcRenderer.removeListener('vat:progress', handler);
  },

  // Auto-Updater
  getUpdateStatus: () => ipcRenderer.invoke('updater:getStatus'),
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  onUpdateStatus: (callback: (info: any) => void) => {
    const handler = (_: any, data: any) => callback(data);
    ipcRenderer.on('updater:status', handler);
    return () => ipcRenderer.removeListener('updater:status', handler);
  },

  // API Inspector (Admin / Developer Diagnostics)
  inspectorGetEntries: (): Promise<ApiInspectorEntry[]> => ipcRenderer.invoke('inspector:getEntries'),
  inspectorClear: (): Promise<{ success: boolean }> => ipcRenderer.invoke('inspector:clear'),
  inspectorExport: (): Promise<string> => ipcRenderer.invoke('inspector:export'),
  inspectorVerifyAdminPin: (pin: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('inspector:verifyAdminPin', { pin }),
  inspectorGetAdminStatus: (): Promise<AdminAuthStatus> => ipcRenderer.invoke('inspector:getAdminStatus'),
  onInspectorNewEntry: (callback: (entry: ApiInspectorEntry) => void) => {
    const handler = (_: any, data: ApiInspectorEntry) => callback(data);
    ipcRenderer.on('inspector:new_entry', handler);
    return () => ipcRenderer.removeListener('inspector:new_entry', handler);
  },
  onInspectorEntryUpdated: (callback: (entry: ApiInspectorEntry) => void) => {
    const handler = (_: any, data: ApiInspectorEntry) => callback(data);
    ipcRenderer.on('inspector:entry_updated', handler);
    return () => ipcRenderer.removeListener('inspector:entry_updated', handler);
  },
  onInspectorCleared: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('inspector:cleared', handler);
    return () => ipcRenderer.removeListener('inspector:cleared', handler);
  }
};

contextBridge.exposeInMainWorld('taxPortalAPI', api);

export type TaxPortalAPI = typeof api;

import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { generateVietQrEmvCoPayload } from '../../shared/vietqr';
import {
  ArrowLeft,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  KeyRound,
  Laptop,
  PhoneCall,
  QrCode,
  RotateCw,
  ShieldCheck,
  Sparkles,
  UserCheck,
  X
} from 'lucide-react';

interface LicenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMachineId?: string;
  onActivated?: () => void;
}

export type PricingTier = 'PERSONAL_1Y' | 'PRO_1Y' | 'LIFETIME';

export interface LicenseStatusState {
  isTrial: boolean;
  daysRemaining?: number;
  isActivated: boolean;
  tier?: string;
  tierLabel?: string;
  customerName?: string;
  expiryDate?: string;
  activationDate?: string;
  machineId?: string;
}

export const LicenseModal: React.FC<LicenseModalProps> = ({
  isOpen,
  onClose,
  initialMachineId = '',
  onActivated
}) => {
  const [machineId, setMachineId] = useState(initialMachineId);
  const [copiedMachineId, setCopiedMachineId] = useState(false);
  const [copiedStk, setCopiedStk] = useState(false);
  const [copiedContent, setCopiedContent] = useState(false);
  const [copiedAmount, setCopiedAmount] = useState(false);
  const [selectedTier, setSelectedTier] = useState<PricingTier>('PERSONAL_1Y');
  const [licenseKeyInput, setLicenseKeyInput] = useState('');
  const [isActivating, setIsActivating] = useState(false);
  const [activationError, setActivationError] = useState<string | null>(null);
  const [activationSuccess, setActivationSuccess] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('');
  const [showUpgradeForm, setShowUpgradeForm] = useState(false);
  const [licenseInfo, setLicenseInfo] = useState<LicenseStatusState | null>(null);

  const fetchLicenseData = () => {
    if (window.taxPortalAPI) {
      window.taxPortalAPI.getMachineId().then(id => {
        if (id) setMachineId(id);
      });
      window.taxPortalAPI.getLicenseStatus().then(status => {
        setLicenseInfo({
          isTrial: status.isTrial,
          daysRemaining: status.daysRemaining,
          isActivated: status.isActivated,
          tier: status.tier,
          tierLabel: status.tierLabel,
          customerName: status.customerName,
          expiryDate: status.expiryDate,
          activationDate: status.activationDate,
          machineId: status.machineId
        });
      });
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchLicenseData();
      setActivationError(null);
      setActivationSuccess(false);
      setShowUpgradeForm(false);
    }
  }, [isOpen]);

  const tiersConfig: Record<PricingTier, { title: string; price: number; priceStr: string; note: string; tag?: string }> = {
    PERSONAL_1Y: {
      title: 'Gói Cá Nhân (1 Năm)',
      price: 490000,
      priceStr: '490.000 đ',
      note: 'Dành cho 1 máy tính cá nhân · Không giới hạn MST tải',
      tag: 'Phổ biến nhất'
    },
    PRO_1Y: {
      title: 'Gói Dịch Vụ / Đại Lý (1 Năm)',
      price: 890000,
      priceStr: '890.000 đ',
      note: 'Dành cho 2 máy tính · Ưu tiên hỗ trợ Ultraview 1:1',
      tag: 'Tiết kiệm 50%'
    },
    LIFETIME: {
      title: 'Gói Vĩnh Viễn (Lifetime)',
      price: 1290000,
      priceStr: '1.290.000 đ',
      note: 'Sử dụng trọn đời · Miễn phí mọi bản cập nhật v2.x',
      tag: 'Trọn đời VIP'
    }
  };

  const currentTier = tiersConfig[selectedTier];
  const cleanMachineId = machineId || licenseInfo?.machineId || 'TR-XXXX-XXXX-XXXX';
  const qrTransferContent = `TR ${cleanMachineId.replace('TR-', '').replace(/-/g, '')}`;

  // Chuẩn VietQR API Image URL (MB Bank 0817567008 - NGUYEN DAC THINH)
  const vietQrImageUrl = `https://img.vietqr.io/image/MB-0817567008-compact2.png?amount=${currentTier.price}&addInfo=${encodeURIComponent(qrTransferContent)}&accountName=NGUYEN%20DAC%20THINH`;

  // Sinh mã QR chuẩn EMVCo Napas 247 để mọi app ngân hàng (MB, VCB, Techcombank, VPBank, MoMo...) quét được ngay cả khi Offline
  useEffect(() => {
    const emvcoPayload = generateVietQrEmvCoPayload({
      bankBin: '970422', // MB Bank BIN
      accountNo: '0817567008',
      accountName: 'NGUYEN DAC THINH',
      amount: currentTier.price,
      memo: qrTransferContent
    });

    QRCode.toDataURL(emvcoPayload, {
      width: 260,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    })
      .then(url => setQrCodeDataUrl(url))
      .catch(() => {
        setQrCodeDataUrl('');
      });
  }, [currentTier.price, qrTransferContent]);

  if (!isOpen) return null;

  const handleCopyMachineId = () => {
    navigator.clipboard.writeText(cleanMachineId);
    setCopiedMachineId(true);
    setTimeout(() => setCopiedMachineId(false), 2000);
  };

  const handleCopyStk = () => {
    navigator.clipboard.writeText('0817567008');
    setCopiedStk(true);
    setTimeout(() => setCopiedStk(false), 2000);
  };

  const handleActivate = async () => {
    if (!licenseKeyInput.trim()) {
      setActivationError('Vui lòng dán mã kích hoạt được cấp vào ô bên dưới.');
      return;
    }

    setIsActivating(true);
    setActivationError(null);

    if (window.taxPortalAPI) {
      try {
        const res = await window.taxPortalAPI.activateLicense({ licenseKey: licenseKeyInput.trim() });
        if (res.success) {
          setActivationSuccess(true);
          fetchLicenseData();
          if (onActivated) onActivated();
        } else {
          setActivationError(res.error || 'Kích hoạt thất bại. Vui lòng kiểm tra lại mã.');
        }
      } catch (err: any) {
        setActivationError(`Lỗi kích hoạt: ${err.message}`);
      } finally {
        setIsActivating(false);
      }
    } else {
      setIsActivating(false);
      setActivationSuccess(true);
    }
  };

  const isAlreadyActivatedPro = Boolean(licenseInfo?.isActivated && !licenseInfo?.isTrial);

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn select-none">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[94vh] flex flex-col overflow-hidden">
        
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-teal-500/20 border border-teal-400/30 flex items-center justify-center text-teal-400 shadow-xs">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-base text-white tracking-wide">
                  {isAlreadyActivatedPro ? 'THÔNG TIN BẢN QUYỀN TAXINSIGHT' : 'BẢN QUYỀN TAXRECORD 2.0'}
                </h3>
                <span className={`px-2 py-0.5 rounded text-[10.5px] font-semibold ${
                  isAlreadyActivatedPro 
                    ? 'bg-emerald-900/80 text-emerald-300 border border-emerald-700/60' 
                    : 'bg-teal-900/80 text-teal-300 border border-teal-700/60'
                }`}>
                  {isAlreadyActivatedPro ? 'ĐÃ KÍCH HOẠT' : 'CHÍNH THỨC'}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                {isAlreadyActivatedPro
                  ? 'Thiết bị này đã được cấp quyền sử dụng đầy đủ toàn bộ tính năng chuyên nghiệp'
                  : 'Mở khóa không giới hạn toàn bộ tính năng quét, tải tự động, Working Paper GTGT & Tra cứu GNT'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* TRƯỜNG HỢP 1: ĐÃ KÍCH HOẠT THÀNH CÔNG (Success Screen) */}
          {activationSuccess ? (
            <div className="text-center py-8 space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto shadow-xs">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <div>
                <h4 className="text-xl font-bold text-slate-900">KÍCH HOẠT BẢN QUYỀN THÀNH CÔNG!</h4>
                <p className="text-sm text-slate-600 mt-1 max-w-md mx-auto">
                  Cảm ơn bạn đã tin tưởng sử dụng TaxInsight. Bản quyền đã được kích hoạt hoàn tất trên thiết bị này.
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2.5 bg-teal-700 hover:bg-teal-800 text-white font-semibold rounded-xl text-sm transition-colors cursor-pointer shadow-xs"
              >
                Bắt đầu sử dụng ngay
              </button>
            </div>
          ) : isAlreadyActivatedPro && !showUpgradeForm ? (
            /* TRƯỜNG HỢP 2: BẢN QUYỀN ĐÃ HOẠT ĐỘNG (Active Pro Information Card) */
            <div className="space-y-5">
              {/* Thẻ trạng thái VIP */}
              <div className="p-5 bg-gradient-to-br from-teal-950 via-slate-900 to-slate-900 rounded-2xl border border-teal-800/60 text-white shadow-lg space-y-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 rounded-xl bg-teal-500/20 border border-teal-400/40 flex items-center justify-center text-teal-400 shadow-xs">
                      <Sparkles className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="text-base font-bold text-teal-200">{licenseInfo?.tierLabel || 'Gói Vĩnh Viễn (Lifetime VIP)'}</span>
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                          ● ĐANG HOẠT ĐỘNG
                        </span>
                      </div>
                      <div className="text-xs text-slate-300 mt-0.5 flex items-center space-x-1.5">
                        <UserCheck className="w-3.5 h-3.5 text-teal-400" />
                        <span>Chủ sở hữu: <strong>{licenseInfo?.customerName || 'Chủ Sở Hữu / Doanh Nghiệp'}</strong></span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[11px] text-slate-400 block uppercase tracking-wider">Hạn sử dụng</span>
                    <span className="text-sm font-bold text-amber-300">{licenseInfo?.expiryDate || 'Vĩnh viễn'}</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3 border-t border-slate-800 text-xs">
                  <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 space-y-1">
                    <div className="text-slate-400 text-[11px] flex items-center justify-between">
                      <span>Mã máy tính (Machine ID):</span>
                      <button
                        type="button"
                        onClick={handleCopyMachineId}
                        className="text-teal-400 hover:text-teal-300 cursor-pointer flex items-center space-x-1"
                      >
                        {copiedMachineId ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedMachineId ? 'Đã sao chép' : 'Sao chép'}</span>
                      </button>
                    </div>
                    <div className="font-mono font-bold text-teal-300 text-[12px]">{cleanMachineId}</div>
                  </div>

                  <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 space-y-1">
                    <div className="text-slate-400 text-[11px]">Ngày kích hoạt:</div>
                    <div className="font-sans font-semibold text-slate-200 text-[12px]">
                      {licenseInfo?.activationDate || '21/08/2026'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Danh sách đặc quyền đã kích hoạt */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2.5">
                <div className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  ĐẶC QUYỀN ĐÃ ĐƯỢC MỞ KHÓA TRÊN THIẾT BỊ NÀY:
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-700">
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Không giới hạn số lượng Mã số thuế tra cứu</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Tự động quét & tải trọn bộ XML, PDF tờ khai</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Soát xét Working Paper GTGT & Bảng đối chiếu 3 Sheet</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Phân tích quyết toán thuế TNCN (05/KK, 05/QTT)</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Bảng kê nghĩa vụ thuế & đối chiếu giấy nộp tiền</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Cập nhật miễn phí mọi phiên bản v2.x</span>
                  </div>
                </div>
              </div>

              {/* Tùy chọn đổi key / nâng cấp gói */}
              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setShowUpgradeForm(true)}
                  className="text-xs text-slate-500 hover:text-teal-700 font-semibold flex items-center space-x-1.5 cursor-pointer"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  <span>Đổi mã kích hoạt khác hoặc nâng cấp gói bản quyền →</span>
                </button>
                <div className="text-[11.5px] text-slate-500 flex items-center space-x-1">
                  <PhoneCall className="w-3.5 h-3.5 text-teal-700" />
                  <span>Hotline / Zalo: <strong>0817567008</strong></span>
                </div>
              </div>
            </div>
          ) : (
            /* TRƯỜNG HỢP 3: CHƯA KÍCH HOẠT / DÙNG THỬ / HOẶC BẤM ĐỔI KEY */
            <>
              {/* Nút quay lại nếu đang ở chế độ đổi key */}
              {isAlreadyActivatedPro && showUpgradeForm && (
                <div className="flex items-center justify-between pb-1 border-b border-slate-200">
                  <button
                    type="button"
                    onClick={() => setShowUpgradeForm(false)}
                    className="text-xs font-semibold text-teal-700 hover:text-teal-900 flex items-center space-x-1.5 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span>Quay lại thông tin bản quyền hiện tại</span>
                  </button>
                  <span className="text-xs text-slate-500 font-medium">Thay đổi mã kích hoạt</span>
                </div>
              )}

              {/* Banner dùng thử nếu có */}
              {licenseInfo?.isTrial && (
                <div className="p-3 bg-slate-50 border border-teal-200 rounded-xl flex items-center justify-between shadow-2xs">
                  <div className="flex items-center space-x-2.5">
                    <div className="w-8 h-8 rounded-lg bg-teal-700 text-white flex items-center justify-center shadow-xs shrink-0">
                      <Clock className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="font-bold text-teal-950 text-[13px] flex items-center space-x-1.5">
                        <span>Bạn đang được dùng thử 7 ngày đầy đủ toàn bộ tính năng</span>
                      </div>
                      <div className="text-[11.5px] text-teal-800 flex items-center space-x-1 mt-0.5">
                        <span>Thời hạn còn lại: <strong>{licenseInfo.daysRemaining ?? 7} ngày</strong> (Không giới hạn tra cứu, đối chiếu và tải hồ sơ).</span>
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-3.5 py-1.5 bg-white hover:bg-teal-50 text-teal-800 border border-teal-300 rounded-lg text-xs font-semibold shadow-2xs transition-colors cursor-pointer shrink-0 ml-3"
                  >
                    Tiếp tục dùng thử →
                  </button>
                </div>
              )}

              {/* Bước 1: Mã Máy Tính */}
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center space-x-1.5">
                    <Laptop className="w-4 h-4 text-teal-700" />
                    <span>MÃ MÁY TÍNH CỦA BẠN (MACHINE ID):</span>
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyMachineId}
                    className="text-xs font-semibold text-teal-700 hover:text-teal-900 flex items-center space-x-1 cursor-pointer"
                  >
                    {copiedMachineId ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="text-emerald-600">Đã sao chép</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Sao chép mã</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="font-mono font-bold text-base text-slate-900 bg-white px-3.5 py-2 rounded-lg border border-slate-300 tracking-wider flex items-center justify-between">
                  <span>{cleanMachineId}</span>
                </div>
              </div>

              {/* Bước 2: Chọn Gói Kích Hoạt */}
              <div className="space-y-2.5">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                  CHỌN GÓI BẢN QUYỀN:
                </label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {(Object.keys(tiersConfig) as PricingTier[]).map(tierKey => {
                    const t = tiersConfig[tierKey];
                    const isSelected = selectedTier === tierKey;
                    return (
                      <div
                        key={tierKey}
                        onClick={() => setSelectedTier(tierKey)}
                        className={`p-3.5 rounded-xl border-2 transition-all cursor-pointer relative flex flex-col justify-between ${
                          isSelected
                            ? 'border-teal-600 bg-teal-50/40 shadow-xs'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        {t.tag && (
                          <span className={`absolute -top-2.5 right-3 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            isSelected ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600 border border-slate-200'
                          }`}>
                            {t.tag}
                          </span>
                        )}
                        <div>
                          <div className="font-bold text-slate-900 text-[13.5px]">{t.title}</div>
                          <div className="text-lg font-bold font-mono text-teal-800 mt-1">{t.priceStr}</div>
                          <div className="text-[11.5px] text-slate-500 mt-1 leading-snug">{t.note}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Bước 3: Thanh toán qua VietQR & Nhận key */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-5 bg-slate-50 p-4 rounded-xl border border-slate-200">
                {/* QR Code Napas 247 VietQR */}
                <div className="md:col-span-5 flex flex-col items-center justify-center p-3 bg-white rounded-xl border border-slate-200 shadow-2xs">
                  <img
                    src={vietQrImageUrl}
                    onError={(e) => {
                      if (qrCodeDataUrl) {
                        e.currentTarget.src = qrCodeDataUrl;
                      }
                    }}
                    alt="VietQR MB Bank - NGUYEN DAC THINH"
                    className="w-full max-w-[200px] h-auto object-contain rounded-lg shadow-2xs"
                  />
                  <span className="text-[11px] text-teal-800 mt-2 font-medium text-center flex items-center justify-center space-x-1">
                    <span>Quét bằng app MB Bank hoặc mọi ứng dụng ngân hàng</span>
                  </span>
                </div>

                {/* Thông tin chuyển khoản */}
                <div className="md:col-span-7 space-y-2 text-xs text-slate-700 flex flex-col justify-center">
                  <div className="flex justify-between py-1 border-b border-slate-200">
                    <span className="text-slate-500">Ngân hàng:</span>
                    <span className="font-bold text-slate-900">MB Bank (Ngân hàng Quân Đội)</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-200">
                    <span className="text-slate-500">Số tài khoản:</span>
                    <div className="flex items-center space-x-1.5">
                      <span className="font-mono font-bold text-teal-900 text-[13.5px]">0817567008</span>
                      <button
                        type="button"
                        onClick={handleCopyStk}
                        className="text-teal-700 hover:text-teal-900 cursor-pointer p-0.5"
                        title="Sao chép STK"
                      >
                        {copiedStk ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-200">
                    <span className="text-slate-500">Chủ tài khoản:</span>
                    <span className="font-bold text-slate-900 uppercase">NGUYEN DAC THINH</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-200">
                    <span className="text-slate-500">Số tiền:</span>
                    <div className="flex items-center space-x-1.5">
                      <span className="font-mono font-bold text-emerald-800 text-[13.5px]">{currentTier.priceStr}</span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(String(currentTier.price));
                          setCopiedAmount(true);
                          setTimeout(() => setCopiedAmount(false), 2000);
                        }}
                        className="text-teal-700 hover:text-teal-900 cursor-pointer p-0.5"
                        title="Sao chép số tiền"
                      >
                        {copiedAmount ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-200">
                    <span className="text-slate-500">Nội dung CK:</span>
                    <div className="flex items-center space-x-1.5">
                      <span className="font-mono font-bold text-slate-900 bg-amber-50 text-amber-900 px-1.5 py-0.5 rounded border border-amber-200 select-all">
                        {qrTransferContent}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(qrTransferContent);
                          setCopiedContent(true);
                          setTimeout(() => setCopiedContent(false), 2000);
                        }}
                        className="text-teal-700 hover:text-teal-900 cursor-pointer p-0.5"
                        title="Sao chép nội dung chuyển khoản"
                      >
                        {copiedContent ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                  <div className="pt-1 flex items-center space-x-1.5 text-[11.5px] text-teal-800">
                    <PhoneCall className="w-3.5 h-3.5 text-teal-700 shrink-0" />
                    <span>Zalo nhận key tự động: <strong>0817567008</strong> (Thịnh)</span>
                  </div>
                </div>
              </div>

              {/* Bước 4: Nhập mã kích hoạt */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center space-x-1.5">
                  <KeyRound className="w-4 h-4 text-teal-700" />
                  <span>NHẬP MÃ KÍCH HOẠT ĐƯỢC CẤP (LICENSE KEY):</span>
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={licenseKeyInput}
                    onChange={e => setLicenseKeyInput(e.target.value)}
                    placeholder="Dán chuỗi mã kích hoạt Base64 vào đây…"
                    className="flex-1 h-10 px-3.5 bg-white border border-slate-300 rounded-xl font-mono text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                  <button
                    type="button"
                    onClick={handleActivate}
                    disabled={isActivating || !licenseKeyInput.trim()}
                    className="h-10 px-5 bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white font-semibold rounded-xl text-xs flex items-center space-x-1.5 transition-colors disabled:opacity-50 cursor-pointer shadow-xs shrink-0"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    <span>{isActivating ? 'Đang kích hoạt…' : 'Kích hoạt ngay'}</span>
                  </button>
                </div>
                {activationError && (
                  <p className="text-xs text-red-600 font-medium">{activationError}</p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <div className="flex items-center space-x-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Cam kết hỗ trợ kỹ thuật và đồng hành suốt thời gian sử dụng.</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-medium rounded-lg transition-colors cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};

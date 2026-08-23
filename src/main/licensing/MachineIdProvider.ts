import { execSync } from 'child_process';
import crypto from 'crypto';
import os from 'os';

export class MachineIdProvider {
  private static cachedMachineId: string | null = null;
  private static cachedLegacyMachineId: string | null = null;

  /**
   * Lấy Windows MachineGuid cố định từ Registry HKLM (Bất biến 100% qua mọi phiên bản và kết nối mạng)
   */
  private static getWindowsMachineGuid(): string | null {
    if (process.platform !== 'win32') {
      return null;
    }
    try {
      const output = execSync('reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', {
        encoding: 'utf-8',
        windowsHide: true,
        timeout: 3000,
        stdio: ['ignore', 'pipe', 'ignore']
      });
      const match = output.match(/MachineGuid\s+REG_SZ\s+([a-zA-Z0-9\-]+)/i);
      return match ? match[1].trim() : null;
    } catch {
      return null;
    }
  }

  /**
   * Lấy Machine ID duy nhất, cố định vĩnh viễn của máy tính (Dựa trên Windows MachineGuid / CPU / Arch)
   * Định dạng chuẩn: TR-XXXX-XXXX-XXXX-XXXX
   */
  public static getMachineId(): string {
    if (this.cachedMachineId) {
      return this.cachedMachineId;
    }

    try {
      const winGuid = this.getWindowsMachineGuid();
      let rawHardwareString = '';

      if (winGuid) {
        // Windows: MachineGuid là định danh phần cứng duy nhất của hệ điều hành, không đổi theo mạng/VPN/update
        rawHardwareString = `WINDOWS_STABLE|${winGuid}|${os.arch()}`;
      } else {
        // Fallback macOS / Linux hoặc khi không đọc được Registry
        const cpus = os.cpus();
        const cpuModel = cpus.length > 0 ? cpus[0].model : 'UNKNOWN_CPU';
        const hostname = os.hostname();
        rawHardwareString = `GENERIC_STABLE|${hostname}|${cpuModel}|${os.arch()}|${os.platform()}`;
      }

      const hash = crypto.createHash('sha256').update(rawHardwareString).digest('hex').toUpperCase();

      const part1 = hash.substring(0, 4);
      const part2 = hash.substring(4, 8);
      const part3 = hash.substring(8, 12);
      const part4 = hash.substring(12, 16);

      this.cachedMachineId = `TR-${part1}-${part2}-${part3}-${part4}`;
      return this.cachedMachineId;
    } catch {
      // Fallback an toàn nếu có lỗi
      const fallbackHash = crypto.createHash('md5').update(os.hostname() || 'TAXRECORD_PC').digest('hex').toUpperCase();
      this.cachedMachineId = `TR-${fallbackHash.substring(0, 4)}-${fallbackHash.substring(4, 8)}-${fallbackHash.substring(8, 12)}-${fallbackHash.substring(12, 16)}`;
      return this.cachedMachineId;
    }
  }

  /**
   * Thuật toán mã máy cũ (dựa trên MAC address) - Dùng để tương thích ngược cho khách hàng đã cấp key cũ
   */
  public static getLegacyMachineId(): string {
    if (this.cachedLegacyMachineId) {
      return this.cachedLegacyMachineId;
    }

    // Biến thể "đầy đủ" luôn là candidate chính
    const full = this.computeLegacyMachineId(this.getLegacyHardwareInputs());
    this.cachedLegacyMachineId = full;
    return full;
  }

  private static getLegacyHardwareInputs(): {
    hostname: string;
    cpuModel: string;
    macs: string[];
  } {
    const cpus = os.cpus();
    const cpuModel = cpus.length > 0 ? cpus[0].model : 'UNKNOWN_CPU';
    const hostname = os.hostname();
    const networkInterfaces = os.networkInterfaces();

    const macs: string[] = [];
    for (const name of Object.keys(networkInterfaces)) {
      const iface = networkInterfaces[name];
      if (iface) {
        for (const net of iface) {
          if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
            macs.push(net.mac);
          }
        }
      }
    }
    macs.sort();
    return { hostname, cpuModel, macs };
  }

  private static computeLegacyMachineId(inputs: {
    hostname: string;
    cpuModel: string;
    macs: string[];
  }): string {
    try {
      const rawHardwareString = `${inputs.hostname}|${inputs.cpuModel}|${inputs.macs.join(',')}|${os.arch()}|${os.platform()}`;
      const hash = crypto.createHash('sha256').update(rawHardwareString).digest('hex').toUpperCase();
      return `TR-${hash.substring(0, 4)}-${hash.substring(4, 8)}-${hash.substring(8, 12)}-${hash.substring(12, 16)}`;
    } catch {
      const fallbackHash = crypto.createHash('md5').update(os.hostname() || 'TAXRECORD_PC').digest('hex').toUpperCase();
      return `TR-${fallbackHash.substring(0, 4)}-${fallbackHash.substring(4, 8)}-${fallbackHash.substring(8, 12)}-${fallbackHash.substring(12, 16)}`;
    }
  }

  /**
   * Các biến thể Legacy ID có thể khớp với key đã cấp trước đây.
   * Trước đây chỉ tính MỘT hash từ snapshot mạng hiện tại: khách cắm USB dock /
   * bật VPN / tắt Wi-Fi là danh sách MAC đổi -> key HỢP LỆ bị từ chối oan.
   * Candidate set bao phủ các tổ hợp ổn định nhất mà key cũ thường được cấp.
   */
  public static getLegacyMachineIdCandidates(): string[] {
    if (this.cachedLegacyCandidates) {
      return this.cachedLegacyCandidates;
    }

    const candidates: string[] = [];
    try {
      const inputs = this.getLegacyHardwareInputs();

      // 1. Đầy đủ (giống getLegacyMachineId)
      candidates.push(this.computeLegacyMachineId(inputs));

      // 2. Không có MAC nào (khách cấp key khi mọi NIC đang tắt/mất kết nối)
      candidates.push(this.computeLegacyMachineId({ ...inputs, macs: [] }));

      // 3. Từng MAC đơn lẻ (key được cấp lúc chỉ còn 1 NIC hoạt động)
      for (const mac of inputs.macs) {
        candidates.push(this.computeLegacyMachineId({ ...inputs, macs: [mac] }));
      }

      // 4. Không hostname (khách đổi tên máy sau khi được cấp key)
      candidates.push(this.computeLegacyMachineId({ ...inputs, hostname: '' }));
      if (inputs.macs.length > 0) {
        candidates.push(this.computeLegacyMachineId({ ...inputs, hostname: '', macs: [inputs.macs[0]] }));
      }
    } catch {
      // Bỏ qua — trả về ít nhất biến thể đầy đủ
    }

    this.cachedLegacyCandidates = Array.from(new Set(candidates)).filter(Boolean);
    return this.cachedLegacyCandidates;
  }
  private static cachedLegacyCandidates: string[] | null = null;
}


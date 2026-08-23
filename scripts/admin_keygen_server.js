const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { exec } = require('child_process');

const PORT = 3333;
const SECRET_SIGN_KEY = 'TR_2026_MASTER_SECRET_KEY_TAXRECORD_VIETNAM_SECURE_AUTH';
const DATA_DIR = path.join(__dirname, '../data');
const DB_FILE = path.join(DATA_DIR, 'customers_db.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2), 'utf-8');
}

// 1. Tính toán Machine ID cho máy hiện tại (Khớp 100% với MachineIdProvider)
function getWindowsMachineGuid() {
  if (process.platform !== 'win32') return null;
  try {
    const { execSync } = require('child_process');
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

function getCurrentMachineId() {
  try {
    const winGuid = getWindowsMachineGuid();
    let rawHardwareString = '';

    if (winGuid) {
      rawHardwareString = `WINDOWS_STABLE|${winGuid}|${os.arch()}`;
    } else {
      const cpus = os.cpus();
      const cpuModel = cpus.length > 0 ? cpus[0].model : 'UNKNOWN_CPU';
      const hostname = os.hostname();
      rawHardwareString = `GENERIC_STABLE|${hostname}|${cpuModel}|${os.arch()}|${os.platform()}`;
    }

    const hash = crypto.createHash('sha256').update(rawHardwareString).digest('hex').toUpperCase();
    return `TR-${hash.substring(0, 4)}-${hash.substring(4, 8)}-${hash.substring(8, 12)}-${hash.substring(12, 16)}`;
  } catch {
    const fallbackHash = crypto.createHash('md5').update(os.hostname() || 'TAXRECORD_PC').digest('hex').toUpperCase();
    return `TR-${fallbackHash.substring(0, 4)}-${fallbackHash.substring(4, 8)}-${fallbackHash.substring(8, 12)}-${fallbackHash.substring(12, 16)}`;
  }
}

// 2. Ký và tạo License Key
function signPayload(payload) {
  const dataToSign = `${payload.machineId.toUpperCase()}|${payload.customerName.trim()}|${payload.tier}|${payload.expiryDate}|${payload.issuedAt}`;
  return crypto.createHmac('sha256', SECRET_SIGN_KEY).update(dataToSign).digest('hex').toUpperCase();
}

function generateLicenseKey(payload) {
  const signature = signPayload(payload);
  const fullPayload = { ...payload, signature };
  return Buffer.from(JSON.stringify(fullPayload), 'utf-8').toString('base64');
}

// 3. Kích hoạt trực tiếp máy hiện tại
function activateCurrentMachine(customerName = 'Admin / Chủ sở hữu', tier = 'LIFETIME') {
  const machineId = getCurrentMachineId();
  const payload = {
    machineId,
    customerName,
    tier,
    expiryDate: '2099-12-31',
    issuedAt: new Date().toISOString()
  };
  const key = generateLicenseKey(payload);

  const licenseData = {
    key: key.trim(),
    activatedAt: new Date().toISOString(),
    payload
  };

  const cipher = crypto.createCipheriv(
    'aes-256-cbc',
    crypto.createHash('sha256').update(SECRET_SIGN_KEY).digest(),
    Buffer.alloc(16, 0)
  );
  let encrypted = cipher.update(JSON.stringify(licenseData), 'utf-8', 'hex');
  encrypted += cipher.final('hex');

  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  const targetDirs = [
    path.join(appData, 'TaxInsight'),
    path.join(appData, 'tax-insight'),
    path.join(appData, 'tax-record'),
    path.join(appData, 'tax-record-downloader')
  ];

  let successCount = 0;
  for (const dir of targetDirs) {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, '.taxrecord_license.dat'), encrypted, 'utf-8');
      successCount++;
    } catch {}
  }

  return { success: successCount > 0, machineId, key, payload };
}

// 4. Quản lý Database Khách Hàng
function getCustomers() {
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveCustomers(customers) {
  fs.writeFileSync(DB_FILE, JSON.stringify(customers, null, 2), 'utf-8');
  // Đồng bộ ra file CSV để mở bằng Excel
  try {
    const csvHeader = 'ID,Ten Khach Hang,So Dien Thoai,Ma May (Machine ID),Goi Ban Quyen,Han Su Dung,Ngay Cap,Gia Tien,Ghi Chu,License Key\n';
    const csvRows = customers.map(c => {
      const sanitize = (s = '') => `"${String(s).replace(/"/g, '""')}"`;
      return [
        sanitize(c.id),
        sanitize(c.customerName),
        sanitize(c.phone),
        sanitize(c.machineId),
        sanitize(c.tier),
        sanitize(c.expiryDate),
        sanitize(c.issuedAt?.split('T')[0]),
        sanitize(c.price || 0),
        sanitize(c.notes),
        sanitize(c.licenseKey)
      ].join(',');
    }).join('\n');
    fs.writeFileSync(path.join(DATA_DIR, 'danh_sach_khach_hang.csv'), '\uFEFF' + csvHeader + csvRows, 'utf-8');
  } catch {}
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  // API Endpoints
  if (req.method === 'GET' && url.pathname === '/api/info') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({
      currentMachineId: getCurrentMachineId(),
      customers: getCustomers()
    }));
  }

  if (req.method === 'POST' && url.pathname === '/api/self-activate') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const data = body ? JSON.parse(body) : {};
      const result = activateCurrentMachine(data.customerName || 'Admin TaxInsight', 'LIFETIME');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(result));
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/create-license') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (!data.machineId || !data.customerName) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Mã máy và Tên khách hàng là bắt buộc' }));
        }

        let expiryDate = '2099-12-31';
        if (data.tier !== 'LIFETIME') {
          if (data.expiryDate) {
            expiryDate = data.expiryDate;
          } else {
            const d = new Date();
            d.setFullYear(d.getFullYear() + 1);
            expiryDate = d.toISOString().split('T')[0];
          }
        }

        const payload = {
          machineId: data.machineId.trim().toUpperCase(),
          customerName: data.customerName.trim(),
          tier: data.tier || 'PRO_1Y',
          expiryDate: expiryDate,
          issuedAt: new Date().toISOString()
        };

        const licenseKey = generateLicenseKey(payload);

        const newCustomer = {
          id: 'CUST_' + Date.now(),
          customerName: payload.customerName,
          phone: data.phone || '',
          email: data.email || '',
          machineId: payload.machineId,
          tier: payload.tier,
          expiryDate: payload.expiryDate,
          issuedAt: payload.issuedAt,
          price: data.price || 0,
          notes: data.notes || '',
          licenseKey: licenseKey
        };

        const customers = getCustomers();
        customers.unshift(newCustomer);
        saveCustomers(customers);

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ success: true, customer: newCustomer, licenseKey }));
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/delete-customer') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const { id } = JSON.parse(body);
      let customers = getCustomers();
      customers = customers.filter(c => c.id !== id);
      saveCustomers(customers);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  // HTML Dashboard
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TaxInsight – Trung Tâm Quản Lý Khách Hàng & Phát Hành Bản Quyền</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
    body { font-family: 'Plus Jakarta Sans', sans-serif; }
  </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen">
  <!-- Top Navigation Bar -->
  <header class="bg-slate-900/80 backdrop-blur border-b border-slate-800 sticky top-0 z-50">
    <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
      <div class="flex items-center space-x-3">
        <div class="w-10 h-10 bg-gradient-to-br from-teal-400 to-emerald-600 rounded-xl flex items-center justify-center text-slate-950 font-black text-xl shadow-lg shadow-teal-500/20">
          🔑
        </div>
        <div>
          <div class="flex items-center space-x-2">
            <h1 class="text-base font-bold text-white tracking-wide">TaxInsight Manager</h1>
            <span class="text-[10px] uppercase font-bold bg-teal-500/20 text-teal-400 border border-teal-500/30 px-2 py-0.5 rounded-full">v2.0 Pro</span>
          </div>
          <p class="text-xs text-slate-400">Hệ thống phát hành Key & Quản trị Danh sách Khách hàng</p>
        </div>
      </div>

      <div class="flex items-center space-x-3">
        <button onclick="selfActivate()" class="bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 text-slate-950 font-bold px-4 py-2 rounded-xl text-xs shadow-lg shadow-teal-500/20 transition-all flex items-center space-x-1.5 active:scale-95">
          <i class="fa-solid fa-bolt"></i>
          <span>Kích hoạt Vĩnh viễn Máy này</span>
        </button>
      </div>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
    <!-- Metric Cards Ribbon -->
    <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
      <div class="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-slate-400 uppercase">Mã máy hiện tại</span>
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        </div>
        <div id="currentPcId" class="mt-2 text-sm font-mono font-bold text-teal-400 select-all cursor-pointer" onclick="copyText(this.innerText)">Đang nạp...</div>
        <div class="mt-1 text-[11px] text-slate-500">Nhấp để sao chép Machine ID</div>
      </div>

      <div class="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
        <span class="text-xs font-semibold text-slate-400 uppercase">Tổng khách hàng</span>
        <div id="totalCustCount" class="mt-2 text-2xl font-bold text-white">0</div>
        <div class="mt-1 text-[11px] text-emerald-400"><i class="fa-solid fa-users"></i> Đã lưu trong hệ thống</div>
      </div>

      <div class="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
        <span class="text-xs font-semibold text-slate-400 uppercase">Gói Vĩnh Viễn (Lifetime)</span>
        <div id="lifetimeCount" class="mt-2 text-2xl font-bold text-amber-400">0</div>
        <div class="mt-1 text-[11px] text-slate-400">Bản quyền không giới hạn</div>
      </div>

      <div class="bg-slate-900 border border-slate-800 p-5 rounded-2xl">
        <span class="text-xs font-semibold text-slate-400 uppercase">File dữ liệu Excel / CSV</span>
        <div class="mt-2 text-sm font-bold text-emerald-300 truncate">danh_sach_khach_hang.csv</div>
        <div class="mt-1 text-[11px] text-slate-400">Tự động đồng bộ tại thư mục /data</div>
      </div>
    </div>

    <!-- Layout 2 Cột: Form Tạo Key & Danh Sách Khách Hàng -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-8">
      <!-- Cột Trái: Form Phát Hành Key Mới -->
      <div class="lg:col-span-5 space-y-6">
        <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
          <div class="flex items-center space-x-2.5 pb-4 border-b border-slate-800">
            <div class="w-8 h-8 rounded-lg bg-teal-500/10 text-teal-400 flex items-center justify-center font-bold">
              ➕
            </div>
            <div>
              <h2 class="text-sm font-bold text-white uppercase tracking-wider">Cấp Bản Quyền Khách Hàng</h2>
              <p class="text-xs text-slate-400">Sinh mã kích hoạt & lưu thông tin khách hàng</p>
            </div>
          </div>

          <form id="licenseForm" onsubmit="createLicense(event)" class="space-y-4">
            <div>
              <label class="block text-xs font-semibold text-slate-300 uppercase mb-1">
                Mã máy khách hàng (Machine ID) <span class="text-red-400">*</span>
              </label>
              <div class="flex space-x-2">
                <input id="inMachineId" type="text" required placeholder="TR-XXXX-XXXX-XXXX-XXXX" class="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-teal-300 font-mono uppercase focus:outline-none focus:border-teal-500">
                <button type="button" onclick="pasteCurrentMachineId()" class="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl border border-slate-700 whitespace-nowrap" title="Điền mã máy của PC này">
                  Máy này
                </button>
              </div>
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-300 uppercase mb-1">
                Tên khách hàng / Công ty <span class="text-red-400">*</span>
              </label>
              <input id="inCustomerName" type="text" required placeholder="Ví dụ: Kế toán Nguyễn Thị Lan" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-teal-500">
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-semibold text-slate-300 uppercase mb-1">Số điện thoại / Zalo</label>
                <input id="inPhone" type="text" placeholder="09xxxxxxxx" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-teal-500">
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-300 uppercase mb-1">Giá thu (VNĐ)</label>
                <input id="inPrice" type="number" placeholder="500000" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-teal-500">
              </div>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-semibold text-slate-300 uppercase mb-1">Gói bản quyền</label>
                <select id="inTier" onchange="onTierChange()" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-teal-500 cursor-pointer">
                  <option value="LIFETIME">⭐ Vĩnh viễn (LIFETIME)</option>
                  <option value="PRO_1Y">💼 Chuyên nghiệp (1 Năm)</option>
                  <option value="PERSONAL_1Y">👤 Cá nhân (1 Năm)</option>
                </select>
              </div>
              <div>
                <label class="block text-xs font-semibold text-slate-300 uppercase mb-1">Hạn sử dụng</label>
                <input id="inExpiryDate" type="date" value="2099-12-31" class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-teal-500">
              </div>
            </div>

            <div>
              <label class="block text-xs font-semibold text-slate-300 uppercase mb-1">Ghi chú</label>
              <input id="inNotes" type="text" placeholder="Ghi chú thêm..." class="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-teal-500">
            </div>

            <button type="submit" class="w-full bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-400 hover:to-emerald-500 text-slate-950 font-bold py-3 px-4 rounded-xl text-xs shadow-lg shadow-teal-500/20 active:scale-95 transition-all">
              ⚡ TẠO KEY & LƯU KHÁCH HÀNG
            </button>
          </form>

          <!-- Hộp hiển thị Key vừa tạo -->
          <div id="newKeyBox" class="hidden p-4 bg-emerald-950/40 border border-emerald-500/40 rounded-xl space-y-2">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold text-emerald-400">🎉 ĐÃ TẠO KEY THÀNH CÔNG!</span>
              <button onclick="copyGeneratedKey()" class="text-xs bg-emerald-500 text-slate-950 font-bold px-2.5 py-1 rounded-lg hover:bg-emerald-400 transition-all">
                Sao chép Key
              </button>
            </div>
            <textarea id="txtGeneratedKey" readonly rows="3" class="w-full bg-slate-950 border border-emerald-500/30 rounded-lg p-2 text-[11px] font-mono text-emerald-300 select-all"></textarea>
          </div>
        </div>
      </div>

      <!-- Cột Phải: Bảng Danh Sách Khách Hàng -->
      <div class="lg:col-span-7 space-y-4">
        <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 class="text-sm font-bold text-white uppercase tracking-wider">Danh Sách Khách Hàng Đã Cấp</h2>
              <p class="text-xs text-slate-400">Theo dõi, gia hạn và gửi lại key</p>
            </div>
            <div class="relative w-full sm:w-64">
              <input id="searchBox" oninput="renderTable()" type="text" placeholder="Tìm theo tên, SĐT, mã máy..." class="w-full bg-slate-950 border border-slate-700 rounded-xl pl-8 pr-3 py-2 text-xs text-white focus:outline-none focus:border-teal-500">
              <i class="fa-solid fa-magnifying-glass absolute left-3 top-2.5 text-slate-500 text-xs"></i>
            </div>
          </div>

          <div class="overflow-x-auto rounded-xl border border-slate-800">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-950 text-slate-400 font-semibold uppercase text-[11px] border-b border-slate-800">
                <tr>
                  <th class="p-3">Khách hàng</th>
                  <th class="p-3">Mã máy</th>
                  <th class="p-3">Gói</th>
                  <th class="p-3">Hạn dùng</th>
                  <th class="p-3 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody id="custTableBody" class="divide-y divide-slate-800 font-medium">
                <tr><td colspan="5" class="p-6 text-center text-slate-500">Chưa có khách hàng nào.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  </main>

  <script>
    let globalInfo = { currentMachineId: '', customers: [] };

    async function loadInfo() {
      const res = await fetch('/api/info');
      globalInfo = await res.json();
      document.getElementById('currentPcId').innerText = globalInfo.currentMachineId;
      document.getElementById('totalCustCount').innerText = globalInfo.customers.length;
      
      const lifetime = globalInfo.customers.filter(c => c.tier === 'LIFETIME').length;
      document.getElementById('lifetimeCount').innerText = lifetime;

      renderTable();
    }

    function onTierChange() {
      const tier = document.getElementById('inTier').value;
      const expiry = document.getElementById('inExpiryDate');
      if (tier === 'LIFETIME') {
        expiry.value = '2099-12-31';
      } else {
        const d = new Date();
        d.setFullYear(d.getFullYear() + 1);
        expiry.value = d.toISOString().split('T')[0];
      }
    }

    function pasteCurrentMachineId() {
      document.getElementById('inMachineId').value = globalInfo.currentMachineId;
    }

    async function selfActivate() {
      if (!confirm('Kích hoạt bản quyền VĨNH VIỄN cho máy tính này?')) return;
      const res = await fetch('/api/self-activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName: 'Admin Chủ Sở Hữu' })
      });
      const data = await res.json();
      if (data.success) {
        alert('🎉 ĐÃ KÍCH HOẠT BẢN QUYỀN VĨNH VIỄN CHO MÁY NÀY THÀNH CÔNG!\\n\\nBạn có thể mở ứng dụng TaxInsight để sử dụng ngay.');
      } else {
        alert('Có lỗi khi kích hoạt: ' + JSON.stringify(data));
      }
    }

    async function createLicense(e) {
      e.preventDefault();
      const payload = {
        machineId: document.getElementById('inMachineId').value,
        customerName: document.getElementById('inCustomerName').value,
        phone: document.getElementById('inPhone').value,
        price: document.getElementById('inPrice').value,
        tier: document.getElementById('inTier').value,
        expiryDate: document.getElementById('inExpiryDate').value,
        notes: document.getElementById('inNotes').value
      };

      const res = await fetch('/api/create-license', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (data.success) {
        document.getElementById('txtGeneratedKey').value = data.licenseKey;
        document.getElementById('newKeyBox').classList.remove('hidden');
        loadInfo();
      } else {
        alert('Lỗi: ' + data.error);
      }
    }

    function copyGeneratedKey() {
      const key = document.getElementById('txtGeneratedKey').value;
      copyText(key);
      alert('Đã sao chép License Key vào Clipboard!');
    }

    function copyText(text) {
      navigator.clipboard.writeText(text);
    }

    async function deleteCust(id) {
      if (!confirm('Bạn có chắc muốn xóa khách hàng này khỏi danh sách?')) return;
      await fetch('/api/delete-customer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      loadInfo();
    }

    function renderTable() {
      const query = document.getElementById('searchBox').value.toLowerCase().trim();
      const filtered = globalInfo.customers.filter(c => 
        (c.customerName || '').toLowerCase().includes(query) ||
        (c.phone || '').toLowerCase().includes(query) ||
        (c.machineId || '').toLowerCase().includes(query)
      );

      const tbody = document.getElementById('custTableBody');
      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="p-6 text-center text-slate-500">Không tìm thấy khách hàng nào.</td></tr>';
        return;
      }

      tbody.innerHTML = filtered.map(c => \`
        <tr class="hover:bg-slate-800/50 transition-colors">
          <td class="p-3">
            <div class="font-bold text-white">\${c.customerName}</div>
            <div class="text-[11px] text-slate-400">\${c.phone || 'Chưa có SĐT'} \${c.notes ? '• ' + c.notes : ''}</div>
          </td>
          <td class="p-3">
            <span class="font-mono text-teal-400 text-[11px] select-all">\${c.machineId}</span>
          </td>
          <td class="p-3">
            <span class="px-2 py-0.5 rounded-md text-[10px] font-bold \${
              c.tier === 'LIFETIME' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30' : 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
            }">\${c.tier}</span>
          </td>
          <td class="p-3 text-slate-300 text-[11px]">\${c.expiryDate}</td>
          <td class="p-3 text-right space-x-1.5 whitespace-nowrap">
            <button onclick="copyText('\${c.licenseKey}'); alert('Đã sao chép Key của \${c.customerName}!')" class="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-teal-300 rounded border border-slate-700" title="Sao chép Key">
              <i class="fa-regular fa-copy"></i>
            </button>
            <button onclick="deleteCust('\${c.id}')" class="px-2 py-1 bg-slate-800 hover:bg-red-950 text-red-400 rounded border border-slate-700" title="Xóa">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </td>
        </tr>
      \`).join('');
    }

    loadInfo();
  </script>
</body>
</html>`);
});

server.listen(PORT, () => {
  console.log(`========================================================`);
  console.log(`🔑 TAXINSIGHT KEYGEN & CUSTOMER MANAGER RUNNING!`);
  console.log(`🌐 URL: http://localhost:${PORT}`);
  console.log(`========================================================`);

  // Tự động kích hoạt luôn máy tính này khi khởi chạy server
  const selfRes = activateCurrentMachine('Chủ Sở Hữu / Admin');
  if (selfRes.success) {
    console.log(`✅ Đã tự động kích hoạt Bản quyền LIFETIME cho máy tính này!`);
    console.log(`   Machine ID: ${selfRes.machineId}`);
  }

  // Tự động mở trình duyệt
  const startCmd = process.platform === 'win32' ? 'start' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
  exec(`${startCmd} http://localhost:${PORT}`);
});

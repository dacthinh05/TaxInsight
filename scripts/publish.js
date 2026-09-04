const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');
const { execSync } = require('child_process');

console.log('====================================================================');
console.log('  HE THONG PHAT HANH BAN CAP NHAT TU DONG - TAXINSIGHT (GITHUB)');
console.log('====================================================================\n');

const tokenPath = path.join(__dirname, '..', '.github_token');
const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

async function getToken() {
  if (process.env.GH_TOKEN && process.env.GH_TOKEN.trim()) {
    return process.env.GH_TOKEN.trim();
  }

  if (fs.existsSync(tokenPath)) {
    const token = fs.readFileSync(tokenPath, 'utf-8').trim();
    if (token) {
      console.log('[*] Su dung token tu file .github_token.');
      return token;
    }
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    console.log('[*] Chua tim thay GitHub Token (env GH_TOKEN hoac file .github_token).');
    rl.question('[*] Vui long dan ma GitHub Token (bat dau bang ghp_) roi Enter: ', (answer) => {
      rl.close();
      const token = answer.trim();
      if (!token) {
        console.error('\n[!] Loi: Ma Token khong duoc de trong!');
        process.exit(1);
      }
      resolve(token);
    });
  });
}

function githubApiRequest(url, method, token, data = null, contentType = 'application/json') {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const headers = {
      'User-Agent': 'TaxInsight-Publisher',
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github+json'
    };
    if (data) {
      headers['Content-Type'] = contentType;
      headers['Content-Length'] = Buffer.isBuffer(data) ? data.length : Buffer.byteLength(data);
    }

    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method,
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(body);
          }
        } else {
          reject(new Error(`GitHub API HTTP ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function uploadAsset(uploadUrlTemplate, token, filePath) {
  const fileName = path.basename(filePath);
  const uploadUrl = uploadUrlTemplate.replace(/\{.*?\}$/, '') + `?name=${encodeURIComponent(fileName)}`;
  const stats = fs.statSync(filePath);
  const sizeMb = (stats.size / (1024 * 1024)).toFixed(1);

  console.log(`  -> Dang upload ${fileName} (${stats.size > 1024 * 1024 ? sizeMb + ' MB' : stats.size + ' bytes'})...`);
  const fileBuffer = fs.readFileSync(filePath);
  const contentType = fileName.endsWith('.yml') ? 'application/x-yaml' : 'application/octet-stream';

  await githubApiRequest(uploadUrl, 'POST', token, fileBuffer, contentType);
  console.log(`  ✓ Upload thanh cong ${fileName}!`);
}

async function main() {
  const token = await getToken();
  process.env.GH_TOKEN = token;
  const currentPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const version = currentPkg.version;
  const owner = currentPkg.build?.publish?.owner || 'dacthinh05';
  const repo = currentPkg.build?.publish?.repo || 'TaxInsight';
  const outputDirName = currentPkg.build?.directories?.output || 'release-dist';
  const outputDir = path.resolve(__dirname, '..', outputDirName);

  console.log(`[*] Phien ban hien tai trong package.json: v${version}`);
  console.log(`[*] Thu muc chua file build: ${outputDirName}`);

  // 1. Kiem tra xem file cai dat da duoc build san chua
  const setupFile = path.join(outputDir, `TaxInsight-Setup-${version}.exe`);
  const latestYml = path.join(outputDir, 'latest.yml');
  const blockmapFile = path.join(outputDir, `TaxInsight-Setup-${version}.exe.blockmap`);
  const portableFile = path.join(outputDir, `TaxInsight-${version}-portable.exe`);

  const hasBuiltAssets = fs.existsSync(setupFile) && fs.existsSync(latestYml);

  if (!hasBuiltAssets) {
    console.log('\n[*] Chua tim thay bo cai da dong goi san. Dang tien hanh build moi...');
    try {
      execSync('taskkill /F /IM electron.exe /IM TaxInsight.exe 2>nul || exit 0', { shell: true });
      execSync('npm run build && npx electron-builder --win -p never', {
        stdio: 'inherit',
        shell: true
      });
    } catch (err) {
      console.error('\n[!] Co loi xay ra trong qua trinh build:', err.message);
      process.exit(1);
    }
  } else {
    console.log('\n[*] Tim thay bo cai dat hop le san co trong thu muc build!');
  }

  // 2. Tao hoac cap nhat Release tren GitHub
  console.log(`\n[*] Dang kiem tra / tao ban Release v${version} tren GitHub...`);
  let release;
  try {
    release = await githubApiRequest(`https://api.github.com/repos/${owner}/${repo}/releases/tags/v${version}`, 'GET', token);
    console.log(`  -> Tim thay Release v${version} (ID: ${release.id}).`);
  } catch (err) {
    // Neu chua co thi tao moi
    console.log(`  -> Dang tao Release moi v${version}...`);
    release = await githubApiRequest(`https://api.github.com/repos/${owner}/${repo}/releases`, 'POST', token, JSON.stringify({
      tag_name: `v${version}`,
      target_commitish: 'master',
      name: `TaxInsight v${version}`,
      body: `Bản phát hành cập nhật tự động TaxInsight v${version}`,
      draft: false,
      prerelease: false
    }));
    console.log(`  ✓ Da tao Release moi thanh cong (ID: ${release.id})!`);
  }

  // 3. Upload cac file len Release
  console.log(`\n[*] Dang upload cac file cap nhat len GitHub Releases...`);
  const filesToUpload = [latestYml, blockmapFile, setupFile, portableFile].filter(f => fs.existsSync(f));

  // Xoa cac asset cu trung ten neu co
  const existingAssets = release.assets || [];
  for (const f of filesToUpload) {
    const fName = path.basename(f);
    const existing = existingAssets.find(a => a.name === fName);
    if (existing) {
      console.log(`  -> Xoa asset cu trung ten: ${fName}...`);
      try {
        await githubApiRequest(`https://api.github.com/repos/${owner}/${repo}/releases/assets/${existing.id}`, 'DELETE', token);
      } catch {}
    }
    await uploadAsset(release.upload_url, token, f);
  }

  // 4. Kich hoat public live release
  if (release.draft) {
    console.log('\n[*] Dang chuyen Release sang trang thai cong khai (Public Live)...');
    await githubApiRequest(`https://api.github.com/repos/${owner}/${repo}/releases/${release.id}`, 'PATCH', token, JSON.stringify({
      draft: false
    }));
  }

  printSuccess(version);
}

function printSuccess(version) {
  console.log('\n====================================================================');
  console.log(`  [THANH CONG] DA PHAT HANH BAN CAP NHAT v${version} LEN GITHUB!`);
  console.log('  - Link Release: https://github.com/dacthinh05/TaxInsight/releases');
  console.log('  - Tat ca may client dang mo ung dung se nhan duoc thong bao cap nhat.');
  console.log('====================================================================\n');
}

main().catch(err => {
  console.error('\n[!] Loi:', err.message);
  process.exit(1);
});

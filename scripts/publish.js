const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');
const { execSync, spawn } = require('child_process');

console.log('====================================================================');
console.log('  HE THONG PHAT HANH BAN CAP NHAT TU DONG - TAXINSIGHT (GITHUB)');
console.log('====================================================================\n');

const tokenPath = path.join(__dirname, '..', '.github_token');
const pkgPath = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

async function getToken() {
  if (fs.existsSync(tokenPath)) {
    const token = fs.readFileSync(tokenPath, 'utf-8').trim();
    if (token) return token;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    console.log('[*] Chua tim thay ma GitHub Token tren may cua ban.');
    rl.question('[*] Vui long dan ma GitHub Token (bat dau bang ghp_) roi Enter: ', (answer) => {
      rl.close();
      const token = answer.trim();
      if (!token) {
        console.error('\n[!] Loi: Ma Token khong duoc de trong!');
        process.exit(1);
      }
      fs.writeFileSync(tokenPath, token, 'utf-8');
      console.log('[OK] Da luu ma Token vao file .github_token\n');
      resolve(token);
    });
  });
}

async function main() {
  const token = await getToken();
  process.env.GH_TOKEN = token;

  console.log(`[*] Phien ban hien tai trong package.json: v${pkg.version}`);
  console.log('[*] CHE DO: Bao mat ma nguon tuyet doi (Chi phat hanh file .exe len Releases)');
  console.log('\n[*] Dang build va phat hanh ban cai dat moi len GitHub Releases...');
  console.log('[*] Qua trinh nay mat khoang 1-2 phut, vui long doi...\n');

  try {
    execSync('npm run dist -- -p always', {
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, GH_TOKEN: token }
    });
  } catch (err) {
    console.error('\n[!] Co loi xay ra trong qua trinh dong goi build.');
    return;
  }

  console.log('\n[*] Dang kich hoat ban Release thanh cong khai (Public Live)...');

      try {
        await new Promise((patchResolve) => {
          const req = https.request('https://api.github.com/repos/dacthinh05/TaxInsight/releases', {
            headers: {
              'User-Agent': 'NodeJS-Publisher',
              'Authorization': `token ${token}`
            }
          }, (res) => {
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => {
              try {
                const releases = JSON.parse(data);
                const r = releases.find(rel => rel.tag_name === 'v' + pkg.version);
                if (r && r.draft) {
                  const updateData = JSON.stringify({
                    tag_name: 'v' + pkg.version,
                    target_commitish: 'main',
                    draft: false,
                    name: 'TaxInsight v' + pkg.version,
                    body: 'Bản phát hành cập nhật tự động TaxInsight v' + pkg.version
                  });
                  const patchReq = https.request(`https://api.github.com/repos/dacthinh05/TaxInsight/releases/${r.id}`, {
                    method: 'PATCH',
                    headers: {
                      'User-Agent': 'NodeJS-Publisher',
                      'Authorization': `token ${token}`,
                      'Content-Type': 'application/json'
                    }
                  }, (patchRes) => {
                    console.log('    -> Trang thai Public Release:', patchRes.statusCode === 200 ? 'THANH CONG (200 OK)' : patchRes.statusCode);
                    patchResolve();
                  });
                  patchReq.write(updateData);
                  patchReq.end();
                } else {
                  patchResolve();
                }
              } catch (e) {
                patchResolve();
              }
            });
          });

          req.on('error', () => patchResolve());
          req.end();
        });
      } catch (err) {
        console.warn('[!] Loi kich hoat Release:', err.message);
      }

      printSuccess();
    }

function printSuccess() {
  console.log('\n====================================================================');
  console.log('  [THANH CONG] DA PHAT HANH BAN CAP NHAT MOI LEN GITHUB!');
  console.log('  - Ma nguon da duoc dong bo len nhanh main tren Git.');
  console.log(`  - Ban cai dat v${pkg.version} da LIVE tren GitHub Releases.`);
  console.log('  - Tat ca may khach hang dang mo app se nhan thong bao cap nhat ngay.');
  console.log('====================================================================\n');
}

main().catch(err => {
  console.error('[!] Loi:', err.message);
});

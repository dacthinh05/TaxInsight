const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

async function testLogin() {
  const jar = new CookieJar();
  const client = wrapper(axios.create({ jar, withCredentials: true }));

  console.log('[1] Fetching login page to initialize session & CSRF...');
  const res = await client.get('https://dichvucong.gdt.gov.vn/tthc/login', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'
    }
  });

  const html = res.data;
  const csrfMatch = html.match(/name=["']_csrf["']\s+value=["']([^"']+)["']/i) ||
                    html.match(/value=["']([^"']+)["']\s+name=["']_csrf["']/i) ||
                    html.match(/content=["']([^"']+)["']\s+name=["']_csrf["']/i);

  const csrfToken = csrfMatch ? csrfMatch[1] : '';
  console.log('[2] CSRF Token found:', csrfToken ? csrfToken.substring(0, 25) + '...' : 'NONE');

  console.log('[3] Fetching CAPTCHA...');
  const captRes = await client.get('https://dichvucong.gdt.gov.vn/tthc/login/getCaptcha', {
    responseType: 'arraybuffer',
    headers: {
      'Referer': 'https://dichvucong.gdt.gov.vn/tthc/login',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
    }
  });
  console.log('[4] Captcha image fetched, bytes:', captRes.data.length);

  const params = new URLSearchParams();
  if (csrfToken) params.append('_csrf', csrfToken);
  params.append('tenDN', '3702735709-ql');
  params.append('matKhau', Buffer.from('testpassword').toString('base64'));
  params.append('doiTuong', 'DN');
  params.append('captcha', 'WRONG');

  console.log('[5] Submitting POST /tthc/loginLDAP with CSRF...');
  const loginRes = await client.post('https://dichvucong.gdt.gov.vn/tthc/loginLDAP', params.toString(), {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-TOKEN': csrfToken,
      'Referer': 'https://dichvucong.gdt.gov.vn/tthc/login',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
    }
  });

  console.log('LOGIN RESPONSE STATUS:', loginRes.status);
  console.log('LOGIN RESPONSE DATA:', JSON.stringify(loginRes.data));
}

testLogin().catch(err => {
  if (err.response) {
    console.log('ERROR STATUS:', err.response.status, 'DATA:', JSON.stringify(err.response.data));
  } else {
    console.error('ERROR:', err.message);
  }
});

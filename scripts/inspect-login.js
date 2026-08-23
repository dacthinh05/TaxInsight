const axios = require('axios');
const { wrapper } = require('axios-cookiejar-support');
const { CookieJar } = require('tough-cookie');

async function inspect() {
  const jar = new CookieJar();
  const client = wrapper(axios.create({ jar, withCredentials: true }));
  const res = await client.get('https://dichvucong.gdt.gov.vn/tthc/login');

  console.log('--- RESPONSE HEADERS ---');
  console.log(res.headers);

  console.log('\n--- COOKIES ---');
  const cookies = await jar.getCookies('https://dichvucong.gdt.gov.vn');
  console.log(cookies.map(c => `${c.key}=${c.value}`));

  const html = res.data;
  console.log('\n--- CSRF META TAGS ---');
  const metas = html.match(/<meta[^>]+>/gi) || [];
  metas.forEach(m => {
    if (m.includes('csrf') || m.includes('token') || m.includes('Token')) console.log(m);
  });

  console.log('\n--- HIDDEN INPUTS ---');
  const inputs = html.match(/<input[^>]+>/gi) || [];
  inputs.forEach(i => console.log(i));

  console.log('\n--- SCRIPT SUBMIT FUNCTIONS ---');
  const scripts = html.match(/<script[\s\S]*?<\/script>/gi) || [];
  scripts.forEach(s => {
    if (s.includes('loginLDAP') || s.includes('dangNhap') || s.includes('submit')) {
      console.log('FOUND SCRIPT:\n', s);
    }
  });
}

inspect().catch(console.error);

// Test v9: fallback meniu instant, modal nivele, CSS ads, token pastrat.
const fs = require('fs');
const WebSocket = require('ws');
const URL = 'ws://localhost:8000';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function connect() {
  return new Promise((res, rej) => {
    const ws = new WebSocket(URL);
    const msgs = [];
    ws.on('message', d => { try { msgs.push(JSON.parse(d.toString())); } catch {} });
    ws.on('open', () => res({ ws, msgs }));
    ws.on('error', rej);
  });
}
async function waitFor(msgs, pred, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const i = msgs.findIndex(pred);
    if (i >= 0) return msgs.splice(i, 1)[0];
    await sleep(60);
  }
  throw new Error('timeout');
}
let pass = 0, total = 0;
const ok = (n, c) => { total++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (c) pass++; else process.exitCode = 1; };

(async () => {
  const pages = ['index.html','play.html','login.html','register.html','recovery.html','gdpr.html','faq.html','rating.html','users.html','profile.html','admin.html','adsorder.html','confirm.html'];
  const noFallback = pages.filter(f => !fs.readFileSync(f, 'utf8').includes('<div id="siteMenu"><header'));
  ok('fallback meniu instant in 13 pagini', noFallback.length === 0);
  if (noFallback.length) console.log('   lipsa:', noFallback.join(','));
  const adm = fs.readFileSync('admin.html', 'utf8');
  ok('modal nivele', adm.includes('levelModal') && adm.includes('lv_from') && adm.includes('lv_to') && adm.includes('lv_size') && adm.includes('lv_access') && adm.includes('lv_ok'));
  ok('gate dinamic + feedback adsTxt', adm.includes('gateText') && adm.includes('adsTxtMsg'));
  const { D } = require('./i18n_dict.js');
  ok('e.already x3', ['ro', 'en', 'ru'].every(l => D[l]['e.already']));
  const css = fs.readFileSync('styles.css', 'utf8');
  ok('css anti-scroll ads', /\[data-adslot\]\{[^}]*overflow:hidden/.test(css) && /\#rematchAd\{[^}]*max-height/.test(css));
  const menu = fs.readFileSync('menu.js', 'utf8');
  ok('meniu pe Session (logout+clear)', menu.includes('Session.logout') || menu.includes('Session.clear'));
  const net = fs.readFileSync('net.js', 'utf8');
  ok('net logout prin Session.clear', net.includes('Session.clear') && net.includes('__loggingOut'));

  // token pastrat + multi-hello
  const S = String(Date.now() % 100000);
  const c = await connect();
  const U = `s${S}`, E = `${U}@x.ro`;
  c.ws.send(JSON.stringify({ t: 'register', firstName: 'S', lastName: 'S', username: U, email: E }));
  await waitFor(c.msgs, x => x.t === 'registered');
  const files = fs.readdirSync('outbox').filter(f => f.includes('_confirm_') && f.toLowerCase().includes(E.toLowerCase())).sort();
  const mail = JSON.parse(fs.readFileSync('outbox/' + files[files.length - 1], 'utf8'));
  c.ws.send(JSON.stringify({ t: 'confirmEmail', token: mail.token }));
  const cf = await waitFor(c.msgs, x => x.t === 'confirmed');
  c.ws.send(JSON.stringify({ t: 'setPassword', token: cf.setToken, pass: 'parola1' }));
  await waitFor(c.msgs, x => x.t === 'passwordSet');
  c.ws.send(JSON.stringify({ t: 'login', user: U, pass: 'parola1' }));
  const a = await waitFor(c.msgs, x => x.t === 'auth' && x.user && x.token);
  const tok = a.token;
  c.ws.close();
  let good = 0;
  for (let i = 0; i < 3; i++) {
    const k = await connect();
    k.ws.send(JSON.stringify({ t: 'hello', token: tok }));
    const r = await waitFor(k.msgs, x => x.t === 'auth' && x.user, 5000).catch(() => null);
    if (r) good++;
    k.ws.close();
  }
  ok('sesiune tinuta la hello repetat', good === 3);

  // register cand esti logat -> refuz
  const rk = await connect();
  rk.ws.send(JSON.stringify({ t: 'login', user: U, pass: 'parola1' }));
  await waitFor(rk.msgs, x => x.t === 'auth' && x.user);
  rk.ws.send(JSON.stringify({ t: 'register', firstName: 'Z', lastName: 'Z', username: `zz${S}`, email: `zz${S}@x.ro` }));
  const mr = await waitFor(rk.msgs, x => x.t === 'error').catch(() => null);
  // U e deja logat pe alt socket; acesta e logat acum -> trebuie e.already
  ok('register logat refuzat', !!mr);
  rk.ws.close();

  console.log(`\n${pass}/${total} teste trecute`);
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('FAIL exceptie:', e.message); process.exit(1); });

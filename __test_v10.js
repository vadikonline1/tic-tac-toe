// Test v10: single-port, roluri, session.js, fara roadmap/badge, meniu mobil, admin single-save.
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');
const sleep = ms => new Promise(r => setTimeout(r, ms));
function connect() {
  return new Promise((res, rej) => {
    const ws = new WebSocket('ws://localhost:8000/');
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
function get(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: 'localhost', port: 8000, path }, res => {
      let b = ''; res.on('data', c => b += c); res.on('end', () => resolve({ code: res.statusCode, body: b }));
    }).on('error', reject);
  });
}
let pass = 0, total = 0;
const ok = (n, c) => { total++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (c) pass++; else process.exitCode = 1; };

(async () => {
  // 1. single port: http + ws pe 8000
  const h = await get('/index.html');
  ok('HTTP 8000 index', h.code === 200 && h.body.includes('TIC-TAK-TOK'));
  const t = await get('/ads.txt');
  ok('HTTP 8000 ads.txt', t.code === 200 && t.body.includes('ca-pub-'));
  const nf = await get('/__test_v3.js');
  ok('fisiere test blocate (404)', nf.code === 404);

  // 2. roluri: guest/user/admin
  const G = await connect();
  G.ws.send(JSON.stringify({ t: 'hello', lang: 'ro' }));
  let m = await waitFor(G.msgs, x => x.t === 'auth');
  ok('rol guest', m.role === 'guest' && !m.user);
  const S = String(Date.now() % 100000);
  const U = `r${S}`, E = `${U}@x.ro`;
  G.ws.send(JSON.stringify({ t: 'register', firstName: 'R', lastName: 'R', username: U, email: E }));
  await waitFor(G.msgs, x => x.t === 'registered');
  const files = fs.readdirSync('outbox').filter(f => f.includes('_confirm_') && f.toLowerCase().includes(E.toLowerCase())).sort();
  const mail = JSON.parse(fs.readFileSync('outbox/' + files[files.length - 1], 'utf8'));
  G.ws.send(JSON.stringify({ t: 'confirmEmail', token: mail.token }));
  const cf = await waitFor(G.msgs, x => x.t === 'confirmed');
  G.ws.send(JSON.stringify({ t: 'setPassword', token: cf.setToken, pass: 'parola1' }));
  await waitFor(G.msgs, x => x.t === 'passwordSet');
  G.ws.send(JSON.stringify({ t: 'login', user: U, pass: 'parola1' }));
  m = await waitFor(G.msgs, x => x.t === 'auth' && x.user);
  ok('rol user + token', m.role === 'user' && !!m.token);

  // 3. session.js unificat
  const sess = fs.readFileSync('session.js', 'utf8');
  ok('session.js API', sess.includes('ensure') && sess.includes('save') && sess.includes('clear') && sess.includes('logout'));
  const pages = ['index.html','play.html','login.html','register.html','recovery.html','gdpr.html','faq.html','rating.html','users.html','profile.html','admin.html','adsorder.html','confirm.html'];
  const noSess = pages.filter(f => !fs.readFileSync(f, 'utf8').includes('session.js'));
  ok('session.js in 13 pagini', noSess.length === 0);
  const menu = fs.readFileSync('menu.js', 'utf8');
  ok('meniu pe Session + burger', menu.includes('Session.ensure') && menu.includes('menuBurger') && menu.includes('menuNav'));
  const net = fs.readFileSync('net.js', 'utf8');
  ok('net pe Session', net.includes('Session.save') && net.includes('Session.clear') && net.includes('Session.get'));

  // 4. index fara badge/roadmap
  const idx = fs.readFileSync('index.html', 'utf8');
  ok('index fara badge', !idx.includes('hero.badge'));
  ok('index fara roadmap', !idx.includes('roadmap'));

  // 5. admin single save
  const adm = fs.readFileSync('admin.html', 'utf8');
  ok('admin un singur save config', adm.includes('saveCfg') && !adm.includes('lv_save'));

  // 6. smoke joc pe portul unic: creare + mutare
  G.ws.send(JSON.stringify({ t: 'create', title: 'V10', size: 3, players: 2 }));
  const room = await waitFor(G.msgs, x => x.t === 'room');
  ok('create pe 8000', !!room.code);
  await waitFor(G.msgs, x => x.t === 'state');
  G.ws.send(JSON.stringify({ t: 'move', r: 1, c: 1, size: 5 }));
  const st = await waitFor(G.msgs, x => x.t === 'state' && x.moveNo >= 2, 9000);
  ok('mutare + raspuns bot', st.board.flat().filter(z => z.length).length >= 1);
  G.ws.close();

  console.log(`\n${pass}/${total} teste trecute`);
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('FAIL exceptie:', e.message); process.exit(1); });

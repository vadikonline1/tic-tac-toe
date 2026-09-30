// Test v8: force-change auto-login, nivele dinamice, ads.txt, snippet, cache meniu.
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const URL = 'ws://localhost:8000';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DIR = __dirname;
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
  const { D } = require('./i18n_dict.js');
  for (const k of ['lvx', 'lv11', 'ad.levels', 'ad.snippet', 'ad.adstxt', 'ad.max', 'ad.access']) {
    if (!D.ro[k] || !D.en[k] || !D.ru[k]) ok('i18n ' + k, false);
  }
  ok('i18n nivele/ads x3', true);
  const menu = fs.readFileSync('menu.js', 'utf8');
  ok('meniu cache instant + Profil', menu.includes('Session.ensure') && menu.includes('· Profil'));
  const css = fs.readFileSync('styles.css', 'utf8');
  ok('rematchModal responsive + authArea', css.includes('#rematchModal .modal-box') && css.includes('#authArea .who') && css.includes('.turn-timer'));
  const net = fs.readFileSync('net.js', 'utf8');
  ok('net canJoin cu brackets', net.includes('accessMin'));

  // force-change -> auto-login cu token
  const A = await connect();
  A.ws.send(JSON.stringify({ t: 'login', user: 'admin@matroshka.local', pass: 'Admin123!' }));
  let m = await waitFor(A.msgs, x => x.t === 'mustChange');
  A.ws.send(JSON.stringify({ t: 'changePass', token: m.changeToken, pass: 'Forced99!' }));
  m = await waitFor(A.msgs, x => x.t === 'passwordSet');
  ok('changePass intoarce token+user', !!m.token && !!m.user && m.isAdmin === true);
  A.ws.send(JSON.stringify({ t: 'hello', token: m.token }));
  m = await waitFor(A.msgs, x => x.t === 'auth' && x.user);
  ok('auto-login dupa force-change', m.user.name === 'admin' && m.isAdmin === true);

  // nivele dinamice: adaug L11 7x7 acces >9
  A.ws.send(JSON.stringify({ t: 'adminGetConfig' }));
  m = await waitFor(A.msgs, x => x.t === 'adminConfig');
  const cfg = m.config;
  cfg.maxLevel = 11;
  cfg.brackets.push({ from: 11, to: 11, size: 7, accessMin: 10 });
  A.ws.send(JSON.stringify({ t: 'adminSaveConfig', config: cfg }));
  m = await waitFor(A.msgs, x => x.t === 'adminConfig' && x.saved);
  ok('nivel 11 salvat', true);
  delete require.cache[require.resolve('./levels.js')];
  const L = require('./levels.js');
  ok('sizeFor(11)=7', L.sizeFor(11) === 7);
  ok('allowedSizes(10)=[6,7]', JSON.stringify(L.allowedSizes(10)) === '[6,7]');
  ok('join L10 la L11', L.canJoin(10, 11) === true);
  ok('join L9 la L11 respins', L.canJoin(9, 11) === false);
  ok('join L11 la L11', L.canJoin(11, 11) === true);

  // masa 7x7 ca L10? admin e L1 (rating 1000) -> nu are voie; verificam eroarea de marime corecta
  A.ws.send(JSON.stringify({ t: 'create', title: 'X', size: 7, players: 2 }));
  m = await waitFor(A.msgs, x => x.t === 'error');
  ok('L1 nu poate crea 7x7', !!m.reason);

  // ads.txt read/write + HTTP
  A.ws.send(JSON.stringify({ t: 'adminSaveAdsTxt', txt: 'google.com, ca-pub-TEST, DIRECT, abc' }));
  await waitFor(A.msgs, x => x.t === 'adminDone');
  A.ws.send(JSON.stringify({ t: 'adminGetAdsTxt' }));
  m = await waitFor(A.msgs, x => x.t === 'adminAdsTxt');
  ok('ads.txt RW', (m.txt || '').includes('ca-pub-TEST'));
  // snippet
  cfg.ads = cfg.ads || {};
  cfg.ads.adsenseSnippet = '<script src="https://x.test/a.js"></script>';
  A.ws.send(JSON.stringify({ t: 'adminSaveConfig', config: cfg }));
  await waitFor(A.msgs, x => x.t === 'adminConfig' && x.saved);
  A.ws.send(JSON.stringify({ t: 'ads' }));
  m = await waitFor(A.msgs, x => x.t === 'ads');
  ok('snippet in raspunsul ads', (m.adsenseSnippet || '').includes('x.test'));

  // restore config
  const bak = JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8'));
  bak.maxLevel = 10;
  bak.brackets = bak.brackets.filter(b => b.from <= 10);
  delete (bak.ads || {}).adsenseSnippet;
  A.ws.send(JSON.stringify({ t: 'adminSaveConfig', config: bak }));
  await waitFor(A.msgs, x => x.t === 'adminConfig' && x.saved);
  ok('config restaurat', true);

  console.log(`\n${pass}/${total} teste trecute`);
  A.ws.close();
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('FAIL exceptie:', e.message); process.exit(1); });

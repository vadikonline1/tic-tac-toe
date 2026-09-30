// Test v5: rebrand, tema, meniu-profil, admin ascuns, sesiuni persistente, taburi noi.
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
async function waitFor(msgs, pred, timeout = 7000) {
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
  // --- 1. rebrand: niciun MATROSHKA vizibil in html (chei tehnice doar in js) ---
  const htmlFiles = ['index.html','play.html','login.html','register.html','recovery.html','gdpr.html','faq.html','rating.html','users.html','profile.html','admin.html','adsorder.html','confirm.html'];
  const stripScripts = s => s.replace(/<script[\s\S]*?<\/script>/gi, '');
  const bad = htmlFiles.filter(f => /matroshka/i.test(stripScripts(fs.readFileSync(f, 'utf8'))));
  ok('rebrand html complet (fara scripturi)', bad.length === 0);
  if (bad.length) console.log('   fisiere:', bad.join(','));
  const dict = fs.readFileSync('i18n_dict.js', 'utf8');
  ok('fara Matroshka in dict', /matroshka/i.test(dict) === false);
  const menuSrc = fs.readFileSync('menu.js', 'utf8');
  ok('brand nou in meniu', menuSrc.includes('TIC-TAK-TOK'));

  // --- 2. tema: css + toggle ---
  const css = fs.readFileSync('styles.css', 'utf8');
  ok('tema light definita', css.includes('[data-theme="light"]') && css.includes('--bodybg'));
  const menu = fs.readFileSync('menu.js', 'utf8');
  ok('toggle tema in meniu', menu.includes('menuTheme') && menu.includes('setTheme'));
  ok('meniu: login devine profil', menu.includes('profile.html') && menu.includes('menuAuth'));
  ok('meniu: admin doar la admini', menu.includes('menuAdmin') && menu.includes('isAdmin'));
  ok('meniu: dropdown limba', menu.includes('menuLang'));
  const play = fs.readFileSync('play.html', 'utf8');
  ok('taburi Top+Creare', play.includes('tabTop') && play.includes('tabCreate') && play.includes('topView') && play.includes('createView'));
  const net = fs.readFileSync('net.js', 'utf8');
  ok('leaderboard cu limita', net.includes('leaderboard(limit)'));

  // --- 3. admin ascuns din listari ---
  const A = await connect();
  A.ws.send(JSON.stringify({ t: 'login', user: 'admin@tic-tak-tok.local', pass: 'x' }));
  await waitFor(A.msgs, x => x.t === 'error'); // emailul vechi nu mai e relevant; doar sa nu crape
  ok('login handler viu', true);
  A.ws.send(JSON.stringify({ t: 'leaderboard', limit: 50 }));
  let m = await waitFor(A.msgs, x => x.t === 'leaderboard');
  ok('admin absent din leaderboard', !m.list.some(x => x.name === 'admin'));
  A.ws.send(JSON.stringify({ t: 'newUsers', limit: 50 }));
  m = await waitFor(A.msgs, x => x.t === 'newUsers');
  ok('admin absent din newUsers', !m.list.some(x => x.name === 'admin'));
  A.ws.send(JSON.stringify({ t: 'viewProfile', user: 'admin' }));
  m = await waitFor(A.msgs, x => x.t === 'error');
  ok('profil admin ascuns strainilor', !!m.reason);

  console.log(`\n${pass}/${total} teste trecute (v5-static)`);
  A.ws.close();
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('FAIL exceptie:', e.message); process.exit(1); });

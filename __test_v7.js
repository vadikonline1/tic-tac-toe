// Test v7: token persistent, timer 30s->bot, sloturi reclama, gating, i18n.
// Rulare normala: node __test_v7.js | timer: TURN_MS=1500 node __test_v7.js timer
const fs = require('fs');
const WebSocket = require('ws');
const URL = 'ws://localhost:8000';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TIMER = process.argv[2] === 'timer';
function connect() {
  return new Promise((res, rej) => {
    const ws = new WebSocket(URL);
    const msgs = [];
    ws.on('message', d => { try { msgs.push(JSON.parse(d.toString())); } catch {} });
    ws.on('open', () => res({ ws, msgs }));
    ws.on('error', rej);
  });
}
async function waitFor(msgs, pred, timeout = 9000) {
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
  if (!TIMER) {
    const play = fs.readFileSync('play.html', 'utf8');
    ok('slot rematchAd + countdown', play.includes('rematchAd') && play.includes('turnTimer'));
    const ads = fs.readFileSync('ads.js', 'utf8');
    ok('renderRematchAd', ads.includes('renderRematchAd'));
    const adm = fs.readFileSync('admin.html', 'utf8');
    ok('admin: camp AdSense', adm.includes('e_adsense'));
    const ao = fs.readFileSync('adsorder.html', 'utf8');
    ok('adsorder: sectiuni doar-admin', (ao.match(/ads-admin/g) || []).length >= 3 && ao.includes('m.isAdmin'));
    const { D } = require('./i18n_dict.js');
    ok('sys.timeout x3', ['ro', 'en', 'ru'].every(l => D[l]['sys.timeout']));
    ok('ad.off x3', ['ro', 'en', 'ru'].every(l => D[l]['ad.off']));

    // tokenul NU se sterge la conectari repetate
    const S = String(Date.now() % 100000);
    const c = await connect();
    const U = `t${S}`, E = `${U}@x.ro`;
    c.ws.send(JSON.stringify({ t: 'register', firstName: 'T', lastName: 'T', username: U, email: E }));
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
    // 3 conectari cu acelasi token: toate trebuie sa dea user (fara wipe)
    let good = 0;
    for (let i = 0; i < 3; i++) {
      const k = await connect();
      k.ws.send(JSON.stringify({ t: 'hello', token: tok }));
      const r = await waitFor(k.msgs, x => x.t === 'auth' && x.user, 5000).catch(() => null);
      if (r) good++;
      k.ws.close();
    }
    ok('token rezista la 3 conectari', good === 3);
  } else {
    // timer: creatorul sta -> botul muta pentru el
    const S = String(Date.now() % 100000);
    const c = await connect();
    const U = `w${S}`, E = `${U}@x.ro`;
    c.ws.send(JSON.stringify({ t: 'register', firstName: 'W', lastName: 'W', username: U, email: E }));
    await waitFor(c.msgs, x => x.t === 'registered');
    const files = fs.readdirSync('outbox').filter(f => f.includes('_confirm_') && f.toLowerCase().includes(E.toLowerCase())).sort();
    const mail = JSON.parse(fs.readFileSync('outbox/' + files[files.length - 1], 'utf8'));
    c.ws.send(JSON.stringify({ t: 'confirmEmail', token: mail.token }));
    const cf = await waitFor(c.msgs, x => x.t === 'confirmed');
    c.ws.send(JSON.stringify({ t: 'setPassword', token: cf.setToken, pass: 'parola1' }));
    await waitFor(c.msgs, x => x.t === 'passwordSet');
    c.ws.send(JSON.stringify({ t: 'login', user: U, pass: 'parola1' }));
    await waitFor(c.msgs, x => x.t === 'auth' && x.user);
    c.ws.send(JSON.stringify({ t: 'create', title: 'Timer', size: 3, players: 2 }));
    await waitFor(c.msgs, x => x.t === 'room');
    const s0 = await waitFor(c.msgs, x => x.t === 'state' && typeof x.deadline === 'number');
    ok('deadline in stare', typeof s0.deadline === 'number' && s0.deadline > Date.now());
    // stam pe loc: botul trebuie sa mute pentru creator (moveNo 2) + anunt timeout
    const s1 = await waitFor(c.msgs, x => x.t === 'state' && x.moveNo >= 2, 12000);
    ok('timeout -> bot muta', s1.board.flat().filter(z => z.length).length >= 1);
    const chat = await waitFor(c.msgs, x => x.t === 'chat', 5000).catch(() => null);
    ok('anunt timeout in chat', !!chat);
    c.ws.close();
  }
  console.log(`\n${pass}/${total} teste trecute`);
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('FAIL exceptie:', e.message); process.exit(1); });

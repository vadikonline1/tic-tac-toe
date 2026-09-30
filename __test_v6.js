// Test v6: grace disconnect + reatasare, expirare -> bot, ping/pong, room404, ads page.
const fs = require('fs');
const WebSocket = require('ws');
const URL = 'ws://localhost:8000';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const EXPIRY = process.argv[2] === 'expiry';
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
  if (!EXPIRY) {
    // statice ads page
    const ads = fs.readFileSync('adsorder.html', 'utf8');
    ok('ads: buton demo', ads.includes('adsDemoBtn') && ads.includes('demoSlots'));
    ok('ads: lista live + adsense', ads.includes('liveAds') && ads.includes('adsenseStatus'));

    // ping/pong + room404 code
    const P = await connect();
    P.ws.send(JSON.stringify({ t: 'ping' }));
    let m = await waitFor(P.msgs, x => x.t === 'pong');
    ok('ping->pong', !!m);
    P.ws.send(JSON.stringify({ t: 'join', code: 'ZZZZ' }));
    m = await waitFor(P.msgs, x => x.t === 'error');
    ok('room404 cu cod', m.code === 'room404');
    P.ws.close();
  }

  const S = String(Date.now() % 100000);
  async function mkUser(U, E) {
    const c = await connect();
    c.ws.send(JSON.stringify({ t: 'register', firstName: U, lastName: 'T', username: U, email: E }));
    await waitFor(c.msgs, x => x.t === 'registered');
    const files = fs.readdirSync('outbox').filter(f => f.includes('_confirm_') && f.toLowerCase().includes(E.toLowerCase())).sort();
    const mail = JSON.parse(fs.readFileSync('outbox/' + files[files.length - 1], 'utf8'));
    c.ws.send(JSON.stringify({ t: 'confirmEmail', token: mail.token }));
    const cf = await waitFor(c.msgs, x => x.t === 'confirmed');
    c.ws.send(JSON.stringify({ t: 'setPassword', token: cf.setToken, pass: 'parola1' }));
    await waitFor(c.msgs, x => x.t === 'passwordSet');
    c.ws.send(JSON.stringify({ t: 'login', user: U, pass: 'parola1' }));
    await waitFor(c.msgs, x => x.t === 'auth' && x.user);
    c.name = U;
    return c;
  }
  const A = await mkUser(`g1${S}`, `g1${S}@x.ro`);
  const B = await mkUser(`g2${S}`, `g2${S}@x.ro`);
  A.ws.send(JSON.stringify({ t: 'create', title: 'Grace', size: 3, players: 2 }));
  const room = await waitFor(A.msgs, x => x.t === 'room');
  await waitFor(A.msgs, x => x.t === 'state');
  B.ws.send(JSON.stringify({ t: 'join', code: room.code }));
  await waitFor(B.msgs, x => x.t === 'room');
  await waitFor(B.msgs, x => x.t === 'state' && x.seats.every(z => !z.bot));
  A.msgs.length = 0; B.msgs.length = 0;

  // cadere brutala B
  B.ws.close();
  // A trebuie sa vada locul PASTRAT (nu bot) + mesaj reconectare
  let s = await waitFor(A.msgs, x => x.t === 'state' && x.seats[1].bot === false && x.seats[1].name.includes('g2'), 8000);
  ok('grace: locul pastrat (nu bot)', true);
  const hasReconn = A.msgs.some(x => x.t === 'chat');
  ok('grace: anunt reconectare', hasReconn);
  A.msgs.length = 0;

  if (!EXPIRY) {
    // reatasare in grace: socket nou + login + join
    const B2 = await connect();
    B2.ws.send(JSON.stringify({ t: 'login', user: `g2${S}`, pass: 'parola1' }));
    await waitFor(B2.msgs, x => x.t === 'auth' && x.user);
    B2.ws.send(JSON.stringify({ t: 'join', code: room.code }));
    const r = await waitFor(B2.msgs, x => x.t === 'room');
    ok('reattach acelasi loc', r.you === 2);
    const back = await waitFor(A.msgs, x => x.t === 'chat' && /reconectat|reconnected|вернулся/.test(x.text), 5000).catch(() => null);
    ok('anunt revenire', !!back);
    A.ws.close(); B2.ws.close();
  } else {
    // asteptam expirarea (server pornit cu GRACE_MS mic)
    s = await waitFor(A.msgs, x => x.t === 'state' && x.seats[1].bot === true, 15000);
    ok('expirare grace -> bot preia', true);
    A.ws.close();
  }

  console.log(`\n${pass}/${total} teste trecute`);
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('FAIL exceptie:', e.message); process.exit(1); });

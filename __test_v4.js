// Test v4: bootstrap admin + force-change, mese 3 jucatori, i18n nou.
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
  const { D } = require('./i18n_dict.js');
  for (const k of ['lg.title', 'rg.title', 'rc.title', 'pw.must', 'np.title', 'np.hint', 'ad.email', 'ad.host', 'e.badSize']) {
    if (!D.ro[k] || !D.en[k] || !D.ru[k]) { ok('i18n ' + k, false); }
  }
  ok('i18n chei noi x3', true);

  // --- admin bootstrap + force change ---
  const A = await connect();
  A.ws.send(JSON.stringify({ t: 'login', user: 'admin@matroshka.local', pass: 'Admin123!' }));
  let m = await waitFor(A.msgs, x => x.t === 'mustChange');
  ok('login default -> mustChange', !!m.changeToken && m.isAdmin === true);
  const ct = m.changeToken;
  A.ws.send(JSON.stringify({ t: 'changePass', token: 'nul', pass: 'NouaParola1' }));
  m = await waitFor(A.msgs, x => x.t === 'error');
  ok('changePass token prost respins', !!m.reason);
  A.ws.send(JSON.stringify({ t: 'changePass', token: ct, pass: 'NouaParola1' }));
  await waitFor(A.msgs, x => x.t === 'passwordSet');
  ok('force change ok', true);
  A.ws.send(JSON.stringify({ t: 'login', user: 'admin', pass: 'NouaParola1' }));
  m = await waitFor(A.msgs, x => x.t === 'auth' && x.user);
  ok('login noua parola + admin', m.user.name === 'admin' && m.isAdmin === true);
  // schimbare voluntara inapoi? pastram NouaParola1 pentru demo; verificam doar fluxul vechi-token consumat
  A.ws.send(JSON.stringify({ t: 'changePass', token: ct, pass: 'x' }));
  m = await waitFor(A.msgs, x => x.t === 'error');
  ok('token consumat nu se reutilizeaza', !!m.reason);

  // --- useri pentru masa 3p ---
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
    return c;
  }
  const B = await mkUser(`p1${S}`, `p1${S}@x.ro`);
  const C = await mkUser(`p2${S}`, `p2${S}@x.ro`);
  const Dc = await mkUser(`p3${S}`, `p3${S}@x.ro`);

  // create 6p pe 3x3 -> eroare marime
  B.ws.send(JSON.stringify({ t: 'create', title: 'Mare', size: 3, players: 6 }));
  m = await waitFor(B.msgs, x => x.t === 'error');
  ok('6 jucatori pe 3x3 respins', !!m.reason);

  // masa 3p
  B.ws.send(JSON.stringify({ t: 'create', title: 'Trio', size: 3, players: 3 }));
  const room = await waitFor(B.msgs, x => x.t === 'room');
  ok('create 3p you=1', room.you === 1);
  let s = await waitFor(B.msgs, x => x.t === 'state');
  ok('3 locuri (1 om + 2 boti)', s.seats.length === 3 && s.maxPlayers === 3);
  C.ws.send(JSON.stringify({ t: 'join', code: room.code }));
  await waitFor(C.msgs, x => x.t === 'room');
  Dc.ws.send(JSON.stringify({ t: 'join', code: room.code }));
  await waitFor(Dc.msgs, x => x.t === 'room');
  s = await waitFor(Dc.msgs, x => x.t === 'state' && x.seats.every(z => !z.bot));
  ok('3 oameni la masa', s.seats.filter(z => !z.bot).length === 3);
  B.msgs.length = 0; C.msgs.length = 0; Dc.msgs.length = 0;

  // partida: A(1) B(2) D(3) rotatie, castiga P1 pe randul 0
  const seq = [[B, 0, 0, 1], [C, 1, 0, 1], [Dc, 2, 0, 1], [B, 0, 1, 2], [C, 1, 1, 2], [Dc, 2, 1, 2], [B, 0, 2, 3]];
  for (const [c, r, cc, sz] of seq) { c.ws.send(JSON.stringify({ t: 'move', r, c: cc, size: sz })); await sleep(250); }
  s = await waitFor(B.msgs, x => x.t === 'state' && x.winner === 1);
  ok('victorie P1 la masa 3p', s.winCells.length === 3);
  const nB = await waitFor(B.msgs, x => x.t === 'notice');
  const nC = await waitFor(C.msgs, x => x.t === 'notice');
  const nD = await waitFor(Dc.msgs, x => x.t === 'notice');
  ok('rating la toti 3', /Rating/.test(nB.text) && /Rating/.test(nC.text) && /Rating/.test(nD.text));
  console.log('   ', nB.text, '|', nC.text, '|', nD.text);
  B.msgs.length = 0; C.msgs.length = 0; Dc.msgs.length = 0;

  // rematch: 2 voturi nu ajung, 3 da
  B.ws.send(JSON.stringify({ t: 'rematch', accept: true }));
  await sleep(300);
  C.ws.send(JSON.stringify({ t: 'rematch', accept: true }));
  await sleep(400);
  ok('2/3 voturi nu reseteaza', !B.msgs.some(x => x.t === 'state' && x.moveNo === 1 && !x.winner));
  Dc.ws.send(JSON.stringify({ t: 'rematch', accept: true }));
  s = await waitFor(B.msgs, x => x.t === 'state' && x.moveNo === 1 && !x.winner);
  ok('3/3 voturi = revansa (starter 2)', s.turn === 2);
  B.msgs.length = 0; C.msgs.length = 0; Dc.msgs.length = 0;

  // bot pe loc gol la 3p: C iese -> tura ajunge la bot -> muta singur
  C.ws.send(JSON.stringify({ t: 'leave' }));
  await waitFor(C.msgs, x => x.t === 'left');
  // acum B(1) si D(3) oameni, 2 e bot; starter 2 -> tura 2 = bot
  s = await waitFor(B.msgs, x => x.t === 'state' && x.moveNo >= 2 && x.seats[1].bot, 9000);
  ok('bot preia locul 2 si muta', s.board.flat().filter(c => c.length).length >= 1);

  console.log(`\n${pass}/${total} teste trecute`);
  [A, B, C, Dc].forEach(c => c.ws.close());
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('FAIL exceptie:', e.message); process.exit(1); });

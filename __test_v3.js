// Test e2e v3: i18n, register->confirm->pass->login, gating, waiting-only, profiluri,
// admin config/users, ads, prune+warnings, delete, lang.
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
async function waitFor(msgs, pred, timeout = 6000) {
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
function outboxLast(kind, toFragment) {
  const frag = (toFragment || '').toLowerCase();
  const files = fs.readdirSync(path.join(DIR, 'outbox')).filter(f => f.includes('_' + kind + '_') && (!frag || f.toLowerCase().includes(frag))).sort();
  if (!files.length) return null;
  return JSON.parse(fs.readFileSync(path.join(DIR, 'outbox', files[files.length - 1]), 'utf8'));
}

(async () => {
  // --- 0. i18n parity ---
  const { D } = require('./i18n_dict.js');
  const keys = Object.keys(D.ro);
  const missingEn = keys.filter(k => D.en[k] === undefined);
  const missingRu = keys.filter(k => D.ru[k] === undefined);
  ok(`i18n ${keys.length} chei ro`, keys.length > 120);
  ok('i18n en complet', missingEn.length === 0);
  ok('i18n ru complet', missingRu.length === 0);

  const S = String(Date.now() % 100000);
  const UA = `uA${S}`, UB = `uB${S}`, EA = `${UA}@x.ro`, EB = `${UB}@x.ro`;
  const A = await connect(), B = await connect();

  // --- 1. register nou ---
  A.ws.send(JSON.stringify({ t: 'register', firstName: 'Ana', lastName: 'Pop', username: UA, email: EA }));
  let m = await waitFor(A.msgs, x => x.t === 'registered');
  ok('register -> pending', !!m.pending);
  let mail = outboxLast('confirm', EA);
  ok('email confirmare in outbox', !!mail && !!mail.token);

  // login inainte de confirmare esueaza la nivel de parola (nu exista) -> badLogin
  A.ws.send(JSON.stringify({ t: 'login', user: UA, pass: 'x' }));
  m = await waitFor(A.msgs, x => x.t === 'error');
  ok('login fara parola esueaza', !!m.reason);

  // confirm + setPassword + login
  A.ws.send(JSON.stringify({ t: 'confirmEmail', token: mail.token }));
  m = await waitFor(A.msgs, x => x.t === 'confirmed');
  ok('confirmEmail -> setToken', !!m.setToken);
  A.ws.send(JSON.stringify({ t: 'setPassword', token: m.setToken, pass: 'pw1' }));
  m = await waitFor(A.msgs, x => x.t === 'error');
  ok('parola scurta respinsa', !!m.reason);
  // tokenul a fost consumat? setPassword cu token gresit
  A.ws.send(JSON.stringify({ t: 'setPassword', token: 'nul', pass: 'parola1' }));
  m = await waitFor(A.msgs, x => x.t === 'error');
  ok('token invalid respins', !!m.reason);

  // re-confirm? tokenul confirm a fost consumat deja. Inregistram alt user pt flow complet
  const UC = `uC${S}`, EC = `${UC}@x.ro`;
  A.ws.send(JSON.stringify({ t: 'register', firstName: 'C', lastName: 'D', username: UC, email: EC }));
  await waitFor(A.msgs, x => x.t === 'registered');
  mail = outboxLast('confirm', EC);
  A.ws.send(JSON.stringify({ t: 'confirmEmail', token: mail.token }));
  m = await waitFor(A.msgs, x => x.t === 'confirmed');
  A.ws.send(JSON.stringify({ t: 'setPassword', token: m.setToken, pass: 'parola1' }));
  await waitFor(A.msgs, x => x.t === 'passwordSet');
  A.ws.send(JSON.stringify({ t: 'login', user: UC, pass: 'parola1' }));
  m = await waitFor(A.msgs, x => x.t === 'auth' && x.user);
  ok('flow complet register->login', m.user.name === UC && m.user.rating === 1000);

  // --- 2. anon create respins, join permis ---
  B.ws.send(JSON.stringify({ t: 'create', title: 'Anon', size: 3 }));
  m = await waitFor(B.msgs, x => x.t === 'error');
  ok('anon nu poate crea masa', !!m.reason);
  A.ws.send(JSON.stringify({ t: 'create', title: 'Masa e2e', size: 3 }));
  const room = await waitFor(A.msgs, x => x.t === 'room');
  ok('logat creeaza masa', room.you === 1);
  await waitFor(A.msgs, x => x.t === 'state');
  B.ws.send(JSON.stringify({ t: 'join', code: room.code }));
  m = await waitFor(B.msgs, x => x.t === 'room');
  ok('anon poate intra la masa', m.you === 2);
  A.msgs.length = 0; B.msgs.length = 0;

  // --- 3. mese live ascunse din lista ---
  A.ws.send(JSON.stringify({ t: 'move', r: 0, c: 0, size: 1 }));
  await sleep(300);
  const D2 = await connect();
  D2.ws.send(JSON.stringify({ t: 'tables' }));
  m = await waitFor(D2.msgs, x => x.t === 'tables');
  ok('masa in joc ascunsa din lista', !m.list.some(x => x.code === room.code));
  D2.ws.close();
  A.msgs.length = 0; B.msgs.length = 0;

  // --- 4. profiluri: public vs privat ---
  B.ws.send(JSON.stringify({ t: 'viewProfile', user: UC }));
  m = await waitFor(B.msgs, x => x.t === 'profile');
  ok('profil public: fara email (default privat)', m.user.email === undefined && m.user.firstName === 'C');
  A.ws.send(JSON.stringify({ t: 'updateProfile', show: { first: false, stats: false } }));
  await waitFor(A.msgs, x => x.t === 'auth');
  B.ws.send(JSON.stringify({ t: 'viewProfile', user: UC }));
  m = await waitFor(B.msgs, x => x.t === 'profile');
  ok('profil dupa hide: fara prenume/rating', m.user.firstName === undefined && m.user.rating === undefined && m.user.level === 1);

  // --- 5. newUsers + leaderboard ---
  A.ws.send(JSON.stringify({ t: 'newUsers', limit: 5 }));
  m = await waitFor(A.msgs, x => x.t === 'newUsers');
  ok('newUsers contine contul', m.list.some(x => x.name === UC));
  A.ws.send(JSON.stringify({ t: 'leaderboard', q: UC, limit: 5 }));
  m = await waitFor(A.msgs, x => x.t === 'leaderboard');
  ok('leaderboard cu cautare', m.list.some(x => x.name === UC));

  // --- 6. admin: promovare via config, get/save, users, reset, ads, prune ---
  const cfgPath = path.join(DIR, 'config.json');
  const cfgBak = fs.readFileSync(cfgPath, 'utf8');
  const cfg = JSON.parse(cfgBak);
  cfg.adminEmails.push(EC);
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 1));
  A.ws.send(JSON.stringify({ t: 'login', user: UC, pass: 'parola1' }));
  m = await waitFor(A.msgs, x => x.t === 'auth' && x.user);
  ok('flag admin din config', m.isAdmin === true);
  A.ws.send(JSON.stringify({ t: 'adminGetConfig' }));
  m = await waitFor(A.msgs, x => x.t === 'adminConfig');
  ok('adminGetConfig', !!m.config && !!m.config.rating);
  const newCfg = m.config;
  newCfg.rating.kHuman = 30;
  A.ws.send(JSON.stringify({ t: 'adminSaveConfig', config: newCfg }));
  m = await waitFor(A.msgs, x => x.t === 'adminConfig' && x.saved);
  ok('adminSaveConfig persista', JSON.parse(fs.readFileSync(cfgPath, 'utf8')).rating.kHuman === 30);
  A.ws.send(JSON.stringify({ t: 'adminUsers', q: UC }));
  m = await waitFor(A.msgs, x => x.t === 'adminUsers');
  ok('adminUsers vede tot (email)', m.list.some(x => x.email === EC.toLowerCase()));
  A.ws.send(JSON.stringify({ t: 'adminResetPass', user: UC }));
  await waitFor(A.msgs, x => x.t === 'adminDone');
  mail = outboxLast('reset', EC);
  ok('adminResetPass trimite email', !!mail && !!mail.token);

  // --- 7. ads: order -> pay -> active ---
  A.ws.send(JSON.stringify({ t: 'adOrder', title: 'Test Ad', img: '', link: 'https://ex.ro', slot: 'side', start: '2020-01-01', end: '2030-01-01' }));
  m = await waitFor(A.msgs, x => x.t === 'adOrdered');
  const adId = m.id;
  ok('adOrder pending', !!adId);
  A.ws.send(JSON.stringify({ t: 'ads' }));
  m = await waitFor(A.msgs, x => x.t === 'ads');
  ok('reclama neplatita nu apare', !m.list.some(x => x.id === adId));
  A.ws.send(JSON.stringify({ t: 'adPay', id: adId }));
  m = await waitFor(A.msgs, x => x.t === 'ads');
  ok('dupa achitare apare automat', m.list.some(x => x.id === adId));
  A.ws.send(JSON.stringify({ t: 'adminAds' }));
  m = await waitFor(A.msgs, x => x.t === 'adminAds');
  ok('admin vede comanda', m.list.some(x => x.id === adId && x.paid));
  A.ws.send(JSON.stringify({ t: 'buyPremium' }));
  m = await waitFor(A.msgs, x => x.t === 'auth' && x.user);
  ok('buyPremium seteaza flag', m.premium === true);

  // --- 8. prune in-process (determinist): neconfirmat + warning + inactiv ---
  const srv = require('./server.js');
  const tdb = srv.testHooks.db();
  const day = 86400e3, now = Date.now();
  const base = { emailConfirmed: true, passHash: 'x', salt: '', rating: 1000, games: 0, wins: 0, losses: 0, draws: 0, firstName: '', lastName: '', show: { first: true, last: false, email: false, stats: true }, lang: 'ro', premium: false, warned: {} };
  tdb.users['w_warn'] = Object.assign({ name: 'w_warn', email: 'w@x.ro', active: true, createdAt: now - 50 * day, lastLogin: now - 39.5 * day }, base);
  tdb.users['w_old'] = Object.assign({ name: 'w_old', email: 'o@x.ro', active: false, emailConfirmed: false, passHash: null, createdAt: now - 61 * 60e3, lastLogin: 0 }, base);
  let live = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  live.prune.unactivatedMinutes = 60; live.prune.inactiveDays = 100; live.prune.warnDays = [60, 30, 1];
  fs.writeFileSync(cfgPath, JSON.stringify(live, null, 1));
  let rep = srv.sweepOnce();
  ok('prune sterge neconfirmat', (rep.deletedUnactivated || []).includes('w_old'));
  ok('warning 60 zile trimis', (rep.warned || []).some(x => x.startsWith('w_warn')));
  mail = outboxLast('warn', 'w@x.ro');
  ok('email warning in outbox', !!mail);
  live.prune.inactiveDays = 30;
  fs.writeFileSync(cfgPath, JSON.stringify(live, null, 1));
  rep = srv.sweepOnce();
  ok('inactiv sters', (rep.deletedInactive || []).includes('w_warn'));
  delete tdb.users['w_warn']; delete tdb.users['w_old'];
  // --- 9. delete account flow (cont proaspat) ---
  const UD = `uD${S}`, ED = `${UD}@x.ro`;
  const E = await connect();
  E.ws.send(JSON.stringify({ t: 'register', firstName: 'D', lastName: 'E', username: UD, email: ED }));
  await waitFor(E.msgs, x => x.t === 'registered');
  mail = outboxLast('confirm', ED);
  E.ws.send(JSON.stringify({ t: 'confirmEmail', token: mail.token }));
  m = await waitFor(E.msgs, x => x.t === 'confirmed');
  E.ws.send(JSON.stringify({ t: 'setPassword', token: m.setToken, pass: 'parola9' }));
  await waitFor(E.msgs, x => x.t === 'passwordSet');
  E.ws.send(JSON.stringify({ t: 'login', user: UD, pass: 'parola9' }));
  await waitFor(E.msgs, x => x.t === 'auth' && x.user);
  E.ws.send(JSON.stringify({ t: 'deleteAccount', password: 'gresit' }));
  m = await waitFor(E.msgs, x => x.t === 'error');
  ok('delete cu parola gresita respins', !!m.reason);
  E.ws.send(JSON.stringify({ t: 'deleteAccount', password: 'parola9' }));
  await waitFor(E.msgs, x => x.t === 'deleteSent');
  mail = outboxLast('del', ED);
  ok('email stergere in outbox', !!mail && !!mail.token);
  E.ws.send(JSON.stringify({ t: 'confirmDelete', token: mail.token }));
  await waitFor(E.msgs, x => x.t === 'deleted');
  E.ws.send(JSON.stringify({ t: 'login', user: UD, pass: 'parola9' }));
  m = await waitFor(E.msgs, x => x.t === 'error');
  ok('cont sters: login esueaza', !!m.reason);

  // --- 10. lang: eroare in engleza ---
  const F = await connect();
  F.ws.send(JSON.stringify({ t: 'hello', lang: 'en' }));
  await sleep(200);
  F.ws.send(JSON.stringify({ t: 'join', code: 'ZZZZ' }));
  m = await waitFor(F.msgs, x => x.t === 'error');
  ok('eroare in EN', m.reason === 'Table does not exist');
  F.ws.close();

  // restore config
  fs.writeFileSync(cfgPath, cfgBak);
  console.log(`\n${pass}/${total} teste trecute`);
  A.ws.close(); B.ws.close(); E.ws.close();
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('FAIL exceptie:', e.message); process.exit(1); });

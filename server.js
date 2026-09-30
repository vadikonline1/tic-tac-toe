// TIC-TAK-TOK server v3: conturi cu confirmare email, profiluri + privacy, admin,
// reclame, curatare automata, i18n (ro/en/ru), mese waiting-only, bot-fill, rematch.
const fs = require('fs');
const path = require('path');
// .env se incarca PRIMUL (variabilele reale de mediu bat fisierul .env)
(function loadEnvFile() {
  try {
    const f = path.join(__dirname, '.env');
    if (!fs.existsSync(f)) return;
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const i = t.indexOf('=');
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (k && !(k in process.env)) process.env[k] = v;
    }
  } catch (e) {}
})();
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const L = require('./levels');
const { chooseMove } = require('./bot');
const { tr, langOf } = require('./i18n_dict');

const PORT = Number(process.env.PORT || process.env.NET_PORT) || 8000;
const CONFIG_FILE = path.join(__dirname, 'config.json');
// ENV -> DB: valorile setate in ENV se importa in config.json la fiecare boot.
// Ce lipseste din ENV ramane configurabil din UI (admin) si persista in DB.
function nonEmpty(v) { return typeof v === 'string' ? v.trim() !== '' : v !== undefined && v !== null; }
function syncEnvToDb() {
  try {
    const cfg = L.getConfig();
    cfg.email = cfg.email || {};
    if (nonEmpty(process.env.SMTP_MODE)) cfg.email.mode = process.env.SMTP_MODE.trim();
    if (nonEmpty(process.env.SMTP_FROM)) cfg.email.from = process.env.SMTP_FROM.trim();
    cfg.email.smtp = cfg.email.smtp || {};
    if (nonEmpty(process.env.SMTP_HOST)) cfg.email.smtp.host = process.env.SMTP_HOST.trim();
    if (nonEmpty(process.env.SMTP_PORT)) cfg.email.smtp.port = Number(process.env.SMTP_PORT) || 587;
    if (process.env.SMTP_USER !== undefined) cfg.email.smtp.user = process.env.SMTP_USER;
    if (process.env.SMTP_PASS !== undefined) cfg.email.smtp.pass = process.env.SMTP_PASS;
    if (nonEmpty(process.env.ADSENSE_CLIENT)) { cfg.ads = cfg.ads || {}; cfg.ads.adsenseClient = process.env.ADSENSE_CLIENT.trim(); }
    const ae = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    if (ae) { cfg.adminEmails = cfg.adminEmails || []; if (!cfg.adminEmails.map(e => String(e).toLowerCase()).includes(ae)) cfg.adminEmails.push(process.env.ADMIN_EMAIL.trim()); }
    L.saveFullConfig(cfg);
  } catch (e) { console.error('[env] sync esuat:', e.message); }
}
syncEnvToDb();
const USERS_FILE = path.join(__dirname, 'users.json');
const ADS_FILE = path.join(__dirname, 'ads.json');
const OUTBOX = path.join(__dirname, 'outbox');
const SIZES = [1, 2, 3, 4, 5];
if (!fs.existsSync(OUTBOX)) fs.mkdirSync(OUTBOX, { recursive: true });

// ---------- config ----------
function appConfig() { return L.getConfig() /* rating/brackets */ || {}; }
function fullCfg() { return L.fullConfig(); }

// ---------- users ----------
let db = { users: {} };
try { if (fs.existsSync(USERS_FILE)) db = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch (e) { db = { users: {} }; }
function migrate(u) {
  u.email = u.email || ''; u.firstName = u.firstName || ''; u.lastName = u.lastName || '';
  u.show = Object.assign({ first: true, last: false, email: false, stats: true }, u.show || {});
  u.lang = u.lang || 'ro'; u.active = u.active !== false; u.emailConfirmed = !!u.emailConfirmed;
  u.passHash = u.passHash || null; u.salt = u.salt || '';
  u.games = u.games || 0; u.wins = u.wins || 0; u.losses = u.losses || 0; u.draws = u.draws || 0;
  u.rating = u.rating !== undefined ? u.rating : L.getConfig().rating.start;
  u.createdAt = u.createdAt || Date.now(); u.lastLogin = u.lastLogin || 0;
  u.warned = u.warned || {}; u.premium = !!u.premium; u.mustChangePass = !!u.mustChangePass;
  return u;
}
Object.values(db.users).forEach(migrate);
function saveDB() { try { fs.writeFileSync(USERS_FILE, JSON.stringify(db, null, 1)); } catch (e) {} }
// Bootstrap administrator: email/parola din ENV (daca sunt setate) sau default.
// Daca ADMIN_PASSWORD e setat in ENV, parola se (re)aplica la fiecare boot
// iar schimbarea fortata se dezactiveaza. Altfel: Admin123! + schimbare fortata.
const ENV_ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const ENV_ADMIN_PASS = process.env.ADMIN_PASSWORD || '';
const BOOT_ADMIN_EMAIL = ENV_ADMIN_EMAIL || 'admin@matroshka.local';
const BOOT_ADMIN_PASS = ENV_ADMIN_PASS || 'Admin123!';
(function bootstrapAdmin() {
  const key = BOOT_ADMIN_EMAIL.split('@')[0].replace(/[^a-z0-9_-]/gi, '') || 'admin';
  const existingKey = Object.keys(db.users).find(k => (db.users[k].email || '').toLowerCase() === BOOT_ADMIN_EMAIL);
  const salt = crypto.randomBytes(8).toString('hex');
  if (!existingKey) {
    db.users[key] = migrate({
      name: BOOT_ADMIN_EMAIL.split('@')[0], email: BOOT_ADMIN_EMAIL, firstName: 'Admin', lastName: '',
      active: true, emailConfirmed: true, passHash: hashPass(BOOT_ADMIN_PASS, salt), salt,
      rating: L.getConfig().rating.start, mustChangePass: !ENV_ADMIN_PASS,
    });
    saveDB();
    console.log(`BOOTSTRAP admin creat: ${BOOT_ADMIN_EMAIL} (schimbare fortata: ${!ENV_ADMIN_PASS})`);
  } else if (ENV_ADMIN_PASS) {
    const u = db.users[existingKey];
    u.salt = salt;
    u.passHash = hashPass(ENV_ADMIN_PASS, salt);
    u.mustChangePass = false;
    u.active = true; u.emailConfirmed = true;
    saveDB();
    console.log(`BOOTSTRAP admin parola aplicata din ENV pentru: ${BOOT_ADMIN_EMAIL}`);
  }
  try {
    const cfgRaw = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
    if (!(cfgRaw.adminEmails || []).map(e => String(e).toLowerCase()).includes(BOOT_ADMIN_EMAIL)) {
      cfgRaw.adminEmails = [...(cfgRaw.adminEmails || []), BOOT_ADMIN_EMAIL];
      fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(cfgRaw, null, 1));
    }
  } catch (e) {}
})();
function hashPass(pass, salt) { return crypto.createHash('sha256').update(salt + ':' + pass).digest('hex'); }
function isAdminRec(u) {
  if (!u || !u.email) return false;
  const list = (fullCfg().adminEmails || []).map(e => String(e).toLowerCase());
  return list.includes(String(u.email).toLowerCase());
}
// ---- roluri + sesiuni: o singura logica unitara ----
// roluri: 'anon' (fara cont), 'user' (logat), 'admin' (email in adminEmails)
function roleOf(ws) {
  const u = userOf(ws);
  if (!u) return 'anon';
  return isAdminRec(u) ? 'admin' : 'user';
}
function roleStr(u) {
  if (!u) return 'guest';
  return isAdminRec(u) ? 'admin' : 'user';
}
function needLogin(ws, err) {
  const u = userOf(ws);
  if (!u) { err('au.need'); return null; }
  return u;
}
function needAdmin(ws, err) {
  const u = userOf(ws);
  if (!u || !isAdminRec(u)) { err('e.noAdmin'); return null; }
  return u;
}
function createSession(key) {
  const token = crypto.randomBytes(16).toString('hex');
  sessions.set(token, { user: key, exp: Date.now() + 30 * 86400e3 });
  saveSessions();
  return token;
}
function pubUser(rec, lang, opts = {}) {
  const level = L.levelFor(rec.rating);
  const base = { name: rec.name, level, levelName: lname(lang, level), memberSince: rec.createdAt, premium: !!rec.premium };
  const full = opts.self || opts.admin;
  if (full || rec.show.stats) Object.assign(base, { rating: rec.rating, games: rec.games, wins: rec.wins, losses: rec.losses, draws: rec.draws });
  if (full || rec.show.first) base.firstName = rec.firstName;
  if (full || rec.show.last) base.lastName = rec.lastName;
  if (full || rec.show.email) base.email = rec.email;
  if (opts.admin) { base.active = rec.active; base.emailConfirmed = rec.emailConfirmed; base.lastLogin = rec.lastLogin; }
  return base;
}
const sessions = new Map(); // token -> {user, exp} (persistente pe disc: restartul nu delogheaza)
const SESS_FILE = path.join(__dirname, 'sessions.json');
const HIDDEN_USER = 'admin'; // contul bootstrap nu apare in listari publice
function saveSessions() {
  try {
    const o = {};
    for (const [tk, s] of sessions) o[tk] = s;
    fs.writeFileSync(SESS_FILE, JSON.stringify(o));
  } catch (e) {}
}
function dropSessionsOf(key) {
  let changed = false;
  for (const [tk, s] of [...sessions]) if (s && s.user === key) { sessions.delete(tk); changed = true; }
  if (changed) saveSessions();
}
(function loadSessions() {
  try {
    if (!fs.existsSync(SESS_FILE)) return;
    const o = JSON.parse(fs.readFileSync(SESS_FILE, 'utf8'));
    for (const [tk, s] of Object.entries(o)) {
      if (s && s.user && s.exp > Date.now() && db.users[s.user]) sessions.set(tk, s);
    }
    console.log(`sesiuni restaurate: ${sessions.size}`);
  } catch (e) { console.error('loadSessions:', e.message); }
})();
function sessionUser(token) {
  const s = sessions.get(token);
  if (!s || s.exp < Date.now() || !db.users[s.user]) { if (s) { sessions.delete(token); saveSessions(); } return null; }
  return s.user;
}
function userOf(ws) { return (ws._user && db.users[ws._user]) ? db.users[ws._user] : null; }
function levelOf(ws) { const u = userOf(ws); return u ? L.levelFor(u.rating) : 1; }
function ulogin(ws) { const u = userOf(ws); return !!u; }

// ---------- tokens + outbox mail ----------
const tokens = {}; // token -> {kind,user,exp}
function newToken(kind, user, hours) {
  const t = crypto.randomBytes(12).toString('hex');
  tokens[t] = { kind, user, exp: Date.now() + hours * 3600e3 };
  return t;
}
function useToken(t, kind) {
  const e = tokens[t];
  if (!e || e.kind !== kind || e.exp < Date.now()) return null;
  delete tokens[t];
  return e;
}
function writeOutbox(toEmail, subject, body, token, link, kind) {
  const file = `MAIL_${Date.now()}_${kind}_${String(toEmail).replace(/[^a-z0-9@._-]/gi, '_')}.json`;
  try { fs.writeFileSync(path.join(OUTBOX, file), JSON.stringify({ to: toEmail, subject, body, token, link, kind }, null, 1)); } catch (e) {}
}
let _mailer = null, _mailerKey = '';
function getMailer() {
  const em = (fullCfg().email) || {};
  if ((em.mode || 'outbox') !== 'smtp' || !em.smtp || !em.smtp.host) return null;
  try {
    const nodemailer = require('nodemailer');
    const key = em.smtp.host + '|' + (em.smtp.user || '');
    if (!_mailer || _mailerKey !== key) {
      _mailer = nodemailer.createTransport({
        host: em.smtp.host,
        port: Number(em.smtp.port) || 587,
        secure: Number(em.smtp.port) === 465,
        auth: em.smtp.user ? { user: em.smtp.user, pass: em.smtp.pass || '' } : undefined,
      });
      _mailerKey = key;
    }
    return _mailer;
  } catch (e) { return null; }
}
function sendMail(toEmail, toName, lang, kind, vars) {
  const subjects = { confirm: 'mail.confirmS', reset: 'mail.resetS', del: 'mail.deleteS', warn: 'mail.warnS' };
  const bodies = { confirm: 'mail.confirmB', reset: 'mail.resetB', del: 'mail.deleteB', warn: 'mail.warnB' };
  const tokenKinds = { confirm: 'confirm', reset: 'reset', del: 'del' };
  let token = null, link = '';
  if (tokenKinds[kind]) {
    token = newToken(tokenKinds[kind], vars.userKey, kind === 'confirm' ? 48 : 24);
    link = `confirm.html?kind=${tokenKinds[kind]}&token=${token}`;
  }
  const subject = tr(lang, subjects[kind], vars);
  const body = tr(lang, bodies[kind], Object.assign({}, vars, { t: token, l: link, n: toName }));
  const cfg = fullCfg();
  const from = (cfg.email && cfg.email.from) || 'noreply@tic-tak-tok.local';
  const mailer = getMailer();
  if (mailer) {
    mailer.sendMail({ from, to: toEmail, subject, text: body }, (err) => {
      if (err) { writeOutbox(toEmail, subject, body, token, link, kind); console.error('[mail] smtp esuat, fallback outbox:', err.message); }
      else console.log(`[mail] smtp -> ${toEmail}: ${subject}`);
    });
  } else {
    writeOutbox(toEmail, subject, body, token, link, kind);
  }
  return token;
}

// ---------- ads ----------
let adsDb = { orders: [], seq: 1 };
try { if (fs.existsSync(ADS_FILE)) adsDb = JSON.parse(fs.readFileSync(ADS_FILE, 'utf8')); } catch (e) {}
function saveAds() { try { fs.writeFileSync(ADS_FILE, JSON.stringify(adsDb, null, 1)); } catch (e) {} }
function adEffective(o, now) {
  if (o.status === 'rejected') return false;
  if (o.status === 'active') return true;
  if (o.paid) return true; // plasata + achitata -> activa automat
  return false;
}
function inWindow(o, now) {
  if (o.start && now < new Date(o.start).getTime()) return false;
  if (o.end && now > new Date(o.end).getTime()) return false;
  return true;
}
function activeAds() {
  const cfg = fullCfg();
  if (!cfg.ads || cfg.ads.enabled === false) return [];
  const now = Date.now();
  return adsDb.orders.filter(o => adEffective(o, now) && inWindow(o, now))
    .map(o => ({ id: o.id, title: o.title, img: o.img, link: o.link, slot: o.slot }));
}

// ---------- joc (tabla NxN) ----------
const rooms = new Map();
let nextId = 1;
function newBoard(size) { return Array.from({ length: size }, () => Array.from({ length: size }, () => [])); }
function newReserves(copies) { const mk = () => { const o = {}; for (const s of SIZES) o[s] = copies; return o; }; return { 1: mk(), 2: mk() }; }
function topOf(board, r, c) { const s = board[r][c]; return s.length ? s[s.length - 1] : null; }
function botName(level, lang) { return `🤖 Bot ${level}`; }
function T(ws, key, vars) { return tr(ws._lang || 'ro', key, vars); }
function lname(lang, level) {
  const { D } = require('./i18n_dict.js');
  const L2 = D[lang] || D.ro;
  if (L2['lv' + level] !== undefined) return L2['lv' + level];
  return tr(lang, 'lvx', { n: level });
}

function makeRoom(title, size, level, lang, maxPlayers) {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  do { code = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(code));
  const mp = Math.min(6, Math.max(2, Number(maxPlayers) || 2));
  const seats = {};
  for (let i = 1; i <= mp; i++) seats[i] = null;
  return {
    code, title: (title || 'Table ' + code).slice(0, 30), lang: lang || 'ro',
    size, winLen: L.winLenFor(size), copies: L.copiesFor(size), level, maxPlayers: mp,
    board: newBoard(size), reserves: (() => { const o = {}; for (let i = 1; i <= mp; i++) o[i] = newReserves(L.copiesFor(size))[1]; return o; })(),
    starter: 1, turn: 1, winner: null, isDraw: false, winCells: [], moveNo: 1,
    seats, votes: {}, rated: false, botTimer: null, turnTimer: null, deadline: null,
  };
}
function seatNums(room) { return Object.keys(room.seats).map(Number).sort((a, b) => a - b); }
function seatInfo(room, n) {
  const s = room.seats[n];
  if (!s) return { player: n, name: '—', bot: true, empty: true };
  return { player: n, name: s.name, bot: !!s.bot, empty: false };
}
function stateMsg(room) {
  return {
    t: 'state', code: room.code, title: room.title,
    size: room.size, winLen: room.winLen, copies: room.copies, level: room.level,
    levelName: lname(room.lang, room.level), maxPlayers: room.maxPlayers,
    board: room.board, reserves: room.reserves, turn: room.turn,
    starter: room.starter, winner: room.winner, isDraw: room.isDraw,
    winCells: room.winCells, moveNo: room.moveNo, deadline: room.deadline || null,
    seats: seatNums(room).map(n => seatInfo(room, n)),
    votes: Object.keys(room.votes).map(Number),
  };
}
function roomStatus(r) { return (r.winner || r.isDraw) ? 'ended' : r.moveNo > 1 ? 'live' : 'waiting'; }
function tablesMsg() {
  // in lista apar doar mesele care ASTEAPTA jucatori; cele in joc sunt ascunse
  return {
    t: 'tables',
    list: [...rooms.values()].filter(r => roomStatus(r) === 'waiting').map(r => ({
      code: r.code, title: r.title, size: r.size, level: r.level,
      levelName: lname(r.lang || 'ro', r.level), maxPlayers: r.maxPlayers,
      seats: seatNums(r).map(n => seatInfo(r, n)),
      humans: seatNums(r).filter(n => r.seats[n] && !r.seats[n].bot).map(n => r.seats[n].name),
    })),
  };
}
function send(ws, obj) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj));
}
function broadcast(room, obj) {
  const s = typeof obj === 'string' ? obj : JSON.stringify(obj);
  for (const n of seatNums(room)) { const seat = room.seats[n]; if (seat && seat.ws && seat.ws.readyState === 1) seat.ws.send(s); }
}
function sys(room, key, vars) { broadcast(room, { t: 'chat', from: 'Sistem', text: tr(room.lang || 'ro', key, vars), ts: Date.now() }); }
function broadcastTables(wss) { const m = JSON.stringify(tablesMsg()); wss.clients.forEach(c => { if (c.readyState === 1) c.send(m); }); }
function myTableOf(userKey) { for (const r of rooms.values()) for (const n of seatNums(r)) { const s = r.seats[n]; if (s && !s.bot && s.user === userKey) return r.code; } return null; }

function validMove(room, player, r, c, size) {
  if (room.winner || room.isDraw) return { ok: false, reason: 'end' };
  if (player !== room.turn) return { ok: false, reason: 'turn' };
  if (!room.seats[player]) return { ok: false, reason: 'cell' };
  if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || r >= room.size || c < 0 || c >= room.size) return { ok: false, reason: 'cell' };
  if (!SIZES.includes(size)) return { ok: false, reason: 'size' };
  if (!room.reserves[player][size]) return { ok: false, reason: 'used' };
  const t = topOf(room.board, r, c);
  if (!t) return { ok: true };
  if (size > t.size) return { ok: true, cover: true, over: t.size };
  return { ok: false, reason: 'blocked', over: t.size };
}
function moveErrorText(ws, e, size) {
  const L2 = ws._lang || 'ro';
  if (e.reason === 'used') return tr(L2, 'g.used');
  if (e.reason === 'blocked') return tr(L2, 'g.blocked', { t: e.over, s: size });
  if (e.reason === 'turn') return tr(L2, 'g.wait');
  return tr(L2, 'g.pick');
}
function anyMove(room, player) {
  const keep = room.turn; room.turn = player;
  let found = false;
  outer: for (let r = 0; r < room.size; r++) for (let c = 0; c < room.size; c++) for (const s of SIZES) {
    if (validMove(room, player, r, c, s).ok) { found = true; break outer; }
  }
  room.turn = keep; return found;
}
function checkWin(room) {
  const { board, size, winLen } = room;
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) for (const [dr, dc] of dirs) {
    const er = r + dr * (winLen - 1), ec = c + dc * (winLen - 1);
    if (er < 0 || er >= size || ec < 0 || ec >= size) continue;
    const pr = r - dr, pc = c - dc;
    if (pr >= 0 && pr < size && pc >= 0 && pc < size) continue;
    const a = topOf(board, r, c);
    if (!a) continue;
    let ok = true;
    for (let i = 1; i < winLen; i++) { const t = topOf(board, r + dr * i, c + dc * i); if (!t || t.player !== a.player) { ok = false; break; } }
    if (ok) { const cells = []; for (let i = 0; i < winLen; i++) cells.push([r + dr * i, c + dc * i]); return { player: a.player, cells }; }
  }
  return null;
}
// urmatorul loc (in rotatie) care mai are mutari; null daca nimeni nu mai are
function nextWithMoves(room, from) {
  const nums = seatNums(room);
  for (let i = 1; i <= nums.length; i++) {
    const n = nums[(nums.indexOf(from) + i) % nums.length];
    if (anyMove(room, n)) return n;
  }
  return null;
}
function settleRating(room) {
  if (room.rated) return [];
  room.rated = true;
  const cfg = L.getConfig().rating;
  const nums = seatNums(room);
  const humans = nums.filter(n => room.seats[n] && !room.seats[n].bot && room.seats[n].user && db.users[room.seats[n].user]);
  if (!humans.length) return [];
  const rOf = n => {
    const s = room.seats[n];
    if (s && !s.bot && s.user && db.users[s.user]) return db.users[s.user].rating;
    return (!s || s.bot) ? L.botRatingFor(room.level) : cfg.anonRating;
  };
  const out = [];
  const bump = (rec, delta, score) => {
    rec.rating = Math.max(0, rec.rating + delta); rec.games++;
    if (score === 1) rec.wins++; else if (score === 0) rec.losses++; else rec.draws++;
  };
  if (room.isDraw) {
    for (const n of humans) {
      const others = nums.filter(x => x !== n).map(rOf);
      const avg = others.reduce((a, b) => a + b, 0) / others.length;
      const rec = db.users[room.seats[n].user];
      const d = L.eloDelta(rec.rating, avg, 0.5, Math.round(cfg.kHuman / 2));
      bump(rec, d, 0.5);
      out.push({ seat: n, delta: d, rating: rec.rating });
    }
  } else if (room.winner) {
    const w = room.winner;
    const wHum = humans.includes(w) ? db.users[room.seats[w].user] : null;
    const oppR = nums.filter(x => x !== w).map(rOf);
    const avg = oppR.reduce((a, b) => a + b, 0) / oppR.length;
    if (wHum) {
      const d = L.eloDelta(wHum.rating, avg, 1, cfg.kHuman);
      bump(wHum, d, 1);
      out.push({ seat: w, delta: d, rating: wHum.rating });
    }
    const wOld = wHum ? wHum.rating - (out.find(o => o.seat === w)?.delta || 0) : rOf(w);
    const KLose = wHum ? Math.max(8, Math.round(cfg.kHuman / Math.max(1, humans.length - 1))) : cfg.kBot;
    for (const n of humans.filter(x => x !== w)) {
      const rec = db.users[room.seats[n].user];
      const d = L.eloDelta(rec.rating, wOld, 0, KLose);
      bump(rec, d, 0);
      out.push({ seat: n, delta: d, rating: rec.rating });
    }
  }
  saveDB();
  return out;
}
function applyServerMove(room, player, move) {
  const v = validMove(room, player, move.r, move.c, move.size);
  if (!v.ok) return v;
  room.board[move.r][move.c].push({ player, size: move.size });
  room.reserves[player][move.size]--;
  room.moveNo++; room.votes = {};
  const w = checkWin(room);
  if (w) { room.winner = w.player; room.winCells = w.cells; }
  else {
    // rotatie: urmatorul cu mutari valide; remiza daca nimeni nu mai are
    const nxt = nextWithMoves(room, player);
    if (nxt === null) room.isDraw = true;
    else room.turn = nxt;
  }
  return { ok: true };
}
function afterMoveCommon(wss, room) {
  broadcast(room, stateMsg(room));
  broadcastTables(wss);
  if ((room.winner || room.isDraw) && !room.rated) {
    for (const d of settleRating(room)) {
      const seat = room.seats[d.seat];
      const lang = (seat && seat.ws && seat.ws._lang) || room.lang || 'ro';
      const txt = tr(lang, 'n.rated', { d: (d.delta >= 0 ? '+' : '') + d.delta, r: d.rating, lv: lname(lang, L.levelFor(d.rating)) });
      if (seat && seat.ws) send(seat.ws, { t: 'notice', text: txt });
      if (seat && seat.user && db.users[seat.user] && seat.ws) send(seat.ws, { t: 'auth', user: pubUser(db.users[seat.user], seat.ws._lang || 'ro', { self: true }) });
    }
  }
  scheduleBot(wss, room); armTurnTimer(wss, room);
}
function scheduleBot(wss, room) {
  if (room.botTimer) { clearTimeout(room.botTimer); room.botTimer = null; }
  if (room.winner || room.isDraw) return;
  const seat = room.seats[room.turn];
  if (!seat || !seat.bot) return;
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    if (room.winner || room.isDraw) return;
    const cur = room.seats[room.turn];
    if (!cur || !cur.bot) return;
    try {
      const snap = {
        board: room.board.map(row => row.map(cell => cell.map(p => ({ ...p })))),
        reserves: JSON.parse(JSON.stringify(room.reserves)),
        size: room.size, winLen: room.winLen, turn: room.turn,
      };
      const m = chooseMove(snap, room.level, { timeLimit: 900 });
      if (!m) { room.isDraw = true; afterMoveCommon(wss, room); return; }
      if (!applyServerMove(room, room.turn, m).ok) {
        let done = false;
        outer: for (let rr = 0; rr < room.size && !done; rr++) for (let cc = 0; cc < room.size && !done; cc++) for (const s of SIZES) {
          if (applyServerMove(room, room.turn, { r: rr, c: cc, size: s }).ok) { done = true; break outer; }
        }
        if (!done) room.isDraw = true;
      }
    } catch (e) {}
    afterMoveCommon(wss, room);
  }, 650);
}
function resetRoom(room) {
  if (room.botTimer) { clearTimeout(room.botTimer); room.botTimer = null; }
  clearTurn(room);
  for (const n of seatNums(room)) clearGrace(room.seats[n]);
  room.board = newBoard(room.size);
  room.reserves = (() => { const o = {}; for (const i of seatNums(room)) o[i] = newReserves(room.copies)[1]; return o; })();
  const nums = seatNums(room);
  room.starter = nums[(nums.indexOf(room.starter) + 1) % nums.length];
  room.turn = room.starter;
  room.winner = null; room.isDraw = false; room.winCells = []; room.moveNo = 1;
  room.votes = {}; room.rated = false;
}
function humansOf(room) { return seatNums(room).filter(n => room.seats[n] && !room.seats[n].bot && room.seats[n].ws); }
const GRACE_MS = Number(process.env.GRACE_MS) || 60e3; // cat pastram locul la deconectare inainte sa preia botul
const TURN_MS = Number(process.env.TURN_MS) || 30e3; // timp/mutare; la expirare muta botul
function clearTurn(room) { if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; } room.deadline = null; }
function armTurnTimer(wss, room) {
  clearTurn(room);
  if (room.winner || room.isDraw) return;
  const seat = room.seats[room.turn];
  if (!seat || seat.bot) return; // tura botului o face scheduleBot
  const who = room.turn, mv = room.moveNo;
  room.deadline = Date.now() + TURN_MS;
  room.turnTimer = setTimeout(() => {    room.turnTimer = null;
    if (room.winner || room.isDraw || room.turn !== who || room.moveNo !== mv) return;
    const cur = room.seats[who];
    if (!cur || cur.bot) return;
    try {
      const snap = {
        board: room.board.map(rw => rw.map(cell => cell.map(p => ({ ...p })))),
        reserves: JSON.parse(JSON.stringify(room.reserves)),
        size: room.size, winLen: room.winLen, turn: who, maxPlayers: room.maxPlayers,
      };
      const m = chooseMove(snap, room.level, { timeLimit: 800 });
      if (m && applyServerMove(room, who, m).ok) {
        sys(room, 'sys.timeout', { n: cur.name });
        afterMoveCommon(wss, room);
      } else clearTurn(room);
    } catch (e) { clearTurn(room); }
  }, TURN_MS);
  broadcast(room, stateMsg(room)); // clientii vad deadline-ul
}
function clearGrace(seat) { if (seat && seat.graceTimer) { clearTimeout(seat.graceTimer); seat.graceTimer = null; } }
function graceExpire(wss, room, n) {
  const seat = room.seats[n];
  if (!seat || seat.ws || seat.bot) return;
  room.seats[n] = { bot: true, name: botName(room.level, room.lang) };
  sys(room, 'sys.left', { n: seat.name, b: botName(room.level, room.lang) });
  broadcast(room, stateMsg(room));
  if (!humansOf(room).length) { if (room.botTimer) clearTimeout(room.botTimer); rooms.delete(room.code); }
  else scheduleBot(wss, room); armTurnTimer(wss, room);
  broadcastTables(wss);
}
// plecare voluntara: botul preia imediat
function removeSeat(wss, room, ws, msgKey, vars) {
  for (const n of seatNums(room)) {
    const s = room.seats[n];
    if (s && s.ws === ws) { clearGrace(s); room.seats[n] = { bot: true, name: botName(room.level, room.lang) }; }
  }
  if (ws._room === room.code) { ws._room = null; ws._player = null; }
  if (msgKey) sys(room, msgKey, vars);
  if (!humansOf(room).length) {
    if (room.botTimer) clearTimeout(room.botTimer);
    rooms.delete(room.code);
  } else scheduleBot(wss, room); armTurnTimer(wss, room);
  broadcastTables(wss);
}
// cadere conexiune: pastram locul 60s pentru reconectare
function dropSeat(wss, room, ws) {
  let seatNum = null, name = ws._name;
  for (const n of seatNums(room)) {
    const s = room.seats[n];
    if (s && s.ws === ws) { seatNum = n; name = s.name; s.ws = null; s.gone = Date.now(); clearGrace(s); }
  }
  if (seatNum === null) return;
  if (ws._room === room.code) { ws._room = null; ws._player = null; }
  const seat = room.seats[seatNum];
  if (!seat.user) { // anonim fara identitate: botul preia imediat
    room.seats[seatNum] = { bot: true, name: botName(room.level, room.lang) };
    sys(room, 'sys.left', { n: name, b: botName(room.level, room.lang) });
    broadcast(room, stateMsg(room));
    if (!humansOf(room).length) { if (room.botTimer) clearTimeout(room.botTimer); rooms.delete(room.code); }
    else scheduleBot(wss, room); armTurnTimer(wss, room);
    broadcastTables(wss);
    return;
  }
  seat.graceTimer = setTimeout(() => graceExpire(wss, room, seatNum), GRACE_MS);
  sys(room, 'sys.reconn', { n: name });
  broadcast(room, stateMsg(room));
  broadcastTables(wss);
}

// ---------- curatare automata ----------
function sweepOnce() {
  const cfg = fullCfg();
  const now = Date.now();
  const rep = { deletedUnactivated: [], deletedInactive: [], warned: [] };
  const unMin = (cfg.prune && cfg.prune.unactivatedMinutes) || 60;
  const inDays = (cfg.prune && cfg.prune.inactiveDays) || 365;
  const warns = ((cfg.prune && cfg.prune.warnDays) || [60, 30, 1]).map(Number);
  for (const [key, u] of Object.entries(db.users)) {
    if (!u.active || !u.emailConfirmed || !u.passHash) {
      if (now - u.createdAt > unMin * 60e3) { rep.deletedUnactivated.push(u.name); delete db.users[key]; }
      continue;
    }
    const last = u.lastLogin || u.createdAt;
    const daysLeft = inDays - (now - last) / 86400e3;
    if (daysLeft <= 0) {
      rep.deletedInactive.push(u.name);
      dropSessionsOf(key);
      for (const r of rooms.values()) for (const n of seatNums(r)) {
        const st = r.seats[n];
        if (st && st.user === key) r.seats[n] = { bot: true, name: botName(r.level, r.lang) };
      }
      delete db.users[key];
    } else {
      const fl = Math.floor(daysLeft);
      if (warns.includes(fl) && !u.warned[fl]) {
        u.warned[fl] = true;
        sendMail(u.email, u.name, u.lang || 'ro', 'warn', { d: fl });
        rep.warned.push(`${u.name}:${fl}`);
      }
    }
  }
  if (rep.deletedUnactivated.length || rep.deletedInactive.length || rep.warned.length) saveDB();
  return rep;
}
setInterval(() => { try { sweepOnce(); } catch (e) {} }, 5 * 60e3);
process.on('uncaughtException', e => console.error('[server] exceptie prinsa (ramane pornit):', e.message));

// ---------- server HTTP (static + WS pe acelasi port 8000) ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const BLOCKED_FILES = new Set(['users.json', 'sessions.json', 'config.json', 'ads.json', 'server.js', 'bot.js', 'levels.js', 'package.json', 'package-lock.json']);
function blockedPath(rel) {
  const r = rel.replace(/\\/g, '/');
  if (r.startsWith('node_modules/') || r.startsWith('outbox/') || r.startsWith('.')) return true;
  const base = r.split('/').pop();
  if (BLOCKED_FILES.has(base)) return true;
  if (base.startsWith('__test_') || base.startsWith('__dbg') || base.startsWith('__tmp')) return true;
  return false;
}
const server = http.createServer((req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/health') { res.writeHead(200); res.end('ok'); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    let p = decodeURIComponent(u.pathname);
    if (p.endsWith('/')) p += 'index.html';
    const full = path.normalize(path.join(__dirname, p));
    if (!full.startsWith(__dirname)) { res.writeHead(403); res.end(); return; }
    if (blockedPath(path.relative(__dirname, full))) { res.writeHead(404); res.end(); return; }
    fs.readFile(full, (err, data) => {
      if (err) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  } catch (e) { try { res.writeHead(500); res.end(); } catch (_) {} }
});
const wss = new WebSocketServer({ server });
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

wss.on('connection', (ws) => {
  ws._id = nextId++;
  ws._name = 'Anonim' + ws._id;
  ws._lang = 'ro';
  ws._user = null; ws._room = null; ws._player = null;
  const mePayload = () => {
    const u = userOf(ws);
    const cfg = L.getConfig();
    return {
      t: 'auth', user: u ? pubUser(u, ws._lang, { self: true }) : null,
      isAdmin: !!(u && isAdminRec(u)), role: roleStr(u),
      guest: ws._name, allowedSizes: L.allowedSizes(levelOf(ws)), myLevel: levelOf(ws),
      myTable: u ? myTableOf(ws._user) : null,
      premium: !!(u && u.premium),
      brackets: cfg.brackets, maxLevel: L.maxLevel(),
    };
  };
  send(ws, { t: 'welcome', id: ws._id });
  // NU trimitem auth aici: primul auth vine ca raspuns la hello (altfel clientii vad guest fals).

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    const err = (key, vars) => send(ws, { t: 'error', reason: tr(ws._lang, key, vars) });

    if (m.t === 'hello') {
      if (m.lang) ws._lang = langOf(m.lang);
      if (typeof m.name === 'string' && m.name.trim() && !ws._user) ws._name = m.name.trim().slice(0, 24);
      if (typeof m.token === 'string' && m.token) {
        const uname = sessionUser(m.token);
        if (db.users[uname]) {
          ws._user = uname; ws._name = db.users[uname].name;
          ws._lang = langOf(db.users[uname].lang || ws._lang);
          db.users[uname].lastLogin = Date.now(); saveDB();
        }
      }
      send(ws, mePayload());
    }

    else if (m.t === 'register') {
      const already = userOf(ws);
      if (already) return err('e.already', { n: already.name });
      const firstName = String(m.firstName || '').trim().slice(0, 40);
      const lastName = String(m.lastName || '').trim().slice(0, 40);
      const username = String(m.username || m.user || '').trim();
      const email = String(m.email || '').trim().toLowerCase();
      if (!/^[A-Za-z0-9_-]{2,16}$/.test(username)) return err('e.badUser');
      if (!emailRe.test(email)) return err('e.badMail');
      const key = username.toLowerCase();
      if (db.users[key] || Object.values(db.users).some(u => u.email === email)) return err('e.taken');
      db.users[key] = migrate({
        name: username, email, firstName, lastName,
        active: false, emailConfirmed: false, passHash: null,
        rating: L.getConfig().rating.start,
      });
      saveDB();
      sendMail(email, username, ws._lang, 'confirm', { userKey: key, n: username });
      send(ws, { t: 'registered', pending: true });
    }

    else if (m.t === 'confirmEmail') {
      const e = useToken(String(m.token || ''), 'confirm');
      if (!e || !db.users[e.user]) return err('e.badToken');
      const u = db.users[e.user];
      u.emailConfirmed = true; saveDB();
      const setT = newToken('setpass', e.user, 24);
      send(ws, { t: 'confirmed', setToken: setT });
    }

    else if (m.t === 'setPassword') {
      const e = useToken(String(m.token || ''), 'setpass');
      if (!e || !db.users[e.user]) return err('e.badToken');
      if (String(m.pass || '').length < 4) return err('e.badPass');
      const u = db.users[e.user];
      if (!u.emailConfirmed) return err('e.waitMail');
      u.salt = crypto.randomBytes(8).toString('hex');
      u.passHash = hashPass(m.pass, u.salt);
      u.active = true; saveDB();
      send(ws, { t: 'passwordSet' });
    }

    else if (m.t === 'login') {
      const id = String(m.user || '').trim().toLowerCase();
      const rec = db.users[id] || Object.values(db.users).find(u => u.email === id);
      if (!rec || !rec.passHash || rec.passHash !== hashPass(String(m.pass || ''), rec.salt)) return err('e.badLogin');
      if (!rec.active || !rec.emailConfirmed) return err('e.needActive');
      const key = Object.keys(db.users).find(k => db.users[k] === rec);
      if (rec.mustChangePass) {
        const changeToken = newToken('change', key, 1);
        return send(ws, { t: 'mustChange', changeToken, isAdmin: isAdminRec(rec) });
      }
      const token = createSession(key);
      ws._user = key; ws._name = rec.name;
      ws._lang = langOf(rec.lang || ws._lang);
      rec.lastLogin = Date.now(); rec.warned = {}; saveDB();
      const seat = ws._room && rooms.has(ws._room) ? rooms.get(ws._room).seats[ws._player] : null;
      if (seat && seat.ws === ws) { seat.name = rec.name; seat.user = key; seat.anon = false; broadcast(rooms.get(ws._room), stateMsg(rooms.get(ws._room))); }
      send(ws, { t: 'auth', user: pubUser(rec, ws._lang, { self: true }), token, role: roleStr(rec), isAdmin: isAdminRec(rec), allowedSizes: L.allowedSizes(levelOf(ws)), myLevel: levelOf(ws), myTable: myTableOf(key), premium: !!rec.premium, brackets: L.getConfig().brackets, maxLevel: L.maxLevel() });
    }

    else if (m.t === 'logout') {
      ws._user = null; ws._name = 'Anonim' + ws._id;
      send(ws, mePayload());
    }

    else if (m.t === 'forgot') {
      const id = String(m.email || '').trim().toLowerCase();
      const rec = Object.values(db.users).find(u => u.email === id);
      if (rec) { const key = Object.keys(db.users).find(k => db.users[k] === rec); sendMail(rec.email, rec.name, rec.lang || 'ro', 'reset', { userKey: key, n: rec.name }); }
      send(ws, { t: 'forgotSent' }); // mereu ok (anti-enumerare)
    }

    else if (m.t === 'changePass') {
      // flux fortat (token dupa login cu parola implicita) sau voluntar (logat + parola veche)
      let rec = null, key = null;
      if (m.token) {
        const e = useToken(String(m.token), 'change');
        if (!e || !db.users[e.user]) return err('e.badToken');
        key = e.user; rec = db.users[key];
      } else {
        rec = userOf(ws);
        if (!rec) return err('au.need');
        if (!rec.passHash || rec.passHash !== hashPass(String(m.old || ''), rec.salt)) return err('e.badLogin');
        key = ws._user;
      }
      if (String(m.pass || '').length < 4) return err('e.badPass');
      rec.salt = crypto.randomBytes(8).toString('hex');
      rec.passHash = hashPass(m.pass, rec.salt);
      rec.mustChangePass = false; rec.active = true; rec.emailConfirmed = true; saveDB();
      const key2 = Object.keys(db.users).find(k => db.users[k] === rec);
      const token2 = createSession(key2);
      ws._user = key2; ws._name = rec.name;
      send(ws, { t: 'passwordSet', token: token2, user: pubUser(rec, ws._lang, { self: true }), role: roleStr(rec), isAdmin: isAdminRec(rec) });
    }

    else if (m.t === 'resetPass') {
      const e = useToken(String(m.token || ''), 'reset');
      if (!e || !db.users[e.user]) return err('e.badToken');
      if (String(m.pass || '').length < 4) return err('e.badPass');
      const u = db.users[e.user];
      u.salt = crypto.randomBytes(8).toString('hex');
      u.passHash = hashPass(m.pass, u.salt);
      u.active = true; u.emailConfirmed = true; saveDB();
      send(ws, { t: 'passwordSet' });
    }

    else if (m.t === 'setLang') {
      ws._lang = langOf(m.lang);
      const u = userOf(ws);
      if (u) { u.lang = ws._lang; saveDB(); }
      send(ws, mePayload());
    }

    else if (m.t === 'updateProfile') {
      const u = needLogin(ws, err);
      if (!u) return;
      if (m.firstName !== undefined) u.firstName = String(m.firstName).slice(0, 40);
      if (m.lastName !== undefined) u.lastName = String(m.lastName).slice(0, 40);
      if (m.show) for (const k of ['first', 'last', 'email', 'stats']) if (m.show[k] !== undefined) u.show[k] = !!m.show[k];
      if (m.lang) { u.lang = langOf(m.lang); ws._lang = u.lang; }
      saveDB();
      send(ws, { t: 'auth', user: pubUser(u, ws._lang, { self: true }), role: roleStr(u), isAdmin: isAdminRec(u), allowedSizes: L.allowedSizes(levelOf(ws)), myLevel: levelOf(ws), premium: !!u.premium });
    }

    else if (m.t === 'viewProfile') {
      const key = String(m.user || '').toLowerCase();
      const rec = db.users[key];
      if (!rec) return err('e.room404');
      const me = userOf(ws);
      const self = me && me === rec;
      if (key === HIDDEN_USER && !self && !(me && isAdminRec(me))) return err('e.room404');
      send(ws, { t: 'profile', user: pubUser(rec, ws._lang, { self, admin: !!(me && isAdminRec(me)) }) });
    }

    else if (m.t === 'deleteAccount') {
      const u = needLogin(ws, err);
      if (!u) return;
      if (!u.passHash || u.passHash !== hashPass(String(m.password || ''), u.salt)) return err('e.badLogin');
      const key = ws._user;
      sendMail(u.email, u.name, u.lang || 'ro', 'del', { userKey: key, n: u.name });
      send(ws, { t: 'deleteSent' });
    }

    else if (m.t === 'confirmDelete') {
      const e = useToken(String(m.token || ''), 'del');
      if (!e || !db.users[e.user]) return err('e.badToken');
      const key = e.user;
      dropSessionsOf(key);
      for (const r of rooms.values()) for (const n of seatNums(r)) {
        const st = r.seats[n];
        if (st && st.user === key) {
          if (st.ws) { send(st.ws, { t: 'left' }); st.ws._room = null; }
          r.seats[n] = { bot: true, name: botName(r.level, r.lang) };
        }
      }
      delete db.users[key]; saveDB();
      if (ws._user === key) { ws._user = null; ws._name = 'Anonim' + ws._id; }
      send(ws, { t: 'deleted' });
      broadcastTables(wss);
    }

    else if (m.t === 'buyPremium') {
      const u = needLogin(ws, err);
      if (!u) return;
      u.premium = true; saveDB(); // demo: fara plata reala
      send(ws, mePayload());
    }

    // ---- lobby / mese ----
    else if (m.t === 'tables') send(ws, tablesMsg());
    else if (m.t === 'ping') send(ws, { t: 'pong' });
    else if (m.t === 'ads') {
      const acfg = fullCfg().ads || {};
      send(ws, { t: 'ads', list: activeAds(), adsenseSnippet: acfg.adsenseSnippet || '', adsense: acfg.adsenseClient || '' });
    }

    else if (m.t === 'leaderboard') {
      const q = String(m.q || '').toLowerCase();
      const list = Object.values(db.users)
        .filter(u => u.active && u.emailConfirmed && u.passHash && u.name !== HIDDEN_USER && (!q || u.name.toLowerCase().includes(q)))
        .map(u => pubUser(u, ws._lang))
        .sort((a, b) => b.rating - a.rating)
        .slice(Number(m.offset || 0), Number(m.offset || 0) + (Number(m.limit) || 10));
      send(ws, { t: 'leaderboard', list });
    }

    else if (m.t === 'newUsers') {
      const list = Object.values(db.users)
        .filter(u => u.active && u.emailConfirmed && u.name !== HIDDEN_USER)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, Number(m.limit) || 12)
        .map(u => pubUser(u, ws._lang));
      send(ws, { t: 'newUsers', list });
    }

    else if (m.t === 'create') {
      const u = needLogin(ws, err);
      if (!u) return; // creare masa doar logat
      const size = Number(m.size);
      const allowed = L.allowedSizes(levelOf(ws));
      if (!allowed.includes(size)) return err('e.badLevel', { a: allowed.join('/') });
      if (ws._room && rooms.has(ws._room)) return err('e.seated');
      const players = Math.min(6, Math.max(2, Number(m.players) || 2));
      const minSize = Math.max(3, players - 1);
      if (size < minSize) return err('e.badSize', { p: players, s: minSize });
      const room = makeRoom(m.title, size, levelOf(ws), ws._lang, players);
      room.seats[1] = { ws, name: ws._name, bot: false, user: ws._user, anon: false };
      for (let i = 2; i <= players; i++) room.seats[i] = { bot: true, name: botName(room.level, room.lang) };
      rooms.set(room.code, room);
      ws._room = room.code; ws._player = 1;
      send(ws, { t: 'room', code: room.code, you: 1 });
      broadcast(room, stateMsg(room));
      sys(room, 'sys.created', { n: ws._name, t: room.title, s: `${size}×${size}`, l: room.level });
      sys(room, 'sys.bot', { b: botName(room.level, room.lang) });
      broadcastTables(wss);
      scheduleBot(wss, room); armTurnTimer(wss, room);
    }

    else if (m.t === 'join') {
      const code = String(m.code || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) { send(ws, { t: 'error', code: 'room404', reason: tr(ws._lang || 'ro', 'e.room404') }); return; }
      if (ws._room === code) { send(ws, { t: 'room', code, you: ws._player }); broadcast(room, stateMsg(room)); return; }
      if (ws._room && rooms.has(ws._room)) return err('e.seated');
      if (!L.canJoin(levelOf(ws), room.level)) return err('e.badLevel2', { p: levelOf(ws), pp: levelOf(ws) + 1, l: room.level });
      // reatasare pe propriul loc (dupa cadere, in grace period)
      const own = ws._user ? seatNums(room).find(n => { const s = room.seats[n]; return s && !s.bot && !s.ws && s.user === ws._user; }) : null;
      if (own) {
        const s = room.seats[own];
        clearGrace(s); s.ws = ws; s.gone = null;
        room.votes = {};
        ws._room = code; ws._player = own;
        send(ws, { t: 'room', code, you: own });
        broadcast(room, stateMsg(room));
        sys(room, 'sys.back', { n: ws._name });
        broadcastTables(wss);
        scheduleBot(wss, room); armTurnTimer(wss, room);
        return;
      }
      const free = seatNums(room).find(n => !room.seats[n] || room.seats[n].bot);
      if (!free) return err('e.full');
      if (room.botTimer) { clearTimeout(room.botTimer); room.botTimer = null; }
      const u = userOf(ws);
      const tookBotMidGame = room.moveNo > 1;
      room.seats[free] = { ws, name: ws._name, bot: false, user: u ? ws._user : null, anon: !u };
      room.votes = {};
      ws._room = code; ws._player = free;
      send(ws, { t: 'room', code, you: free });
      broadcast(room, stateMsg(room));
      sys(room, 'sys.join', { n: ws._name });
      if (tookBotMidGame) sys(room, 'sys.takeover', {});
      broadcastTables(wss);
      scheduleBot(wss, room); armTurnTimer(wss, room);
    }

    else if (m.t === 'leave') {
      const room = rooms.get(ws._room);
      if (!room) return;
      removeSeat(wss, room, ws, 'sys.left', { n: ws._name, b: botName(room.level, room.lang) });
      send(ws, { t: 'left' });
      if (rooms.has(room.code)) broadcast(room, stateMsg(room));
    }

    else if (m.t === 'move') {
      const room = rooms.get(ws._room);
      if (!room) return err('e.room404');
      const r = applyServerMove(room, ws._player, { r: m.r, c: m.c, size: m.size });
      if (!r.ok) return send(ws, { t: 'error', reason: moveErrorText(ws, r, m.size) });
      afterMoveCommon(wss, room);
    }

    else if (m.t === 'chat') {
      const room = rooms.get(ws._room);
      if (!room) return;
      const text = String(m.text || '').trim().slice(0, 300);
      if (!text) return;
      broadcast(room, { t: 'chat', from: ws._name, text, ts: Date.now() });
    }

    else if (m.t === 'restart' || m.t === 'rematch') {
      const room = rooms.get(ws._room);
      if (!room) return;
      if (m.t === 'rematch' && m.accept === false) {
        removeSeat(wss, room, ws, 'sys.novote', { n: ws._name });
        send(ws, { t: 'left' });
        if (rooms.has(room.code)) broadcast(room, stateMsg(room));
        return;
      }
      room.votes[ws._player] = true;
      if (humansOf(room).every(n => room.votes[n])) {
        resetRoom(room);
        broadcast(room, stateMsg(room));
        sys(room, 'sys.rematch', { w: room.turn === 1 ? '🔴' : '🔵' });
        broadcastTables(wss);
        scheduleBot(wss, room); armTurnTimer(wss, room);
      } else {
        broadcast(room, stateMsg(room));
        sys(room, 'sys.vote', { n: ws._name });
      }
    }

    // ---- reclame: comenzi ----
    else if (m.t === 'adOrder') {
      const u = needLogin(ws, err);
      if (!u) return;
      const o = {
        id: 'AD' + (adsDb.seq++), title: String(m.title || '').slice(0, 60),
        img: String(m.img || '').slice(0, 300), link: String(m.link || '').slice(0, 300),
        slot: ['hero', 'side'].includes(m.slot) ? m.slot : 'side',
        start: String(m.start || ''), end: String(m.end || ''),
        status: 'pending', paid: false, by: u.name, createdAt: Date.now(),
      };
      if (!o.title || !o.link) return err('e.badAd');
      adsDb.orders.push(o); saveAds();
      send(ws, { t: 'adOrdered', id: o.id });
    }
    else if (m.t === 'adPay') {
      const u = userOf(ws);
      const o = adsDb.orders.find(x => x.id === String(m.id));
      if (!u || !o || (o.by !== u.name && !isAdminRec(u))) return err('e.noAdmin');
      o.paid = true; saveAds(); // achitat -> activa automat (daca e in fereastra)
      const acfg2 = fullCfg().ads || {};
      send(ws, { t: 'ads', list: activeAds(), adsenseSnippet: acfg2.adsenseSnippet || '', adsense: acfg2.adsenseClient || '' });
    }

    // ---- admin ----
    else if (m.t === 'adminGetAdsTxt') {
      const me = needAdmin(ws, err);
      if (!me) return;
      let txt = '';
      try { txt = fs.readFileSync(path.join(__dirname, 'ads.txt'), 'utf8'); } catch (e) {}
      send(ws, { t: 'adminAdsTxt', txt });
    }
    else if (m.t === 'adminSaveAdsTxt') {
      const me = needAdmin(ws, err);
      if (!me) return;
      try { fs.writeFileSync(path.join(__dirname, 'ads.txt'), String(m.txt || '')); } catch (e) {}
      send(ws, { t: 'adminDone', what: 'adstxt' });
    }
    else if (m.t === 'adminGetConfig' || m.t === 'adminUsers' || m.t === 'adminAds' || m.t === 'pruneNow') {
      const me = needAdmin(ws, err);
      if (!me) return;
      if (m.t === 'adminGetConfig') send(ws, { t: 'adminConfig', config: fullCfg() });
      else if (m.t === 'adminUsers') {
        const q = String(m.q || '').toLowerCase();
        const list = Object.values(db.users)
          .filter(u => u.name !== HIDDEN_USER && (!q || u.name.toLowerCase().includes(q) || (u.email || '').includes(q)))
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 100)
          .map(u => pubUser(u, ws._lang, { admin: true }));
        send(ws, { t: 'adminUsers', list });
      }
      else if (m.t === 'adminAds') send(ws, { t: 'adminAds', list: adsDb.orders });
      else if (m.t === 'pruneNow') send(ws, { t: 'pruneReport', rep: sweepOnce() });
    }
    else if (m.t === 'adminSaveConfig') {
      const me = needAdmin(ws, err);
      if (!me) return;
      try {
        L.saveFullConfig(m.config);
        send(ws, { t: 'adminConfig', config: fullCfg(), saved: true });
      } catch (e) { send(ws, { t: 'error', reason: 'config invalid' }); }
    }
    else if (m.t === 'adminResetPass' || m.t === 'adminDeleteUser') {
      const me = needAdmin(ws, err);
      if (!me) return;
      const key = String(m.user || '').toLowerCase();
      const rec = db.users[key];
      if (!rec) return err('e.room404');
      if (m.t === 'adminResetPass') {
        sendMail(rec.email, rec.name, rec.lang || 'ro', 'reset', { userKey: key, n: rec.name });
        send(ws, { t: 'adminDone', what: 'reset' });
      } else {
        dropSessionsOf(key);
        for (const r of rooms.values()) for (const n of seatNums(r)) {
          const st = r.seats[n];
          if (st && st.user === key) r.seats[n] = { bot: true, name: botName(r.level, r.lang) };
        }
        delete db.users[key]; saveDB();
        send(ws, { t: 'adminDone', what: 'deleted' });
        broadcastTables(wss);
      }
    }
    else if (m.t === 'adminAd') {
      const me = needAdmin(ws, err);
      if (!me) return;
      const o = adsDb.orders.find(x => x.id === String(m.id));
      if (!o) return err('e.room404');
      if (m.action === 'approve') o.status = 'active';
      else if (m.action === 'paid') o.paid = true;
      else if (m.action === 'reject') o.status = 'rejected';
      else if (m.action === 'delete') adsDb.orders = adsDb.orders.filter(x => x !== o);
      saveAds();
      send(ws, { t: 'adminAds', list: adsDb.orders });
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws._room);
    if (!room) return;
    dropSeat(wss, room, ws);
  });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`TIC-TAK-TOK server (web+ws) on :${PORT}`));
}
module.exports = { server, rooms, tokens, sweepOnce, myTableOf };
module.exports.testHooks = { db: () => db };
module.exports.testHooks = { db: () => db, sweep: sweepOnce, outbox: () => fs.readdirSync(OUTBOX) };

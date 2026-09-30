// TIC-TAK-TOK TIC-TAC-TOE v0.3 — tabla N×N (3-6), bot pe nivele, rematch.
// Reguli: 1x..4x fiecare dimensiune (dupa marime), cover doar daca nou > varf.
// Moduri: local, bot (nivele 1-10), online (server WS autoritar).

const SIZES = [1, 2, 3, 4, 5];
const EMOJI = ['🔴', '🔵', '🟢', '🟡', '🟣', '🟠'];
const PCOLOR = n => 'p' + n;
function Tx(k, v) { try { return (window.T ? window.T(k, v) : k); } catch (e) { return k; } }
function maxP() { return gameMode() === 'online' ? (roomMeta.maxPlayers || 2) : (window.LOCAL_PLAYERS || 2); }
function nextSeatL(p) { const mp = maxP(); return (p % mp) + 1; }
let board, reserves, currentPlayer, selectedSize, winner, isDraw, starter, moveNo, stats, winCells;
let boardSize = 3, winLen = 3, copiesPer = 1;
let botThinking = false, rematchShown = false;
let roomMeta = { title: '', level: 1, seats: null, votes: [], maxPlayers: 2 };

function winLenFor(size) { return size <= 3 ? 3 : size === 4 ? 4 : size === 5 ? 4 : 5; }
function copiesFor(size) { return Math.max(1, size - 2); }
function gameMode() { return window.MODE || 'local'; }
function myPlayer() { return window.MY_PLAYER || null; }
function localSize() { return window.LOCAL_SIZE || 3; }
function botLevel() { return window.BOT_LEVEL || 3; }

function initState(size, nPlayers) {
  boardSize = size || boardSize || 3;
  winLen = winLenFor(boardSize);
  copiesPer = copiesFor(boardSize);
  const mp = nPlayers || maxP() || 2;
  if (gameMode() !== 'online') window.LOCAL_PLAYERS = mp;
  board = Array.from({ length: boardSize }, () => Array.from({ length: boardSize }, () => []));
  const mk = () => { const o = {}; for (const s of SIZES) o[s] = copiesPer; return o; };
  reserves = {};
  for (let p = 1; p <= mp; p++) reserves[p] = mk();
  if (starter === undefined || starter > mp) starter = 1;
  currentPlayer = starter;
  selectedSize = null; winner = null; isDraw = false; moveNo = 1; winCells = [];
  botThinking = false; rematchShown = false;
  window.roomDeadline = null;
  hideRematch();
  if (!stats) stats = { games: 0, p1: 0, p2: 0, draw: 0 };
}

function topCell(r, c) { const s = board[r][c]; return s.length ? s[s.length - 1] : null; }

function canPlace(r, c, size, player) {
  if (winner || isDraw) return { ok: false, reason: 'Joc terminat' };
  if (!reserves[player][size] || reserves[player][size] <= 0) return { ok: false, reason: Tx('g.used') };
  const t = topCell(r, c);
  if (!t) return { ok: true };
  if (size > t.size) return { ok: true, cover: true };
  return { ok: false, reason: Tx('g.blocked', { t: t.size, s: size }) };
}

function anyValidMove(player) {
  for (let r = 0; r < boardSize; r++) for (let c = 0; c < boardSize; c++)
    for (const s of SIZES) if (canPlace(r, c, s, player).ok) return true;
  return false;
}

function checkWin() {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < boardSize; r++) for (let c = 0; c < boardSize; c++) for (const [dr, dc] of dirs) {
    const er = r + dr * (winLen - 1), ec = c + dc * (winLen - 1);
    if (er < 0 || er >= boardSize || ec < 0 || ec >= boardSize) continue;
    const pr = r - dr, pc = c - dc;
    if (pr >= 0 && pr < boardSize && pc >= 0 && pc < boardSize) continue;
    const a = topCell(r, c);
    if (!a) continue;
    let ok = true;
    for (let i = 1; i < winLen; i++) {
      const t = topCell(r + dr * i, c + dc * i);
      if (!t || t.player !== a.player) { ok = false; break; }
    }
    if (ok) {
      const cells = [];
      for (let i = 0; i < winLen; i++) cells.push([r + dr * i, c + dc * i]);
      return { player: a.player, cells };
    }
  }
  return null;
}

// ---------- Bot local (aceeasi idee ca serverul: negamax + agresivitate pe nivel) ----------
const _linesCache = new Map();
function _lines(size, wl) {
  const key = size + 'x' + wl;
  if (_linesCache.has(key)) return _linesCache.get(key);
  const lines = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) for (const [dr, dc] of [[0,1],[1,0],[1,1],[1,-1]]) {
    const er = r + dr * (wl - 1), ec = c + dc * (wl - 1);
    if (er < 0 || er >= size || ec < 0 || ec >= size) continue;
    const pr = r - dr, pc = c - dc;
    if (pr >= 0 && pr < size && pc >= 0 && pc < size) continue;
    const line = [];
    for (let i = 0; i < wl; i++) line.push([r + dr * i, c + dc * i]);
    lines.push(line);
  }
  _linesCache.set(key, lines);
  return lines;
}
function _winOn(bd, size, wl) {
  for (const line of _lines(size, wl)) {
    const a = bd[line[0][0]][line[0][1]];
    const at = a.length ? a[a.length - 1] : null;
    if (!at) continue;
    let ok = true;
    for (let i = 1; i < line.length; i++) {
      const s = bd[line[i][0]][line[i][1]];
      const t = s.length ? s[s.length - 1] : null;
      if (!t || t.player !== at.player) { ok = false; break; }
    }
    if (ok) return at.player;
  }
  return 0;
}
function _genMoves(player) {
  const out = [];
  for (let r = 0; r < boardSize; r++) for (let c = 0; c < boardSize; c++) {
    const t = topCell(r, c);
    for (const s of SIZES) {
      if (!reserves[player][s]) continue;
      if (!t) out.push({ r, c, size: s, cover: false });
      else if (s > t.size) out.push({ r, c, size: s, cover: true });
    }
  }
  return out;
}
function _evalBoard(me, aggr) {
  const w = _winOn(board, boardSize, winLen);
  if (w === me) return 100000;
  if (w) return -100000;
  let score = 0;
  const ctr = (boardSize - 1) / 2;
  for (let r = 0; r < boardSize; r++) for (let c = 0; c < boardSize; c++) {
    const t = topCell(r, c);
    if (!t) continue;
    const v = t.size * (1 + aggr * 0.35) + (boardSize - (Math.abs(r - ctr) + Math.abs(c - ctr))) * (1 + aggr);
    score += t.player === me ? v : -v;
  }
  for (const line of _lines(boardSize, winLen)) {
    let mine = 0, theirs = 0, sumMine = 0;
    for (const [r, c] of line) {
      const t = topCell(r, c);
      if (t) { if (t.player === me) { mine++; sumMine += t.size; } else theirs++; }
    }
    if (theirs === 0 && mine > 0) score += Math.pow(mine, 2.2) * 6 * (1 + aggr) + sumMine * aggr;
    if (mine === 0 && theirs > 0) score -= Math.pow(theirs, 2.2) * 6 * (1 + aggr * 0.7);
  }
  return score;
}
function _threatCells(player) {
  const cells = new Set();
  for (let r = 0; r < boardSize; r++) for (let c = 0; c < boardSize; c++) {
    const t = topCell(r, c);
    for (const s of SIZES) {
      if (!reserves[player][s]) continue;
      if (t && s <= t.size) continue;
      board[r][c].push({ player, size: s });
      const w = _winOn(board, boardSize, winLen);
      board[r][c].pop();
      if (w === player) { cells.add(r + ',' + c); break; }
    }
  }
  return cells;
}
function _order(moves, aggr) {
  const ctr = (boardSize - 1) / 2;
  return moves.map(m => {
    let s = (boardSize - (Math.abs(m.r - ctr) + Math.abs(m.c - ctr))) * 3 + m.size;
    if (m.cover) s += 20 * aggr + m.size * 2;
    return { m, s };
  }).sort((a, b) => b.s - a.s).map(x => x.m);
}
function _slice(ordered, me, opps, cap) {
  const must = new Set(), seen = new Set();
  for (const o of opps) for (const c of _threatCells(o)) if (!seen.has(c)) { seen.add(c); must.add(c); }
  for (const c of _threatCells(me)) if (!seen.has(c)) { seen.add(c); must.add(c); }
  const a = [], rest = [];
  for (const m of ordered) ((must.has(m.r + ',' + m.c)) ? a : rest).push(m);
  return a.concat(rest).slice(0, Math.max(cap, a.length));
}
function botChoose(level, timeLimit) {
  const t0 = Date.now();
  const me = currentPlayer, mp = maxP();
  const foes = [];
  for (let p = 1; p <= mp; p++) if (p !== me) foes.push(p);
  const aggr = 0.3 + level * 0.09;
  let moves = _genMoves(me);
  if (!moves.length) return null;
  for (const m of moves) { // castig imediat
    board[m.r][m.c].push({ player: me, size: m.size });
    const w = _winOn(board, boardSize, winLen);
    board[m.r][m.c].pop();
    if (w === me) return m;
  }
  const depth = level <= 2 ? 1 : level <= 5 ? 2 : 3;
  const breadth = d => d <= 1 ? 400 : d === 2 ? (level <= 5 ? 26 : 34) : (level <= 7 ? 12 : 18);
  moves = _slice(_order(moves, aggr), me, foes, breadth(depth));
  let best = moves[0], bestScore = -Infinity, timedOut = false;
  function nega(d, alpha, beta, player) {
    if (Date.now() - t0 > timeLimit) { timedOut = true; return 0; }
    const w = _winOn(board, boardSize, winLen);
    if (w === me) return 90000 + d * 100;
    if (w) return -90000 - d * 100;
    if (d === 0) return (player === me ? 1 : -1) * _evalBoard(me, aggr);
    let ms = _genMoves(player);
    if (!ms.length) return (player === me ? 1 : -1) * _evalBoard(me, aggr);
    const nx = ((player) % maxP()) + 1;
    const fz = [];
    for (let p = 1; p <= maxP(); p++) if (p !== player) fz.push(p);
    ms = _slice(_order(ms, aggr), player, fz, breadth(d));
    let bv = -Infinity;
    for (const m of ms) {
      board[m.r][m.c].push({ player, size: m.size }); reserves[player][m.size]--;
      const v = -nega(d - 1, -beta, -alpha, nx);
      board[m.r][m.c].pop(); reserves[player][m.size]++;
      if (timedOut) return 0;
      if (v > bv) bv = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return bv;
  }
  const firstReply = (me % maxP()) + 1;
  for (const m of moves) {
    board[m.r][m.c].push({ player: me, size: m.size }); reserves[me][m.size]--;
    const v = -nega(depth - 1, -Infinity, Infinity, firstReply) + (m.cover ? aggr * 4 : 0);
    board[m.r][m.c].pop(); reserves[me][m.size]++;
    if (timedOut) break;
    if (v > bestScore) { bestScore = v; best = m; }
  }
  return best;
}
function botMove() {
  if (winner || isDraw || gameMode() !== 'bot' || currentPlayer === 1) return;
  const pick = botChoose(botLevel(), 800);
  if (!pick) return;
  setMessage(`🤖 Bot L${botLevel()} joacă ${pick.size} la (${pick.r + 1},${pick.c + 1})…`);
  setTimeout(() => { applyLocalMove(pick.r, pick.c, pick.size); render(); }, 450);
}

// ---------- mutare locala ----------
function applyLocalMove(r, c, size) {
  const v = canPlace(r, c, size, currentPlayer);
  if (!v.ok) return v;
  const wasCover = !!v.cover;
  const prevTop = topCell(r, c);
  board[r][c].push({ player: currentPlayer, size });
  reserves[currentPlayer][size]--;
  logMove(`#${moveNo++} ${EMOJI[currentPlayer - 1]}${currentPlayer} ← ${size} (${r + 1},${c + 1})` + (wasCover ? ` / ${prevTop.size}` : ''));
  blip(wasCover ? 880 : 660);
  selectedSize = null;
  afterMove();
  return { ok: true };
}
function afterMove() {
  const w = checkWin();
  if (w) { winner = w.player; winCells = w.cells; stats.games++; stats[winner === 1 ? 'p1' : 'p2']++; fanfare(); maybeRematch(); return; }
  const nxt = nextWithMovesLocal(currentPlayer);
  if (nxt === null) { isDraw = true; stats.games++; stats.draw++; maybeRematch(); }
  else {
    currentPlayer = nxt;
    setMessage(currentPlayer === 1 ? Tx('g.turnR') : currentPlayer === 2 ? Tx('g.turnB') : `${EMOJI[currentPlayer - 1]} ${currentPlayer}`);
  }
}
function nextWithMovesLocal(from) {
  const mp = maxP();
  for (let i = 1; i <= mp; i++) {
    const n = ((from - 1 + i) % mp) + 1;
    if (anyValidMove(n)) return n;
  }
  return null;
}

// ---------- stare remota (online) ----------
function applyRemoteState(s) {
  boardSize = s.size; winLen = s.winLen || winLenFor(s.size); copiesPer = s.copies || copiesFor(s.size);
  board = s.board; reserves = s.reserves; currentPlayer = s.turn;
  starter = s.starter; winner = s.winner; isDraw = s.isDraw;
  winCells = s.winCells || []; moveNo = s.moveNo || 1;
  roomMeta = { title: s.title || '', level: s.level || 1, seats: s.seats || null, votes: s.votes || [], maxPlayers: s.maxPlayers || 2 };
  window.roomDeadline = s.deadline || null;
  selectedSize = null;
  if ((winner || isDraw) && !rematchShown) maybeRematch();
  if (!winner && !isDraw) { rematchShown = false; hideRematch(); }
  render();
}

// ---------- rematch ----------
function maybeRematch() {
  if (rematchShown) return;
  rematchShown = true;
  render();
  const box = $('rematchModal');
  if (!box) return;
  const t = $('rematchText');
  if (t) {
    const who = winner ? (winner === 1 ? '🔴' : '🔵') : '';
    t.textContent = (winner || isDraw ? `${who} ` : '') + Tx('mr.again');
  }
  const vv = $('rematchVotes');
  if (vv) vv.textContent = gameMode() === 'online' ? votesText() : '';
  box.classList.remove('hidden');
  if (window.renderRematchAd) { try { window.renderRematchAd(); } catch (e) {} }
}
function votesText() {
  if (!roomMeta.seats) return '';
  const names = roomMeta.seats.filter(s => !s.bot && !s.empty).map(s => s.name);
  const v = roomMeta.votes.length;
  return v ? `${Tx('mr.votes')}: ${v}/${names.length}` : '';
}
function hideRematch() { const box = $('rematchModal'); if (box) box.classList.add('hidden'); }
function rematchYes() {
  hideRematch();
  if (gameMode() === 'online') {
    if (window.Net) window.Net.rematch(true);
    setMessage('Ai votat revanșa. Așteptăm celălalt vot…');
  } else {
    starter = nextSeatL(starter);
    const log = $('log'); if (log) log.innerHTML = '';
    initState(boardSize, maxP()); render();
    setMessage(Tx('g.new', { w: EMOJI[starter - 1] }));
  }
}
function rematchNo() {
  hideRematch();
  if (gameMode() === 'online' && window.Net) window.Net.rematch(false);
  else location.href = 'index.html';
}

// ---------- render ----------
const $ = id => document.getElementById(id);
function setMessage(t) { const m = $('message'); if (m) m.textContent = t; }
function seatName(n) {
  const e = EMOJI[(n - 1) % EMOJI.length];
  if (gameMode() === 'online' && roomMeta.seats) {
    const s = roomMeta.seats[n - 1];
    if (s) return `${e} ${s.name}` + (s.bot ? ' (bot)' : '');
  }
  return `${e} P${n}`;
}
function winnerText(w) {
  if (w === 1) return Tx('g.winR');
  if (w === 2) return Tx('g.winB');
  return `🏆 ${EMOJI[(w - 1) % EMOJI.length]} P${w}!`;
}

function render() {
  const b = $('board');
  if (!b) return;
  b.innerHTML = '';
  b.className = 'board b' + boardSize;
  b.style.gridTemplateColumns = `repeat(${boardSize}, 1fr)`;
  b.style.gridTemplateRows = `repeat(${boardSize}, 1fr)`;
  const online = gameMode() === 'online';
  const mine = myPlayer();
  for (let r = 0; r < boardSize; r++) for (let c = 0; c < boardSize; c++) {
    const d = document.createElement('div');
    d.className = 'cell';
    const t = topCell(r, c);
    if (t) {
      const p = document.createElement('div');
      p.className = `piece ${PCOLOR(t.player)} s${t.size}`;
      p.innerHTML = `<i>${t.size}</i>`;
      d.appendChild(p);
      if (board[r][c].length > 1) {
        const sd = document.createElement('span');
        sd.className = 'stack-depth';
        sd.textContent = '×' + board[r][c].length;
        d.appendChild(sd);
      }
    }
    if (selectedSize && canPlace(r, c, selectedSize, currentPlayer).ok) d.classList.add('ok');
    if (winCells.some(([wr, wc]) => wr === r && wc === c)) d.classList.add('win');
    d.addEventListener('click', () => onCell(r, c));
    if (online && mine && currentPlayer !== mine) d.classList.add('opp-turn');
    b.appendChild(d);
  }
  // rezerve dinamice 1..N
  const rc = $('reservesCol');
  if (rc) {
    rc.innerHTML = '';
    for (let pl = 1; pl <= maxP(); pl++) {
      const box = document.createElement('div');
      box.className = 'reserve' + ((currentPlayer === pl && !winner) ? ' active' : '');
      box.id = 'reserveP' + pl;
      const h = document.createElement('h3');
      h.id = 'reserveH' + pl;
      h.textContent = seatName(pl);
      const wrap = document.createElement('div');
      wrap.className = 'pieces';
      wrap.id = 'piecesP' + pl;
      for (const s of SIZES) {
        const left = (reserves[pl] && reserves[pl][s]) || 0;
        const btn = document.createElement('div');
        btn.className = 'pick' + (left <= 0 ? ' empty' : '') + ((currentPlayer === pl && selectedSize === s) ? ' selected' : '');
        btn.innerHTML = `<div class="piece ${PCOLOR(pl)} s${s}"><i>${s}</i></div><small>${s}</small><span class="count">×${left}</span>`;
        ((pp, lf) => btn.addEventListener('click', () => {
          if (online && mine !== pp) { setMessage(Tx('g.oppP')); return; }
          if (!online && pp !== currentPlayer) { setMessage(currentPlayer === 1 ? Tx('g.turnR') : Tx('g.turnB')); return; }
          if (online && currentPlayer !== mine) { setMessage(Tx('g.wait')); return; }
          if (gameMode() === 'bot' && pp !== 1) { setMessage(Tx('g.oppP')); return; }
          if (lf <= 0) return;
          selectedSize = (selectedSize === s ? null : s);
          setMessage(selectedSize ? Tx('g.chosen', { s: selectedSize }) : Tx('g.cancel'));
          blip(500 + s * 80);
          render();
        }))(pl, left);
        wrap.appendChild(btn);
      }
      box.appendChild(h); box.appendChild(wrap);
      rc.appendChild(box);
    }
  }
  const ti = $('turnIndicator');
  if (ti) {
    const turnLabel = online && mine
      ? (currentPlayer === mine ? Tx('g.you') : Tx('g.opp'))
      : (currentPlayer === 1 ? Tx('g.turnR') : currentPlayer === 2 ? Tx('g.turnB') : `${EMOJI[currentPlayer - 1]} P${currentPlayer}`);
    ti.textContent = winner ? winnerText(winner)
      : isDraw ? Tx('g.draw') : turnLabel;
    ti.className = 'turn ' + (currentPlayer === 1 ? 'p1-turn' : 'p2-turn');
  }
  const bn = $('banner');
  if (bn) {
    if (winner) {
      bn.classList.remove('hidden', 'draw', 'win1', 'win2');
      bn.classList.add(winner === 1 ? 'win1' : 'win2');
      bn.textContent = winnerText(winner);
    } else if (isDraw) {
      bn.classList.remove('hidden', 'win1', 'win2'); bn.classList.add('draw');
      bn.textContent = Tx('g.draw');
    } else bn.classList.add('hidden');
  }
  const mi = $('matchInfo');
  if (mi) {
    mi.textContent = online && roomMeta.title
      ? `"${roomMeta.title}" • ${boardSize}×${boardSize} • ${Tx('g.line')} ${winLen} • Nv ${roomMeta.level}`
      : `${boardSize}×${boardSize} • ${Tx('g.line')} ${winLen} • ${copiesPer}${Tx('g.copies')}` + (gameMode() === 'bot' ? ` • Bot L${botLevel()}` : '');
  }
  if (gameMode() === 'bot' && !winner && !isDraw && currentPlayer !== 1 && !botThinking) {
    botThinking = true;
    setTimeout(() => { botThinking = false; botMove(); }, 600);
  }
}

function logMove(text) {
  const log = $('log');
  if (!log) return;
  const li = document.createElement('li');
  li.textContent = text;
  log.prepend(li);
}

function onCell(r, c) {
  if (winner || isDraw) return;
  if (gameMode() === 'online') {
    if (currentPlayer !== myPlayer()) { setMessage(Tx('g.wait')); return; }
    if (!selectedSize) { setMessage(Tx('g.pick')); return; }
    if (window.Net && window.Net.sendMove(selectedSize, r, c)) setMessage(Tx('g.sent'));
    return;
  }
  if (gameMode() === 'bot' && currentPlayer !== 1) return;
  if (!selectedSize) { setMessage(Tx('g.pick')); return; }
  const v = applyLocalMove(r, c, selectedSize);
  if (!v.ok) { setMessage(v.reason); blip(160); return; }
  render();
}

let AC = null;
function blip(freq) {
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    const o = AC.createOscillator(), g = AC.createGain();
    o.connect(g); g.connect(AC.destination);
    o.frequency.value = freq; o.type = 'sine';
    g.gain.setValueAtTime(.15, AC.currentTime);
    g.gain.exponentialRampToValueAtTime(.001, AC.currentTime + .25);
    o.start(); o.stop(AC.currentTime + .26);
  } catch (e) {}
}
function fanfare() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => blip(f), i * 130)); }

function bindBtn(id, fn) { const el = $(id); if (el) el.addEventListener('click', fn); }
bindBtn('btnRestart', () => {
  if (gameMode() === 'online' && window.Net) { window.Net.rematch(true); return; }
  starter = nextSeatL(starter);
  const log = $('log'); if (log) log.innerHTML = '';
  initState(boardSize, maxP()); render();
  setMessage(Tx('g.new', { w: EMOJI[starter - 1] }));
});
bindBtn('btnSwap', () => {
  if (gameMode() === 'online') { setMessage(Tx('g.wait')); return; }
  starter = nextSeatL(starter); currentPlayer = starter; selectedSize = null; render();
  setMessage(Tx('g.new', { w: EMOJI[starter - 1] }));
});
bindBtn('btnRules', () => { const m = $('rulesModal'); if (m) m.classList.remove('hidden'); });
bindBtn('btnCloseModal', () => { const m = $('rulesModal'); if (m) m.classList.add('hidden'); });
bindBtn('btnRematchYes', rematchYes);
bindBtn('btnRematchNo', rematchNo);

initState(localSize(), window.LOCAL_PLAYERS || 2); render(); setMessage(Tx('g.pick'));

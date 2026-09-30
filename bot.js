// Bot Tic-Tak-Tok — negamax + euristica, dificultate dupa nivel (1-10).
// Suporta 2-6 jucatori: oricine altcineva castiga e rau; amenintarile tuturor conteaza.
// Stare: { board (N×N stive [{player,size}]), reserves {1:{},...}, size, winLen, turn, maxPlayers }
function nextSeat(game, p) { const mp = game.maxPlayers || 2; return (p % mp) + 1; }

function topOf(board, r, c) { const s = board[r][c]; return s.length ? s[s.length - 1] : null; }

const SIZES = [1, 2, 3, 4, 5];
const linesCache = new Map();
function linesFor(size, winLen) {
  const key = size + 'x' + winLen;
  if (linesCache.has(key)) return linesCache.get(key);
  const lines = [];
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) for (const [dr, dc] of dirs) {
    const er = r + dr * (winLen - 1), ec = c + dc * (winLen - 1);
    if (er < 0 || er >= size || ec < 0 || ec >= size) continue;
    // evita duplicatele: pastreaza doar liniile care pornesc la margine pe directia opusa
    const pr = r - dr, pc = c - dc;
    if (pr >= 0 && pr < size && pc >= 0 && pc < size) continue;
    const line = [];
    for (let i = 0; i < winLen; i++) line.push([r + dr * i, c + dc * i]);
    lines.push(line);
  }
  linesCache.set(key, lines);
  return lines;
}

function checkWinBoard(board, size, winLen) {
  for (const line of linesFor(size, winLen)) {
    const a = topOf(board, line[0][0], line[0][1]);
    if (!a) continue;
    let ok = true;
    for (let i = 1; i < line.length; i++) {
      const t = topOf(board, line[i][0], line[i][1]);
      if (!t || t.player !== a.player) { ok = false; break; }
    }
    if (ok) return a.player;
  }
  return 0;
}

// Toate mutarile valide (ordonate: castigatoare mai intai la evaluare).
function genMoves(game, player) {
  const { board, reserves, size } = game;
  const moves = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    const t = topOf(board, r, c);
    for (const s of SIZES) {
      if (!reserves[player][s]) continue;
      if (!t) moves.push({ r, c, size: s, cover: false });
      else if (s > t.size) moves.push({ r, c, size: s, cover: true, over: t.size });
    }
  }
  return moves;
}

// Euristica din perspectiva lui `me`. Agresiunea creste bonusul de atac/acoperire.
function evaluate(game, me, aggr) {
  const { board, size, winLen } = game;
  const opp = me === 1 ? 2 : 1;
  const winner = checkWinBoard(board, size, winLen);
  if (winner === me) return 100000;
  if (winner === opp) return -100000;
  let score = 0;
  const ctr = (size - 1) / 2;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    const t = topOf(board, r, c);
    if (!t) continue;
    const v = t.size * (1 + aggr * 0.35);
    const dc = Math.abs(r - ctr) + Math.abs(c - ctr);
    const centerBonus = (size - dc) * (1 + aggr);
    score += t.player === me ? (v + centerBonus) : -(v + centerBonus);
  }
  // potential de linii: linii "vii" (doar ale mele + goluri)
  for (const line of linesFor(size, winLen)) {
    let mine = 0, theirs = 0, empty = 0, sumMine = 0;
    for (const [r, c] of line) {
      const t = topOf(board, r, c);
      if (!t) empty++;
      else if (t.player === me) { mine++; sumMine += t.size; }
      else theirs++;
    }
    if (theirs === 0 && mine > 0) score += Math.pow(mine, 2.2) * 6 * (1 + aggr) + sumMine * aggr;
    if (mine === 0 && theirs > 0) score -= Math.pow(theirs, 2.2) * 6 * (1 + aggr * 0.7);
    if (mine === 0 && theirs === 0 && empty === line.length) score += 0.5; // linii deschise
  }
  return score;
}

function depthFor(level) { return level <= 2 ? 1 : level <= 5 ? 2 : 3; }
function breadthFor(level, depth) {
  if (depth <= 1) return 400;
  if (depth === 2) return level <= 5 ? 26 : 34;
  return level <= 7 ? 12 : 18;
}

function orderMoves(game, moves, me, aggr) {
  const ctr = (game.size - 1) / 2;
  return moves.map(m => {
    let s = 0;
    if (m.cover) s += 20 * aggr + m.size * 2;       // agresiv: prefera acoperirile
    s += (game.size - (Math.abs(m.r - ctr) + Math.abs(m.c - ctr))) * 3;
    if (!topOf(game.board, m.r, m.c)) s += m.size;  // piese mari pe gol
    return { m, s };
  }).sort((a, b) => b.s - a.s).map(x => x.m);
}

// Celulele unde `player` ar castiga IMEDIAT (cu vreo dimensiune valida).
// Mutarile pe aceste celule nu se taie niciodata la breadth-pruning.
function immediateWinCells(game, player) {
  const cells = new Set();
  const { board, reserves, size, winLen } = game;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    const t = topOf(board, r, c);
    for (const s of SIZES) {
      if (!reserves[player][s]) continue;
      if (t && s <= t.size) continue;
      board[r][c].push({ player, size: s });
      const w = checkWinBoard(board, size, winLen);
      board[r][c].pop();
      if (w === player) { cells.add(r + ',' + c); break; }
    }
  }
  return cells;
}
function sliceKeepThreats(ordered, game, me, opps, cap) {
  const must = new Set(), seen = new Set();
  for (const o of opps) for (const c of immediateWinCells(game, o)) if (!seen.has(c)) { seen.add(c); must.add(c); }
  for (const c of immediateWinCells(game, me)) if (!seen.has(c)) { seen.add(c); must.add(c); }
  const a = [], rest = [];
  for (const m of ordered) ((must.has(m.r + ',' + m.c)) ? a : rest).push(m);
  return a.concat(rest).slice(0, Math.max(cap, a.length));
}
function applyMove(game, move, player) {
  game.board[move.r][move.c].push({ player, size: move.size });
  game.reserves[player][move.size]--;
}
function undoMove(game, move, player) {
  game.board[move.r][move.c].pop();
  game.reserves[player][move.size]++;
}

function chooseMove(game, level, opts = {}) {
  const timeLimit = opts.timeLimit || 1200;
  const t0 = Date.now();
  const me = game.turn;
  const mp = game.maxPlayers || 2;
  const foes = [];
  for (let p = 1; p <= mp; p++) if (p !== me) foes.push(p);
  const aggr = 0.3 + level * 0.09; // 0.39 (L1) .. 1.2 (L10)
  let moves = genMoves(game, me);
  if (!moves.length) return null;

  // 1) castig imediat (rapid, fara cautare)
  for (const m of moves) {
    applyMove(game, m, me);
    const w = checkWinBoard(game.board, game.size, game.winLen);
    undoMove(game, m, me);
    if (w === me) return m;
  }

  const depth = opts.depth || depthFor(level);
  moves = sliceKeepThreats(orderMoves(game, moves, me, aggr), game, me, foes, breadthFor(level, depth));
  let best = moves[0], bestScore = -Infinity;
  let timedOut = false;

  function negamax(g, d, alpha, beta, player) {
    if (Date.now() - t0 > timeLimit) { timedOut = true; return 0; }
    const w = checkWinBoard(g.board, g.size, g.winLen);
    if (w === me) return 90000 + d * 100;
    if (w) return -90000 - d * 100; // castiga ALTcineva -> rau
    if (d === 0) return (player === me ? 1 : -1) * evaluate(g, me, aggr);
    let ms = genMoves(g, player);
    if (!ms.length) return (player === me ? 1 : -1) * evaluate(g, me, aggr);
    const nx = nextSeat(g, player);
    const fz = [];
    for (let p = 1; p <= (g.maxPlayers || 2); p++) if (p !== player) fz.push(p);
    ms = sliceKeepThreats(orderMoves(g, ms, player, aggr), g, player, fz, breadthFor(level, d));
    let bestV = -Infinity;
    for (const m of ms) {
      applyMove(g, m, player);
      const v = -negamax(g, d - 1, -beta, -alpha, nx);
      undoMove(g, m, player);
      if (timedOut) return 0;
      if (v > bestV) bestV = v;
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    return bestV;
  }

  const firstReply = nextSeat(game, me);
  for (const m of moves) {
    applyMove(game, m, me);
    const v = -negamax(game, depth - 1, -Infinity, Infinity, firstReply);
    undoMove(game, m, me);
    if (timedOut) break;
    // bonus final pentru acoperire agresiva (la egalitate de scor)
    const vAdj = v + (m.cover ? aggr * 4 : 0);
    if (vAdj > bestScore) { bestScore = vAdj; best = m; }
  }
  return best;
}

module.exports = { chooseMove, genMoves, evaluate, checkWinBoard, linesFor, depthFor, immediateWinCells };

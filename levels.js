// Niveluri/rating configurabile (config.json, editabil din UI de admin).
const fs = require('fs');
const path = require('path');
const CONFIG_FILE = path.join(__dirname, 'config.json');

const DEFAULTS = {
  rating: { start: 1000, stepPerLevel: 100, kHuman: 32, kBot: 16, anonRating: 1000 },
  maxLevel: 10,
  brackets: [
    { from: 1, to: 3, size: 3, accessMin: null },
    { from: 4, to: 5, size: 4, accessMin: null },
    { from: 6, to: 7, size: 5, accessMin: null },
    { from: 8, to: 10, size: 6, accessMin: null },
  ],
  winLen: { 3: 3, 4: 4, 5: 4, 6: 5, 7: 5 },
  copiesPerSize: 1,
};

let cfg = loadCfg();
function loadCfg() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return Object.assign({}, DEFAULTS, raw, { rating: Object.assign({}, DEFAULTS.rating, raw.rating || {}) });
    }
  } catch (e) { console.error('config.json invalid, folosesc default:', e.message); }
  return JSON.parse(JSON.stringify(DEFAULTS));
}
function getConfig() { return cfg; }
function fullConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return loadCfg(); }
}
function saveFullConfig(next) {
  // validare minima
  if (!next || !next.rating || !Array.isArray(next.brackets)) throw new Error('config invalid');
  const ml = Number(next.maxLevel);
  next.maxLevel = Math.min(15, Math.max(10, ml || 10));
  next.brackets = next.brackets.filter(b => b && Number(b.from) >= 1 && Number(b.to) >= Number(b.from) && Number(b.size) >= 3 && Number(b.size) <= 8)
    .map(b => ({ from: Number(b.from), to: Math.min(Number(b.to), next.maxLevel), size: Number(b.size), accessMin: (b.accessMin === null || b.accessMin === '' || b.accessMin === undefined) ? null : Number(b.accessMin) }));
  if (!next.brackets.length) throw new Error('config invalid: brackets');
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 1));
  cfg = loadCfg();
  return cfg;
}

const START_RATING = 1000; // compat: suprascris de config la apel
function maxLevel() { return Math.min(15, Math.max(10, Number(cfg.maxLevel) || 10)); }
function levelFor(rating) {
  const { start, stepPerLevel } = cfg.rating;
  if (rating < start) return 1;
  return Math.min(maxLevel(), 1 + Math.floor((rating - start) / stepPerLevel));
}
function bracketOf(level) {
  for (const b of cfg.brackets) if (level >= b.from && level <= b.to) return b;
  return null;
}
function sizeFor(level) {
  const b = bracketOf(level);
  if (b) return b.size;
  let mx = 3;
  for (const x of cfg.brackets) mx = Math.max(mx, x.size);
  return mx;
}
function winLenFor(size) { return (cfg.winLen && cfg.winLen[size]) || 3; }
function copiesFor(size) { return Math.max(1, size - 2 + (cfg.copiesPerSize - 1)); }
function allowedSizes(level) {
  const a = sizeFor(level);
  const b = level < maxLevel() ? sizeFor(level + 1) : a;
  return a === b ? [a] : [a, b];
}
// Poate jucatorul de nivel P la masa de nivel T? Default: P in T-1..T (propriul sau unul mai sus).
// Bracketul poate cobori pragul prin accessMin (ex: nivel 11 cu acces >9).
function canJoin(playerLevel, tableLevel, brackets) {
  const br = (brackets || cfg.brackets || []).find(b => tableLevel >= b.from && tableLevel <= b.to);
  const low = (br && br.accessMin != null && br.accessMin !== '') ? Number(br.accessMin) : tableLevel - 1;
  return playerLevel >= low && playerLevel <= tableLevel;
}
function botRatingFor(level) { return (cfg.rating.start - 100) + level * 100; }
function eloDelta(ra, rb, scoreA, K) {
  const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
  return Math.round(K * (scoreA - ea));
}

module.exports = {
  START_RATING, levelFor, sizeFor, winLenFor, copiesFor, maxLevel, bracketOf,
  allowedSizes, canJoin, botRatingFor, eloDelta,
  getConfig, fullConfig, saveFullConfig, levelName: (l) => 'L' + l,
};

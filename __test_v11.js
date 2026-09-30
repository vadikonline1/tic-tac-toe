// Test DTable cu stub DOM minimal + verificari statice div-table.
const fs = require('fs');
function El(tag) {
  const el = {
    tag, children: [], _cls: new Set(), _attrs: {}, style: { props: {}, setProperty(k, v) { this.props[k] = v; } },
    _text: '', _html: '',
    classList: null, dataset: {},
  };
  el.classList = { add: (...c) => c.forEach(x => el._cls.add(x)), toggle: (c, f) => { f ? el._cls.add(c) : el._cls.delete(c); }, remove: (...c) => c.forEach(x => el._cls.delete(x)) };
  Object.defineProperty(el, 'className', { get: () => [...el._cls].join(' '), set: v => { el._cls = new Set(String(v).split(/\s+/).filter(Boolean)); } });
  Object.defineProperty(el, 'textContent', { get: () => el._text, set: v => { el._text = String(v); } });
  Object.defineProperty(el, 'innerHTML', { get: () => el._html, set: v => { el._html = String(v); el.children = []; } });
  el.setAttribute = (k, v) => { el._attrs[k] = v; };
  el.appendChild = c => { el.children.push(c); return c; };
  el.addEventListener = (t, fn) => { el._listeners = el._listeners || {}; (el._listeners[t] = el._listeners[t] || []).push(fn); };
  el.querySelector = () => null;
  return el;
}
global.document = { createElement: t => El(t) };
global.window = {};
eval(fs.readFileSync('dtable.js', 'utf8'));

let pass = 0, total = 0;
const ok = (n, c) => { total++; console.log((c ? 'OK  ' : 'FAIL') + ' ' + n); if (c) pass++; else process.exitCode = 1; };

const root = El('div');
let clicked = 0;
window.DTable(root, [{ t: '#', w: '2em' }, { t: 'Nume', w: '2fr' }, { t: 'Act', w: 'auto' }], [
  ['#1', 'Ana', { btn: { text: ' Intra ', click: () => clicked++ } }],
  ['#2', { a: { href: 'p.html?u=x', text: 'x' } }, null],
], 'gol');
ok('radacina .dtable', root._cls.has('dtable'));
ok('variabila --cols', root.style.props['--cols'] === '2em 2fr auto');
const head = root.children[0], body = root.children[1];
ok('head + body', head._cls.has('dtable-head') && body._cls.has('dtable-body'));
ok('head 3 celule', head.children.length === 3 && head.children[1]._text === 'Nume');
ok('2 randuri', body.children.length === 2);
const r1 = body.children[0];
ok('rand .dtable-row', r1._cls.has('dtable-row'));
ok('data-l pe celule', r1.children[1]._attrs['data-l'] === 'Nume');
ok('text simplu', r1.children[1]._text === 'Ana');
const btn = r1.children[2].children[0];
ok('buton cu handler', btn.tag === 'button' && btn._text.trim() === 'Intra');
btn._listeners.click[0]();
ok('click functioneaza', clicked === 1);
const r2 = body.children[1];
const link = r2.children[1].children[0];
ok('link href+text', link.tag === 'a' && link.href === 'p.html?u=x' && link._text === 'x');
ok('null -> —', r2.children[2]._text === '—');

const empty = El('div');
window.DTable(empty, [{ t: 'A' }], [], 'nimic');
ok('gol afiseaza emptyText', empty.children[1].children[0]._text === 'nimic' && empty.children[1].children[0]._cls.has('dtable-empty'));

// statice: niciun <table> in proiect
const files = fs.readdirSync('.').filter(f => (f.endsWith('.html') || f.endsWith('.js')) && !f.startsWith('__'));
const bad = files.filter(f => /<(table|tr|td|th)[\s>]/.test(fs.readFileSync(f, 'utf8')));
ok('zero <table>/<tr>/<td>/<th>', bad.length === 0);
if (bad.length) console.log('   ', bad.join(','));
// css + i18n
const css = fs.readFileSync('styles.css', 'utf8');
ok('css dtable complet', ['.dtable{', '.dtable-head', '.dtable-row', '.dtable-cell', '.dtable-empty', '.dtable-btns'].every(s => css.includes(s)));
const { D } = require('./i18n_dict.js');
ok('tb.* + ad.by/se x3', ['tb.title', 'tb.size', 'tb.level', 'tb.players', 'tb.act', 'tb.status', 'ad.by', 'ad.seen'].every(k => D.ro[k] && D.en[k] && D.ru[k]));
// pagini cu dtable.js
for (const p of ['rating.html', 'users.html', 'play.html', 'admin.html', 'adsorder.html']) {
  if (!fs.readFileSync(p, 'utf8').includes('dtable.js')) ok('dtable.js in ' + p, false);
}
ok('dtable.js inclus in 5 pagini', true);
console.log(`\n${pass}/${total} teste trecute`);
process.exit(process.exitCode || 0);

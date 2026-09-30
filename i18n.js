// Helper i18n browser: detectie (?lang > salvat > navigator), aplicare data-i18n, cookies.
(function () {
  function dict() { return (window.I18N_DICT || {}); }
  function detect() {
    const q = new URLSearchParams(location.search).get('lang');
    if (q) return q.slice(0, 2).toLowerCase();
    const s = localStorage.getItem('matroshka_lang');
    if (s) return s;
    const n = (navigator.language || 'ro').slice(0, 2).toLowerCase();
    return ['ro', 'en', 'ru'].includes(n) ? n : 'ro';
  }
  window.LANG = detect();
  // tema dark/light (default dark)
  window.THEME = localStorage.getItem('tic_theme') || 'dark';
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', window.THEME);
    const b = document.getElementById('menuTheme');
    if (b) b.textContent = window.THEME === 'dark' ? '☀️' : '🌙';
  }
  window.setTheme = function (t) {
    window.THEME = (t === 'light' ? 'light' : 'dark');
    localStorage.setItem('tic_theme', window.THEME);
    applyTheme();
  };
  applyTheme();
  window.T = function (key, vars) {
    const d = dict();
    if (!d.tr) return key;
    return d.tr(d.D[window.LANG] ? window.LANG : 'ro', key, vars);
  };
  window.setLang = function (l) {
    window.LANG = (['ro', 'en', 'ru'].includes(l) ? l : 'ro');
    localStorage.setItem('matroshka_lang', window.LANG);
    apply();
    if (window.Net && window.Net.setLang) window.Net.setLang(window.LANG);
    markSwitcher();
  };
  function apply() {
    document.documentElement.lang = window.LANG;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = T(el.getAttribute('data-i18n')); });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.setAttribute('placeholder', T(el.getAttribute('data-i18n-ph'))); });
    document.querySelectorAll('[data-i18n-title]').forEach(el => { el.setAttribute('title', T(el.getAttribute('data-i18n-title'))); });
  }
  window.applyI18n = apply;
  function markSwitcher() {
    document.querySelectorAll('.langsw').forEach(b => b.classList.toggle('active', b.getAttribute('data-lang') === window.LANG));
  }
  // cookies banner
  window.adsConsent = function () { return localStorage.getItem('matroshka_cookies') !== 'no'; };
  function cookies() {
    if (localStorage.getItem('matroshka_cookies')) return;
    const d = document.createElement('div');
    d.className = 'cookies';
    d.innerHTML = `<span data-i18n="ck.text"></span><button class="btn small" id="ckOk" data-i18n="ck.ok"></button><button class="btn small ghost-btn" id="ckNo" data-i18n="ck.no"></button>`;
    document.body.appendChild(d);
    apply();
    document.getElementById('ckOk').addEventListener('click', () => { localStorage.setItem('matroshka_cookies', 'yes'); d.remove(); if (window.loadAdSlots) window.loadAdSlots(); });
    document.getElementById('ckNo').addEventListener('click', () => { localStorage.setItem('matroshka_cookies', 'no'); d.remove(); });
  }
  document.addEventListener('DOMContentLoaded', () => {
    apply(); markSwitcher(); cookies(); applyTheme();
    document.querySelectorAll('.langsw').forEach(b => b.addEventListener('click', () => setLang(b.getAttribute('data-lang'))));
    if (window.loadAdSlots) window.loadAdSlots();
  });
})();

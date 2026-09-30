// Meniu comun injectat in #siteMenu pe TOATE paginile.
// Contine: logo, linkuri, dropdown limba, Login (in header) sau user-chip + Admin (doar admin).
(function () {
  function build() {
    const host = document.getElementById('siteMenu');
    if (!host) return;
    host.innerHTML =
      '<header class="nav"><a class="logo" href="index.html">🪆 TIC-TAK-TOK</a>' +
      '<button id="menuBurger" aria-label="menu">☰</button>' +
      '<nav id="menuNav">' +
      '<a href="play.html" data-i18n="nav.play"></a>' +
      '<a href="rating.html" data-i18n="nav.rating"></a>' +
      '<a href="users.html" data-i18n="nav.users"></a>' +
      '<a href="faq.html" data-i18n="nav.faq"></a>' +
      '<a href="adsorder.html" data-i18n="nav.ads"></a>' +
      '<a href="admin.html" data-i18n="nav.admin" id="menuAdmin" class="hidden"></a>' +
      '<span class="menu-tools"><select class="langsel" id="menuLang"><option value="ro">RO</option><option value="en">EN</option><option value="ru">RU</option></select>' +
      '<button id="menuTheme" title="theme">☀️</button>' +
      '<span id="menuAuth"></span></span>' +
      '</nav></header>';
    document.getElementById('menuBurger').addEventListener('click', () => {
      document.getElementById('menuNav').classList.toggle('open');
    });
    const sel = document.getElementById('menuLang');
    sel.value = window.LANG || 'ro';
    sel.addEventListener('change', () => window.setLang(sel.value));
    const th = document.getElementById('menuTheme');
    th.textContent = (window.THEME === 'dark' ? '☀️' : '🌙');
    th.addEventListener('click', () => window.setTheme(window.THEME === 'dark' ? 'light' : 'dark'));
    if (window.applyI18n) window.applyI18n();
    authState();
  }
  function paintUser(box, u, role) {
    box.innerHTML = '';
    const a = document.createElement('a');
    a.className = 'btn small';
    a.href = 'profile.html';
    a.textContent = `👤 ${u.name} · Profil`;
    const out = document.createElement('button');
    out.className = 'btn small ghost-btn'; out.textContent = '×';
    out.title = 'logout';
    out.addEventListener('click', () => { window.Session ? Session.logout() : null; location.reload(); });
    box.appendChild(a); box.appendChild(out);
    if (role === 'admin' || u.isAdmin) { const al = document.getElementById('menuAdmin'); if (al) al.classList.remove('hidden'); }
  }
  function authState() {
    const box = document.getElementById('menuAuth');
    if (!box) return;
    // 1) instant din cache (Session unic)
    var cached = window.Session ? Session.get() : { token: null, me: null };
    if (cached.me) { paintUser(box, cached.me, cached.role); box.dataset.ok = '1'; }
    else if (!cached.token) { loginBtn(box); return; }
    // 2) verificare reala la server, identic pe toate paginile
    if (!window.Session) { if (!cached.me) loginBtn(box); return; }
    Session.ensure(3500).then(function (st) {
      if (st.role === 'guest') { box.dataset.ok = ''; loginBtn(box); return; }
      box.dataset.ok = '1';
      paintUser(box, st.user, st.role);
    });
  }
  function loginBtn(box) {
    box.innerHTML = '';
    const a = document.createElement('a');
    a.className = 'btn small';
    a.href = 'login.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search);
    a.textContent = (window.T ? T('au.login') : 'Login');
    box.appendChild(a);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();

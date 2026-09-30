// Client WS v3: auth nou (confirm email), mese waiting-only, rejoin, i18n.
(function () {
  let ws = null, roomCode = null, you = null, myTableCode = null;
  let me = { user: null, isAdmin: false, guest: 'Anonim', allowedSizes: [3], myLevel: 1, premium: false, brackets: null, maxLevel: 10 };
  function canJoinLocal(p, t) {
    const br = (me.brackets || []).find(b => t >= b.from && t <= b.to);
    const low = (br && br.accessMin != null && br.accessMin !== '') ? Number(br.accessMin) : t - 1;
    return p >= low && p <= t;
  }
  let reconnAtt = 0, reconnTimer = null, hbTimer = null, lastPong = 0;
  const $ = id => document.getElementById(id);
  const T = (k, v) => (window.T ? window.T(k, v) : k);

  function chatLine(from, text) {
    const box = $('chatBox'); if (!box) return;
    const d = document.createElement('div');
    d.className = 'chat-line' + (from === 'Sistem' ? ' sys' : '');
    const b = document.createElement('b'); b.textContent = from + ': ';
    const sp = document.createElement('span'); sp.textContent = text;
    d.appendChild(b); d.appendChild(sp);
    box.appendChild(d); box.scrollTop = box.scrollHeight;
  }
  function setStatus(t) { const el = $('netStatus'); if (el) el.textContent = t; }
  function wsURL() { const proto = location.protocol === 'https:' ? 'wss' : 'ws'; return `${proto}://${location.host}`; }
  function ensureConn(cb) {
    if (ws && ws.readyState === 1) return cb && cb();
    setStatus('…');
    ws = new WebSocket(wsURL());
    ws.onopen = () => {
      const wasReconn = reconnAtt > 0;
      reconnAtt = 0; lastPong = Date.now();
      const s = window.Session ? Session.get() : { token: null };
      let nm = '';
      try { nm = localStorage.getItem('matroshka_name') || ''; } catch (e) {}
      ws.send(JSON.stringify({ t: 'hello', lang: window.LANG || 'ro', name: nm, token: s.token || '' }));
      startHb();
      if (cb) cb();
      // auto-rejoin dupa cadere: daca eram la o masa, incercam inapoi
      if (wasReconn && roomCode && window.MODE === 'online') setTimeout(() => Net.join(roomCode), 400);
    };
    ws.onmessage = onMsg;
    ws.onclose = () => {
      stopHb();
      if (roomCode || window.MODE === 'online') {
        reconnAtt++;
        const wait = Math.min(10000, [1000, 2000, 5000, 10000][Math.min(reconnAtt - 1, 3)]);
        setStatus(`↻ … (${reconnAtt})`);
        clearTimeout(reconnTimer);
        reconnTimer = setTimeout(() => ensureConn(), wait);
      } else setStatus('!offline');
    };
    ws.onerror = () => setStatus('!server pornit?');
  }
  function startHb() {
    stopHb();
    lastPong = Date.now();
    hbTimer = setInterval(() => {
      if (!ws || ws.readyState !== 1) return;
      try { ws.send(JSON.stringify({ t: 'ping' })); } catch (e) {}
      if (Date.now() - lastPong > 60000) { try { ws.close(); } catch (e) {} }
    }, 25000);
  }
  function stopHb() { if (hbTimer) { clearInterval(hbTimer); hbTimer = null; } }

  function renderAuth() {
    const box = $('authArea'); if (!box) return;
    box.innerHTML = '';
    if (me.user) {
      const u = me.user;
      const w = document.createElement('span'); w.className = 'who';
      const b = document.createElement('b'); b.textContent = '👤 ' + u.name;
      const lv = document.createElement('span'); lv.className = 'lvl'; lv.textContent = `Nv ${u.level} ${u.levelName || ''}`;
      const rt = document.createElement('span'); rt.className = 'rt'; rt.textContent = `⭐ ${u.rating !== undefined ? u.rating : '—'}${u.premium ? ' 👑' : ''}`;
      w.appendChild(b); w.appendChild(lv); w.appendChild(rt);
      box.appendChild(w);
      const prof = document.createElement('a'); prof.className = 'btn small ghost-btn'; prof.href = 'profile.html'; prof.textContent = '👤 Profil';
      const out = document.createElement('button'); out.className = 'btn small ghost-btn'; out.textContent = '×';
      out.title = 'logout';
      out.addEventListener('click', () => Net.logout());
      box.appendChild(prof); box.appendChild(out);
      if (me.isAdmin) { const a = document.createElement('a'); a.className = 'btn small ghost-btn'; a.href = 'admin.html'; a.textContent = '⚙'; box.appendChild(a); }
    } else {
      const s = document.createElement('span'); s.className = 'hint'; s.textContent = T('au.anon') + ' ';
      const b = document.createElement('a'); b.className = 'btn small'; b.textContent = T('au.login') + ' / ' + T('au.reg');
      b.href = 'login.html?next=' + encodeURIComponent('play.html');
      box.appendChild(s); box.appendChild(b);
    }
    const gate = $('createGate'), row = $('createRow');
    if (gate && row) { const logged = !!me.user; gate.classList.toggle('hidden', logged); row.classList.toggle('hidden', !logged); }
    const prof = $('profileBox');
    if (prof) {
      if (me.user) {
        const u = me.user;
        prof.innerHTML = '';
        const h = document.createElement('div');
        h.innerHTML = `<b></b> • <span class="lvl"></span> • <span class="rt"></span><br><span class="hint"></span>`;
        h.querySelector('b').textContent = '👤 ' + u.name;
        h.querySelector('.lvl').textContent = `Nv ${u.level} ${u.levelName || ''}`;
        h.querySelector('.rt').textContent = `⭐ ${u.rating !== undefined ? u.rating : '—'} • ${u.wins || 0}W/${u.games || 0}`;
        h.querySelector('.hint').textContent = `${T('lb.size')}: ${me.allowedSizes.map(x => x + '×' + x).join(', ')}`;
        prof.appendChild(h);
      } else prof.innerHTML = `<span class="hint">${T('au.anon')}</span>`;
    }
    const sel = $('createSize');
    if (sel) {
      sel.innerHTML = '';
      me.allowedSizes.forEach(x => { const o = document.createElement('option'); o.value = x; o.textContent = `${x}×${x}`; sel.appendChild(o); });
    }
    const rj = $('rejoinBanner');
    if (rj) rj.classList.toggle('hidden', !myTableCode);
  }

  function renderTables(list) {
    const wrap = $('tablesList'); if (!wrap) return;
    if (!window.DTable) return;
    const cols = [
      { t: T('tb.title'), w: '2fr' },
      { t: T('tb.size'), w: 'auto' },
      { t: T('tb.level'), w: 'auto' },
      { t: T('tb.players'), w: '2fr' },
      { t: T('tb.act'), w: 'auto' },
    ];
    const rows = (list || []).map(tb => {
      const can = canJoinLocal(me.myLevel, tb.level);
      const seats = (tb.seats || []).map(s => (s.bot ? '🤖' : '👤') + ' ' + s.name).join(' / ');
      return [
        `🪆 ${tb.title} [${tb.code}]`,
        `${tb.size}×${tb.size}`,
        `Nv ${tb.level}${tb.levelName ? ' ' + tb.levelName : ''}\n${T('lb.waiting')}`,
        seats,
        { btn: { text: can ? T('lb.joinb') : `${T('lb.blocked')} (Nv ${tb.level})`, cls: 'btn small' + (can ? '' : ' ghost-btn'), disabled: !can, title: can ? '' : T('lb.only'), click: (() => { const code = tb.code; return () => Net.join(code); })() } },
      ];
    });
    DTable(wrap, cols, rows, T('lb.none'));
  }

  function renderLeaders(list) {
    const box = $('leaderBox'); if (!box) return;
    box.innerHTML = '<h3>🏆 Top</h3>';
    if (!window.DTable || !list || !list.length) return;
    const div = document.createElement('div');
    box.appendChild(div);
    DTable(div, [
      { t: T('rt.rank'), w: '2em' },
      { t: T('rt.player'), w: '2fr' },
      { t: T('rt.rating'), w: 'auto' },
    ], (list || []).map((u, i) => [
      '#' + (i + 1),
      { a: { href: 'profile.html?u=' + encodeURIComponent(u.name), text: u.name } },
      '⭐ ' + u.rating,
    ]), '—');
  }

  function showRoom(on) {
    const lv = $('lobbyView'), rv = $('roomView'), cs = $('chatSection'), ba = $('boardArea');
    if (lv) lv.classList.toggle('hidden', on);
    if (rv) rv.classList.toggle('hidden', !on);
    if (cs) cs.classList.toggle('hidden', !on);
    if (ba) ba.classList.toggle('hidden', window.MODE === 'online' && !on);
  }

  function onMsg(ev) {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === 'welcome') return;
    else if (m.t === 'pong') { lastPong = Date.now(); return; }
    else if (m.t === 'auth') {
      if (window.Session) Session.save(m);
      else {
        if (m.token) { try { localStorage.setItem('matroshka_token', m.token); } catch (e) {} }
        if (m.user) { try { localStorage.setItem('matroshka_name', m.user.name); } catch (e) {} }
      }
      if (m.user) me.user = m.user;
      // NU stergem tokenul la auth-guest: curatarea se face doar la logout explicit.
      else if (m.user === null && window.__loggingOut) { me.user = null; if (window.Session) Session.clear(); window.__loggingOut = false; }
      me.isAdmin = !!m.isAdmin;
      me.role = (m.role || (m.isAdmin ? 'admin' : (m.user ? 'user' : 'guest')));
      if (m.allowedSizes) me.allowedSizes = m.allowedSizes;
      if (m.brackets) me.brackets = m.brackets;
      if (m.maxLevel) me.maxLevel = m.maxLevel;
      if (m.myLevel) me.myLevel = m.myLevel;
      if (m.guest) me.guest = m.guest;
      if (m.premium !== undefined) me.premium = m.premium;
      myTableCode = m.myTable || null;
      renderAuth();
      if (window.MODE === 'online') Net.tables();
    }
    else if (m.t === 'registered') {
      setStatus(T('au.check') + ' → confirm.html');
    }
    else if (m.t === 'tables') renderTables(m.list || []);
    else if (m.t === 'leaderboard') renderLeaders(m.list || []);
    else if (m.t === 'room') {
      roomCode = m.code; you = m.you;
      window.MY_PLAYER = you; window.MODE = 'online';
      myTableCode = null; renderAuth();
      $('roomCode').textContent = roomCode;
      $('youLabel').textContent = you === 1 ? '🔴 P1' : '🔵 P2';
      history.replaceState(null, '', `play.html?room=${roomCode}`);
      showRoom(true);
      const link = $('roomLink'); if (link) link.textContent = location.href;
    }
    else if (m.t === 'state') {
      window.MODE = 'online'; showRoom(true);
      applyRemoteState(m);
      const rt = $('roomTitle'); if (rt) rt.textContent = m.title || m.code;
      const vv = $('rematchVotes'); if (vv && window.votesText) vv.textContent = votesText();
    }
    else if (m.t === 'chat') chatLine(m.from, m.text);
    else if (m.t === 'notice') {
      chatLine('Sistem', m.text);
      const el = $('message'); if (el) el.textContent = m.text;
    }
    else if (m.t === 'left') {
      roomCode = null; you = null; window.MY_PLAYER = null;
      history.replaceState(null, '', 'play.html');
      showRoom(false); Net.tables();
      if (window.setMode) setMode('online');
    }
    else if (m.t === 'error') {
      if (m.code === 'room404' && roomCode) {
        roomCode = null; you = null; window.MY_PLAYER = null;
        history.replaceState(null, '', 'play.html');
        showRoom(false); Net.tables();
      }
      setStatus('⚠ ' + m.reason);
    }
  }

  window.Net = {
    me: () => me,
    init() {
      if (window.Session) {
        const c = Session.get();
        if (c.me && !me.user) {
          me.user = { name: c.me.name, level: c.me.level || 1, levelName: '', wins: 0, games: 0 };
          me.isAdmin = c.me.role === 'admin';
          me.role = c.me.role;
          renderAuth();
        }
      }
      ensureConn(() => { Net.tables(); Net.leaderboard(); });
    },
    setLang(l) { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'setLang', lang: l })); },
    tables() { ensureConn(() => ws.send(JSON.stringify({ t: 'tables' }))); },
    leaderboard(limit) { ensureConn(() => ws.send(JSON.stringify({ t: 'leaderboard', limit: limit || 5 }))); },
    logout() {
      window.__loggingOut = true;
      me.user = null; me.isAdmin = false; me.role = 'guest';
      if (window.Session) Session.clear();
      ensureConn(() => ws.send(JSON.stringify({ t: 'logout' })));
      renderAuth();
    },
    create() {
      if (!me.user) { setStatus(T('au.need')); return; }
      window.MODE = 'online';
      $('chatBox').innerHTML = '';
      const players = Math.min(6, Math.max(2, Number(($('createPlayers') || {}).value || '2')));
      ensureConn(() => ws.send(JSON.stringify({ t: 'create', title: $('createTitle').value, size: Number($('createSize').value || '3'), players })));
    },
    join(code) {
      const c = (code || $('roomInput').value || '').toUpperCase().trim();
      if (!c) return;
      window.MODE = 'online';
      $('chatBox').innerHTML = '';
      ensureConn(() => ws.send(JSON.stringify({ t: 'join', code: c })));
    },
    rejoin() { if (myTableCode) Net.join(myTableCode); },
    leave() { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'leave' })); },
    sendMove(size, r, c) {
      if (!ws || ws.readyState !== 1 || !roomCode) return false;
      ws.send(JSON.stringify({ t: 'move', r, c, size }));
      return true;
    },
    sendChat() {
      const inp = $('chatInput');
      const text = (inp.value || '').trim();
      if (!text || !ws || ws.readyState !== 1) return;
      ws.send(JSON.stringify({ t: 'chat', text }));
      inp.value = '';
    },
    rematch(accept) {
      if (ws && ws.readyState === 1 && roomCode) ws.send(JSON.stringify({ t: 'rematch', accept }));
      else if (!accept) showRoom(false);
    },
  };
})();

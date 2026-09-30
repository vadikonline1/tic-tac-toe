// Sesiune + roluri UNICE pe tot site-ul. Toate paginile folosesc asta identic.
// Roluri: 'guest' (fara cont/token valid), 'user' (logat), 'admin' (email in adminEmails).
// Stocare: matroshka_token / matroshka_name / tic_me {name,level,role,isAdmin}.
(function () {
  var K = { token: 'matroshka_token', name: 'matroshka_name', me: 'tic_me' };
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function wsURL() {
    var proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return proto + '://' + location.host;
  }
  function roleOfAuth(m) {
    if (m && m.role) return m.role;
    if (m && m.isAdmin) return 'admin';
    if (m && m.user) return 'user';
    return 'guest';
  }
  var Session = {
    // citire sincrona cache (instant, fara WS)
    get: function () {
      var me = null;
      try { me = JSON.parse(lsGet(K.me) || 'null'); } catch (e) {}
      var token = lsGet(K.token);
      if (!token) return { token: null, me: null, role: 'guest' };
      if (me && me.name) {
        me.role = me.role || (me.isAdmin ? 'admin' : 'user');
        return { token: token, me: me, role: me.role };
      }
      return { token: token, me: null, role: 'guest' };
    },
    // salveaza raspuns auth de la server ( smallest single writer )
    save: function (m) {
      if (!m) return;
      if (m.token) lsSet(K.token, m.token);
      if (m.user) {
        lsSet(K.name, m.user.name);
        lsSet(K.me, JSON.stringify({ name: m.user.name, level: m.user.level || 1, role: roleOfAuth(m), isAdmin: !!m.isAdmin }));
      }
    },
    // sterge tot (doar la logout explicit sau token mort confirmat)
    clear: function () { lsDel(K.token); lsDel(K.name); lsDel(K.me); },
    // cere starea reala de la server (one-shot); rezolva mereu, nu respinge
    ensure: function (timeoutMs) {
      var self = this;
      return new Promise(function (resolve) {
        var done = false;
        var finish = function (v) { if (!done) { done = true; resolve(v); } };
        var timer = setTimeout(function () { finish(self.status()); }, timeoutMs || 4000);
        var ws;
        try { ws = new WebSocket(wsURL()); } catch (e) { clearTimeout(timer); finish(self.status()); return; }
        ws.onopen = function () {
          var s = self.get();
          ws.send(JSON.stringify({ t: 'hello', lang: (window.LANG || 'ro'), token: s.token || '' }));
        };
        ws.onmessage = function (ev) {
          var m; try { m = JSON.parse(ev.data); } catch (e) { return; }
          if (m.t !== 'auth') return;
          clearTimeout(timer);
          try { ws.close(); } catch (e) {}
          if (m.user) { self.save(m); finish(self.status(m)); }
          else { self.clear(); finish({ role: 'guest', user: null, isAdmin: false, guest: true }); }
        };
        ws.onerror = function () { clearTimeout(timer); finish(self.status()); };
      });
    },
    // status curent: prefera raspunsul proaspat, altfel cache
    status: function (freshAuth) {
      if (freshAuth && freshAuth.user) {
        return { role: roleOfAuth(freshAuth), user: freshAuth.user, isAdmin: !!freshAuth.isAdmin, premium: !!freshAuth.premium, guest: false };
      }
      var s = this.get();
      if (s.me) return { role: s.me.role || 'user', user: s.me, isAdmin: !!s.me.isAdmin, guest: false };
      return { role: 'guest', user: null, isAdmin: false, guest: true };
    },
    logout: function () {
      this.clear();
      try {
        var ws = new WebSocket(wsURL());
        ws.onopen = function () { try { ws.send(JSON.stringify({ t: 'logout' })); ws.close(); } catch (e) {} };
      } catch (e) {}
    },
    isAdmin: function (st) { return (st || this.status()).role === 'admin'; },
    isUser: function (st) { var r = (st || this.status()).role; return r === 'user' || r === 'admin'; }
  };
  window.Session = Session;
})();

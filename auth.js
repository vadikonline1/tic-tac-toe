// Logica comuna paginilor login/register/recovery: trimite mesajul potrivit si afiseaza raspunsul.
(function () {
  function conn(onAuth) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}`);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', lang: window.LANG || 'ro', token: localStorage.getItem('matroshka_token') || '' }));
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      onAuth(ws, m);
    };
    return ws;
  }
  function nextUrl(fallback) {
    const n = new URLSearchParams(location.search).get('next');
    if (n && /^[a-z0-9_.-]+\.html(\?.*)?$/i.test(n)) return n;
    return fallback;
  }
  window.AuthPages = { conn, nextUrl };
})();

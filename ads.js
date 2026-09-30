// Sloturi reclama: house ads de la server + optional Google AdSense. Non-agresiv, etichetat.
// Ascuns pentru premium sau fara consimtamant (doar AdSense cere consimtamant; house = first-party).
(function () {
  function oneShot(req) {
    return new Promise(resolve => {
      try {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${proto}://${location.host}`);
        const timer = setTimeout(() => { try { ws.close(); } catch (e) {} resolve(null); }, 4000);
        const tok = (window.Session ? Session.get().token : null) || '';
        ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token: tok }));
        let sent = false;
        ws.onmessage = ev => {
          let m; try { m = JSON.parse(ev.data); } catch { return; }
          if (m.t === 'auth') {
            if (window.Session) Session.save(m);
            const premium = !!(m.user && m.user.premium);
            if (premium) { clearTimeout(timer); ws.close(); resolve({ premium: true }); return; }
            if (!sent) { sent = true; ws.send(JSON.stringify(req)); }
          } else if (m.t === 'ads') {
            clearTimeout(timer); ws.close(); resolve({ premium: false, ads: m.list || [], adsense: m.adsense || '', adsenseSnippet: m.adsenseSnippet || '' });
          }
        };
      } catch (e) { resolve(null); }
    });
  }
  function adblockOn() {
    try {
      const b = document.createElement('div');
      b.className = 'adsbox ad-slot test-ad sponsor';
      b.style.cssText = 'position:absolute;left:-9999px;width:10px;height:10px;';
      document.body.appendChild(b);
      const blocked = b.offsetHeight === 0 || window.getComputedStyle(b).display === 'none';
      b.remove();
      try { localStorage.setItem('tic_adblock', blocked ? '1' : '0'); } catch (e) {}
      return blocked;
    } catch (e) { return false; }
  }
  function mountAdSense(el, snippet) {
    // monteaza blocul complet (ins + scripturi re-executate, ca innerHTML singur nu le ruleaza)
    el.innerHTML = '';
    el.classList.add('adslot');
    const tag = document.createElement('span');
    tag.className = 'adtag';
    tag.textContent = window.T ? T('ad.slot') : 'Ad';
    el.appendChild(tag);
    const tmp = document.createElement('div');
    tmp.innerHTML = snippet;
    tmp.querySelectorAll('ins').forEach(n => el.appendChild(n));
    Array.from(tmp.childNodes).forEach(n => {
      if (n.nodeType === 1 && n.tagName !== 'SCRIPT' && n.tagName !== 'INS') el.appendChild(n);
    });
    tmp.querySelectorAll('script').forEach(old => {
      const s = document.createElement('script');
      if (old.src) { s.async = true; s.src = old.src; }
      if (old.getAttribute('crossorigin')) s.crossOrigin = 'anonymous';
      if (old.textContent && old.textContent.trim()) s.textContent = old.textContent;
      el.appendChild(s);
    });
    try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
  }
  window._mountAdSense = mountAdSense;
  window._adblockOn = adblockOn;
  function renderSlot(el, ad) {
    el.innerHTML = '';
    el.classList.add('adslot');
    const tag = document.createElement('span');
    tag.className = 'adtag';
    tag.textContent = (window.T ? T('ad.slot') : 'Ad');
    el.appendChild(tag);
    const a = document.createElement('a');
    a.href = ad.link; a.target = '_blank'; a.rel = 'nofollow sponsored';
    if (ad.img) {
      const img = document.createElement('img');
      img.src = ad.img; img.alt = ad.title;
      a.appendChild(img);
    } else {
      const s = document.createElement('span');
      s.className = 'adtext'; s.textContent = ad.title;
      a.appendChild(s);
    }
    el.appendChild(a);
  }
  window.loadAdSlots = async function () {
    const slots = document.querySelectorAll('[data-adslot]');
    if (!slots.length) return;
    const data = await oneShot({ t: 'ads' });
    if (!data || data.premium) { slots.forEach(el => el.remove()); return; }
    const consent = (window.adsConsent ? window.adsConsent() : true);
    const ab = adblockOn(); // cu adblock aratam doar reclame de la utilizatori
    slots.forEach(el => {
      const slot = el.getAttribute('data-adslot');
      const ad = (data.ads || []).find(x => x.slot === slot);
      if (ad) { renderSlot(el, ad); return; }
      if (ab) { el.remove(); return; }
      if (data.adsenseSnippet) { mountAdSense(el, data.adsenseSnippet); return; }
      if (data.adsense && consent) {
        el.classList.add('adslot');
        el.innerHTML = `<span class="adtag">${window.T ? T('ad.slot') : 'Ad'}</span><ins class="adsbygoogle" style="display:block" data-ad-client="${data.adsense}" data-ad-slot="auto" data-ad-format="auto"></ins>`;
        try {
          if (!document.querySelector('script[data-adsense]')) {
            const s = document.createElement('script');
            s.async = true; s.setAttribute('data-adsense', '1');
            s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + data.adsense;
            document.head.appendChild(s);
          }
          (window.adsbygoogle = window.adsbygoogle || []).push({});
        } catch (e) {}
        return;
      }
      el.remove();
    });
  };
  window._adsFetch = oneShot;
  // Reclama in modalul "Partida terminata": house ad > AdSense > demo.
  window.renderRematchAd = async function () {
    const el = document.getElementById('rematchAd');
    if (!el) return;
    el.classList.remove('hidden');
    const tag = window.T ? T('ad.slot') : 'Ad';
    el.innerHTML = `<span class="adtag">${tag}</span><span class="adtext">…</span>`;
    const data = await oneShot({ t: 'ads' });
    if (!data || data.premium) { el.classList.add('hidden'); el.innerHTML = ''; return; }
    const house = (data.ads || [])[0];
    if (house) {
      el.innerHTML = `<span class="adtag">${tag}</span><a target="_blank" rel="nofollow sponsored"><span class="adtext"></span></a>`;
      el.querySelector('a').href = house.link;
      el.querySelector('.adtext').textContent = house.title;
      return;
    }
    const ab = adblockOn();
    const consent = window.adsConsent ? window.adsConsent() : true;
    if (!ab && data.adsenseSnippet) { mountAdSense(el, data.adsenseSnippet); return; }
    if (!ab && data.adsense && consent) {
      el.innerHTML = `<span class="adtag">${tag}</span><ins class="adsbygoogle" style="display:block" data-ad-client="${data.adsense}" data-ad-slot="auto" data-ad-format="auto"></ins>`;
      try {
        if (!document.querySelector('script[data-adsense]')) {
          const s = document.createElement('script');
          s.async = true; s.setAttribute('data-adsense', '1');
          s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + data.adsense;
          document.head.appendChild(s);
        }
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch (e) {}
      return;
    }
    el.innerHTML = `<span class="adtag">${tag} · demo</span><span class="adtext">🪆 TIC-TAK-TOK Premium — joacă fără reclame!</span>`;
  };
})();

// Tabele din DIV-uri, folosite identic pe toate paginile.
// DTable(el, cols, rows, emptyText)
// cols: [{t:'Header', w:'2fr'}]  (w = latime coloana grid, default 1fr)
// rows: [[cell, ...]]  cell = text | {t:'text'} | {h:'<b>html</b>'} | {a:{href,text,blank}} | {btn:{text,cls,click}}
(function () {
  function mkBtn(bd) {
    const b = document.createElement('button');
    b.className = (bd && bd.cls) || 'btn small ghost-btn';
    b.textContent = (bd && bd.text) || '';
    if (bd && bd.title) b.title = bd.title;
    if (bd && bd.disabled) b.disabled = true;
    if (bd && bd.click) b.addEventListener('click', bd.click);
    return b;
  }
  function cellEl(label, v) {
    const d = document.createElement('div');
    d.className = 'dtable-cell';
    d.setAttribute('data-l', label || '');
    if (v && typeof v === 'object') {
      if (v.a) {
        const a = document.createElement('a');
        a.href = v.a.href; a.textContent = v.a.text || v.a.href;
        if (v.a.blank) a.target = '_blank';
        if (v.a.cls) a.className = v.a.cls;
        d.appendChild(a);
      } else if (v.btns) {
        const w = document.createElement('div');
        w.className = 'dtable-btns';
        v.btns.forEach(bd => w.appendChild(mkBtn(bd)));
        d.appendChild(w);
      } else if (v.btn) {
        d.appendChild(mkBtn(v.btn));
      } else if (v.h !== undefined) d.innerHTML = v.h;
      else if (v.t !== undefined) d.textContent = v.t;
    } else {
      d.textContent = (v === null || v === undefined || v === '') ? '—' : String(v);
    }
    return d;
  }
  window.DTable = function (el, cols, rows, emptyText) {
    if (!el) return;
    el.innerHTML = '';
    el.classList.add('dtable');
    el.style.setProperty('--cols', cols.map(c => c.w || '1fr').join(' '));
    const head = document.createElement('div');
    head.className = 'dtable-head';
    cols.forEach(c => {
      const h = document.createElement('div');
      h.className = 'dtable-cell';
      h.textContent = c.t || '';
      head.appendChild(h);
    });
    el.appendChild(head);
    const body = document.createElement('div');
    body.className = 'dtable-body';
    (rows || []).forEach(r => {
      const row = document.createElement('div');
      row.className = 'dtable-row';
      cols.forEach((c, i) => row.appendChild(cellEl(c.t, r[i])));
      body.appendChild(row);
    });
    if (!(rows || []).length) {
      const e = document.createElement('div');
      e.className = 'dtable-empty';
      e.textContent = emptyText || '—';
      body.appendChild(e);
    }
    el.appendChild(body);
  };
})();

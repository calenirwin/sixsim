// SPACE r2 (docs/notes/space-r2.md): the light showcase's interface. The wordmark, the tour's caption, the actions, the
// mode legend and the menu (Resume, Mode, Place, Time of day, Quality, Controls, About), navigable by mouse, keyboard and
// gamepad. Hierarchy comes from size and weight; legibility from a soft scrim and text shadows; nothing here animates
// except opacity on show and hide. game/showcase.js owns the state and passes callbacks.

const CSS = `
#sc-ui{font-family:Inter,system-ui,-apple-system,'Segoe UI',sans-serif;color:#fff;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
#sc-ui button{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer}
#sc-ui button:focus{outline:none}
#sc-ui button:focus-visible{outline:2px solid rgba(255,255,255,.7);outline-offset:3px;border-radius:6px}
#sc-fade{position:fixed;inset:0;background:#05070a;opacity:1;transition:opacity .8s ease;pointer-events:none;z-index:20}
#sc-grad{position:fixed;left:0;right:0;bottom:0;height:36vh;z-index:19;pointer-events:none;background:linear-gradient(to top,rgba(0,0,0,.52),rgba(0,0,0,.18) 45%,rgba(0,0,0,0))}
#sc-tgrad{position:fixed;left:0;right:0;top:0;height:20vh;z-index:19;pointer-events:none;background:linear-gradient(to bottom,rgba(0,0,0,.32),rgba(0,0,0,0))}
.sc-sh{text-shadow:0 1px 2px rgba(0,0,0,.4),0 2px 18px rgba(0,0,0,.35)}
#sc-brand{position:fixed;left:max(24px,3.2vw);top:max(20px,3.4vh);z-index:21;pointer-events:none;transition:opacity .6s ease}
#sc-brand .n{font-weight:600;font-size:20px;letter-spacing:-.01em}
#sc-brand .s{font-weight:400;font-size:14px;opacity:.82;margin-top:2px}
#sc-card{position:fixed;left:max(24px,3.2vw);bottom:max(28px,5.2vh);z-index:21;max-width:min(640px,70vw);pointer-events:none;opacity:0;transition:opacity .8s ease}
#sc-card.on{opacity:1}
#sc-card .p{font-weight:600;font-size:clamp(22px,2.3vw,32px);letter-spacing:-.015em;line-height:1.15}
#sc-card .t{font-weight:400;font-size:clamp(15px,1.25vw,18px);opacity:.88;margin-top:6px;line-height:1.35}
#sc-actions{position:fixed;right:max(16px,2.6vw);bottom:max(22px,4.6vh);z-index:22;display:flex;gap:4px;transition:opacity .6s ease}
#sc-actions button{font-weight:500;font-size:15px;padding:10px 12px;opacity:.86;transition:opacity .2s ease}
#sc-actions button:hover{opacity:1}
#sc-load{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:21;text-align:center;pointer-events:none;transition:opacity .5s ease;width:min(720px,88vw)}
#sc-load .p{font-weight:600;font-size:clamp(24px,2.8vw,38px);letter-spacing:-.015em}
#sc-load .t{font-weight:400;font-size:clamp(15px,1.3vw,18px);opacity:.78;margin-top:8px}
#sc-legend{position:fixed;left:max(24px,3.2vw);bottom:max(28px,5.2vh);z-index:21;display:flex;flex-wrap:wrap;align-items:center;column-gap:22px;row-gap:10px;max-width:min(980px,64vw);opacity:0;transition:opacity 1.2s ease;pointer-events:none}
#sc-legend.on{opacity:1;transition:opacity .4s ease}
#sc-legend .i{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:400}
.sc-caps{display:inline-flex;gap:4px}
.sc-k{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:24px;padding:0 7px;box-sizing:border-box;border-radius:6px;background:rgba(255,255,255,.17);font-size:12px;font-weight:600;letter-spacing:.01em;text-shadow:none;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
#sc-place{position:fixed;left:max(24px,3.2vw);bottom:calc(max(28px,5.2vh) + 46px);z-index:21;font-weight:600;font-size:clamp(20px,2vw,28px);letter-spacing:-.015em;opacity:0;transition:opacity 1.2s ease;pointer-events:none}
#sc-place.on{opacity:1;transition:opacity .4s ease}
#sc-menu{position:fixed;inset:0;z-index:40;display:none;opacity:0;transition:opacity .22s ease;background:rgba(7,9,13,.46);-webkit-backdrop-filter:blur(18px) saturate(.85);backdrop-filter:blur(18px) saturate(.85)}
#sc-menu.vis{display:block}
#sc-menu.on{opacity:1}
#sc-menu .col{position:absolute;left:max(28px,8vw);top:50%;transform:translateY(-50%);width:min(460px,calc(100vw - 56px))}
#sc-menu .col.wide{width:min(940px,calc(100vw - 56px))}
#sc-menu .col.mid{width:min(600px,calc(100vw - 56px))}
#sc-menu .wm{font-weight:600;font-size:30px;letter-spacing:-.02em;margin:0 0 26px 16px}
#sc-menu .row{display:flex;align-items:center;justify-content:space-between;height:48px;padding:0 16px;border-radius:10px;cursor:pointer;font-size:17px;user-select:none;-webkit-user-select:none}
#sc-menu .row.f{background:rgba(255,255,255,.11)}
#sc-menu .row .l{font-weight:500}
#sc-menu .row .v{display:flex;align-items:center;justify-content:flex-end;font-weight:400;color:rgba(255,255,255,.72);margin-right:-8px}
#sc-menu .row.f .v{color:#fff}
#sc-menu .row .v .t{text-align:right;white-space:nowrap}
#sc-menu .row .ch{display:flex;align-items:center;justify-content:center;width:26px;height:36px;opacity:0;transition:opacity .15s ease}
#sc-menu .row.f .ch,#sc-menu .row:hover .ch{opacity:.55}
#sc-menu .row .ch:hover{opacity:1}
#sc-menu .gap{height:14px}
#sc-menu .pg{padding:0 16px 8px}
#sc-menu .pg h2{font-weight:600;font-size:22px;letter-spacing:-.015em;margin:0 0 18px}
#sc-menu .pg p{font-size:16px;line-height:1.55;margin:0 0 14px;max-width:560px;color:rgba(255,255,255,.88)}
#sc-menu .pg p.sm{font-size:13.5px;color:rgba(255,255,255,.66)}
#sc-menu .pg a{color:#fff;text-decoration:underline;text-underline-offset:3px;text-decoration-color:rgba(255,255,255,.45)}
#sc-menu .grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));column-gap:36px;row-gap:8px}
#sc-menu .grid h3{font-weight:600;font-size:17px;margin:0 0 10px}
#sc-menu .grid h4{font-weight:500;font-size:14px;margin:18px 0 8px;color:rgba(255,255,255,.66)}
#sc-menu .grid .r{display:flex;align-items:center;gap:10px;font-size:14.5px;min-height:30px;color:rgba(255,255,255,.9)}
#sc-menu .grid .r .sc-caps{min-width:118px}
@media (max-width:820px){#sc-menu .grid{grid-template-columns:1fr}#sc-menu .col.wide{max-height:80vh;overflow:auto}#sc-legend{max-width:calc(100vw - 48px)}}
`;

const CHEV_L = '<svg width="8" height="13" viewBox="0 0 8 13" aria-hidden="true"><path d="M6.5 1.5 1.5 6.5l5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEV_R = '<svg width="8" height="13" viewBox="0 0 8 13" aria-hidden="true"><path d="m1.5 1.5 5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const caps = (keys) => `<span class="sc-caps">${keys.map((k) => `<span class="sc-k">${esc(k)}</span>`).join('')}</span>`;

// the controls of each mode: [keys, action]; the compact legend takes the rows marked `l`
export const CONTROLS = {
  walk: {
    title: 'Walk',
    keys: [[['W', 'A', 'S', 'D'], 'Walk', 1], [['Shift'], 'Run', 1], [['Mouse'], 'Look', 1], [['V'], 'First person', 1], [['F'], 'Get in a car', 0], [['Wheel'], 'Camera distance', 0], [['C'], 'Back onto the path', 0], [['H'], 'Show the controls', 0], [['Esc'], 'Menu', 1]],
    pad: [[['LS'], 'Walk, push fully to run', 1], [['RS'], 'Look', 1], [['Y'], 'First person', 1], [['X'], 'Get in a car', 0], [['Back'], 'Show the controls', 0], [['Start'], 'Menu', 1]],
  },
  drone: {
    title: 'Drone',
    keys: [[['W', 'A', 'S', 'D'], 'Fly', 1], [['Space'], 'Climb', 1], [['Shift'], 'Descend', 1], [['Mouse'], 'Look', 1], [['V'], 'Gimbal view', 1], [['Wheel'], 'Camera distance', 0], [['E', 'Q'], 'Climb, descend', 0], [['H'], 'Show the controls', 0], [['Esc'], 'Menu', 1]],
    pad: [[['LS'], 'Fly', 1], [['RS'], 'Look', 1], [['RT'], 'Climb', 1], [['LT'], 'Descend', 1], [['Y'], 'Gimbal view', 1], [['Back'], 'Show the controls', 0], [['Start'], 'Menu', 1]],
  },
  drive: {
    title: 'Drive',
    keys: [[['W'], 'Accelerate', 1], [['S'], 'Brake, reverse', 1], [['A', 'D'], 'Steer', 1], [['Space'], 'Handbrake', 1], [['V'], 'Bonnet view', 1], [['F'], 'Get out', 0], [['Mouse'], 'Look around', 0], [['C'], 'Back onto the road', 0], [['H'], 'Show the controls', 0], [['Esc'], 'Menu', 1]],
    pad: [[['RT'], 'Accelerate', 1], [['LT'], 'Brake, reverse', 1], [['LS'], 'Steer', 1], [['A'], 'Handbrake', 1], [['Y'], 'Bonnet view', 1], [['X'], 'Get out', 0], [['Back'], 'Show the controls', 0], [['Start'], 'Menu', 1]],
  },
};

function el(tag, attrs = {}, html = '') {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
}

// o: { modes, times, qualities ([[id, label]]), places ([name]), timeLabels ({ id: label } for a time outside the list),
//      drive() (false: no car rows), aboutHTML, onChange(key, value), onMode(id), onNext(), onOpen(), onClose(resume) }
export function createUI(o) {
  const style = el('style'); style.textContent = CSS; document.head.appendChild(style);
  const root = el('div', { id: 'sc-ui' });
  const fade = el('div', { id: 'sc-fade' });
  const grad = el('div', { id: 'sc-grad' }), tgrad = el('div', { id: 'sc-tgrad' });
  const load = el('div', { id: 'sc-load', class: 'sc-sh' }, '<div class="p"></div><div class="t"></div>');
  const brand = el('div', { id: 'sc-brand', class: 'sc-sh' }, '<div class="n">Valdrada</div><div class="s">New York City in real time</div>');
  const card = el('div', { id: 'sc-card', class: 'sc-sh' }, '<div class="p"></div><div class="t"></div>');
  const legend = el('div', { id: 'sc-legend', class: 'sc-sh' });
  const place = el('div', { id: 'sc-place', class: 'sc-sh' });
  const actions = el('div', { id: 'sc-actions', class: 'sc-sh' });
  const menu = el('div', { id: 'sc-menu', role: 'dialog', 'aria-label': 'Menu' });
  root.append(grad, tgrad, fade, load, brand, card, place, legend, actions, menu);
  document.body.appendChild(root);

  // ---- actions (bottom right): in the tour, the ways in; in a mode, the menu
  const btn = (label, fn) => { const b = el('button', { type: 'button' }, esc(label)); b.addEventListener('click', (e) => { e.stopPropagation(); fn(); b.blur(); }); return b; };
  const tourActions = [btn('Walk', () => o.onMode('walk')), btn('Drone', () => o.onMode('drone')), btn('Next scene', () => o.onNext())];
  const menuBtn = btn('Menu', () => api.open());
  actions.append(...tourActions, menuBtn);

  // ---- the menu
  const V = { mode: o.modes[0][0], place: 0, time: o.times[0][0], quality: o.qualities[0][0] };
  const opts = { mode: o.modes, place: o.places.map((n, i) => [i, n]), time: o.times, quality: o.qualities };
  const ROWS = [
    { id: 'resume', label: 'Resume', act: () => api.close(true) },
    { gap: 1 },
    { id: 'mode', label: 'Mode' },
    { id: 'place', label: 'Place' },
    { id: 'time', label: 'Time of day' },
    { id: 'quality', label: 'Quality' },
    { gap: 1 },
    { id: 'controls', label: 'Controls', act: () => page('controls') },
    { id: 'about', label: 'About', act: () => page('about') },
  ];
  let rows = [], focus = 0, sub = null, isOpen = false, lastSub = null;
  const label = (id) => { const L = opts[id]; const it = L.find((x) => x[0] === V[id]); return it ? it[1] : ((id === 'time' && o.timeLabels && o.timeLabels[V[id]]) || ''); };
  function render() {
    menu.innerHTML = '';
    const col = el('div', { class: 'col' + (sub === 'controls' ? ' wide' : sub === 'about' ? ' mid' : '') });
    menu.appendChild(col);
    rows = [];
    if (!sub) {
      col.appendChild(el('div', { class: 'wm' }, 'Valdrada'));
      for (const R of ROWS) {
        if (R.gap) { col.appendChild(el('div', { class: 'gap' })); continue; }
        const r = el('div', { class: 'row', 'data-id': R.id, role: opts[R.id] ? 'group' : 'button' });
        r.appendChild(el('span', { class: 'l' }, esc(R.label)));
        if (opts[R.id]) {
          const v = el('span', { class: 'v' });
          const l = el('span', { class: 'ch', 'aria-label': 'Previous' }, CHEV_L), t = el('span', { class: 't' }, esc(label(R.id))), rr = el('span', { class: 'ch', 'aria-label': 'Next' }, CHEV_R);
          l.addEventListener('click', (e) => { e.stopPropagation(); step(R.id, -1); });
          rr.addEventListener('click', (e) => { e.stopPropagation(); step(R.id, 1); });
          v.append(l, t, rr);
          r.appendChild(v);
          r.addEventListener('click', () => step(R.id, 1));
        } else r.addEventListener('click', () => R.act());
        const i = rows.length;
        r.addEventListener('mouseenter', () => setFocus(i));
        rows.push({ el: r, R });
        col.appendChild(r);
      }
    } else {
      const pg = el('div', { class: 'pg' });
      if (sub === 'controls') pg.innerHTML = '<h2>Controls</h2>' + controlsHTML();
      else pg.innerHTML = '<h2>About</h2>' + o.aboutHTML;
      col.appendChild(pg);
      const r = el('div', { class: 'row', role: 'button' }, '<span class="l">Back</span>');
      r.addEventListener('click', () => page(null));
      r.addEventListener('mouseenter', () => setFocus(0));
      rows.push({ el: r, R: { id: 'back', act: () => page(null) } });
      col.appendChild(r);
    }
    setFocus(Math.min(focus, rows.length - 1));
  }
  function controlsHTML() {
    const car = !o.drive || o.drive();
    const keep = ([, a]) => car || !/car|Get out/.test(a);
    const col = (m) => {
      const C = CONTROLS[m];
      return `<div><h3>${C.title}</h3>${C.keys.filter(keep).map(([k, a]) => `<div class="r">${caps(k)}<span>${esc(a)}</span></div>`).join('')}` +
        `<h4>Gamepad</h4>${C.pad.filter(keep).map(([k, a]) => `<div class="r">${caps(k)}<span>${esc(a)}</span></div>`).join('')}</div>`;
    };
    return `<div class="grid">${o.modes.map((m) => m[0]).filter((m) => CONTROLS[m] && (car || m !== 'drive')).map(col).join('')}</div>`;
  }
  function setFocus(i) {
    focus = Math.max(0, Math.min(rows.length - 1, i));
    rows.forEach((r, k) => r.el.classList.toggle('f', k === focus));
  }
  function step(id, d) {
    const L = opts[id];
    if (!L.length) return;
    let i = L.findIndex((x) => x[0] === V[id]);
    if (i < 0) i = d > 0 ? -1 : 0;
    i = (i + d + L.length) % L.length;
    V[id] = L[i][0];
    const r = rows.find((x) => x.R.id === id);
    if (r) r.el.querySelector('.t').textContent = L[i][1];
    o.onChange(id, V[id]);
  }
  function page(p) {
    if (p) lastSub = p;
    sub = p; focus = 0; render();
    if (!p && lastSub) setFocus(rows.findIndex((r) => r.R.id === lastSub));
  }
  function activate() {
    const r = rows[focus];
    if (!r) return;
    if (opts[r.R.id]) step(r.R.id, 1); else r.R.act();
  }
  // keyboard and gamepad navigation (the menu's own; game/showcase.js forwards while the menu is open)
  function nav(cmd) {
    if (!isOpen) return false;
    if (cmd === 'up') { let i = focus - 1; setFocus(i < 0 ? rows.length - 1 : i); }
    else if (cmd === 'down') { let i = focus + 1; setFocus(i >= rows.length ? 0 : i); }
    else if (cmd === 'left' || cmd === 'right') { const r = rows[focus]; if (r && opts[r.R.id]) step(r.R.id, cmd === 'left' ? -1 : 1); }
    else if (cmd === 'ok') activate();
    else if (cmd === 'back') { if (sub) page(null); else api.close(true); }
    return true;
  }

  // ---- the legend: a mode's key caps and actions, shown when a mode starts, faded after a while
  let legendT = 0;
  function showLegend(mode, pad = false, secs = 7) {
    const C = CONTROLS[mode];
    if (!C) { legend.classList.remove('on'); return; }
    const L = (pad ? C.pad : C.keys).filter((x) => x[2]);
    legend.innerHTML = L.map(([k, a]) => `<span class="i">${caps(k)}<span>${esc(a)}</span></span>`).join('');
    legend.classList.add('on');
    clearTimeout(legendT);
    legendT = setTimeout(() => legend.classList.remove('on'), secs * 1000);
  }
  let placeT = 0;
  function showPlace(name, secs = 7) {
    place.textContent = name;
    place.classList.add('on');
    clearTimeout(placeT);
    placeT = setTimeout(() => place.classList.remove('on'), secs * 1000);
  }

  const api = {
    root, fade, load, card, brand, legend, actions,
    get isOpen() { return isOpen; },
    set(id, v) { V[id] = v; if (isOpen && !sub) { const r = rows.find((x) => x.R.id === id); if (r) r.el.querySelector('.t').textContent = label(id); } },
    get(id) { return V[id]; },
    open() {
      if (isOpen) return;
      isOpen = true; sub = null; focus = 0;
      render();
      menu.classList.add('vis');
      requestAnimationFrame(() => menu.classList.add('on'));
      o.onOpen?.();
    },
    close(resume = false) {
      if (!isOpen) return;
      isOpen = false;
      menu.classList.remove('on');
      setTimeout(() => { if (!isOpen) menu.classList.remove('vis'); }, 230);
      o.onClose?.(resume);
    },
    nav,
    // the screen for each state: 'tour' (wordmark, caption, tour actions), 'mode' (the menu button only), 'none'
    chrome(kind) {
      const tour = kind === 'tour';
      brand.style.opacity = tour ? '1' : '0';
      for (const b of tourActions) b.style.display = tour ? '' : 'none';
      actions.style.opacity = kind === 'none' ? '0' : '1';
      actions.style.pointerEvents = kind === 'none' ? 'none' : '';
      if (!tour) card.classList.remove('on');
    },
    caption(p, t) { card.querySelector('.p').textContent = p; card.querySelector('.t').textContent = t; },
    setPlaces(names) { opts.place = names.map((n, i) => [i, n]); if (isOpen && !sub) render(); },
    setModes(list) { opts.mode = list; if (isOpen && !sub) render(); },
    // a message the page cannot recover from, with the one action that helps
    fatal(title, action, fn) {
      load.querySelector('.p').textContent = title;
      const t = load.querySelector('.t');
      t.textContent = '';
      const b = el('button', { type: 'button' }, esc(action));
      b.style.cssText = 'pointer-events:auto;margin-top:18px;padding:10px 18px;border-radius:999px;background:rgba(255,255,255,.16);font-weight:500;font-size:15px';
      b.addEventListener('click', fn);
      t.appendChild(b);
      api.chrome('none');
    },
    loading(p, t) { load.querySelector('.p').textContent = p || ''; load.querySelector('.t').textContent = t || ''; },
    showLegend, showPlace,
    hideLegend() { legend.classList.remove('on'); place.classList.remove('on'); },
  };
  return api;
}

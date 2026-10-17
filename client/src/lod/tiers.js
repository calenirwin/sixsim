// Quality tier presets (client/public/data/tiers.json): ?tier=low|medium|high|cinematic expands to the preset's URL flags
// before any other module reads location.search, so a preset is one flag instead of a list. main.js imports this module
// FIRST (ES modules evaluate in import order). The table is fetched synchronously: the modules after this one read their
// flags while they evaluate. A flag already in the URL wins over the preset; `gfx` lists merge key by key (the URL's
// keys win). The applied preset is window.__TIER (the LOD manager takes its screen error and budgets from it).
const URL_TIERS = 'data/tiers.json';
(function applyTier() {
  if (typeof location === 'undefined' || typeof XMLHttpRequest === 'undefined') return;
  const q = new URLSearchParams(location.search);
  const name = (q.get('tier') || '').toLowerCase();
  if (!name) return;
  try {
    const x = new XMLHttpRequest();
    x.open('GET', URL_TIERS, false);
    x.send(null);
    if (x.status !== 200) { console.warn('[tier] no table at', URL_TIERS); return; }
    const doc = JSON.parse(x.responseText);
    const t = doc.tiers && doc.tiers[name];
    if (!t) { console.warn('[tier] unknown tier', name, 'known:', Object.keys(doc.tiers || {}).join(', ')); return; }
    const applied = [];
    for (const [k, v] of Object.entries(t.flags || {})) {
      if (k === 'gfx' && q.has('gfx')) {
        const have = new Map(q.get('gfx').split(',').filter(Boolean).map((kv) => [kv.split(':')[0], kv]));
        for (const kv of String(v).split(',')) { const kk = kv.split(':')[0]; if (!have.has(kk)) { have.set(kk, kv); applied.push(`gfx.${kk}`); } }
        q.set('gfx', [...have.values()].join(','));
        continue;
      }
      if (q.has(k)) continue;
      q.set(k, String(v));
      applied.push(k);
    }
    history.replaceState(history.state, '', `${location.pathname}?${q.toString()}${location.hash}`);
    window.__TIER = { name, ...t, applied };
    console.log(`[tier] ${name}: ${applied.join(', ') || 'nothing new'} (${t.label || ''})`);
  } catch (e) { console.warn('[tier] preset not applied', e); }
})();

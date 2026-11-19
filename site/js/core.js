/* Núcleo de la app: registro de herramientas, navegación, guardado, precios y avisos.
   Para sumar una herramienta nueva: crear js/<nombre>.js que llame a App.register({...})
   y agregar su <section class="view" id="view-<id>"> y su <script> en index.html. */
const App = (() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const money = v => (v == null ? '—' : usd.format(v));
  const fdate = iso => { try { return new Date(iso).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return String(iso); } };
  const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  };

  // ---- eventos simples entre módulos ----
  const subs = {};
  const on = (ev, fn) => { (subs[ev] = subs[ev] || []).push(fn); };
  const emit = (ev, data) => (subs[ev] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } });

  // ---- ajustes ----
  const SKEY = 'bitacora-ajustes-v1';
  const settings = Object.assign({ priceType: 'mid', printing: 'barata', deckView: 'lista' }, store.get(SKEY, {}));
  // v2: el precio por defecto pasó a ser la mediana (Listed Median) de TCGplayer
  if (!(settings.v >= 2)) { settings.priceType = 'mid'; settings.v = 2; store.set(SKEY, settings); }
  function setSetting(k, v) { settings[k] = v; store.set(SKEY, settings); emit('settings', settings); }
  const PRICE_LABEL = { mid: 'Mediana', market: 'Market', low: 'Low' };
  const PRICE_ORDER = ['mid', 'market', 'low'];

  // ---- íconos (trazos simples) ----
  const svg = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONS = {
    inicio: svg('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'),
    mazos: svg('<rect x="6" y="3" width="12" height="17" rx="2"/><path d="M3 7v12a2 2 0 0 0 2 2h10"/><path d="M10 9h4M10 13h4"/>'),
    buscar: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'),
    cartas: svg('<rect x="3" y="4" width="8" height="11" rx="1.5"/><rect x="13" y="4" width="8" height="11" rx="1.5"/><path d="M3 19h18"/>'),
    grid: svg('<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>'),
    list: svg('<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>'),
    letal: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
    ajustes: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
    copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
    edit: svg('<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M14 6l4 4"/>'),
    trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    grupo: svg('<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.6"/><path d="M15.5 14.2A5 5 0 0 1 21 19"/>'),
    cuenta: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>'),
    dup: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/><path d="M14 11v6M11 14h6"/>'),
  };

  // ---- registro de herramientas ----
  // { id, title, short, desc, icon, nav (barra lateral), tab (pestaña en el celular), home (tarjeta en Inicio),
  //   navAs, init(el), show(param), hide(), status() }
  const tools = [];
  const register = t => { tools.push(t); };

  function renderNav() {
    const link = t => `<a href="#${t.id}" data-nav="${t.id}" aria-current="false">${t.icon || ''}<span>${esc(t.short || t.title)}</span></a>`;
    // barra lateral (PC): todas las herramientas; pestañas (celular): las marcadas con tab, como mucho 5
    $('#nav-side').innerHTML = tools.filter(t => t.nav).map(link).join('');
    $('#nav-tab').innerHTML = tools.filter(t => t.tab).slice(0, 5).map(link).join('');
  }

  // ---- navegación por #hash: #mazos, #mazo/<id>, #buscar ... ----
  let current = null;
  function parseHash() {
    const h = decodeURIComponent(location.hash.replace(/^#/, '')) || 'inicio';
    const i = h.indexOf('/');
    return i < 0 ? { id: h, param: null } : { id: h.slice(0, i), param: h.slice(i + 1) };
  }
  function go(id, param) { location.hash = param ? `${id}/${encodeURIComponent(param)}` : id; }
  const ALIAS = { buscar: 'cartas' }; // direcciones viejas que siguen funcionando
  function route() {
    const { id: raw, param } = parseHash();
    const id = ALIAS[raw] || raw;
    const t = tools.find(x => x.id === id) || tools.find(x => x.id === 'inicio');
    if (current && current !== t && current.hide) current.hide();
    $$('main > .view').forEach(v => { v.hidden = v.id !== `view-${t.id}`; });
    document.body.dataset.view = t.id;
    const navId = t.navAs || t.id;
    $$('[data-nav]').forEach(a => a.setAttribute('aria-current', a.dataset.nav === navId ? 'page' : 'false'));
    $('#bar-title').textContent = t.id === 'inicio' ? '' : t.title;
    document.title = t.id === 'inicio' ? 'Bitácora OPTCG' : `${t.title} · Bitácora OPTCG`;
    const el = $(`#view-${t.id}`);
    if (!t._ready && t.init) { t.init(el); t._ready = true; }
    const changed = current !== t;
    current = t;
    if (t.show) t.show(param);
    if (changed) window.scrollTo(0, 0);
  }
  const currentId = () => (current ? current.id : null);

  // ---- avisos ----
  let toastTimer = null;
  function toast(msg, label, fn) {
    const t = $('#toast'), b = $('#toast-btn');
    $('#toast-txt').textContent = msg;
    if (label) { b.hidden = false; b.textContent = label; b.onclick = () => { hideToast(); if (fn) fn(); }; } else b.hidden = true;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 6000);
  }
  function hideToast() { $('#toast').hidden = true; }

  async function copy(text, msg = 'Copiado') {
    try { await navigator.clipboard.writeText(text); toast(msg); return true; } catch (e) {
      const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      ta.remove(); toast(ok ? msg : 'No pude copiar: seleccioná el texto a mano'); return ok;
    }
  }
  function download(name, text, type = 'application/json') {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ---- precios (archivo data/prices.json que arma la tarea diaria de GitHub) ----
  const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9-]+/g, ' ').trim();
  // etiquetas del nombre de TCGplayer: "Shanks (004) (Alternate Art)" → ["Alternate Art"]; el número no cuenta
  const NUMLIKE = /^(\d+|[A-Z]{1,4}\d{0,2}-?\d{2,3}[A-Z]?)$/i;
  const tagsOf = n => [...String(n || '').matchAll(/\(([^)]*)\)|\[([^\]]*)\]/g)].map(m => (m[1] ?? m[2]).trim()).filter(t => t && !NUMLIKE.test(t));
  const TAG_ES = { 'Parallel': 'Paralela', 'Alternate Art': 'Arte alternativo', 'Super Rare Alternate Art': 'Arte alternativo SR', 'Reprint': 'Reimpresión', 'Full Art': 'Arte completo', 'Textured Foil': 'Foil texturado', 'Winner': 'Ganador', 'Finalist': 'Finalista', 'Participant': 'Participante' };
  const EVENT_ES = { RE: 'Release Event', PRE: 'Pre-Release', ANN: 'Aniversario' };
  const Prices = {
    state: 'idle', error: null, updated: null, source: {}, count: 0,
    byNum: new Map(), byPid: new Map(), all: [], groups: new Map(), _common: new Map(),
    async load(force) {
      this.state = 'loading'; emit('prices', this);
      try {
        const res = await fetch('data/prices.json', { cache: force ? 'reload' : 'no-cache' });
        if (res.status === 404) { this.state = this.count ? 'ok' : 'missing'; emit('prices', this); return; }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.index(await res.json());
        this.state = 'ok'; this.error = null;
      } catch (e) {
        this.error = String(e.message || e);
        this.state = this.count ? 'ok' : 'error';
      }
      emit('prices', this);
    },
    index(j) {
      this.groups = new Map((j.groups || []).map(g => [g[0], { id: g[0], name: g[1], abbr: g[2], date: g[3] || '' }]));
      this.byNum = new Map(); this.byPid = new Map(); this.all = []; this._common = new Map();
      for (const r of j.cards || []) {
        const e = { num: String(r[0]).toUpperCase(), name: r[1], rarity: r[2], group: this.groups.get(r[3]) || { id: r[3], name: '', abbr: '', date: '' }, pid: r[4], sub: r[5], market: r[6], low: r[7], mid: r[8] };
        e.key = `${e.pid}|${e.sub}`;
        e.tags = tagsOf(e.name);
        e.q = norm(`${e.name} ${e.num} ${e.group.abbr}`);
        if (!this.byNum.has(e.num)) this.byNum.set(e.num, []);
        this.byNum.get(e.num).push(e);
        if (!this.byPid.has(e.pid)) this.byPid.set(e.pid, []);
        this.byPid.get(e.pid).push(e);
        this.all.push(e);
      }
      this.count = this.all.length; this.updated = j.updated; this.source = j.source || {};
    },
    // precio según el ajuste elegido; si falta, usa el siguiente disponible
    value(e) {
      const t = settings.priceType;
      const order = [t, ...PRICE_ORDER.filter(k => k !== t)];
      for (const k of order) if (e[k] != null) return { v: e[k], from: k, approx: k !== order[0] };
      return { v: null, from: null, approx: false };
    },
    options(num) { return this.byNum.get(String(num).toUpperCase()) || []; },
    // de las filas de un mismo producto (Normal/Foil), la que tiene precio y es más barata
    best(list) {
      if (!list || !list.length) return null;
      const priced = list.filter(e => this.value(e).v != null);
      return priced.length ? priced.reduce((a, b) => (this.value(b).v < this.value(a).v ? b : a)) : list[0];
    },
    // la versión común es la que eligió la tarea diaria (cards.json); si todavía no cargó, la que no tiene etiquetas
    isBase(e) { const c = Cards.get(e.num); return c && c.pid ? c.pid === e.pid : !e.tags.length; },
    // etiquetas que están en todas las versiones de un número: son parte del nombre ("Mr.1 (Daz.Bonez)")
    commonTags(num) {
      num = String(num).toUpperCase();
      if (!this._common.has(num)) {
        const o = this.options(num);
        const s = o.length > 1 ? new Set(o[0].tags.filter(t => o.every(e => e.tags.includes(t)))) : new Set();
        this._common.set(num, s);
      }
      return this._common.get(num);
    },
    // qué tiene de distinto esta versión: "Paralela", "Arte alternativo · Manga", "Reimpresión"... ('' = la común)
    variant(e) {
      const c = Cards.get(e.num);
      if (c && c.pid === e.pid) return '';
      const common = this.commonTags(e.num);
      const own = e.tags.filter(t => !common.has(t)).map(t => TAG_ES[t] || t);
      if (own.length) return own.join(' · ');
      if (!c) return '';
      const suf = String(e.group.abbr || '').toUpperCase().trim().split(/\s+/)[1];
      return EVENT_ES[suf] || 'Reimpresión';
    },
    choose(opts, pick) {
      if (!opts.length) return null;
      if (pick) { const p = opts.find(o => o.key === pick); if (p) return p; }
      const priced = opts.filter(o => this.value(o).v != null);
      const pool = priced.length ? priced : opts;
      const val = o => { const v = this.value(o).v; return v == null ? Infinity : v; };
      if (settings.printing === 'base') {
        const score = o => (this.isBase(o) ? 0 : 2) + (o.group.abbr && o.num.startsWith(o.group.abbr) ? 0 : 1);
        return pool.slice().sort((a, b) => score(a) - score(b) || val(a) - val(b))[0];
      }
      return pool.slice().sort((a, b) => val(a) - val(b))[0];
    },
    cardName(num) {
      const o = this.options(num);
      if (!o.length) return null;
      const c = Cards.get(num); if (c && c.name) return c.name;
      const best = o.slice().sort((a, b) => (a.name.match(/\(/g) || []).length - (b.name.match(/\(/g) || []).length || a.name.length - b.name.length)[0];
      return best.name.replace(/\s*\([^)]*\)/g, '').trim() || best.name;
    },
    isLeader(num) { const c = Cards.get(num); if (c && c.type) return c.type === 'Leader'; return this.options(num).some(e => e.rarity === 'L'); },
    // la versión más barata con precio, para mostrar "desde $x"
    cheapest(num) { const o = this.options(num).filter(e => this.value(e).v != null); return o.length ? o.reduce((a, b) => (this.value(b).v < this.value(a).v ? b : a)) : null; },
    search(q, limit = 30) {
      const words = norm(q).split(' ').filter(Boolean);
      if (!words.length) return [];
      const out = new Map();
      for (const e of this.all) {
        if (!words.every(w => e.q.includes(w))) continue;
        if (!out.has(e.num)) { if (out.size >= limit) continue; out.set(e.num, []); }
        out.get(e.num).push(e);
      }
      return [...out.entries()].map(([num, list]) => ({ num, list }));
    },
    url(e) { return `https://www.tcgplayer.com/product/${e.pid}`; },
    img(e, size = 200) { return imgUrl(e.pid, size); },
    statusText() {
      if (this.state === 'ok') return `Precios de TCGplayer (${PRICE_LABEL[settings.priceType].toLowerCase()}) del ${fdate(this.updated)}`;
      if (this.state === 'loading') return 'Cargando precios…';
      if (this.state === 'missing') return 'Todavía no hay precios: corré la tarea “Publicar app y precios” en GitHub.';
      if (this.state === 'error') return 'No pude cargar los precios. Revisá tu conexión.';
      return '';
    },
  };

  // imagen de la carta en el CDN de TCGplayer (200 o 400 de ancho)
  const imgUrl = (pid, size = 200) => (pid ? `https://tcgplayer-cdn.tcgplayer.com/product/${pid}_${size}w.jpg` : '');

  // ---- fichas de cartas (data/cards.json): tipo, color, costo, texto e imagen. Se carga cuando hace falta ----
  const COLOR_ES = { Red: 'Rojo', Green: 'Verde', Blue: 'Azul', Purple: 'Morado', Black: 'Negro', Yellow: 'Amarillo' };
  const TYPE_ES = { Leader: 'Líder', Character: 'Personaje', Event: 'Evento', Stage: 'Escenario', 'DON!!': 'DON!!' };
  const Cards = {
    state: 'idle', error: null, map: new Map(), list: [], updated: null, _p: null,
    load(force) {
      if (this._p && !force) return this._p;
      this.state = 'loading';
      // la promesa se guarda antes de avisar: quien escuche 'cards' y vuelva a llamar a load() recibe la misma
      this._p = fetch('data/cards.json', { cache: force ? 'reload' : 'no-cache' })
        .then(r => { if (r.status === 404) return null; if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then(j => { if (j) { this.index(j); this.state = 'ok'; } else this.state = this.list.length ? 'ok' : 'missing'; })
        .catch(e => { this.error = String(e.message || e); this.state = this.list.length ? 'ok' : 'error'; this._p = null; })
        .then(() => { emit('cards', this); return this; });
      emit('cards', this);
      return this._p;
    },
    index(j) {
      this.map = new Map(); this.list = []; this.updated = j.updated;
      for (const [num, r] of Object.entries(j.cards || {})) {
        const c = { num, name: r[0], type: r[1], colors: r[2] ? r[2].split(';') : [], cost: r[3], power: r[4], counter: r[5], life: r[6], attribute: r[7] || '', subtypes: r[8] ? r[8].split(';') : [], text: r[9] || '', pid: r[10], set: num.split('-')[0] };
        c.qn = norm(`${c.name} ${c.num} ${c.subtypes.join(' ')}`);
        c.qt = norm(c.text);
        this.map.set(num, c); this.list.push(c);
      }
    },
    get(num) { return this.map.get(String(num).toUpperCase()) || null; },
    colorEs: c => COLOR_ES[c] || c,
    typeEs: t => TYPE_ES[t] || t,
    COLORS: Object.keys(COLOR_ES),
    TYPES: ['Leader', 'Character', 'Event', 'Stage'],
    norm,
  };

  function start() {
    renderNav();
    window.addEventListener('hashchange', route);
    route();
    Prices.load();
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
      // si llega una versión nueva de la app mientras está abierta, ofrecemos recargar
      const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (hadController) toast('Hay una versión nueva de la app', 'Actualizar', () => location.reload());
      });
      window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').then(r => r.update()).catch(() => {}));
    }
  }

  return { $, $$, esc, money, fdate, plural, store, on, emit, settings, setSetting, PRICE_LABEL, PRICE_ORDER, ICONS, register, tools, go, route, currentId, toast, copy, download, Prices, Cards, imgUrl, start };
})();

/* ---------- Inicio ---------- */
App.register({
  id: 'inicio', title: 'Inicio', short: 'Inicio', nav: true, tab: true, icon: App.ICONS.inicio,
  init(el) {
    this.el = el;
    App.on('prices', () => { if (App.currentId() === 'inicio') this.show(); });
    App.on('decks', () => { if (App.currentId() === 'inicio') this.show(); });
  },
  show() {
    const { esc, tools, Prices } = App;
    const cards = tools.filter(t => t.home).map(t => `
      <a class="tool" href="#${t.id}">
        <span class="ic">${t.icon || ''}</span>
        <b>${esc(t.title)}</b>
        <span>${esc(t.desc || '')}</span>
        ${t.status ? `<em>${esc(t.status() || '')}</em>` : ''}
      </a>`).join('');
    const tone = Prices.state === 'ok' ? '' : Prices.state === 'loading' ? '' : 'tone-warn';
    this.el.innerHTML = `
      <div class="hero">
        <h1>¿Cuánto vale <span>tu mazo?</span></h1>
        <p>Guardá tus listas, mirá su precio en TCGplayer carta por carta y usá las herramientas para jugar mejor, en el celular o en la PC.</p>
      </div>
      <hr class="rule">
      ${tone ? `<div class="banner ${tone}"><b>Precios</b><span>${esc(Prices.statusText())}</span></div>` : `<p class="note">${esc(Prices.statusText())}</p>`}
      <div class="tools">${cards}</div>`;
  },
});

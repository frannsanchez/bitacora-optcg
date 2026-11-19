/* Mazos: cargar listas, guardarlas en el dispositivo y calcular su precio con los datos de TCGplayer. */
const Decks = (() => {
  const { store, emit, Prices } = App;
  const KEY = 'bitacora-mazos-v1';
  const TKEY = 'bitacora-borrados-v1'; // mazos borrados que todavía hay que borrar de la nube
  const uid = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const NUM = /([A-Z]{1,4}\d{2}-\d{3}[A-Z]?|P-\d{3})/i;

  // Lee listas del simulador (4xOP12-034), "4 OP12-034 Perona", "OP12-034 x4" o "Perona OP12-034 4".
  function parse(text) {
    const map = new Map(); const bad = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      let s = raw.trim();
      if (!s || /^(#|\/\/)/.test(s)) continue;
      let qty = null;
      let m = s.match(/^(\d{1,2})\s*[x×]?\s*(.+)$/i);
      if (m && NUM.test(m[2])) { qty = +m[1]; s = m[2]; }
      else if ((m = s.match(/^(.+?)\s*(?:[x×]\s*(\d{1,2})|\s(\d{1,2}))\s*$/i)) && NUM.test(m[1])) { qty = +(m[2] || m[3]); s = m[1]; }
      const n = s.match(NUM);
      if (!n) { bad.push(raw.trim()); continue; }
      const num = n[1].toUpperCase();
      map.set(num, (map.get(num) || 0) + (qty || 1));
    }
    return { cards: [...map.entries()].map(([num, qty]) => ({ num, qty })), bad };
  }
  const toText = d => d.cards.map(c => `${c.qty}x${c.num}`).join('\n');

  const SEED = [
    { name: 'Zoro Verde post-ban (lista sugerida)', list: '1xOP12-020\n4xOP12-034\n2xOP12-028\n4xOP14-023\n4xST32-001\n3xST32-005\n4xOP14-024\n3xOP13-037\n4xOP12-031\n3xST32-002\n2xOP14-033\n3xST32-003\n3xOP13-031\n2xOP17-022\n4xOP12-039\n3xOP13-040\n2xOP01-055' },
    { name: 'Luffy Morado/Negro (lista sugerida)', list: '1xOP09-061\n4xOP09-069\n4xPRB02-012\n4xST26-003\n4xOP09-076\n4xOP08-074\n2xST18-001\n4xOP09-072\n4xST18-002\n4xST26-005\n3xEB02-061\n2xOP17-093\n2xOP09-119\n1xOP05-119\n4xOP09-078\n2xOP09-077\n2xOP05-076' },
  ];
  // owner: usuario dueño en la nube · synced: ya se subió alguna vez · dirty: tiene cambios sin subir · ejemplo: lista de muestra
  function make(name, cards, extra) {
    const now = new Date().toISOString();
    return { id: uid(), name: name || 'Mazo sin nombre', cards: cards.map(c => ({ num: c.num, qty: c.qty, pick: c.pick || null })), created: now, updated: now, owner: null, synced: false, dirty: true, ...(extra || {}) };
  }
  let list = store.get(KEY, null);
  if (!Array.isArray(list)) { list = SEED.map(s => make(s.name, parse(s.list).cards, { ejemplo: true, dirty: false })); store.set(KEY, list); }
  let tomb = store.get(TKEY, []);

  // fromCloud: el cambio vino de la sincronización, no hace falta volver a subirlo
  const save = fromCloud => { store.set(KEY, list); emit('decks', list); if (!fromCloud) emit('decks-local', list); };
  const get = id => list.find(d => d.id === id) || null;
  function add(deck) { deck.dirty = true; list.unshift(deck); save(); return deck; }
  function update(deck) { deck.updated = new Date().toISOString(); deck.dirty = true; deck.ejemplo = false; save(); }
  function remove(id) {
    const i = list.findIndex(d => d.id === id); if (i < 0) return null;
    const [d] = list.splice(i, 1);
    if (d.synced) { tomb.push(d.id); store.set(TKEY, tomb); }
    save(); return { d, i };
  }
  function restore(r) { list.splice(r.i, 0, r.d); tomb = tomb.filter(x => x !== r.d.id); store.set(TKEY, tomb); r.d.dirty = true; save(); }
  function replaceAll(arr) { list = arr.map(d => ({ ...d, dirty: true })); save(); }
  const tombs = () => tomb.slice();
  function untomb(id) { tomb = tomb.filter(x => x !== id); store.set(TKEY, tomb); }
  function setAll(arr) { list = arr; save(true); }

  function leader(deck) {
    if (Prices.count) { const c = deck.cards.find(x => Prices.isLeader(x.num)); if (c) return c; }
    return deck.cards[0] && deck.cards[0].qty === 1 ? deck.cards[0] : null;
  }
  function counts(deck) {
    const total = deck.cards.reduce((s, c) => s + c.qty, 0);
    const L = leader(deck);
    return { total, main: L ? total - L.qty : total, leader: L };
  }
  function price(deck) {
    let total = 0, missing = 0, approx = 0;
    const rows = deck.cards.map(c => {
      const opts = Prices.options(c.num);
      const chosen = Prices.choose(opts, c.pick);
      const pv = chosen ? Prices.value(chosen) : { v: null };
      if (pv.v == null) missing += c.qty; else { total += pv.v * c.qty; if (pv.approx) approx += c.qty; }
      return { c, opts, chosen, unit: pv.v, approx: !!pv.approx, sub: pv.v == null ? null : Math.round(pv.v * c.qty * 100) / 100 };
    });
    return { total: Math.round(total * 100) / 100, missing, approx, rows };
  }

  return { parse, toText, make, all: () => list, get, add, update, remove, restore, replaceAll, tombs, untomb, setAll, leader, counts, price, KEY };
})();

/* ---------- lista de mazos ---------- */
App.register({
  id: 'mazos', title: 'Mazos', short: 'Mazos', nav: true, tab: true, home: true, icon: App.ICONS.mazos,
  desc: 'Cargá tus listas y mirá cuánto cuesta cada mazo completo o cada carta.',
  status() { const n = Decks.all().length; return n ? App.plural(n, 'mazo guardado', 'mazos guardados') : 'Sin mazos todavía'; },
  init(el) {
    this.el = el;
    const again = () => { if (App.currentId() === 'mazos') this.show(); };
    App.on('prices', again); App.on('settings', again); App.on('decks', again); App.on('cards', again); App.on('group', again);
  },
  show() {
    const { esc, money, Prices, plural, ICONS } = App;
    App.Cards.load(); // nombres e imágenes de los líderes
    if (typeof Cloud !== 'undefined' && Cloud.state.status === 'in') Cloud.loadGroups(); // nombres de los grupos donde compartiste
    const decks = Decks.all();
    const ready = Prices.state === 'ok';
    const items = decks.map(d => {
      const k = Decks.counts(d);
      const p = ready ? Decks.price(d) : null;
      const lname = k.leader ? (Prices.cardName(k.leader.num) || k.leader.num) : '';
      const lab = typeof Cloud !== 'undefined' ? Cloud.shareLabel(d) : '';
      const chips = [
        `<span class="achip${k.main === 50 ? '' : ' warn'}">${k.main === 50 ? '50 cartas' : `${k.main} de 50`}</span>`,
        lab && lab !== 'Privado' ? `<span class="achip on">${esc(lab)}</span>` : '',
        d.ejemplo ? '<span class="achip">Ejemplo</span>' : '',
      ].join('');
      return `<a class="deck withimg" href="#mazo/${encodeURIComponent(d.id)}">
        <span class="dimg">${CardUI.leaderImg(d)}</span>
        <span class="dinfo">
          <b>${esc(d.name)}</b>
          ${lname ? `<small>${esc(lname)}</small>` : '<small>Sin líder</small>'}
          <span class="chips-row">${chips}</span>
        </span>
        ${p ? `<span class="price" title="${p.missing ? esc(`${plural(p.missing, 'carta', 'cartas')} sin precio no suman`) : ''}">${money(p.total)}</span>`
            : `<span class="price none">${Prices.state === 'loading' ? 'Calculando…' : 'Sin precio'}</span>`}
      </a>`;
    }).join('');
    this.el.innerHTML = `
      <div class="vhead">
        <div><h1>Mazos</h1><p>${esc(Prices.statusText())}</p></div>
        <a class="btn primary only-desk" href="#mazo/nuevo">${ICONS.plus}Nuevo mazo</a>
      </div>
      ${typeof Cloud !== 'undefined' ? Cloud.listNote() : ''}
      ${!ready && Prices.state !== 'loading' ? `<div class="banner tone-warn"><span>${esc(Prices.statusText())} Igual podés cargar y guardar tus listas.</span></div>` : ''}
      ${decks.length ? `<div class="decks">${items}</div>` : `<div class="card"><p class="note">Todavía no guardaste ningún mazo. Tocá “Nuevo mazo” para elegir las cartas con imágenes o pegar la lista del simulador.</p></div>`}
      <a class="fab" href="#mazo/nuevo">${ICONS.plus}Nuevo mazo</a>`;
  },
});

/* ---------- un mazo: precio, cartas y edición ---------- */
App.register({
  id: 'mazo', title: 'Mazo', navAs: 'mazos', icon: App.ICONS.mazos,
  init(el) {
    this.el = el; this.sort = 'lista'; this.open = new Set(); this.tab = 'cartas';
    const again = () => {
      if (App.currentId() !== 'mazo') return;
      if (this.editing) { this.check(); this.preview(); return; } // no rehacemos el formulario para no perder lo que escribiste
      if (this.deck) this.render();
    };
    App.on('prices', again); App.on('settings', again); App.on('cards', again); App.on('group', again);
    // si la sincronización trae una versión nueva del mazo abierto, la mostramos
    App.on('decks', () => {
      if (App.currentId() !== 'mazo' || this.editing || this.ro || !this.deck) return;
      const d = Decks.get(this.deck.id); if (d) { this.deck = d; this.render(); }
    });

    el.addEventListener('click', e => {
      const t = e.target;
      const deck = this.deck;
      if (t.closest('[data-act="edit"]')) { this.editing = true; this.draft = null; this.render(); return; }
      if (t.closest('[data-act="cancel"]')) {
        if (this.isNew) { App.go('mazos'); return; }
        this.editing = false; this.render(); return;
      }
      if (t.closest('[data-act="save"]')) { this.saveEdit(); return; }
      if (t.closest('[data-act="visual"]')) { this.goVisual(); return; }
      const wb = t.closest('[data-way]');
      if (wb) { this.keepDraft(); this.way = wb.dataset.way; this.renderEditor(); return; }
      if (t.closest('[data-act="copy"]') && deck) { App.copy(Decks.toText(deck), 'Lista copiada'); return; }
      if (t.closest('[data-act="mine"]') && deck) {
        const c = Decks.add(Decks.make(`${deck.name} (de ${deck.ownerName || 'otro jugador'})`, deck.cards));
        App.toast('Lo copiaste a tus mazos'); App.go('mazo', c.id); return;
      }
      if (t.closest('[data-act="dup"]') && deck) {
        const c = Decks.make(`${deck.name} (copia)`, deck.cards);
        Decks.add(c); App.toast('Duplicaste el mazo'); App.go('mazo', c.id); return;
      }
      if (t.closest('[data-act="del"]') && deck) {
        const r = Decks.remove(deck.id);
        App.go('mazos');
        App.toast(`Borraste “${deck.name}”`, 'Deshacer', () => { Decks.restore(r); App.go('mazo', deck.id); });
        return;
      }
      const tb = t.closest('[data-tab]');
      if (tb) { this.tab = tb.dataset.tab; this.render(); return; }
      const sb = t.closest('[data-sort]');
      if (sb) { this.sort = sb.dataset.sort; this.render(); return; }
      const vb = t.closest('[data-dview]');
      if (vb) { App.setSetting('deckView', vb.dataset.dview); return; }
      const line = t.closest('.cl-main');
      if (line) {
        const num = line.dataset.num;
        if (this.open.has(num)) this.open.delete(num); else this.open.add(num);
        this.render(); return;
      }
    });
    // pestañas: flechas para moverse entre ellas
    el.addEventListener('keydown', e => {
      const tb = e.target.closest('[role="tab"]');
      if (!tb || !/^(ArrowLeft|ArrowRight)$/.test(e.key)) return;
      const all = [...el.querySelectorAll('[role="tab"]')];
      const n = all[(all.indexOf(tb) + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
      this.tab = n.dataset.tab; this.render();
      const f = el.querySelector(`[role="tab"][data-tab="${this.tab}"]`); if (f) f.focus();
    });
    el.addEventListener('change', e => {
      const t = e.target;
      if (t.matches('input[type="radio"][data-pick]') && this.deck && !this.ro) {
        const c = this.deck.cards.find(x => x.num === t.dataset.pick);
        if (c) { c.pick = t.value || null; Decks.update(this.deck); this.render(); }
      }
    });
    let ptimer = null;
    el.addEventListener('input', e => {
      if (e.target.id !== 'ed-list') return;
      this.check();
      clearTimeout(ptimer); ptimer = setTimeout(() => this.preview(), 250);
    });
  },
  show(param) {
    this.ro = false;
    App.Cards.load(); // nombres, líder e imágenes
    if (param !== this.param) { this.tab = 'cartas'; this.param = param; }
    if (param && param.startsWith('nube:')) return this.showShared(param.slice(5));
    this.isNew = param === 'nuevo';
    this.deck = this.isNew ? null : Decks.get(param);
    this.editing = this.isNew;
    this.way = 'visual'; this.draft = null; this.focusName = this.isNew;
    this.open = new Set();
    if (!this.isNew && !this.deck) {
      this.el.innerHTML = `<a class="back" href="#mazos">${App.ICONS.back}Mazos</a><div class="card"><p class="note">No encontré ese mazo. Puede que lo hayas borrado.</p></div>`;
      return;
    }
    this.render();
    // en qué grupos está compartido y las valoraciones que recibió
    if (this.deck && typeof Cloud !== 'undefined' && Cloud.state.status === 'in') Cloud.loadGroups();
  },
  // mazo que alguien compartió en un grupo (#mazo/nube:<grupo>:<mazo>): se ve con precios pero no se edita
  showShared(ref) {
    this.ro = true; this.isNew = false; this.editing = false; this.open = new Set();
    const [gid, id] = String(ref).split(':');
    this.gid = gid;
    const cloud = typeof Cloud !== 'undefined' ? Cloud : null;
    const find = () => (cloud ? cloud.groupDeck(gid, id) : null);
    this.deck = find();
    if (this.deck) { this.render(); return; }
    const back = `<a class="back" href="#grupo/${encodeURIComponent(gid)}">${App.ICONS.back}Grupo</a>`;
    const msg = t => { this.el.innerHTML = `${back}<div class="card"><p class="note">${t}</p></div>`; };
    msg('Cargando el mazo…');
    if (!cloud || cloud.state.status !== 'in') return msg('Entrá con tu usuario para ver los mazos de tus grupos.');
    cloud.loadGroups().then(() => {
      if (App.currentId() !== 'mazo' || !this.ro) return;
      this.deck = find();
      if (this.deck) this.render(); else msg('No encontré ese mazo. Puede que lo hayan dejado de compartir, o que no estés en ese grupo.');
    });
  },
  render() {
    if (this.editing) return this.renderEditor();
    const { esc, money, Prices, plural, fdate, ICONS } = App;
    const d = this.deck, ro = this.ro;
    const k = Decks.counts(d);
    const ready = Prices.state === 'ok';
    const p = Decks.price(d);
    const lname = k.leader ? (Prices.cardName(k.leader.num) || k.leader.num) : '';
    const cloud = typeof Cloud !== 'undefined' ? Cloud : null;

    // ---- encabezado: líder, nombre y lo justo para ubicarse ----
    const lab = !ro && cloud ? cloud.shareLabel(d) : '';
    const chips = [
      `<span class="achip${k.main === 50 ? '' : ' warn'}" title="Sin contar el líder">${k.main === 50 ? '50 cartas' : `${k.main} de 50 cartas`}</span>`,
      lab ? `<span class="achip${lab === 'Privado' ? '' : ' on'}">${esc(lab)}</span>` : '',
    ].join('');
    const menu = ro ? '' : `
      <details class="menu">
        <summary class="icon-btn" aria-label="Más opciones" title="Más opciones">${ICONS.more}</summary>
        <div class="menu-list">
          <button type="button" data-act="copy">${ICONS.copy}Copiar lista</button>
          <button type="button" data-act="dup">${ICONS.dup}Duplicar</button>
          <button type="button" class="danger" data-act="del">${ICONS.trash}Borrar</button>
        </div>
      </details>`;
    const src = ready
      ? `${App.PRICE_LABEL[App.settings.priceType]} de TCGplayer al ${fdate(Prices.updated)}${p.missing ? `. No incluye ${plural(p.missing, 'carta', 'cartas')} sin precio.` : ''}`
      : Prices.statusText();
    const actions = ro
      ? `<button type="button" class="btn primary" data-act="mine">${ICONS.dup}Copiar a mis mazos</button>
         <button type="button" class="btn" data-act="copy">${ICONS.copy}Copiar lista</button>`
      : `<a class="btn primary" href="#cartas/mazo:${encodeURIComponent(d.id)}">${ICONS.plus}Agregar cartas</a>
         <button type="button" class="btn" data-act="edit">${ICONS.edit}Editar lista</button>`;
    const back = ro
      ? `<a class="back" href="#grupo/${encodeURIComponent(this.gid || '')}">${ICONS.back}${esc((cloud && cloud.group(this.gid) || {}).name || 'Grupo')}</a>`
      : `<a class="back" href="#mazos">${ICONS.back}Mazos</a>`;

    // ---- pestañas ----
    const social = typeof Stars !== 'undefined' ? (ro ? Stars.groupBlock(this.gid, d) : Stars.ownBlock(d)) : '';
    const score = ro && cloud && cloud.state.status === 'in' ? cloud.deckScore(this.gid, d.id) : null;
    const tabs = [['cartas', 'Cartas', ''], ['precio', 'Precio', '']];
    if (social) tabs.push(ro ? ['social', 'Valoraciones', score && score.n ? String(score.n) : ''] : ['social', 'Compartir', '']);
    if (!tabs.some(t => t[0] === this.tab)) this.tab = 'cartas';
    const panel = this.tab === 'precio' ? this.pricePanel(p, ready) : this.tab === 'social' ? social : this.cardsPanel(p, k, ready);

    this.el.innerHTML = `
      ${back}
      <div class="deck-cols">
        <div class="dtop">
          <div class="dhead">
            <span class="dimg lg">${CardUI.leaderImg(d)}</span>
            <div class="dh-text">
              <h1 class="deck-title">${esc(d.name)}</h1>
              ${ro ? `<p class="dsub">De <b>${esc(d.ownerName || 'otro jugador')}</b></p>` : ''}
              ${lname ? `<p class="dsub">${esc(lname)}</p>` : ''}
              <div class="chips-row">${chips}</div>
            </div>
            ${menu}
          </div>
          <div class="dprice">
            <span class="big">${ready ? money(p.total) : '—'}</span>
            <span class="src">${esc(src)}</span>
          </div>
          <div class="dact">${actions}</div>
        </div>
        <div class="dmain">
          <div class="tabs" role="tablist" aria-label="Partes del mazo">${tabs.map(([id, name, n]) => `<button type="button" role="tab" id="tab-${id}" data-tab="${id}" aria-selected="${this.tab === id}" aria-controls="deck-panel" tabindex="${this.tab === id ? 0 : -1}">${name}${n ? `<span class="count">${n}</span>` : ''}</button>`).join('')}</div>
          <div class="tabpanel" id="deck-panel" role="tabpanel" aria-labelledby="tab-${this.tab}">${panel}</div>
        </div>
      </div>`;
  },
  // pestaña Cartas: la lista, con la versión y el precio de cada una
  cardsPanel(p, k, ready) {
    const { esc, money, Prices, ICONS } = App;
    const d = this.deck, ro = this.ro;
    let rows = p.rows.slice();
    if (this.sort === 'caras') rows.sort((a, b) => (b.sub ?? -1) - (a.sub ?? -1));
    const grid = App.settings.deckView === 'imagenes';
    const pidOf = r => (r.chosen && r.chosen.pid) || CardUI.basePid(r.c.num);
    const lines = rows.map(r => {
      const c = r.c, ch = r.chosen;
      const name = ch ? (Prices.cardName(c.num) || ch.name) : (ready ? 'No está en los datos de TCGplayer' : c.num);
      const variant = ch ? Prices.variant(ch) : '';
      const isL = k.leader && k.leader.num === c.num;
      if (grid) {
        const pid = pidOf(r);
        const href = `#carta/${encodeURIComponent(`${c.num}${pid ? '~' + pid : ''}${ro ? '' : '@' + d.id}`)}`;
        return `<a class="ctile deckt" href="${href}">
          <span class="cimg">${CardUI.img(pid, name)}<span class="qbadge">×${c.qty}</span>${isL ? '<span class="lbadge">Líder</span>' : ''}</span>
          <span class="cmeta"><b>${esc(name)}</b><small>${esc(variant || c.num)}</small><span class="cprice${r.unit == null ? ' miss' : ''}">${r.unit == null ? 'Sin precio' : money(r.sub)}</span></span>
        </a>`;
      }
      const open = this.open.has(c.num);
      return `<li class="cline">
        <button type="button" class="cl-main" data-num="${esc(c.num)}" aria-expanded="${open}">
          <span class="q">${c.qty}×</span>
          ${CardUI.img(pidOf(r), '', 200, 'thumb')}
          <span class="nm"><b>${esc(name)}${isL ? '<span class="badge">Líder</span>' : ''}</b><small>${esc(c.num)}${variant ? `<span class="vt">${esc(variant)}</span>` : ''}${c.pick ? '<span class="vt">Elegida</span>' : ''}</small></span>
          <span class="pr${r.unit == null ? ' miss' : ''}"><b>${r.unit == null ? 'Sin precio' : money(r.sub)}</b>${r.unit != null && c.qty > 1 ? `<small>${money(r.unit)} c/u</small>` : ''}${r.approx ? '<small>Aproximado</small>' : ''}</span>
        </button>
        ${open ? this.optionsHTML(r) : ''}
      </li>`;
    }).join('');
    const over = d.cards.filter(c => c.qty > 4 && !(k.leader && c.num === k.leader.num));
    const hint = grid ? (ro ? 'Tocá una carta para ver su ficha.' : 'Tocá una carta para cambiar las copias o la versión.')
      : 'Tocá una carta para ver sus versiones y elegir la tuya.';
    return `
      <div class="ptools">
        <div class="seg" role="radiogroup" aria-label="Cómo ver las cartas">
          <button type="button" role="radio" data-dview="lista" aria-checked="${!grid}">${ICONS.list}Lista</button>
          <button type="button" role="radio" data-dview="imagenes" aria-checked="${grid}">${ICONS.grid}Imágenes</button>
        </div>
        <button type="button" class="chip" data-sort="${this.sort === 'caras' ? 'lista' : 'caras'}" aria-pressed="${this.sort === 'caras'}">Más caras primero</button>
      </div>
      ${over.length ? `<div class="banner tone-warn"><span>Más de 4 copias: ${esc(over.map(c => c.num).join(', '))}.</span></div>` : ''}
      <p class="note">${hint}</p>
      ${grid ? `<div class="cgrid">${lines}</div>` : `<ul class="clist">${lines}</ul>`}`;
  },
  // pestaña Precio: qué cartas pesan más y de dónde sale el número
  pricePanel(p, ready) {
    const { esc, money, Prices, plural, fdate } = App;
    if (!ready) return `<div class="card"><p class="note">${esc(Prices.statusText())}</p></div>`;
    const top = p.rows.filter(r => r.sub).sort((a, b) => b.sub - a.sub).slice(0, 5);
    const topSum = top.reduce((s, r) => s + r.sub, 0);
    const weight = p.total > 0 && top.length ? `
      <div class="card"><h2>Lo que más pesa</h2>
        <div class="bar-share">${top.map(r => `<div class="wrow"><span>${r.c.qty}× ${esc(Prices.cardName(r.c.num) || r.c.num)}</span><b>${money(r.sub)}</b><span class="track"><i style="width:${Math.max(2, Math.round(100 * r.sub / p.total))}%"></i></span></div>`).join('')}</div>
        <p class="note">${top.length === 1 ? 'Esta carta es' : `Estas ${top.length} cartas son`} el ${Math.round(100 * topSum / p.total)}% del precio del mazo.</p>
      </div>` : '';
    const which = App.settings.printing === 'base' ? 'la versión común' : 'la versión más barata';
    return `${weight}
      <div class="card"><h2>De dónde sale</h2>
        <p class="note">Es la ${esc(App.PRICE_LABEL[App.settings.priceType].toLowerCase())} de lo publicado en TCGplayer, en dólares y sin envío, con precios del ${esc(fdate(Prices.updated))}. De cada carta se toma ${which}, salvo que elijas otra en la lista. <a href="#ajustes">Cambiar en Ajustes</a></p>
        ${p.missing ? `<div class="banner tone-warn"><span>${plural(p.missing, 'carta no tiene', 'cartas no tienen')} precio en TCGplayer y no suman al total.</span></div>` : ''}
        ${p.approx ? `<p class="note">${plural(p.approx, 'carta usa', 'cartas usan')} otro precio porque falta la ${esc(App.PRICE_LABEL[App.settings.priceType].toLowerCase())}.</p>` : ''}
      </div>`;
  },
  optionsHTML(r) {
    const { esc, money, Prices } = App;
    const c = r.c;
    if (!r.opts.length) return `<div class="opts"><p class="note">${Prices.state === 'ok' ? 'TCGplayer no tiene esta carta. Revisá que el número esté bien escrito.' : 'Cuando haya precios vas a ver las versiones acá.'}</p></div>`;
    const sorted = r.opts.slice().sort((a, b) => (Prices.value(a).v ?? Infinity) - (Prices.value(b).v ?? Infinity));
    const auto = Prices.choose(r.opts, null);
    const name = `pick-${c.num}`;
    const row = (val, title, sub, priceTxt, link, checked) => `
      <label class="opt"><input type="radio" name="${esc(name)}" data-pick="${esc(c.num)}" value="${esc(val)}"${checked ? ' checked' : ''}${this.ro ? ' disabled' : ''}>
        <span class="on"><span>${title}</span><small>${sub}</small></span>
        <span class="op"><span>${priceTxt}</span>${link || ''}</span></label>`;
    let h = row('', 'Automática', `${App.settings.printing === 'base' ? 'Versión común' : 'La más barata'}: ${esc(auto ? auto.name : '')}`, auto ? money(Prices.value(auto).v) : '—', '', !c.pick);
    h += sorted.map(o => {
      const v = Prices.value(o);
      return row(o.key, esc(o.name), `${esc(o.group.name || o.group.abbr)}${o.rarity ? ', ' + esc(o.rarity) : ''}${o.sub && o.sub !== 'Normal' ? ', ' + esc(o.sub) : ''}`,
        v.v == null ? 'Sin precio' : money(v.v), `<a href="${Prices.url(o)}" target="_blank" rel="noopener">Ver en TCGplayer</a>`, c.pick === o.key);
    }).join('');
    return `<div class="opts">${h}</div>`;
  },
  // guarda lo escrito antes de rehacer el formulario (por ejemplo, al cambiar cómo cargar las cartas)
  keepDraft() {
    const n = App.$('#ed-name'), l = App.$('#ed-list');
    this.draft = { name: n ? n.value : (this.draft ? this.draft.name : ''), list: l ? l.value : (this.draft ? this.draft.list : '') };
  },
  renderEditor() {
    const { esc, ICONS } = App;
    const d = this.deck;
    const dr = this.draft || { name: d ? d.name : '', list: d ? Decks.toText(d) : '' };
    const listForm = `
      <div><label class="flabel" for="ed-list">Lista</label>
        <textarea class="field" id="ed-list" rows="${d ? 14 : 10}" spellcheck="false" autocapitalize="characters" placeholder="1xOP09-061&#10;4xOP09-069&#10;4 ST26-003 Nico Robin">${esc(dr.list)}</textarea>
        <details class="help"><summary>Qué formatos sirven</summary><p>Una carta por línea: “4xOP12-034”, “4 OP12-034 Perona” u “OP12-034 x4”. Si una carta aparece dos veces, se suman.</p></details>
      </div>
      <div class="check" id="ed-check" aria-live="polite"></div>
      <div id="ed-preview"></div>`;
    const way = d ? 'lista' : this.way;
    const choice = d ? '' : `
      <div><span class="flabel" id="way-lab">Cómo cargás las cartas</span>
        <div class="choice" role="radiogroup" aria-labelledby="way-lab">
          <button type="button" role="radio" data-way="visual" aria-checked="${way === 'visual'}"><span class="ic">${ICONS.cartas}</span><b>Con imágenes</b><small>Las buscás en el índice y sumás las que quieras.</small></button>
          <button type="button" role="radio" data-way="lista" aria-checked="${way === 'lista'}"><span class="ic">${ICONS.paste}</span><b>Pegando una lista</b><small>La del simulador o de cualquier página de mazos.</small></button>
        </div>
      </div>`;
    const buttons = d
      ? `<button type="button" class="btn primary" data-act="save">Guardar</button>
         <button type="button" class="btn" data-act="visual">${ICONS.cartas}Sumar con imágenes</button>
         <button type="button" class="btn ghost" data-act="cancel">Cancelar</button>`
      : way === 'visual'
        ? `<button type="button" class="btn primary" data-act="visual">${ICONS.cartas}Empezar a elegir cartas</button>
           <button type="button" class="btn ghost" data-act="cancel">Cancelar</button>`
        : `<button type="button" class="btn primary" data-act="save">Guardar mazo</button>
           <button type="button" class="btn ghost" data-act="cancel">Cancelar</button>`;
    this.el.innerHTML = `
      <a class="back" href="${d ? `#mazo/${encodeURIComponent(d.id)}` : '#mazos'}">${ICONS.back}${d ? 'Volver al mazo' : 'Mazos'}</a>
      <div class="ed">
        <h1>${d ? 'Editar lista' : 'Nuevo mazo'}</h1>
        <div class="card">
          <div><label class="flabel" for="ed-name">Nombre</label><input class="field" id="ed-name" maxlength="60" value="${esc(dr.name)}" placeholder="Ej.: Luffy Morado/Negro"></div>
          ${choice}
          ${way === 'lista' ? listForm : ''}
          <div class="vact">${buttons}</div>
        </div>
      </div>`;
    this.check();
    this.preview();
    if (this.focusName) { this.focusName = false; setTimeout(() => { const n = App.$('#ed-name'); if (n) n.focus(); }, 0); }
  },
  listText() { const ta = App.$('#ed-list'); return ta ? ta.value : (this.draft ? this.draft.list : ''); },
  // cómo queda el mazo, con las imágenes de las cartas que vas escribiendo
  preview() {
    const { esc, Prices } = App;
    const box = App.$('#ed-preview'), ta = App.$('#ed-list');
    if (!box || !ta) return;
    const r = Decks.parse(ta.value);
    const sig = `${r.cards.map(c => `${c.qty}x${c.num}`).join(',')}|${Prices.count}|${App.Cards.list.length}`;
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    if (!r.cards.length) { box.innerHTML = ''; return; }
    const picks = new Map((this.deck ? this.deck.cards : []).map(c => [c.num, c.pick]));
    const leader = r.cards.find(c => CardUI.isLeaderCard(c.num));
    const cards = leader ? [leader, ...r.cards.filter(c => c !== leader)] : r.cards;
    box.innerHTML = `<p class="flabel">Así queda</p><div class="cgrid mini">${cards.map(c => {
      const e = Prices.choose(Prices.options(c.num), picks.get(c.num) || null);
      const pid = (e && e.pid) || CardUI.basePid(c.num);
      const nm = Prices.cardName(c.num) || c.num;
      return `<span class="ctile" title="${esc(`${c.qty}× ${nm} (${c.num})`)}"><span class="cimg">${pid ? CardUI.img(pid, nm) : `<span class="noimg"></span><span class="nonum">${esc(c.num)}</span>`}<span class="qbadge">×${c.qty}</span>${c === leader ? '<span class="lbadge">Líder</span>' : ''}</span></span>`;
    }).join('')}</div>`;
  },
  // guarda lo que haya escrito y abre el índice en modo armado
  goVisual() {
    const n = App.$('#ed-name');
    const name = (n ? n.value : '').trim();
    const r = Decks.parse(this.listText());
    let deck = this.deck;
    if (deck) {
      const picks = new Map(deck.cards.map(c => [c.num, c.pick]));
      deck.cards = r.cards.map(c => ({ num: c.num, qty: c.qty, pick: picks.get(c.num) || null }));
      if (name) deck.name = name;
      Decks.update(deck);
    } else {
      deck = Decks.add(Decks.make(name, r.cards));
    }
    this.editing = false; this.draft = null;
    App.go('cartas', `mazo:${deck.id}`);
  },
  check() {
    const { esc, Prices, plural } = App;
    const box = App.$('#ed-check'), ta = App.$('#ed-list');
    if (!box || !ta) return;
    const r = Decks.parse(ta.value);
    const total = r.cards.reduce((s, c) => s + c.qty, 0);
    const unknown = Prices.state === 'ok' ? r.cards.filter(c => !Prices.options(c.num).length).map(c => c.num) : [];
    const parts = [];
    if (r.cards.length) parts.push(`<span class="ok">Reconocí ${plural(r.cards.length, 'carta distinta', 'cartas distintas')}, ${plural(total, 'copia', 'copias')} en total.</span>`);
    if (r.bad.length) parts.push(`<span class="bad">No entendí ${plural(r.bad.length, 'línea', 'líneas')}: ${r.bad.slice(0, 4).map(b => `<code>${esc(b)}</code>`).join(' ')}${r.bad.length > 4 ? '…' : ''}</span>`);
    if (unknown.length) parts.push(`<span class="bad">TCGplayer no tiene estos números: ${unknown.slice(0, 6).map(u => `<code>${esc(u)}</code>`).join(' ')}${unknown.length > 6 ? '…' : ''}</span>`);
    box.innerHTML = parts.join('');
  },
  saveEdit() {
    const n = App.$('#ed-name');
    const name = (n ? n.value : '').trim();
    const r = Decks.parse(this.listText());
    if (!r.cards.length) { App.toast('La lista está vacía: pegá al menos una carta'); return; }
    this.draft = null;
    if (this.deck) {
      const picks = new Map(this.deck.cards.map(c => [c.num, c.pick]));
      this.deck.cards = r.cards.map(c => ({ num: c.num, qty: c.qty, pick: picks.get(c.num) || null }));
      if (name) this.deck.name = name;
      Decks.update(this.deck);
      this.editing = false; this.render();
      App.toast('Guardaste los cambios');
    } else {
      const d = Decks.add(Decks.make(name, r.cards));
      App.toast('Guardaste el mazo');
      App.go('mazo', d.id);
    }
  },
});

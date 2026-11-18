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
    App.on('prices', again); App.on('settings', again); App.on('decks', again);
  },
  show() {
    const { esc, money, Prices, plural } = App;
    const decks = Decks.all();
    const ready = Prices.state === 'ok';
    const items = decks.map(d => {
      const k = Decks.counts(d);
      const p = ready ? Decks.price(d) : null;
      const lname = k.leader ? (Prices.cardName(k.leader.num) || k.leader.num) : null;
      return `<a class="deck" href="#mazo/${encodeURIComponent(d.id)}">
        <b>${esc(d.name)}${d.ejemplo ? '<span class="badge soft">Ejemplo</span>' : ''}</b>
        <small>${lname ? `Líder: ${esc(lname)} · ` : ''}${plural(k.main, 'carta', 'cartas')}${k.leader ? ' + líder' : ''}</small>
        ${p ? `<span class="price">${money(p.total)}</span>${p.missing ? `<small>${plural(p.missing, 'carta', 'cartas')} sin precio</small>` : ''}`
            : `<span class="price none">${esc(Prices.state === 'loading' ? 'Calculando…' : 'Sin precios todavía')}</span>`}
      </a>`;
    }).join('');
    this.el.innerHTML = `
      <div class="vhead">
        <div><h1>Mazos</h1><p>${esc(Prices.statusText())}</p></div>
        <div class="vact"><a class="btn primary" href="#mazo/nuevo">${App.ICONS.plus}Nuevo mazo</a></div>
      </div>
      ${typeof Cloud !== 'undefined' ? Cloud.listNote() : ''}
      ${!ready && Prices.state !== 'loading' ? `<div class="banner tone-warn"><b>Sin precios</b><span>${esc(Prices.statusText())} Igual podés cargar y guardar tus listas.</span></div>` : ''}
      ${decks.length ? `<div class="decks">${items}</div>` : `<div class="card"><p class="note">Todavía no guardaste ningún mazo. Tocá “Nuevo mazo” y pegá la lista del simulador.</p></div>`}`;
  },
});

/* ---------- un mazo: precio, cartas y edición ---------- */
App.register({
  id: 'mazo', title: 'Mazo', navAs: 'mazos', icon: App.ICONS.mazos,
  init(el) {
    this.el = el; this.sort = 'lista'; this.open = new Set();
    const again = () => { if (App.currentId() === 'mazo' && !this.editing && this.deck) this.render(); };
    App.on('prices', again); App.on('settings', again);
    // si la sincronización trae una versión nueva del mazo abierto, la mostramos
    App.on('decks', () => {
      if (App.currentId() !== 'mazo' || this.editing || this.ro || !this.deck) return;
      const d = Decks.get(this.deck.id); if (d) { this.deck = d; this.render(); }
    });

    el.addEventListener('click', e => {
      const t = e.target;
      const deck = this.deck;
      if (t.closest('[data-act="edit"]')) { this.editing = true; this.render(); return; }
      if (t.closest('[data-act="cancel"]')) {
        if (this.isNew) { App.go('mazos'); return; }
        this.editing = false; this.render(); return;
      }
      if (t.closest('[data-act="save"]')) { this.saveEdit(); return; }
      if (t.closest('[data-act="copy"]') && deck) { App.copy(Decks.toText(deck), 'Lista copiada'); return; }
      if (t.closest('[data-act="mine"]') && deck) {
        const c = Decks.add(Decks.make(`${deck.name} (de ${deck.ownerName || 'otro jugador'})`, deck.cards));
        App.toast('Lo copiaste a tus mazos'); App.go('mazo', c.id); return;
      }
      if (t.closest('[data-act="dup"]') && deck) {
        const c = Decks.make(`${deck.name} (copia)`, deck.cards);
        Decks.add(c); App.toast('Hiciste una copia del mazo'); App.go('mazo', c.id); return;
      }
      if (t.closest('[data-act="del"]') && deck) {
        const r = Decks.remove(deck.id);
        App.go('mazos');
        App.toast(`Borraste “${deck.name}”`, 'Deshacer', () => { Decks.restore(r); App.go('mazo', deck.id); });
        return;
      }
      const sb = t.closest('[data-sort]');
      if (sb) { this.sort = sb.dataset.sort; this.render(); return; }
      const line = t.closest('.cl-main');
      if (line) {
        const num = line.dataset.num;
        if (this.open.has(num)) this.open.delete(num); else this.open.add(num);
        this.render(); return;
      }
    });
    el.addEventListener('change', e => {
      const t = e.target;
      if (t.matches('input[type="radio"][data-pick]') && this.deck && !this.ro) {
        const c = this.deck.cards.find(x => x.num === t.dataset.pick);
        if (c) { c.pick = t.value || null; Decks.update(this.deck); this.render(); }
      }
    });
    el.addEventListener('input', e => { if (e.target.id === 'ed-list') this.check(); });
  },
  show(param) {
    this.ro = false;
    if (param && param.startsWith('nube:')) return this.showShared(param.slice(5));
    this.isNew = param === 'nuevo';
    this.deck = this.isNew ? null : Decks.get(param);
    this.editing = this.isNew;
    this.open = new Set();
    if (!this.isNew && !this.deck) {
      this.el.innerHTML = `<a class="back" href="#mazos">← Mazos</a><div class="card"><p class="note">No encontré ese mazo. Puede que lo hayas borrado.</p></div>`;
      return;
    }
    this.render();
  },
  // mazo de otro jugador del grupo: se ve con precios pero no se edita
  showShared(id) {
    this.ro = true; this.isNew = false; this.editing = false; this.open = new Set();
    const cloud = typeof Cloud !== 'undefined' ? Cloud : null;
    const find = () => (cloud ? cloud.groupDeck(id) : null);
    this.deck = find();
    if (this.deck) { this.render(); return; }
    const msg = t => { this.el.innerHTML = `<a class="back" href="#grupo">← Grupo</a><div class="card"><p class="note">${t}</p></div>`; };
    msg('Cargando el mazo…');
    if (!cloud) return msg('No encontré ese mazo.');
    cloud.loadGroup().then(() => {
      if (App.currentId() !== 'mazo' || !this.ro) return;
      this.deck = find();
      if (this.deck) this.render(); else msg('No encontré ese mazo. Puede que lo hayan borrado, o que no hayas entrado con tu usuario.');
    });
  },
  render() {
    if (this.editing) return this.renderEditor();
    const { esc, money, Prices, plural, fdate } = App;
    const d = this.deck;
    const k = Decks.counts(d);
    const ready = Prices.state === 'ok';
    const p = Decks.price(d);
    const lname = k.leader ? (Prices.cardName(k.leader.num) || '') : '';
    const warns = [];
    if (!ready) warns.push(['warn', Prices.statusText()]);
    if (ready && p.missing) warns.push(['warn', `${plural(p.missing, 'carta no tiene', 'cartas no tienen')} precio en TCGplayer: no suman al total.`]);
    if (k.main !== 50) warns.push(['warn', `El mazo tiene ${plural(k.main, 'carta', 'cartas')} sin contar el líder (lo normal son 50).`]);
    const over = d.cards.filter(c => c.qty > 4 && !(k.leader && c.num === k.leader.num));
    if (over.length) warns.push(['warn', `Más de 4 copias: ${over.map(c => c.num).join(', ')}.`]);

    let rows = p.rows.slice();
    if (this.sort === 'caras') rows.sort((a, b) => (b.sub ?? -1) - (a.sub ?? -1));
    const lines = rows.map(r => {
      const c = r.c, ch = r.chosen;
      const name = ch ? (Prices.cardName(c.num) || ch.name) : (ready ? 'No está en los datos de TCGplayer' : c.num);
      const variant = ch ? [ch.group.abbr || ch.group.name, Prices.isBase(ch) ? '' : (ch.name.match(/\(([^)]*)\)/g) || []).join(' ').replace(/[()]/g, ''), c.pick ? 'elegida' : ''].filter(Boolean).join(' · ') : '';
      const isL = k.leader && k.leader.num === c.num;
      const open = this.open.has(c.num);
      const opts = open ? this.optionsHTML(r) : '';
      return `<li class="cline">
        <button type="button" class="cl-main" data-num="${esc(c.num)}" aria-expanded="${open}">
          <span class="q">${c.qty}×</span>
          <span class="nm"><b>${esc(name)}${isL ? '<span class="badge">Líder</span>' : ''}</b><small>${esc(c.num)}${variant ? ' · ' + esc(variant) : ''}</small></span>
          <span class="pr${r.unit == null ? ' miss' : ''}"><b>${r.unit == null ? 'sin precio' : money(r.sub)}</b>${r.unit != null && c.qty > 1 ? `<small>${money(r.unit)} c/u</small>` : ''}${r.approx ? '<small>precio aproximado</small>' : ''}</span>
        </button>
        ${opts}
      </li>`;
    }).join('');

    // qué cartas pesan más
    const top = p.rows.filter(r => r.sub).sort((a, b) => b.sub - a.sub).slice(0, 5);
    const topSum = top.reduce((s, r) => s + r.sub, 0);
    const share = ready && p.total > 0 && top.length ? `
      <div class="card"><h2>Lo que más pesa</h2>
        <div class="bar-share">${top.map(r => `<div class="share-row"><span>${r.c.qty}× ${esc(Prices.cardName(r.c.num) || r.c.num)}</span><b class="tab">${money(r.sub)}</b><span class="track"><i style="width:${Math.max(2, Math.round(100 * r.sub / p.total))}%"></i></span></div>`).join('')}</div>
        <p class="note">Estas ${top.length} cartas son el ${Math.round(100 * topSum / p.total)}% del precio del mazo.</p>
      </div>` : '';

    const ro = this.ro;
    const actions = ro ? `
              <button type="button" class="btn primary" data-act="mine">${App.ICONS.dup}Copiar a mis mazos</button>
              <button type="button" class="btn" data-act="copy">${App.ICONS.copy}Copiar lista</button>` : `
              <button type="button" class="btn" data-act="edit">${App.ICONS.edit}Editar</button>
              <button type="button" class="btn" data-act="copy">${App.ICONS.copy}Copiar lista</button>
              <button type="button" class="btn ghost" data-act="dup">${App.ICONS.dup}Duplicar</button>
              <button type="button" class="btn ghost danger" data-act="del">${App.ICONS.trash}Borrar</button>`;
    this.el.innerHTML = `
      ${ro ? '<a class="back" href="#grupo">← Grupo</a>' : '<a class="back" href="#mazos">← Mazos</a>'}
      <div class="deck-cols">
        <div class="list">
          <div class="card deck-top">
            <h1 class="deck-title">${esc(d.name)}</h1>
            <div class="meta">${ro ? `Armado por <b>${esc(d.ownerName || 'otro jugador')}</b> · ` : ''}${k.leader ? `Líder: <b>${esc(lname || k.leader.num)}</b> · ${esc(k.leader.num)} · ` : ''}${plural(k.main, 'carta', 'cartas')}${k.leader ? ' + líder' : ''}</div>
            <div class="total">
              <span class="lab">Precio del mazo</span>
              <span class="big">${ready ? money(p.total) : '—'}</span>
              <small>${ready ? `${App.PRICE_LABEL[App.settings.priceType]} de TCGplayer en dólares · precios del ${fdate(Prices.updated)} · ${App.settings.printing === 'base' ? 'versión común' : 'versión más barata'} de cada carta` : esc(Prices.statusText())}</small>
            </div>
            ${warns.length ? `<div class="warns">${warns.map(w => `<div class="banner tone-${w[0]}"><span>${esc(w[1])}</span></div>`).join('')}</div>` : ''}
            <div class="vact">${actions}
            </div>
          </div>
          ${share}
        </div>
        <div class="card">
          <div class="lhead">
            <h2>Cartas</h2>
            <div class="seg" role="radiogroup" aria-label="Ordenar">
              <button type="button" role="radio" data-sort="lista" aria-checked="${this.sort === 'lista'}">Lista</button>
              <button type="button" role="radio" data-sort="caras" aria-checked="${this.sort === 'caras'}">Más caras</button>
            </div>
          </div>
          <p class="hint">${ro ? 'Tocá una carta para ver todas sus versiones y sus precios.' : 'Tocá una carta para ver todas sus versiones y elegir cuál tenés o querés comprar.'}</p>
          <ul class="clist">${lines}</ul>
        </div>
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
      return row(o.key, esc(o.name), `${esc(o.group.name || o.group.abbr)}${o.rarity ? ' · ' + esc(o.rarity) : ''}${o.sub && o.sub !== 'Normal' ? ' · ' + esc(o.sub) : ''}`,
        v.v == null ? 'sin precio' : money(v.v), `<a href="${Prices.url(o)}" target="_blank" rel="noopener">Ver en TCGplayer</a>`, c.pick === o.key);
    }).join('');
    return `<div class="opts">${h}</div>`;
  },
  renderEditor() {
    const { esc } = App;
    const d = this.deck;
    this.el.innerHTML = `
      <a class="back" href="${d ? `#mazo/${encodeURIComponent(d.id)}` : '#mazos'}">← ${d ? 'Volver al mazo' : 'Mazos'}</a>
      <div class="vhead"><div><h1>${d ? 'Editar lista' : 'Nuevo mazo'}</h1><p>Pegá la lista del simulador o escribila: una carta por línea, con la cantidad y el número.</p></div></div>
      <div class="card">
        <div><label class="flabel" for="ed-name">Nombre</label><input class="field" id="ed-name" maxlength="60" value="${esc(d ? d.name : '')}" placeholder="Ej.: Luffy Morado/Negro"></div>
        <div><label class="flabel" for="ed-list">Lista</label>
          <textarea class="field" id="ed-list" rows="16" spellcheck="false" autocapitalize="characters" placeholder="1xOP09-061&#10;4xOP09-069&#10;4 ST26-003 Nico Robin">${esc(d ? Decks.toText(d) : '')}</textarea></div>
        <p class="hint">Sirven “4xOP12-034”, “4 OP12-034 Perona” u “OP12-034 x4”. Si una carta aparece dos veces, se suman.</p>
        <div class="check" id="ed-check" aria-live="polite"></div>
        <div class="vact">
          <button type="button" class="btn primary" data-act="save">Guardar</button>
          <button type="button" class="btn ghost" data-act="cancel">Cancelar</button>
        </div>
      </div>`;
    this.check();
    if (!d) setTimeout(() => { const n = App.$('#ed-name'); if (n) n.focus(); }, 0);
  },
  check() {
    const { esc, Prices, plural } = App;
    const box = App.$('#ed-check');
    if (!box) return;
    const r = Decks.parse(App.$('#ed-list').value);
    const total = r.cards.reduce((s, c) => s + c.qty, 0);
    const unknown = Prices.state === 'ok' ? r.cards.filter(c => !Prices.options(c.num).length).map(c => c.num) : [];
    const parts = [];
    if (r.cards.length) parts.push(`<span class="ok">Reconocí ${plural(r.cards.length, 'carta distinta', 'cartas distintas')}, ${plural(total, 'copia', 'copias')} en total.</span>`);
    if (r.bad.length) parts.push(`<span class="bad">No entendí ${plural(r.bad.length, 'línea', 'líneas')}: ${r.bad.slice(0, 4).map(b => `<code>${esc(b)}</code>`).join(' ')}${r.bad.length > 4 ? '…' : ''}</span>`);
    if (unknown.length) parts.push(`<span class="bad">TCGplayer no tiene estos números: ${unknown.slice(0, 6).map(u => `<code>${esc(u)}</code>`).join(' ')}${unknown.length > 6 ? '…' : ''}</span>`);
    box.innerHTML = parts.join('');
  },
  saveEdit() {
    const name = App.$('#ed-name').value.trim();
    const r = Decks.parse(App.$('#ed-list').value);
    if (!r.cards.length) { App.toast('La lista está vacía: pegá al menos una carta'); return; }
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

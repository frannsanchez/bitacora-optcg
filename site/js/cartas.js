/* Cartas: índice con imágenes, filtros y búsqueda (con todas las versiones: paralelas, manga, SP...),
   ficha de cada carta y armado de mazos tocando + y −. */
const CardUI = (() => {
  const { esc, Prices, Cards } = App;
  const COLOR_CSS = { Red: '#D8453B', Green: '#3BA55C', Blue: '#3D7FDE', Purple: '#8E5BD0', Black: '#202027', Yellow: '#E8C33A' };

  const img = (pid, alt, size = 200, cls = '') => pid
    ? `<img class="${cls}" src="${App.imgUrl(pid, size)}" alt="${esc(alt)}" loading="lazy" decoding="async" width="200" height="279" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'noimg ${cls}'}))">`
    : `<span class="noimg ${cls}"></span>`;
  const dots = colors => colors.map(c => `<i class="dot" style="background:${COLOR_CSS[c] || '#888'}" title="${esc(Cards.colorEs(c))}"></i>`).join('');
  const isLeaderCard = num => { const c = Cards.get(num); return c ? c.type === 'Leader' : Prices.isLeader(num); };
  const fromPrice = num => { const e = Prices.cheapest(num); return e ? Prices.value(e).v : null; };
  // imagen para una carta: la versión común si la hay
  function basePid(num) {
    const c = Cards.get(num); if (c && c.pid) return c.pid;
    const o = Prices.options(num); if (!o.length) return null;
    return (o.find(e => Prices.isBase(e)) || o[0]).pid;
  }
  // la versión que usa una línea del mazo (la elegida a mano o la automática)
  const lineEntry = line => (line ? Prices.choose(Prices.options(line.num), line.pick) : null);
  const linePid = line => { const e = lineEntry(line); return (e && e.pid) || (line ? basePid(line.num) : null); };
  // imagen del líder de un mazo, en la versión que usa
  function leaderImg(deck) {
    const L = Decks.leader(deck);
    return L ? img(linePid(L), Prices.cardName(L.num) || L.num) : '<span class="noimg"></span>';
  }
  // texto de efecto con las palabras clave resaltadas
  const effect = t => esc(t).replace(/\[([^\]]{1,40})\]/g, '<span class="kwe">[$1]</span>').replace(/\n/g, '<br>');

  // agrega o saca copias de una carta en un mazo, cuidando el líder y el máximo de 4.
  // key: la versión que tocaste (pid|subtipo). Al sumar, esa pasa a ser la versión que usa el mazo.
  function changeQty(deck, num, delta, key) {
    num = String(num).toUpperCase();
    const leader = isLeaderCard(num);
    const line = deck.cards.find(c => c.num === num);
    const cur = line ? line.qty : 0;
    let next = Math.max(0, cur + delta);
    let notice = '';
    if (leader) {
      next = Math.min(1, next);
      if (next === 1 && !line) {
        const old = deck.cards.find(c => c.num !== num && isLeaderCard(c.num));
        if (old) { deck.cards = deck.cards.filter(c => c !== old); notice = `Cambiaste el líder por ${Prices.cardName(num) || num}`; }
      }
    } else if (next > 4) { App.toast('Un mazo puede tener hasta 4 copias de cada carta'); next = 4; }

    let pick = line ? line.pick : null;
    if (delta > 0 && key) {
      const opts = Prices.options(num);
      const want = opts.find(o => o.key === key);
      const auto = Prices.choose(opts, null);
      const now = line ? Prices.choose(opts, line.pick) : null;
      if (want && (!line || !now || now.pid !== want.pid)) {
        pick = auto && auto.pid === want.pid ? null : want.key;
        if (line && next > 0 && !notice) {
          const v = Prices.variant(want) || 'común';
          notice = `${leader || next === 1 ? 'Tu copia' : `Tus ${next} copias`} de ${Prices.cardName(num) || num} ${leader || next === 1 ? 'pasa' : 'pasan'} a la versión ${v.toLowerCase() === 'común' ? 'común' : `“${v}”`}`;
        }
      }
    }
    if (next === cur && pick === (line ? line.pick : null)) return cur;
    if (next === 0) deck.cards = deck.cards.filter(c => c.num !== num);
    else if (line) { line.qty = next; line.pick = pick; }
    else if (leader) deck.cards.unshift({ num, qty: 1, pick });
    else deck.cards.push({ num, qty: next, pick });
    Decks.update(deck);
    if (notice) App.toast(notice);
    return next;
  }

  // ediciones (grupos de TCGplayer): primero colecciones, después mazos de inicio y al final promos y eventos; lo más nuevo arriba
  const KIND_NAME = ['Colecciones', 'Mazos de inicio', 'Promos y eventos'];
  function sets() {
    const kind = g => {
      const a = String(g.abbr || '').toUpperCase().trim();
      if (/\s(RE|PRE|ANN)$/.test(a) || /^OP-(PR|DD|RP)$/.test(a)) return 2;
      if (/^(ST|SD|LT)-?\d/.test(a)) return 1;
      return 0;
    };
    return [...Prices.groups.values()]
      .map(g => ({ id: String(g.id), kind: kind(g), date: g.date || '', gid: +g.id, abbr: g.abbr, label: String(g.name || '').startsWith(g.abbr) ? g.name : `${g.abbr} · ${g.name}` }))
      .sort((a, b) => a.kind - b.kind || b.date.localeCompare(a.date) || b.gid - a.gid);
  }

  // todas las versiones (un producto de TCGplayer cada una) con los datos de su carta; se arma una vez por carga de datos
  let vcache = null;
  function versions() {
    const stamp = `${Prices.updated}|${Prices.count}|${Cards.updated}|${Cards.list.length}`;
    if (vcache && vcache.stamp === stamp) return vcache;
    const order = new Map(sets().map((s, i) => [s.id, i]));
    const list = [];
    for (const [pid, entries] of Prices.byPid) {
      const e0 = entries[0];
      const c = Cards.get(e0.num);
      if (!c) continue;
      const label = Prices.variant(e0);
      const v = { pid, num: e0.num, c, entries, group: e0.group, base: c.pid === pid, label, rarity: e0.rarity };
      v.qn = Cards.norm(`${c.name} ${e0.name} ${c.num} ${c.subtypes.join(' ')} ${label} ${e0.group.abbr}`);
      v.ord = order.has(String(e0.group.id)) ? order.get(String(e0.group.id)) : 9999;
      list.push(v);
    }
    list.sort((a, b) => a.ord - b.ord || a.num.localeCompare(b.num) || (a.base ? 0 : 1) - (b.base ? 0 : 1) || a.pid - b.pid);
    vcache = { stamp, list, byPid: new Map(list.map(v => [v.pid, v])) };
    return vcache;
  }

  return { img, dots, effect, basePid, fromPrice, isLeaderCard, changeQty, lineEntry, linePid, leaderImg, sets, versions, KIND_NAME, COLOR_CSS };
})();

/* ---------- índice ---------- */
App.register({
  id: 'cartas', title: 'Cartas', short: 'Cartas', nav: true, tab: true, home: true, icon: App.ICONS.cartas,
  desc: 'Todas las cartas y sus versiones (paralelas, manga, SP...) con imagen y precio. Filtrá por edición, color, tipo o costo.',
  status() { const n = App.Cards.list.length; return n ? `${n.toLocaleString('es-AR')} cartas` : 'Índice de cartas'; },
  init(el) {
    this.el = el;
    const saved = App.store.get('bitacora-indice-v2', {});
    this.f = { q: '', set: saved.set || '', ver: saved.ver || '', color: '', type: '', cost: '' };
    this.limit = 60; this.deck = null;
    el.innerHTML = `
      <div class="vhead"><div><h1>Cartas</h1><p id="ci-status"></p></div></div>
      <div id="ci-builder"></div>
      <div class="card filters">
        <label class="sr" for="ci-q">Buscar</label>
        <input class="field big" id="ci-q" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Nombre, número, tripulación, texto o versión">
        <div class="frow">
          <label class="fsel wide"><span>Edición</span><select class="field" id="ci-set"></select></label>
          <label class="fsel"><span>Versión</span><select class="field" id="ci-ver"><option value="">Todas</option><option value="comun">Solo la común</option><option value="alt">Solo artes alternativos</option></select></label>
          <label class="fsel"><span>Tipo</span><select class="field" id="ci-type"><option value="">Todos</option>${App.Cards.TYPES.map(t => `<option value="${t}">${App.Cards.typeEs(t)}</option>`).join('')}</select></label>
          <label class="fsel"><span>Costo</span><select class="field" id="ci-cost"><option value="">Todos</option>${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<option value="${n}">${n}</option>`).join('')}<option value="10">10 o más</option></select></label>
        </div>
        <div class="colors" role="group" aria-label="Color">${App.Cards.COLORS.map(c => `<button type="button" class="cchip" data-color="${c}" aria-pressed="false"><i class="dot" style="background:${CardUI.COLOR_CSS[c]}"></i>${App.Cards.colorEs(c)}</button>`).join('')}</div>
      </div>
      <p class="note" id="ci-count" aria-live="polite"></p>
      <div class="cgrid" id="ci-grid"></div>
      <button type="button" class="add" id="ci-more" hidden>Ver más cartas</button>`;
    let timer = null;
    const $ = s => el.querySelector(s);
    const keep = () => App.store.set('bitacora-indice-v2', { set: this.f.set, ver: this.f.ver });
    $('#ci-q').addEventListener('input', e => { this.f.q = e.target.value; this.limit = 60; clearTimeout(timer); timer = setTimeout(() => this.render(), 150); });
    $('#ci-set').addEventListener('change', e => { this.f.set = e.target.value; this.setTouched = true; this.limit = 60; keep(); this.render(); });
    $('#ci-ver').addEventListener('change', e => { this.f.ver = e.target.value; this.limit = 60; keep(); this.render(); });
    $('#ci-type').addEventListener('change', e => { this.f.type = e.target.value; this.limit = 60; this.render(); });
    $('#ci-cost').addEventListener('change', e => { this.f.cost = e.target.value; this.limit = 60; this.render(); });
    el.addEventListener('click', e => {
      const t = e.target;
      const cb = t.closest('.cchip');
      if (cb) { this.f.color = this.f.color === cb.dataset.color ? '' : cb.dataset.color; this.limit = 60; this.render(); return; }
      if (t.closest('#ci-more')) { this.limit += 60; this.render(); return; }
      const q = t.closest('[data-q]');
      if (q && this.deck) {
        const tile = q.closest('.ctile');
        CardUI.changeQty(this.deck, tile.dataset.num, +q.dataset.q, tile.dataset.key);
        this.paint(tile.dataset.num); this.renderBuilder(); return;
      }
    });
    const again = () => { if (App.currentId() === 'cartas') this.render(); };
    App.on('cards', again); App.on('prices', again); App.on('settings', again);
  },
  show(param) {
    this.deck = param && param.startsWith('mazo:') ? Decks.get(param.slice(5)) : null;
    App.Cards.load();
    this.renderBuilder();
    this.render();
  },
  renderBuilder() {
    const box = this.el.querySelector('#ci-builder');
    if (!this.deck) { box.innerHTML = ''; return; }
    const k = Decks.counts(this.deck);
    const lname = k.leader ? (App.Prices.cardName(k.leader.num) || k.leader.num) : 'sin líder';
    box.innerHTML = `<div class="builder">
      <span class="blead">${CardUI.leaderImg(this.deck)}</span>
      <div><small>Armando</small><b>${App.esc(this.deck.name)}</b><span>${k.main}/50 cartas · Líder: ${App.esc(lname)}</span></div>
      <a class="btn primary" href="#mazo/${encodeURIComponent(this.deck.id)}">Listo</a>
    </div>`;
  },
  // cantidades del mazo en las cartas visibles: el número se ve en todas las versiones,
  // y el borde lleno marca la versión que usa el mazo
  tileState(num) {
    const line = this.deck && this.deck.cards.find(c => c.num === num);
    return { qty: line ? line.qty : 0, pid: line ? CardUI.linePid(line) : null };
  },
  paint(num) {
    const s = this.tileState(num);
    this.el.querySelectorAll(`.ctile[data-num="${CSS.escape(num)}"]`).forEach(tile => {
      tile.querySelector('.qv').textContent = s.qty;
      tile.classList.toggle('in', s.qty > 0 && String(s.pid) === tile.dataset.pid);
      tile.classList.toggle('also', s.qty > 0 && String(s.pid) !== tile.dataset.pid);
      tile.querySelector('[data-q="-1"]').disabled = !s.qty;
    });
  },
  render() {
    const el = this.el, C = App.Cards, P = App.Prices, { esc, money } = App;
    const $ = s => el.querySelector(s);
    const ready = C.state === 'ok' && P.state === 'ok';
    const loading = C.state === 'loading' || P.state === 'loading' || P.state === 'idle';
    const status = ready ? `${C.list.length.toLocaleString('es-AR')} cartas y ${P.byPid.size.toLocaleString('es-AR')} versiones. ${P.statusText()}.`
      : loading ? 'Cargando el índice…'
      : C.state === 'missing' || P.state === 'missing' ? 'Todavía no están los datos de las cartas: corré la tarea “Publicar app y precios” en GitHub.'
      : 'No pude cargar el índice. Revisá tu conexión.';
    $('#ci-status').textContent = status;
    if (!ready) { $('#ci-grid').innerHTML = ''; $('#ci-count').textContent = ''; $('#ci-more').hidden = true; return; }

    const sets = CardUI.sets();
    const valid = id => id === 'todas' || sets.some(s => s.id === id);
    if (!this.f.set || !valid(this.f.set)) this.f.set = (sets.find(s => s.kind === 0) || sets[0] || { id: 'todas' }).id;
    const selSet = $('#ci-set');
    if (selSet.dataset.n !== String(sets.length)) {
      selSet.innerHTML = `<option value="todas">Todas las ediciones</option>` + CardUI.KIND_NAME.map((name, k) => {
        const g = sets.filter(s => s.kind === k);
        return g.length ? `<optgroup label="${esc(name)}">${g.map(s => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('')}</optgroup>` : '';
      }).join('');
      selSet.dataset.n = String(sets.length);
    }
    const q = this.f.q.trim();
    // al buscar, si no elegiste edición a mano, busca en todas
    const set = q && !this.setTouched ? 'todas' : this.f.set;
    selSet.value = set;
    $('#ci-ver').value = this.f.ver; $('#ci-type').value = this.f.type; $('#ci-cost').value = this.f.cost;
    if ($('#ci-q').value !== this.f.q) $('#ci-q').value = this.f.q;
    el.querySelectorAll('.cchip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.color === this.f.color)));

    const words = C.norm(q).split(' ').filter(Boolean);
    const { list: all } = CardUI.versions();
    let list = all.filter(v => {
      const c = v.c;
      return (set === 'todas' || String(v.group.id) === set) &&
        (!this.f.ver || (this.f.ver === 'comun' ? v.base : !v.base)) &&
        (!this.f.color || c.colors.includes(this.f.color)) &&
        (!this.f.type || c.type === this.f.type) &&
        (this.f.cost === '' || (this.f.cost === '10' ? (c.cost ?? -1) >= 10 : c.cost === +this.f.cost)) &&
        (!words.length || words.every(w => v.qn.includes(w) || c.qt.includes(w)));
    });
    if (words.length || set === 'todas') {
      // primero las que coinciden por nombre o número (después las que coinciden por el texto del efecto),
      // y las versiones de una misma carta juntas, con la común adelante
      const vc = CardUI.versions();
      const inName = v => (words.length && !words.every(w => v.qn.includes(w)) ? 1 : 0);
      const cardOrd = v => { const b = vc.byPid.get(v.c.pid); return b ? b.ord : v.ord; };
      list.sort((a, b) => inName(a) - inName(b) || cardOrd(a) - cardOrd(b) || a.num.localeCompare(b.num) || (a.base ? 0 : 1) - (b.base ? 0 : 1) || a.ord - b.ord || a.pid - b.pid);
    }
    const total = list.length;
    const alts = list.filter(v => !v.base).length;
    const where = set === 'todas' ? ' en todas las ediciones' : '';
    $('#ci-count').textContent = !total ? 'No hay cartas con esos filtros.'
      : `${total.toLocaleString('es-AR')} ${total === 1 ? 'carta' : 'cartas'}${where}${alts && this.f.ver !== 'alt' ? ` (${alts.toLocaleString('es-AR')} ${alts === 1 ? 'es versión alternativa' : 'son versiones alternativas'})` : ''}`;

    const deck = this.deck;
    const states = new Map();
    const stateOf = num => { if (!states.has(num)) states.set(num, this.tileState(num)); return states.get(num); };
    $('#ci-grid').innerHTML = list.slice(0, this.limit).map(v => {
      const c = v.c;
      const e = P.best(v.entries);
      const pr = e ? P.value(e).v : null;
      const href = `#carta/${encodeURIComponent(`${v.num}~${v.pid}${deck ? '@' + deck.id : ''}`)}`;
      const s = deck ? stateOf(v.num) : null;
      const cls = s && s.qty ? (String(s.pid) === String(v.pid) ? ' in' : ' also') : '';
      return `<div class="ctile${cls}" data-num="${esc(v.num)}" data-pid="${v.pid}" data-key="${esc(e ? e.key : '')}">
        <a class="cimg" href="${href}" aria-label="${esc(c.name)} ${esc(v.num)}${v.base ? '' : ' ' + esc(v.label)}">${CardUI.img(v.pid, c.name)}${v.base ? '' : `<span class="vbadge">${esc(v.label)}</span>`}</a>
        <div class="cmeta"><b>${esc(c.name)}</b><small>${CardUI.dots(c.colors)}${esc(v.num)}${v.base ? '' : ` · ${esc(v.group.abbr)}`}</small><span class="cprice${pr == null ? ' miss' : ''}">${pr == null ? 'sin precio' : money(pr)}</span></div>
        ${deck ? `<div class="cqty"><button type="button" data-q="-1" aria-label="Sacar una"${s.qty ? '' : ' disabled'}>−</button><span class="qv">${s.qty}</span><button type="button" data-q="1" aria-label="Agregar una de esta versión">+</button></div>` : ''}
      </div>`;
    }).join('');
    $('#ci-more').hidden = total <= this.limit;
  },
});

/* ---------- ficha de una carta: #carta/<número>[~<versión>][@<mazo>] ---------- */
App.register({
  id: 'carta', title: 'Carta', navAs: 'cartas', icon: App.ICONS.cartas,
  init(el) {
    this.el = el;
    el.addEventListener('click', e => {
      const t = e.target;
      const q = t.closest('[data-q]');
      if (q) {
        const deck = this.deck || Decks.get(el.querySelector('#cd-deck')?.value);
        if (!deck) { App.toast('Primero creá un mazo en la pestaña Mazos'); return; }
        const shown = this.pid ? App.Prices.best(App.Prices.byPid.get(this.pid)) : null;
        const n = CardUI.changeQty(deck, this.num, +q.dataset.q, shown ? shown.key : null);
        if (!this.deck) App.toast(n ? `Tenés ${n}× en “${deck.name}”` : `La sacaste de “${deck.name}”`);
        this.render(); return;
      }
    });
    el.addEventListener('change', e => {
      const t = e.target;
      if (t.matches('input[type="radio"][name="cd-pick"]') && this.deck) {
        const line = this.deck.cards.find(c => c.num === this.num);
        if (line) { line.pick = t.value || null; Decks.update(this.deck); this.render(); }
      }
      if (t.id === 'cd-deck') { this.target = t.value; this.render(); }
    });
    const again = () => { if (App.currentId() === 'carta') this.render(); };
    App.on('cards', again); App.on('prices', again); App.on('settings', again);
  },
  show(param) {
    const m = String(param || '').match(/^([^~@]+)(?:~(\d+))?(?:@(.+))?$/) || [];
    this.num = String(m[1] || '').toUpperCase();
    this.pid = m[2] ? +m[2] : null;
    this.deck = m[3] ? Decks.get(m[3]) : null;
    App.Cards.load();
    this.render();
  },
  link(pid) { return `#carta/${encodeURIComponent(`${this.num}${pid ? '~' + pid : ''}${this.deck ? '@' + this.deck.id : ''}`)}`; },
  render() {
    const { esc, money, Prices, Cards, PRICE_LABEL, PRICE_ORDER, settings } = App;
    const num = this.num, c = Cards.get(num), deck = this.deck;
    const opts = Prices.options(num);
    const name = (c && c.name) || Prices.cardName(num) || num;
    const back = deck ? `<a class="back" href="#mazo/${encodeURIComponent(deck.id)}">${App.ICONS.back}${esc(deck.name)}</a>` : `<a class="back" href="#cartas">${App.ICONS.back}Cartas</a>`;
    if (!c && !opts.length) {
      this.el.innerHTML = `${back}<div class="card"><p class="note">${Cards.state === 'loading' || Prices.state === 'loading' ? 'Cargando…' : `No encontré la carta ${esc(num)}.`}</p></div>`;
      return;
    }
    const line = deck && deck.cards.find(l => l.num === num);
    const chosen = deck && line ? Prices.choose(opts, line.pick) : null;
    const shown = this.pid && Prices.byPid.has(this.pid) ? Prices.best(Prices.byPid.get(this.pid)) : null;
    const bigPid = (shown && shown.pid) || (chosen && chosen.pid) || CardUI.basePid(num);
    const shownLabel = shown ? Prices.variant(shown) : '';
    const facts = c ? [
      Cards.typeEs(c.type),
      c.colors.map(x => Cards.colorEs(x)).join(' / '),
      c.cost != null ? `Costo ${c.cost}` : '',
      c.life != null ? `Vida ${c.life}` : '',
      c.power != null ? `Poder ${c.power}` : '',
      c.counter != null ? `Counter +${c.counter}` : '',
      c.attribute ? c.attribute : '',
    ].filter(Boolean) : [];
    const qty = line ? line.qty : 0;
    const decks = Decks.all();
    const target = this.target && decks.some(d => d.id === this.target) ? this.target : (decks[0] && decks[0].id);
    const tq = (() => { const d = Decks.get(target); const l = d && d.cards.find(x => x.num === num); return l ? l.qty : 0; })();
    const stepper = n => `<div class="cqty big"><button type="button" data-q="-1" aria-label="Sacar una">−</button><span class="qv">${n}</span><button type="button" data-q="1" aria-label="Agregar una">+</button></div>`;
    const usingOther = shown && chosen && chosen.pid !== shown.pid;
    const add = deck
      ? `<div class="indeck"><span>En <b>${esc(deck.name)}</b>${usingOther ? `<small>Usás la versión ${esc(Prices.variant(chosen) || 'común')}. Con + pasás a esta.</small>` : ''}</span>${stepper(qty)}</div>`
      : decks.length
        ? `<div class="indeck"><label class="fsel"><span>Agregar a</span><select class="field" id="cd-deck">${decks.map(d => `<option value="${esc(d.id)}"${d.id === target ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>${stepper(tq)}</div>`
        : `<p class="note">Creá un mazo en la pestaña Mazos para agregar cartas.</p>`;

    const sorted = opts.slice().sort((a, b) => (Prices.value(a).v ?? Infinity) - (Prices.value(b).v ?? Infinity));
    const sel = settings.priceType;
    const auto = deck ? Prices.choose(opts, null) : null;
    const prints = sorted.map(e => {
      const col = k => `<span class="${k === sel ? 'sel' : ''}">${PRICE_LABEL[k]} <b>${money(e[k])}</b></span>`;
      const pick = deck && line ? `<label class="usepick"><input type="radio" name="cd-pick" value="${esc(e.key)}"${line.pick === e.key ? ' checked' : ''}> Usar esta</label>` : '';
      const cur = e.pid === bigPid;
      return `<li class="print${cur ? ' cur' : ''}">
        <a href="${this.link(e.pid)}" aria-label="Ver esta versión">${CardUI.img(e.pid, e.name)}</a>
        <span class="pn"><span>${esc(Prices.variant(e) || 'Común')}${cur ? ' <em>· la que estás viendo</em>' : ''}</span><small>${esc(e.group.name || e.group.abbr)}${e.rarity ? ' · ' + esc(e.rarity) : ''}${e.sub && e.sub !== 'Normal' ? ' · ' + esc(e.sub) : ''}</small></span>
        <span class="pp">${PRICE_ORDER.map(col).join('')}<a href="${Prices.url(e)}" target="_blank" rel="noopener">Ver en TCGplayer</a>${pick}</span>
      </li>`;
    }).join('');
    const autoRow = deck && line ? `<label class="usepick auto"><input type="radio" name="cd-pick" value=""${!line.pick ? ' checked' : ''}> Automática: ${settings.printing === 'base' ? 'la versión común' : 'la más barata'}${auto ? ` (${esc(Prices.variant(auto) || 'Común')}, ${money(Prices.value(auto).v)})` : ''}</label>` : '';

    this.el.innerHTML = `${back}
      <div class="cdetail">
        <div class="cd-img">${CardUI.img(bigPid, name, 400)}</div>
        <div class="card cd-info">
          <div class="rhead"><code>${esc(num)}</code>${c ? CardUI.dots(c.colors) : ''}${shownLabel ? `<span class="vtag">${esc(shownLabel)}</span>` : ''}</div>
          <h1 class="cd-name">${esc(name)}</h1>
          ${facts.length ? `<div class="facts">${facts.map(f => `<span>${esc(f)}</span>`).join('')}</div>` : ''}
          ${c && c.subtypes.length ? `<p class="subt">${c.subtypes.map(esc).join(' · ')}</p>` : ''}
          ${c && c.text ? `<div class="ctext">${CardUI.effect(c.text)}</div>` : ''}
          ${add}
        </div>
      </div>
      <div class="card">
        <h2>Versiones y precios</h2>
        <p class="hint">Tocá una imagen para ver esa versión más grande.</p>
        ${deck && !line ? '<p class="note">Agregala al mazo para elegir qué versión usás.</p>' : ''}
        ${autoRow}
        ${opts.length ? `<ul class="prints">${prints}</ul>` : '<p class="note">TCGplayer no tiene precios para esta carta.</p>'}
      </div>`;
  },
});

/* Cartas: índice con imágenes, filtros y búsqueda, ficha de cada carta y armado de mazos tocando + y −. */
const CardUI = (() => {
  const { esc, money, Prices, Cards } = App;
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
  // texto de efecto con las palabras clave resaltadas
  const effect = t => esc(t).replace(/\[([^\]]{1,40})\]/g, '<span class="kwe">[$1]</span>').replace(/\n/g, '<br>');

  // agrega o saca copias de una carta en un mazo, cuidando el líder y el máximo de 4
  function changeQty(deck, num, delta) {
    num = String(num).toUpperCase();
    const leader = isLeaderCard(num);
    const line = deck.cards.find(c => c.num === num);
    const cur = line ? line.qty : 0;
    let next = Math.max(0, cur + delta);
    if (leader) {
      next = Math.min(1, next);
      if (next === 1 && !line) {
        const old = deck.cards.find(c => c.num !== num && isLeaderCard(c.num));
        if (old) { deck.cards = deck.cards.filter(c => c !== old); App.toast(`Cambiaste el líder por ${Prices.cardName(num) || num}`); }
      }
    } else if (next > 4) { App.toast('Un mazo puede tener hasta 4 copias de cada carta'); next = 4; }
    if (next === cur) return cur;
    if (next === 0) deck.cards = deck.cards.filter(c => c.num !== num);
    else if (line) line.qty = next;
    else if (leader) deck.cards.unshift({ num, qty: 1, pick: null });
    else deck.cards.push({ num, qty: next, pick: null });
    Decks.update(deck);
    return next;
  }
  return { img, dots, effect, basePid, fromPrice, isLeaderCard, changeQty, COLOR_CSS };
})();

/* ---------- índice ---------- */
App.register({
  id: 'cartas', title: 'Cartas', short: 'Cartas', nav: true, tab: true, home: true, icon: App.ICONS.cartas,
  desc: 'Todas las cartas con su imagen y precio. Filtrá por edición, color, tipo o costo y buscá por nombre, tripulación o texto.',
  status() { const n = App.Cards.list.length; return n ? `${n.toLocaleString('es-AR')} cartas` : 'Índice de cartas'; },
  init(el) {
    this.el = el;
    const saved = App.store.get('bitacora-indice-v1', {});
    this.f = { q: '', set: saved.set || '', color: '', type: '', cost: '' };
    this.limit = 60; this.deck = null;
    el.innerHTML = `
      <div class="vhead"><div><h1>Cartas</h1><p id="ci-status"></p></div></div>
      <div id="ci-builder"></div>
      <div class="card filters">
        <label class="sr" for="ci-q">Buscar</label>
        <input class="field big" id="ci-q" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Nombre, número, tripulación o texto">
        <div class="frow">
          <label class="fsel"><span>Edición</span><select class="field" id="ci-set"></select></label>
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
    $('#ci-q').addEventListener('input', e => { this.f.q = e.target.value; this.limit = 60; clearTimeout(timer); timer = setTimeout(() => this.render(), 150); });
    $('#ci-set').addEventListener('change', e => { this.f.set = e.target.value; this.setTouched = true; this.limit = 60; App.store.set('bitacora-indice-v1', { set: this.f.set }); this.render(); });
    $('#ci-type').addEventListener('change', e => { this.f.type = e.target.value; this.limit = 60; this.render(); });
    $('#ci-cost').addEventListener('change', e => { this.f.cost = e.target.value; this.limit = 60; this.render(); });
    el.addEventListener('click', e => {
      const t = e.target;
      const cb = t.closest('.cchip');
      if (cb) { this.f.color = this.f.color === cb.dataset.color ? '' : cb.dataset.color; this.limit = 60; this.render(); return; }
      if (t.closest('#ci-more')) { this.limit += 60; this.render(); return; }
      const q = t.closest('[data-q]');
      if (q && this.deck) {
        const n = CardUI.changeQty(this.deck, q.dataset.num, +q.dataset.q);
        const tile = q.closest('.ctile'); if (tile) { tile.querySelector('.qv').textContent = n; tile.classList.toggle('in', n > 0); }
        this.renderBuilder(); return;
      }
    });
    App.on('cards', () => { if (App.currentId() === 'cartas') this.render(); });
    App.on('prices', () => { if (App.currentId() === 'cartas') this.render(); });
    App.on('settings', () => { if (App.currentId() === 'cartas') this.render(); });
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
      <div><small>Armando</small><b>${App.esc(this.deck.name)}</b><span>${k.main}/50 cartas · Líder: ${App.esc(lname)}</span></div>
      <a class="btn primary" href="#mazo/${encodeURIComponent(this.deck.id)}">Listo</a>
    </div>`;
  },
  // edición elegida o, si no se tocó, la última colección principal
  sets() {
    const C = App.Cards, P = App.Prices;
    const names = new Map();
    P.groups.forEach(g => { const a = String(g.abbr || '').toUpperCase(); if (a && !names.has(a)) names.set(a, g.name); });
    const order = s => { const m = s.match(/^([A-Z]+)(\d*)$/) || [, s, '0']; const rank = { OP: 0, EB: 1, ST: 2, PRB: 3, P: 4 }[m[1]] ?? 5; return [rank, -parseInt(m[2] || '0', 10)]; };
    const list = [...new Set(C.list.map(c => c.set))].sort((a, b) => { const x = order(a), y = order(b); return x[0] - y[0] || x[1] - y[1]; });
    return list.map(s => ({ id: s, label: names.get(s) ? `${s} · ${names.get(s)}` : s }));
  },
  render() {
    const el = this.el, C = App.Cards, P = App.Prices, { esc, money } = App;
    const $ = s => el.querySelector(s);
    const status = C.state === 'ok' ? `${C.list.length.toLocaleString('es-AR')} cartas. ${P.state === 'ok' ? P.statusText() : ''}` : C.state === 'loading' ? 'Cargando el índice…' : C.state === 'missing' ? 'Todavía no están los datos de las cartas: corré la tarea “Publicar app y precios” en GitHub.' : C.state === 'error' ? 'No pude cargar el índice. Revisá tu conexión.' : '';
    $('#ci-status').textContent = status;
    if (C.state !== 'ok') { $('#ci-grid').innerHTML = ''; $('#ci-count').textContent = ''; $('#ci-more').hidden = true; return; }
    const sets = this.sets();
    if (!this.f.set || (this.f.set !== 'todas' && !sets.some(s => s.id === this.f.set))) this.f.set = sets.length ? sets[0].id : 'todas';
    const selSet = $('#ci-set');
    const opts = `<option value="todas">Todas las ediciones</option>` + sets.map(s => `<option value="${esc(s.id)}">${esc(s.label)}</option>`).join('');
    if (selSet.dataset.n !== String(sets.length)) { selSet.innerHTML = opts; selSet.dataset.n = String(sets.length); }
    const q = this.f.q.trim();
    // al buscar, si no elegiste edición a mano, busca en todas
    const set = q && !this.setTouched ? 'todas' : this.f.set;
    selSet.value = set;
    $('#ci-type').value = this.f.type; $('#ci-cost').value = this.f.cost; if ($('#ci-q').value !== this.f.q) $('#ci-q').value = this.f.q;
    el.querySelectorAll('.cchip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.color === this.f.color)));

    const words = C.norm(q).split(' ').filter(Boolean);
    let list = C.list.filter(c =>
      (set === 'todas' || c.set === set) &&
      (!this.f.color || c.colors.includes(this.f.color)) &&
      (!this.f.type || c.type === this.f.type) &&
      (this.f.cost === '' || (this.f.cost === '10' ? (c.cost ?? -1) >= 10 : c.cost === +this.f.cost)) &&
      (!words.length || words.every(w => c.qn.includes(w) || c.qt.includes(w))));
    if (words.length) {
      const inName = c => words.every(w => c.qn.includes(w)) ? 0 : 1;
      list.sort((a, b) => inName(a) - inName(b) || a.num.localeCompare(b.num));
    }
    const total = list.length;
    $('#ci-count').textContent = total ? `${total.toLocaleString('es-AR')} ${total === 1 ? 'carta' : 'cartas'}${set === 'todas' ? ' en todas las ediciones' : ''}` : 'No hay cartas con esos filtros.';
    const deck = this.deck;
    const qtyOf = num => { const l = deck && deck.cards.find(c => c.num === num); return l ? l.qty : 0; };
    $('#ci-grid').innerHTML = list.slice(0, this.limit).map(c => {
      const pr = CardUI.fromPrice(c.num);
      const href = `#carta/${encodeURIComponent(deck ? `${c.num}@${deck.id}` : c.num)}`;
      const n = qtyOf(c.num);
      return `<div class="ctile${n ? ' in' : ''}">
        <a class="cimg" href="${href}" aria-label="${esc(c.name)} ${esc(c.num)}">${CardUI.img(c.pid, c.name)}</a>
        <div class="cmeta"><b>${esc(c.name)}</b><small>${CardUI.dots(c.colors)}${esc(c.num)}${c.cost != null ? ` · ${c.cost}` : ''}</small><span class="cprice">${pr == null ? 'sin precio' : `desde ${money(pr)}`}</span></div>
        ${deck ? `<div class="cqty"><button type="button" data-q="-1" data-num="${esc(c.num)}" aria-label="Sacar una">−</button><span class="qv">${n}</span><button type="button" data-q="1" data-num="${esc(c.num)}" aria-label="Agregar una">+</button></div>` : ''}
      </div>`;
    }).join('');
    $('#ci-more').hidden = total <= this.limit;
  },
});

/* ---------- ficha de una carta ---------- */
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
        const n = CardUI.changeQty(deck, this.num, +q.dataset.q);
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
    const [num, deckId] = String(param || '').split('@');
    this.num = num.toUpperCase();
    this.deck = deckId ? Decks.get(deckId) : null;
    App.Cards.load();
    this.render();
  },
  render() {
    const { esc, money, Prices, Cards, PRICE_LABEL, settings } = App;
    const num = this.num, c = Cards.get(num), deck = this.deck;
    const opts = Prices.options(num);
    const name = (c && c.name) || Prices.cardName(num) || num;
    const back = deck ? `<a class="back" href="#mazo/${encodeURIComponent(deck.id)}">← ${esc(deck.name)}</a>` : `<a class="back" href="#cartas">← Cartas</a>`;
    if (!c && !opts.length) {
      this.el.innerHTML = `${back}<div class="card"><p class="note">${Cards.state === 'loading' || Prices.state === 'loading' ? 'Cargando…' : `No encontré la carta ${esc(num)}.`}</p></div>`;
      return;
    }
    const line = deck && deck.cards.find(l => l.num === num);
    const chosen = deck && line ? Prices.choose(opts, line.pick) : null;
    const bigPid = (chosen && chosen.pid) || CardUI.basePid(num);
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
    const add = deck
      ? `<div class="indeck"><span>En <b>${esc(deck.name)}</b></span>${stepper(qty)}</div>`
      : decks.length
        ? `<div class="indeck"><label class="fsel"><span>Agregar a</span><select class="field" id="cd-deck">${decks.map(d => `<option value="${esc(d.id)}"${d.id === target ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>${stepper(tq)}</div>`
        : `<p class="note">Creá un mazo en la pestaña Mazos para agregar cartas.</p>`;

    const sorted = opts.slice().sort((a, b) => (Prices.value(a).v ?? Infinity) - (Prices.value(b).v ?? Infinity));
    const sel = settings.priceType;
    const auto = deck ? Prices.choose(opts, null) : null;
    const prints = sorted.map(e => {
      const col = k => `<span class="${k === sel ? 'sel' : ''}">${PRICE_LABEL[k]} <b>${money(e[k])}</b></span>`;
      const pick = deck && line ? `<label class="usepick"><input type="radio" name="cd-pick" value="${esc(e.key)}"${line.pick === e.key ? ' checked' : ''}> Usar esta</label>` : '';
      return `<li class="print">
        ${CardUI.img(e.pid, e.name)}
        <span class="pn"><span>${esc(Prices.variant(e) || 'Común')}</span><small>${esc(e.group.name || e.group.abbr)}${e.rarity ? ' · ' + esc(e.rarity) : ''}${e.sub && e.sub !== 'Normal' ? ' · ' + esc(e.sub) : ''}</small></span>
        <span class="pp">${col('market')}${col('low')}${col('mid')}<a href="${Prices.url(e)}" target="_blank" rel="noopener">Ver en TCGplayer</a>${pick}</span>
      </li>`;
    }).join('');
    const autoRow = deck && line ? `<label class="usepick auto"><input type="radio" name="cd-pick" value=""${!line.pick ? ' checked' : ''}> Automática: ${settings.printing === 'base' ? 'la versión común' : 'la más barata'}${auto ? ` (${esc(Prices.variant(auto) || 'Común')}, ${money(Prices.value(auto).v)})` : ''}</label>` : '';

    this.el.innerHTML = `${back}
      <div class="cdetail">
        <div class="cd-img">${CardUI.img(bigPid, name, 400)}</div>
        <div class="card cd-info">
          <div class="rhead"><code>${esc(num)}</code>${c ? CardUI.dots(c.colors) : ''}</div>
          <h1 class="cd-name">${esc(name)}</h1>
          ${facts.length ? `<div class="facts">${facts.map(f => `<span>${esc(f)}</span>`).join('')}</div>` : ''}
          ${c && c.subtypes.length ? `<p class="subt">${c.subtypes.map(esc).join(' · ')}</p>` : ''}
          ${c && c.text ? `<div class="ctext">${CardUI.effect(c.text)}</div>` : ''}
          ${add}
        </div>
      </div>
      <div class="card">
        <h2>Versiones y precios</h2>
        ${deck && !line ? '<p class="note">Agregala al mazo para elegir qué versión usás.</p>' : ''}
        ${autoRow}
        ${opts.length ? `<ul class="prints">${prints}</ul>` : '<p class="note">TCGplayer no tiene precios para esta carta.</p>'}
      </div>`;
  },
});

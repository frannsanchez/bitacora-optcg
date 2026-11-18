/* Buscar carta: todas las versiones de una carta con su precio en TCGplayer. */
App.register({
  id: 'buscar', title: 'Buscar carta', short: 'Buscar', nav: true, tab: true, home: true, icon: App.ICONS.buscar,
  desc: 'Consultá el precio de cualquier carta por número o por nombre, con todas sus versiones.',
  init(el) {
    this.el = el; this.q = '';
    el.innerHTML = `
      <div class="vhead"><div><h1>Buscar carta</h1><p id="bq-status"></p></div></div>
      <div class="card">
        <label class="flabel" for="bq">Número o nombre</label>
        <input class="field big" id="bq" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="OP09-061 o Luffy">
        <p class="hint">Te muestro hasta 30 cartas. Para afinar, sumá palabras: “luffy op09”.</p>
      </div>
      <div class="res" id="bq-res" aria-live="polite"></div>`;
    let timer = null;
    App.$('#bq').addEventListener('input', e => { this.q = e.target.value; clearTimeout(timer); timer = setTimeout(() => this.render(), 150); });
    const again = () => { if (App.currentId() === 'buscar') this.render(); };
    App.on('prices', again); App.on('settings', again);
  },
  show(param) {
    if (param) { this.q = param; App.$('#bq').value = param; }
    this.render();
    if (!param && window.matchMedia('(min-width: 900px)').matches) App.$('#bq').focus();
  },
  render() {
    const { esc, money, Prices, PRICE_LABEL, settings } = App;
    App.$('#bq-status').textContent = Prices.statusText();
    const box = App.$('#bq-res');
    if (Prices.state !== 'ok') { box.innerHTML = Prices.state === 'loading' ? '' : `<div class="banner tone-warn"><span>${esc(Prices.statusText())}</span></div>`; return; }
    const q = this.q.trim();
    if (!q) { box.innerHTML = `<p class="note">Hay ${Prices.count.toLocaleString('es-AR')} versiones de cartas cargadas.</p>`; return; }
    const res = Prices.search(q);
    if (!res.length) { box.innerHTML = `<div class="card"><p class="note">No encontré nada con “${esc(q)}”. Probá con el número completo, por ejemplo OP09-061.</p></div>`; return; }
    const sel = settings.priceType;
    box.innerHTML = res.map(({ num, list }) => {
      const name = Prices.cardName(num) || list[0].name;
      const rar = [...new Set(list.map(e => e.rarity).filter(Boolean))].join(' / ');
      const sorted = list.slice().sort((a, b) => (Prices.value(a).v ?? Infinity) - (Prices.value(b).v ?? Infinity));
      const prints = sorted.map(e => {
        const col = k => `<span class="${k === sel ? 'sel' : ''}">${PRICE_LABEL[k]} <b>${money(e[k])}</b></span>`;
        return `<li class="print">
          <img src="${Prices.img(e)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'noimg'}))">
          <span class="pn"><span>${esc(e.name)}</span><small>${esc(e.group.name || e.group.abbr)}${e.rarity ? ' · ' + esc(e.rarity) : ''}${e.sub && e.sub !== 'Normal' ? ' · ' + esc(e.sub) : ''}</small></span>
          <span class="pp">${col('market')}${col('low')}${col('mid')}<a href="${Prices.url(e)}" target="_blank" rel="noopener">Ver en TCGplayer</a></span>
        </li>`;
      }).join('');
      return `<div class="card rcard"><div class="rhead"><code>${esc(num)}</code><b>${esc(name)}</b><small>${esc(rar)} · ${App.plural(list.length, 'versión', 'versiones')}</small></div><ul class="prints">${prints}</ul></div>`;
    }).join('');
  },
});

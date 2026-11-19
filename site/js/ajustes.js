/* Ajustes: qué precio usar, qué versión de cada carta, estado de los datos y respaldo. */
App.register({
  id: 'ajustes', title: 'Ajustes', short: 'Ajustes', nav: true, home: true, icon: App.ICONS.ajustes,
  desc: 'Qué precio usar, qué versión de cada carta y respaldo de tus mazos.',
  init(el) {
    this.el = el;
    el.addEventListener('click', e => {
      const t = e.target;
      const b = t.closest('.seg button[data-v]');
      if (b) { App.setSetting(b.parentElement.dataset.k, b.dataset.v); this.render(); return; }
      if (t.closest('#aj-reload')) { App.Prices.load(true); return; }
      if (t.closest('#aj-backup')) {
        const data = { app: 'bitacora-optcg', v: 1, fecha: new Date().toISOString(), mazos: Decks.all(), ajustes: App.settings, letal: App.store.get('optcg-letal-v1', null) };
        App.download(`bitacora-respaldo-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2));
        return;
      }
      if (t.closest('#aj-restore')) { App.$('#aj-file').click(); return; }
    });
    el.addEventListener('change', async e => {
      if (e.target.id !== 'aj-file' || !e.target.files[0]) return;
      try {
        const data = JSON.parse(await e.target.files[0].text());
        if (!data || data.app !== 'bitacora-optcg' || !Array.isArray(data.mazos)) throw new Error('formato');
        const before = Decks.all().slice();
        Decks.replaceAll(data.mazos);
        if (data.letal) App.store.set('optcg-letal-v1', data.letal);
        App.toast(`Restauraste ${App.plural(data.mazos.length, 'mazo', 'mazos')}`, 'Deshacer', () => Decks.replaceAll(before));
      } catch (err) {
        App.toast('Ese archivo no es un respaldo de Bitácora');
      }
      e.target.value = '';
    });
    App.on('prices', () => { if (App.currentId() === 'ajustes') this.render(); });
  },
  show() { this.render(); },
  render() {
    const { esc, settings, Prices, fdate } = App;
    const seg = (k, opts) => `<div class="seg" role="radiogroup" data-k="${k}">${opts.map(([v, t]) => `<button type="button" role="radio" data-v="${v}" aria-checked="${settings[k] === v}">${t}</button>`).join('')}</div>`;
    const status = Prices.state === 'ok'
      ? `${Prices.count.toLocaleString('es-AR')} versiones de cartas de ${Prices.groups.size} ediciones. Precios del ${fdate(Prices.updated)}.`
      : Prices.statusText();
    this.el.innerHTML = `
      <div class="vhead"><div><h1>Ajustes</h1><p>Se guardan en este dispositivo.</p></div></div>
      <div class="card">
        <h2>Precio que se usa</h2>
        ${seg('priceType', [['mid', 'Mediana'], ['market', 'Market'], ['low', 'Low']])}
        <ul class="lines">
          <li><span class="d"><b>Mediana</b><small>La mediana de los precios publicados en TCGplayer (“Listed Median” en su página). Es la que se usa si no elegís otra.</small></span></li>
          <li><span class="d"><b>Market</b><small>Lo que se viene pagando en las ventas recientes.</small></span></li>
          <li><span class="d"><b>Low</b><small>La publicación más barata en este momento, sin envío.</small></span></li>
        </ul>
        <p class="note">Si una carta no tiene el precio elegido, se usa el siguiente que tenga y se marca como aproximado.</p>
      </div>
      <div class="card">
        <h2>Versión de cada carta</h2>
        ${seg('printing', [['barata', 'La más barata'], ['base', 'La versión común']])}
        <p class="note">Una misma carta puede tener varias versiones (paralela, manga, reimpresiones). Esto decide cuál se usa cuando no elegiste una a mano dentro del mazo.</p>
      </div>
      <div class="card">
        <h2>Datos de precios</h2>
        <p class="note">${esc(status)}</p>
        <p class="note">Los precios son de TCGplayer en dólares, sin envío, y llegan a través de TCGCSV. Se actualizan solos una vez por día.</p>
        <div class="vact"><button type="button" class="btn" id="aj-reload">Buscar precios nuevos</button></div>
      </div>
      <div class="card">
        <h2>Respaldo</h2>
        <p class="note">Tus mazos se guardan solo en este dispositivo. Descargá un respaldo para pasarlos a otro celular o a la PC.</p>
        <div class="vact">
          <button type="button" class="btn" id="aj-backup">Descargar respaldo</button>
          <button type="button" class="btn ghost" id="aj-restore">Restaurar respaldo</button>
          <input type="file" id="aj-file" accept="application/json,.json" hidden>
        </div>
      </div>
      <p class="note app-version">Versión ${App.VERSION} de la app. Se actualiza sola cuando hay una nueva.</p>`;
  },
});

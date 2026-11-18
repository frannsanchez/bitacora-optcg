/* Calculadora de letal: misma lógica que la versión suelta, como herramienta de la app. */
function initLetal(view) {
  const KEY = 'optcg-letal-v1';
  const ROLE = { amenaza: 'Amenaza', motor: 'Motor', blocker: 'Blocker', otro: 'Otro' };
  const ROLE_HINT = { amenaza: 'Te pega fuerte el turno que viene', motor: 'Le da cartas, DON!! o remoción cada turno', blocker: 'Bloqueó y se va a reactivar', otro: 'No te preocupa mucho' };
  const TONE = { seguro: 'ok', casi: 'ok', probable: 'good', riesgo: 'warn', no: 'bad', sobra: 'bad', sinalcance: 'bad', sinatacantes: 'bad' };
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pl = (n, a, b) => (n === 1 ? a : b);
  const num = (v, d) => (Number.isFinite(+v) ? +v : d);
  let seq = 0;
  const uid = () => 'i' + Date.now().toString(36) + (seq++).toString(36);
  const LV = l => (Engine.LEVELS[l] || Engine.LEVELS[0]).label;
  const LVT = l => TONE[(Engine.LEVELS[l] || Engine.LEVELS[0]).code] || 'bad';

  const atk = (name, power, extra = {}) => ({ id: uid(), name, power, buff: 0, canAttack: true, da: false, ub: false, ban: false, isLeader: false, ...extra });
  function example() {
    return {
      v: 1,
      opp: { life: 2, leaderPower: 5000, hand: 3, don: 0, blockers: 1, profile: 'normal', events: 1, eventValue: 3000, eventCost: 1, leaderFx: false, leaderFxValue: 4000, leaderFxDiscard: true, triggers: 'algunos' },
      me: {
        attackers: [atk('Líder', 5000, { buff: 6000, isLeader: true }), atk('Personaje 1', 6000), atk('Personaje 2', 5000), atk('Personaje 3', 5000)],
        freeDon: 5, removeBlockers: 1, oppThreat: 'quizas', betterNext: false,
      },
      board: [{ id: uid(), name: 'Personaje rival', power: 7000, role: 'amenaza' }],
    };
  }
  function blank() {
    return {
      v: 1,
      opp: { life: 4, leaderPower: 5000, hand: 5, don: 0, blockers: 0, profile: 'normal', events: 0, eventValue: 3000, eventCost: 1, leaderFx: false, leaderFxValue: 4000, leaderFxDiscard: true, triggers: 'algunos' },
      me: { attackers: [atk('Líder', 5000, { isLeader: true })], freeDon: 0, removeBlockers: 0, oppThreat: 'quizas', betterNext: false },
      board: [],
    };
  }
  function norm(s) {
    const b = blank();
    const out = { v: 1, opp: { ...b.opp, ...(s.opp || {}) }, me: { ...b.me, ...(s.me || {}) }, board: [] };
    out.me.attackers = Array.isArray(s.me && s.me.attackers)
      ? s.me.attackers.map(a => ({ id: a.id || uid(), name: String(a.name ?? 'Personaje'), power: num(a.power, 5000), buff: num(a.buff, 0), canAttack: a.canAttack !== false, da: !!a.da, ub: !!a.ub, ban: !!a.ban, isLeader: !!a.isLeader }))
      : b.me.attackers;
    out.board = (Array.isArray(s.board) ? s.board : []).map(c => ({ id: c.id || uid(), name: String(c.name ?? 'Personaje rival'), power: num(c.power, 5000), role: ROLE[c.role] ? c.role : 'otro' }));
    return out;
  }
  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) return norm(JSON.parse(raw)); } catch (e) { /* sin almacenamiento */ }
    return null;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* sin almacenamiento */ } }

  let state;
  const get = path => path.split('.').reduce((o, k) => (o == null ? o : o[k]), state);
  const set = (path, v) => { const ks = path.split('.'); const last = ks.pop(); ks.reduce((o, k) => o[k], state)[last] = v; };

  // ---------- campos ----------
  function stepperHTML(path, id, min, max, step, label) {
    return `<div class="stepper sm" data-path="${path}" data-min="${min}" data-max="${max}" data-step="${step}"><button type="button" data-d="-1" aria-label="Restar">−</button><input id="${id}" inputmode="numeric" autocomplete="off" aria-label="${esc(label)}"><button type="button" data-d="1" aria-label="Sumar">+</button></div>`;
  }
  const chipHTML = (path, text) => `<button type="button" class="chip" data-path="${path}" aria-pressed="false">${text}</button>`;

  function renderAttackers() {
    const list = state.me.attackers;
    $('#atk-list').innerHTML = list.map((a, i) => `
      <div class="atk${a.canAttack ? '' : ' off'}">
        <div class="atk-head">
          <input class="name" id="atk-${a.id}-name" data-path="me.attackers.${i}.name" maxlength="24" aria-label="Nombre" value="${esc(a.name)}">
          ${a.isLeader ? '<span class="tag">Líder</span>' : ''}
          <button type="button" class="del" data-del="atk" data-i="${i}" aria-label="Quitar ${esc(a.name)}">×</button>
        </div>
        <div class="pair">
          <div class="mini"><span>Poder</span>${stepperHTML(`me.attackers.${i}.power`, `atk-${a.id}-power`, 0, 20000, 1000, `Poder de ${a.name}`)}</div>
          <div class="mini"><span>Buff</span>${stepperHTML(`me.attackers.${i}.buff`, `atk-${a.id}-buff`, 0, 15000, 1000, `Buff de ${a.name}`)}</div>
        </div>
        <div class="chips">
          ${chipHTML(`me.attackers.${i}.canAttack`, 'Puede atacar')}
          ${chipHTML(`me.attackers.${i}.da`, 'Doble ataque')}
          ${chipHTML(`me.attackers.${i}.ub`, 'No se puede bloquear')}
          ${chipHTML(`me.attackers.${i}.ban`, 'Banish')}
        </div>
      </div>`).join('');
    $('#add-atk').disabled = list.filter(a => !a.isLeader).length >= 5;
    $('#add-atk').textContent = $('#add-atk').disabled ? 'Ya tenés 5 personajes' : '+ Agregar personaje';
    $('#add-leader').hidden = list.some(a => a.isLeader);
    sync($('#atk-list'));
  }

  function renderBoard() {
    $('#board-list').innerHTML = state.board.map((c, i) => `
      <div class="opp-ch">
        <div class="atk-head">
          <input class="name" id="brd-${c.id}-name" data-path="board.${i}.name" maxlength="24" aria-label="Nombre" value="${esc(c.name)}">
          <button type="button" class="del" data-del="board" data-i="${i}" aria-label="Quitar ${esc(c.name)}">×</button>
        </div>
        <div class="pair"><div class="mini"><span>Poder</span>${stepperHTML(`board.${i}.power`, `brd-${c.id}-power`, 0, 15000, 1000, `Poder de ${c.name}`)}</div></div>
        <div class="seg" role="radiogroup" aria-label="Qué es" data-path="board.${i}.role">
          ${Object.keys(ROLE).map(k => `<button type="button" role="radio" data-v="${k}" title="${ROLE_HINT[k]}">${ROLE[k]}</button>`).join('')}
        </div>
      </div>`).join('');
    sync($('#board-list'));
  }

  function sync(root = document) {
    root.querySelectorAll('.stepper[data-path]').forEach(st => {
      const inp = st.querySelector('input');
      if (document.activeElement !== inp) inp.value = get(st.dataset.path);
    });
    root.querySelectorAll('.seg[data-path]').forEach(sg => {
      const v = String(get(sg.dataset.path));
      sg.querySelectorAll('button[data-v]').forEach(b => {
        const on = b.dataset.v === v;
        b.setAttribute('aria-checked', on ? 'true' : 'false');
        b.tabIndex = on ? 0 : -1;
      });
      if (!sg.querySelector('[aria-checked="true"]')) { const f = sg.querySelector('button'); if (f) f.tabIndex = 0; }
    });
    root.querySelectorAll('input[type="checkbox"][data-path]').forEach(c => { c.checked = !!get(c.dataset.path); });
    root.querySelectorAll('.chip[data-path]').forEach(c => c.setAttribute('aria-pressed', get(c.dataset.path) ? 'true' : 'false'));
    root.querySelectorAll('input.name[data-path]').forEach(n => { if (document.activeElement !== n) n.value = get(n.dataset.path); });
    view.querySelectorAll('[data-show="events"]').forEach(e => { e.hidden = !(state.opp.events > 0); });
    view.querySelectorAll('[data-show="lfx"]').forEach(e => { e.hidden = !state.opp.leaderFx; });
  }

  function renderAll() { renderAttackers(); renderBoard(); sync(view); }

  const clamp = (v, st) => Math.min(+st.dataset.max, Math.max(+st.dataset.min, v));

  view.addEventListener('click', e => {
    const t = e.target;
    const sb = t.closest('.stepper button[data-d]');
    if (sb) {
      const st = sb.closest('.stepper');
      const step = +st.dataset.step;
      const cur = num(get(st.dataset.path), 0);
      const v = clamp(Math.round(cur / step) * step + (+sb.dataset.d) * step, st);
      set(st.dataset.path, v);
      st.querySelector('input').value = v;
      changed(st.dataset.path);
      return;
    }
    const sgb = t.closest('.seg button[data-v]');
    if (sgb) {
      const sg = sgb.closest('.seg');
      set(sg.dataset.path, sg.dataset.num ? +sgb.dataset.v : sgb.dataset.v);
      sync(sg.parentElement);
      changed(sg.dataset.path);
      return;
    }
    const ch = t.closest('.chip[data-path]');
    if (ch) {
      const v = !get(ch.dataset.path);
      set(ch.dataset.path, v);
      ch.setAttribute('aria-pressed', v ? 'true' : 'false');
      if (ch.dataset.path.endsWith('canAttack')) ch.closest('.atk').classList.toggle('off', !v);
      changed(ch.dataset.path);
      return;
    }
    const del = t.closest('[data-del]');
    if (del) {
      const i = +del.dataset.i;
      if (del.dataset.del === 'atk') { state.me.attackers.splice(i, 1); renderAttackers(); }
      else { state.board.splice(i, 1); renderBoard(); }
      changed();
      return;
    }
    if (t.closest('#add-atk')) {
      const n = state.me.attackers.filter(a => !a.isLeader).length + 1;
      state.me.attackers.push(atk(`Personaje ${n}`, 5000));
      renderAttackers(); changed(); return;
    }
    if (t.closest('#add-leader')) {
      state.me.attackers.unshift(atk('Líder', 5000, { isLeader: true }));
      renderAttackers(); changed(); return;
    }
    if (t.closest('#add-board')) {
      state.board.push({ id: uid(), name: `Personaje rival ${state.board.length + 1}`, power: 5000, role: 'amenaza' });
      renderBoard(); changed(); return;
    }
    if (t.closest('#btn-example')) { replace(example(), 'Cargué el ejemplo.'); return; }
    if (t.closest('#btn-reset')) { replace(blank(), 'Empezaste de cero.'); return; }
    if (t.closest('#dock-btn')) {
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      $('#resultado').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
      return;
    }
  });

  // flechas en los grupos de opciones
  view.addEventListener('keydown', e => {
    const b = e.target.closest && e.target.closest('.seg button[data-v]');
    if (!b || !['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const all = [...b.parentElement.querySelectorAll('button[data-v]')];
    const k = all.indexOf(b) + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1);
    const nb = all[(k + all.length) % all.length];
    nb.focus(); nb.click();
  });

  view.addEventListener('input', e => {
    const t = e.target;
    if (t.matches('.stepper input')) {
      const st = t.closest('.stepper');
      const digits = t.value.replace(/\D/g, '');
      if (digits !== t.value) t.value = digits;
      if (digits === '') return;
      set(st.dataset.path, Math.min(+st.dataset.max, +digits));
      changed(st.dataset.path);
    } else if (t.matches('input.name[data-path]')) {
      set(t.dataset.path, t.value);
      changed(t.dataset.path, true);
    }
  });
  view.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('input[type="checkbox"][data-path]')) { set(t.dataset.path, t.checked); sync(view); changed(t.dataset.path); }
  });
  view.addEventListener('focusout', e => {
    const t = e.target;
    if (t.matches && t.matches('.stepper input')) {
      const st = t.closest('.stepper');
      const step = +st.dataset.step;
      const v = clamp(Math.round(num(get(st.dataset.path), 0) / step) * step, st);
      set(st.dataset.path, v); t.value = v; changed(st.dataset.path);
    }
  });
  view.addEventListener('focusin', e => { if (e.target.matches && e.target.matches('.stepper input')) setTimeout(() => e.target.select(), 0); });

  function replace(next, msg) {
    const prev = JSON.parse(JSON.stringify(state));
    state = next; renderAll(); changed();
    App.toast(msg, 'Deshacer', () => { state = prev; renderAll(); changed(); });
  }

  // ---------- cálculo ----------
  let worker = null, reqId = 0, timer = null, watchdog = null;
  function makeWorker() {
    try {
      const w = new Worker('js/letal-worker.js');
      w.onmessage = e => {
        if (e.data.id !== reqId) return;
        clearTimeout(watchdog);
        if (e.data.error) showError(e.data.error); else render(e.data.out);
      };
      w.onerror = ev => { if (ev && ev.preventDefault) ev.preventDefault(); worker = null; clearTimeout(watchdog); runLocal(); };
      return w;
    } catch (err) { return null; }
  }
  function changed(path, quiet) {
    save();
    if (!quiet || path) { $('#dock-in').classList.add('busy'); clearTimeout(timer); timer = setTimeout(run, 160); }
  }
  function run() {
    reqId++;
    const payload = JSON.parse(JSON.stringify(state));
    if (worker) {
      worker.postMessage({ id: reqId, state: payload });
      clearTimeout(watchdog);
      const mine = reqId;
      watchdog = setTimeout(() => { if (mine === reqId && worker) { worker.terminate(); worker = null; runLocal(payload); } }, 6000);
    } else runLocal(payload);
  }
  function runLocal(payload) {
    try { render(Engine.analyze(payload || JSON.parse(JSON.stringify(state)))); } catch (err) { showError(String(err && err.message || err)); }
  }
  function showError(msg) {
    $('#dock-in').classList.remove('busy');
    $('#res-body').innerHTML = `<p class="note">No pude calcular esta situación (${esc(msg)}). Revisá los números cargados.</p>`;
  }

  // ---------- resultado ----------
  function render(out) {
    const s = state;
    $('#dock-in').classList.remove('busy');
    const code = out.info.code;
    const tone = TONE[code] || 'bad';
    const t = out.trigger;
    const fromLife = t ? t.k : 0;
    let sub, dsub;
    if (code === 'sinatacantes') { sub = 'Marcá al menos un atacante que pueda atacar este turno.'; dsub = 'Cargá tus atacantes'; }
    else if (code === 'sinalcance') { sub = `Ningún ataque llega a los ${out.L} de su líder.`; dsub = 'Ningún ataque llega'; }
    else if (code === 'sobra') { sub = 'Le alcanza con vidas y blockers: no necesita gastar cartas.'; dsub = 'Le alcanzan vidas y blockers'; }
    else {
      sub = `Con mano perfecta necesita ${out.need} ${pl(out.need, 'carta', 'cartas')} de counter y tiene ${out.have}${fromLife ? `, más hasta ${fromLife} que saca de la vida` : ''}.`;
      dsub = `Necesita ${out.need} · tiene ${out.have}${fromLife ? ` +${fromLife} vida` : ''}`;
    }

    // barra fija
    const di = $('#dock-in');
    di.className = `dock-in tone-${tone}`;
    $('#dock-lab').textContent = out.info.label;
    $('#dock-sub').textContent = dsub;

    let h = `<div class="verdict tone-${tone}"><div class="v-label">${esc(out.info.label)}</div><div class="v-sub">${esc(sub)}</div></div>`;
    h += `<div class="advice"><strong>${esc(out.advice.title)}</strong><span>${esc(out.advice.text)}</span></div>`;

    // plan de ataque
    if (out.rows && out.rows.length) {
      const removed = Math.min(s.me.removeBlockers, s.opp.blockers);
      let li = '';
      if (removed > 0) li += `<li class="pre"><span class="ord">0</span><div><div class="who">Antes de atacar</div><div class="math">Sacale ${removed} blocker${removed > 1 ? 's' : ''} en tu fase principal.</div></div></li>`;
      out.order.forEach((i, n) => {
        const r = out.rows[i];
        const kws = [r.da && 'Doble', r.ub && 'Imbloqueable', r.ban && 'Banish'].filter(Boolean).map(k => `<span class="kw">${k}</span>`).join(' ');
        const math = r.don ? `${r.base} <span class="don">+${r.don} DON!!</span> = <b>${r.p}</b>` : `<b>${r.p}</b>`;
        const ask = r.connects
          ? `<div class="ask"><b>pide ${r.r}</b>mín. ${r.minCards} ${pl(r.minCards, 'carta', 'cartas')}</div>`
          : `<div class="ask miss"><b>no llega</b>faltan ${r.needForHit} DON!!</div>`;
        li += `<li><span class="ord">${n + 1}</span><div><div class="who">${esc(r.name)} ${kws}</div><div class="math">${math}</div></div>${ask}</li>`;
      });
      const notes = [];
      if (s.me.freeDon > 0) notes.push('Dale los DON!! a cada uno justo antes de su ataque: si el rival gasta de más, reacomodá los que quedan.');
      if (out.res.Beff > 0) notes.push(`Le ${out.res.Beff > 1 ? 'quedan' : 'queda'} ${out.res.Beff} blocker${out.res.Beff > 1 ? 's' : ''}: va a bloquear tu ataque más grande que pueda bloquear.`);
      h += `<div class="block"><h3>Orden y reparto de DON!!</h3><ol class="plan">${li}</ol>${notes.map(x => `<p class="note">${esc(x)}</p>`).join('')}</div>`;
    }

    // cómo se defiende
    if (out.defense && out.defense.length) {
      const li = out.defense.map(d => {
        const r = d.row;
        let what;
        if (d.act === 'take') what = `Se lo come (−${r.da ? 2 : 1} ${r.da ? 'vidas' : 'vida'})`;
        else if (d.act === 'block') what = 'Lo bloquea';
        else {
          const parts = [];
          if (d.eu) parts.push(`${d.eu} evento${d.eu > 1 ? 's' : ''}`);
          if (d.lu) parts.push('efecto del líder');
          if (d.twos) parts.push(`${d.twos} de 2000`);
          what = `Lo frena con ${parts.join(' + ')}`;
        }
        return `<li><div class="d"><b>${esc(r.name)}</b><small>${r.p} · pide ${r.r}</small></div><span>${esc(what)}</span></li>`;
      }).join('');
      h += `<div class="block"><h3>Cómo se defendería</h3><ul class="lines">${li}</ul><p class="note">Su mejor defensa con todas cartas de 2000, sin contar lo que saca de la vida.</p></div>`;
    }

    // escenarios
    if (out.scen && out.scen.length) {
      const li = out.scen.map(x => `<li><div class="d"><b>${x.name}</b><small>${esc(x.desc)}</small></div><span class="pill tone-${x.dies ? 'ok' : 'bad'}">${x.dies ? 'Muere' : 'Zafa'}</span></li>`).join('');
      h += `<div class="block"><h3>Según lo que tenga en la mano</h3><ul class="lines">${li}</ul><p class="note">Lo que saca de la vida solo le sirve para los ataques que vienen después.</p></div>`;
    }

    // riesgos
    const risks = [];
    if (t && t.f > 0 && t.k > 0 && out.rows) {
      risks.push(`Va a dar vuelta hasta ${t.k} ${pl(t.k, 'carta', 'cartas')} de vida: ~${Math.round(t.p * 100)}% de que salga un trigger que te complique.`);
      if (out.ifBlocker !== undefined) risks.push(`Si un trigger le pone un blocker: <b>${LV(out.ifBlocker)}</b>.`);
      if (out.ifKO) risks.push(`Si un trigger te saca a ${esc(out.ifKO.name)}: <b>${LV(out.ifKO.level)}</b>.`);
      if (out.rows.some(r => r.connects && !r.ban)) risks.push('Los ataques con Banish no dan vuelta triggers ni le dan cartas.');
    }
    const scn = out.res && out.res.scn;
    if (scn && s.opp.events > 0) risks.push(scn.ne > 0 ? `Con sus DON!! activos puede pagar ${scn.ne} evento${scn.ne > 1 ? 's' : ''} de +${s.opp.eventValue}.` : 'No le alcanzan los DON!! activos para pagar eventos de counter.');
    if (s.opp.leaderFx) risks.push(`Su líder suma +${s.opp.leaderFxValue} una vez en tu turno${s.opp.leaderFxDiscard ? ', descartando 1 carta' : ''}.`);
    if (risks.length) h += `<div class="block"><h3>Riesgos y detalles</h3><ul class="bul">${risks.map(x => `<li>${x}</li>`).join('')}</ul></div>`;

    // qué cambiaría
    if (out.whatIf && out.level <= 3 && out.rows) {
      if (out.whatIf.length) {
        const li = out.whatIf.map(w => `<li><span>${esc(w.text)}</span><span class="pill tone-${LVT(w.level)}">${LV(w.level)}</span></li>`).join('');
        h += `<div class="block"><h3>Qué cambiaría el resultado</h3><ul class="lines">${li}</ul></div>`;
      } else {
        h += `<div class="block"><h3>Qué cambiaría el resultado</h3><p class="note">Ni sacarle otro blocker, ni 2 DON!! más, ni un atacante extra alcanzan solos. Probablemente necesitás un turno más de daño.</p></div>`;
      }
    }

    // su mesa
    if (s.board.length && out.targets) {
      const li = out.targets.map(x => {
        const c = x.t;
        const act = x.pick
          ? `Atacalo con ${esc(x.pick.a.name)}${x.pick.don ? ` + ${x.pick.don} DON!!` : ''} (${x.pick.p}). Para salvarlo gasta ${x.save}.`
          : `Ninguno de tus atacantes llega a ${c.power} con los DON!! que tenés.`;
        return `<li style="flex-direction:column"><div class="d"><b>${esc(c.name)} · ${c.power}</b><small>${ROLE[c.role]}: ${ROLE_HINT[c.role].toLowerCase()}</small></div><span>${act}</span></li>`;
      }).join('');
      const rest = out.leftForLeader.map(a => esc(a.name));
      const extra = [];
      if (rest.length) extra.push(`El resto va al líder: ${rest.join(', ')}.`);
      if (out.cardsGiven > 0) extra.push(`Si vas por la vida y no lo matás, le das hasta ${out.cardsGiven} ${pl(out.cardsGiven, 'carta', 'cartas')}.`);
      if (out.level >= 3) extra.push('Tenés letal: esto es por si preferís no arriesgar.');
      h += `<div class="block"><h3>Si no vas por el letal: su mesa</h3><ul class="lines">${li}</ul>${extra.map(x => `<p class="note">${x}</p>`).join('')}</div>`;
    } else if (out.level <= 1) {
      h += `<div class="block"><h3>Su mesa</h3><p class="note">Cargá sus personajes descansados en el paso 3 y te digo a cuál conviene pegarle.</p></div>`;
    }

    h += `<details><summary>Cómo calcula</summary>
      <p>Un ataque entra si su poder es igual o mayor que el del defensor. Para frenarlo, el rival necesita (tu poder − su poder) + 1000 de counter.</p>
      <p>Prueba todos los repartos de tus DON!! libres y se queda con el que más le cuesta frenar. El rival elige su mejor defensa: se come golpes mientras le alcance la vida, bloquea con lo que tenga y frena el resto con counters, eventos y el efecto de su líder.</p>
      <p>Atacás en el orden de la lista: personajes de menor a mayor y el líder al final. Lo que saca de la vida solo le sirve para los ataques que vienen después, por eso conviene empezar por los ataques chicos.</p>
      <p>Probable: con una mano normal no llega. Casi seguro: ni con todas cartas de 2000. Seguro: ni siquiera si lo que saca de la vida también es de 2000. Los triggers no entran en el veredicto: aparecen aparte como riesgo.</p>
    </details>`;

    $('#res-body').innerHTML = h;
  }

  // ---------- arranque ----------
  state = load() || example();
  renderAll();
  worker = makeWorker();
  run();
}

App.register({
  id: 'letal', title: 'Calculadora de letal', short: 'Letal', nav: true, tab: true, home: true, icon: App.ICONS.letal,
  desc: 'Cargá la mesa y te dice si llegás, cómo repartir los DON!! y en qué orden atacar.',
  init(el) { initLetal(el); },
});

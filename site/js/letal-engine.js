/* Motor de cálculo de letal — One Piece TCG
   Regla base: el ataque gana si poder atacante >= poder defensor.
   Counter para frenarlo = (atacante − defensor) + 1000. */
const Engine = (() => {
  // reparto de la mano en el escenario "mano normal": [fracción de 2000, fracción de 1000]; el resto vale 0
  const PROFILES = { fuerte: [0.5, 0.4], normal: [0.3, 0.5], debil: [0.15, 0.5] };
  // probabilidad aproximada de que una carta de vida sea un trigger que te complique
  const TRIG = { ninguno: 0, pocos: 0.1, algunos: 0.2, muchos: 0.35 };
  const LEVELS = {
    5: { code: 'seguro', label: 'Letal seguro', tone: 'ok' },
    4: { code: 'casi', label: 'Letal casi seguro', tone: 'ok' },
    3: { code: 'probable', label: 'Letal probable', tone: 'good' },
    2: { code: 'riesgo', label: 'Letal arriesgado', tone: 'warn' },
    1: { code: 'no', label: 'No hay letal', tone: 'bad' },
    0: { code: 'sobra', label: 'No hay letal', tone: 'bad' },
  };

  const ceilK = (x, v) => (x > 0 ? Math.ceil(x / v) : 0);

  function connecting(atks, L) {
    const out = [];
    atks.forEach((a, k) => {
      if (a.p >= L) out.push({ ...a, k, r: a.p - L + 1000, dmg: a.da ? 2 : 1 });
    });
    return out;
  }

  /* Defensa con cartas de valor fijo v (2000 ó 1000).
     Devuelve el mínimo de cartas netas que necesita para sobrevivir y el plan. */
  function defendH(list, V, B, sc) {
    const n = list.length, memo = new Map();
    const NE = sc.ne, E = sc.E, LF = sc.lf ? 1 : 0, Y = sc.Y, disc = sc.disc ? 1 : 0, v = sc.v, gain = !!sc.gain;
    const key = (i, b, d, e, l) => (((i * 12 + b) * 24 + d) * 8 + e) * 2 + l;
    function go(i, b, d, e, l) {
      if (i === n) return { c: 0 };
      const kk = key(i, b, d, e, l);
      const m = memo.get(kk);
      if (m) return m;
      const a = list[i];
      let best = { c: Infinity };
      if (d + a.dmg <= V) {
        const g = gain && !a.ban ? a.dmg : 0;
        const c = go(i + 1, b, d + a.dmg, e, l).c - g;
        if (c < best.c) best = { c, act: 'take', g, nb: b, nd: d + a.dmg, ne: e, nl: l };
      }
      if (!a.ub && b < B) {
        const c = go(i + 1, b + 1, d, e, l).c;
        if (c < best.c) best = { c, act: 'block', nb: b + 1, nd: d, ne: e, nl: l };
      }
      for (let eu = 0; e + eu <= NE; eu++) {
        for (let lu = 0; l + lu <= LF; lu++) {
          const rem = a.r - eu * E - lu * Y;
          const twos = ceilK(rem, v);
          const cards = eu + lu * disc + twos;
          const c = cards + go(i + 1, b, d, e + eu, l + lu).c;
          if (c < best.c) best = { c, act: 'counter', eu, lu, cards, twos, nb: b, nd: d, ne: e + eu, nl: l + lu };
          if (rem <= 0) break;
        }
        if (a.r - eu * E <= 0) break;
      }
      memo.set(kk, best);
      return best;
    }
    const root = go(0, 0, 0, 0, 0);
    const plan = [];
    let b = 0, d = 0, e = 0, l = 0;
    for (let i = 0; i < n; i++) {
      const s = go(i, b, d, e, l);
      plan.push({ k: list[i].k, r: list[i].r, act: s.act, eu: s.eu || 0, lu: s.lu || 0, cards: s.cards || 0, twos: s.twos || 0, g: s.g || 0 });
      b = s.nb; d = s.nd; e = s.ne; l = s.nl;
    }
    return { c: root.c, plan };
  }

  /* Defensa en orden: los ataques llegan en el orden recomendado y lo que saca de la vida
     solo le sirve para los ataques que vienen después. Mano: n2 cartas de 2000, n1 de 1000, n0 sin counter.
     Devuelve true si tiene alguna forma de sobrevivir. */
  function defendSeq(list, V, B, sc) {
    const n2 = sc.n2, n1 = sc.n1, n0 = sc.n0 || 0, NE = sc.ne, E = sc.E, Y = sc.Y;
    const LF = sc.lf ? 1 : 0, disc = !!sc.disc, gainTwo = sc.gain === 'two';
    const enc = (b, d, e, l, t) => (((b * 24 + d) * 8 + e) * 2 + l) * 64 + (t + 32);
    let cur = new Map([[enc(0, 0, 0, 0, 0), 0]]);
    for (const a of list) {
      const nxt = new Map();
      const put = (b, d, e, l, t, o) => {
        if (t > n2 || o > n1) return;
        const k = enc(b, d, e, l, t), p = nxt.get(k);
        if (p === undefined || o < p) nxt.set(k, o);
      };
      for (const [k, o] of cur) {
        let x = k;
        const t = (x % 64) - 32; x = (x - (x % 64)) / 64;
        const l = x % 2; x = (x - l) / 2;
        const e = x % 8; x = (x - e) / 8;
        const d = x % 24; const b = (x - d) / 24;
        if (d + a.dmg <= V) {
          const g = a.ban ? 0 : a.dmg;
          if (gainTwo) put(b, d + a.dmg, e, l, t - g, o); else put(b, d + a.dmg, e, l, t, o - g);
        }
        if (!a.ub && b < B) put(b + 1, d, e, l, t, o);
        for (let eu = 0; e + eu <= NE; eu++) {
          for (let lu = 0; l + lu <= LF; lu++) {
            const rem = a.r - eu * E - lu * Y;
            const dopts = lu && disc ? (n0 > 0 ? [[0, 0]] : [[0, 1], [1, 0]]) : [[0, 0]];
            const maxA = ceilK(rem, 2000);
            for (const [dt, dO] of dopts) {
              for (let a2 = 0; a2 <= maxA; a2++) put(b, d, e + eu, l + lu, t + a2 + dt, o + ceilK(rem - 2000 * a2, 1000) + dO);
            }
            if (rem <= 0) break;
          }
          if (a.r - eu * E <= 0) break;
        }
      }
      if (!nxt.size) return false;
      cur = nxt;
    }
    return true;
  }

  // orden recomendado: personajes de menor a mayor poder, el líder al final
  function attackOrder(atks) {
    return atks.map((a, i) => i).sort((x, y) => {
      const A = atks[x], Bb = atks[y];
      if (!!A.isLeader !== !!Bb.isLeader) return A.isLeader ? 1 : -1;
      return A.p - Bb.p;
    });
  }

  function buildScenarios(opp, B) {
    const H = Math.max(0, opp.hand);
    let ne = opp.events;
    if (opp.eventCost > 0) ne = Math.min(ne, Math.floor(opp.don / opp.eventCost));
    ne = Math.max(0, Math.min(ne, H));
    const lf = !!opp.leaderFx && (!opp.leaderFxDiscard || H > 0);
    const Y = opp.leaderFxValue, disc = !!opp.leaderFxDiscard, E = opp.eventValue;
    const [f2, f1] = PROFILES[opp.profile] || PROFILES.normal;
    const Hc = H - ne;
    const n2 = Math.round(Hc * f2);
    const n1 = Math.min(Hc - n2, Math.round(Hc * f1));
    const n0 = Hc - n2 - n1;
    return {
      H, ne, B, n2, n1, n0, lf, E, Y, disc,
      // versiones rápidas (sin orden) para comparar repartos
      H1: { v: 2000, ne, E, lf, Y, disc, gain: true },
      H2: { v: 2000, ne, E, lf, Y, disc, gain: false },
      H4: { v: 1000, ne: 0, E, lf, Y, disc, gain: true },
      // S1 peor caso: todo de 2000 y lo que saca de la vida también vale 2000
      S1: { n2: Hc, n1: 0, n0: 0, ne, E, lf, Y, disc, gain: 'two' },
      // S2 mano perfecta: todo de 2000; lo que saca de la vida vale 1000 (no sabe qué le toca)
      S2: { n2: Hc, n1: 0, n0: 0, ne, E, lf, Y, disc, gain: 'one' },
      // S3 mano normal: mezcla según el perfil; la vida vale 1000
      S3: { n2, n1, n0, ne, E, lf, Y, disc, gain: 'one' },
      // S4 mano floja: todo de 1000, sin eventos; la vida vale 1000
      S4: { n2: 0, n1: H, n0: 0, ne: 0, E, lf, Y, disc, gain: 'one' },
    };
  }

  function evaluate(atks, opp, scn, full = true) {
    const L = opp.leaderPower, V = Math.max(0, opp.life), B = scn.B, H = scn.H;
    const ordered = attackOrder(atks).map(i => atks[i]);
    const list = connecting(ordered, L);
    if (!list.length) return { level: 0, code: 'sinalcance', list, H };
    const h1 = defendH(list, V, B, scn.H1);
    const h2 = defendH(list, V, B, scn.H2);
    const h4 = defendH(list, V, B, scn.H4);
    const ev = { list, h1, h2, h4, H, dies: null };
    if (h2.c <= 0) { ev.level = 0; ev.code = 'sobra'; return ev; }
    if (!full) {
      ev.level = h1.c > H ? 5 : h4.c > H ? 2 : 1;
    } else {
      const dies = {};
      dies.S1 = h1.c > H || !defendSeq(list, V, B, scn.S1);
      dies.S2 = dies.S1 && h1.c > H ? true : !defendSeq(list, V, B, scn.S2);
      dies.S3 = dies.S2 || !defendSeq(list, V, B, scn.S3);
      dies.S4 = !defendSeq(list, V, B, scn.S4);
      ev.dies = dies;
      ev.level = dies.S1 ? 5 : dies.S2 ? 4 : dies.S3 ? 3 : dies.S4 ? 2 : 1;
    }
    ev.code = LEVELS[ev.level].code;
    return ev;
  }

  const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

  function keyOf(ev, atks, dist, leaderIdx) {
    const ps = atks.map(a => a.p);
    const minP = ps.length ? Math.min(...ps) : 0, maxP = ps.length ? Math.max(...ps) : 0;
    const onLeader = leaderIdx >= 0 ? dist[leaderIdx] : 0;
    const lvl = ev.code === 'sinalcance' ? -1 : ev.level;
    return [lvl, ev.h2 ? ev.h2.c : 0, ev.h1 ? ev.h1.c : 0, ev.h4 ? ev.h4.c : 0, ev.list ? ev.list.length : 0, minP, -maxP, -onLeader];
  }

  function binom(n, k) { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return Math.round(r); }

  /* Busca el reparto de DON!! libres que más le complica sobrevivir al rival. */
  function optimize(state) {
    const opp = state.opp, me = state.me;
    const src = me.attackers.filter(a => a.canAttack).map(a => ({
      id: a.id, name: a.name, base: a.power + (a.buff || 0), da: !!a.da, ub: !!a.ub, ban: !!a.ban, isLeader: !!a.isLeader,
    }));
    const Beff = Math.max(0, opp.blockers - me.removeBlockers);
    const scn = buildScenarios(opp, Beff);
    const n = src.length, D = Math.max(0, me.freeDon);
    if (!n) return { src, scn, Beff, best: null, ev: { level: 0, code: 'sinatacantes', list: [] } };
    const leaderIdx = src.findIndex(a => a.isLeader);
    const L = opp.leaderPower;
    const cache = new Map();
    const pool = [];
    const mk = dist => src.map((a, i) => ({ p: a.base + 1000 * dist[i], da: a.da, ub: a.ub, ban: a.ban, isLeader: a.isLeader }));
    function look(dist) {
      const atks = mk(dist);
      const ck = atks.filter(a => a.p >= L).map(a => `${a.p}${a.da ? 'd' : ''}${a.ub ? 'u' : ''}${a.ban ? 'b' : ''}${a.isLeader ? 'L' : ''}`).sort().join('|');
      let ev = cache.get(ck);
      if (!ev) { ev = evaluate(atks, opp, scn, false); cache.set(ck, ev); }
      const item = { dist: dist.slice(), atks, key: keyOf(ev, atks, dist, leaderIdx) };
      pool.push(item);
      return item;
    }
    const count = binom(D + n - 1, n - 1);
    if (count <= 12000) {
      const dist = new Array(n).fill(0);
      (function rec(i, left) {
        if (i === n - 1) { dist[i] = left; look(dist); return; }
        for (let x = left; x >= 0; x--) { dist[i] = x; rec(i + 1, left - x); }
      })(0, D);
    } else {
      let dist = new Array(n).fill(0), left = D;
      let cur = look(dist);
      while (left > 0) {
        let best = null, bestUse = 1;
        for (let i = 0; i < n; i++) {
          const d1 = dist.slice(); d1[i]++;
          const it = look(d1);
          if (!best || cmp(it.key, best.key) > 0) { best = it; bestUse = 1; }
        }
        if (left >= 2) {
          for (let i = 0; i < n; i++) for (let j = i; j < n; j++) {
            const d2 = dist.slice(); d2[i]++; d2[j]++;
            const it = look(d2);
            if (cmp(it.key, best.key) > 0 && cmp(it.key.slice(0, 4), best.key.slice(0, 4)) > 0) { best = it; bestUse = 2; }
          }
        }
        dist = best.dist; left -= bestUse; cur = best;
      }
    }
    const full = pool.filter(it => it.dist.reduce((x, y) => x + y, 0) === D);
    full.sort((a, b) => cmp(b.key, a.key));
    const seen = new Set();
    let winner = null;
    for (const it of full) {
      const sig = it.dist.join(',');
      if (seen.has(sig)) continue;
      seen.add(sig);
      if (seen.size > (state._fast ? 6 : 16)) break;
      const ev = evaluate(it.atks, opp, scn, true);
      const fk = keyOf(ev, it.atks, it.dist, leaderIdx);
      if (!winner || cmp(fk, winner.fk) > 0) winner = { ...it, ev, fk };
    }
    return { src, scn, Beff, best: winner, ev: winner.ev };
  }

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* Todo lo que muestra la pantalla de resultado. */
  function analyze(state) {
    const opp = state.opp, me = state.me;
    const L = opp.leaderPower;
    const res = optimize(state);
    const out = { res, L };
    const ev = res.ev;
    out.level = ev.level;
    out.code = ev.code;
    out.info = LEVELS[ev.level] || LEVELS[0];
    if (ev.code === 'sinatacantes') out.info = { code: 'sinatacantes', label: 'Sin atacantes', tone: 'bad' };
    if (ev.code === 'sinalcance') out.info = { code: 'sinalcance', label: 'No hay letal', tone: 'bad' };

    if (res.best) {
      const dist = res.best.dist;
      const rows = res.src.map((a, i) => {
        const p = a.base + 1000 * dist[i];
        const r = p >= L ? p - L + 1000 : 0;
        return { ...a, don: dist[i], p, r, minCards: r ? Math.ceil(r / 2000) : 0, connects: p >= L, needForHit: Math.max(0, Math.ceil((L - p) / 1000)) };
      });
      // orden: personajes de menor poder primero (los que un trigger te puede sacar), líder al final
      const order = attackOrder(rows);
      out.rows = rows;
      out.order = order;
      if (ev.h2) out.defense = ev.h2.plan.map(pl => ({ ...pl, row: rows[order[pl.k]] }));
      const L1 = res.scn;
      out.need = ev.h2 ? ev.h2.c : 0;
      out.have = L1.H;
      const dz = ev.dies || {};
      out.scen = ev.h2 && ev.code !== 'sobra' ? [
        { id: 'S1', name: 'Peor caso', desc: 'Todas de 2000, sus eventos, y lo que saca de la vida también es de 2000', dies: !!dz.S1 },
        { id: 'S2', name: 'Mano perfecta', desc: 'Todas sus cartas de 2000 más sus eventos', dies: !!dz.S2 },
        { id: 'S3', name: 'Mano normal', desc: `${L1.n2} de 2000, ${L1.n1} de 1000, ${L1.n0} sin counter${L1.ne ? `, ${L1.ne} evento${L1.ne > 1 ? 's' : ''}` : ''}`, dies: !!dz.S3 },
        { id: 'S4', name: 'Mano floja', desc: 'Todas de 1000 y sin eventos', dies: !!dz.S4 },
      ] : [];

      // riesgo de triggers
      const f = TRIG[opp.triggers] ?? 0;
      const lifeDmg = ev.list.filter(a => !a.ban).reduce((s, a) => s + a.dmg, 0);
      const k = Math.min(Math.max(0, opp.life), lifeDmg);
      out.trigger = { f, k, p: 1 - Math.pow(1 - f, k) };

      // robustez: ¿y si un trigger le da un blocker o te saca un personaje?
      if (ev.level >= 2) {
        const atks = res.best.atks.map((a, i) => ({ ...a, isLeader: res.src[i].isLeader }));
        const scnB = buildScenarios(opp, res.Beff + 1);
        out.ifBlocker = evaluate(atks, opp, scnB, true).level;
        let worst = null;
        rows.forEach((row, i) => {
          if (row.isLeader) return;
          const rest = atks.filter((_, j) => j !== i);
          const lv = evaluate(rest, opp, res.scn, true).level;
          if (!worst || lv < worst.level) worst = { level: lv, name: row.name };
        });
        out.ifKO = worst;
      }
    }

    // ¿qué cambiaría el resultado?
    if (ev.level <= 3 && res.src.length) {
      const tries = [];
      const fast = st => { st._fast = true; return optimize(st).ev.level; };
      if (res.Beff > 0) {
        const s = clone(state); s.me.removeBlockers += 1;
        tries.push({ text: 'Sacarle 1 blocker más antes de atacar', level: fast(s) });
      }
      { const s = clone(state); s.me.freeDon += 2;
        tries.push({ text: 'Tener 2 DON!! más (tu próximo turno)', level: fast(s) }); }
      if (state.me.attackers.filter(a => !a.isLeader).length < 5) {
        const s = clone(state); s.me.attackers.push({ id: 'x', name: 'Extra', power: 5000, buff: 0, canAttack: true });
        tries.push({ text: 'Un atacante más de 5000 (Rush o el turno que viene)', level: fast(s) }); }
      if (opp.hand > 0) {
        const s = clone(state); s.opp.hand -= 1;
        tries.push({ text: 'Que tenga 1 carta menos (si lo hacés descartar)', level: fast(s) });
      }
      out.whatIf = tries.filter(t => t.level > ev.level);
    }

    // objetivos en la mesa rival (personajes descansados)
    const prio = { amenaza: 0, blocker: 1, motor: 2, otro: 3 };
    const targets = (state.board || []).slice().sort((a, b) => (prio[a.role] - prio[b.role]) || (b.power - a.power));
    const free = res.src.map((a, i) => ({ ...a, i }));
    let donLeft = Math.max(0, me.freeDon);
    out.targets = targets.map(t => {
      const goal = t.power + 1000; // le obliga a gastar 2000 para salvarlo
      let pick = null;
      const cands = free.filter(a => !a.used && !a.isLeader).concat(free.filter(a => !a.used && a.isLeader));
      for (const a of cands) {
        const needGoal = Math.max(0, Math.ceil((goal - a.base) / 1000));
        const needKO = Math.max(0, Math.ceil((t.power - a.base) / 1000));
        const opt = needGoal <= donLeft ? { a, don: needGoal, p: a.base + needGoal * 1000 }
          : needKO <= donLeft ? { a, don: needKO, p: a.base + needKO * 1000 } : null;
        if (!opt) continue;
        // preferí personajes antes que el líder y no gastes un atacante grande en un objetivo chico
        opt.cost = opt.don + (a.isLeader ? 3 : 0);
        if (!pick || opt.cost < pick.cost || (opt.cost === pick.cost && opt.p < pick.p)) pick = opt;
      }
      if (pick) { pick.a.used = true; donLeft -= pick.don; }
      return { t, pick, save: pick ? pick.p - t.power + 1000 : null };
    });
    out.leftForLeader = free.filter(a => !a.used);
    out.donLeftAfterTargets = donLeft;
    const lifeHits = out.leftForLeader.filter(a => a.base + 0 >= L && !a.ban).reduce((s, a) => s + (a.da ? 2 : 1), 0);
    out.cardsGiven = Math.min(Math.max(0, opp.life), lifeHits);

    out.advice = advise(state, out);
    return out;
  }

  function advise(state, out) {
    const lv = out.level, threat = state.me.oppThreat, better = !!state.me.betterNext;
    if (out.code === 'sinatacantes') return { title: 'Cargá tus atacantes', text: 'Marcá al menos un atacante que pueda atacar este turno.' };
    if (out.code === 'sinalcance') return { title: 'Ningún ataque llega', text: `Tu ataque más fuerte no alcanza los ${out.L} de su líder. Necesitás más DON!!, buffs o bajarle el poder.` };
    if (lv >= 4) return { title: 'Atacá ahora', text: 'Ni con la mejor mano zafa con counters. Lo único que te puede frenar es un trigger o un efecto que no cargaste.' };
    if (lv === 3) return { title: 'Atacá ahora', text: 'Con una mano normal no llega. Solo zafa si guardó varios counters de 2000 o eventos.' };
    if (lv === 2) {
      if (threat === 'si') return { title: 'Andá igual', text: 'Es arriesgado, pero si esperás te mata él. Jugátela.' };
      if (better) return { title: 'Mejor esperá', text: 'Con una mano normal se defiende. Usá este turno para sacarle piezas de la mesa y llegá al próximo con más DON!!.' };
      return { title: 'Es una apuesta', text: 'Solo entra si tiene la mano floja. Andá si su mazo juega pocos counters de 2000 o si no vas a mejorar el turno que viene.' };
    }
    if (threat === 'si') return { title: 'Defendete atacando', text: 'No tenés letal y él puede tenerlo. Sacale los atacantes descansados y no te quedes sin blockers.' };
    if (out.code === 'sobra') return { title: 'Jugá por valor', text: 'Le alcanzan las vidas y los blockers sin gastar cartas. Priorizá su mesa o dejá armado el letal del turno siguiente.' };
    return { title: 'Jugá por valor', text: 'Tiene counter de sobra. Pegale a la vida solo si eso te deja el letal armado; si no, sacale personajes.' };
  }

  return { analyze, evaluate, optimize, buildScenarios, defendH, defendSeq, LEVELS, PROFILES, TRIG };
})();
if (typeof module !== 'undefined') module.exports = Engine;

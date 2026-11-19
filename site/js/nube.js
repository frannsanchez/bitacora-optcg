/* Nube: usuarios con contraseña, código de grupo y mazos compartidos, con Firebase.
   La configuración va en js/firebase-config.js. Las reglas de seguridad (firestore.rules)
   son las que controlan el código del grupo y quién puede escribir cada mazo. */
const Cloud = (() => {
  const SDK = '10.12.2';
  const cfg = window.BITACORA_FIREBASE || {};
  const configured = !!(cfg.apiKey && cfg.projectId && !/PEGAR|TU_/i.test(cfg.apiKey));
  const base = cfg.sdkBase || `https://www.gstatic.com/firebasejs/${SDK}`;
  const DOMAIN = 'bitacora.invalid'; // el usuario se guarda como usuario@bitacora.invalid: no se mandan mails
  const USER_RE = /^[a-z0-9_.-]{3,20}$/;

  let fb = null;                // { auth, db, A, F }
  let me = null;                // { uid, username }
  const st = { status: configured ? 'loading' : 'off', error: null, lastSync: null, syncing: false, notice: null };
  let group = null, groupAt = 0, pendingAgain = false, syncTimer = null;

  const emit = () => { App.emit('cloud', st); paintAccount(); };
  const normUser = u => String(u || '').trim().toLowerCase();
  // el código del grupo no distingue mayúsculas, tildes ni espacios: "Mi Grupo" = "migrupo"
  const normCode = c => String(c || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, '');
  const toEmail = u => `${u}@${DOMAIN}`;

  function friendly(e) {
    const c = (e && e.code) || '';
    if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)) return 'Usuario o contraseña incorrectos.';
    if (/email-already-in-use/.test(c)) return 'Ese usuario ya existe. Elegí otro.';
    if (/weak-password/.test(c)) return 'La contraseña tiene que tener al menos 6 caracteres.';
    if (/too-many-requests/.test(c)) return 'Demasiados intentos. Esperá unos minutos y probá de nuevo.';
    if (/network-request-failed|unavailable/.test(c)) return 'No hay conexión con el servidor. Probá cuando tengas internet.';
    if (/permission-denied/.test(c)) return 'No tenés permiso para hacer eso.';
    if (/requires-recent-login/.test(c)) return 'Por seguridad, volvé a entrar y probá de nuevo.';
    return (e && e.message) || 'Algo salió mal.';
  }

  async function boot() {
    if (!configured) { emit(); return; }
    st.status = 'loading'; st.error = null; emit();
    try {
      const [appM, A, F] = await Promise.all([
        import(`${base}/firebase-app.js`), import(`${base}/firebase-auth.js`), import(`${base}/firebase-firestore.js`),
      ]);
      const app = appM.initializeApp(cfg);
      fb = { auth: A.getAuth(app), db: F.getFirestore(app), A, F };
      A.onAuthStateChanged(fb.auth, u => { onUser(u); });
    } catch (e) {
      st.status = 'error'; st.error = 'No me pude conectar. Revisá tu conexión y volvé a intentar.'; emit();
    }
  }

  let busySignup = false;
  async function onUser(u) {
    group = null;
    if (!u) { me = null; st.status = 'out'; emit(); return; }
    if (busySignup) return; // el registro termina de armar el perfil por su cuenta
    const username = String(u.email || '').split('@')[0];
    try {
      const snap = await fb.F.getDoc(fb.F.doc(fb.db, 'users', u.uid));
      if (!snap.exists()) throw Object.assign(new Error('sin perfil'), { code: 'permission-denied' });
      me = { uid: u.uid, username: snap.data().username || username };
      st.status = 'in'; emit();
      adoptDevice();
      sync();
    } catch (e) {
      if (e.code === 'permission-denied') { me = { uid: u.uid, username }; st.status = 'noprofile'; emit(); return; }
      // sin conexión: dejamos la sesión abierta y sincronizamos cuando vuelva internet
      me = { uid: u.uid, username }; st.status = 'in'; st.error = friendly(e); emit();
    }
  }

  // Al entrar en un dispositivo, los mazos de otra cuenta se sacan de acá (siguen en la nube de su dueño).
  function adoptDevice() {
    const all = Decks.all();
    const keep = all.filter(d => !d.owner || d.owner === me.uid);
    if (keep.length !== all.length) Decks.setAll(keep);
  }

  async function signUp(username, password, code) {
    username = normUser(username);
    if (!USER_RE.test(username)) throw new Error('El usuario tiene que tener de 3 a 20 letras, números, puntos, guiones o guiones bajos, sin espacios.');
    if (String(password).length < 6) throw new Error('La contraseña tiene que tener al menos 6 caracteres.');
    if (!normCode(code)) throw new Error('Falta el código del grupo.');
    const { A, F, auth, db } = fb;
    busySignup = true;
    try {
      let cred;
      try { cred = await A.createUserWithEmailAndPassword(auth, toEmail(username), password); }
      catch (e) {
        if (!/email-already-in-use/.test(e.code || '')) throw e;
        // puede ser un intento anterior con el código mal: si la contraseña coincide y no tiene perfil, lo completamos
        try { cred = await A.signInWithEmailAndPassword(auth, toEmail(username), password); } catch (e2) { throw new Error('Ese usuario ya existe. Elegí otro.'); }
        let exists = false;
        try { exists = (await F.getDoc(F.doc(db, 'users', cred.user.uid))).exists(); } catch (e3) { exists = false; }
        if (exists) { busySignup = false; await onUser(cred.user); return; }
      }
      try {
        await F.setDoc(F.doc(db, 'users', cred.user.uid), { username, codigo: normCode(code), creado: new Date().toISOString() });
      } catch (e) {
        if (/permission-denied/.test(e.code || '')) { await A.signOut(auth); throw new Error('El código del grupo no es correcto.'); }
        throw e;
      }
      busySignup = false;
      await onUser(cred.user);
    } catch (e) {
      throw new Error(e.code ? friendly(e) : e.message);
    } finally { busySignup = false; }
  }

  async function completeProfile(code) {
    const { F, db, auth } = fb;
    try {
      await F.setDoc(F.doc(db, 'users', me.uid), { username: me.username, codigo: normCode(code), creado: new Date().toISOString() });
    } catch (e) { throw new Error(/permission-denied/.test(e.code || '') ? 'El código del grupo no es correcto.' : friendly(e)); }
    await onUser(auth.currentUser);
  }

  async function signIn(username, password) {
    username = normUser(username);
    try { await fb.A.signInWithEmailAndPassword(fb.auth, toEmail(username), password); }
    catch (e) { throw new Error(friendly(e)); }
  }

  async function signOut(clearDevice) {
    const mine = me ? me.uid : null;
    await fb.A.signOut(fb.auth);
    if (clearDevice && mine) Decks.setAll(Decks.all().filter(d => d.owner !== mine && !(d.synced && !d.owner)));
  }

  async function changePassword(current, next) {
    if (String(next).length < 6) throw new Error('La contraseña nueva tiene que tener al menos 6 caracteres.');
    const { A, auth } = fb;
    try {
      await A.reauthenticateWithCredential(auth.currentUser, A.EmailAuthProvider.credential(toEmail(me.username), current));
      await A.updatePassword(auth.currentUser, next);
    } catch (e) { throw new Error(friendly(e)); }
  }

  // ---- sincronización de mis mazos ----
  const toRemote = d => {
    const now = new Date().toISOString();
    return {
      owner: me.uid, ownerName: me.username, name: String(d.name || 'Mazo sin nombre').slice(0, 80),
      cards: d.cards.slice(0, 80).map(c => ({ num: c.num, qty: c.qty, pick: c.pick || null })),
      created: d.created || d.updated || now, updated: d.updated || now,
    };
  };
  const fromRemote = r => ({ id: r.id, name: r.name, cards: (r.cards || []).map(c => ({ num: c.num, qty: c.qty, pick: c.pick || null })), created: r.created, updated: r.updated, owner: r.owner, synced: true, dirty: false });

  async function push(d) {
    await fb.F.setDoc(fb.F.doc(fb.db, 'decks', d.id), toRemote(d));
    d.dirty = false; d.synced = true; d.owner = me.uid; d.ejemplo = false;
  }

  async function sync() {
    if (!fb || !me || st.status !== 'in') return;
    if (st.syncing) { pendingAgain = true; return; }
    st.syncing = true; emit();
    const { F, db } = fb;
    try {
      for (const id of Decks.tombs()) {
        try { await F.deleteDoc(F.doc(db, 'decks', id)); } catch (e) { if (!/not-found|permission-denied/.test(e.code || '')) throw e; }
        Decks.untomb(id);
      }
      const snap = await F.getDocs(F.query(F.collection(db, 'decks'), F.where('owner', '==', me.uid)));
      const remote = new Map();
      snap.forEach(doc => remote.set(doc.id, { id: doc.id, ...doc.data() }));
      const out = []; let up = 0;
      for (const d of Decks.all()) {
        if (d.owner && d.owner !== me.uid) continue;
        const r = remote.get(d.id);
        remote.delete(d.id);
        if (d.ejemplo && !d.dirty) { out.push(d); continue; }        // las listas de ejemplo no se suben solas
        if (r) {
          if (d.dirty) { await push(d); up++; out.push(d); }
          else out.push((r.updated || '') > (d.updated || '') ? fromRemote(r) : d);
        } else if (d.synced) {
          // estaba en la nube y ya no: lo borraste desde otro dispositivo
        } else { await push(d); up++; out.push(d); }
      }
      for (const r of remote.values()) out.push(fromRemote(r));
      out.sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
      Decks.setAll(out);
      st.lastSync = new Date(); st.error = null;
      if (up && !st.notice) { st.notice = `Subiste ${App.plural(up, 'mazo', 'mazos')} a tu cuenta.`; App.toast(st.notice); }
    } catch (e) {
      st.error = friendly(e);
    }
    st.syncing = false; emit();
    if (pendingAgain) { pendingAgain = false; sync(); }
  }
  const syncSoon = () => { clearTimeout(syncTimer); syncTimer = setTimeout(sync, 1200); };

  // ---- grupo: todos los jugadores y sus mazos ----
  async function loadGroup(force) {
    if (!fb || !me || st.status !== 'in') return null;
    if (group && !force && Date.now() - groupAt < 60000) return group;
    const { F, db } = fb;
    try {
      const [us, ds] = await Promise.all([F.getDocs(F.collection(db, 'users')), F.getDocs(F.collection(db, 'decks'))]);
      const users = [];
      us.forEach(doc => users.push({ uid: doc.id, username: doc.data().username }));
      const names = new Map(users.map(u => [u.uid, u.username]));
      const decks = [];
      ds.forEach(doc => { const r = doc.data(); decks.push({ ...fromRemote({ id: doc.id, ...r }), ownerName: names.get(r.owner) || r.ownerName || 'jugador' }); });
      decks.sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
      users.sort((a, b) => a.username.localeCompare(b.username));
      group = { users, decks, error: null };
      groupAt = Date.now();
    } catch (e) {
      group = { users: [], decks: [], error: friendly(e) };
    }
    App.emit('group', group);
    return group;
  }
  const groupDeck = id => (group ? group.decks.find(d => d.id === id) || null : null);

  // ---- botón de cuenta en la barra del celular ----
  function paintAccount() {
    const b = App.$('#acct-btn'); if (!b) return;
    if (st.status === 'in' && me) { b.textContent = me.username.slice(0, 1).toUpperCase(); b.title = `Entraste como ${me.username}`; b.classList.add('on'); }
    else { b.textContent = 'Entrar'; b.title = 'Entrar o crear usuario'; b.classList.remove('on'); }
    b.hidden = !configured;
  }

  function listNote() {
    const { esc } = App;
    if (!configured) return '';
    if (st.status === 'in' && me) return `<p class="note">${st.syncing ? 'Sincronizando…' : `Se sincronizan con tu usuario <b>${esc(me.username)}</b> y los ve tu grupo.`}${st.error ? ` <span class="warn-t">${esc(st.error)}</span>` : ''}</p>`;
    return `<p class="note">Se guardan solo en este dispositivo. <a href="#cuenta">Entrá con tu usuario</a> para compartirlos con tu grupo.</p>`;
  }

  App.on('decks-local', () => { if (st.status === 'in') syncSoon(); });
  window.addEventListener('online', () => { if (st.status === 'error') boot(); else sync(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });

  return {
    get configured() { return configured; }, get me() { return me; }, state: st,
    boot, signUp, signIn, signOut, completeProfile, changePassword, sync, loadGroup, groupDeck, listNote, USER_RE,
    get group() { return group; },
  };
})();

/* ---------- Grupo ---------- */
App.register({
  id: 'grupo', title: 'Grupo', short: 'Grupo', nav: true, tab: true, home: true, icon: App.ICONS.grupo,
  desc: 'Mirá las listas que armó cada uno de tus amigos, con su precio, y copiá las que te gusten.',
  status() {
    if (!Cloud.configured) return 'Falta conectar Firebase';
    if (Cloud.state.status !== 'in') return 'Entrá con tu usuario para verlo';
    const g = Cloud.group; return g && !g.error ? `${App.plural(g.users.length, 'jugador', 'jugadores')} · ${App.plural(g.decks.length, 'mazo', 'mazos')}` : 'Tu grupo de amigos';
  },
  init(el) {
    this.el = el; this.who = null;
    const again = () => { if (App.currentId() === 'grupo') this.render(); };
    App.on('group', again); App.on('prices', again); App.on('settings', again); App.on('cards', again);
    App.on('cloud', () => { if (App.currentId() === 'grupo') { if (Cloud.state.status === 'in' && !Cloud.group) Cloud.loadGroup(); this.render(); } });
    el.addEventListener('click', e => { if (e.target.closest('#gr-reload')) { this.loading = true; this.render(); Cloud.loadGroup(true).then(() => { this.loading = false; this.render(); }); } });
  },
  show(param) {
    this.who = param || null;
    App.Cards.load(); // imágenes de los líderes
    this.render();
    if (Cloud.state.status === 'in') Cloud.loadGroup().then(() => { if (App.currentId() === 'grupo') this.render(); });
  },
  render() {
    const { esc, money, Prices, plural } = App;
    const s = Cloud.state;
    const head = `<div class="vhead"><div><h1>Grupo</h1><p>Las listas de todos, con el precio de hoy en TCGplayer.</p></div>${s.status === 'in' ? '<div class="vact"><button type="button" class="btn ghost" id="gr-reload">Actualizar</button></div>' : ''}</div>`;
    if (!Cloud.configured) { this.el.innerHTML = `${head}<div class="card"><p class="note">Para compartir listas con tus amigos hay que conectar Firebase. El paso a paso está en el README del proyecto.</p></div>`; return; }
    if (s.status !== 'in') {
      this.el.innerHTML = `${head}<div class="card"><p class="note">${s.status === 'noprofile' ? 'Te falta el código del grupo para ver las listas.' : s.status === 'loading' ? 'Conectando…' : 'Entrá con tu usuario para ver las listas de tu grupo.'}</p><div class="vact"><a class="btn primary" href="#cuenta">${App.ICONS.cuenta}${s.status === 'noprofile' ? 'Poner el código' : 'Entrar o crear usuario'}</a></div></div>`;
      return;
    }
    const g = Cloud.group;
    if (!g || this.loading) { this.el.innerHTML = `${head}<div class="card"><p class="note">Cargando las listas del grupo…</p></div>`; return; }
    if (g.error) { this.el.innerHTML = `${head}<div class="banner tone-warn"><span>${esc(g.error)}</span></div>`; return; }
    const count = new Map();
    g.decks.forEach(d => count.set(d.owner, (count.get(d.owner) || 0) + 1));
    const sel = this.who ? g.users.find(u => u.username === this.who) : null;
    const chips = [`<a class="pchip" href="#grupo" aria-current="${!sel}">Todos <span>${g.decks.length}</span></a>`]
      .concat(g.users.map(u => `<a class="pchip" href="#grupo/${encodeURIComponent(u.username)}" aria-current="${!!sel && sel.uid === u.uid}">${esc(u.username)}${Cloud.me && u.uid === Cloud.me.uid ? ' (vos)' : ''} <span>${count.get(u.uid) || 0}</span></a>`)).join('');
    const ready = Prices.state === 'ok';
    const list = g.decks.filter(d => !sel || d.owner === sel.uid);
    const cards = list.map(d => {
      const k = Decks.counts(d);
      const p = ready ? Decks.price(d) : null;
      const mine = Cloud.me && d.owner === Cloud.me.uid;
      const lname = k.leader ? (Prices.cardName(k.leader.num) || k.leader.num) : null;
      return `<a class="deck withimg" href="#mazo/${encodeURIComponent(mine ? d.id : 'nube:' + d.id)}">
        <span class="dimg">${CardUI.leaderImg(d)}</span>
        <span class="dinfo">
          <small class="owner">${esc(d.ownerName)}${mine ? ' (vos)' : ''}</small>
          <b>${esc(d.name)}</b>
          <small>${lname ? `Líder: ${esc(lname)} · ` : ''}${plural(k.main, 'carta', 'cartas')}${k.leader ? ' + líder' : ''}</small>
          ${p ? `<span class="price">${money(p.total)}</span>` : `<span class="price none">${esc(Prices.state === 'loading' ? 'Calculando…' : 'Sin precios todavía')}</span>`}
        </span>
      </a>`;
    }).join('');
    this.el.innerHTML = `${head}
      <div class="pchips">${chips}</div>
      ${list.length ? `<div class="decks">${cards}</div>` : `<div class="card"><p class="note">${sel ? `${esc(sel.username)} todavía no subió mazos.` : 'Nadie subió mazos todavía. Los tuyos aparecen acá apenas los guardás.'}</p></div>`}`;
  },
});

/* ---------- Cuenta ---------- */
App.register({
  id: 'cuenta', title: 'Cuenta', short: 'Cuenta', nav: true, home: true, icon: App.ICONS.cuenta,
  desc: 'Creá tu usuario o entrá para compartir tus mazos con tu grupo.',
  status() { const s = Cloud.state.status; return s === 'in' && Cloud.me ? `Entraste como ${Cloud.me.username}` : s === 'off' ? 'Falta conectar Firebase' : 'Sin entrar'; },
  init(el) {
    this.el = el; this.mode = 'entrar'; this.msg = null;
    App.on('cloud', () => { if (App.currentId() === 'cuenta' && !this.busy) this.render(); });
    el.addEventListener('click', e => {
      const t = e.target;
      const m = t.closest('[data-mode]'); if (m) { this.mode = m.dataset.mode; this.msg = null; this.render(); return; }
      if (t.closest('#cu-sync')) { Cloud.sync(); return; }
      if (t.closest('#cu-retry')) { Cloud.boot(); return; }
      if (t.closest('#cu-out')) { this.mode = 'entrar'; Cloud.signOut(false); return; }
      if (t.closest('#cu-out-clear')) { this.mode = 'entrar'; Cloud.signOut(true).then(() => App.toast('Saliste y se borraron tus mazos de este dispositivo')); return; }
    });
    el.addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target; const v = id => (f.querySelector(id) || {}).value || '';
      this.busy = true; this.msg = null; this.lock(f, true);
      try {
        if (f.id === 'f-in') { await Cloud.signIn(v('#cu-user'), v('#cu-pass')); }
        else if (f.id === 'f-up') {
          if (v('#cu-pass') !== v('#cu-pass2')) throw new Error('Las contraseñas no coinciden.');
          await Cloud.signUp(v('#cu-user'), v('#cu-pass'), v('#cu-code'));
          App.toast('¡Listo! Ya tenés tu usuario');
        } else if (f.id === 'f-code') { await Cloud.completeProfile(v('#cu-code')); App.toast('¡Listo! Ya estás en el grupo'); }
        else if (f.id === 'f-pass') {
          if (v('#cu-new') !== v('#cu-new2')) throw new Error('Las contraseñas nuevas no coinciden.');
          await Cloud.changePassword(v('#cu-cur'), v('#cu-new')); f.reset(); App.toast('Cambiaste tu contraseña');
        }
      } catch (err) { this.msg = { form: f.id, text: err.message }; }
      this.busy = false; this.render();
    });
  },
  lock(f, on) { f.querySelectorAll('button, input').forEach(x => { x.disabled = on; }); },
  show() { this.msg = null; this.render(); },
  render() {
    const { esc } = App;
    const s = Cloud.state;
    const err = id => (this.msg && this.msg.form === id ? `<div class="banner tone-bad" role="alert"><span>${esc(this.msg.text)}</span></div>` : '');
    const head = `<div class="vhead"><div><h1>Cuenta</h1><p>Tu usuario sirve para guardar tus mazos en la nube y ver los de tu grupo.</p></div></div>`;
    if (s.status === 'off') {
      this.el.innerHTML = `${head}<div class="card"><h2>Falta conectar Firebase</h2>
        <p class="note">Los usuarios y las listas compartidas se guardan en Firebase, un servicio gratis de Google. Hay que crearlo una vez y pegar sus datos en <code>site/js/firebase-config.js</code>. El paso a paso está en el README del proyecto.</p>
        <p class="note">Mientras tanto, la app funciona igual y tus mazos se guardan en este dispositivo.</p></div>`;
      return;
    }
    if (s.status === 'loading') { this.el.innerHTML = `${head}<div class="card"><p class="note">Conectando…</p></div>`; return; }
    if (s.status === 'error') {
      this.el.innerHTML = `${head}<div class="card"><div class="banner tone-warn"><span>${esc(s.error)}</span></div><div class="vact"><button type="button" class="btn" id="cu-retry">Volver a intentar</button></div></div>`;
      return;
    }
    if (s.status === 'noprofile') {
      this.el.innerHTML = `${head}<form class="card auth" id="f-code" novalidate>
        <h2>Te falta el código del grupo</h2>
        <p class="note">Entraste como <b>${esc(Cloud.me.username)}</b>, pero todavía no estás en el grupo. Pedile el código a quien armó la app.</p>
        <div><label class="flabel" for="cu-code">Código del grupo</label><input class="field" id="cu-code" autocomplete="off" autocapitalize="none" spellcheck="false" required></div>
        ${err('f-code')}
        <div class="vact"><button type="submit" class="btn primary">Entrar al grupo</button><button type="button" class="btn ghost" id="cu-out">Salir</button></div>
      </form>`;
      return;
    }
    if (s.status === 'in' && Cloud.me) {
      const last = s.lastSync ? s.lastSync.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : null;
      this.el.innerHTML = `${head}
        <div class="card">
          <div class="who"><span class="avatar">${esc(Cloud.me.username.slice(0, 1).toUpperCase())}</span><div><small>Entraste como</small><b>${esc(Cloud.me.username)}</b></div></div>
          <p class="note">${s.syncing ? 'Sincronizando tus mazos…' : last ? `Tus mazos están sincronizados (última vez a las ${last}).` : 'Tus mazos se sincronizan solos cuando hay internet.'}</p>
          ${s.error ? `<div class="banner tone-warn"><span>${esc(s.error)}</span></div>` : ''}
          <div class="vact"><button type="button" class="btn" id="cu-sync">Sincronizar ahora</button><a class="btn ghost" href="#grupo">${App.ICONS.grupo}Ver el grupo</a></div>
        </div>
        <form class="card auth" id="f-pass" novalidate>
          <h2>Cambiar contraseña</h2>
          <input type="text" class="sr" autocomplete="username" value="${esc(Cloud.me.username)}" tabindex="-1" aria-hidden="true">
          <div><label class="flabel" for="cu-cur">Contraseña actual</label><input class="field" id="cu-cur" type="password" autocomplete="current-password" required></div>
          <div><label class="flabel" for="cu-new">Contraseña nueva</label><input class="field" id="cu-new" type="password" autocomplete="new-password" minlength="6" required></div>
          <div><label class="flabel" for="cu-new2">Repetila</label><input class="field" id="cu-new2" type="password" autocomplete="new-password" minlength="6" required></div>
          ${err('f-pass')}
          <div class="vact"><button type="submit" class="btn">Cambiar contraseña</button></div>
        </form>
        <div class="card">
          <h2>Salir</h2>
          <p class="note">Si este dispositivo no es tuyo, salí y borrá tus mazos de acá. Siguen guardados en tu cuenta.</p>
          <div class="vact"><button type="button" class="btn" id="cu-out">Salir</button><button type="button" class="btn ghost danger" id="cu-out-clear">Salir y borrar mis mazos de este dispositivo</button></div>
        </div>`;
      return;
    }
    const up = this.mode === 'crear';
    this.el.innerHTML = `${head}
      <div class="seg" role="tablist" aria-label="Elegí">
        <button type="button" role="tab" data-mode="entrar" aria-checked="${!up}" aria-selected="${!up}">Entrar</button>
        <button type="button" role="tab" data-mode="crear" aria-checked="${up}" aria-selected="${up}">Crear usuario</button>
      </div>
      <form class="card auth" id="${up ? 'f-up' : 'f-in'}" novalidate>
        <h2>${up ? 'Crear usuario' : 'Entrar'}</h2>
        <div><label class="flabel" for="cu-user">Usuario</label><input class="field" id="cu-user" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="20" required>
          ${up ? '<small class="fhint">De 3 a 20 letras o números, sin espacios. Es único: nadie más puede usarlo.</small>' : ''}</div>
        <div><label class="flabel" for="cu-pass">Contraseña</label><input class="field" id="cu-pass" type="password" autocomplete="${up ? 'new-password' : 'current-password'}" minlength="6" required>
          ${up ? '<small class="fhint">Al menos 6 caracteres. Anotala: no hay mail para recuperarla.</small>' : ''}</div>
        ${up ? `<div><label class="flabel" for="cu-pass2">Repetí la contraseña</label><input class="field" id="cu-pass2" type="password" autocomplete="new-password" minlength="6" required></div>
        <div><label class="flabel" for="cu-code">Código del grupo</label><input class="field" id="cu-code" autocomplete="off" autocapitalize="none" spellcheck="false" required><small class="fhint">Te lo pasa quien armó la app.</small></div>` : ''}
        ${err(up ? 'f-up' : 'f-in')}
        <div class="vact"><button type="submit" class="btn primary">${up ? 'Crear usuario' : 'Entrar'}</button></div>
      </form>`;
  },
});

/* Nube: usuarios con contraseña, código de grupo, mail de recuperación, mazos compartidos y valoraciones, con Firebase.
   La configuración va en js/firebase-config.js. Las reglas de seguridad (firestore.rules)
   son las que controlan el código del grupo, los nombres de usuario y quién puede escribir cada cosa. */
const Cloud = (() => {
  const SDK = '10.12.2';
  const cfg = window.BITACORA_FIREBASE || {};
  const configured = !!(cfg.apiKey && cfg.projectId && !/PEGAR|TU_/i.test(cfg.apiKey));
  const base = cfg.sdkBase || `https://www.gstatic.com/firebasejs/${SDK}`;
  // Cada usuario se crea como usuario@bitacora.invalid (no recibe mails). Si agrega su mail y lo confirma,
  // la cuenta pasa a usar ese mail: puede entrar con él y recuperar la contraseña.
  const DOMAIN = 'bitacora.invalid';
  const USER_RE = /^[a-z0-9_.-]{3,20}$/;
  const MAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  let fb = null;                // { auth, db, A, F }
  let me = null;                // { uid, username }
  const st = { status: configured ? 'loading' : 'off', error: null, lastSync: null, syncing: false, notice: null, flash: null };
  let group = null, groupAt = 0, pendingAgain = false, syncTimer = null;

  const emit = () => { App.emit('cloud', st); paintAccount(); };
  const normUser = u => String(u || '').trim().toLowerCase();
  // el código del grupo no distingue mayúsculas, tildes ni espacios: "Mi Grupo" = "migrupo"
  const normCode = c => String(c || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '');
  const toEmail = u => `${u}@${DOMAIN}`;
  const internal = e => String(e || '').toLowerCase().endsWith('@' + DOMAIN);
  const appUrl = () => `${location.origin}${location.pathname}#cuenta`;

  // en cada dispositivo recordamos con qué mail entra cada usuario, para que pueda seguir escribiendo su usuario
  const LKEY = 'bitacora-logins-v1', PKEY = 'bitacora-mail-pendiente-v1', YKEY = 'bitacora-yo-v1';
  const logins = () => App.store.get(LKEY, {});
  const saveLogin = (u, e) => { const m = logins(); m[u] = e; App.store.set(LKEY, m); };
  const pendings = () => App.store.get(PKEY, {});
  const pendingFor = u => pendings()[u] || null;
  const setPending = (u, e) => { const m = pendings(); if (e) m[u] = e; else delete m[u]; App.store.set(PKEY, m); };
  const knownName = uid => App.store.get(YKEY, {})[uid];
  const rememberName = (uid, name) => { const m = App.store.get(YKEY, {}); if (m[uid] !== name) { m[uid] = name; App.store.set(YKEY, m); } };

  function friendly(e) {
    const c = (e && e.code) || '';
    if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)) return 'Usuario o contraseña incorrectos.';
    if (/email-already-in-use/.test(c)) return 'Ese usuario ya existe. Elegí otro.';
    if (/weak-password/.test(c)) return 'La contraseña tiene que tener al menos 6 caracteres.';
    if (/too-many-requests/.test(c)) return 'Demasiados intentos. Esperá unos minutos y probá de nuevo.';
    if (/network-request-failed|unavailable/.test(c)) return 'No hay conexión con el servidor. Probá cuando tengas internet.';
    if (/permission-denied/.test(c)) return 'No tenés permiso para hacer eso.';
    if (/requires-recent-login|user-token-expired/.test(c)) return 'Por seguridad, volvé a entrar y probá de nuevo.';
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

  let busySignup = false, leaving = false;
  async function onUser(u) {
    group = null;
    if (!u) {
      // si la sesión se cerró sola (por ejemplo, Firebase la cierra al confirmar el mail nuevo), avisamos por qué
      if (me && !leaving && !st.flash) st.flash = 'Se cerró tu sesión: si recién confirmaste tu mail o cambiaste la contraseña en otro dispositivo, es normal. Volvé a entrar con tu usuario o tu mail.';
      leaving = false; me = null; st.status = 'out'; emit(); return;
    }
    if (busySignup) return; // el registro termina de armar el perfil por su cuenta
    const guess = knownName(u.uid) || (internal(u.email) ? String(u.email).split('@')[0] : 'jugador');
    try {
      const snap = await fb.F.getDoc(fb.F.doc(fb.db, 'users', u.uid));
      if (!snap.exists()) throw Object.assign(new Error('sin perfil'), { code: 'permission-denied' });
      me = { uid: u.uid, username: snap.data().username || guess };
      rememberName(u.uid, me.username);
      if (!internal(u.email)) { saveLogin(me.username, String(u.email).toLowerCase()); if (pendingFor(me.username) === String(u.email).toLowerCase()) setPending(me.username, null); }
      st.status = 'in'; st.flash = null; emit();
      adoptDevice();
      sync();
      ensureRegistry().catch(() => {}); // usuarios anteriores al registro de nombres: lo reservamos ahora
    } catch (e) {
      if (e.code === 'permission-denied') { me = { uid: u.uid, username: guess }; st.status = 'noprofile'; emit(); return; }
      // sin conexión: dejamos la sesión abierta y sincronizamos cuando vuelva internet
      me = { uid: u.uid, username: guess }; st.status = 'in'; st.error = friendly(e); emit();
    }
  }

  // Al entrar en un dispositivo, los mazos de otra cuenta se sacan de acá (siguen en la nube de su dueño).
  function adoptDevice() {
    const all = Decks.all();
    const keep = all.filter(d => !d.owner || d.owner === me.uid);
    if (keep.length !== all.length) Decks.setAll(keep);
  }

  // Registro de nombres (usernames/<usuario> → uid): así nadie puede usar un nombre que ya es de otro,
  // aunque esa persona haya cambiado su cuenta a su mail.
  async function claimName(username, uid) {
    const { F, db } = fb;
    const ref = F.doc(db, 'usernames', username);
    const s = await F.getDoc(ref);
    if (s.exists()) return s.data().uid === uid;
    await F.setDoc(ref, { uid });
    return true;
  }
  async function ensureRegistry() {
    if (!me) return;
    const ok = await claimName(me.username, me.uid);
    if (!ok) throw new Error('Tu nombre de usuario figura a nombre de otra cuenta. Avisale a quien administra el grupo.');
  }

  async function signUp(username, password, code, mail) {
    username = normUser(username);
    mail = String(mail || '').trim().toLowerCase();
    if (!USER_RE.test(username)) throw new Error('El usuario tiene que tener de 3 a 20 letras, números, puntos, guiones o guiones bajos, sin espacios.');
    if (String(password).length < 6) throw new Error('La contraseña tiene que tener al menos 6 caracteres.');
    if (!normCode(code)) throw new Error('Falta el código del grupo.');
    if (mail && !MAIL_RE.test(mail)) throw new Error('Ese mail no es válido.');
    const { A, F, auth, db } = fb;
    busySignup = true;
    let created = null;
    try {
      let cred;
      try { cred = await A.createUserWithEmailAndPassword(auth, toEmail(username), password); created = cred.user; }
      catch (e) {
        if (!/email-already-in-use/.test(e.code || '')) throw e;
        // puede ser un intento anterior con el código mal: si la contraseña coincide y no tiene perfil, lo completamos
        try { cred = await A.signInWithEmailAndPassword(auth, toEmail(username), password); } catch (e2) { throw new Error('Ese usuario ya existe. Elegí otro.'); }
        let exists = false;
        try { exists = (await F.getDoc(F.doc(db, 'users', cred.user.uid))).exists(); } catch (e3) { exists = false; }
        if (exists) { busySignup = false; await onUser(cred.user); return; }
      }
      // el nombre puede estar reservado por alguien que ya pasó su cuenta a su mail
      if (!(await claimName(username, cred.user.uid))) {
        if (created) { try { await A.deleteUser(created); } catch (e) { /* queda una cuenta vacía que no entra al grupo */ } }
        await A.signOut(auth).catch(() => {});
        throw new Error('Ese usuario ya existe. Elegí otro.');
      }
      try {
        await F.setDoc(F.doc(db, 'users', cred.user.uid), { username, codigo: normCode(code), creado: new Date().toISOString() });
      } catch (e) {
        if (/permission-denied/.test(e.code || '')) { await A.signOut(auth); throw new Error('El código del grupo no es correcto.'); }
        throw e;
      }
      busySignup = false;
      await onUser(cred.user);
      if (mail) {
        try { await addEmail(mail); App.toast(`Te mandamos un mail a ${mail} para confirmarlo`); }
        catch (e) { App.toast(`Tu usuario ya está creado, pero no pude mandar el mail: ${e.message}`); }
      }
    } catch (e) {
      throw new Error(e.code ? friendly(e) : e.message);
    } finally { busySignup = false; }
  }

  async function completeProfile(code) {
    const { F, db, auth } = fb;
    try {
      if (!(await claimName(me.username, me.uid))) throw new Error('Ese usuario ya es de otra cuenta.');
      await F.setDoc(F.doc(db, 'users', me.uid), { username: me.username, codigo: normCode(code), creado: new Date().toISOString() });
    } catch (e) { throw new Error(/permission-denied/.test(e.code || '') ? 'El código del grupo no es correcto.' : e.code ? friendly(e) : e.message); }
    await onUser(auth.currentUser);
  }

  // Se puede entrar con el usuario o con el mail. Con el usuario probamos el mail que usó en este dispositivo,
  // el que estaba por confirmar y el interno.
  async function signIn(id, password) {
    id = String(id || '').trim();
    const byMail = id.includes('@');
    const u = normUser(id);
    const tries = byMail ? [id.toLowerCase()] : [...new Set([logins()[u], pendingFor(u), toEmail(u)].filter(Boolean))];
    let last = null;
    for (const email of tries) {
      try { await fb.A.signInWithEmailAndPassword(fb.auth, email, password); st.flash = null; return; }
      catch (e) { last = e; if (!/invalid-credential|wrong-password|user-not-found|invalid-email/.test(e.code || '')) break; }
    }
    if (last && !/invalid-credential|wrong-password|user-not-found|invalid-email/.test(last.code || '')) throw new Error(friendly(last));
    throw new Error(byMail ? 'Mail o contraseña incorrectos.' : 'Usuario o contraseña incorrectos. Si le agregaste un mail a tu cuenta, probá entrar con el mail.');
  }

  async function signOut(clearDevice) {
    const mine = me ? me.uid : null;
    leaving = true; st.flash = null;
    await fb.A.signOut(fb.auth);
    if (clearDevice && mine) Decks.setAll(Decks.all().filter(d => d.owner !== mine && !(d.synced && !d.owner)));
  }

  async function reauth(password) {
    const { A, auth } = fb;
    await A.reauthenticateWithCredential(auth.currentUser, A.EmailAuthProvider.credential(auth.currentUser.email, password));
  }

  async function changePassword(current, next) {
    if (String(next).length < 6) throw new Error('La contraseña nueva tiene que tener al menos 6 caracteres.');
    try { await reauth(current); await fb.A.updatePassword(fb.auth.currentUser, next); }
    catch (e) { throw new Error(/invalid-credential|wrong-password/.test(e.code || '') ? 'La contraseña actual no es correcta.' : friendly(e)); }
  }

  // ---- mail para recuperar la cuenta ----
  function account() {
    const u = fb && fb.auth.currentUser;
    const email = u ? String(u.email || '').toLowerCase() : '';
    return { email: internal(email) ? '' : email, pending: me ? pendingFor(me.username) : null };
  }
  // Firebase manda un link al mail nuevo; cuando lo tocás, la cuenta pasa a usar ese mail.
  async function addEmail(mail, password) {
    mail = String(mail || '').trim().toLowerCase();
    if (!MAIL_RE.test(mail) || internal(mail)) throw new Error('Ese mail no es válido.');
    const { A, auth } = fb;
    try {
      if (password != null) await reauth(password);
      await ensureRegistry();
      try { await A.verifyBeforeUpdateEmail(auth.currentUser, mail, { url: appUrl() }); }
      catch (e) {
        if (!/continue-uri|unauthorized-domain/.test(e.code || '')) throw e;
        await A.verifyBeforeUpdateEmail(auth.currentUser, mail); // sin link de vuelta a la app
      }
    } catch (e) {
      const c = e.code || '';
      if (/invalid-credential|wrong-password/.test(c)) throw new Error('La contraseña no es correcta.');
      if (/email-already-in-use/.test(c)) throw new Error('Ese mail ya está en otra cuenta.');
      if (/invalid-(new-)?email/.test(c)) throw new Error('Ese mail no es válido.');
      throw new Error(c ? friendly(e) : e.message);
    }
    setPending(me.username, mail);
    emit();
  }
  // ¿ya tocó el link? Al cambiar el mail, Firebase cierra la sesión por seguridad: hay que volver a entrar.
  async function checkEmail() {
    const u = fb && fb.auth.currentUser;
    if (!u || !me) return;
    const p = pendingFor(me.username);
    if (!p) return;
    try {
      await fb.A.reload(u);
      const now = String(fb.auth.currentUser.email || '').toLowerCase();
      if (now === p) { saveLogin(me.username, now); setPending(me.username, null); App.toast('¡Listo! Confirmaste tu mail'); emit(); }
    } catch (e) {
      if (/user-token-expired|invalid-user-token|user-not-found|requires-recent-login/.test(e.code || '')) {
        st.flash = 'Confirmaste tu mail. Por seguridad, volvé a entrar con tu usuario o con tu mail.';
        leaving = true;
        await fb.A.signOut(fb.auth).catch(() => {});
        emit();
      }
    }
  }
  async function resetPassword(mail) {
    mail = String(mail || '').trim().toLowerCase();
    if (!MAIL_RE.test(mail) || internal(mail)) throw new Error('Escribí el mail que le agregaste a tu cuenta.');
    try {
      try { await fb.A.sendPasswordResetEmail(fb.auth, mail, { url: appUrl() }); }
      catch (e) { if (!/continue-uri|unauthorized-domain/.test(e.code || '')) throw e; await fb.A.sendPasswordResetEmail(fb.auth, mail); }
    } catch (e) {
      if (/user-not-found/.test(e.code || '')) return; // no decimos qué mails tienen cuenta
      if (/invalid-email/.test(e.code || '')) throw new Error('Ese mail no es válido.');
      throw new Error(friendly(e));
    }
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

  // ---- grupo: todos los jugadores, sus mazos y las valoraciones ----
  async function loadGroup(force) {
    if (!fb || !me || st.status !== 'in') return null;
    if (group && !force && Date.now() - groupAt < 60000) return group;
    const { F, db } = fb;
    try {
      const [us, ds, rs] = await Promise.all([
        F.getDocs(F.collection(db, 'users')), F.getDocs(F.collection(db, 'decks')),
        F.getDocs(F.collection(db, 'ratings')).catch(() => null), // si las reglas todavía no las permiten, seguimos sin valoraciones
      ]);
      const users = [];
      us.forEach(doc => users.push({ uid: doc.id, username: doc.data().username }));
      const names = new Map(users.map(u => [u.uid, u.username]));
      const decks = [];
      ds.forEach(doc => { const r = doc.data(); decks.push({ ...fromRemote({ id: doc.id, ...r }), ownerName: names.get(r.owner) || r.ownerName || 'jugador' }); });
      decks.sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
      users.sort((a, b) => a.username.localeCompare(b.username));
      const ratings = [];
      if (rs) rs.forEach(doc => { const r = doc.data(); ratings.push({ id: doc.id, deck: r.deck, uid: r.uid, stars: r.stars, text: r.text || '', updated: r.updated, username: names.get(r.uid) || 'jugador' }); });
      group = { users, decks, ratings, names, error: null };
      groupAt = Date.now();
    } catch (e) {
      group = { users: [], decks: [], ratings: [], names: new Map(), error: friendly(e) };
    }
    App.emit('group', group);
    return group;
  }
  const groupDeck = id => (group ? group.decks.find(d => d.id === id) || null : null);

  // valoraciones de un mazo (las más nuevas primero) y su promedio
  function ratingsOf(deckId) {
    return group ? group.ratings.filter(r => r.deck === deckId).sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || ''))) : [];
  }
  function score(list) {
    const n = list.length;
    return { n, avg: n ? list.reduce((s, r) => s + r.stars, 0) / n : 0 };
  }
  const deckScore = deckId => score(ratingsOf(deckId));
  // valoraciones que recibieron todos los mazos de un jugador
  function playerScore(uid) {
    if (!group) return score([]);
    const ids = new Set(group.decks.filter(d => d.owner === uid).map(d => d.id));
    return score(group.ratings.filter(r => ids.has(r.deck)));
  }

  async function rate(deckId, stars, text) {
    stars = Math.round(+stars);
    if (!(stars >= 1 && stars <= 5)) throw new Error('Elegí de 1 a 5 estrellas.');
    const d = groupDeck(deckId);
    if (!d) throw new Error('No encontré ese mazo.');
    if (d.owner === me.uid) throw new Error('No podés valorar tus propios mazos.');
    const data = { deck: deckId, uid: me.uid, stars, text: String(text || '').trim().slice(0, 280), updated: new Date().toISOString() };
    const id = `${deckId}_${me.uid}`;
    try { await fb.F.setDoc(fb.F.doc(fb.db, 'ratings', id), data); }
    catch (e) { throw new Error(friendly(e)); }
    group.ratings = group.ratings.filter(r => r.id !== id).concat({ id, ...data, username: me.username });
    App.emit('group', group);
  }
  async function unrate(deckId) {
    const id = `${deckId}_${me.uid}`;
    try { await fb.F.deleteDoc(fb.F.doc(fb.db, 'ratings', id)); }
    catch (e) { throw new Error(friendly(e)); }
    group.ratings = group.ratings.filter(r => r.id !== id);
    App.emit('group', group);
  }

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
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { sync(); checkEmail(); } });

  return {
    get configured() { return configured; }, get me() { return me; }, state: st,
    boot, signUp, signIn, signOut, completeProfile, changePassword, sync, loadGroup, groupDeck, listNote, USER_RE,
    account, addEmail, checkEmail, resetPassword,
    ratingsOf, deckScore, playerScore, rate, unrate,
    get group() { return group; },
  };
})();

/* ---------- estrellas y valoraciones (se usan en el grupo y en la vista de cada mazo) ---------- */
const Stars = (() => {
  const { esc } = App;
  const fmt = n => n.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  // ★★★★☆ con medias estrellas redondeadas a la más cercana
  const show = (avg, cls = '') => {
    const full = Math.round(avg);
    return `<span class="stars ${cls}" aria-hidden="true">${'★'.repeat(full)}<i>${'★'.repeat(5 - full)}</i></span>`;
  };
  const summary = s => (s.n ? `${show(s.avg)}<b>${fmt(s.avg)}</b><small>${App.plural(s.n, 'valoración', 'valoraciones')}</small>` : '<small class="muted">Sin valoraciones todavía</small>');
  const line = s => (s.n ? `<span class="rline" title="${fmt(s.avg)} de 5 · ${App.plural(s.n, 'valoración', 'valoraciones')}">${show(s.avg)} ${fmt(s.avg)} <small>(${s.n})</small></span>` : '');

  // bloque de valoraciones de un mazo: el promedio, tu valoración (si no es tuyo) y lo que dijeron los demás
  let draft = null; // { deck, stars, text } mientras lo estás escribiendo
  function block(deck, readOnly) {
    if (typeof Cloud === 'undefined' || !Cloud.configured || Cloud.state.status !== 'in' || !Cloud.me) return '';
    if (!readOnly && !deck.synced) return '';
    const g = Cloud.group;
    if (!g) return `<div class="card rate-card"><h2>Valoraciones</h2><p class="note">Cargando…</p></div>`;
    const list = Cloud.ratingsOf(deck.id);
    const s = Cloud.deckScore(deck.id);
    const mine = deck.owner === Cloud.me.uid;
    const my = list.find(r => r.uid === Cloud.me.uid);
    const d = draft && draft.deck === deck.id ? draft : { deck: deck.id, stars: my ? my.stars : 0, text: my ? my.text : '' };
    const others = list.filter(r => r.uid !== Cloud.me.uid || mine);
    const form = mine ? '' : `
      <form class="rate-form" id="rate-form" data-deck="${esc(deck.id)}" novalidate>
        <span class="flabel" id="rate-lab">${my ? 'Tu valoración' : 'Valoralo'}</span>
        <div class="starpick" role="radiogroup" aria-labelledby="rate-lab">${[1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" data-star="${n}" aria-checked="${d.stars === n}" class="${n <= d.stars ? 'on' : ''}" aria-label="${App.plural(n, 'estrella', 'estrellas')}">★</button>`).join('')}</div>
        <label class="sr" for="rate-text">Comentario</label>
        <textarea class="field" id="rate-text" rows="2" maxlength="280" placeholder="Comentario (opcional): qué te gusta, qué cambiarías…">${esc(d.text)}</textarea>
        <div class="vact"><button type="submit" class="btn primary">${my ? 'Guardar cambios' : 'Guardar valoración'}</button>${my ? '<button type="button" class="btn ghost" data-act="unrate">Borrar la mía</button>' : ''}</div>
      </form>`;
    const items = others.map(r => `<li><div class="rhead2"><b>${esc(r.username)}${r.uid === Cloud.me.uid ? ' (vos)' : ''}</b>${show(r.stars)}<small>${esc(App.fdate(r.updated))}</small></div>${r.text ? `<p>${esc(r.text)}</p>` : ''}</li>`).join('');
    return `<div class="card rate-card">
      <h2>Valoraciones</h2>
      <div class="rate-sum">${summary(s)}</div>
      ${form}
      ${items ? `<ul class="rlist">${items}</ul>` : mine ? '<p class="note">Cuando alguien del grupo valore este mazo, lo vas a ver acá.</p>' : ''}
    </div>`;
  }

  // los eventos van en la vista del mazo
  function wire() {
    const view = document.getElementById('view-mazo');
    if (!view) return;
    view.addEventListener('click', async e => {
      const b = e.target.closest('#rate-form [data-star]');
      if (b) {
        const f = b.closest('form');
        const n = +b.dataset.star;
        draft = { deck: f.dataset.deck, stars: n, text: f.querySelector('#rate-text').value };
        f.querySelectorAll('[data-star]').forEach(x => { const k = +x.dataset.star; x.classList.toggle('on', k <= n); x.setAttribute('aria-checked', String(k === n)); });
        return;
      }
      const u = e.target.closest('[data-act="unrate"]');
      if (u) {
        const f = u.closest('form');
        try { await Cloud.unrate(f.dataset.deck); draft = null; App.toast('Borraste tu valoración'); } catch (err) { App.toast(err.message); }
      }
    });
    const picked = f => { const b = f.querySelector('[data-star][aria-checked="true"]'); return b ? +b.dataset.star : 0; };
    view.addEventListener('input', e => {
      if (e.target.id !== 'rate-text') return;
      const f = e.target.closest('form');
      draft = { deck: f.dataset.deck, stars: picked(f), text: e.target.value };
    });
    view.addEventListener('submit', async e => {
      if (e.target.id !== 'rate-form') return;
      e.preventDefault();
      const f = e.target;
      const n = picked(f);
      if (!n) { App.toast('Tocá las estrellas para elegir de 1 a 5'); return; }
      f.querySelectorAll('button, textarea').forEach(x => { x.disabled = true; });
      try { await Cloud.rate(f.dataset.deck, n, f.querySelector('#rate-text').value); draft = null; App.toast('Guardaste tu valoración'); }
      catch (err) { App.toast(err.message); f.querySelectorAll('button, textarea').forEach(x => { x.disabled = false; }); }
    });
  }
  return { show, summary, line, block, wire, fmt };
})();

/* ---------- Grupo: buscar jugadores y mazos ---------- */
App.register({
  id: 'grupo', title: 'Grupo', short: 'Grupo', nav: true, tab: true, home: true, icon: App.ICONS.grupo,
  desc: 'Buscá a los jugadores del grupo, mirá sus listas, valoralas y copiá las que te gusten.',
  status() {
    if (!Cloud.configured) return 'Falta conectar Firebase';
    if (Cloud.state.status !== 'in') return 'Entrá con tu usuario para verlo';
    const g = Cloud.group; return g && !g.error ? `${App.plural(g.users.length, 'jugador', 'jugadores')} · ${App.plural(g.decks.length, 'mazo', 'mazos')}` : 'Tu grupo de amigos';
  },
  init(el) {
    this.el = el; this.who = null; this.q = ''; this.sort = 'recientes';
    const again = () => { if (App.currentId() === 'grupo') this.render(); };
    App.on('group', again); App.on('prices', again); App.on('settings', again); App.on('cards', again);
    App.on('cloud', () => { if (App.currentId() === 'grupo') { if (Cloud.state.status === 'in' && !Cloud.group) Cloud.loadGroup(); this.render(); } });
    el.addEventListener('click', e => {
      if (e.target.closest('#gr-reload')) { this.loading = true; this.render(); Cloud.loadGroup(true).then(() => { this.loading = false; this.render(); }); return; }
      const s = e.target.closest('[data-gsort]');
      if (s) { this.sort = s.dataset.gsort; this.lists(); }
    });
    el.addEventListener('input', e => { if (e.target.id === 'gr-q') { this.q = e.target.value; this.lists(); } });
  },
  show(param) {
    this.who = param || null;
    App.Cards.load(); // imágenes de los líderes
    this.render();
    if (Cloud.state.status === 'in') Cloud.loadGroup().then(() => { if (App.currentId() === 'grupo') this.render(); });
  },
  render() {
    const { esc } = App;
    const s = Cloud.state;
    const sel = this.who && Cloud.group ? Cloud.group.users.find(u => u.username === this.who) : null;
    const head = `<div class="vhead"><div><h1>Grupo</h1><p>Buscá jugadores, mirá sus listas, valoralas y copiá las que te gusten.</p></div>${s.status === 'in' ? '<div class="vact"><button type="button" class="btn ghost" id="gr-reload">Actualizar</button></div>' : ''}</div>`;
    if (!Cloud.configured) { this.el.innerHTML = `${head}<div class="card"><p class="note">Para compartir listas con tus amigos hay que conectar Firebase. El paso a paso está en el README del proyecto.</p></div>`; return; }
    if (s.status !== 'in') {
      this.el.innerHTML = `${head}<div class="card"><p class="note">${s.status === 'noprofile' ? 'Te falta el código del grupo para ver las listas.' : s.status === 'loading' ? 'Conectando…' : 'Entrá con tu usuario para ver las listas de tu grupo.'}</p><div class="vact"><a class="btn primary" href="#cuenta">${App.ICONS.cuenta}${s.status === 'noprofile' ? 'Poner el código' : 'Entrar o crear usuario'}</a></div></div>`;
      return;
    }
    const g = Cloud.group;
    if (!g || this.loading) { this.el.innerHTML = `${head}<div class="card"><p class="note">Cargando el grupo…</p></div>`; return; }
    if (g.error) { this.el.innerHTML = `${head}<div class="banner tone-warn"><span>${esc(g.error)}</span></div>`; return; }

    if (this.who) {
      // página de un jugador
      if (!sel) { this.el.innerHTML = `<a class="back" href="#grupo">← Grupo</a><div class="card"><p class="note">No encontré a ${esc(this.who)} en el grupo.</p></div>`; return; }
      const ps = Cloud.playerScore(sel.uid);
      const n = g.decks.filter(d => d.owner === sel.uid).length;
      const yo = Cloud.me && sel.uid === Cloud.me.uid;
      this.el.innerHTML = `<a class="back" href="#grupo">← Grupo</a>
        <div class="card player-top">
          <span class="avatar big">${esc(sel.username.slice(0, 1).toUpperCase())}</span>
          <div><h1>${esc(sel.username)}${yo ? ' <small>(vos)</small>' : ''}</h1>
            <p class="note">${App.plural(n, 'mazo', 'mazos')}${ps.n ? ` · sus mazos tienen ${Stars.line(ps)}` : ''}</p></div>
        </div>
        ${this.sortSeg()}
        <div id="gr-decks"></div>`;
      this.lists();
      return;
    }
    this.el.innerHTML = `${head}
      <label class="sr" for="gr-q">Buscar</label>
      <input class="field big" id="gr-q" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Buscar jugador, mazo o líder" value="${esc(this.q)}">
      <h2 class="sec">Jugadores</h2>
      <div class="players" id="gr-players"></div>
      <div class="sec-row"><h2 class="sec">Mazos</h2>${this.sortSeg()}</div>
      <div id="gr-decks"></div>`;
    this.lists();
  },
  sortSeg() {
    const o = [['recientes', 'Recientes'], ['valorados', 'Mejor valorados'], ['baratos', 'Más baratos']];
    return `<div class="seg sortseg" role="group" aria-label="Ordenar mazos">${o.map(([v, l]) => `<button type="button" data-gsort="${v}" aria-pressed="${this.sort === v}">${l}</button>`).join('')}</div>`;
  },
  // solo las listas: así el buscador no pierde el foco mientras escribís
  lists() {
    const { esc, money, Prices, plural, Cards } = App;
    const g = Cloud.group; if (!g) return;
    const norm = Cards.norm;
    const words = norm(this.q).split(' ').filter(Boolean);
    const sel = this.who ? g.users.find(u => u.username === this.who) : null;
    this.el.querySelectorAll('[data-gsort]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.gsort === this.sort)));

    const count = new Map();
    g.decks.forEach(d => count.set(d.owner, (count.get(d.owner) || 0) + 1));
    const pbox = this.el.querySelector('#gr-players');
    if (pbox) {
      const ps = g.users.filter(u => !words.length || words.every(w => norm(u.username).includes(w)));
      pbox.innerHTML = ps.length ? ps.map(u => {
        const sc = Cloud.playerScore(u.uid);
        const yo = Cloud.me && u.uid === Cloud.me.uid;
        return `<a class="player" href="#grupo/${encodeURIComponent(u.username)}">
          <span class="avatar">${esc(u.username.slice(0, 1).toUpperCase())}</span>
          <span class="pinfo"><b>${esc(u.username)}${yo ? ' (vos)' : ''}</b><small>${plural(count.get(u.uid) || 0, 'mazo', 'mazos')}</small>${Stars.line(sc)}</span>
        </a>`;
      }).join('') : `<p class="note">No hay jugadores que coincidan con “${esc(this.q)}”.</p>`;
    }

    const ready = Prices.state === 'ok';
    const leaderName = d => { const L = Decks.leader(d); return L ? (Prices.cardName(L.num) || L.num) : ''; };
    let list = g.decks.filter(d => (!sel || d.owner === sel.uid) &&
      (!words.length || sel || words.every(w => norm(`${d.name} ${d.ownerName} ${leaderName(d)}`).includes(w))));
    const sc = new Map(list.map(d => [d.id, Cloud.deckScore(d.id)]));
    const price = new Map(ready ? list.map(d => [d.id, Decks.price(d).total]) : []);
    if (this.sort === 'valorados') list.sort((a, b) => (sc.get(b.id).n ? 1 : 0) - (sc.get(a.id).n ? 1 : 0) || sc.get(b.id).avg - sc.get(a.id).avg || sc.get(b.id).n - sc.get(a.id).n);
    else if (this.sort === 'baratos' && ready) list.sort((a, b) => price.get(a.id) - price.get(b.id));
    const dbox = this.el.querySelector('#gr-decks');
    if (!dbox) return;
    dbox.innerHTML = list.length ? `<div class="decks">${list.map(d => {
      const k = Decks.counts(d);
      const mine = Cloud.me && d.owner === Cloud.me.uid;
      const ln = leaderName(d);
      return `<a class="deck withimg" href="#mazo/${encodeURIComponent(mine ? d.id : 'nube:' + d.id)}">
        <span class="dimg">${CardUI.leaderImg(d)}</span>
        <span class="dinfo">
          <small class="owner">${esc(d.ownerName)}${mine ? ' (vos)' : ''}</small>
          <b>${esc(d.name)}</b>
          <small>${ln ? `Líder: ${esc(ln)} · ` : ''}${plural(k.main, 'carta', 'cartas')}${k.leader ? ' + líder' : ''}</small>
          ${Stars.line(sc.get(d.id))}
          ${ready ? `<span class="price">${money(price.get(d.id))}</span>` : `<span class="price none">${esc(Prices.state === 'loading' ? 'Calculando…' : 'Sin precios todavía')}</span>`}
        </span>
      </a>`;
    }).join('')}</div>` : `<div class="card"><p class="note">${sel ? `${esc(sel.username)} todavía no subió mazos.` : words.length ? `No hay mazos que coincidan con “${esc(this.q)}”.` : 'Nadie subió mazos todavía. Los tuyos aparecen acá apenas los guardás.'}</p></div>`;
  },
});

/* ---------- Cuenta ---------- */
App.register({
  id: 'cuenta', title: 'Cuenta', short: 'Cuenta', nav: true, home: true, icon: App.ICONS.cuenta,
  desc: 'Creá tu usuario o entrá para compartir tus mazos con tu grupo. Con un mail podés recuperar tu contraseña.',
  status() { const s = Cloud.state.status; return s === 'in' && Cloud.me ? `Entraste como ${Cloud.me.username}` : s === 'off' ? 'Falta conectar Firebase' : 'Sin entrar'; },
  init(el) {
    this.el = el; this.mode = 'entrar'; this.msg = null; this.ok = null;
    App.on('cloud', () => {
      if (Cloud.state.status === 'out' && Cloud.state.flash) this.mode = 'entrar'; // la sesión se cerró sola: mostramos cómo volver a entrar
      if (App.currentId() === 'cuenta' && !this.busy) this.render();
    });
    el.addEventListener('click', e => {
      const t = e.target;
      const m = t.closest('[data-mode]'); if (m) { this.mode = m.dataset.mode; this.msg = null; this.ok = null; this.render(); return; }
      if (t.closest('#cu-sync')) { Cloud.sync(); return; }
      if (t.closest('#cu-retry')) { Cloud.boot(); return; }
      if (t.closest('#cu-check')) { Cloud.checkEmail().then(() => { if (Cloud.account().pending) App.toast('Todavía no se confirmó. Tocá el link del mail y volvé.'); }); return; }
      if (t.closest('#cu-out')) { this.mode = 'entrar'; Cloud.signOut(false); return; }
      if (t.closest('#cu-out-clear')) { this.mode = 'entrar'; Cloud.signOut(true).then(() => App.toast('Saliste y se borraron tus mazos de este dispositivo')); return; }
    });
    el.addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target; const v = id => (f.querySelector(id) || {}).value || '';
      this.busy = true; this.msg = null; this.ok = null; this.lock(f, true);
      try {
        if (f.id === 'f-in') { await Cloud.signIn(v('#cu-user'), v('#cu-pass')); }
        else if (f.id === 'f-up') {
          if (v('#cu-pass') !== v('#cu-pass2')) throw new Error('Las contraseñas no coinciden.');
          await Cloud.signUp(v('#cu-user'), v('#cu-pass'), v('#cu-code'), v('#cu-mail'));
          App.toast('¡Listo! Ya tenés tu usuario');
        } else if (f.id === 'f-code') { await Cloud.completeProfile(v('#cu-code')); App.toast('¡Listo! Ya estás en el grupo'); }
        else if (f.id === 'f-pass') {
          if (v('#cu-new') !== v('#cu-new2')) throw new Error('Las contraseñas nuevas no coinciden.');
          await Cloud.changePassword(v('#cu-cur'), v('#cu-new')); f.reset(); App.toast('Cambiaste tu contraseña');
        } else if (f.id === 'f-mail') {
          await Cloud.addEmail(v('#cu-mail'), v('#cu-mpass'));
          this.ok = { form: 'f-mail', text: `Te mandamos un mail a ${v('#cu-mail').trim().toLowerCase()}. Abrilo y tocá el link para confirmarlo (si no llega, mirá en spam).` };
        } else if (f.id === 'f-reset') {
          await Cloud.resetPassword(v('#cu-rmail'));
          this.ok = { form: 'f-reset', text: 'Si ese mail está en una cuenta, te llega un link para elegir una contraseña nueva. Mirá también en spam. Después volvé y entrá con tu usuario o tu mail.' };
        }
      } catch (err) { this.msg = { form: f.id, text: err.message }; }
      this.busy = false; this.render();
    });
  },
  lock(f, on) { f.querySelectorAll('button, input').forEach(x => { x.disabled = on; }); },
  show() { this.msg = null; this.ok = null; if (this.mode === 'recuperar') this.mode = 'entrar'; this.render(); Cloud.checkEmail(); },
  render() {
    const { esc } = App;
    const s = Cloud.state;
    const err = id => (this.msg && this.msg.form === id ? `<div class="banner tone-bad" role="alert"><span>${esc(this.msg.text)}</span></div>` : '');
    const ok = id => (this.ok && this.ok.form === id ? `<div class="banner tone-ok" role="status"><span>${esc(this.ok.text)}</span></div>` : '');
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
      const acc = Cloud.account();
      const mailForm = (title, btn) => `
          <form class="auth" id="f-mail" novalidate>
            <input type="text" class="sr" autocomplete="username" value="${esc(Cloud.me.username)}" tabindex="-1" aria-hidden="true">
            ${title ? `<h3>${title}</h3>` : ''}
            <div><label class="flabel" for="cu-mail">Tu mail</label><input class="field" id="cu-mail" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" value="${esc(acc.pending || '')}" required></div>
            <div><label class="flabel" for="cu-mpass">Tu contraseña</label><input class="field" id="cu-mpass" type="password" autocomplete="current-password" required><small class="fhint">Te la pedimos para confirmar que sos vos.</small></div>
            ${err('f-mail')}${ok('f-mail')}
            <div class="vact"><button type="submit" class="btn${acc.email ? '' : ' primary'}">${btn}</button></div>
          </form>`;
      const mailCard = acc.email
        ? `<div class="card mailcard">
            <h2>Mail para recuperar la cuenta</h2>
            <p class="mailok"><span class="okdot" aria-hidden="true">✓</span><span><b>${esc(acc.email)}</b><small>Confirmado. Con este mail podés entrar desde cualquier dispositivo y recuperar tu contraseña si te la olvidás.</small></span></p>
            ${acc.pending && acc.pending !== acc.email ? `<p class="note">Estás cambiándolo por <b>${esc(acc.pending)}</b>: tocá el link que te mandamos.</p>` : ''}
            <details${this.msg && this.msg.form === 'f-mail' || (this.ok && this.ok.form === 'f-mail') ? ' open' : ''}><summary>Cambiar el mail</summary>${mailForm('', 'Mandar link al mail nuevo')}</details>
          </div>`
        : acc.pending
          ? `<div class="card mailcard">
              <h2>Mail para recuperar la cuenta</h2>
              ${ok('f-mail')}
              <p class="note">Te mandamos un link a <b>${esc(acc.pending)}</b>. Abrí ese mail (mirá también en spam) y tocalo para confirmarlo. Hasta entonces seguís entrando con tu usuario.</p>
              <div class="vact"><button type="button" class="btn primary" id="cu-check">Ya lo confirmé</button></div>
              <details${this.msg && this.msg.form === 'f-mail' ? ' open' : ''}><summary>¿No te llegó? Mandarlo de nuevo u otro mail</summary>${mailForm('', 'Mandar el link de nuevo')}</details>
            </div>`
          : `<div class="card mailcard">
              <h2>Agregá un mail para recuperar la cuenta</h2>
              <p class="note">Si te olvidás la contraseña, te mandamos un link a este mail para elegir otra. También vas a poder entrar con el mail desde cualquier dispositivo. Solo vos lo ves: el grupo no.</p>
              ${mailForm('', 'Mandar link de confirmación')}
            </div>`;
      this.el.innerHTML = `${head}
        <div class="card">
          <div class="who"><span class="avatar">${esc(Cloud.me.username.slice(0, 1).toUpperCase())}</span><div><small>Entraste como</small><b>${esc(Cloud.me.username)}</b></div></div>
          <p class="note">${s.syncing ? 'Sincronizando tus mazos…' : last ? `Tus mazos están sincronizados (última vez a las ${last}).` : 'Tus mazos se sincronizan solos cuando hay internet.'} En otro dispositivo, entrá con tu usuario${acc.email ? ' o tu mail' : ''} y tu contraseña: tus mazos se bajan solos.</p>
          ${s.error ? `<div class="banner tone-warn"><span>${esc(s.error)}</span></div>` : ''}
          <div class="vact"><button type="button" class="btn" id="cu-sync">Sincronizar ahora</button><a class="btn ghost" href="#grupo">${App.ICONS.grupo}Ver el grupo</a></div>
        </div>
        ${mailCard}
        <form class="card auth" id="f-pass" novalidate>
          <h2>Cambiar contraseña</h2>
          <input type="text" class="sr" autocomplete="username" value="${esc(acc.email || Cloud.me.username)}" tabindex="-1" aria-hidden="true">
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
    if (this.mode === 'recuperar') {
      this.el.innerHTML = `${head}
        <a class="back" href="#cuenta" data-mode="entrar">← Entrar</a>
        <form class="card auth" id="f-reset" novalidate>
          <h2>Recuperar la contraseña</h2>
          <p class="note">Escribí el mail que le agregaste a tu cuenta y te mandamos un link para elegir una contraseña nueva.</p>
          <div><label class="flabel" for="cu-rmail">Tu mail</label><input class="field" id="cu-rmail" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" required></div>
          ${err('f-reset')}${ok('f-reset')}
          <div class="vact"><button type="submit" class="btn primary">Mandarme el link</button></div>
          <p class="fhint">Si nunca le agregaste un mail a tu cuenta, no se puede recuperar por acá: pedile ayuda a quien administra el grupo.</p>
        </form>`;
      return;
    }
    const up = this.mode === 'crear';
    this.el.innerHTML = `${head}
      ${s.flash && !up ? `<div class="banner tone-ok" role="status"><span>${esc(s.flash)}</span></div>` : ''}
      <div class="seg" role="tablist" aria-label="Elegí">
        <button type="button" role="tab" data-mode="entrar" aria-checked="${!up}" aria-selected="${!up}">Entrar</button>
        <button type="button" role="tab" data-mode="crear" aria-checked="${up}" aria-selected="${up}">Crear usuario</button>
      </div>
      <form class="card auth" id="${up ? 'f-up' : 'f-in'}" novalidate>
        <h2>${up ? 'Crear usuario' : 'Entrar'}</h2>
        <div><label class="flabel" for="cu-user">${up ? 'Usuario' : 'Usuario o mail'}</label><input class="field" id="cu-user" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="${up ? 20 : 100}" required>
          ${up ? '<small class="fhint">De 3 a 20 letras o números, sin espacios. Es único: nadie más puede usarlo.</small>' : ''}</div>
        <div><label class="flabel" for="cu-pass">Contraseña</label><input class="field" id="cu-pass" type="password" autocomplete="${up ? 'new-password' : 'current-password'}" minlength="6" required>
          ${up ? '<small class="fhint">Al menos 6 caracteres.</small>' : ''}</div>
        ${up ? `<div><label class="flabel" for="cu-pass2">Repetí la contraseña</label><input class="field" id="cu-pass2" type="password" autocomplete="new-password" minlength="6" required></div>
        <div><label class="flabel" for="cu-code">Código del grupo</label><input class="field" id="cu-code" autocomplete="off" autocapitalize="none" spellcheck="false" required><small class="fhint">Te lo pasa quien armó la app.</small></div>
        <div><label class="flabel" for="cu-mail">Mail <span class="opt-l">(opcional)</span></label><input class="field" id="cu-mail" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false"><small class="fhint">Para recuperar la contraseña si te la olvidás. Te mandamos un link para confirmarlo. El grupo no lo ve.</small></div>` : ''}
        ${err(up ? 'f-up' : 'f-in')}
        <div class="vact"><button type="submit" class="btn primary">${up ? 'Crear usuario' : 'Entrar'}</button>${up ? '' : '<button type="button" class="btn ghost" data-mode="recuperar">¿Te olvidaste la contraseña?</button>'}</div>
      </form>`;
  },
});

Stars.wire();

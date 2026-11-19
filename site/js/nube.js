/* Nube: usuarios con contraseña y mail de recuperación, grupos con nombre y código, mazos privados que
   cada uno comparte en los grupos que quiere, y valoraciones, con Firebase.
   La configuración va en js/firebase-config.js. Las reglas de seguridad (firestore.rules)
   controlan quién entra a cada grupo, quién ve cada mazo y quién puede escribir cada cosa. */
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
  const CODE_RE = /^[a-z0-9_-]{4,30}$/;

  let fb = null;                // { auth, db, A, F }
  let me = null;                // { uid, username, profile, groups: [ids de mis grupos] }
  const st = { status: configured ? 'loading' : 'off', error: null, lastSync: null, syncing: false, notice: null, flash: null, groupsError: null };
  let groups = new Map(), groupsAt = 0, groupsLoading = null, pendingAgain = false, syncTimer = null;

  const emit = () => { App.emit('cloud', st); paintAccount(); };
  const iso = () => new Date().toISOString();
  const normUser = u => String(u || '').trim().toLowerCase();
  // los códigos no distinguen mayúsculas, tildes ni espacios: "Mi Grupo" = "migrupo"
  const normCode = c => String(c || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '');
  const toEmail = u => `${u}@${DOMAIN}`;
  const internal = e => String(e || '').toLowerCase().endsWith('@' + DOMAIN);
  const appBase = () => `${location.origin}${location.pathname}`;
  const appUrl = () => `${appBase()}#cuenta`;
  const newId = () => { const a = 'abcdefghijklmnopqrstuvwxyz0123456789'; const r = crypto.getRandomValues(new Uint8Array(20)); return Array.from(r, x => a[x % a.length]).join(''); };

  // en cada dispositivo recordamos con qué mail entra cada usuario, para que pueda seguir escribiendo su usuario
  const LKEY = 'bitacora-logins-v1', PKEY = 'bitacora-mail-pendiente-v1', YKEY = 'bitacora-yo-v1';
  const logins = () => App.store.get(LKEY, {});
  const saveLogin = (u, e) => { const m = logins(); m[u] = e; App.store.set(LKEY, m); };
  const pendings = () => App.store.get(PKEY, {});
  const pendingFor = u => pendings()[u] || null;
  const setPending = (u, e) => { const m = pendings(); if (e) m[u] = e; else delete m[u]; App.store.set(PKEY, m); };
  const knownName = uid => App.store.get(YKEY, {})[uid];
  const rememberName = (uid, name) => { const m = App.store.get(YKEY, {}); if (m[uid] !== name) { m[uid] = name; App.store.set(YKEY, m); } };
  // código de una invitación que abriste antes de tener usuario
  const INV = 'bitacora-invitacion';
  const invitation = { get: () => { try { return sessionStorage.getItem(INV) || ''; } catch (e) { return ''; } }, set: c => { try { if (c) sessionStorage.setItem(INV, c); else sessionStorage.removeItem(INV); } catch (e) { /* sin sessionStorage */ } } };

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
    groups = new Map(); groupsAt = 0;
    if (!u) {
      // si la sesión se cerró sola (por ejemplo, Firebase la cierra al confirmar el mail nuevo), avisamos por qué
      if (me && !leaving && !st.flash) st.flash = 'Se cerró tu sesión: si recién confirmaste tu mail o cambiaste la contraseña en otro dispositivo, es normal. Volvé a entrar con tu usuario o tu mail.';
      leaving = false; me = null; st.status = 'out'; emit(); return;
    }
    if (busySignup) return; // el registro termina de armar el perfil por su cuenta
    const guess = knownName(u.uid) || (internal(u.email) ? String(u.email).split('@')[0] : 'jugador');
    try {
      const snap = await fb.F.getDoc(fb.F.doc(fb.db, 'users', u.uid));
      if (!snap.exists()) { me = { uid: u.uid, username: guess, profile: null, groups: [] }; st.status = 'noprofile'; emit(); return; }
      const data = snap.data();
      me = { uid: u.uid, username: data.username || guess, profile: data, groups: Array.isArray(data.groups) ? data.groups.slice() : [] };
      rememberName(u.uid, me.username);
      if (!internal(u.email)) { saveLogin(me.username, String(u.email).toLowerCase()); if (pendingFor(me.username) === String(u.email).toLowerCase()) setPending(me.username, null); }
      st.status = 'in'; st.flash = null; emit();
      adoptDevice();
      sync();
      ensureRegistry().catch(() => {}); // usuarios anteriores al registro de nombres: lo reservamos ahora
      // quienes se registraron antes de que hubiera varios grupos entran solos al grupo de su código
      if (!me.groups.length && data.codigo) joinByCode(data.codigo).catch(() => {});
      else loadGroups();
    } catch (e) {
      if (/permission-denied/.test(e.code || '')) { me = { uid: u.uid, username: guess, profile: null, groups: [] }; st.status = 'noprofile'; emit(); return; }
      // sin conexión: dejamos la sesión abierta y sincronizamos cuando vuelva internet
      me = { uid: u.uid, username: guess, profile: null, groups: [] }; st.status = 'in'; st.error = friendly(e); emit();
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
    if (!ok) throw new Error('Tu nombre de usuario figura a nombre de otra cuenta. Avisale a quien administra la app.');
  }

  // crea el perfil (users/<uid>); si vino con el código de un grupo, entra a ese grupo
  async function createProfile(user, username, code) {
    const { F, db } = fb;
    if (code) {
      const snap = await F.getDoc(F.doc(db, 'codes', code));
      if (!snap.exists()) throw new Error('No hay ningún grupo con ese código. Revisalo con quien te lo pasó o dejalo vacío.');
    }
    const profile = code ? { username, codigo: code, creado: iso(), groups: [] } : { username, creado: iso(), groups: [] };
    try { await F.setDoc(F.doc(db, 'users', user.uid), profile); }
    catch (e) { if (/permission-denied/.test(e.code || '')) throw new Error('No pude crear tu perfil con ese código.'); throw e; }
    me = { uid: user.uid, username, profile, groups: [] };
    if (code) await joinByCode(code);
    invitation.set('');
  }

  async function signUp(username, password, code, mail) {
    username = normUser(username);
    code = normCode(code);
    mail = String(mail || '').trim().toLowerCase();
    if (!USER_RE.test(username)) throw new Error('El usuario tiene que tener de 3 a 20 letras, números, puntos, guiones o guiones bajos, sin espacios.');
    if (String(password).length < 6) throw new Error('La contraseña tiene que tener al menos 6 caracteres.');
    if (code && !CODE_RE.test(code)) throw new Error('El código tiene que tener de 4 a 30 letras, números o guiones, sin espacios.');
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
        if (created) { try { await A.deleteUser(created); } catch (e) { /* queda una cuenta vacía que no entra a nada */ } }
        await A.signOut(auth).catch(() => {});
        throw new Error('Ese usuario ya existe. Elegí otro.');
      }
      try { await createProfile(cred.user, username, code); }
      catch (e) { leaving = true; await A.signOut(auth).catch(() => {}); throw e; }
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
    code = normCode(code);
    if (code && !CODE_RE.test(code)) throw new Error('El código tiene que tener de 4 a 30 letras, números o guiones, sin espacios.');
    try {
      if (!(await claimName(me.username, me.uid))) throw new Error('Ese usuario ya es de otra cuenta.');
      busySignup = true;
      await createProfile(fb.auth.currentUser, me.username, code);
    } catch (e) { throw new Error(e.code ? friendly(e) : e.message); }
    finally { busySignup = false; }
    await onUser(fb.auth.currentUser);
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

  // ---- sincronización de mis mazos (privados; cada uno elige en qué grupos compartirlos) ----
  const myGroupsOf = d => (d.groups || []).filter(g => me && me.groups.includes(g));
  const toRemote = d => {
    const now = iso();
    return {
      owner: me.uid, ownerName: me.username, name: String(d.name || 'Mazo sin nombre').slice(0, 80),
      cards: d.cards.slice(0, 80).map(c => ({ num: c.num, qty: c.qty, pick: c.pick || null })),
      created: d.created || d.updated || now, updated: d.updated || now, groups: (d.groups || []).slice(0, 30),
    };
  };
  const toShared = d => { const r = toRemote(d); delete r.groups; return r; };
  const fromRemote = r => ({ id: r.id, name: r.name, cards: (r.cards || []).map(c => ({ num: c.num, qty: c.qty, pick: c.pick || null })), created: r.created, updated: r.updated, owner: r.owner, groups: Array.isArray(r.groups) ? r.groups : [], synced: true, dirty: false });

  async function push(d) {
    const { F, db } = fb;
    d.groups = myGroupsOf(d);
    const shared = toShared(d);
    for (const gid of d.groups.slice()) {
      try { await F.setDoc(F.doc(db, 'groups', gid, 'decks', d.id), shared); }
      catch (e) { if (/permission-denied/.test(e.code || '')) d.groups = d.groups.filter(x => x !== gid); else throw e; }
    }
    await F.setDoc(F.doc(db, 'decks', d.id), toRemote(d));
    d.dirty = false; d.synced = true; d.owner = me.uid; d.ejemplo = false;
  }

  async function sync() {
    if (!fb || !me || st.status !== 'in') return;
    if (st.syncing) { pendingAgain = true; return; }
    st.syncing = true; emit();
    const { F, db } = fb;
    try {
      // mazos borrados: primero se sacan de los grupos donde estaban compartidos
      for (const id of Decks.tombs()) {
        let where = [];
        try { const s = await F.getDoc(F.doc(db, 'decks', id)); if (s.exists()) where = s.data().groups || []; } catch (e) { /* no estaba en la nube */ }
        for (const gid of where) { try { await F.deleteDoc(F.doc(db, 'groups', gid, 'decks', id)); } catch (e) { /* ya no estaba */ } }
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
      if (up && !st.notice) { st.notice = `Guardaste ${App.plural(up, 'mazo', 'mazos')} en tu cuenta.`; App.toast(st.notice); }
    } catch (e) {
      st.error = friendly(e);
    }
    st.syncing = false; emit();
    if (pendingAgain) { pendingAgain = false; sync(); }
  }
  const syncSoon = () => { clearTimeout(syncTimer); syncTimer = setTimeout(sync, 1200); };

  // ---- grupos ----
  async function saveGroups(list) {
    const p = { ...me.profile, groups: list.slice(0, 30) };
    await fb.F.setDoc(fb.F.doc(fb.db, 'users', me.uid), p);
    me.profile = p; me.groups = p.groups.slice();
  }

  async function loadGroups(force) {
    if (!fb || !me || st.status !== 'in') return null;
    if (!force && groupsAt && Date.now() - groupsAt < 60000) return groups;
    if (groupsLoading) return groupsLoading;
    groupsLoading = (async () => {
      const { F, db } = fb;
      const next = new Map(), gone = [];
      let error = null;
      await Promise.all(me.groups.map(async gid => {
        try {
          const [gs, ms, ds, rs] = await Promise.all([
            F.getDoc(F.doc(db, 'groups', gid)), F.getDocs(F.collection(db, 'groups', gid, 'members')),
            F.getDocs(F.collection(db, 'groups', gid, 'decks')), F.getDocs(F.collection(db, 'groups', gid, 'ratings')),
          ]);
          if (!gs.exists()) { gone.push(gid); return; }
          const members = [];
          ms.forEach(doc => members.push({ uid: doc.id, username: doc.data().username, joined: doc.data().joined }));
          members.sort((a, b) => a.username.localeCompare(b.username));
          const names = new Map(members.map(m => [m.uid, m.username]));
          const decks = [];
          ds.forEach(doc => { const r = doc.data(); decks.push({ ...fromRemote({ id: doc.id, ...r }), gid, ownerName: names.get(r.owner) || r.ownerName || 'jugador' }); });
          decks.sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
          const ratings = [];
          rs.forEach(doc => { const r = doc.data(); ratings.push({ id: doc.id, deck: r.deck, uid: r.uid, stars: r.stars, text: r.text || '', updated: r.updated, username: names.get(r.uid) || 'jugador' }); });
          next.set(gid, { id: gid, ...gs.data(), members, names, decks, ratings });
        } catch (e) {
          if (/permission-denied/.test(e.code || '')) gone.push(gid);       // ya no estoy en ese grupo
          else { error = friendly(e); if (groups.has(gid)) next.set(gid, groups.get(gid)); }
        }
      }));
      groups = next; groupsAt = Date.now(); st.groupsError = error;
      if (gone.length) { try { await saveGroups(me.groups.filter(g => !gone.includes(g))); } catch (e) { /* se reintenta la próxima vez */ } }
      App.emit('group', groups);
      return groups;
    })();
    try { return await groupsLoading; } finally { groupsLoading = null; }
  }
  const groupList = () => [...groups.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const group = gid => groups.get(gid) || null;
  const groupDeck = (gid, id) => { const g = groups.get(gid); return g ? g.decks.find(d => d.id === id) || null : null; };

  async function joinByCode(code) {
    code = normCode(code);
    if (!CODE_RE.test(code)) throw new Error('El código tiene que tener de 4 a 30 letras, números o guiones, sin espacios.');
    const { F, db } = fb;
    let snap;
    try { snap = await F.getDoc(F.doc(db, 'codes', code)); } catch (e) { throw new Error(friendly(e)); }
    if (!snap.exists()) throw new Error('No hay ningún grupo con ese código. Revisalo con quien te lo pasó.');
    const gid = snap.data().group;
    if (!me.groups.includes(gid)) {
      let already = false;
      try { already = (await F.getDoc(F.doc(db, 'groups', gid))).exists(); } catch (e) { already = false; }
      if (!already) {
        try { await F.setDoc(F.doc(db, 'groups', gid, 'members', me.uid), { username: me.username, joined: iso(), via: code }); }
        catch (e) { throw new Error(friendly(e)); }
      }
      await saveGroups([...me.groups, gid]);
    }
    await loadGroups(true);
    return gid;
  }

  async function createGroup(name, code) {
    name = String(name || '').trim().replace(/\s+/g, ' ');
    code = normCode(code);
    if (name.length < 2 || name.length > 40) throw new Error('El nombre tiene que tener de 2 a 40 letras.');
    if (!CODE_RE.test(code)) throw new Error('El código tiene que tener de 4 a 30 letras, números o guiones, sin espacios ni tildes.');
    if (me.groups.length >= 30) throw new Error('Ya estás en 30 grupos: salí de alguno para crear otro.');
    const { F, db } = fb;
    try {
      if ((await F.getDoc(F.doc(db, 'codes', code))).exists()) throw new Error('Ese código ya lo usa otro grupo. Elegí otro.');
      const gid = newId();
      const b = F.writeBatch(db);
      b.set(F.doc(db, 'groups', gid), { name, owner: me.uid, code, created: iso() });
      b.set(F.doc(db, 'codes', code), { group: gid });
      b.set(F.doc(db, 'groups', gid, 'members', me.uid), { username: me.username, joined: iso() });
      await b.commit();
      await saveGroups([...me.groups, gid]);
      await loadGroups(true);
      return gid;
    } catch (e) { throw new Error(e.code ? friendly(e) : e.message); }
  }

  async function renameGroup(gid, name) {
    name = String(name || '').trim().replace(/\s+/g, ' ');
    if (name.length < 2 || name.length > 40) throw new Error('El nombre tiene que tener de 2 a 40 letras.');
    const g = groups.get(gid); if (!g) return;
    try { await fb.F.setDoc(fb.F.doc(fb.db, 'groups', gid), { name, owner: g.owner, code: g.code, created: g.created }); }
    catch (e) { throw new Error(friendly(e)); }
    g.name = name; App.emit('group', groups);
  }

  async function leaveGroup(gid) {
    const { F, db } = fb;
    const g = groups.get(gid);
    // mis mazos dejan de estar compartidos ahí
    for (const d of Decks.all()) if ((d.groups || []).includes(gid)) { d.groups = d.groups.filter(x => x !== gid); Decks.update(d); }
    const mine = g ? g.decks.filter(d => d.owner === me.uid).map(d => d.id) : [];
    for (const id of mine) { try { await F.deleteDoc(F.doc(db, 'groups', gid, 'decks', id)); } catch (e) { /* ya no estaba */ } }
    try { await F.deleteDoc(F.doc(db, 'groups', gid, 'members', me.uid)); } catch (e) { if (!/permission-denied|not-found/.test(e.code || '')) throw new Error(friendly(e)); }
    await saveGroups(me.groups.filter(x => x !== gid));
    groups.delete(gid);
    App.emit('group', groups);
    sync();
  }

  // compartir o dejar de compartir uno de mis mazos en un grupo
  async function share(deckId, gid, on) {
    const d = Decks.get(deckId);
    if (!d || !me) return;
    const set = new Set(myGroupsOf(d));
    if (on) set.add(gid); else set.delete(gid);
    d.groups = [...set];
    Decks.update(d);
    if (!on) { try { await fb.F.deleteDoc(fb.F.doc(fb.db, 'groups', gid, 'decks', d.id)); } catch (e) { /* no estaba */ } }
    await sync();
    await loadGroups(true);
  }
  // cómo se ve en la lista de mazos: "Privado" o "Compartido en Mi Grupo"
  function shareLabel(d) {
    if (!me || st.status !== 'in' || (d.ejemplo && !d.synced)) return '';
    const g = myGroupsOf(d);
    if (!g.length) return 'Privado';
    const names = g.map(x => groups.get(x)).filter(Boolean).map(x => x.name);
    return names.length === g.length ? `Compartido en ${names.join(', ')}` : `Compartido en ${App.plural(g.length, 'grupo', 'grupos')}`;
  }

  // ---- valoraciones (por grupo) ----
  function ratingsOf(gid, deckId) {
    const g = groups.get(gid);
    return g ? g.ratings.filter(r => r.deck === deckId).sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || ''))) : [];
  }
  function score(list) { const n = list.length; return { n, avg: n ? list.reduce((s, r) => s + r.stars, 0) / n : 0 }; }
  const deckScore = (gid, deckId) => score(ratingsOf(gid, deckId));
  function playerScore(gid, uid) {
    const g = groups.get(gid); if (!g) return score([]);
    const ids = new Set(g.decks.filter(d => d.owner === uid).map(d => d.id));
    return score(g.ratings.filter(r => ids.has(r.deck)));
  }
  // lo que recibió uno de mis mazos en todos los grupos donde está compartido
  function receivedRatings(deckId) {
    const out = [];
    for (const g of groups.values()) for (const r of g.ratings) if (r.deck === deckId && g.decks.some(d => d.id === deckId)) out.push({ ...r, gid: g.id, groupName: g.name });
    return out.sort((a, b) => String(b.updated || '').localeCompare(String(a.updated || '')));
  }
  async function rate(gid, deckId, stars, text) {
    stars = Math.round(+stars);
    if (!(stars >= 1 && stars <= 5)) throw new Error('Elegí de 1 a 5 estrellas.');
    const d = groupDeck(gid, deckId);
    if (!d) throw new Error('No encontré ese mazo.');
    if (d.owner === me.uid) throw new Error('No podés valorar tus propios mazos.');
    const data = { deck: deckId, uid: me.uid, stars, text: String(text || '').trim().slice(0, 280), updated: iso() };
    const id = `${deckId}_${me.uid}`;
    try { await fb.F.setDoc(fb.F.doc(fb.db, 'groups', gid, 'ratings', id), data); }
    catch (e) { throw new Error(friendly(e)); }
    const g = groups.get(gid);
    g.ratings = g.ratings.filter(r => r.id !== id).concat({ id, ...data, username: me.username });
    App.emit('group', groups);
  }
  async function unrate(gid, deckId) {
    const id = `${deckId}_${me.uid}`;
    try { await fb.F.deleteDoc(fb.F.doc(fb.db, 'groups', gid, 'ratings', id)); }
    catch (e) { throw new Error(friendly(e)); }
    const g = groups.get(gid);
    if (g) g.ratings = g.ratings.filter(r => r.id !== id);
    App.emit('group', groups);
  }

  // texto para invitar a alguien a un grupo
  const inviteLink = g => `${appBase()}#grupo/unirme:${encodeURIComponent(g.code)}`;
  const inviteText = g => `Sumate a mi grupo “${g.name}” en Bitácora OPTCG: ${inviteLink(g)}\nEl código es ${g.code}: si todavía no tenés usuario, ponelo al crearlo y entrás directo.`;

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
    if (st.status === 'in' && me) return `<p class="note">${st.syncing ? 'Sincronizando…' : `Se guardan en tu usuario <b>${esc(me.username)}</b>. Son privados: en cada mazo elegís en qué grupos compartirlo.`}${st.error ? ` <span class="warn-t">${esc(st.error)}</span>` : ''}</p>`;
    return `<p class="note">Se guardan solo en este dispositivo. <a href="#cuenta">Entrá con tu usuario</a> para tenerlos en todos lados y compartirlos con tus grupos.</p>`;
  }

  App.on('decks-local', () => { if (st.status === 'in') syncSoon(); });
  window.addEventListener('online', () => { if (st.status === 'error') boot(); else sync(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { sync(); checkEmail(); } });

  return {
    get configured() { return configured; }, get me() { return me; }, state: st,
    boot, signUp, signIn, signOut, completeProfile, changePassword, sync, listNote, USER_RE, normCode, CODE_RE, invitation,
    account, addEmail, checkEmail, resetPassword,
    loadGroups, groupList, group, groupDeck, joinByCode, createGroup, renameGroup, leaveGroup, share, shareLabel,
    get groupsLoaded() { return !!groupsAt; },
    ratingsOf, deckScore, playerScore, receivedRatings, rate, unrate, inviteLink, inviteText,
  };
})();

/* ---------- estrellas, compartir y valoraciones (en la vista de cada mazo) ---------- */
const Stars = (() => {
  const { esc } = App;
  const fmt = n => n.toLocaleString('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  // ★★★★☆ redondeado a la estrella más cercana
  const show = (avg, cls = '') => {
    const full = Math.round(avg);
    return `<span class="stars ${cls}" aria-hidden="true">${'★'.repeat(full)}<i>${'★'.repeat(5 - full)}</i></span>`;
  };
  const summary = s => (s.n ? `${show(s.avg)}<b>${fmt(s.avg)}</b><small>${App.plural(s.n, 'valoración', 'valoraciones')}</small>` : '<small class="muted">Sin valoraciones todavía</small>');
  const line = s => (s.n ? `<span class="rline" title="${fmt(s.avg)} de 5 · ${App.plural(s.n, 'valoración', 'valoraciones')}">${show(s.avg)} ${fmt(s.avg)} <small>(${s.n})</small></span>` : '');
  const item = (r, extra) => `<li><div class="rhead2"><b>${esc(r.username)}</b>${show(r.stars)}${extra ? `<span class="rgroup">${esc(extra)}</span>` : ''}<small>${esc(App.fdate(r.updated))}</small></div>${r.text ? `<p>${esc(r.text)}</p>` : ''}</li>`;
  const signedIn = () => typeof Cloud !== 'undefined' && Cloud.configured && Cloud.state.status === 'in' && Cloud.me;

  // mazo de otro jugador dentro de un grupo: promedio, tu valoración y las de los demás
  let draft = null; // { key, stars, text } mientras la estás escribiendo
  function groupBlock(gid, deck) {
    if (!signedIn()) return '';
    const g = Cloud.group(gid);
    if (!g) return '';
    const list = Cloud.ratingsOf(gid, deck.id);
    const s = Cloud.deckScore(gid, deck.id);
    const my = list.find(r => r.uid === Cloud.me.uid);
    const key = `${gid}|${deck.id}`;
    const d = draft && draft.key === key ? draft : { key, stars: my ? my.stars : 0, text: my ? my.text : '' };
    const others = list.filter(r => r.uid !== Cloud.me.uid);
    return `<div class="card rate-card">
      <h2>Valoraciones en ${esc(g.name)}</h2>
      <div class="rate-sum">${summary(s)}</div>
      <form class="rate-form" id="rate-form" data-gid="${esc(gid)}" data-deck="${esc(deck.id)}" novalidate>
        <span class="flabel" id="rate-lab">${my ? 'Tu valoración' : 'Valoralo'}</span>
        <div class="starpick" role="radiogroup" aria-labelledby="rate-lab">${[1, 2, 3, 4, 5].map(n => `<button type="button" role="radio" data-star="${n}" aria-checked="${d.stars === n}" class="${n <= d.stars ? 'on' : ''}" aria-label="${App.plural(n, 'estrella', 'estrellas')}">★</button>`).join('')}</div>
        <label class="sr" for="rate-text">Comentario</label>
        <textarea class="field" id="rate-text" rows="2" maxlength="280" placeholder="Comentario (opcional): qué te gusta, qué cambiarías…">${esc(d.text)}</textarea>
        <div class="vact"><button type="submit" class="btn primary">${my ? 'Guardar cambios' : 'Guardar valoración'}</button>${my ? '<button type="button" class="btn ghost" data-act="unrate">Borrar la mía</button>' : ''}</div>
      </form>
      ${others.length ? `<ul class="rlist">${others.map(r => item(r)).join('')}</ul>` : ''}
    </div>`;
  }

  // mi mazo: en qué grupos está compartido y las valoraciones que recibió
  function ownBlock(deck) {
    if (typeof Cloud === 'undefined' || !Cloud.configured) return '';
    if (!signedIn()) {
      return `<div class="card share-card"><h2>Compartir</h2><p class="note">Este mazo está solo en este dispositivo. <a href="#cuenta">Entrá con tu usuario</a> para compartirlo con tus grupos.</p></div>`;
    }
    if (!Cloud.groupsLoaded) return `<div class="card share-card"><h2>Compartir con tus grupos</h2><p class="note">Cargando tus grupos…</p></div>`;
    const gl = Cloud.groupList();
    if (!gl.length) {
      return `<div class="card share-card"><h2>Compartir con tus grupos</h2><p class="note">Este mazo es privado. Todavía no estás en ningún grupo: <a href="#grupo">creá uno o sumate con un código</a> para compartirlo.</p></div>`;
    }
    const on = new Set(deck.groups || []);
    const shared = gl.filter(g => on.has(g.id));
    const rows = gl.map(g => `<label class="share-row"><input type="checkbox" data-share="${esc(g.id)}"${on.has(g.id) ? ' checked' : ''}><span><b>${esc(g.name)}</b><small>${App.plural(g.members.length, 'jugador', 'jugadores')}</small></span></label>`).join('');
    const got = Cloud.receivedRatings(deck.id);
    const s = { n: got.length, avg: got.length ? got.reduce((a, r) => a + r.stars, 0) / got.length : 0 };
    const multi = shared.length > 1;
    return `<div class="card share-card">
        <h2>Compartir con tus grupos</h2>
        <p class="note">${shared.length ? `Lo ven los jugadores de ${shared.map(g => esc(g.name)).join(', ')}. Si lo cambiás, se actualiza ahí también.` : 'Es privado: solo lo ves vos. Marcá los grupos donde lo querés mostrar.'}</p>
        <div class="share-list" data-deck="${esc(deck.id)}">${rows}</div>
      </div>
      ${shared.length ? `<div class="card rate-card">
        <h2>Valoraciones que recibió</h2>
        <div class="rate-sum">${summary(s)}</div>
        ${got.length ? `<ul class="rlist">${got.map(r => item(r, multi ? r.groupName : '')).join('')}</ul>` : '<p class="note">Cuando alguien de tus grupos lo valore, lo vas a ver acá.</p>'}
      </div>` : ''}`;
  }

  // los eventos van en la vista del mazo
  function wire() {
    const view = document.getElementById('view-mazo');
    if (!view) return;
    const picked = f => { const b = f.querySelector('[data-star][aria-checked="true"]'); return b ? +b.dataset.star : 0; };
    view.addEventListener('click', async e => {
      const b = e.target.closest('#rate-form [data-star]');
      if (b) {
        const f = b.closest('form');
        const n = +b.dataset.star;
        draft = { key: `${f.dataset.gid}|${f.dataset.deck}`, stars: n, text: f.querySelector('#rate-text').value };
        f.querySelectorAll('[data-star]').forEach(x => { const k = +x.dataset.star; x.classList.toggle('on', k <= n); x.setAttribute('aria-checked', String(k === n)); });
        return;
      }
      const u = e.target.closest('[data-act="unrate"]');
      if (u) {
        const f = u.closest('form');
        try { await Cloud.unrate(f.dataset.gid, f.dataset.deck); draft = null; App.toast('Borraste tu valoración'); } catch (err) { App.toast(err.message); }
      }
    });
    view.addEventListener('input', e => {
      if (e.target.id !== 'rate-text') return;
      const f = e.target.closest('form');
      draft = { key: `${f.dataset.gid}|${f.dataset.deck}`, stars: picked(f), text: e.target.value };
    });
    view.addEventListener('submit', async e => {
      if (e.target.id !== 'rate-form') return;
      e.preventDefault();
      const f = e.target;
      const n = picked(f);
      if (!n) { App.toast('Tocá las estrellas para elegir de 1 a 5'); return; }
      f.querySelectorAll('button, textarea').forEach(x => { x.disabled = true; });
      try { await Cloud.rate(f.dataset.gid, f.dataset.deck, n, f.querySelector('#rate-text').value); draft = null; App.toast('Guardaste tu valoración'); }
      catch (err) { App.toast(err.message); f.querySelectorAll('button, textarea').forEach(x => { x.disabled = false; }); }
    });
    view.addEventListener('change', async e => {
      const c = e.target.closest('[data-share]');
      if (!c) return;
      const box = c.closest('.share-list');
      const g = Cloud.group(c.dataset.share);
      box.querySelectorAll('input').forEach(x => { x.disabled = true; });
      try {
        await Cloud.share(box.dataset.deck, c.dataset.share, c.checked);
        App.toast(c.checked ? `Lo compartiste en ${g ? g.name : 'el grupo'}` : `Lo sacaste de ${g ? g.name : 'el grupo'}`);
      } catch (err) { App.toast(err.message); }
      box.querySelectorAll('input').forEach(x => { x.disabled = false; });
    });
  }
  return { show, summary, line, groupBlock, ownBlock, wire, fmt };
})();

/* ---------- Grupos ---------- */
App.register({
  id: 'grupo', title: 'Grupos', short: 'Grupos', nav: true, tab: true, home: true, icon: App.ICONS.grupo,
  desc: 'Creá grupos con tus amigos o sumate con un código, compartí los mazos que quieras y valorá los de los demás.',
  status() {
    if (!Cloud.configured) return 'Falta conectar Firebase';
    if (Cloud.state.status !== 'in') return 'Entrá con tu usuario para verlos';
    const n = Cloud.groupList().length;
    return Cloud.groupsLoaded ? (n ? App.plural(n, 'grupo', 'grupos') : 'Creá un grupo o sumate a uno') : 'Tus grupos';
  },
  init(el) {
    this.el = el; this.view = { mode: 'list' }; this.q = ''; this.sort = 'recientes'; this.msg = null; this.confirmLeave = false;
    const again = () => { if (App.currentId() === 'grupo' && !this.busy) this.render(); };
    App.on('group', again); App.on('prices', again); App.on('settings', again); App.on('cards', again);
    App.on('cloud', () => { if (App.currentId() === 'grupo') { if (Cloud.state.status === 'in') Cloud.loadGroups(); again(); } });
    el.addEventListener('click', async e => {
      const t = e.target;
      if (t.closest('#gr-reload')) { this.loading = true; this.render(); await Cloud.loadGroups(true); this.loading = false; this.render(); return; }
      const s = t.closest('[data-gsort]');
      if (s) { this.sort = s.dataset.gsort; this.lists(); return; }
      const g = this.view.gid && Cloud.group(this.view.gid);
      if (t.closest('[data-act="copy-invite"]') && g) { App.copy(Cloud.inviteText(g), 'Invitación copiada: pegala en el chat de tus amigos'); return; }
      if (t.closest('[data-act="share-invite"]') && g) {
        try { await navigator.share({ title: `Grupo ${g.name}`, text: Cloud.inviteText(g) }); } catch (err) { /* lo cancelaste */ }
        return;
      }
      if (t.closest('[data-act="rename"]')) { this.renaming = !this.renaming; this.msg = null; this.render(); return; }
      if (t.closest('[data-act="leave"]') && g) {
        if (!this.confirmLeave) { this.confirmLeave = true; this.render(); return; }
        this.busy = true;
        try { await Cloud.leaveGroup(g.id); App.toast(`Saliste de ${g.name}`); App.go('grupo'); } catch (err) { App.toast(err.message); }
        this.busy = false; this.confirmLeave = false; return;
      }
      if (t.closest('[data-act="no-leave"]')) { this.confirmLeave = false; this.render(); }
    });
    el.addEventListener('input', e => {
      if (e.target.id === 'gr-q') { this.q = e.target.value; this.lists(); }
      if (e.target.id === 'gc-name') {
        const code = el.querySelector('#gc-code');
        if (code && !code.dataset.touched) code.value = this.suggest(e.target.value);
      }
      if (e.target.id === 'gc-code') e.target.dataset.touched = '1';
    });
    el.addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.target; const v = id => (f.querySelector(id) || {}).value || '';
      // lo que escribiste se mantiene si algo sale mal
      this.draft = { name: v('#gc-name'), code: v('#gc-code'), touched: !!(f.querySelector('#gc-code') || {}).dataset?.touched, jcode: v('#gj-code') };
      this.busy = true; this.msg = null; f.querySelectorAll('button, input').forEach(x => { x.disabled = true; });
      try {
        if (f.id === 'f-gcreate') {
          const gid = await Cloud.createGroup(v('#gc-name'), v('#gc-code'));
          App.toast('¡Listo! Creaste el grupo. Invitá a tus amigos con el código.');
          this.busy = false; App.go('grupo', gid); return;
        }
        if (f.id === 'f-gjoin') {
          const gid = await Cloud.joinByCode(v('#gj-code'));
          const g = Cloud.group(gid);
          App.toast(g ? `Te sumaste a ${g.name}` : 'Te sumaste al grupo');
          this.busy = false; App.go('grupo', gid); return;
        }
        if (f.id === 'f-grename') { await Cloud.renameGroup(this.view.gid, v('#gr-name')); this.renaming = false; App.toast('Cambiaste el nombre del grupo'); }
      } catch (err) { this.msg = { form: f.id, text: err.message }; }
      this.busy = false; this.render();
    });
  },
  // código sugerido a partir del nombre: "Mi Grupo" → "migrupo-482"
  suggest(name) {
    const b = Cloud.normCode(name).replace(/[^a-z0-9_-]/g, '').slice(0, 20);
    return b ? `${b}-${100 + Math.floor(Math.random() * 900)}` : '';
  },
  show(param) {
    const p = String(param || '');
    this.msg = null; this.confirmLeave = false; this.renaming = false; this.draft = null;
    if (p === 'nuevo') this.view = { mode: 'create' };
    else if (p.startsWith('unirme')) this.view = { mode: 'join', code: Cloud.normCode(p.split(':')[1] || '') };
    else if (p) { const [gid, user] = p.split('/'); this.view = { mode: 'group', gid, user: user || null }; }
    else this.view = { mode: 'list' };
    if (this.view.mode === 'join' && this.view.code && Cloud.state.status !== 'in') Cloud.invitation.set(this.view.code);
    App.Cards.load(); // imágenes de los líderes
    this.render();
    if (Cloud.state.status === 'in') Cloud.loadGroups().then(() => { if (App.currentId() === 'grupo') this.render(); });
  },
  render() {
    const { esc, plural } = App;
    const s = Cloud.state, v = this.view;
    const err = id => (this.msg && this.msg.form === id ? `<div class="banner tone-bad" role="alert"><span>${esc(this.msg.text)}</span></div>` : '');
    const head = (sub, extra = '') => `<div class="vhead"><div><h1>Grupos</h1><p>${sub}</p></div>${extra}</div>`;
    if (!Cloud.configured) { this.el.innerHTML = `${head('Para compartir mazos con amigos hay que conectar Firebase.')}<div class="card"><p class="note">El paso a paso está en el README del proyecto.</p></div>`; return; }
    if (s.status !== 'in') {
      const inv = v.mode === 'join' && v.code;
      this.el.innerHTML = `${head('Creá grupos con tus amigos, compartí los mazos que quieras y valorá los de los demás.')}
        <div class="card"><p class="note">${inv ? `Te invitaron a un grupo. Creá tu usuario (el código <b>${esc(v.code)}</b> ya queda puesto) o entrá con el tuyo y volvé a abrir la invitación.` : s.status === 'noprofile' ? 'Te falta terminar tu usuario.' : s.status === 'loading' ? 'Conectando…' : 'Entrá con tu usuario para ver tus grupos.'}</p>
        <div class="vact"><a class="btn primary" href="#cuenta">${App.ICONS.cuenta}${s.status === 'noprofile' ? 'Terminar mi usuario' : inv ? 'Crear usuario o entrar' : 'Entrar o crear usuario'}</a></div></div>`;
      return;
    }
    const dr = this.draft || {};
    if (v.mode === 'create') {
      this.el.innerHTML = `<a class="back" href="#grupo">← Grupos</a>
        <form class="card auth" id="f-gcreate" novalidate>
          <h2>Crear un grupo</h2>
          <p class="note">Ponele un nombre y un código. El código es lo que les pasás a tus amigos para que se sumen.</p>
          <div><label class="flabel" for="gc-name">Nombre del grupo</label><input class="field" id="gc-name" maxlength="40" autocomplete="off" placeholder="Ej.: Los del local" value="${esc(dr.name || '')}" required></div>
          <div><label class="flabel" for="gc-code">Código para invitar</label><input class="field" id="gc-code" maxlength="30" autocomplete="off" autocapitalize="none" spellcheck="false" value="${esc(dr.code || '')}"${dr.touched ? ' data-touched="1"' : ''} required>
            <small class="fhint">De 4 a 30 letras, números o guiones. No distingue mayúsculas. Nadie más puede usar el mismo.</small></div>
          ${err('f-gcreate')}
          <div class="vact"><button type="submit" class="btn primary">${App.ICONS.plus}Crear grupo</button></div>
        </form>`;
      if (!dr.name) setTimeout(() => { const n = this.el.querySelector('#gc-name'); if (n) n.focus(); }, 0);
      return;
    }
    if (v.mode === 'join') {
      this.el.innerHTML = `<a class="back" href="#grupo">← Grupos</a>
        <form class="card auth" id="f-gjoin" novalidate>
          <h2>Unirme a un grupo</h2>
          <p class="note">Escribí el código que te pasaron.</p>
          <div><label class="flabel" for="gj-code">Código del grupo</label><input class="field" id="gj-code" maxlength="30" autocomplete="off" autocapitalize="none" spellcheck="false" value="${esc(dr.jcode || v.code || '')}" required></div>
          ${err('f-gjoin')}
          <div class="vact"><button type="submit" class="btn primary">Unirme</button></div>
        </form>`;
      return;
    }
    if (!Cloud.groupsLoaded || this.loading) { this.el.innerHTML = `${head('Tus grupos de amigos.')}<div class="card"><p class="note">Cargando tus grupos…</p></div>`; return; }
    const actions = `<div class="vact"><a class="btn primary" href="#grupo/nuevo">${App.ICONS.plus}Crear grupo</a><a class="btn" href="#grupo/unirme">Unirme con un código</a></div>`;

    if (v.mode === 'list') {
      const gl = Cloud.groupList();
      const cards = gl.map(g => {
        const owner = g.owner === Cloud.me.uid;
        return `<a class="gcard" href="#grupo/${encodeURIComponent(g.id)}">
          <span class="gname">${esc(g.name)}${owner ? '<span class="badge soft">Lo creaste vos</span>' : ''}</span>
          <small>${plural(g.members.length, 'jugador', 'jugadores')} · ${plural(g.decks.length, 'mazo compartido', 'mazos compartidos')}</small>
          <span class="gmembers">${g.members.slice(0, 8).map(m => `<span class="avatar mini" title="${esc(m.username)}">${esc(m.username.slice(0, 1).toUpperCase())}</span>`).join('')}${g.members.length > 8 ? `<small>+${g.members.length - 8}</small>` : ''}</span>
        </a>`;
      }).join('');
      this.el.innerHTML = `${head('Creá grupos con tus amigos, compartí los mazos que quieras y valorá los de los demás.', '<div class="vact"><button type="button" class="btn ghost" id="gr-reload">Actualizar</button></div>')}
        ${s.groupsError ? `<div class="banner tone-warn"><span>${esc(s.groupsError)}</span></div>` : ''}
        ${actions}
        ${gl.length ? `<div class="gcards">${cards}</div>` : `<div class="card"><p class="note">Todavía no estás en ningún grupo. Creá uno y pasales el código a tus amigos, o sumate con el código que te pasaron.</p></div>`}
        <p class="note">Tus mazos son privados: en cada mazo elegís en qué grupos compartirlo.</p>`;
      return;
    }

    // página de un grupo
    const g = Cloud.group(v.gid);
    if (!g) { this.el.innerHTML = `<a class="back" href="#grupo">← Grupos</a><div class="card"><p class="note">No estás en ese grupo, o ya no existe.</p></div>`; return; }
    const owner = g.owner === Cloud.me.uid;
    if (v.user) {
      const m = g.members.find(x => x.username === v.user);
      if (!m) { this.el.innerHTML = `<a class="back" href="#grupo/${encodeURIComponent(g.id)}">← ${esc(g.name)}</a><div class="card"><p class="note">${esc(v.user)} no está en ${esc(g.name)}.</p></div>`; return; }
      const ps = Cloud.playerScore(g.id, m.uid);
      const n = g.decks.filter(d => d.owner === m.uid).length;
      const yo = m.uid === Cloud.me.uid;
      this.el.innerHTML = `<a class="back" href="#grupo/${encodeURIComponent(g.id)}">← ${esc(g.name)}</a>
        <div class="card player-top">
          <span class="avatar big">${esc(m.username.slice(0, 1).toUpperCase())}</span>
          <div><h1>${esc(m.username)}${yo ? ' <small>(vos)</small>' : ''}</h1>
            <p class="note">${plural(n, 'mazo compartido', 'mazos compartidos')} en ${esc(g.name)}${ps.n ? ` · ${Stars.line(ps)}` : ''}</p></div>
        </div>
        ${this.sortSeg()}
        <div id="gr-decks"></div>`;
      this.lists();
      return;
    }
    this.el.innerHTML = `<a class="back" href="#grupo">← Grupos</a>
      <div class="card group-top">
        <div class="gt-head"><h1>${esc(g.name)}</h1>${owner ? '<button type="button" class="btn ghost small" data-act="rename">Cambiar nombre</button>' : ''}</div>
        ${this.renaming ? `<form class="auth inline" id="f-grename" novalidate><label class="sr" for="gr-name">Nombre</label><input class="field" id="gr-name" maxlength="40" value="${esc(g.name)}" required><button type="submit" class="btn">Guardar</button>${err('f-grename')}</form>` : ''}
        <p class="note">${plural(g.members.length, 'jugador', 'jugadores')} · ${plural(g.decks.length, 'mazo compartido', 'mazos compartidos')}</p>
        <div class="invite">
          <span>Código para invitar: <b class="code">${esc(g.code)}</b></span>
          <div class="vact"><button type="button" class="btn" data-act="copy-invite">${App.ICONS.copy}Copiar invitación</button>${navigator.share ? `<button type="button" class="btn ghost" data-act="share-invite">Compartir</button>` : ''}</div>
        </div>
      </div>
      <label class="sr" for="gr-q">Buscar</label>
      <input class="field big" id="gr-q" type="search" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Buscar jugador, mazo o líder" value="${esc(this.q)}">
      <h2 class="sec">Jugadores</h2>
      <div class="players" id="gr-players"></div>
      <div class="sec-row"><h2 class="sec">Mazos compartidos</h2>${this.sortSeg()}</div>
      <div id="gr-decks"></div>
      <div class="card leave">
        ${this.confirmLeave ? `<p class="note">¿Seguro? Tus mazos dejan de estar compartidos en ${esc(g.name)}${owner ? '. Como lo creaste vos, el grupo sigue funcionando para los demás' : ''}.</p><div class="vact"><button type="button" class="btn danger" data-act="leave">Sí, salir del grupo</button><button type="button" class="btn ghost" data-act="no-leave">Cancelar</button></div>`
          : `<div class="vact"><button type="button" class="btn ghost danger" data-act="leave">Salir del grupo</button></div>`}
      </div>`;
    this.lists();
  },
  sortSeg() {
    const o = [['recientes', 'Recientes'], ['valorados', 'Mejor valorados'], ['baratos', 'Más baratos']];
    return `<div class="seg sortseg" role="group" aria-label="Ordenar mazos">${o.map(([v, l]) => `<button type="button" data-gsort="${v}" aria-pressed="${this.sort === v}">${l}</button>`).join('')}</div>`;
  },
  // solo las listas: así el buscador no pierde el foco mientras escribís
  lists() {
    const { esc, money, Prices, plural, Cards } = App;
    const g = Cloud.group(this.view.gid); if (!g) return;
    const norm = Cards.norm;
    const words = norm(this.q).split(' ').filter(Boolean);
    const sel = this.view.user ? g.members.find(u => u.username === this.view.user) : null;
    this.el.querySelectorAll('[data-gsort]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.gsort === this.sort)));

    const count = new Map();
    g.decks.forEach(d => count.set(d.owner, (count.get(d.owner) || 0) + 1));
    const pbox = this.el.querySelector('#gr-players');
    if (pbox) {
      const ps = g.members.filter(u => !words.length || words.every(w => norm(u.username).includes(w)));
      pbox.innerHTML = ps.length ? ps.map(u => {
        const sc = Cloud.playerScore(g.id, u.uid);
        const yo = u.uid === Cloud.me.uid;
        return `<a class="player" href="#grupo/${encodeURIComponent(`${g.id}/${u.username}`)}">
          <span class="avatar">${esc(u.username.slice(0, 1).toUpperCase())}</span>
          <span class="pinfo"><b>${esc(u.username)}${yo ? ' (vos)' : ''}${u.uid === g.owner ? ' <small class="owner-t">creador</small>' : ''}</b><small>${plural(count.get(u.uid) || 0, 'mazo', 'mazos')}</small>${Stars.line(sc)}</span>
        </a>`;
      }).join('') : `<p class="note">No hay jugadores que coincidan con “${esc(this.q)}”.</p>`;
    }

    const ready = Prices.state === 'ok';
    const leaderName = d => { const L = Decks.leader(d); return L ? (Prices.cardName(L.num) || L.num) : ''; };
    let list = g.decks.filter(d => (!sel || d.owner === sel.uid) &&
      (!words.length || sel || words.every(w => norm(`${d.name} ${d.ownerName} ${leaderName(d)}`).includes(w))));
    const sc = new Map(list.map(d => [d.id, Cloud.deckScore(g.id, d.id)]));
    const price = new Map(ready ? list.map(d => [d.id, Decks.price(d).total]) : []);
    if (this.sort === 'valorados') list.sort((a, b) => (sc.get(b.id).n ? 1 : 0) - (sc.get(a.id).n ? 1 : 0) || sc.get(b.id).avg - sc.get(a.id).avg || sc.get(b.id).n - sc.get(a.id).n);
    else if (this.sort === 'baratos' && ready) list.sort((a, b) => price.get(a.id) - price.get(b.id));
    const dbox = this.el.querySelector('#gr-decks');
    if (!dbox) return;
    dbox.innerHTML = list.length ? `<div class="decks">${list.map(d => {
      const k = Decks.counts(d);
      const mine = d.owner === Cloud.me.uid;
      const ln = leaderName(d);
      return `<a class="deck withimg" href="#mazo/${encodeURIComponent(mine ? d.id : `nube:${g.id}:${d.id}`)}">
        <span class="dimg">${CardUI.leaderImg(d)}</span>
        <span class="dinfo">
          <small class="owner">${esc(d.ownerName)}${mine ? ' (vos)' : ''}</small>
          <b>${esc(d.name)}</b>
          <small>${ln ? `Líder: ${esc(ln)} · ` : ''}${plural(k.main, 'carta', 'cartas')}${k.leader ? ' + líder' : ''}</small>
          ${Stars.line(sc.get(d.id))}
          ${ready ? `<span class="price">${money(price.get(d.id))}</span>` : `<span class="price none">${esc(Prices.state === 'loading' ? 'Calculando…' : 'Sin precios todavía')}</span>`}
        </span>
      </a>`;
    }).join('')}</div>` : `<div class="card"><p class="note">${sel ? `${esc(sel.username)} todavía no compartió mazos en ${esc(g.name)}.` : words.length ? `No hay mazos que coincidan con “${esc(this.q)}”.` : 'Nadie compartió mazos todavía. Para compartir uno tuyo, abrilo en Mazos y marcá este grupo.'}</p></div>`;
  },
});

/* ---------- Cuenta ---------- */
App.register({
  id: 'cuenta', title: 'Cuenta', short: 'Cuenta', nav: true, home: true, icon: App.ICONS.cuenta,
  desc: 'Creá tu usuario o entrá para tener tus mazos en todos lados. Con un mail podés recuperar tu contraseña.',
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
          App.toast(v('#cu-code').trim() ? '¡Listo! Ya tenés tu usuario y estás en el grupo' : '¡Listo! Ya tenés tu usuario. En Grupos podés crear uno o sumarte con un código');
        } else if (f.id === 'f-code') { await Cloud.completeProfile(v('#cu-code')); App.toast('¡Listo! Ya tenés tu usuario'); }
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
  show() {
    this.msg = null; this.ok = null;
    if (this.mode === 'recuperar') this.mode = 'entrar';
    if (Cloud.invitation.get() && Cloud.state.status !== 'in') this.mode = 'crear'; // llegaste por una invitación
    this.render(); Cloud.checkEmail();
  },
  render() {
    const { esc } = App;
    const s = Cloud.state;
    const err = id => (this.msg && this.msg.form === id ? `<div class="banner tone-bad" role="alert"><span>${esc(this.msg.text)}</span></div>` : '');
    const ok = id => (this.ok && this.ok.form === id ? `<div class="banner tone-ok" role="status"><span>${esc(this.ok.text)}</span></div>` : '');
    const head = `<div class="vhead"><div><h1>Cuenta</h1><p>Tu usuario guarda tus mazos en la nube y te deja compartirlos con tus grupos.</p></div></div>`;
    if (s.status === 'off') {
      this.el.innerHTML = `${head}<div class="card"><h2>Falta conectar Firebase</h2>
        <p class="note">Los usuarios y los grupos se guardan en Firebase, un servicio gratis de Google. Hay que crearlo una vez y pegar sus datos en <code>site/js/firebase-config.js</code>. El paso a paso está en el README del proyecto.</p>
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
        <h2>Terminá tu usuario</h2>
        <p class="note">Entraste como <b>${esc(Cloud.me.username)}</b>, pero tu usuario quedó a medio crear. Si te pasaron el código de un grupo, ponelo para entrar directo; si no, dejalo vacío.</p>
        <div><label class="flabel" for="cu-code">Código de un grupo <span class="opt-l">(opcional)</span></label><input class="field" id="cu-code" autocomplete="off" autocapitalize="none" spellcheck="false" value="${esc(Cloud.invitation.get())}"></div>
        ${err('f-code')}
        <div class="vact"><button type="submit" class="btn primary">Terminar mi usuario</button><button type="button" class="btn ghost" id="cu-out">Salir</button></div>
      </form>`;
      return;
    }
    if (s.status === 'in' && Cloud.me) {
      const last = s.lastSync ? s.lastSync.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : null;
      const acc = Cloud.account();
      const mailForm = btn => `
          <form class="auth" id="f-mail" novalidate>
            <input type="text" class="sr" autocomplete="username" value="${esc(Cloud.me.username)}" tabindex="-1" aria-hidden="true">
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
            <details${(this.msg && this.msg.form === 'f-mail') || (this.ok && this.ok.form === 'f-mail') ? ' open' : ''}><summary>Cambiar el mail</summary>${mailForm('Mandar link al mail nuevo')}</details>
          </div>`
        : acc.pending
          ? `<div class="card mailcard">
              <h2>Mail para recuperar la cuenta</h2>
              ${ok('f-mail')}
              <p class="note">Te mandamos un link a <b>${esc(acc.pending)}</b>. Abrí ese mail (mirá también en spam) y tocalo para confirmarlo. Hasta entonces seguís entrando con tu usuario.</p>
              <div class="vact"><button type="button" class="btn primary" id="cu-check">Ya lo confirmé</button></div>
              <details${this.msg && this.msg.form === 'f-mail' ? ' open' : ''}><summary>¿No te llegó? Mandarlo de nuevo u otro mail</summary>${mailForm('Mandar el link de nuevo')}</details>
            </div>`
          : `<div class="card mailcard">
              <h2>Agregá un mail para recuperar la cuenta</h2>
              <p class="note">Si te olvidás la contraseña, te mandamos un link a este mail para elegir otra. También vas a poder entrar con el mail desde cualquier dispositivo. Solo vos lo ves: tus grupos no.</p>
              ${mailForm('Mandar link de confirmación')}
            </div>`;
      this.el.innerHTML = `${head}
        <div class="card">
          <div class="who"><span class="avatar">${esc(Cloud.me.username.slice(0, 1).toUpperCase())}</span><div><small>Entraste como</small><b>${esc(Cloud.me.username)}</b></div></div>
          <p class="note">${s.syncing ? 'Sincronizando tus mazos…' : last ? `Tus mazos están sincronizados (última vez a las ${last}).` : 'Tus mazos se sincronizan solos cuando hay internet.'} En otro dispositivo, entrá con tu usuario${acc.email ? ' o tu mail' : ''} y tu contraseña: tus mazos se bajan solos.</p>
          ${s.error ? `<div class="banner tone-warn"><span>${esc(s.error)}</span></div>` : ''}
          <div class="vact"><button type="button" class="btn" id="cu-sync">Sincronizar ahora</button><a class="btn ghost" href="#grupo">${App.ICONS.grupo}Mis grupos</a></div>
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
          <p class="fhint">Si nunca le agregaste un mail a tu cuenta, no se puede recuperar por acá: pedile ayuda a quien administra la app.</p>
        </form>`;
      return;
    }
    const up = this.mode === 'crear';
    const inv = Cloud.invitation.get();
    this.el.innerHTML = `${head}
      ${s.flash && !up ? `<div class="banner tone-ok" role="status"><span>${esc(s.flash)}</span></div>` : ''}
      ${inv && up ? `<div class="banner tone-ok" role="status"><span>Te invitaron a un grupo: creá tu usuario y entrás directo.</span></div>` : ''}
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
        <div><label class="flabel" for="cu-code">Código de un grupo <span class="opt-l">(opcional)</span></label><input class="field" id="cu-code" autocomplete="off" autocapitalize="none" spellcheck="false" value="${esc(inv)}"><small class="fhint">Si te invitaron, ponelo y entrás directo a ese grupo. Si no, dejalo vacío: después podés crear tu propio grupo o sumarte a uno.</small></div>
        <div><label class="flabel" for="cu-mail">Mail <span class="opt-l">(opcional)</span></label><input class="field" id="cu-mail" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false"><small class="fhint">Para recuperar la contraseña si te la olvidás. Te mandamos un link para confirmarlo. Tus grupos no lo ven.</small></div>` : ''}
        ${err(up ? 'f-up' : 'f-in')}
        <div class="vact"><button type="submit" class="btn primary">${up ? 'Crear usuario' : 'Entrar'}</button>${up ? '' : '<button type="button" class="btn ghost" data-mode="recuperar">¿Te olvidaste la contraseña?</button>'}</div>
      </form>`;
  },
});

// cuando entrás con una invitación pendiente (abriste el link antes de entrar), te sumamos a ese grupo
App.on('cloud', s => {
  const code = Cloud.invitation.get();
  if (s.status !== 'in' || !code || !Cloud.me || !Cloud.me.profile) return;
  Cloud.invitation.set('');
  Cloud.joinByCode(code).then(gid => { const g = Cloud.group(gid); App.toast(g ? `Te sumaste a ${g.name}` : 'Te sumaste al grupo'); }).catch(e => App.toast(e.message));
});

Stars.wire();

// Guarda la app en el dispositivo para que abra sin conexión.
// Los precios se buscan primero en internet y, si no hay, se usan los últimos guardados.
const CACHE = 'bitacora-v6';
const CORE = ['./', 'index.html', 'css/app.css', 'js/core.js', 'js/mazos.js', 'js/cartas.js', 'js/ajustes.js', 'js/nube.js',
  'js/firebase-config.js', 'js/letal-engine.js', 'js/letal.js', 'js/letal-worker.js', 'manifest.webmanifest',
  'img/icon-180.png', 'img/icon-192.png', 'img/icon-512.png'];

self.addEventListener('install', e => {
  // cache: 'reload' evita guardar copias viejas que el navegador tenga en su caché HTTP
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const put = (req, res) => { if (res && (res.ok || res.type === 'opaque')) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; };

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  const font = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  const sdk = url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/'); // librería de Firebase, para entrar sin conexión
  if (!same && !font && !sdk) return;

  // precios y configuración de Firebase: primero internet, así se ven los cambios enseguida
  if (same && (url.pathname.endsWith('/data/prices.json') || url.pathname.endsWith('/data/cards.json') || url.pathname.endsWith('/js/firebase-config.js'))) {
    e.respondWith(fetch(req).then(res => put(req, res)).catch(async () => (await caches.match(req, { ignoreSearch: true })) || new Response('', { status: 504 })));
    return;
  }
  // los archivos propios se revalidan con el servidor para no quedarse con copias viejas
  const update = (same ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(req)).then(res => put(req, res)).catch(() => null);
  e.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: same });
    if (hit) return hit;
    const res = await update;
    if (res) return res;
    if (req.mode === 'navigate') { const page = await caches.match('index.html'); if (page) return page; }
    return Response.error();
  })());
  e.waitUntil(update);
});

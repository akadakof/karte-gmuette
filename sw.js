// Service Worker: Karte offline verfügbar machen
const APP = 'gmh-app-v2';
const TILES = 'gmh-tiles-v1';
const MAX_TILES = 4000;
const APP_FILES = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const TILE_HOSTS = ['server.arcgisonline.com', 'tile.opentopomap.org', 'tile.openstreetmap.de'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(APP_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== APP && k !== TILES).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const isTile = url => TILE_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h));

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Kartenkacheln: zuerst aus dem Speicher, sonst laden und merken
  if (isTile(url)) {
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(req.url);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok && res.type !== 'opaque') { c.put(req.url, res.clone()); }
        return res;
      } catch (err) {
        return new Response('', { status: 504 });
      }
    }));
    return;
  }

  // Eigene Seite: zuerst Internet (für Updates), ohne Internet aus dem Speicher
  if (url.origin === self.location.origin) {
    e.respondWith((async () => {
      const c = await caches.open(APP);
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch(req, { signal: ctrl.signal, cache: 'no-cache' });
        clearTimeout(timer);
        if (res.ok) c.put(req, res.clone());
        return res;
      } catch (err) {
        return (await c.match(req, { ignoreSearch: true })) ||
               (req.mode === 'navigate' ? await c.match('./index.html') : new Response('', { status: 504 }));
      }
    })());
  }
});

// Kacheln für Georgsmarienhütte im Hintergrund vorladen
self.addEventListener('message', e => {
  const m = e.data || {};
  if (m.type !== 'precache' || !Array.isArray(m.urls)) return;
  const src = e.source;
  e.waitUntil((async () => {
    const c = await caches.open(TILES);
    let done = 0, i = 0;
    const total = m.urls.length;
    const worker = async () => {
      while (i < total) {
        const u = m.urls[i++];
        try {
          if (!(await c.match(u))) {
            const res = await fetch(u, { mode: 'cors' });
            if (res.ok) await c.put(u, res);
          }
        } catch (err) { /* einzelne Kachel überspringen */ }
        done++;
        if (done % 20 === 0 || done === total) src && src.postMessage({ type: 'progress', done, total });
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    await trimTiles();
    src && src.postMessage({ type: 'precache-done', total });
  })());
});

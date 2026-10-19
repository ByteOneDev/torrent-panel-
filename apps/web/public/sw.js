// Service worker de Motflix : rend le panel installable et garde l'interface en cache.
// L'API n'est JAMAIS mise en cache (données en direct, identifiants) : sans réseau,
// l'interface s'ouvre et indique que le serveur est injoignable.
const CACHE = 'motflix-v1';
const SHELL = ['/', '/theme.js', '/icon.svg', '/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Pages : le réseau d'abord (version à jour), le cache si le serveur ne répond pas.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Fichiers de l'interface (noms uniques à chaque version) : le cache d'abord.
  event.respondWith(
    caches.match(req).then((hit) => hit ?? fetch(req).then((res) => {
      if (res.ok && (url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname) || url.pathname.endsWith('.png'))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })),
  );
});

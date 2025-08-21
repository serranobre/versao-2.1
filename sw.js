// Versão do cache (mude quando publicar para forçar atualização)
const CACHE_VERSION = 'relatorios-v1.0.2';
const STATIC_CACHE  = `static-${CACHE_VERSION}`;

const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore-compat.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== STATIC_CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === location.origin;
  const path = url.pathname.startsWith('/') ? '.' + url.pathname : url.pathname;
  const isStatic = isSameOrigin && ASSETS.includes(path);

  if (isStatic) {
    // cache-first p/ assets estáticos
    event.respondWith(
      caches.match(req).then(cached => cached ||
        fetch(req).then(resp => {
          const copy = resp.clone();
          caches.open(STATIC_CACHE).then(c => c.put(req, copy));
          return resp;
        })
      )
    );
  } else {
    // network-first p/ resto (ex.: Firestore)
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
  }
});

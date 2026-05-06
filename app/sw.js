// PocketAI Service Worker
const CACHE = 'pocketai-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/main.css',
  './js/app.js',
  './js/model-manager.js',
  './js/rag.js',
  './js/plugins.js',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Never cache localhost API calls
  if (e.request.url.includes('127.0.0.1')) return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});

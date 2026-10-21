const CACHE_NAME = 'taallam-school-admin-shell-v2.88.0';
const SHELL = ["/school-admin/", "/school-admin", "/styles.css", "/install.js", "/manifest-school-admin.webmanifest", "/icons/taallam-school-192.png", "/icons/taallam-school-512.png", "/icons/taallam-school.svg"];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('taallam-school-admin-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req = event.request; const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then(res => { if (res.ok) caches.open(CACHE_NAME).then(c => c.put(req, res.clone())); return res; }).catch(() => caches.match(req).then(hit => hit || caches.match('/school-admin/'))));
    return;
  }
  event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => { if (res.ok) caches.open(CACHE_NAME).then(c => c.put(req, res.clone())); return res; })));
});

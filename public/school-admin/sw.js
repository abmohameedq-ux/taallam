const VERSION = '2.83.0';
const PREFIX = 'taallam-school-admin-shell-';
const CACHE_NAME = PREFIX + VERSION;
const PAGES_CACHE = 'taallam-pages-v1'; // book page images the student already opened (kept for offline reading)
const HOME = '/school-admin/';
const SHELL = ["/school-admin/", "/school-admin", "/manifest-school-admin.webmanifest", "/icons/taallam-school-192.png", "/icons/taallam-school-512.png", "/icons/taallam-school.svg"];
const COMMON = ['/install.js', '/offline.js', '/live.js', '/tools.js', '/platform.js', '/student.css'];
// Each file is cached on its own: one missing file must never stop the others from being cached.
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => Promise.allSettled([...SHELL, ...COMMON].map(u => cache.add(u)))));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE_NAME).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
async function trimPages(cache) { const keys = await cache.keys(); if (keys.length > 240) for (const k of keys.slice(0, keys.length - 240)) await cache.delete(k); }
self.addEventListener('fetch', event => {
  const req = event.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname === '/api/learn/page') { // cache-first: a page image never changes
    event.respondWith(caches.open(PAGES_CACHE).then(async cache => {
      const hit = await cache.match(req); if (hit) return hit;
      const res = await fetch(req); if (res.ok) { cache.put(req, res.clone()).then(() => trimPages(cache)); } return res;
    }));
    return;
  }
  if (url.pathname.startsWith('/api/')) return; // data goes through the page-level offline layer (offline.js)
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE_NAME).then(c => c.put(req, copy)); } return res; })
      .catch(() => caches.match(req).then(hit => hit || caches.match(url.pathname) || caches.match(HOME))));
    return;
  }
  // static files: show the cached copy immediately and refresh it in the background
  event.respondWith(caches.open(CACHE_NAME).then(async cache => {
    const hit = await cache.match(req);
    const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});

// ---- push notifications ----
self.addEventListener('push', event => {
  let d = {}; try { d = event.data ? event.data.json() : {}; } catch { /* plain text */ }
  event.waitUntil(self.registration.showNotification(d.title || 'تعلّم', { body: d.body || '', tag: d.tag || undefined, icon: '/icons/taallam-school-192.png', badge: '/icons/taallam-school-192.png', dir: 'rtl', lang: 'ar', data: { url: d.url || '/' } }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close(); const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => { for (const c of list) if (c.url.includes(url) && 'focus' in c) return c.focus(); return self.clients.openWindow(url); }));
});

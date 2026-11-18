'use strict';
// Offline layer shared by every page (loaded before the page's own script).
//  - TQ.fetch(url, opts) is a drop-in replacement for fetch():
//      * changes (POST/PUT/PATCH/DELETE) made without internet are saved on the device in IndexedDB
//        and sent automatically, in order, when the connection returns (each one carries an
//        idempotency key, so the server never applies the same change twice);
//      * data pages (GET) are remembered, so the last data you saw is still shown without internet.
(() => {
  if (window.TQ) return;
  const DB = 'taallam-offline', Q = 'queue', C = 'cache';
  let dbp = null, flushing = false, count = 0, needsLogin = false, usingCache = false, timer = null;

  const open = () => dbp || (dbp = new Promise((res, rej) => {
    if (!('indexedDB' in window)) return rej(new Error('no-idb'));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore(Q, { keyPath: 'id', autoIncrement: true }); d.createObjectStore(C, { keyPath: 'k' }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = (store, mode, fn) => open().then(db => new Promise((res, rej) => {
    const t = db.transaction(store, mode), out = fn(t.objectStore(store));
    t.oncomplete = () => res(out && 'result' in out ? out.result : undefined); t.onerror = t.onabort = () => rej(t.error);
  }));
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'k' + Date.now().toString(16) + Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2));
  const pathOf = url => { try { return new URL(url, location.href).pathname; } catch { return String(url); } };

  const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];
  const isAuth = p => /\/(login|logout|register)$/.test(p);
  const queueable = (method, p) => MUTATING.includes(method) && !isAuth(p) && !/\/(generate-quiz|organize)$/.test(p)
    && /^\/api\/(school-admin|school-member|admin|curriculum|feedback|teacher\/drafts|parent\/(profiles|guardian-links))/.test(p);
  const cacheable = (method, p) => method === 'GET' && !/\/(pdf|view|archive)\b/.test(p) && !p.startsWith('/api/events')
    && /^\/api\/(school-admin|school-member|parent|platform|content|learn\/(library|outline|book-info|status)|admin\/(content|me|admins|schools|platform|feedback|teachers))/.test(p);

  // ---------- small UI ----------
  let bar = null;
  function ui() {
    const offline = !navigator.onLine;
    if (!offline && !count && !usingCache) { bar && bar.remove(); bar = null; return; }
    if (!bar) {
      bar = document.createElement('div'); bar.setAttribute('role', 'status'); bar.setAttribute('aria-live', 'polite');
      bar.style.cssText = 'position:fixed;z-index:10000;top:8px;left:50%;transform:translateX(-50%);max-width:calc(100vw - 20px);display:flex;gap:8px;align-items:center;padding:7px 14px;border-radius:99px;background:#173f36;color:#fff;font:600 13px/1.5 Tahoma,Arial,sans-serif;box-shadow:0 4px 16px #0003';
      document.body.append(bar);
    }
    const parts = [];
    if (offline) parts.push('📴 لا يوجد اتصال');
    if (count) parts.push('⏳ ' + count + ' بانتظار الإرسال');
    if (!count && usingCache && !offline) parts.push('تُعرض بيانات محفوظة');
    if (needsLogin && count) parts.push('سجّل الدخول لإكمال الإرسال');
    bar.replaceChildren(document.createTextNode(parts.join(' · ')));
    if (count && !offline) { const b = document.createElement('button'); b.type = 'button'; b.textContent = 'أرسل الآن'; b.style.cssText = 'border:0;border-radius:99px;padding:3px 10px;background:#fff;color:#173f36;font:inherit;cursor:pointer'; b.onclick = () => flush(true); bar.append(b); }
  }
  let toastEl = null;
  function toast(msg) {
    toastEl && toastEl.remove(); toastEl = document.createElement('div'); toastEl.setAttribute('role', 'status');
    toastEl.style.cssText = 'position:fixed;z-index:10001;bottom:78px;left:50%;transform:translateX(-50%);max-width:min(420px,calc(100vw - 24px));padding:11px 16px;border-radius:14px;background:#fff;color:#173f36;border:1px solid #cfe0d4;box-shadow:0 8px 28px #0003;font:600 14px/1.7 Tahoma,Arial,sans-serif;text-align:center';
    toastEl.textContent = msg; document.body.append(toastEl); const t = toastEl; setTimeout(() => t.remove(), 5200);
  }

  // ---------- queue ----------
  async function refreshCount() { try { count = (await tx(Q, 'readonly', s => s.count())) || 0; } catch { count = 0; } ui(); return count; }
  async function enqueue(url, method, headers, body, label, key) {
    const item = { url, method, headers, body, key: key || uuid(), label: label || '', at: Date.now() };
    await tx(Q, 'readwrite', s => s.add(item)); await refreshCount();
  }
  async function allItems() { try { return (await tx(Q, 'readonly', s => s.getAll())) || []; } catch { return []; } }
  async function flush(manual) {
    if (flushing || !navigator.onLine) return; flushing = true; let sent = 0; needsLogin = false;
    try {
      for (const it of await allItems()) {
        let r;
        try { r = await fetch(it.url, { method: it.method, headers: { ...(it.headers || {}), 'X-Idempotency-Key': it.key }, body: it.body, credentials: 'same-origin' }); } catch { break; }
        if (r.ok) { await tx(Q, 'readwrite', s => s.delete(it.id)); sent++; continue; }
        if (r.status === 401 || r.status === 403) { needsLogin = true; break; }
        if (r.status === 408 || r.status === 429 || r.status >= 500) break;
        const d = await r.json().catch(() => ({})); // a rejected change can never succeed: drop it and tell the user why
        await tx(Q, 'readwrite', s => s.delete(it.id)); toast('تعذّر إرسال تغيير محفوظ: ' + (d.error || 'رفضه الخادم'));
      }
    } finally { flushing = false; await refreshCount(); }
    if (sent) { toast('✅ أُرسل ' + sent + (sent === 1 ? ' تغيير' : ' تغييرات') + ' كانت محفوظة على جهازك'); window.dispatchEvent(new CustomEvent('tq:flushed', { detail: { sent } })); }
    else if (manual && !count) toast('لا يوجد شيء بانتظار الإرسال');
    schedule();
  }
  function schedule() { clearTimeout(timer); if (count) timer = setTimeout(() => flush(false), 20000); }

  // ---------- cache of last data ----------
  const clearCache = () => tx(C, 'readwrite', s => s.clear()).catch(() => {});
  async function putCache(k, text) { if (text.length > 1500000) return; try { await tx(C, 'readwrite', s => s.put({ k, text, at: Date.now() })); } catch { /* optional */ } }
  async function getCache(k) { try { return await tx(C, 'readonly', s => s.get(k)); } catch { return null; } }

  async function tqFetch(url, opts = {}) {
    const method = String(opts.method || 'GET').toUpperCase(), p = pathOf(url), key = p + (new URL(url, location.href).search || '');
    const q = queueable(method, p), canQueue = q && !(opts.body instanceof FormData), idKey = uuid();
    const send = () => fetch(url, { credentials: 'same-origin', ...opts });
    if (canQueue && !navigator.onLine) return queued(url, method, opts, idKey);
    try {
      // the same key is used for the first attempt and for a queued retry, so a lost response can never apply a change twice
      const withKey = canQueue ? () => fetch(url, { credentials: 'same-origin', ...opts, headers: { ...(opts.headers || {}), 'X-Idempotency-Key': idKey } }) : send;
      const r = await withKey();
      if (r.ok && cacheable(method, p)) { usingCache = false; r.clone().text().then(t => putCache(key, t)); ui(); }
      if (r.ok && MUTATING.includes(method) && /\/(login|logout)$/.test(p)) clearCache(); // never show one account's data to the next person on this device
      return r;
    } catch (e) {
      if (canQueue) return queued(url, method, opts, idKey);
      if (cacheable(method, p)) {
        const hit = await getCache(key);
        if (hit) { usingCache = true; ui(); return new Response(hit.text, { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Offline-Cache': '1' } }); }
      }
      throw e;
    }
  }
  async function queued(url, method, opts, idKey) {
    try {
      let body = opts.body; const headers = { ...(opts.headers || {}) };
      if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) body = new Blob([body]);
      await enqueue(url, method, headers, body, '', idKey);
    } catch { throw new Error('لا يوجد اتصال بالإنترنت، وتعذّر حفظ التغيير على الجهاز.'); }
    toast('📴 حُفظ على جهازك وسيُرسل تلقائيًا عند عودة الإنترنت');
    return new Response(JSON.stringify({ queued: true, message: 'حُفظ على جهازك وسيُرسل عند عودة الإنترنت.' }), { status: 202, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Queued': '1' } });
  }

  window.TQ = { fetch: tqFetch, flush: () => flush(true), pending: () => count, toast };
  window.addEventListener('online', () => { ui(); flush(false); });
  window.addEventListener('offline', ui);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) flush(false); });
  const boot = () => { refreshCount().then(() => { ui(); if (count) setTimeout(() => flush(false), 1500); }); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

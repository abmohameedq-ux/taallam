'use strict';
// Live updates: the server tells every open page when something changed (a grade, a payment, an
// announcement, a book...). Pages register a refresh function with LIVE.on(fn); it is called
// shortly after each change, and never while the user is typing in a field (so nothing they are
// editing gets wiped). If the live channel is unavailable the page falls back to a slow refresh.
(() => {
  if (window.LIVE) return;
  const handlers = new Set(); let es = null, dot = null, pending = null, lastEvent = 0, failures = 0, poll = null;

  function editing() {
    const a = document.activeElement;
    return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !a.readOnly && a.type !== 'checkbox' && a.type !== 'button');
  }
  function run(detail) {
    if (document.hidden) { pending = detail || {}; return; }
    if (editing()) { pending = detail || {}; setTimeout(() => { if (pending) run(pending); }, 2500); return; }
    pending = null;
    for (const fn of handlers) { try { fn(detail || {}); } catch (e) { console.warn('live handler failed', e); } }
  }
  let deb = null;
  function schedule(detail) { clearTimeout(deb); deb = setTimeout(() => run(detail), 500); }

  function indicator(on) {
    if (!dot) {
      dot = document.createElement('span'); dot.setAttribute('aria-hidden', 'true'); dot.title = 'تحديث مباشر';
      dot.style.cssText = 'position:fixed;z-index:9990;bottom:10px;right:10px;width:9px;height:9px;border-radius:50%;background:#2e9e5b;box-shadow:0 0 0 3px #2e9e5b33;transition:opacity .3s';
      document.body.append(dot);
    }
    dot.style.opacity = on ? '1' : '.25'; dot.title = on ? 'متصل — التحديث مباشر' : 'التحديث المباشر متوقف مؤقتًا';
  }
  function connect() {
    if (!('EventSource' in window) || es) return;
    try {
      es = new EventSource('/api/events');
      es.onopen = () => { failures = 0; indicator(true); };
      es.onmessage = e => { lastEvent = Date.now(); let d = {}; try { d = JSON.parse(e.data); } catch { /* ignore */ } schedule(d); };
      es.onerror = () => { indicator(false); failures++; if (failures > 6) { es.close(); es = null; setTimeout(connect, 60000); } };
    } catch { es = null; }
  }
  function startPolling() { clearInterval(poll); poll = setInterval(() => { if (!document.hidden && (!es || es.readyState !== 1)) run({ s: 'poll' }); }, 45000); }

  window.LIVE = { on(fn) { handlers.add(fn); return () => handlers.delete(fn); }, refresh: () => run({ s: 'manual' }) };
  window.addEventListener('tq:flushed', () => schedule({ s: 'flushed' }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (pending) run(pending); else if (Date.now() - lastEvent > 60000 && handlers.size) schedule({ s: 'wake' }); } });
  window.addEventListener('online', () => { if (!es) connect(); schedule({ s: 'online' }); });
  const boot = () => { connect(); startPolling(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();

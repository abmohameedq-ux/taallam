'use strict';
// Shared by the hub and the student app: brand, news ticker, timed announcement and the "About" page,
// all driven by the platform settings the owner edits in /admin (no code changes needed).
(() => {
  const FIRST_SHOW_MS = 30000;      // when the app opens
  const REPEAT_EVERY_MS = 5 * 60000; // then once every 5 minutes
  const REPEAT_SHOW_MS = 10000;      // for 10 seconds
  const https = u => /^https:\/\//i.test(String(u || ''));
  function mk(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) { if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v); }
    for (const kid of kids.flat()) { if (kid == null || kid === false) continue; n.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
    return n;
  }
  let settings = null;
  async function load() {
    try { const r = await TQ.fetch('/api/platform/settings', { cache: 'no-store' }); if (!r.ok) return null; settings = await r.json(); return settings; } catch { return null; }
  }
  function applyBrand(s) {
    if (!s || !s.appName) return;
    document.querySelectorAll('.brand').forEach(b => {
      b.textContent = s.appName;
      if (https(s.logoUrl)) { const img = mk('img', { class: 'logo', src: s.logoUrl, alt: '' }); img.onerror = () => img.remove(); b.prepend(img); }
    });
    document.title = document.title.includes('—') ? document.title.split('—')[0].trim() + ' — ' + s.appName : s.appName;
    document.querySelectorAll('[data-tagline]').forEach(n => { if (s.tagline) n.textContent = s.tagline; });
  }
  function applyTicker(s) {
    document.querySelector('.ticker')?.remove();
    if (!s || !s.newsTicker || !s.newsTicker.enabled || !String(s.newsTicker.text || '').trim()) return;
    const bar = mk('div', { class: 'ticker', role: 'marquee', 'aria-live': 'off' }, mk('span', { text: s.newsTicker.text }));
    const top = document.querySelector('#app .top'); if (top) top.after(bar); else document.body.prepend(bar);
  }
  // ----- timed announcement: never covers the screen, shows briefly, comes back every few minutes -----
  let adNode = null, adTimer = null;
  function hideAd() { clearTimeout(adTimer); if (adNode) { adNode.classList.add('out'); const n = adNode; setTimeout(() => n.remove(), 350); adNode = null; } }
  function showAd(ad, ms) {
    hideAd(); if (!ad) return;
    const body = mk('div', { class: 'adbody' }, ad.title ? mk('b', { text: ad.title }) : null, ad.text ? mk('span', { text: ad.text }) : null);
    const card = mk('div', { class: 'adcard', role: 'status' },
      ad.imageUrl && https(ad.imageUrl) ? mk('img', { src: ad.imageUrl, alt: '', onerror: function () { this.remove(); } }) : null, body,
      mk('button', { class: 'adclose', type: 'button', 'aria-label': 'إخفاء الإعلان', text: '✕', onclick: e => { e.stopPropagation(); hideAd(); } }));
    if (https(ad.link)) { card.classList.add('link'); card.addEventListener('click', () => window.open(ad.link, '_blank', 'noopener')); }
    document.body.append(card); adNode = card; adTimer = setTimeout(hideAd, ms);
  }
  const activeAd = s => (s && Array.isArray(s.ads) && s.ads[0]) || null;
  // ----- about page: what the app offers, contact (editable from /admin), rating and feedback -----
  let about = null;
  async function loadAbout() { try { const r = await TQ.fetch('/api/platform/about', { cache: 'no-store' }); if (r.ok) about = await r.json(); } catch { /* keep the last copy */ } return about; }
  const digits = v => String(v || '').replace(/[^\d]/g, '');
  function feedbackForm(a) {
    const box = mk('div', { class: 'fb-box' }); let rating = 0;
    const stars = [1, 2, 3, 4, 5].map(n => mk('button', { type: 'button', class: 'star', 'aria-label': n + ' من 5', text: '★', onclick: () => { rating = n; paint(); } }));
    const paint = () => stars.forEach((b, i) => { b.classList.toggle('on', i < rating); b.setAttribute('aria-pressed', String(i < rating)); });
    const reason = mk('select', { class: 'input', 'aria-label': 'سبب التقييم' }, ...Object.entries(a.reasons || {}).map(([v, t]) => mk('option', { value: v, text: t })));
    const text = mk('textarea', { class: 'input', rows: '3', maxlength: '1000', placeholder: 'اكتب رأيك أو ملاحظتك (اختياري)', 'aria-label': 'ملاحظاتك' });
    const status = mk('div', { class: 'hint', role: 'status' });
    const send = mk('button', { type: 'button', class: 'btn', text: 'إرسال التقييم', onclick: async () => {
      if (!rating && !text.value.trim()) { status.textContent = 'اختر عدد النجوم أو اكتب رأيك.'; return; }
      send.disabled = true; status.textContent = 'جارٍ الإرسال…';
      try {
        const r = await TQ.fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rating, reason: reason.value, text: text.value, app: location.pathname.slice(0, 30) }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'تعذّر الإرسال.');
        status.textContent = d.queued ? '📴 حُفظ على جهازك وسيُرسل عند عودة الإنترنت. شكرًا لك!' : '💚 شكرًا لك! وصل رأيك إلينا.'; text.value = ''; send.disabled = false;
      } catch (e) { status.textContent = e.message; send.disabled = false; }
    } });
    return mk('div', { class: 'fb-wrap' }, mk('h3', { text: 'قيّم التطبيق' }), a.feedbackNote ? mk('p', { class: 'hint', text: a.feedbackNote }) : null, mk('div', { class: 'stars-row', role: 'group', 'aria-label': 'التقييم بالنجوم' }, stars), reason, text, send, status);
  }
  function openAbout() {
    const s = settings || {}, a = about || { features: [], reasons: {} }; document.querySelector('.about')?.remove();
    const wa = digits(a.whatsapp);
    const contact = [a.email ? mk('a', { href: 'mailto:' + a.email, text: '✉️ ' + a.email }) : null, wa ? mk('a', { href: 'https://wa.me/' + wa, target: '_blank', rel: 'noopener', text: '💬 واتساب: ' + a.whatsapp }) : null,
      s.contactEmail && s.contactEmail !== a.email ? mk('a', { href: 'mailto:' + s.contactEmail, text: '✉️ ' + s.contactEmail }) : null, ...(s.phoneNumbers || []).map(p => mk('a', { href: 'tel:' + String(p).replace(/[^\d+]/g, ''), text: '📞 ' + p }))].filter(Boolean);
    const card = mk('div', { class: 'about-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'حول التطبيق' },
      mk('div', { class: 'about-head' }, mk('h2', { text: 'حول ' + (s.appName || 'التطبيق') }), mk('button', { class: 'round', type: 'button', 'aria-label': 'إغلاق', text: '✕', onclick: () => ov.remove() })),
      https(s.logoUrl) ? mk('img', { class: 'about-logo', src: s.logoUrl, alt: '', onerror: function () { this.remove(); } }) : null,
      s.tagline ? mk('p', { class: 'about-tag', text: s.tagline }) : null, a.intro ? mk('p', { text: a.intro }) : (s.description ? mk('p', { text: s.description }) : null), s.aboutText ? mk('p', { text: s.aboutText }) : null,
      (a.features || []).length ? mk('div', { class: 'about-feats' }, mk('h3', { text: 'ماذا يقدّم التطبيق؟' }), (a.features || []).map(f => mk('div', { class: 'feat' }, mk('span', { class: 'fi', text: f.icon || '✨' }), mk('div', {}, mk('b', { text: f.title }), f.text ? mk('small', { text: f.text }) : null)))) : null,
      s.dedicationText ? mk('blockquote', { text: s.dedicationText }) : null,
      contact.length ? mk('div', { class: 'about-contact' }, mk('h3', { text: 'للتواصل وإرسال ملاحظاتكم' }), mk('div', { class: 'about-links' }, contact)) : null,
      (s.socialLinks || []).length ? mk('div', { class: 'about-links' }, s.socialLinks.filter(x => https(x.url)).map(x => mk('a', { href: x.url, target: '_blank', rel: 'noopener', text: '🔗 ' + (x.label || x.url) }))) : null,
      a.feedbackEnabled !== false ? feedbackForm(a) : null,
      mk('small', { class: 'about-foot', text: [s.footerText, a.version ? 'الإصدار ' + a.version : ''].filter(Boolean).join(' · ') }));
    const ov = mk('div', { class: 'about', onclick: e => { if (e.target === ov) ov.remove(); } }, card); document.body.append(ov);
  }
  async function boot() {
    document.getElementById('aboutBtn')?.addEventListener('click', openAbout);
    const s = await load(); applyBrand(s); applyTicker(s); loadAbout();
    setTimeout(() => showAd(activeAd(settings), FIRST_SHOW_MS), 700);
    setInterval(async () => {
      if (document.hidden) return; const fresh = await load(); applyTicker(fresh); const ad = activeAd(fresh); if (ad) showAd(ad, REPEAT_SHOW_MS); else hideAd();
    }, REPEAT_EVERY_MS);
  }
  boot();
  if (window.LIVE) LIVE.on(async d => { if (d.s && d.s !== 'platform' && d.s !== 'poll' && d.s !== 'online' && d.s !== 'wake' && d.s !== 'flushed' && d.s !== 'manual') return; const fresh = await load(); if (fresh) { applyBrand(fresh); applyTicker(fresh); } loadAbout(); });
  window.__platform = { openAbout, showAd, hideAd };
})();

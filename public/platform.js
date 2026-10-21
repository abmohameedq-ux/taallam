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
  const FEEDBACK_QUEUE_KEY = 'taallam-feedback-queue-v1';
  const readFeedbackQueue = () => { try { const value = JSON.parse(localStorage.getItem(FEEDBACK_QUEUE_KEY) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } };
  const writeFeedbackQueue = items => { try { localStorage.setItem(FEEDBACK_QUEUE_KEY, JSON.stringify(items.slice(-50))); return true; } catch { return false; } };
  async function syncFeedbackQueue() {
    if (!navigator.onLine) return;
    const queue = readFeedbackQueue(); if (!queue.length) return;
    const remaining = [];
    for (const item of queue) {
      try { const r = await fetch('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item), cache: 'no-store' });
        if (!r.ok && r.status !== 409) { if (r.status >= 500 || r.status === 429) remaining.push(item); }
      } catch { remaining.push(item); }
    }
    writeFeedbackQueue(remaining);
    window.dispatchEvent(new CustomEvent('taallam:feedback-sync', { detail: { pending: remaining.length } }));
  }
  window.addEventListener('online', syncFeedbackQueue);
  window.addEventListener('load', () => { syncFeedbackQueue(); });
  async function load() {
    try { const r = await fetch('/api/platform/settings', { cache: 'no-store' }); if (!r.ok) return null; settings = await r.json(); return settings; } catch { return null; }
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
  // ----- about page -----
  function openAbout() {
    const s = settings || {}; document.querySelector('.about')?.remove();
    const card = mk('div', { class: 'about-card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'حول التطبيق' },
      mk('div', { class: 'about-head' }, mk('h2', { text: 'حول ' + (s.appName || 'التطبيق') }), mk('button', { class: 'round', type: 'button', 'aria-label': 'إغلاق', text: '✕', onclick: () => ov.remove() })),
      https(s.logoUrl) ? mk('img', { class: 'about-logo', src: s.logoUrl, alt: '', onerror: function () { this.remove(); } }) : null,
      s.tagline ? mk('p', { class: 'about-tag', text: s.tagline }) : null, s.description ? mk('p', { text: s.description }) : null, s.aboutText ? mk('p', { text: s.aboutText }) : null,
      s.dedicationText ? mk('blockquote', { text: s.dedicationText }) : null,
      (s.contactEmail || (s.phoneNumbers || []).length) ? mk('div', { class: 'about-links' }, s.contactEmail ? mk('a', { href: 'mailto:' + s.contactEmail, text: '✉️ ' + s.contactEmail }) : null, (s.phoneNumbers || []).map(p => mk('a', { href: 'tel:' + String(p).replace(/[^\d+]/g, ''), text: '📞 ' + p }))) : null,
      (s.socialLinks || []).length ? mk('div', { class: 'about-links' }, s.socialLinks.filter(x => https(x.url)).map(x => mk('a', { href: x.url, target: '_blank', rel: 'noopener', text: '🔗 ' + (x.label || x.url) }))) : null,
      s.footerText ? mk('small', { class: 'about-foot', text: s.footerText }) : null,
      mk('hr', {}), mk('h3', { text: 'قيّم التطبيق وأرسل ملاحظتك' }),
      (() => { const form=mk('form',{class:'feedback-form'}); let rating=5; const stars=mk('div',{class:'feedback-stars','aria-label':'تقييم التطبيق'}); const buttons=[]; const paint=()=>buttons.forEach((b,i)=>{b.textContent=i<rating?'★':'☆';b.setAttribute('aria-pressed',String(i<rating));}); for(let i=1;i<=5;i++){const b=mk('button',{type:'button','aria-label':`${i} نجوم`,onclick:()=>{rating=i;paint();}});buttons.push(b);stars.append(b);} paint(); const category=mk('select',{'aria-label':'سبب التقييم'},... [['suggestion','اقتراح'],['bug','مشكلة تقنية'],['content','محتوى تعليمي'],['excellent','التطبيق جميل جدًا'],['improvement','يحتاج إلى تحسين'],['other','أخرى']].map(([v,t])=>mk('option',{value:v,text:t}))); const email=mk('input',{type:'email',placeholder:'البريد الإلكتروني (اختياري)','aria-label':'البريد الإلكتروني اختياري'}); const comment=mk('textarea',{rows:'3',maxlength:'3000',placeholder:'اكتب رأيك أو اقتراحك (اختياري)','aria-label':'الملاحظة'}); const status=mk('p',{role:'status'}); const submit=mk('button',{type:'submit',class:'btn primary',text:'إرسال التقييم'}); form.append(stars,category,email,comment,submit,status); form.addEventListener('submit',async e=>{e.preventDefault();submit.disabled=true;status.textContent='جارٍ الإرسال…';const payload={submissionId:crypto.randomUUID(),rating,category:category.value,email:email.value,comment:comment.value};try{const r=await fetch('/api/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error||'تعذّر الإرسال');status.textContent=d.message||'شكرًا لك!';comment.value='';}catch(err){if(!navigator.onLine||err instanceof TypeError){const queue=readFeedbackQueue();if(queue.length>=50){status.textContent='قائمة الإرسال دون إنترنت ممتلئة. اتصل بالإنترنت ثم أعد المحاولة.';}else if(writeFeedbackQueue([...queue,payload])){status.textContent='لا يوجد اتصال. حُفظ تقييمك على هذا الجهاز وسيُرسل تلقائيًا عند عودة الإنترنت.';comment.value='';}else status.textContent='تعذّر الحفظ على هذا الجهاز. انسخ ملاحظتك قبل إغلاق الصفحة.';}else status.textContent=err.message||'تعذّر الإرسال. حاول مجددًا.';}finally{submit.disabled=false;}});return form; })());
    const ov = mk('div', { class: 'about', onclick: e => { if (e.target === ov) ov.remove(); } }, card); document.body.append(ov);
  }
  async function boot() {
    document.getElementById('aboutBtn')?.addEventListener('click', openAbout);
    const s = await load(); applyBrand(s); applyTicker(s);
    setTimeout(() => showAd(activeAd(settings), FIRST_SHOW_MS), 700);
    setInterval(async () => {
      if (document.hidden) return; const fresh = await load(); applyTicker(fresh); const ad = activeAd(fresh); if (ad) showAd(ad, REPEAT_SHOW_MS); else hideAd();
    }, REPEAT_EVERY_MS);
  }
  boot();
  window.__platform = { openAbout, showAd, hideAd };
})();

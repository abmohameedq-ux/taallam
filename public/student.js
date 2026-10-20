'use strict';
(() => {
  // ---------- tiny helpers ----------
  const $ = s => document.querySelector(s);
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) { if (kid == null || kid === false) continue; n.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
    return n;
  }
  const AR = n => String(n).replace(/\d/g, d => '٠١٢٣٤٥٦٧٨٩'[d]);
  const rnd = n => Math.floor(Math.random() * n);
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function api(url, body) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 60000);
    try {
      const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'تعذّر تنفيذ الطلب. حاول مرة أخرى.');
      return d;
    } catch (e) { throw new Error(e.name === 'AbortError' ? 'تأخر الرد. تأكد من الإنترنت وحاول مرة أخرى.' : (e.message === 'Failed to fetch' ? 'لا يوجد اتصال بالإنترنت.' : e.message)); }
    finally { clearTimeout(t); }
  }

  // ---------- profile (stored on this device only) ----------
  const KEY = 'taallam.student.v2';
  const BADGES = [
    ['first_lesson', '🌱', 'أول درس', p => p.stats.lessons >= 1], ['five_lessons', '📚', 'قارئ نشيط', p => p.stats.lessons >= 5],
    ['first_quiz', '📝', 'أول اختبار', p => p.stats.quizzes >= 1], ['perfect', '🏆', 'درجة كاملة', p => p.stats.perfect >= 1],
    ['streak3', '🔥', 'ثلاثة أيام متتالية', p => p.streak.count >= 3], ['games10', '🎮', 'لاعب ماهر', p => p.stats.games >= 10],
    ['stars50', '⭐', 'خمسون نجمة', p => p.stars >= 50], ['stars200', '🌟', 'مئتا نجمة', p => p.stars >= 200]
  ];
  function loadProfile() {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
    return { name: '', avatar: '🦉', stage: '', stars: 0, sound: true, dialect: 'ar-SA', lastBook: '', badges: [], streak: { last: '', count: 0 }, doneToday: {}, ...p, stats: { lessons: 0, quizzes: 0, perfect: 0, games: 0, ...(p.stats || {}) } };
  }
  let P = loadProfile();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch {} };
  const today = () => new Date().toISOString().slice(0, 10);
  function touchStreak() {
    const t = today(); if (P.streak.last === t) return;
    const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    P.streak = { last: t, count: P.streak.last === y ? P.streak.count + 1 : 1 }; P.doneToday = {}; save();
  }
  function award(stars, statKey, once) {
    if (once) { if (P.doneToday[once]) return false; P.doneToday[once] = 1; }
    P.stars += stars; if (statKey) P.stats[statKey] = (P.stats[statKey] || 0) + 1;
    for (const [id, em, name, test] of BADGES) if (!P.badges.includes(id) && test(P)) { P.badges.push(id); setTimeout(() => toast(em + ' شارة جديدة: ' + name), 700); }
    save(); renderHeader(); return true;
  }

  // ---------- sound effects ----------
  let actx = null;
  function beep(kind) {
    if (!P.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const notes = kind === 'ok' ? [[660, 0], [880, .12]] : kind === 'win' ? [[523, 0], [659, .12], [784, .24], [1046, .36]] : [[220, 0]];
      for (const [f, d] of notes) {
        const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = f; o.type = 'sine'; o.connect(g); g.connect(actx.destination);
        const t = actx.currentTime + d; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.18, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + .2); o.start(t); o.stop(t + .22);
      }
    } catch {}
  }
  function confetti() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = el('div', { class: 'confetti', 'aria-hidden': 'true' });
    for (let i = 0; i < 26; i++) { const s = el('i', { text: ['⭐', '🎉', '✨', '🌟'][rnd(4)] }); s.style.left = rnd(100) + '%'; s.style.animationDelay = (Math.random() * .6) + 's'; box.append(s); }
    document.body.append(box); setTimeout(() => box.remove(), 2600);
  }
  let toastTimer = null;
  function toast(msg) {
    document.querySelector('.toast')?.remove(); const t = el('div', { class: 'toast', role: 'status', text: msg }); document.body.append(t);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.remove(), 3800);
  }

  // ---------- text to speech with word highlighting ----------
  // Two engines: the device voice (free, but missing/blocked on many phones) and a cloud voice served by the platform.
  const TTS = { ok: 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window, voice: null, arabic: 0, rate: .9, msPerChar: 80, cur: null, est: [], reading: false, audioEl: null, raf: 0, ctl: null, usingCloud: false, lastError: '' };
  const CLOUD = { ok: false };
  const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';
  const CAUDIO = new Map();
  function pickVoice() {
    if (!TTS.ok) return;
    const ar = (speechSynthesis.getVoices() || []).filter(v => /^ar([_-]|$)/i.test(v.lang || '')); TTS.arabic = ar.length;
    const same = (v, c) => v.lang.replace('_', '-').toLowerCase() === String(c).toLowerCase();
    let best = null;
    for (const c of [P.dialect, 'ar-SA', 'ar-EG', 'ar-AE', 'ar']) { best = ar.find(v => same(v, c) && v.localService) || ar.find(v => same(v, c)); if (best) break; }
    TTS.voice = best || ar[0] || null;
  }
  if (TTS.ok) { pickVoice(); try { speechSynthesis.addEventListener('voiceschanged', pickVoice); } catch {} }
  // must run inside a tap/click so the browser allows sound later (needed on iPhone and some Androids)
  function prime() {
    try { if (TTS.ok) { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } } catch {}
    try { const a = TTS.audioEl || (TTS.audioEl = new Audio()); a.src = SILENT; const pr = a.play(); if (pr && pr.catch) pr.catch(() => {}); } catch {}
  }
  function clearEst() { TTS.est.forEach(clearTimeout); TTS.est = []; }
  function stopSpeech() {
    TTS.cur = null; TTS.reading = false; clearEst(); cancelAnimationFrame(TTS.raf);
    try { if (TTS.ctl) TTS.ctl.abort(); } catch {} TTS.ctl = null;
    try { if (TTS.audioEl) { TTS.audioEl.onended = TTS.audioEl.onerror = null; TTS.audioEl.pause(); } } catch {}
    try { if (TTS.ok) speechSynthesis.cancel(); } catch {}
  }
  function mark(words, i) { words.forEach((w, j) => { w.classList.toggle('now', j === i); w.classList.toggle('said', j < i); }); }
  function speakDevice(text, words, cb) {
    const starts = []; let pos = 0;
    for (const w of words) { const k = text.indexOf(w.textContent, pos); starts.push(k < 0 ? pos : k); pos = (k < 0 ? pos : k) + w.textContent.length; }
    const attempt = useVoice => {
      const token = {}; TTS.cur = token; TTS.reading = true; TTS.usingCloud = false;
      const u = new SpeechSynthesisUtterance(text); u.rate = TTS.rate; u.pitch = P.stage === 'kids' ? 1.12 : 1;
      u.lang = useVoice && TTS.voice ? TTS.voice.lang : (P.dialect || 'ar-SA'); if (useVoice && TTS.voice) u.voice = TTS.voice;
      let started = false, gotBoundary = false, t0 = 0, watch = null;
      window.__utt = u; // keep a reference: some browsers drop events if the utterance is garbage-collected
      const live = () => TTS.cur === token;
      const estimate = i => {
        if (!live() || gotBoundary || i >= words.length) return;
        mark(words, i); const d = words[i].textContent.length * TTS.msPerChar * (.9 / TTS.rate) + 70;
        TTS.est.push(setTimeout(() => estimate(i + 1), d));
      };
      u.onstart = () => { started = true; t0 = performance.now(); clearTimeout(watch); if (words.length) TTS.est.push(setTimeout(() => { if (live() && !gotBoundary) estimate(0); }, 500)); };
      u.onboundary = e => {
        if (!live() || (e.name && e.name !== 'word') || !words.length) return;
        gotBoundary = true; clearEst(); let idx = 0; for (let i = 0; i < starts.length; i++) if (starts[i] <= e.charIndex) idx = i; mark(words, idx);
      };
      u.onend = () => {
        if (!live()) return; clearEst(); clearTimeout(watch); TTS.reading = false;
        if (started && !gotBoundary) TTS.msPerChar = Math.min(150, Math.max(40, (performance.now() - t0) / Math.max(1, text.length)));
        mark(words, words.length); cb.onEnd && cb.onEnd();
      };
      u.onerror = e => {
        if (!live()) return; if (e.error === 'canceled' || e.error === 'interrupted') return;
        clearEst(); clearTimeout(watch); TTS.lastError = 'device:' + (e.error || 'error');
        if (useVoice && TTS.voice) { attempt(false); return; }
        TTS.reading = false; cb.onFail && cb.onFail(e.error || 'error');
      };
      watch = setTimeout(() => {
        if (!live() || started) return; try { speechSynthesis.cancel(); } catch {}
        if (useVoice && TTS.voice) attempt(false); else { TTS.lastError = 'device:no-start'; TTS.reading = false; cb.onFail && cb.onFail('no-start'); }
      }, 4000);
      try { speechSynthesis.cancel(); } catch {}
      setTimeout(() => { if (live()) { try { speechSynthesis.speak(u); } catch { TTS.lastError = 'device:speak-failed'; cb.onFail && cb.onFail('speak-failed'); } } }, 90);
    };
    attempt(true);
  }
  async function cloudAudio(text, track) {
    if (CAUDIO.has(text)) return CAUDIO.get(text);
    const ctl = new AbortController(); if (track) TTS.ctl = ctl;
    const r = await fetch('/api/learn/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }), signal: ctl.signal });
    if (!r.ok) throw new Error('http-' + r.status);
    const url = URL.createObjectURL(await r.blob()); CAUDIO.set(text, url);
    if (CAUDIO.size > 40) { const k = CAUDIO.keys().next().value; URL.revokeObjectURL(CAUDIO.get(k)); CAUDIO.delete(k); }
    return url;
  }
  function speakCloud(text, words, cb) {
    const token = {}; TTS.cur = token; TTS.reading = true; TTS.usingCloud = true; const live = () => TTS.cur === token;
    const fail = why => { if (!live()) return; TTS.reading = false; TTS.lastError = 'cloud:' + why; cb.onFail && cb.onFail(why); };
    cloudAudio(text, true).then(url => {
      if (!live()) return;
      const a = TTS.audioEl || (TTS.audioEl = new Audio()); a.src = url;
      const weights = words.map(w => w.textContent.length + 2), total = weights.reduce((x, y) => x + y, 0) || 1;
      const loop = () => {
        if (!live()) return; const d = a.duration;
        if (words.length && isFinite(d) && d > 0) { const target = a.currentTime / d * total; let acc = 0, idx = weights.length - 1; for (let i = 0; i < weights.length; i++) { acc += weights[i]; if (target < acc) { idx = i; break; } } mark(words, idx); }
        TTS.raf = requestAnimationFrame(loop);
      };
      a.onended = () => { if (!live()) return; cancelAnimationFrame(TTS.raf); TTS.reading = false; mark(words, words.length); cb.onEnd && cb.onEnd(); };
      a.onerror = () => fail('audio-error');
      const pr = a.play(); (pr && pr.then ? pr : Promise.resolve()).then(() => { if (live()) TTS.raf = requestAnimationFrame(loop); }).catch(e => fail(e && e.name || 'play-blocked'));
    }).catch(e => { if (e && e.name === 'AbortError') return; fail(e && e.message || 'network'); });
  }
  function speak(text, words = [], cb = {}) {
    stopSpeech();
    const mode = P.voiceMode || 'auto';
    const toCloud = why => { if (CLOUD.ok) speakCloud(text, words, cb); else { TTS.lastError = TTS.lastError || why; cb.onFail && cb.onFail(why); } };
    if (mode === 'cloud') return toCloud('cloud-off');
    if (TTS.ok && (mode === 'device' || !P.deviceBad)) {
      return speakDevice(text, words, { onEnd: cb.onEnd, onFail: why => {
        if (mode === 'auto' && CLOUD.ok) { P.deviceBad = true; save(); speakCloud(text, words, cb); } else cb.onFail && cb.onFail(why);
      } });
    }
    toCloud('no-tts');
  }
  const say = text => speak(text, [], {});
  function prefetchNext(text) { if (TTS.usingCloud && text) cloudAudio(text, false).catch(() => {}); }
  function voiceReport() {
    return `النطق في الجهاز: ${TTS.ok ? 'مدعوم' : 'غير مدعوم'} · أصوات عربية مثبتة: ${AR(TTS.arabic)} · الصوت السحابي: ${CLOUD.ok ? 'متاح' : 'غير مفعّل'}${P.deviceBad ? ' · (تم تحويلك للصوت السحابي لأن صوت الجهاز فشل)' : ''}${TTS.lastError ? ' · آخر خطأ: ' + TTS.lastError : ''}`;
  }

  // ---------- speech to text ----------
  let rec = null;
  function listen(btn, input, onFinal) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('هذا المتصفح لا يدعم الإدخال الصوتي. اكتب طلبك أو استخدم متصفح Chrome.'); return; }
    if (rec) { try { rec.stop(); } catch {} return; }
    stopSpeech();
    const r = new SR(); rec = r; r.lang = P.dialect || 'ar-SA'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    let finalText = ''; btn.classList.add('live'); btn.setAttribute('aria-pressed', 'true');
    r.onresult = e => { let t = ''; for (const res of e.results) { t += res[0].transcript; if (res.isFinal) finalText = t; } input.value = t; };
    r.onerror = e => {
      const m = { 'not-allowed': 'اسمح للمتصفح باستخدام الميكروفون ثم حاول مرة أخرى.', 'service-not-allowed': 'الميكروفون غير مسموح لهذا الموقع.', 'no-speech': 'لم أسمعك. اضغط الميكروفون وتحدّث بصوت أوضح.', 'audio-capture': 'لا يوجد ميكروفون في هذا الجهاز.', 'network': 'الإدخال الصوتي يحتاج اتصالًا بالإنترنت.', 'language-not-supported': 'هذه اللهجة غير مدعومة؛ غيّرها من الإعدادات.' };
      toast(m[e.error] || 'تعذّر الإدخال الصوتي. اكتب طلبك.');
    };
    r.onend = () => { btn.classList.remove('live'); btn.setAttribute('aria-pressed', 'false'); rec = null; const t = (finalText || input.value).trim(); if (t && onFinal) onFinal(t); };
    try { r.start(); } catch { btn.classList.remove('live'); rec = null; }
  }

  // ---------- sheet / navigation ----------
  const S = { nav: [], sid: 0, ctx: {} };
  const sheet = $('#sheet'), body = $('#sheetBody');
  function setTitle(t) { $('#sheetTitle').textContent = t; }
  function setBody(...nodes) { stopSpeech(); if (rec) { try { rec.stop(); } catch {} } body.replaceChildren(...nodes.flat(Infinity).filter(Boolean)); body.scrollTop = 0; }
  function setTransient(...nodes) { setBody(...nodes); S.transient = true; }
  function show(title, render, replace) {
    S.transient = false;
    if (replace && S.nav.length) S.nav[S.nav.length - 1] = { title, render }; else S.nav.push({ title, render });
    S.sid++; setTitle(title); render();
  }
  function openSheet(title, render) {
    S.nav = []; sheet.classList.add('open'); document.body.style.overflow = 'hidden'; show(title, render);
    $('#sClose').focus({ preventScroll: true });
  }
  function closeSheet() { stopSpeech(); sheet.classList.remove('open'); S.nav = []; S.sid++; S.transient = false; renderHeader(); renderGreeting(); }
  function back() {
    if (S.transient) { S.transient = false; const top = S.nav[S.nav.length - 1]; if (!top) return closeSheet(); S.sid++; setTitle(top.title); top.render(); return; }
    if (S.nav.length <= 1) return closeSheet(); S.nav.pop(); const top = S.nav[S.nav.length - 1]; S.sid++; setTitle(top.title); top.render(); }
  $('#sBack').addEventListener('click', back); $('#sClose').addEventListener('click', closeSheet);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheet.classList.contains('open')) closeSheet(); });
  const loading = (msg) => el('div', { class: 'center', style: 'flex:1;display:flex;flex-direction:column;gap:10px' }, el('div', { class: 'owl', text: '🦉' }), el('p', { class: 'bubble', text: msg }), el('div', { class: 'hint', text: 'لحظة من فضلك…' }));
  const errorBox = (msg, retry) => el('div', { class: 'center', style: 'flex:1;display:flex;flex-direction:column;gap:12px' }, el('div', { class: 'owl', text: '😅' }), el('p', { class: 'bubble', text: msg }), retry ? el('button', { class: 'btn', text: 'حاول مرة أخرى', onclick: retry }) : null);

  // ---------- home ----------
  function renderHeader() { const s = $('#starCount'); if (s) s.textContent = AR(P.stars); const a = $('#avatarBtn'); if (a) a.textContent = P.avatar; }
  function renderGreeting() {
    const h = new Date().getHours(); const hi = h < 12 ? 'صباح الخير' : h < 18 ? 'مرحبًا' : 'مساء الخير';
    $('#bubble').textContent = P.stage === 'kids' ? `${hi}${P.name ? ' يا ' + P.name : ''}! هيا نلعب ونتعلم 🎈` : `${hi}${P.name ? ' يا ' + P.name : ''}! ماذا تريد أن تتعلم اليوم؟`;
    $('#owl').textContent = P.avatar;
  }
  function buildHome() {
    const tiles = [
      ['c1', '📖', 'تعلّم', P.stage === 'kids' ? 'شرح جميل من كتابك' : 'شرح وتلخيص من كتابك', () => openLearn('teach')],
      ['c2', '🎤', 'اسأل بصوتك', 'تكلّم وأنا أشرح', () => openLearn('teach', { mic: true })],
      ['c3', '📝', 'اختبرني', 'أسئلة وتصحيح فوري', () => openLearn('quiz')],
      ['c4', '🎮', 'ألعاب', 'حروف وأرقام وألوان', openGames],
      ['c5', '⭐', 'إنجازاتي', 'نجومي وشاراتي', openAchievements],
      ['c6', '🏫', 'مدرستي', 'واجباتي ومنشورات المعلم', null]
    ];
    if (P.stage === 'kids') { const g = tiles.splice(3, 1)[0]; tiles.splice(1, 0, g); }
    const grid = $('#grid'); grid.replaceChildren();
    for (const [c, em, label, sub, fn] of tiles) {
      const inner = [el('span', { class: 'em', text: em }), el('b', { text: label }), el('small', { text: sub })];
      grid.append(fn ? el('button', { class: 'tile ' + c, type: 'button', onclick: () => { prime(); fn(); } }, ...inner) : el('a', { class: 'tile ' + c, href: '/student/school' }, ...inner));
    }
  }

  // ---------- onboarding / settings ----------
  function openSettings(first) { openSheet(first ? 'أهلًا بك!' : 'إعداداتي', () => settingsScreen(first)); }
  function settingsScreen(first) {
    {
      const draft = { stage: P.stage || '', avatar: P.avatar };
      const name = el('input', { class: 'input', maxlength: '20', placeholder: 'اسمك الأول (اختياري)', value: P.name, 'aria-label': 'اسمك الأول' });
      const stageBtns = [['kids', '🧒', 'أنا في الصفوف الأولى', 'ألعاب وشرح مبسّط'], ['reader', '📚', 'أقرأ بنفسي', 'شرح وملخصات وأسئلة']].map(([v, em, t, s]) =>
        el('button', { class: 'big' + (draft.stage === v ? ' primary' : ''), type: 'button', onclick: () => { draft.stage = v; stageBtns.forEach(b => b.classList.remove('primary')); stageBtns[v === 'kids' ? 0 : 1].classList.add('primary'); } }, el('span', { class: 'em', text: em }), el('div', {}, t, el('small', { text: s }))));
      const avs = ['🦉', '🐱', '🦁', '🐼', '🦊', '🐯'].map(a => el('button', { class: 'av' + (a === draft.avatar ? ' on' : ''), type: 'button', 'aria-label': 'صورة ' + a, text: a, onclick: () => { draft.avatar = a; avs.forEach(b => b.classList.toggle('on', b.textContent === a)); } }));
      const grade = el('select', { class: 'input', 'aria-label': 'صفي الدراسي' }, el('option', { value: '', text: 'كل الصفوف' }));
      getLib().then(bs => { const gs = [...new Set(bs.map(b => String(b.grade || '').trim()).filter(Boolean))]; if (P.grade && !gs.includes(P.grade)) gs.unshift(P.grade); gs.forEach(g => grade.append(el('option', { value: g, text: g }))); grade.value = P.grade || ''; }).catch(() => {});
      const vmode = el('select', { class: 'input', 'aria-label': 'نوع الصوت' }, ...[['auto', 'تلقائي (الأفضل)'], ['cloud', 'صوت المنصة (يعمل على كل الأجهزة)'], ['device', 'صوت الجهاز']].map(([v, t]) => el('option', { value: v, text: t, selected: (P.voiceMode || 'auto') === v })));
      const diag = el('div', { class: 'notice', text: voiceReport() });
      const testBtn = el('button', { class: 'btn alt', type: 'button', text: '🔊 جرّب الصوت', onclick: () => { prime(); P.voiceMode = vmode.value; if (vmode.value !== 'cloud') P.deviceBad = false; diag.textContent = 'أحاول التشغيل…'; speak('مرحبًا، أنا الهيثم. هل تسمعني؟', [], { onEnd: () => { diag.textContent = '✅ تم تشغيل الصوت. ' + voiceReport(); }, onFail: why => { diag.textContent = '❌ فشل التشغيل (' + why + '). ' + voiceReport(); } }); setTimeout(() => { if (/أحاول/.test(diag.textContent)) diag.textContent = voiceReport(); }, 9000); } });
      const dialect = el('select', { class: 'input', 'aria-label': 'لهجة الصوت' }, ...[['ar-SA', 'السعودية / اليمن'], ['ar-EG', 'مصر'], ['ar-AE', 'الإمارات'], ['ar-JO', 'الأردن'], ['ar-MA', 'المغرب']].map(([v, t]) => el('option', { value: v, text: t, selected: P.dialect === v })));
      const sound = el('input', { type: 'checkbox', checked: P.sound, style: 'width:26px;height:26px' });
      const done = el('button', { class: 'btn', type: 'button', text: first ? 'هيا نبدأ 🚀' : 'حفظ', onclick: () => {
        if (!draft.stage) { toast('اختر: هل أنت في الصفوف الأولى أم تقرأ بنفسك؟'); return; }
        P.stage = draft.stage; P.avatar = draft.avatar; P.name = name.value.trim().slice(0, 20); P.dialect = dialect.value; P.sound = sound.checked; if (grade.value !== (P.grade || '')) P.gradeManual = true; P.grade = grade.value; if (vmode.value !== (P.voiceMode || 'auto')) P.deviceBad = false; P.voiceMode = vmode.value; save(); pickVoice();
        document.body.classList.toggle('kids', P.stage === 'kids'); buildHome(); renderHeader(); renderGreeting(); closeSheet(); if (first) toast('أهلًا ' + (P.name || 'يا صديقي') + '! اختر ما تحب 👇');
      } });
      setBody(el('p', { class: 'bubble center', text: 'أنا الهيثم 🦉 معلّمك الصديق. من أنت؟' }), ...stageBtns, name, el('div', { class: 'avatars' }, avs),
        el('label', { style: 'display:flex;flex-direction:column;gap:4px' }, el('span', { text: 'صفي الدراسي (لعرض كتبي فقط)' }), grade), el('label', { style: 'display:flex;flex-direction:column;gap:4px' }, el('span', { text: 'صوت القراءة' }), vmode), testBtn, diag,
        el('label', { class: 'row', style: 'align-items:center' }, el('span', { text: 'لهجة التعرّف على كلامك' }), dialect), el('label', { class: 'row', style: 'align-items:center;justify-content:flex-start' }, sound, el('span', { text: 'أصوات المؤثرات' })),
        done, !first ? el('p', { class: 'hint', text: 'بياناتك محفوظة على هذا الجهاز فقط.' }) : null);
    }
  }

  // ---------- learn: pick book / section ----------
  let LIB = null;
  async function getLib() { if (!LIB) LIB = (await api('/api/learn/library')).books; return LIB; }
  function openLearn(purpose, opts = {}) { openSheet(purpose === 'quiz' ? 'اختبرني' : (opts.mic ? 'اسأل بصوتك' : 'تعلّم'), () => screenBooks(purpose, opts)); }
  const SUBJ = [[/رياض/, '🔢'], [/علوم|احياء|أحياء|فيزياء|كيمياء/, '🔬'], [/عرب|لغتي|قراءة|نحو/, '📝'], [/اسلام|إسلام|قرآن|قران|دين/, '🕌'], [/انجليز|إنجليز|english/i, '🔤'], [/اجتماع|تاريخ|جغراف|وطن/, '🌍'], [/حاسوب|تقنية|حاسب/, '💻'], [/فن|رسم/, '🎨']];
  const subjEm = t => (SUBJ.find(([re]) => re.test(t || '')) || [0, '📘'])[1];
  const sameGrade = (a, b) => String(a || '').replace(/\s+/g, ' ').trim() === String(b || '').replace(/\s+/g, ' ').trim();
  async function screenBooks(purpose, opts) {
    const sid = S.sid; setBody(loading('أحضر كتبك…'));
    let books; try { books = await getLib(); } catch (e) { if (sid === S.sid) setBody(errorBox(e.message, () => { LIB = null; screenBooks(purpose, opts); })); return; }
    if (sid !== S.sid) return;
    if (!books.length) { setBody(el('div', { class: 'center', style: 'flex:1;display:flex;flex-direction:column;gap:10px' }, el('div', { class: 'owl', text: '📚' }), el('p', { class: 'bubble', text: 'لا توجد كتب في المكتبة بعد. اطلب من إدارة المدرسة أو المنصة رفع الكتب.' }), el('button', { class: 'btn', text: 'العب بدلًا من ذلك 🎮', onclick: () => show('ألعاب', screenGames, true) }))); return; }
    let list = books, filtered = false;
    if (P.grade && !opts.showAll) { const f = books.filter(b => !b.grade || sameGrade(b.grade, P.grade)); if (f.length) { list = f; filtered = true; } }
    const groups = new Map(); for (const b of list) { const k = b.subject || 'كتب أخرى'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); }
    const nodes = [el('p', { class: 'bubble center', text: groups.size > 1 ? 'ماذا تريد أن تذاكر؟ اختر الكتاب' : 'اختر الكتاب' })];
    if (filtered) nodes.push(el('div', { class: 'hint', text: 'كتب ' + P.grade }));
    for (const [subject, arr] of groups) {
      if (groups.size > 1) nodes.push(el('h3', { class: 'sub', text: subjEm(subject) + ' ' + subject }));
      for (const b of arr) nodes.push(el('button', { class: 'big', type: 'button', onclick: () => { P.lastBook = b.id; save(); show(b.title, () => screenPick(b, purpose, opts)); } },
        el('span', { class: 'em', text: subjEm(b.subject || b.title) }), el('div', {}, (b.id === P.lastBook ? '⭐ ' : '') + b.title, el('small', { text: [b.subject, b.grade, b.term].filter(Boolean).join(' · ') }))));
    }
    if (filtered) nodes.push(el('button', { class: 'btn alt', type: 'button', text: 'عرض كتب كل الصفوف', onclick: () => show('اختر الكتاب', () => screenBooks(purpose, { ...opts, showAll: true }), true) }));
    setBody(nodes);
  }
  function screenPick(book, purpose, opts) {
    const input = el('input', { class: 'input', placeholder: purpose === 'quiz' ? 'مثال: اختبرني في الدرس الأول' : 'مثال: اشرح لي الوحدة الأولى', 'aria-label': 'اكتب طلبك', maxlength: '200' });
    const go = () => { const q = input.value.trim(); if (!q) { toast('اكتب أو قل ما تريد أولًا'); return; } prime(); chooseSection({ bookId: book.id, bookTitle: book.title, query: q, title: q }, purpose); };
    const mic = el('button', { class: 'mic', type: 'button', 'aria-label': 'تحدّث', 'aria-pressed': 'false', text: '🎤', onclick: () => { prime(); listen(mic, input, t => { input.value = t; go(); }); } });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    setBody(
      el('p', { class: 'bubble center', text: purpose === 'quiz' ? 'ماذا تريد أن أختبرك فيه؟' : (opts.mic ? 'اضغط الميكروفون وقل ما تريد' : 'ماذا تريد أن تتعلم؟') }),
      el('div', { class: 'row' }, mic, input), el('button', { class: 'btn', type: 'button', text: purpose === 'quiz' ? '📝 ابدأ الاختبار' : '🔊 اشرح لي', onclick: go }),
      el('button', { class: 'big primary', type: 'button', onclick: () => show('الوحدات والدروس', () => screenUnits(book, purpose)) }, el('span', { class: 'em', text: '📚' }), el('div', {}, 'اختر من الوحدات والدروس', el('small', { text: 'أسهل طريقة' }))),
      (LIB && LIB.length > 1) ? el('button', { class: 'btn alt', type: 'button', text: 'تغيير الكتاب', onclick: () => show('اختر الكتاب', () => screenBooks(purpose, { ...opts, change: true }), true) }) : null);
    if (opts.mic) setTimeout(() => mic.focus({ preventScroll: true }), 300);
  }
  async function screenUnits(book, purpose) {
    const sid = S.sid; setBody(loading('أحضر الفهرس…'));
    let o; try { o = await api('/api/learn/outline?bookId=' + encodeURIComponent(book.id)); } catch (e) { if (sid === S.sid) setBody(errorBox(e.message, () => screenUnits(book, purpose))); return; }
    if (sid !== S.sid) return;
    const choose = (s, em) => el('button', { class: 'big', type: 'button', onclick: () => { prime(); chooseSection({ bookId: book.id, bookTitle: book.title, sectionId: s.id, title: s.title }, purpose); } }, el('span', { class: 'em', text: em }), s.title);
    const nodes = [];
    for (const u of o.units) nodes.push(el('button', { class: 'big', type: 'button', onclick: () => show(u.title, () => screenUnit(book, u, purpose)) }, el('span', { class: 'em', text: '📘' }), el('div', {}, u.title, el('small', { text: u.lessons.length ? AR(u.lessons.length) + ' دروس' : 'الوحدة كاملة' }))));
    for (const l of o.looseLessons) nodes.push(choose(l, '📖'));
    for (const p of o.parts) nodes.push(choose(p, '📄'));
    setBody(nodes.length ? [el('p', { class: 'bubble center', text: 'اختر ما تريد' }), nodes] : el('p', { class: 'bubble center', text: 'لم أجد فهرسًا لهذا الكتاب. اكتب طلبك بكلماتك في الصفحة السابقة.' }));
  }
  function screenUnit(book, u, purpose) {
    const choose = (s, em, label) => el('button', { class: 'big' + (em === '🌟' ? ' primary' : ''), type: 'button', onclick: () => { prime(); chooseSection({ bookId: book.id, bookTitle: book.title, sectionId: s.id, title: s.title }, purpose); } }, el('span', { class: 'em', text: em }), label || s.title);
    setBody(choose(u, '🌟', purpose === 'quiz' ? 'اختبرني في الوحدة كاملة' : 'اشرح الوحدة كاملة'), u.lessons.map(l => choose(l, '📖')));
  }
  function chooseSection(ctx, purpose) { S.ctx = ctx; if (purpose === 'quiz') startQuiz(ctx, 5); else startTeach(ctx, 'explain'); }

  // ---------- teaching ----------
  async function startTeach(ctx, mode, question, replace) {
    prime(); S.ctx = ctx; const sid = ++S.sid; setTransient(loading(mode === 'summary' ? 'أجهّز الملخص…' : mode === 'simple' ? 'أبسّط الشرح…' : 'الهيثم يجهّز الشرح…'));
    try {
      const d = await api('/api/learn/teach', { bookId: ctx.bookId, sectionId: ctx.sectionId, query: ctx.query, mode, question, stage: P.stage === 'kids' ? 'kids' : 'reader' });
      if (sid !== S.sid) return;
      S.ctx = { ...ctx, sectionId: d.sectionId, title: d.title, query: ctx.sectionId ? undefined : ctx.query };
      show(d.title, () => drawTeach(d), Boolean(replace));
    } catch (e) { if (sid === S.sid) setTransient(errorBox(e.message, () => startTeach(ctx, mode, question, replace)), el('button', { class: 'btn alt', text: 'رجوع', onclick: back })); }
  }
  function drawTeach(d) {
    const slides = d.slides.map(x => typeof x === 'string' ? { t: x, src: false } : x), last = slides.length - 1; let i = 0, auto = true, words = [];
    const dots = el('div', { class: 'dots', 'aria-hidden': 'true' }, slides.map(() => el('i')));
    const box = el('div', { class: 'slide', 'aria-live': 'polite' });
    const prev = el('button', { class: 'btn alt', type: 'button', text: '▶ السابق', 'aria-label': 'السابق', onclick: () => { render(i - 1); } });
    const play = el('button', { class: 'btn', type: 'button', onclick: () => { if (TTS.reading) { auto = false; stopSpeech(); play.textContent = '🔊 اقرأ'; } else { auto = true; read(); } } });
    const next = el('button', { class: 'btn alt', type: 'button', onclick: () => { if (i < last) render(i + 1); else finish(); } });
    const quizBtn = el('button', { class: 'act', type: 'button', onclick: () => startQuiz(S.ctx, 5) }, el('span', { text: '❓' }), 'اختبرني');
    function read() {
      play.textContent = '⏸ إيقاف';
      prefetchNext(slides[i + 1] && slides[i + 1].t); speak(slides[i].t, words, {
        onEnd() { play.textContent = '🔊 اقرأ'; if (!auto) return; if (i < last) render(i + 1); else finish(); },
        onFail(why) { auto = false; play.textContent = '🔊 اقرأ'; toast('تعذّر تشغيل الصوت (' + why + '). افتح ⚙️ إعداداتي ← «جرّب الصوت» لمعرفة السبب.'); }
      });
    }
    function render(n) {
      i = Math.max(0, Math.min(last, n)); stopSpeech();
      [...dots.children].forEach((x, k) => x.className = k === i ? 'on' : (k < i ? 'done' : ''));
      box.classList.toggle('src', slides[i].src); const tokens = slides[i].t.split(/\s+/).filter(Boolean); words = tokens.map(t => el('span', { class: 'w', text: t }));
      const p = el('p'); words.forEach((w, k) => { p.append(w); if (k < words.length - 1) p.append(' '); }); box.replaceChildren(p);
      prev.disabled = i === 0; next.textContent = i === last ? 'أنهيت ✓' : 'التالي ◀';
      if (auto) read(); else play.textContent = '🔊 اقرأ';
    }
    let finished = false;
    function finish() {
      if (finished) return; finished = true; auto = false; play.textContent = '🔊 اقرأ';
      const first = award(2, 'lessons', 'lesson:' + d.sectionId); confetti(); beep('win');
      toast(first ? '🎉 أحسنت! أنهيت الدرس وربحت ⭐⭐' : '🎉 أحسنت! أعدت المراجعة'); quizBtn.classList.add('glow');
    }
    const act = (em, label, fn) => el('button', { class: 'act', type: 'button', onclick: fn }, el('span', { text: em }), label);
    setBody(
      d.notice ? el('div', { class: 'notice', text: d.notice }) : null, dots, box, el('div', { class: 'ctrl' }, prev, play, next),
      el('div', { class: 'actions' }, act('🔁', 'أعد', () => { finished = false; auto = true; render(0); }), act('🧒', 'بسّط', () => startTeach(S.ctx, 'simple', '', true)), act('📝', 'ملخص', () => startTeach(S.ctx, 'summary', '', true)), quizBtn, act('💬', 'اسأل', () => show('اسأل عن الدرس', screenAsk)))
    );
    document.body.classList.toggle('kids', P.stage === 'kids'); render(0);
    body.onkeydown = e => { if (e.key === 'ArrowLeft') next.click(); else if (e.key === 'ArrowRight' && !prev.disabled) prev.click(); };
  }
  function screenAsk() {
    const input = el('input', { class: 'input', placeholder: 'اكتب سؤالك عن هذا الدرس', maxlength: '300', 'aria-label': 'سؤالك' });
    const go = () => { const q = input.value.trim(); if (!q) { toast('اكتب سؤالك أولًا'); return; } startTeach(S.ctx, 'ask', q, true); };
    const mic = el('button', { class: 'mic', type: 'button', 'aria-label': 'تحدّث', text: '🎤', onclick: () => { prime(); listen(mic, input, t => { input.value = t; go(); }); } });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    setBody(el('p', { class: 'bubble center', text: S.ctx.title ? 'عن «' + S.ctx.title + '»' : 'اسأل' }), el('div', { class: 'row' }, mic, input), el('button', { class: 'btn', text: '🔊 أجبني', onclick: go }));
  }

  // ---------- quiz ----------
  async function startQuiz(ctx, count) {
    prime(); S.ctx = ctx; const sid = ++S.sid; setTransient(loading('أجهّز أسئلتك…'));
    try {
      const d = await api('/api/learn/quiz', { bookId: ctx.bookId, sectionId: ctx.sectionId, query: ctx.query, count, stage: P.stage === 'kids' ? 'kids' : 'reader' });
      if (sid !== S.sid) return;
      show('اختبار: ' + d.title, () => drawQuiz(d), S.nav.length > 0 && /^اختبار/.test(S.nav[S.nav.length - 1].title));
    } catch (e) { if (sid === S.sid) setTransient(errorBox(e.message, () => startQuiz(ctx, count)), el('button', { class: 'btn alt', text: 'رجوع', onclick: back })); }
  }
  function drawQuiz(d) {
    const qs = d.questions; let idx = 0, correct = 0, partial = 0, locked = false;
    const letters = ['أ', 'ب', 'ج', 'د'];
    function next() { idx++; if (idx >= qs.length) results(); else ask(); }
    function feedback(ok, text) { const f = el('div', { class: 'fb ' + (ok ? 'ok' : 'no'), role: 'status', text }); return f; }
    function ask() {
      const q = qs[idx]; locked = false;
      const progress = el('div', { class: 'bar', 'aria-label': 'تقدّم الاختبار' }, el('i', { style: 'width:' + Math.round(idx / qs.length * 100) + '%' }));
      const listen1 = el('button', { class: 'btn alt', type: 'button', text: '🔊 اسمع السؤال', onclick: () => say(q.q) });
      const holder = el('div', { style: 'display:flex;flex-direction:column;gap:10px' });
      const nextBtn = () => el('button', { class: 'btn', type: 'button', text: idx === qs.length - 1 ? 'شاهد نتيجتي 🏁' : 'السؤال التالي ◀', onclick: next });
      if (q.type === 'mcq') {
        const btns = q.options.map((o, k) => el('button', { class: 'opt', type: 'button', onclick: () => {
          if (locked) return; locked = true; const ok = k === q.answer; btns.forEach((b, j) => { b.disabled = true; if (j === q.answer) b.classList.add('right'); else if (j === k) b.classList.add('wrong'); });
          if (ok) { correct++; beep('ok'); } else beep('bad');
          const f = feedback(ok, (ok ? '🎉 أحسنت! إجابة صحيحة.' : '💪 لا بأس، الإجابة الصحيحة: ' + q.options[q.answer]) + (q.why ? '\n' + q.why : '')); f.style.whiteSpace = 'pre-line';
          holder.append(f, nextBtn());
        } }, el('b', { text: letters[k] }), o));
        holder.append(...btns);
      } else {
        const ta = el('textarea', { class: 'input', placeholder: 'اكتب إجابتك هنا بكلماتك…', maxlength: '500', 'aria-label': 'إجابتك' });
        const mic = el('button', { class: 'mic', type: 'button', text: '🎤', 'aria-label': 'تحدّث بإجابتك', onclick: () => listen(mic, ta, () => {}) });
        const check = el('button', { class: 'btn', type: 'button', text: '✅ صحّح إجابتي', onclick: async () => {
          if (locked) return; if (ta.value.trim().length < 2) { toast('اكتب إجابتك أولًا'); return; }
          locked = true; check.disabled = true; check.textContent = 'أصحّح…';
          try {
            const g = await api('/api/learn/grade', { q: q.q, model: q.model, answer: ta.value.trim() });
            if (g.score === 2) { correct++; beep('ok'); } else if (g.score === 1) { partial++; beep('ok'); } else beep('bad');
            check.remove(); ta.disabled = true;
            holder.append(feedback(g.score >= 1, (g.score === 2 ? '🎉 ممتاز! ' : g.score === 1 ? '👍 إجابتك جيدة وتحتاج قليلًا من الإضافة. ' : '💪 حاول مرة أخرى لاحقًا. ') + (g.feedback || '')), g.score < 2 ? el('div', { class: 'notice', text: 'إجابة الكتاب: ' + q.model }) : null, nextBtn());
          } catch (e) { locked = false; check.disabled = false; check.textContent = '✅ صحّح إجابتي'; toast(e.message); }
        } });
        holder.append(el('div', { class: 'row' }, mic, ta), check);
      }
      setBody(progress, el('div', { class: 'hint', text: 'السؤال ' + AR(idx + 1) + ' من ' + AR(qs.length) }), el('div', { class: 'q', text: q.q }), listen1, holder);
      if (P.stage === 'kids') setTimeout(() => say(q.q), 350);
    }
    function results() {
      const score = correct + partial * .5, pct = score / qs.length; const em = pct >= .8 ? '🏆' : pct >= .5 ? '👍' : '💪';
      const stars = Math.round(score); award(stars, 'quizzes'); if (correct === qs.length) { P.stats.perfect++; award(2, null); } if (pct >= .5) { confetti(); beep('win'); }
      setBody(el('div', { class: 'center', style: 'flex:1;display:flex;flex-direction:column;gap:12px' }, el('div', { class: 'result', text: em }), el('div', { class: 'score', text: AR(score % 1 ? score.toFixed(1) : score) + ' من ' + AR(qs.length) }),
        el('p', { class: 'bubble', text: pct >= .8 ? 'ما شاء الله! أنت بطل حقيقي.' : pct >= .5 ? 'جيد جدًا! بقليل من المراجعة ستتقن الدرس.' : 'لا تحزن، المحاولة طريق النجاح. راجع الشرح ثم جرّب مرة أخرى.' }), el('div', { class: 'fb ok', text: '⭐ ربحت ' + AR(stars) + ' نجوم' })),
        el('button', { class: 'btn', type: 'button', text: '🔁 اختبار جديد', onclick: () => startQuiz(S.ctx, qs.length) }),
        el('button', { class: 'btn alt', type: 'button', text: '📖 راجع الشرح', onclick: () => startTeach(S.ctx, 'explain') }), el('button', { class: 'btn alt', type: 'button', text: '🏠 الرئيسية', onclick: closeSheet }));
    }
    if (d.notice) toast(d.notice); ask();
  }

  // ---------- games (work offline, no AI needed) ----------
  const LETTERS = [['أ', 'ألف', 'أرنب', '🐰'], ['ب', 'باء', 'بطة', '🦆'], ['ت', 'تاء', 'تفاحة', '🍎'], ['ث', 'ثاء', 'ثعلب', '🦊'], ['ج', 'جيم', 'جمل', '🐪'], ['ح', 'حاء', 'حصان', '🐴'], ['خ', 'خاء', 'خروف', '🐑'], ['د', 'دال', 'دجاجة', '🐔'], ['ذ', 'ذال', 'ذرة', '🌽'], ['ر', 'راء', 'رعد', '⛈️'], ['ز', 'زاي', 'زرافة', '🦒'], ['س', 'سين', 'سمكة', '🐟'], ['ش', 'شين', 'شمس', '☀️'], ['ص', 'صاد', 'صقر', '🦅'], ['ض', 'ضاد', 'ضفدع', '🐸'], ['ط', 'طاء', 'طائرة', '✈️'], ['ظ', 'ظاء', 'ظرف', '✉️'], ['ع', 'عين', 'عنب', '🍇'], ['غ', 'غين', 'غيمة', '☁️'], ['ف', 'فاء', 'فيل', '🐘'], ['ق', 'قاف', 'قمر', '🌙'], ['ك', 'كاف', 'كتاب', '📖'], ['ل', 'لام', 'ليمونة', '🍋'], ['م', 'ميم', 'موزة', '🍌'], ['ن', 'نون', 'نحلة', '🐝'], ['ه', 'هاء', 'هدية', '🎁'], ['و', 'واو', 'وردة', '🌹'], ['ي', 'ياء', 'يد', '✋']];
  const NUMW = ['صفر', 'واحد', 'اثنان', 'ثلاثة', 'أربعة', 'خمسة', 'ستة', 'سبعة', 'ثمانية', 'تسعة', 'عشرة', 'أحد عشر', 'اثنا عشر'];
  const THINGS = ['🍎', '⭐', '🐟', '🎈', '🚗', '🌸', '🐥', '🍪'];
  const COLORS = [['🍌', 'الموز', 'الأصفر', '#f6c90e'], ['🍎', 'التفاحة', 'الأحمر', '#e53935'], ['🐸', 'الضفدع', 'الأخضر', '#43a047'], ['🍊', 'البرتقالة', 'البرتقالي', '#fb8c00'], ['🐳', 'الحوت', 'الأزرق', '#1e66d0'], ['🍇', 'العنب', 'البنفسجي', '#7b1fa2']];
  const threeNums = (n, lo, hi) => { const s = new Set([n]); while (s.size < 3) { const c = n + (rnd(5) - 2); if (c >= lo && c <= hi) s.add(c); else s.add(lo + rnd(hi - lo + 1)); } return shuffle([...s]); };
  const GAMES = {
    letters: () => { const t = LETTERS[rnd(LETTERS.length)]; const others = shuffle(LETTERS.filter(x => x !== t)).slice(0, 2); const opts = shuffle([t, ...others]).map(x => ({ label: x[0], val: x[0] }));
      return { vis: t[3], prompt: 'ما أول حرف في اسم هذه الصورة؟', speak: t[2] + '. ما أول حرف في كلمة ' + t[2] + '؟', opts, right: t[0], after: t[2] + ' يبدأ بحرف ' + t[1] }; },
    count: () => { const n = 1 + rnd(9); const th = THINGS[rnd(THINGS.length)]; return { vis: th.repeat(n), prompt: 'كم عددها؟', speak: 'كم عددها؟', opts: threeNums(n, 1, 10).map(x => ({ label: AR(x), sub: NUMW[x], val: x })), right: n, after: 'العدد ' + NUMW[n] }; },
    math: () => { const sub = Math.random() < .4; let a, b, r; if (sub) { a = 2 + rnd(8); b = 1 + rnd(a - 1); r = a - b; } else { a = 1 + rnd(5); b = 1 + rnd(5); r = a + b; } const th = THINGS[rnd(THINGS.length)];
      return { vis: sub ? th.repeat(a) + ' ➖ ' + th.repeat(b) : th.repeat(a) + ' ➕ ' + th.repeat(b), small: true, prompt: AR(a) + (sub ? ' − ' : ' + ') + AR(b) + ' = ؟', speak: NUMW[a] + (sub ? ' ناقص ' : ' زائد ') + NUMW[b] + ' يساوي كم؟', opts: threeNums(r, 0, 12).map(x => ({ label: AR(x), val: x })), right: r, after: 'الناتج ' + NUMW[r] }; },
    colors: () => { const c = COLORS[rnd(COLORS.length)]; const opts = shuffle([c, ...shuffle(COLORS.filter(x => x !== c)).slice(0, 2)]).map(x => ({ label: '', sub: x[2], color: x[3], val: x[2] }));
      return { vis: c[0], prompt: 'ما لون ' + c[1] + '؟', speak: 'ما لون ' + c[1] + '؟', opts, right: c[2], after: 'لون ' + c[1] + ' ' + c[2] }; }
  };
  function openGames() { openSheet('ألعاب', screenGames); }
  function screenGames() {
    const g = (key, em, t, s) => el('button', { class: 'big', type: 'button', onclick: () => { prime(); show(t, () => playGame(key)); } }, el('span', { class: 'em', text: em }), el('div', {}, t, el('small', { text: s })));
    setBody(el('p', { class: 'bubble center', text: 'اختر لعبة 🎮' }), g('letters', '🔤', 'من أنا؟ الحروف', 'صورة وحرف البداية'), g('count', '🔢', 'العدّ', 'كم عددها؟'), g('math', '➕', 'جمع وطرح', 'بالصور والأرقام'), g('colors', '🎨', 'الألوان', 'ما لونه؟'));
  }
  function playGame(key) {
    const ROUNDS = 6; let n = 0, ok = 0;
    function round() {
      const r = GAMES[key](); let done = false;
      const vis = el('div', { class: 'vis' + (r.small ? ' small' : ''), role: 'img', 'aria-label': r.prompt, text: r.vis });
      const fb = el('div', { class: 'status', role: 'status' });
      const opts = el('div', { class: 'opts3' }, r.opts.map(o => {
        const b = el('button', { class: 'gopt', type: 'button', 'aria-label': o.label || o.sub, onclick: () => {
          if (done) return; done = true; const right = o.val === r.right;
          [...opts.children].forEach((x, j) => { if (r.opts[j].val === r.right) x.classList.add('right'); else if (x === b) x.classList.add('wrong'); x.disabled = true; });
          if (right) { ok++; beep('ok'); fb.textContent = '🎉 أحسنت!'; } else { beep('bad'); fb.textContent = '💪 حاول مرة أخرى في السؤال القادم'; }
          setTimeout(() => say(r.after), 250); setTimeout(() => { n++; if (n >= ROUNDS) end(); else round(); }, 2300);
        } }, o.color ? el('span', { class: 'dot', style: 'background:' + o.color }) : null, o.label ? o.label : null, o.sub ? el('small', { text: o.sub }) : null);
        return b;
      }));
      setBody(el('div', { class: 'bar' }, el('i', { style: 'width:' + Math.round(n / ROUNDS * 100) + '%' })), el('p', { class: 'bubble center', text: r.prompt }), vis, el('button', { class: 'btn alt', type: 'button', text: '🔊 أعد السؤال', onclick: () => say(r.speak) }), opts, fb);
      setTimeout(() => say(r.speak), 350);
    }
    function end() {
      award(ok, 'games'); if (ok >= 4) { confetti(); beep('win'); }
      setBody(el('div', { class: 'center', style: 'flex:1;display:flex;flex-direction:column;gap:12px' }, el('div', { class: 'result', text: ok >= 5 ? '🏆' : ok >= 3 ? '🎉' : '💪' }), el('div', { class: 'score', text: AR(ok) + ' من ' + AR(ROUNDS) }), el('div', { class: 'fb ok', text: '⭐ ربحت ' + AR(ok) + ' نجوم' })),
        el('button', { class: 'btn', type: 'button', text: '🔁 العب مرة أخرى', onclick: () => { n = 0; ok = 0; round(); } }), el('button', { class: 'btn alt', type: 'button', text: 'ألعاب أخرى', onclick: back }));
    }
    round();
  }

  // ---------- achievements ----------
  function openAchievements() {
    openSheet('إنجازاتي', () => {
      const level = Math.floor(P.stars / 20) + 1, into = P.stars % 20;
      setBody(el('div', { class: 'center', style: 'display:flex;flex-direction:column;gap:6px;align-items:center' }, el('div', { class: 'owl', text: P.avatar }), el('div', { class: 'score', text: '⭐ ' + AR(P.stars) }), el('div', { class: 'hint', text: 'المستوى ' + AR(level) + ' · ' + AR(20 - into) + ' نجمة للمستوى التالي' })),
        el('div', { class: 'bar', 'aria-label': 'تقدّم المستوى' }, el('i', { style: 'width:' + (into / 20 * 100) + '%' })),
        el('div', { class: 'row' }, el('div', { class: 'badge' }, el('span', { class: 'em', text: '🔥' }), AR(P.streak.count) + ' يوم متتالٍ'), el('div', { class: 'badge' }, el('span', { class: 'em', text: '📚' }), AR(P.stats.lessons) + ' دروس'), el('div', { class: 'badge' }, el('span', { class: 'em', text: '📝' }), AR(P.stats.quizzes) + ' اختبارات')),
        el('div', { class: 'badges' }, BADGES.map(([id, em, name]) => el('div', { class: 'badge' + (P.badges.includes(id) ? '' : ' lock') }, el('span', { class: 'em', text: em }), name))),
        el('button', { class: 'btn alt', type: 'button', text: '⚙️ إعداداتي', onclick: () => show('إعداداتي', () => settingsScreen(false)) }));
    });
  }

  // ---------- boot ----------
  $('#avatarBtn').addEventListener('click', () => openSettings(false));
  touchStreak(); document.body.classList.toggle('kids', P.stage === 'kids');
  buildHome(); renderHeader(); renderGreeting();
  if (!P.stage) openSettings(true);
  api('/api/learn/status').then(d => { CLOUD.ok = Boolean(d.tts); }).catch(() => {});
  api('/api/school-member/me').then(d => {
    if (d && d.authenticated && d.member && d.member.role === 'student' && d.member.grade) { S.school = d.school; if (!P.gradeManual && P.grade !== d.member.grade) { P.grade = d.member.grade; save(); } }
  }).catch(() => {});
  window.addEventListener('pagehide', stopSpeech);
  window.__taallam = { speak, stopSpeech, P: () => P, el };
})();

'use strict';
// Draws and drives the simulations defined in templates.js. Loaded only when a student (or an admin
// reviewing) opens an experiment, so it never slows the rest of the app. 2-D canvas only: it works
// on weak devices; solids are drawn as a rotatable wireframe (drag to rotate).
(function () {
  const T = window.SIMT; if (!T) throw new Error('templates.js must be loaded first');
  const el = (tag, attrs, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v); } for (const c of kids.flat(Infinity)) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c))); return n; };
  const fmt = v => (Math.round(v * 1000) / 1000).toLocaleString('ar', { maximumFractionDigits: 3 });
  const css = k => getComputedStyle(document.documentElement).getPropertyValue(k).trim() || null;
  const COL = () => ({ ink: css('--ink') || '#20352d', green: css('--green') || '#173f36', green2: css('--green2') || '#2b7a5f', gold: css('--gold') || '#d6a85f', line: css('--line') || '#eadfc8', bad: css('--bad') || '#d8533f', muted: css('--muted') || '#5d7167', bg: '#fffdf6' });
  const arrow = (c, x1, y1, x2, y2, col, label) => { c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 3; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); const a = Math.atan2(y2 - y1, x2 - x1); c.beginPath(); c.moveTo(x2, y2); c.lineTo(x2 - 10 * Math.cos(a - 0.4), y2 - 10 * Math.sin(a - 0.4)); c.lineTo(x2 - 10 * Math.cos(a + 0.4), y2 - 10 * Math.sin(a + 0.4)); c.closePath(); c.fill(); if (label) { c.font = 'bold 13px Tahoma,Arial'; c.textAlign = 'center'; c.fillText(label, (x1 + x2) / 2, Math.min(y1, y2) - 8); } };
  const text = (c, s, x, y, col, size = 13, align = 'center') => { c.fillStyle = col; c.font = (size >= 15 ? 'bold ' : '') + size + 'px Tahoma,Arial'; c.textAlign = align; c.fillText(s, x, y); };

  // ---------- drawers: (ctx, W, H, result, t, params, view, colors) ----------
  const DRAW = {
    free_fall(c, W, H, r, t, p, v, k) {
      const gy = H - 34, top = 24, hpx = gy - top, s = hpx / p.h, x0 = 56; const st = r.at(t);
      c.strokeStyle = k.line; c.fillStyle = k.muted; c.lineWidth = 1; c.font = '12px Tahoma,Arial'; c.textAlign = 'right';
      const stepM = p.h <= 10 ? 1 : p.h <= 50 ? 5 : p.h <= 120 ? 10 : 50;
      for (let m = 0; m <= p.h; m += stepM) { const y = gy - m * s; c.beginPath(); c.moveTo(x0, y); c.lineTo(x0 + 10, y); c.stroke(); c.fillText(m + ' م', x0 - 4, y + 4); }
      c.strokeStyle = k.ink; c.lineWidth = 2; c.beginPath(); c.moveTo(x0, top); c.lineTo(x0, gy); c.stroke();
      c.fillStyle = '#9b7b4a'; c.fillRect(x0 - 20, gy, W - x0, 8);
      const y = gy - st.y * s, cx = W * 0.55; c.fillStyle = k.green2; c.beginPath(); c.arc(cx, y - 11, 11, 0, 7); c.fill();
      if (t > 0 && t < r.duration) arrow(c, cx + 34, y - 11, cx + 34, y + 14, k.bad, '');
      text(c, 'الزمن ' + fmt(st.t) + ' ث', W - 86, 40, k.ink, 14); text(c, 'السرعة ' + fmt(st.v) + ' م/ث', W - 86, 62, k.green, 14); text(c, 'الارتفاع ' + fmt(Math.max(0, st.y)) + ' م', W - 86, 84, k.muted, 14);
    },
    projectile(c, W, H, r, t, p, v, k) {
      const ml = 46, mb = 34, w = W - ml - 14, h = H - mb - 16, bw = Math.max(r.bounds.w, 1) * 1.05, bh = Math.max(r.bounds.h, 1) * 1.15, s = Math.min(w / bw, h / bh);
      const X = x => ml + x * s, Y = y => H - mb - y * s;
      c.fillStyle = '#9b7b4a'; c.fillRect(ml, H - mb, W - ml - 8, 6); c.strokeStyle = k.line; c.lineWidth = 1; c.fillStyle = k.muted; c.font = '12px Tahoma,Arial';
      c.textAlign = 'center'; for (let i = 0; i <= 4; i++) { const m = bw * i / 4; c.fillText(Math.round(m) + ' م', X(m), H - 14); } c.textAlign = 'right'; for (let i = 0; i <= 3; i++) { const m = bh * i / 3; c.fillText(Math.round(m) + ' م', ml - 6, Y(m) + 4); }
      c.strokeStyle = k.gold; c.lineWidth = 2; c.setLineDash([6, 5]); c.beginPath(); for (let i = 0; i <= 80; i++) { const q = r.at(r.duration * i / 80); i ? c.lineTo(X(q.x), Y(q.y)) : c.moveTo(X(q.x), Y(q.y)); } c.stroke(); c.setLineDash([]);
      const q = r.at(t); c.fillStyle = k.green2; c.beginPath(); c.arc(X(q.x), Y(q.y), 8, 0, 7); c.fill();
      arrow(c, X(q.x), Y(q.y), X(q.x) + q.vx * s * 0.25, Y(q.y) - q.vy * s * 0.25, k.bad, '');
      text(c, 'الزمن ' + fmt(q.t) + ' ث', W - 80, 22, k.ink, 14); text(c, 'x = ' + fmt(q.x) + ' م  ·  y = ' + fmt(Math.max(0, q.y)) + ' م', W - 120, 44, k.muted, 13);
    },
    collision_1d(c, W, H, r, t, p, v, k) {
      let lo = Infinity, hi = -Infinity; for (let i = 0; i <= 60; i++) { const s0 = r.state(r.duration * i / 60); lo = Math.min(lo, s0.x1, s0.x2); hi = Math.max(hi, s0.x1, s0.x2); }
      const m = 40, span = Math.max(hi - lo, 1), sx = (W - 2 * m - 60) / span, X = x => m + 30 + (x - lo) * sx, gy = H * 0.68; const s = r.state(t);
      c.fillStyle = '#9b7b4a'; c.fillRect(8, gy + 22, W - 16, 6);
      const w1 = 34 + p.m1 * 2.2, w2 = 34 + p.m2 * 2.2, drawCart = (x, w, col, name, m2, vel) => { c.fillStyle = col; c.fillRect(X(x) - w / 2, gy - 30, w, 46); c.fillStyle = '#333'; c.beginPath(); c.arc(X(x) - w / 3, gy + 20, 7, 0, 7); c.arc(X(x) + w / 3, gy + 20, 7, 0, 7); c.fill(); text(c, name + ' · ' + m2 + ' كغ', X(x), gy - 38, k.ink, 12); if (Math.abs(vel) > 0.01) arrow(c, X(x), gy - 56, X(x) + Math.sign(vel) * Math.min(60, 8 + Math.abs(vel) * 6), gy - 56, k.bad, fmt(vel)); };
      const u1 = r.outputs[0].value, u2 = r.outputs[1].value; drawCart(s.x1, w1, k.green2, 'الأولى', p.m1, s.hit || !r.collides ? (s.hit ? u1 : p.v1) : p.v1); drawCart(s.x2, w2, k.gold, 'الثانية', p.m2, s.hit ? u2 : p.v2);
      text(c, s.hit ? 'بعد التصادم' : 'قبل التصادم', W / 2, 24, s.hit ? k.bad : k.green, 15);
      const sv = s.hit ? [u1, u2] : [p.v1, p.v2], pt = p.m1 * sv[0] + p.m2 * sv[1], kt = 0.5 * p.m1 * sv[0] ** 2 + 0.5 * p.m2 * sv[1] ** 2;
      text(c, 'الزخم الكلي = ' + fmt(pt) + ' كغ·م/ث    الطاقة الحركية = ' + fmt(kt) + ' جول', W / 2, H - 14, k.ink, 13);
    },
    force_friction(c, W, H, r, t, p, v, k) {
      const gy = H * 0.66, m = 40, st = r.at(t), maxX = Math.max(0.5 * Math.abs(r.outputs[4].value) * r.duration * r.duration, 1), travel = W - 2 * m - 80, x = m + 40 + Math.min(st.x / maxX, 1) * travel;
      c.fillStyle = '#9b7b4a'; c.fillRect(8, gy + 20, W - 16, 8); c.fillStyle = k.green2; c.fillRect(x - 36, gy - 40, 72, 60); text(c, p.m + ' كغ', x, gy - 4, '#fff', 14);
      const sc = 90 / Math.max(p.F, r.outputs[2].value, 1); arrow(c, x + 38, gy - 10, x + 38 + p.F * sc, gy - 10, k.green, 'F = ' + fmt(p.F) + ' ن');
      const f = r.outputs[2].value; if (f > 0) arrow(c, x - 38, gy + 12, x - 38 - f * sc, gy + 12, k.bad, 'احتكاك ' + fmt(f) + ' ن');
      text(c, r.moves ? 'يتحرك بتسارع ' + fmt(r.outputs[4].value) + ' م/ث²' : 'ساكن: القوة لا تتجاوز الاحتكاك الساكن', W / 2, 24, r.moves ? k.green : k.bad, 15);
      text(c, 'السرعة ' + fmt(st.v) + ' م/ث   ·   المسافة ' + fmt(st.x) + ' م', W / 2, H - 14, k.ink, 13);
    },
    geometry_area(c, W, H, r, t, p, v, k) {
      const s = r.shape, cx = W / 2, cy = H / 2, M = Math.max(p.a, p.b, p.h, 1), u = Math.min(W - 80, H - 70) / (s === 2 ? 2.2 * p.a : 1.15 * (s === 0 ? Math.max(p.a, p.b) : s === 1 ? Math.max(p.a, p.b) : Math.max(p.a, p.b, p.h))) * (s === 2 ? 1 : 1);
      const grid = Math.max(u, 6); c.strokeStyle = k.line; c.lineWidth = 1; for (let x = cx % grid; x < W; x += grid) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); } for (let y = cy % grid; y < H; y += grid) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
      c.fillStyle = k.green2 + '55'; c.strokeStyle = k.green; c.lineWidth = 3; c.beginPath();
      let lab = [];
      if (s === 0) { const w = p.a * u, h = p.b * u; c.rect(cx - w / 2, cy - h / 2, w, h); lab = [[p.a + ' سم', cx, cy + h / 2 + 18], [p.b + ' سم', cx + w / 2 + 28, cy]]; }
      else if (s === 1) { const w = p.a * u, h = p.b * u; c.moveTo(cx - w / 2, cy + h / 2); c.lineTo(cx + w / 2, cy + h / 2); c.lineTo(cx - w / 4, cy - h / 2); c.closePath(); lab = [[p.a + ' سم', cx, cy + h / 2 + 18], [p.b + ' سم', cx - w / 4 - 28, cy]]; }
      else if (s === 2) { c.arc(cx, cy, p.a * u, 0, 7); lab = [['نق = ' + p.a + ' سم', cx + p.a * u / 2, cy - 8]]; }
      else if (s === 3) { const a = p.a * u, b = p.b * u, h = p.h * u; c.moveTo(cx - a / 2, cy + h / 2); c.lineTo(cx + a / 2, cy + h / 2); c.lineTo(cx + b / 2, cy - h / 2); c.lineTo(cx - b / 2, cy - h / 2); c.closePath(); lab = [[p.a + ' سم', cx, cy + h / 2 + 18], [p.b + ' سم', cx, cy - h / 2 - 8], [p.h + ' سم', cx + Math.max(a, b) / 2 + 28, cy]]; }
      else { const a = p.a * u, h = p.b * u, sk = a * 0.3; c.moveTo(cx - a / 2 - sk / 2, cy + h / 2); c.lineTo(cx + a / 2 - sk / 2, cy + h / 2); c.lineTo(cx + a / 2 + sk / 2, cy - h / 2); c.lineTo(cx - a / 2 + sk / 2, cy - h / 2); c.closePath(); lab = [[p.a + ' سم', cx, cy + h / 2 + 18], [p.b + ' سم', cx + a / 2 + sk / 2 + 28, cy]]; }
      c.fill(); c.stroke(); for (const [s2, x, y] of lab) text(c, s2, x, y, k.ink, 14);
      text(c, r.outputs.map(o => o.label + ': ' + fmt(o.value) + ' ' + o.unit).join('    '), W / 2, H - 12, k.green, 14);
    },
    solid_volume(c, W, H, r, t, p, v, k) {
      const s = r.solid, a = p.a, b = p.b, h = p.h, V = []; let E = []; const circ = (rad, y, n = 28) => { const idx = []; for (let i = 0; i < n; i++) { const an = i / n * 2 * Math.PI; idx.push(V.push([rad * Math.cos(an), y, rad * Math.sin(an)]) - 1); } for (let i = 0; i < n; i++) E.push([idx[i], idx[(i + 1) % n]]); return idx; };
      let big;
      if (s === 0 || s === 1) { const L = a, Wd = s === 1 ? b : a, Hh = s === 1 ? h : a; big = Math.max(L, Wd, Hh); for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) V.push([x * L / 2, y * Hh / 2, z * Wd / 2]); for (let i = 0; i < 8; i++) for (const j of [1, 2, 4]) if (!(i & j)) E.push([i, i | j]); }
      else if (s === 2) { big = Math.max(2 * a, h); const t1 = circ(a, h / 2), b1 = circ(a, -h / 2); for (let i = 0; i < 28; i += 7) E.push([t1[i], b1[i]]); }
      else if (s === 3) { big = Math.max(2 * a, h); const b1 = circ(a, -h / 2), ap = V.push([0, h / 2, 0]) - 1; for (let i = 0; i < 28; i += 7) E.push([b1[i], ap]); }
      else if (s === 4) { big = 2 * a; for (let i = 0; i < 28; i++) { const an = i / 28 * 2 * Math.PI, an2 = (i + 1) / 28 * 2 * Math.PI; for (const f of [(q, w) => [a * Math.cos(q), a * Math.sin(q), 0], (q, w) => [a * Math.cos(q), 0, a * Math.sin(q)], (q, w) => [0, a * Math.cos(q), a * Math.sin(q)]]) { const i1 = V.push(f(an)) - 1, i2 = V.push(f(an2)) - 1; E.push([i1, i2]); } } }
      else { big = Math.max(a, h); for (const x of [-1, 1]) for (const z of [-1, 1]) V.push([x * a / 2, -h / 2, z * a / 2]); const ap = V.push([0, h / 2, 0]) - 1; E = [[0, 1], [1, 3], [3, 2], [2, 0], [0, ap], [1, ap], [2, ap], [3, ap]]; }
      const sc = Math.min(W, H) * 0.34 / (big / 2), cy2 = Math.cos(v.yaw), sy = Math.sin(v.yaw), cp = Math.cos(v.pitch), sp = Math.sin(v.pitch);
      const P2 = V.map(([x, y, z]) => { const x1 = x * cy2 + z * sy, z1 = -x * sy + z * cy2, y1 = y * cp - z1 * sp; return [W / 2 + x1 * sc, H / 2 - y1 * sc]; });
      c.strokeStyle = k.green; c.lineWidth = 2; c.beginPath(); for (const [i, j] of E) { c.moveTo(P2[i][0], P2[i][1]); c.lineTo(P2[j][0], P2[j][1]); } c.stroke();
      text(c, 'اسحب بإصبعك لتدوير المجسم', W / 2, 20, k.muted, 12); text(c, r.outputs.slice(0, 2).map(o => o.label + ': ' + fmt(o.value) + ' ' + o.unit).join('    '), W / 2, H - 12, k.green, 14);
    }
  };
  const HIDE = { geometry_area: { b: p => Math.round(p.shape) === 2, h: p => Math.round(p.shape) !== 3 }, solid_volume: { b: p => Math.round(p.solid) !== 1, h: p => [0, 4].includes(Math.round(p.solid)) } };
  const LABEL = { geometry_area: { 0: ['الطول', 'العرض'], 1: ['القاعدة', 'الارتفاع'], 2: ['نصف القطر', ''], 3: ['القاعدة الأولى', 'القاعدة الثانية'], 4: ['القاعدة', 'الارتفاع'] }, solid_volume: { 0: ['الضلع', ''], 1: ['الطول', 'العرض'], 2: ['نصف القطر', ''], 3: ['نصف القطر', ''], 4: ['نصف القطر', ''], 5: ['ضلع القاعدة', ''] } };

  // ---------- mount ----------
  function mount(host, templateId, initial, opts = {}) {
    const tpl = T.TEMPLATES[templateId]; if (!tpl) throw new Error('نوع التجربة غير معروف');
    const base = T.validate(templateId, initial || {}); let params = base.params; const locked = opts.lockedParams || [];
    const view = { yaw: 0.6, pitch: 0.45 }; let t = 0, playing = false, speed = 1, raf = 0, last = 0, res = tpl.compute(params);
    const cv = el('canvas', { class: 'sim-cv', role: 'img', 'aria-label': tpl.title }), ctx = cv.getContext('2d');
    const results = el('div', { class: 'sim-results', 'aria-live': 'polite' }), notes = el('div', { class: 'sim-notes' }), ctrls = el('div', { class: 'sim-params' });
    const play = el('button', { type: 'button', class: 'btn', text: '▶ تشغيل' }), reset = el('button', { type: 'button', class: 'btn alt', text: '↺ من البداية' });
    const spd = el('select', { class: 'input sim-speed', 'aria-label': 'سرعة العرض' }, ...[[0.25, 'بطيء جدًا'], [0.5, 'بطيء'], [1, 'عادي'], [2, 'سريع']].map(([v, tt]) => el('option', { value: v, text: tt, ...(v === 1 ? { selected: true } : {}) })));
    const timeline = el('input', { type: 'range', class: 'sim-time', min: 0, max: 1000, value: 0, 'aria-label': 'موضع الزمن' });
    const moving = tpl.kind === 'motion', root = el('div', { class: 'sim' }, el('p', { class: 'sim-intro', text: tpl.intro }), el('div', { class: 'sim-stage' }, cv), moving ? el('div', { class: 'sim-bar' }, play, reset, spd, timeline) : null, ctrls, results, notes);
    host.replaceChildren(root);
    function fit() { const w = Math.max(240, cv.parentElement.clientWidth || host.clientWidth || 320), dpr = Math.min(window.devicePixelRatio || 1, 2), h = Math.round(w * (w < 480 ? 0.78 : 0.56)); cv.style.height = h + 'px'; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); cv._w = w; cv._h = h; }
    function draw() { if (!cv._w) fit(); const k = COL(); ctx.clearRect(0, 0, cv._w, cv._h); ctx.fillStyle = k.bg; ctx.fillRect(0, 0, cv._w, cv._h); DRAW[templateId](ctx, cv._w, cv._h, res, t, params, view, k); }
    function showResults() {
      results.replaceChildren(el('h4', { text: 'النتائج (محسوبة من القوانين)' }), ...res.outputs.map(o => el('div', { class: 'sim-row' }, el('span', { class: 'sim-k', text: o.label }), el('b', { class: 'sim-v', text: fmt(o.value) + ' ' + o.unit }), o.formula ? el('small', { class: 'sim-f', text: o.formula }) : null)));
      notes.replaceChildren(...res.notes.map(n => el('p', { class: 'hint', text: 'ℹ️ ' + n })));
    }
    function buildControls() {
      const hide = HIDE[templateId] || {}, lab = (LABEL[templateId] || {})[Math.round(params.shape !== undefined ? params.shape : params.solid)] || null;
      ctrls.replaceChildren(...tpl.params.filter(q => !(hide[q.k] && hide[q.k](params))).map(q => {
        let label = q.label; if (lab && q.k === 'a') label = lab[0] + ' (' + q.unit + ')'; else if (lab && q.k === 'b' && lab[1]) label = lab[1] + ' (' + q.unit + ')'; else if (q.k === 'h' && templateId === 'geometry_area') label = 'الارتفاع (' + q.unit + ')'; else label += q.unit ? ' (' + q.unit + ')' : '';
        const dis = locked.includes(q.k);
        if (q.choices && q.max - q.min <= 6 && q.k !== 'g') { const s = el('select', { class: 'input', disabled: dis, 'aria-label': q.label, onchange: e => change(q.k, Number(e.target.value)) }, ...q.choices.map(ch => el('option', { value: ch.v, text: ch.t, ...(Number(ch.v) === Number(params[q.k]) ? { selected: true } : {}) }))); return el('label', { class: 'sim-ctl' }, el('span', { text: q.label }), s); }
        const val = el('output', { class: 'sim-val', text: fmt(params[q.k]) }), inp = el('input', { type: 'range', min: q.min, max: q.max, step: q.step, value: params[q.k], disabled: dis, 'aria-label': q.label, oninput: e => { val.textContent = fmt(Number(e.target.value)); change(q.k, Number(e.target.value)); } });
        const wrap = el('label', { class: 'sim-ctl' }, el('span', { text: label }), el('div', { class: 'sim-ctl-row' }, inp, val));
        if (q.choices && q.k === 'g') wrap.append(el('div', { class: 'sim-presets' }, q.choices.map(ch => el('button', { type: 'button', class: 'chip', disabled: dis, text: ch.t, onclick: () => { params = { ...params, g: ch.v }; recompute(true); } }))));
        if (q.help) wrap.append(el('small', { class: 'hint', text: q.help }));
        return wrap;
      }));
    }
    function recompute(rebuild) { const v = T.validate(templateId, params); params = v.params; res = tpl.compute(params); if (rebuild) buildControls(); showResults(); if (t > (res.duration || 0)) t = 0; sync(); draw(); if (opts.onChange) opts.onChange(params); }
    function change(k, val) { const old = params[k]; params = { ...params, [k]: val }; const structural = k === 'shape' || k === 'solid'; recompute(structural); if (moving && old !== val) { t = 0; } }
    function sync() { if (moving) timeline.value = res.duration ? Math.round(Math.min(t / res.duration, 1) * 1000) : 0; }
    function frame(ts) { if (!playing) return; const dt = Math.min(0.05, (ts - last) / 1000) * speed; last = ts; t += dt; if (t >= res.duration) { t = res.duration; playing = false; play.textContent = '▶ شغّل مرة أخرى'; } sync(); draw(); if (playing) raf = requestAnimationFrame(frame); }
    play.addEventListener('click', () => { if (playing) { playing = false; play.textContent = '▶ استئناف'; cancelAnimationFrame(raf); return; } if (t >= res.duration) t = 0; playing = true; last = performance.now(); play.textContent = '⏸ إيقاف مؤقت'; raf = requestAnimationFrame(frame); });
    reset.addEventListener('click', () => { playing = false; cancelAnimationFrame(raf); t = 0; play.textContent = '▶ تشغيل'; sync(); draw(); });
    spd.addEventListener('change', () => { speed = Number(spd.value); });
    timeline.addEventListener('input', () => { playing = false; cancelAnimationFrame(raf); play.textContent = '▶ تشغيل'; t = res.duration * Number(timeline.value) / 1000; draw(); });
    // drag to rotate solids
    let drag = null; cv.addEventListener('pointerdown', e => { if (templateId !== 'solid_volume') return; drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); }); cv.addEventListener('pointermove', e => { if (!drag) return; view.yaw += (e.clientX - drag.x) * 0.01; view.pitch = Math.max(-1.4, Math.min(1.4, view.pitch + (e.clientY - drag.y) * 0.01)); drag = { x: e.clientX, y: e.clientY }; draw(); }); cv.addEventListener('pointerup', () => { drag = null; }); cv.style.touchAction = templateId === 'solid_volume' ? 'none' : 'auto';
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { fit(); draw(); }) : null; if (ro) ro.observe(cv.parentElement); else window.addEventListener('resize', () => { fit(); draw(); });
    buildControls(); showResults(); fit(); draw();
    if (moving && opts.autoplay) play.click();
    return { get params() { return params; }, get results() { return res; }, destroy() { playing = false; cancelAnimationFrame(raf); if (ro) ro.disconnect(); }, setParams(p) { params = T.validate(templateId, { ...params, ...p }).params; t = 0; recompute(true); } };
  }
  window.SIM = { mount, templates: T.TEMPLATES, _draw: DRAW }; // _draw is exposed for tests
})();

'use strict';
// Phase 2 check: the simulation equations, the drawing code, keyword detection from book text, and
// the review/approval flow through the real server.
//  A. equations are verified against INDEPENDENT calculations (numerical integration, conservation laws, fuzzing)
//  B. every drawer runs without error for every template and state
//  C. suggestions come from the book's text, grouped by page, never duplicated
//  D. server: suggest -> needs review -> approve -> students see it; verification gate; edits re-open review
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawn, execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const S = require(path.join(root, 'public', 'sim', 'templates.js'));
const learn = require(path.join(root, 'lib', 'learn.js'));
const checks = []; const ck = (label, ok) => checks.push([label, !!ok]);
const close = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));
const val = (id, p, k) => S.TEMPLATES[id].compute(S.validate(id, p).params).outputs.find(o => o.k === k).value;
let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

// ---------------- A. equations ----------------
for (const id of S.ids) ck('built-in verification passes: ' + S.TEMPLATES[id].title, S.selfCheckAll(id).every(c => c.ok));
// projectile vs. numerical integration (semi-implicit Euler, tiny step)
for (const [v0, ang, h0, g] of [[25, 45, 0, 9.8], [40, 30, 10, 9.8], [18, 70, 5, 1.62], [60, 15, 50, 24.8]]) {
  let x = 0, y = h0, vx = v0 * Math.cos(ang * Math.PI / 180), vy = v0 * Math.sin(ang * Math.PI / 180), t = 0, hmax = y; const dt = 1e-5;
  while (y >= 0) { vy -= g * dt; x += vx * dt; y += vy * dt; t += dt; hmax = Math.max(hmax, y); }
  const p = { v0, ang, h0, g }; ck(`projectile v0=${v0} θ=${ang} h0=${h0} g=${g}: time, range and max height match numerical integration`, close(val('projectile', p, 't'), t, 2e-3) && close(val('projectile', p, 'range'), x, 2e-3) && close(val('projectile', p, 'hmax'), hmax, 2e-3));
}
// free fall vs. numerical integration
for (const [h, g, v0] of [[20, 9.8, 0], [100, 3.71, 4], [500, 24.8, 30]]) { let y = h, v = v0, t = 0; const dt = 1e-5; while (y > 0) { v += g * dt; y -= v * dt; t += dt; } ck(`free fall h=${h} g=${g} v0=${v0}: time and impact speed match numerical integration`, close(val('free_fall', { h, g, v0 }, 't'), t, 2e-3) && close(val('free_fall', { h, g, v0 }, 'v'), v, 2e-3)); }
// collision: conservation laws over many random cases
let momOk = true, keOk = true, elOk = true, lossOk = true;
for (let i = 0; i < 500; i++) {
  const p = { m1: 0.5 + rnd() * 19, v1: -10 + rnd() * 20, m2: 0.5 + rnd() * 19, v2: -10 + rnd() * 20, e: rnd() }, o = S.TEMPLATES.collision_1d.compute(p).outputs;
  if (!close(o[2].value, o[3].value, 1e-3)) momOk = false; if (o[5].value > o[4].value + 1e-3) keOk = false; if (o[6].value < -1e-3) lossOk = false;
  const e1 = S.TEMPLATES.collision_1d.compute({ ...p, e: 1 }).outputs; if (!close(e1[4].value, e1[5].value, 1e-3)) elOk = false;
}
ck('collision (500 random cases): momentum is always conserved', momOk);
ck('collision (500 random cases): kinetic energy never increases', keOk && lossOk);
ck('collision (500 random cases): e = 1 conserves kinetic energy', elOk);
const rel = S.TEMPLATES.collision_1d.compute({ m1: 3, v1: 5, m2: 7, v2: -2, e: 0.6 }).outputs; ck('collision: relative speed after = e × relative speed before', close(rel[1].value - rel[0].value, 0.6 * 7, 1e-6));
// friction thresholds
ck('friction: starts moving exactly above μ_s·m·g', val('force_friction', { m: 10, F: 49, mus: 0.5, muk: 0.3 }, 'a') === 0 && val('force_friction', { m: 10, F: 49.5, mus: 0.5, muk: 0.3 }, 'a') > 0);
ck('friction: acceleration = (F − μ_k·m·g) / m', close(val('force_friction', { m: 20, F: 120, mus: 0.6, muk: 0.4 }, 'a'), (120 - 0.4 * 20 * 9.8) / 20));
// geometry vs. numerical area
const poly = n => { let a = 0; for (let i = 0; i < n; i++) { const t1 = 2 * Math.PI * i / n, t2 = 2 * Math.PI * (i + 1) / n; a += 0.5 * 7 * 7 * Math.sin(t2 - t1); } return a; };
ck('circle area equals the limit of regular polygons', close(val('geometry_area', { shape: 2, a: 7, b: 1, h: 1 }, 'area'), poly(100000), 1e-4));
// solids vs. integration over thin slices
const slices = (f, H, n = 20000) => { let v = 0; for (let i = 0; i < n; i++) { const z = (i + 0.5) * H / n; v += Math.PI * f(z) ** 2 * H / n; } return v; };
ck('sphere volume equals integration of circular slices', close(val('solid_volume', { solid: 4, a: 5, b: 1, h: 1 }, 'V'), slices(z => Math.sqrt(25 - (z - 5) ** 2), 10), 1e-3));
ck('cone volume equals integration of circular slices', close(val('solid_volume', { solid: 3, a: 4, b: 1, h: 9 }, 'V'), slices(z => 4 * (1 - z / 9), 9), 1e-3));
let lat = 0; { const n = 20000, r = 4, h = 9, l = Math.sqrt(r * r + h * h); for (let i = 0; i < n; i++) { const z = (i + 0.5) * h / n, rho = r * (1 - z / h); lat += 2 * Math.PI * rho * (l / h) * h / n; } ck('cone surface area = base + lateral area (integrated)', close(val('solid_volume', { solid: 3, a: 4, b: 1, h: 9 }, 'S'), Math.PI * 16 + lat, 1e-3)); }
ck('square pyramid volume equals integration of square slices', (() => { let v = 0; const n = 20000, a = 6, h = 4; for (let i = 0; i < n; i++) { const z = (i + 0.5) * h / n, s = a * (1 - z / h); v += s * s * h / n; } return close(val('solid_volume', { solid: 5, a: 6, b: 1, h: 4 }, 'V'), v, 1e-3); })());
// validation + fuzz
ck('validate clamps out-of-range numbers to the template range', S.validate('free_fall', { h: 99999, g: -4, v0: 'x1' }).ok === false && S.validate('free_fall', { h: 99999, g: -4 }).params.h === 500 && S.validate('free_fall', { h: 99999, g: -4 }).params.g === 1);
ck('validate rejects non-numeric values and unknown templates', S.validate('projectile', { v0: 'abc' }).ok === false && S.validate('nope', {}).ok === false);
ck('validate drops unknown keys', !('evil' in S.validate('free_fall', { evil: 1 }).params));
ck('validate keeps μ_k ≤ μ_s', (p => p.muk <= p.mus)(S.validate('force_friction', { mus: 0.2, muk: 1 }).params));
let fuzzOk = true; for (const id of S.ids) { const t = S.TEMPLATES[id]; for (let i = 0; i < 400; i++) { const p = {}; t.params.forEach(q => { p[q.k] = i < 3 ? [q.min, q.max, q.def][i] : q.min + rnd() * (q.max - q.min); }); const r = t.compute(S.validate(id, p).params); if (!r.outputs.every(o => Number.isFinite(o.value))) fuzzOk = false; if (r.at) { const a = r.at(r.duration); if (!Object.values(a).every(Number.isFinite)) fuzzOk = false; } if (r.state) { const a = r.state(r.duration); if (!Object.values(a).every(v => typeof v === 'boolean' || Number.isFinite(v))) fuzzOk = false; } } }
ck('fuzzing (400 parameter sets per template incl. extremes): every result is a finite number', fuzzOk);
ck('every output carries a formula or is a plain quantity (nothing is an unexplained number)', S.ids.every(id => S.TEMPLATES[id].compute(S.defaults(id)).outputs.every(o => o.label && (o.formula || o.k))));

// ---------------- B. drawers ----------------
global.window = { SIMT: S }; require(path.join(root, 'public', 'sim', 'render.js'));
const mkCtx = () => { let n = 0; const ctx = new Proxy({}, { get: (_, k) => k === '_ops' ? () => n : (typeof k === 'string' && /^(fillStyle|strokeStyle|lineWidth|font|textAlign)$/.test(k) ? '' : () => { n++; }), set: () => true }); return ctx; };
const colors = { ink: '#000', green: '#0a0', green2: '#0b0', gold: '#da6', line: '#eee', bad: '#d00', muted: '#666', bg: '#fff' };
let drawOk = true, drawn = 0;
for (const id of S.ids) { const t = S.TEMPLATES[id]; const sets = [S.defaults(id)]; t.params.forEach(q => { sets.push({ ...S.defaults(id), [q.k]: q.min }, { ...S.defaults(id), [q.k]: q.max }); }); if (id === 'solid_volume') for (let s = 0; s <= 5; s++) sets.push({ ...S.defaults(id), solid: s }); if (id === 'geometry_area') for (let s = 0; s <= 4; s++) sets.push({ ...S.defaults(id), shape: s });
  for (const raw of sets) { const p = S.validate(id, raw).params, r = t.compute(p); for (const f of [0, 0.5, 1]) { const c = mkCtx(); try { window.SIM._draw[id](c, 360, 260, r, (r.duration || 0) * f, p, { yaw: 0.6, pitch: 0.4 }, colors); if (c._ops() < 3) drawOk = false; drawn++; } catch (e) { drawOk = false; console.error('draw failed', id, JSON.stringify(p), e.message); } } } }
ck('all ' + drawn + ' draw calls (6 templates × extremes × start/middle/end) run without error and really draw', drawOk && drawn > 150);

// ---------------- C. detection from book text ----------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'taallam-sims-')); const dataA = path.join(tmp, 'a'); fs.mkdirSync(dataA);
const rj = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } }, sj = (f, d) => fs.writeFileSync(f, JSON.stringify(d));
const inter = require(path.join(root, 'lib', 'interactives.js'))({ dataDir: dataA, readJsonFile: rj, saveJsonFile: sj, learn });
const book = { id: 'b1', title: 'علوم', pages: 10 };
const pagesAr = ['مقدمة الكتاب', 'يُسمّى سقوط الجسم تحت تأثير الجاذبية فقط السقوط الحر. وتبلغ قيمة تسارع الجاذبية الأرضية 9.8 م/ث².', 'في السقوط الحر لا تعتمد مدة السقوط على الكتلة.', 'فقرة عامة', 'عند التصادم تنتقل كمية التحرك (الزخم) بين الجسمين.', 'نص لا علاقة له', 'مساحة المستطيل = الطول × العرض، ومحيط المستطيل = 2(ل + ع).', 'حجم المكعب = الضلع³ وحجم الأسطوانة = π نق² ع.', 'خاتمة', 'فهرس'];
const r1 = inter.detect(book, pagesAr), items = inter.list({ bookId: 'b1' }), byT = Object.fromEntries(items.map(i => [i.template, i]));
ck('detection finds experiments from the book text (Arabic keywords, normalised spelling)', ['free_fall', 'collision_1d', 'geometry_area', 'solid_volume'].every(t => byT[t]));
ck('consecutive pages about the same concept become ONE experiment with both page references', byT.free_fall && JSON.stringify(byT.free_fall.pages) === '[2,3]');
ck('every suggestion carries its source pages, an excerpt copied from that page, and waits for review', items.every(i => i.pages.length && i.status === 'needs_review' && i.origin === 'rule') && byT.collision_1d.source.excerpt.includes('التصادم'));
ck('no experiment is suggested for unrelated pages', !items.some(i => i.pages.includes(6) || i.pages.includes(1) || i.pages.includes(9)));
const r2 = inter.detect(book, pagesAr); ck('running the detection again creates nothing new (no duplicates)', r1.created === items.length && r2.created === 0 && r2.skipped === items.length && inter.list({ bookId: 'b1' }).length === items.length);
ck('students never see suggestions (only approved ones)', inter.approvedFor('b1').length === 0);
ck('approval is refused for an unknown template (verification fails)', (() => { const raw = rj(path.join(dataA, 'book-interactives.json'), {}); raw.items[0].template = 'ghost'; sj(path.join(dataA, 'book-interactives.json'), raw); try { inter.setStatus(raw.items[0].id, 'approved', 'x'); return false; } catch (e) { return e.status === 422; } })());

// ---------------- D. server flow ----------------
const wait = ms => new Promise(r => setTimeout(r, ms));
function have(cmd, args) { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; } catch (e) { return e.code !== 'ENOENT'; } }
(async () => {
  if (have('pdftoppm', ['-v']) && have('python3', ['-c', 'import reportlab'])) {
    const pdf = path.join(tmp, 'physics.pdf');
    execFileSync('python3', ['-c', `
from reportlab.pdfgen import canvas
c = canvas.Canvas('${pdf}')
T = {2:['Chapter 2: free fall','An object in free fall has the acceleration due to gravity of 9.8 m per second squared.'],3:['More about free fall','The acceleration due to gravity does not depend on mass.'],5:['Collision','In a collision the momentum of the system is conserved.'],8:['Geometry','The area of a circle is pi times r squared and the perimeter of a rectangle is 2(l+w).'],10:['Solids','The volume of a cylinder is pi r squared h and the volume of a cone is one third of it.']}
for i in range(1, 13):
    c.setFont('Helvetica', 14)
    for k, line in enumerate(T.get(i, ['Page %d' % i, 'Nothing special here, just ordinary words.'])): c.drawString(60, 780 - 26 * k, line)
    c.showPage()
c.save()`]);
    const modules = path.join(tmp, 'modules', 'pdf-parse'); fs.mkdirSync(modules, { recursive: true }); fs.writeFileSync(path.join(modules, 'index.js'), 'module.exports=async()=>({text:"x",numpages:1})');
    const data = path.join(tmp, 'data'); fs.mkdirSync(path.join(data, 'curriculum-pdfs'), { recursive: true });
    const port = 33000 + Math.floor(Math.random() * 20000);
    const child = spawn(process.execPath, [path.join(root, 'server.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: data, NODE_PATH: path.join(tmp, 'modules'), ADMIN_EMAIL: 'owner@example.invalid', ADMIN_PASSWORD: 'Owner-Password-For-Sims-Check-123', NODE_ENV: 'test', OCR_LANGS: 'eng' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
    const request = (method, url, o = {}) => new Promise((resolve, reject) => { const headers = { Origin: 'http://127.0.0.1:' + port, ...(o.headers || {}) }; if (o.cookie) headers.Cookie = o.cookie; let payload = o.raw; if (o.body !== undefined) { payload = JSON.stringify(o.body); headers['Content-Type'] = 'application/json'; } const req = http.request({ hostname: '127.0.0.1', port, path: url, method, headers }, res => { const ch = []; res.on('data', d => ch.push(d)); res.on('end', () => { const b = Buffer.concat(ch); let json = null; try { json = JSON.parse(b.toString('utf8')); } catch { /* */ } resolve({ status: res.statusCode, json, headers: res.headers, buf: b }); }); }); req.on('error', reject); if (payload) req.write(payload); req.end(); });
    try {
      for (let i = 0; i < 80; i++) { if (child.exitCode !== null) throw new Error('server exited: ' + log); try { if ((await request('GET', '/api/teacher/status')).status === 200) break; } catch { /* starting */ } await wait(150); }
      const ac = String((await request('POST', '/api/admin/login', { body: { email: 'owner@example.invalid', password: 'Owner-Password-For-Sims-Check-123' } })).headers['set-cookie']).split(';')[0];
      const up = await request('POST', '/api/curriculum/upload?title=Physics&subject=' + encodeURIComponent('الفيزياء') + '&grade=9', { cookie: ac, headers: { 'Content-Type': 'application/pdf' }, raw: fs.readFileSync(pdf) }); const bid = up.json.id;
      for (let i = 0; i < 200; i++) { const j = (await request('GET', '/api/admin/books/jobs', { cookie: ac })).json.jobs.find(x => x.bookId === bid); if (j && j.status === 'done') break; await wait(150); }
      for (let i = 0; i < 60; i++) { if ((await request('GET', '/api/admin/interactives?bookId=' + bid, { cookie: ac })).json.items.length >= 4) break; await wait(150); }
      const list = (await request('GET', '/api/admin/interactives?bookId=' + bid, { cookie: ac })).json.items, by = Object.fromEntries(list.map(i => [i.template, i]));
      if (process.env.TRACE) console.log(JSON.stringify(list.map(i => [i.template, i.pages, i.source.excerpt])));
      ck('server: when a book finishes processing, experiments are suggested from its pages automatically', ['free_fall', 'collision_1d', 'geometry_area', 'solid_volume'].every(t => by[t]) && list.length === 4);
      ck('server: page references match where the words really are (free fall on pages 2-3)', JSON.stringify(by.free_fall.pages) === '[2,3]' && by.collision_1d.pages[0] === 5 && by.solid_volume.pages[0] === 10);
      ck('server: the excerpt is real text from that page of the book', /free fall/i.test(by.free_fall.source.excerpt) && by.free_fall.checks.length >= 4 && by.free_fall.checks.every(c => c.ok));
      ck('server: the admin got a notice that suggestions wait for review', (await request('GET', '/api/admin/notices', { cookie: ac })).json.items.some(n => n.kind === 'interactives-suggested'));
      ck('server: students see nothing before approval', (await request('GET', '/api/learn/interactives?bookId=' + bid)).json.items.length === 0);
      ck('server: admin endpoints need an admin session', (await request('GET', '/api/admin/interactives')).status === 401 && (await request('POST', '/api/admin/interactives/' + by.free_fall.id + '/status', { body: { status: 'approved' } })).status === 401);
      const ap = await request('POST', '/api/admin/interactives/' + by.free_fall.id + '/status', { cookie: ac, body: { status: 'approved' } });
      const stu = (await request('GET', '/api/learn/interactives?bookId=' + bid)).json.items;
      ck('server: after approval students receive it with its page references', ap.status === 200 && stu.length === 1 && stu[0].template === 'free_fall' && JSON.stringify(stu[0].pages) === '[2,3]' && stu[0].bookTitle === 'Physics');
      ck('server: students are not shown review internals', !('checks' in stu[0]) && !('status' in stu[0]) && !('reviewedBy' in stu[0]) && !('origin' in stu[0]));
      ck('server: the page filter returns only experiments for that page', (await request('GET', '/api/learn/interactives?bookId=' + bid + '&page=3')).json.items.length === 1 && (await request('GET', '/api/learn/interactives?bookId=' + bid + '&page=9')).json.items.length === 0);
      ck('server: unknown book is a clean 404', (await request('GET', '/api/learn/interactives?bookId=nope')).status === 404);
      const ed = await request('PATCH', '/api/admin/interactives/' + by.free_fall.id, { cookie: ac, body: { title: 'سقوط الكرة', params: { h: 99999, g: 1.62, v0: 2 }, pages: [3, 2, 999] } });
      ck('server: editing clamps parameters, drops pages beyond the book, and re-opens review', ed.status === 200 && ed.json.item.params.h === 500 && ed.json.item.params.g === 1.62 && JSON.stringify(ed.json.item.pages) === '[2,3]' && ed.json.item.status === 'needs_review');
      ck('server: it disappears from students while it is under review again', (await request('GET', '/api/learn/interactives?bookId=' + bid)).json.items.length === 0);
      ck('server: a non-numeric parameter is refused', (await request('PATCH', '/api/admin/interactives/' + by.free_fall.id, { cookie: ac, body: { params: { h: 'abc' } } })).status === 400);
      const man = await request('POST', '/api/admin/interactives', { cookie: ac, body: { bookId: bid, template: 'projectile', pages: [4], title: 'مقذوف' } });
      ck('server: an experiment can be added by hand (pending review)', man.status === 201 && man.json.item.origin === 'manual' && man.json.item.status === 'needs_review');
      ck('server: manual add refuses unknown template / page outside the book / unknown book', (await request('POST', '/api/admin/interactives', { cookie: ac, body: { bookId: bid, template: 'x', pages: [1] } })).status === 400 && (await request('POST', '/api/admin/interactives', { cookie: ac, body: { bookId: bid, template: 'projectile', pages: [500] } })).status === 400 && (await request('POST', '/api/admin/interactives', { cookie: ac, body: { bookId: 'nope', template: 'projectile', pages: [1] } })).status === 404);
      const again = await request('POST', '/api/admin/books/' + bid + '/suggest-interactives', { cookie: ac, body: {} });
      ck('server: suggesting again adds nothing new', again.status === 200 && again.json.created === 0 && (await request('GET', '/api/admin/interactives?bookId=' + bid, { cookie: ac })).json.items.length === 5);
      await request('POST', '/api/admin/interactives/' + by.collision_1d.id + '/status', { cookie: ac, body: { status: 'approved' } });
      await request('POST', '/api/admin/interactives/' + by.solid_volume.id + '/status', { cookie: ac, body: { status: 'rejected' } });
      ck('server: rejected experiments stay hidden, approved ones show', (await request('GET', '/api/learn/interactives?bookId=' + bid)).json.items.map(i => i.template).join() === 'collision_1d');
      const repl = path.join(tmp, 'new.pdf'); fs.copyFileSync(pdf, repl);
      await request('POST', '/api/curriculum/replace?bookId=' + bid, { cookie: ac, headers: { 'Content-Type': 'application/pdf' }, raw: fs.readFileSync(repl) });
      ck('server: replacing the PDF sends approved experiments back to review (page references may have moved)', (await request('GET', '/api/learn/interactives?bookId=' + bid)).json.items.length === 0 && (await request('GET', '/api/admin/interactives?bookId=' + bid + '&status=needs_review', { cookie: ac })).json.items.some(i => i.template === 'collision_1d'));
      await wait(1500);
      ck('server: experiment pages are served (templates + renderer files exist and are static)', (await request('GET', '/sim/templates.js')).status === 200 && (await request('GET', '/sim/render.js')).status === 200);
      const del = await request('DELETE', '/api/admin/content/books/' + bid, { cookie: ac });
      ck('server: deleting the book removes its experiments', del.status === 200 && (await request('GET', '/api/admin/interactives?bookId=' + bid, { cookie: ac })).json.items.length === 0);
    } catch (e) { console.error('sims server part crashed:', e.stack || e, '\n--- server log ---\n' + log); process.exitCode = 1; }
    child.kill('SIGTERM'); await wait(200);
  } else console.log('SKIP server part of the experiment checks: poppler or python reportlab is missing here.');
  let failed = 0; for (const [label, ok] of checks) { console.log((ok ? 'PASS ' : 'FAIL ') + label); if (!ok) failed++; }
  console.log(`\n${checks.length - failed}/${checks.length} experiment checks passed.`); if (failed) process.exitCode = 1;
  fs.rmSync(tmp, { recursive: true, force: true });
})();

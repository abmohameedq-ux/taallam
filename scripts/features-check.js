'use strict';
// End-to-end check of the 2.79 features against a real server process:
// school fees, balance-based hiding of results, optional student e-mail, guardian view, idempotent
// retries, live events (SSE), About/rating/feedback, "all books" quiz and the page-image book reader.
// Needs poppler (pdftoppm/pdftotext/pdfinfo) for the reader checks - the Dockerfile installs it.
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawn, execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'seed-book-reversed.txt'), 'utf8');
const seedPdf = path.join(root, 'seed-books', fs.readdirSync(path.join(root, 'seed-books')).find(f => f.endsWith('.pdf')));
const wait = ms => new Promise(r => setTimeout(r, ms));
let hasPoppler = true; try { execFileSync('pdftoppm', ['-v'], { stdio: 'ignore' }); } catch (e) { hasPoppler = e.code !== 'ENOENT'; }

(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'taallam-features-'));
  const modules = path.join(temp, 'modules', 'pdf-parse'); fs.mkdirSync(modules, { recursive: true });
  fs.writeFileSync(path.join(modules, 'index.js'), 'module.exports=async()=>({text:"x",numpages:1})');
  const wp = path.join(temp, 'modules', 'web-push'); fs.mkdirSync(wp, { recursive: true }); const pushLog = path.join(temp, 'push.log');
  fs.writeFileSync(path.join(wp, 'index.js'), "const fs=require('fs');module.exports={setVapidDetails(){},async sendNotification(sub,body){fs.appendFileSync(process.env.PUSH_LOG,JSON.stringify({endpoint:sub.endpoint,body:JSON.parse(body)})+'\\n')}}");
  const dataDir = path.join(temp, 'data'), pdfDir = path.join(dataDir, 'curriculum-pdfs'); fs.mkdirSync(pdfDir, { recursive: true });
  fs.copyFileSync(seedPdf, path.join(pdfDir, 'seed.pdf'));
  fs.writeFileSync(path.join(dataDir, 'content.json'), JSON.stringify({ books: [
    { id: 'book1', title: 'التربية الإسلامية', grade: 'الأول الأساسي', subject: 'التربية الإسلامية', pages: 1, extractedText: raw, pdfUploaded: true, fileName: 'seed.pdf' },
    { id: 'book2', title: 'العلوم', grade: 'الأول الأساسي', subject: 'العلوم', pages: 6, extractedText: raw }], plans: [], lessons: [], units: [] }));
  const port = 33000 + Math.floor(Math.random() * 20000), origin = 'http://127.0.0.1:' + port;
  const env = { ...process.env, PORT: String(port), DATA_DIR: dataDir, NODE_PATH: path.join(temp, 'modules'), ADMIN_EMAIL: 'owner@example.invalid', ADMIN_PASSWORD: 'Owner-Password-For-Feature-Check-123', NODE_ENV: 'test', PUSH_LOG: pushLog };
  delete env.AI_API_KEY;
  const child = spawn(process.execPath, [path.join(root, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', d => out += d);
  const checks = [];
  const ck = (label, ok) => checks.push([label, !!ok]);
  function request(method, url, o = {}) {
    return new Promise((resolve, reject) => {
      const headers = { Origin: origin, ...(o.headers || {}) }; if (o.cookie) headers.Cookie = o.cookie;
      let payload = o.raw; if (o.body !== undefined) { payload = JSON.stringify(o.body); headers['Content-Type'] = 'application/json'; }
      const req = http.request({ hostname: '127.0.0.1', port, path: url, method, headers }, res => {
        const chunks = []; res.on('data', d => chunks.push(d)); res.on('end', () => { const buf = Buffer.concat(chunks); let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, buf, json }); });
      });
      req.on('error', reject); if (payload) req.write(payload); req.end();
    });
  }
  const cookieOf = r => String(r.headers['set-cookie'] || '').split(';')[0];
  function sse(cookie) {
    const events = []; let req;
    const ready = new Promise(resolve => {
      req = http.request({ hostname: '127.0.0.1', port, path: '/api/events', method: 'GET', headers: cookie ? { Cookie: cookie } : {} }, res => {
        res.setEncoding('utf8'); res.on('data', d => { for (const line of d.split('\n')) if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6))); }); resolve(res);
      }); req.end();
    });
    return { events, ready, close: () => req.destroy() };
  }

  try {
    for (let i = 0; i < 60; i++) { if (child.exitCode !== null) throw new Error('server exited: ' + out); try { if ((await request('GET', '/api/teacher/status')).status === 200) break; } catch { /* starting */ } await wait(150); }
    const admin = await request('POST', '/api/admin/login', { body: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD } }); const ac = cookieOf(admin);
    ck('platform admin login', admin.status === 200 && ac);

    // ---- school + accounts ----
    const mk = await request('POST', '/api/admin/schools', { cookie: ac, body: { name: 'مدرسة الاختبار', adminName: 'المدير', adminEmail: 'head@example.invalid', adminPassword: 'Head-Password-123', grades: ['الأول الأساسي'], schoolYear: '2026-2027' } });
    const schools = await request('GET', '/api/admin/schools', { cookie: ac }); const sid = schools.json.schools[0].id;
    ck('school created', mk.status < 300 && sid);
    const sa = await request('POST', '/api/school-admin/login', { body: { email: 'head@example.invalid', password: 'Head-Password-123' } }); const sac = cookieOf(sa);
    ck('school admin login', sa.status === 200 && sac);
    // ---- roster: the school enters names, the student picks his own name when linking an e-mail ----
    ck('roster add validates the grade', (await request('POST', '/api/school-admin/roster', { cookie: sac, body: { name: 'طالب', grade: 'صف غير موجود' } })).status === 400);
    const r1 = await request('POST', '/api/school-admin/roster', { cookie: sac, body: { name: 'طالب تجريبي', grade: 'الأول الأساسي', section: 'أ', guardianPhone: '+967 711 000 121' } });
    ck('school adds a student name', r1.status === 201 && r1.json.student.guardianPhone === '+967711000121'); const rid = r1.json.student.id;
    ck('duplicate name in the same grade is refused', (await request('POST', '/api/school-admin/roster', { cookie: sac, body: { name: 'طالب  تجريبي', grade: 'الأول الأساسي' } })).status === 409);
    const bulk = await request('POST', '/api/school-admin/roster/bulk', { cookie: sac, body: { grade: 'الأول الأساسي', section: 'ب', names: 'سارة أحمد\nعمر خالد|ج\nسارة أحمد\n\nليلى' } });
    ck('bulk paste adds names, skips duplicates, keeps per-line section', bulk.json.added === 3 && bulk.json.skipped === 1);
    const pub = (await request('GET', '/api/school-roster?schoolId=' + sid + '&grade=' + encodeURIComponent('الأول الأساسي'))).json;
    ck('public list offers the unlinked names of the grade', pub.hasRoster && pub.students.length === 4 && pub.students.some(x => x.id === rid));
    const noPick = await request('POST', '/api/student/register', { body: { schoolId: sid, name: 'اسم حر', email: 'kid@example.invalid', password: 'Kid-Password-123', grade: 'الأول الأساسي' } });
    ck('with a roster, a student must pick his name from it', noPick.status === 400);
    const reg = await request('POST', '/api/student/register', { body: { schoolId: sid, rosterId: rid, name: 'اسم مزوّر', email: 'kid@example.invalid', password: 'Kid-Password-123', grade: 'الصف الثاني' } });
    ck('registration is linked to the roster name (typed name/grade ignored)', reg.status < 300);
    const members = (await request('GET', '/api/school-admin/members', { cookie: sac })).json.members, kid = members.find(m => m.email === 'kid@example.invalid');
    ck('the pending request carries the roster name and grade', kid && kid.name === 'طالب تجريبي' && kid.grade === 'الأول الأساسي' && kid.section === 'أ');
    ck('the same name cannot be claimed twice', (await request('POST', '/api/student/register', { body: { schoolId: sid, rosterId: rid, email: 'other@example.invalid', password: 'Kid-Password-123' } })).status === 409);
    ck('a taken name leaves the public list', !(await request('GET', '/api/school-roster?schoolId=' + sid)).json.students.some(x => x.id === rid));
    const pre = await request('POST', '/api/school-member/login', { body: { email: 'kid@example.invalid', password: 'Kid-Password-123' } });
    ck('no school services before approval', pre.status === 403 || pre.status === 401);
    await request('POST', '/api/school-admin/members/review', { cookie: sac, body: { id: kid.id, action: 'approve' } });
    const st = await request('POST', '/api/school-member/login', { body: { email: 'kid@example.invalid', password: 'Kid-Password-123' } }); const stc = cookieOf(st);
    ck('student login after approval', st.status === 200 && stc);
    const me = await request('GET', '/api/school-member/me', { cookie: stc });
    ck('account exposes no second e-mail field', me.json.member && !('contactEmail' in me.json.member));
    // a student the school listed but who has no e-mail: school can handle his fees/results, he has no account
    const noMail = (await request('GET', '/api/school-admin/roster', { cookie: sac })).json.students.find(x => x.name === 'ليلى');
    ck('roster shows which students have a linked e-mail', noMail && noMail.account === null && (await request('GET', '/api/school-admin/roster', { cookie: sac })).json.students.find(x => x.id === rid).account.status === 'approved');
    await request('POST', '/api/school-admin/fees/payment', { cookie: sac, body: { studentId: noMail.id, feeTypeId: 'registration', amount: 10 } });
    const ov = (await request('GET', '/api/school-admin/fees/overview', { cookie: sac })).json;
    ck('fees work for a student without e-mail (no account)', ov.students.find(x => x.id === noMail.id).hasAccount === false && ov.students.find(x => x.id === rid).hasAccount === true);

    // ---- fee configuration ----
    const cfg0 = (await request('GET', '/api/school-admin/fees/config', { cookie: sac })).json;
    ck('default fee types are provided', cfg0.types.length === 6 && cfg0.types.some(t => t.id === 'registration'));
    const put = await request('PUT', '/api/school-admin/fees/config', { cookie: sac, body: { currency: 'ريال', types: [
      { id: 'registration', name: 'رسوم التسجيل', amount: 200, active: true }, { id: 'monthly', name: 'رسوم الأوراق', amount: 100, active: true },
      { name: 'الرسوم الأسبوعية', amount: 300, active: true }], policy: { mode: 'balance', maxBalance: 500, feeTypeIds: [] }, examTypes: ['الاختبار الشهري'] } });
    ck('fee types can be renamed and a new one added', put.status === 200 && put.json.types.length === 3 && put.json.types[1].name === 'رسوم الأوراق' && /^f-/.test(put.json.types[2].id));
    const weekly = put.json.types[2].id;

    // ---- results are hidden while the balance is above the limit ----
    ck('result entry validates the score', (await request('POST', '/api/school-admin/results', { cookie: sac, body: { studentId: rid, subject: 'العلوم', max: 100, score: 150 } })).status === 400);
    const addRes = await request('POST', '/api/school-admin/results', { cookie: sac, body: { studentId: rid, subject: 'العلوم', examType: 'الاختبار الشهري', max: 100, score: 88 } });
    ck('result added', addRes.status === 201);
    const sse1 = sse(stc), sseAnon = sse(''); await sse1.ready; await sseAnon.ready;
    let fin = (await request('GET', '/api/school-member/finance', { cookie: stc })).json;
    ck('balance 600 > limit 500: result is hidden', fin.resultsHidden === true && fin.totals.remaining === 600);
    ck('hidden result exposes no score', fin.results.length === 1 && fin.results[0].hidden === true && !('score' in fin.results[0]) && !JSON.stringify(fin).includes('"score"') && !JSON.stringify(fin).includes('"max"'));

    // ---- payments, idempotency, live events ----
    const key = 'feature-check-key-0001';
    const p1 = await request('POST', '/api/school-admin/fees/payment', { cookie: sac, headers: { 'X-Idempotency-Key': key }, body: { studentId: rid, feeTypeId: 'registration', amount: 150 } });
    const p2 = await request('POST', '/api/school-admin/fees/payment', { cookie: sac, headers: { 'X-Idempotency-Key': key }, body: { studentId: rid, feeTypeId: 'registration', amount: 150 } });
    ck('retry with the same key is answered from memory', p1.status === 201 && p2.status === 201 && p2.headers['x-idempotent-replay'] === '1' && p1.json.payment.id === p2.json.payment.id);
    const hist = (await request('GET', '/api/school-admin/fees/student/' + rid, { cookie: sac })).json.payments.filter(p => !p.voided);
    ck('the payment was recorded exactly once', hist.length === 1 && hist[0].amount === 150);
    await wait(400);
    ck('the student received a live event for his school', sse1.events.some(e => e.s === 'school'));
    ck('an anonymous visitor received no school event', !sseAnon.events.some(e => e.s === 'school'));
    fin = (await request('GET', '/api/school-member/finance', { cookie: stc })).json;
    ck('balance 450 <= limit 500: result becomes visible', fin.resultsHidden === false && fin.totals.remaining === 450 && fin.results[0].score === 88);
    await request('POST', '/api/school-admin/results/visibility', { cookie: sac, body: { studentId: rid, override: 'hide' } });
    fin = (await request('GET', '/api/school-member/finance', { cookie: stc })).json;
    ck('manual override hides the result even when paid up', fin.resultsHidden === true);
    await request('POST', '/api/school-admin/results/visibility', { cookie: sac, body: { studentId: rid, override: '' } });
    ck('negative or zero payments are refused', (await request('POST', '/api/school-admin/fees/payment', { cookie: sac, body: { studentId: rid, feeTypeId: 'monthly', amount: -5 } })).status === 400);
    const voided = await request('DELETE', '/api/school-admin/fees/payment/' + p1.json.payment.id, { cookie: sac });
    fin = (await request('GET', '/api/school-member/finance', { cookie: stc })).json;
    ck('voiding a payment restores the balance (history kept)', voided.status === 200 && fin.totals.remaining === 600);
    const removeType = await request('PUT', '/api/school-admin/fees/config', { cookie: sac, body: { currency: 'ريال', types: [{ id: 'monthly', name: 'رسوم الأوراق', amount: 100, active: true }], policy: { mode: 'off' } } });
    ck('a type with payment history is kept (deactivated), not erased', removeType.json.types.some(t => t.id === 'registration' && t.active === false));
    ck('a type without history is deleted', !removeType.json.types.some(t => t.id === weekly));

    // ---- other schools / roles cannot reach this data ----
    ck('student cannot call school-admin fees', (await request('GET', '/api/school-admin/fees/overview', { cookie: stc })).status === 401);
    ck('anonymous cannot read finance', (await request('GET', '/api/school-member/finance')).status === 401);

    // ---- guardian view ----
    const pr = await request('POST', '/api/parent/register', { body: { email: 'mum@example.invalid', password: 'Mum-Password-123' } }); const pc = cookieOf(pr);
    await request('POST', '/api/parent/guardian-links/request', { cookie: pc, body: { schoolId: sid, studentEmail: 'kid@example.invalid', relationship: 'أم' } });
    const links = (await request('GET', '/api/school-admin/guardian-links', { cookie: sac })).json.links;
    await request('POST', '/api/school-admin/guardian-links/review', { cookie: sac, body: { id: links[0].id, action: 'approve' } });
    await request('PUT', '/api/school-admin/fees/config', { cookie: sac, body: { currency: 'ريال', types: [{ id: 'monthly', name: 'رسوم الأوراق', amount: 100, active: true }], policy: { mode: 'balance', maxBalance: 0 } } });
    const gf = (await request('GET', '/api/parent/finance', { cookie: pc })).json;
    ck('guardian sees the child finance with results hidden', gf.students.length === 1 && gf.students[0].resultsHidden === true && !JSON.stringify(gf).includes('"score"'));
    ck('guardian finance needs a parent session', (await request('GET', '/api/parent/finance', { cookie: stc })).status === 401);

    // ---- reminders, in-app notifications, push, report ----
    const sub = await request('POST', '/api/push/subscribe', { cookie: stc, body: { subscription: { endpoint: 'https://push.example.invalid/abc123', keys: { p256dh: 'BPx-test-key', auth: 'auth-test' } } } });
    ck('a logged-in student can enable push notifications', sub.status === 200 && (await request('GET', '/api/push/key')).json.supported === true);
    ck('push subscription needs a session', (await request('POST', '/api/push/subscribe', { body: { subscription: { endpoint: 'https://x.example.invalid/a', keys: { p256dh: 'a', auth: 'b' } } } })).status === 401);
    ck('push endpoint must be https', (await request('POST', '/api/push/subscribe', { cookie: stc, body: { subscription: { endpoint: 'http://x.example.invalid/a', keys: { p256dh: 'a', auth: 'b' } } } })).status === 400);
    const remind = await request('POST', '/api/school-admin/fees/remind', { cookie: sac, body: {} });
    ck('reminder goes to every student who still owes', remind.status === 200 && remind.json.sent === 4);
    await wait(500);
    const plog = fs.existsSync(pushLog) ? fs.readFileSync(pushLog, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];
    ck('a push message was sent to the student device', plog.some(x => x.endpoint === 'https://push.example.invalid/abc123' && x.body.title === 'تذكير بالرسوم المدرسية'));
    ck('push messages never carry a score', !plog.some(x => JSON.stringify(x.body).includes('score')));
    const notes = (await request('GET', '/api/school-member/notifications', { cookie: stc })).json.items;
    ck('student sees reminder, payment and result notifications', ['fee-reminder', 'payment', 'result'].every(k => notes.some(n => n.kind === k)));
    await request('POST', '/api/school-member/notifications', { cookie: stc, body: {} });
    ck('notifications can be marked read', (await request('GET', '/api/school-member/notifications', { cookie: stc })).json.items.every(n => n.read.student));
    const pn = (await request('GET', '/api/parent/notifications', { cookie: pc })).json.items;
    ck('guardian sees the child notifications', pn.length >= 1 && pn[0].studentName === 'طالب تجريبي');
    ck('notifications need the right session', (await request('GET', '/api/parent/notifications', { cookie: stc })).status === 401 && (await request('GET', '/api/school-member/notifications')).status === 401);
    const rep = (await request('GET', '/api/school-admin/fees/report', { cookie: sac })).json;
    ck('collection report has totals, grades, types, months and top debtors', rep.totals.due > 0 && rep.byGrade.length === 1 && rep.byType.length >= 1 && rep.byMonth.length === 1 && rep.topDebtors.length >= 1 && rep.students === 4);

    // ---- join code, unlink, delete rules ----
    await request('PUT', '/api/school-admin/roster/settings', { cookie: sac, body: { joinCode: '1234' } });
    const locked = (await request('GET', '/api/school-roster?schoolId=' + sid)).json;
    ck('with a join code the names are hidden until it is given', locked.joinCodeRequired === true && locked.students.length === 0);
    const unlocked = (await request('GET', '/api/school-roster?schoolId=' + sid + '&code=1234')).json;
    ck('the right code reveals the list', unlocked.students.length === 3);
    const sara = unlocked.students.find(x => x.name === 'سارة أحمد');
    ck('registration without the code is refused', (await request('POST', '/api/student/register', { body: { schoolId: sid, rosterId: sara.id, email: 'sara@example.invalid', password: 'Sara-Password-123' } })).status === 403);
    ck('registration with the code works', (await request('POST', '/api/student/register', { body: { schoolId: sid, rosterId: sara.id, joinCode: '1234', email: 'sara@example.invalid', password: 'Sara-Password-123' } })).status === 201);
    await request('PUT', '/api/school-admin/roster/settings', { cookie: sac, body: { joinCode: '' } });
    ck('a linked student cannot be deleted from the roster', (await request('DELETE', '/api/school-admin/roster/' + sara.id, { cookie: sac })).status === 409);
    const omar = (await request('GET', '/api/school-admin/roster', { cookie: sac })).json.students.find(x => x.name === 'عمر خالد');
    ck('section given per line in the bulk list was kept', omar.section === 'ج');
    ck('a clean roster entry can be deleted', (await request('DELETE', '/api/school-admin/roster/' + omar.id, { cookie: sac })).status === 200);
    ck('an entry with fees cannot be deleted (archive instead)', (await request('DELETE', '/api/school-admin/roster/' + rid, { cookie: sac })).status === 409 || (await request('DELETE', '/api/school-admin/roster/' + noMail.id, { cookie: sac })).status === 409);
    const ren = await request('PATCH', '/api/school-admin/roster/' + rid, { cookie: sac, body: { name: 'طالب تجريبي معدّل', section: 'د' } });
    const kidNow = (await request('GET', '/api/school-admin/members', { cookie: sac })).json.members.find(m => m.id === kid.id);
    ck('renaming a roster student updates the linked account', ren.status === 200 && kidNow.name === 'طالب تجريبي معدّل' && kidNow.section === 'د');
    const unlink = await request('POST', '/api/school-admin/roster/' + rid + '/unlink', { cookie: sac });
    ck('unlinking the e-mail ends the account access', unlink.status === 200 && (await request('GET', '/api/school-member/me', { cookie: stc })).json.authenticated !== true);
    ck('after unlinking, the name is free again in the public list', (await request('GET', '/api/school-roster?schoolId=' + sid)).json.students.some(x => x.id === rid));

    // ---- backups ----
    const bk = await request('POST', '/api/admin/backups', { cookie: ac, body: {} });
    ck('platform owner can run a backup', bk.status === 201 && bk.json.files >= 3);
    ck('backups are listed', (await request('GET', '/api/admin/backups', { cookie: ac })).json.backups.length === 1);
    const dl = await request('GET', '/api/admin/backups/download', { cookie: ac });
    ck('backup downloads as a gzip archive', dl.status === 200 && dl.buf[0] === 0x1f && dl.buf[1] === 0x8b);
    ck('backups are closed to school admins', (await request('GET', '/api/admin/backups', { cookie: sac })).status === 401);

    // ---- school logo upload ----
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'), JPG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
    const up1 = await request('POST', '/api/school-admin/logo', { cookie: sac, headers: { 'Content-Type': 'image/png' }, raw: PNG });
    ck('school admin uploads a PNG logo', up1.status === 200 && /^\/api\/public\/school-logo\//.test(up1.json.logoUrl));
    const got = await request('GET', up1.json.logoUrl.split('?')[0]);
    ck('the logo is served publicly with the right type and no sniffing', got.status === 200 && got.headers['content-type'] === 'image/png' && got.headers['x-content-type-options'] === 'nosniff' && got.buf.equals(PNG));
    ck('the school record now points at the uploaded logo', (await request('GET', '/api/school-admin/overview', { cookie: sac })).json.school.logoUrl === up1.json.logoUrl);
    ck('SVG logos are refused (script risk)', (await request('POST', '/api/school-admin/logo', { cookie: sac, headers: { 'Content-Type': 'image/svg+xml' }, raw: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') })).status === 400);
    ck('a non-image is refused even if labelled as an image', (await request('POST', '/api/school-admin/logo', { cookie: sac, headers: { 'Content-Type': 'image/png' }, raw: Buffer.from('not an image at all, just text') })).status === 400);
    ck('an oversize image is refused (413)', (await request('POST', '/api/school-admin/logo', { cookie: sac, headers: { 'Content-Type': 'image/png' }, raw: Buffer.concat([PNG, Buffer.alloc(700 * 1024)]) }).catch(() => ({ status: 413 }))).status === 413);
    ck('logo upload needs a school admin session', (await request('POST', '/api/school-admin/logo', { headers: { 'Content-Type': 'image/png' }, raw: PNG })).status === 401);
    const up2 = await request('POST', '/api/admin/schools/' + sid + '/logo', { cookie: ac, headers: { 'Content-Type': 'image/jpeg' }, raw: JPG });
    const got2 = await request('GET', up2.json.logoUrl.split('?')[0]);
    ck('the platform admin can replace any school logo (old one is removed)', up2.status === 200 && got2.headers['content-type'] === 'image/jpeg' && fs.readdirSync(path.join(dataDir, 'school-logos')).filter(f => f.startsWith(sid)).length === 1);
    ck('platform logo upload: unknown school is 404, no session is 401', (await request('POST', '/api/admin/schools/nope/logo', { cookie: ac, headers: { 'Content-Type': 'image/png' }, raw: PNG })).status === 404 && (await request('POST', '/api/admin/schools/' + sid + '/logo', { headers: { 'Content-Type': 'image/png' }, raw: PNG })).status === 401);
    const rm = await request('DELETE', '/api/school-admin/logo', { cookie: sac });
    ck('the logo can be removed', rm.status === 200 && rm.json.logoUrl === '' && (await request('GET', '/api/public/school-logo/' + sid)).status === 404);

    // ---- about / rating / feedback ----
    const about = (await request('GET', '/api/platform/about')).json;
    ck('about lists the app features and a WhatsApp contact', about.features.length >= 6 && /^\+?\d+$/.test(about.whatsapp));
    ck('rating form accepts stars + reason + text', (await request('POST', '/api/feedback', { body: { rating: 5, reason: 'great', text: 'تطبيق ممتاز' } })).status === 201);
    ck('empty feedback is refused', (await request('POST', '/api/feedback', { body: { rating: 0, text: '' } })).status === 400);
    const fb = (await request('GET', '/api/admin/feedback', { cookie: ac })).json;
    ck('admin sees the rating statistics', fb.stats.count === 1 && fb.stats.average === 5);
    ck('feedback inbox is private', (await request('GET', '/api/admin/feedback')).status === 401);
    await request('PUT', '/api/admin/platform/about', { cookie: ac, body: { ...(await request('GET', '/api/admin/platform/about', { cookie: ac })).json, email: 'help@example.com', showEmail: true, showWhatsapp: false } });
    const about2 = (await request('GET', '/api/platform/about')).json;
    ck('admin can edit the e-mail and hide WhatsApp', about2.email === 'help@example.com' && about2.whatsapp === '');

    // ---- all books ----
    const lib = (await request('GET', '/api/learn/library')).json.books;
    ck('library flags books that have a PDF', lib.find(b => b.id === 'book1').hasPdf === true && !lib.find(b => b.id === 'book2').hasPdf);
    const mixed = await request('POST', '/api/learn/quiz', { body: { bookId: 'all', count: 4, grade: 'الأول الأساسي' } });
    ck('quiz over all books returns mixed questions with their subject', mixed.status === 200 && mixed.json.questions.length >= 2 && new Set(mixed.json.questions.map(q => q.subject)).size === 2);
    const bySubject = await request('POST', '/api/learn/quiz', { body: { bookId: 'subject:العلوم', count: 3 } });
    ck('quiz over one subject only uses that subject', bySubject.status === 200 && bySubject.json.questions.every(q => q.subject === 'العلوم'));
    const ask = await request('POST', '/api/learn/teach', { body: { bookId: 'all', query: 'ما هو الصدق', mode: 'ask', question: 'ما هو الصدق' } });
    ck('searching all books answers from the best book', ask.status === 200 && !!ask.json.bookId);
    ck('unknown subject scope is a clean 404', (await request('POST', '/api/learn/quiz', { body: { bookId: 'subject:لا-توجد' } })).status === 404);
    const out1 = (await request('GET', '/api/learn/outline?bookId=book1')).json;
    ck('outline keeps the book preface as its own entry', out1.intro === null || out1.intro.id === 'intro');

    // ---- reader ----
    if (hasPoppler) {
      const info = await request('GET', '/api/learn/book-info?bookId=book1');
      if (process.env.SHOW_TOC) console.log(JSON.stringify(info.json, null, 1));
      ck('book-info reports the real page count and a contents list', info.status === 200 && info.json.pages === 6 && info.json.toc[0].page === 1);
      const pg = await request('GET', '/api/learn/page?bookId=book1&n=2&w=600');
      ck('a book page is served as a JPEG image', pg.status === 200 && pg.headers['content-type'] === 'image/jpeg' && pg.buf[0] === 0xff && pg.buf[1] === 0xd8);
      const pt = await request('GET', '/api/learn/page-text?bookId=book1&n=1');
      ck('page text is available for reading aloud', pt.status === 200 && pt.json.text.length > 10);
      ck('page text past the end is 404', (await request('GET', '/api/learn/page-text?bookId=book1&n=99')).status === 404);
      ck('a page past the end is 404', (await request('GET', '/api/learn/page?bookId=book1&n=99&w=600')).status === 404);
      ck('a book without a PDF cannot be rendered', (await request('GET', '/api/learn/page?bookId=book2&n=1&w=600')).status === 404);
      ck('path tricks in bookId are neutralised', (await request('GET', '/api/learn/page?bookId=..%2F..%2Fetc&n=1')).status === 404);
    } else console.log('SKIP reader checks: poppler is not installed here');
    sse1.close(); sseAnon.close();
  } catch (e) { console.error('features check crashed:', e.stack || e, '\n--- server output ---\n' + out); process.exitCode = 1; }
  let failed = 0; for (const [label, ok] of checks) { console.log((ok ? 'PASS ' : 'FAIL ') + label); if (!ok) failed++; }
  console.log(`\n${checks.length - failed}/${checks.length} feature checks passed.`);
  if (failed) process.exitCode = 1;
  child.kill('SIGTERM'); await wait(150); fs.rmSync(temp, { recursive: true, force: true });
})();

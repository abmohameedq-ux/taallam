'use strict';
// Batch C check (real server): teachers with subject+grade assignments, grading limited to the
// teacher's own subjects, transcripts for students and guardians (columns appear only for exams that
// exist, fee-based hiding), notes/complaints with the right audiences, platform-owner control,
// birth dates in the roster, and permission boundaries.
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawn } = require('child_process');
const root = path.resolve(__dirname, '..'), wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'taallam-acad-')), modules = path.join(temp, 'modules', 'pdf-parse'); fs.mkdirSync(modules, { recursive: true });
  fs.writeFileSync(path.join(modules, 'index.js'), 'module.exports=async()=>({text:"x",numpages:1})');
  const dataDir = path.join(temp, 'data'); fs.mkdirSync(dataDir);
  const port = 33000 + Math.floor(Math.random() * 20000), origin = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, [path.join(root, 'server.js')], { env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, NODE_PATH: path.join(temp, 'modules'), ADMIN_EMAIL: 'owner@example.invalid', ADMIN_PASSWORD: 'Owner-Password-For-Academics-123', NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', d => log += d); child.stderr.on('data', d => log += d);
  const checks = []; const ck = (l, ok) => checks.push([l, !!ok]);
  const request = (method, url, o = {}) => new Promise((resolve, reject) => { const headers = { Origin: origin }; if (o.cookie) headers.Cookie = o.cookie; let payload; if (o.body !== undefined) { payload = JSON.stringify(o.body); headers['Content-Type'] = 'application/json'; } const req = http.request({ hostname: '127.0.0.1', port, path: url, method, headers }, res => { const ch = []; res.on('data', d => ch.push(d)); res.on('end', () => { let json = null; try { json = JSON.parse(Buffer.concat(ch).toString('utf8')); } catch { /* */ } resolve({ status: res.statusCode, json, headers: res.headers }); }); }); req.on('error', reject); if (payload) req.write(payload); req.end(); });
  const ck0 = r => String(r.headers['set-cookie'] || '').split(';')[0];
  const G1 = 'الأول الأساسي', G2 = 'الثاني الأساسي', QURAN = 'القرآن الكريم', MATH = 'الرياضيات';
  try {
    for (let i = 0; i < 80; i++) { if (child.exitCode !== null) throw new Error('server exited: ' + log); try { if ((await request('GET', '/api/teacher/status')).status === 200) break; } catch { /* starting */ } await wait(150); }
    const ac = ck0(await request('POST', '/api/admin/login', { body: { email: 'owner@example.invalid', password: 'Owner-Password-For-Academics-123' } }));
    await request('POST', '/api/admin/schools', { cookie: ac, body: { name: 'مدرسة الكشوف', adminName: 'المدير', adminEmail: 'head@example.invalid', adminPassword: 'Head-Password-123', deputyName: 'الوكيل', deputyEmail: 'dep@example.invalid', deputyPassword: 'Deputy-Password-123', grades: [G1, G2], schoolYear: '2026-2027' } });
    const sid = (await request('GET', '/api/admin/schools', { cookie: ac })).json.schools[0].id;
    const sac = ck0(await request('POST', '/api/school-admin/login', { body: { email: 'head@example.invalid', password: 'Head-Password-123' } }));
    const dac = ck0(await request('POST', '/api/school-admin/login', { body: { email: 'dep@example.invalid', password: 'Deputy-Password-123' } }));

    // ---------- roster with birth dates ----------
    const bulk = await request('POST', '/api/school-admin/roster/bulk', { cookie: sac, body: { grade: G1, section: 'أ', rows: [{ name: 'أحمد علي محمد', birthDate: '2018-05-10' }, { name: 'سارة خالد أحمد', birthDate: '2099-01-01' }, { name: 'عمر يوسف حسن' }, { name: 'أحمد علي محمد' }] } });
    await request('POST', '/api/school-admin/roster/bulk', { cookie: sac, body: { grade: G2, section: 'ب', rows: [{ name: 'ليلى حسن ناصر', birthDate: '2017-03-01' }] } });
    const roster = (await request('GET', '/api/school-admin/roster', { cookie: sac })).json.students, R = n => roster.find(x => x.name === n);
    ck('grid rows are added with birth date; duplicate rows inside the same submission are skipped', bulk.json.added === 3 && bulk.json.skipped === 1 && R('أحمد علي محمد').birthDate === '2018-05-10');
    ck('an impossible or future birth date is dropped, not stored', R('سارة خالد أحمد').birthDate === '' && R('عمر يوسف حسن').birthDate === '');
    ck('birth date can be edited', (await request('PATCH', '/api/school-admin/roster/' + R('عمر يوسف حسن').id, { cookie: sac, body: { birthDate: '2018-12-31' } })).json.student.birthDate === '2018-12-31');

    // ---------- teachers ----------
    const opts = (await request('GET', '/api/school-admin/academic-options', { cookie: sac })).json;
    ck('academic options: school grades, default subjects (Quran, math, behaviour…), exam types and terms', opts.grades.length === 2 && opts.subjects.includes(QURAN) && opts.subjects.includes('السلوك والمواظبة') && opts.terms.length === 2 && opts.examTypes.length >= 3);
    const asg1 = [{ grade: G1, subject: QURAN }, { grade: G2, subject: MATH }], asg2 = [{ grade: G1, subject: MATH }];
    ck('adding a teacher needs a session', (await request('POST', '/api/school-admin/teachers', { body: {} })).status === 401);
    const t1 = await request('POST', '/api/school-admin/teachers', { cookie: sac, body: { name: 'الأستاذ عبدالله', email: 'abd@example.invalid', password: 'Teacher-Password-1', assignments: asg1 } });
    ck('the school admin adds a teacher with subjects per grade (approved at once)', t1.status === 201 && t1.json.teacher.active === true && t1.json.teacher.assignments.length === 2);
    const t2 = await request('POST', '/api/school-admin/teachers', { cookie: sac, body: { name: 'الأستاذة هدى', email: 'huda@example.invalid', password: 'Teacher-Password-2', assignments: asg2 } });
    ck('a second teacher for another subject', t2.status === 201);
    ck('duplicate e-mail, bad grade, no subject and weak password are refused', (await request('POST', '/api/school-admin/teachers', { cookie: sac, body: { name: 'x', email: 'abd@example.invalid', password: 'Teacher-Password-1', assignments: asg1 } })).status === 409 && (await request('POST', '/api/school-admin/teachers', { cookie: sac, body: { name: 'x', email: 'n1@example.invalid', password: 'Teacher-Password-1', assignments: [{ grade: 'صف غير موجود', subject: MATH }] } })).status === 400 && (await request('POST', '/api/school-admin/teachers', { cookie: sac, body: { name: 'x', email: 'n2@example.invalid', password: 'Teacher-Password-1', assignments: [] } })).status === 400 && (await request('POST', '/api/school-admin/teachers', { cookie: sac, body: { name: 'x', email: 'n3@example.invalid', password: '123', assignments: asg1 } })).status === 400);
    ck('a deputy without a delegation cannot add teachers', (await request('POST', '/api/school-admin/teachers', { cookie: dac, body: { name: 'x', email: 'n4@example.invalid', password: 'Teacher-Password-1', assignments: asg1 } })).status === 403);
    const tc1 = ck0(await request('POST', '/api/school-member/login', { body: { email: 'abd@example.invalid', password: 'Teacher-Password-1' } })), tc2 = ck0(await request('POST', '/api/school-member/login', { body: { email: 'huda@example.invalid', password: 'Teacher-Password-2' } }));
    ck('teachers log in right away with the password the admin set', !!tc1 && !!tc2);
    const ov = (await request('GET', '/api/school-member/teacher/overview', { cookie: tc1 })).json;
    ck('a teacher sees his assignments and only the students of his grades', ov.assignments.length === 2 && ov.students.length === 4 && ov.students.every(s => [G1, G2].includes(s.grade)));
    ck('teacher endpoints are closed to anonymous users and to school admins', (await request('GET', '/api/school-member/teacher/overview')).status === 401 && (await request('GET', '/api/school-member/teacher/overview', { cookie: sac })).status === 401);
    ck('a teacher cannot use the school-admin screens', (await request('GET', '/api/school-admin/results', { cookie: tc1 })).status === 401 && (await request('POST', '/api/school-admin/teachers', { cookie: tc1, body: {} })).status === 401);

    // ---------- grading limited to own subject ----------
    const rowsG1 = [R('أحمد علي محمد'), R('سارة خالد أحمد'), R('عمر يوسف حسن')].map((s, i) => ({ studentId: s.id, score: [18, 15, 20][i] }));
    const post = (cookie, body) => request('POST', '/api/school-member/teacher/results', { cookie, body });
    const base = { grade: G1, subject: QURAN, examType: 'الاختبار الشهري', term: 'الجزء الأول', max: 20 };
    const g1 = await post(tc1, { ...base, rows: rowsG1 });
    ck('a teacher records grades for his own subject and grade', g1.status === 201 && g1.json.added === 3);
    ck('…but not for a subject that is not his', (await post(tc1, { ...base, subject: MATH, rows: rowsG1 })).status === 403);
    ck('…nor for a grade he does not teach this subject in', (await post(tc1, { ...base, grade: G2, subject: QURAN, rows: [{ studentId: R('ليلى حسن ناصر').id, score: 10 }] })).status === 403);
    ck('…nor a score above the maximum, nor a student of another grade', (await post(tc1, { ...base, rows: [{ studentId: rowsG1[0].studentId, score: 99 }] })).status === 400 && (await post(tc1, { ...base, rows: [{ studentId: R('ليلى حسن ناصر').id, score: 5 }] })).status === 403);
    await post(tc1, { ...base, examType: 'الاختبار النصفي', max: 40, rows: rowsG1.map(r => ({ ...r, score: r.score * 2 - 1 })) });
    await post(tc1, { ...base, term: 'الجزء الثاني', rows: rowsG1.map(r => ({ ...r, score: 10 })) });
    await post(tc2, { grade: G1, subject: MATH, examType: 'الاختبار الشهري', term: 'الجزء الأول', max: 50, rows: rowsG1.map(r => ({ ...r, score: 40 })) });
    ck('the other teacher records his own subject', (await request('GET', '/api/school-member/teacher/results?grade=' + encodeURIComponent(G1) + '&subject=' + encodeURIComponent(MATH), { cookie: tc2 })).json.results.length === 3);
    const t1Math = await request('GET', '/api/school-member/teacher/results?grade=' + encodeURIComponent(G1) + '&subject=' + encodeURIComponent(MATH), { cookie: tc1 });
    ck('a teacher cannot read the grades of another subject', t1Math.status === 403);
    const t1Quran = (await request('GET', '/api/school-member/teacher/results?grade=' + encodeURIComponent(G1) + '&subject=' + encodeURIComponent(QURAN), { cookie: tc1 })).json.results;
    ck('his list contains only his subject', t1Quran.length === 9 && t1Quran.every(r => r.studentName));
    const mathId = (await request('GET', '/api/school-member/teacher/results?grade=' + encodeURIComponent(G1) + '&subject=' + encodeURIComponent(MATH), { cookie: tc2 })).json.results[0].id;
    ck('a teacher cannot delete a grade of another subject', (await request('DELETE', '/api/school-member/teacher/results/' + mathId, { cookie: tc1 })).status === 403);
    const own = t1Quran.find(r => r.studentId === R('عمر يوسف حسن').id).id; ck('a teacher can delete his own grade', (await request('DELETE', '/api/school-member/teacher/results/' + own, { cookie: tc1 })).status === 200);
    ck('the school admin sees every subject', (await request('GET', '/api/school-admin/results', { cookie: sac })).json.results.length === 8 + 3);

    // ---------- student transcript ----------
    const reg = await request('POST', '/api/student/register', { body: { schoolId: sid, rosterId: R('أحمد علي محمد').id, email: 'ahmad@example.invalid', password: 'Student-Password-1' } });
    const mem = (await request('GET', '/api/school-admin/members', { cookie: sac })).json.members.find(m => m.email === 'ahmad@example.invalid');
    await request('POST', '/api/school-admin/members/review', { cookie: sac, body: { id: mem.id, action: 'approve' } });
    const stc = ck0(await request('POST', '/api/school-member/login', { body: { email: 'ahmad@example.invalid', password: 'Student-Password-1' } }));
    const tr = (await request('GET', '/api/school-member/transcript', { cookie: stc })).json;
    ck('transcript lists the subjects that have grades', reg.status === 201 && tr.subjects.length === 2 && tr.rows.length === 2);
    if (process.env.TRACE) console.log(JSON.stringify(tr.columns.map(c => c.label)));
    ck('columns exist only for exams that were taken, ordered part 1 (monthly, midterm) then part 2', tr.columns.map(c => c.label).join('|') === 'الجزء الأول — الاختبار الشهري|الجزء الأول — الاختبار النصفي|الجزء الثاني — الاختبار الشهري');
    const q = tr.rows.find(r => r.subject === QURAN), m = tr.rows.find(r => r.subject === MATH);
    ck('cells hold the score and maximum; a subject without that exam has an empty cell', Object.keys(q.cells).length >= 2 && Object.keys(m.cells).length === 1 && m.cells['الجزء الأول|الاختبار الشهري|'].score === 40);
    ck('totals and percentage are computed from the cells that exist', m.total === 40 && m.max === 50 && m.percent === 80);
    const one = (await request('GET', '/api/school-member/transcript?subject=' + encodeURIComponent(MATH), { cookie: stc })).json;
    ck('filtering by subject shows only that subject (and only its columns)', one.rows.length === 1 && one.columns.length === 1 && one.subjects.length === 2);
    ck('transcripts need a student session', (await request('GET', '/api/school-member/transcript')).status === 401 && (await request('GET', '/api/school-member/transcript', { cookie: tc1 })).status === 403);

    // ---------- guardian ----------
    const pc = ck0(await request('POST', '/api/parent/register', { body: { email: 'dad@example.invalid', password: 'Parent-Password-1' } }));
    await request('POST', '/api/parent/guardian-links/request', { cookie: pc, body: { schoolId: sid, studentEmail: 'ahmad@example.invalid', relationship: 'أب' } });
    const lk = (await request('GET', '/api/school-admin/guardian-links', { cookie: sac })).json.links[0];
    await request('POST', '/api/school-admin/guardian-links/review', { cookie: sac, body: { id: lk.id, action: 'approve' } });
    const gt = (await request('GET', '/api/parent/transcript', { cookie: pc })).json;
    ck('the guardian sees the child transcript', gt.students.length === 1 && gt.students[0].studentName === 'أحمد علي محمد' && gt.students[0].rows.length === 2);
    ck('the guardian transcript needs a parent session', (await request('GET', '/api/parent/transcript')).status === 401 && (await request('GET', '/api/parent/transcript', { cookie: stc })).status === 401);
    // fee-based hiding
    await request('PUT', '/api/school-admin/fees/config', { cookie: sac, body: { currency: 'ريال', types: [{ id: 'monthly', name: 'الرسوم', amount: 100, active: true }], policy: { mode: 'balance', maxBalance: 0 } } });
    const hid = (await request('GET', '/api/school-member/transcript', { cookie: stc })).json, ghid = (await request('GET', '/api/parent/transcript', { cookie: pc })).json.students[0];
    ck('with an unpaid balance the transcript keeps the subjects but hides every score', hid.hidden === true && hid.rows.length === 2 && !JSON.stringify(hid).includes('"score"') && hid.rows.every(r => r.total === null));
    ck('the guardian transcript is hidden too', ghid.hidden === true && !JSON.stringify(ghid).includes('"score"'));
    await request('PUT', '/api/school-admin/fees/config', { cookie: sac, body: { currency: 'ريال', types: [{ id: 'monthly', name: 'الرسوم', amount: 100, active: true }], policy: { mode: 'off' } } });

    // ---------- notes and complaints ----------
    const note = (cookie, kind, text, studentId) => request('POST', '/api/school-member/teacher/notes', { cookie, body: { studentId: studentId || R('أحمد علي محمد').id, kind, text } });
    ck('a teacher writes a praise, a note and a complaint for his student', (await note(tc1, 'praise', 'متفوق في الحفظ')).status === 201 && (await note(tc1, 'note', 'يحتاج مراجعة السور')).status === 201 && (await note(tc1, 'complaint', 'تكرر غيابه')).status === 201);
    ck('…but not for a student outside his grades, and not an empty or unknown kind', (await note(tc2, 'note', 'x', R('ليلى حسن ناصر').id)).status === 403 && (await note(tc1, 'note', '')).status === 400 && (await note(tc1, 'weird', 'x')).status === 400);
    const sn = (await request('GET', '/api/school-member/notes', { cookie: stc })).json.notes, pn = (await request('GET', '/api/parent/notes', { cookie: pc })).json.students[0].notes;
    ck('the student sees notes and praise but NOT complaints', sn.length === 2 && !sn.some(n => n.kind === 'complaint'));
    ck('the guardian sees all three kinds with who wrote them', pn.length === 3 && pn.some(n => n.kind === 'complaint' && n.by === 'الأستاذ عبدالله'));
    await wait(300);
    const sNot = (await request('GET', '/api/school-member/notifications', { cookie: stc })).json.items, pNot = (await request('GET', '/api/parent/notifications', { cookie: pc })).json.items;
    ck('the complaint notification goes to the guardian only', pNot.filter(n => n.kind === 'note').length === 3 && sNot.filter(n => n.kind === 'note').length === 2);
    const an = await request('POST', '/api/school-admin/notes', { cookie: sac, body: { studentId: R('أحمد علي محمد').id, kind: 'note', text: 'تواصلوا مع الإدارة' } });
    ck('the school admin can add and remove notes', an.status === 201 && (await request('DELETE', '/api/school-admin/notes/' + an.json.note.id, { cookie: sac })).status === 200);

    // ---------- teacher posts follow assignments ----------
    const tp = (cookie, b) => request('POST', '/api/school-member/teacher-posts', { cookie, body: { title: 'واجب', content: 'حل التمارين', type: 'assignment', ...b } });
    ck('posting follows the teacher assignments (grade + subject)', (await tp(tc1, { grade: G1, subject: QURAN })).status === 201 && (await tp(tc1, { grade: G2, subject: MATH })).status === 201);
    ck('…a subject or grade that is not assigned is refused, and the grade is required', (await tp(tc1, { grade: G1, subject: MATH })).status === 403 && (await tp(tc1, { grade: G2, subject: QURAN })).status === 403 && (await tp(tc1, { subject: QURAN })).status === 400);

    // ---------- platform owner controls teachers ----------
    const pt = await request('POST', '/api/admin/schools/' + sid + '/teachers', { cookie: ac, body: { name: 'معلم المنصة', email: 'plat@example.invalid', password: 'Teacher-Password-3', assignments: [{ grade: G2, subject: 'العلوم' }] } });
    ck('the platform owner adds a teacher to any school', pt.status === 201 && (await request('GET', '/api/admin/schools/' + sid + '/teachers', { cookie: ac })).json.teachers.length === 3);
    ck('…anonymous and school admins cannot', (await request('POST', '/api/admin/schools/' + sid + '/teachers', { body: {} })).status === 401 && (await request('POST', '/api/admin/schools/' + sid + '/teachers', { cookie: sac, body: {} })).status === 401);
    const pe = await request('PATCH', '/api/admin/schools/' + sid + '/teachers/' + pt.json.teacher.id, { cookie: ac, body: { assignments: [{ grade: G1, subject: 'العلوم' }, { grade: G2, subject: 'العلوم' }] } });
    ck('assignments can be edited', pe.status === 200 && pe.json.teacher.assignments.length === 2);
    const rp = await request('PATCH', '/api/school-admin/teachers/' + t2.json.teacher.id, { cookie: sac, body: { newPassword: 'Teacher-Password-9' } });
    ck('password reset ends the old session and the old password stops working', rp.status === 200 && (await request('GET', '/api/school-member/teacher/overview', { cookie: tc2 })).status === 401 && (await request('POST', '/api/school-member/login', { body: { email: 'huda@example.invalid', password: 'Teacher-Password-2' } })).status === 401 && (await request('POST', '/api/school-member/login', { body: { email: 'huda@example.invalid', password: 'Teacher-Password-9' } })).status === 200);
    await request('PATCH', '/api/school-admin/teachers/' + t1.json.teacher.id, { cookie: sac, body: { active: false } });
    ck('a disabled teacher is logged out and cannot log in', (await request('GET', '/api/school-member/teacher/overview', { cookie: tc1 })).status === 401 && (await request('POST', '/api/school-member/login', { body: { email: 'abd@example.invalid', password: 'Teacher-Password-1' } })).status >= 400);
  } catch (e) { console.error('academics check crashed:', e.stack || e, '\n--- server log ---\n' + log); process.exitCode = 1; }
  let failed = 0; for (const [l, ok] of checks) { console.log((ok ? 'PASS ' : 'FAIL ') + l); if (!ok) failed++; }
  console.log(`\n${checks.length - failed}/${checks.length} academics checks passed.`); if (failed) process.exitCode = 1;
  child.kill('SIGTERM'); await wait(150); fs.rmSync(temp, { recursive: true, force: true });
})();

'use strict';
// Features added in 2.79.0, kept in their own module so server.js stays readable:
//  - live updates (Server-Sent Events) so every open page refreshes when something changes
//  - idempotent retries (so queued offline requests are never applied twice)
//  - school fees (editable fee types, payments, balances) and exam results with balance-based hiding
//  - optional student contact e-mail
//  - editable "About" page, star rating and feedback inbox
//  - page-faithful book reader (page images + table of contents with page numbers)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

module.exports = function createExtras(ctx) {
  const { dataDir, send, readJsonFile, saveJsonFile, rateLimit, audit, learn } = ctx;
  const paymentsFile = path.join(dataDir, 'school-fees.json');
  const resultsFile = path.join(dataDir, 'school-results.json');
  const feedbackFile = path.join(dataDir, 'feedback.json');
  const aboutFile = path.join(dataDir, 'platform-about.json');
  const pageCacheDir = path.join(dataDir, 'page-cache');
  fs.mkdirSync(pageCacheDir, { recursive: true });
  const notify = require('./notify.js')({ dataDir, readJsonFile, saveJsonFile, readSchoolMembers: ctx.readSchoolMembers, readGuardianLinks: ctx.readGuardianLinks });
  const backup = require('./backup.js')({ dataDir });
  if (process.env.NODE_ENV !== 'test') backup.schedule();
  const rosterFile = path.join(dataDir, 'school-roster.json');
  const interactives = require('./interactives.js')({ dataDir, readJsonFile, saveJsonFile, learn });

  const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const now = () => new Date().toISOString();
  const money = v => Math.round(Number(v) * 100) / 100;
  const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const fail = (res, status, error) => send(res, status, { error });
  async function body(req, max = 20000) { return ctx.readBody(req, max); }
  function guard(res, e, fallback) { return send(res, e.status || 400, { error: e.message || fallback }); }

  // =====================================================================
  // 1) Live updates (SSE)
  // =====================================================================
  const clients = new Set();
  const MAX_CLIENTS = 3000, MAX_PER_IP = 25;

  function viewerScopes(req) {
    const scopes = new Set(['platform']); let all = false;
    const a = ctx.sessionAdmin(req); if (a) all = true;
    const sa = ctx.sessionSchoolAdmin(req); if (sa) scopes.add(sa.schoolId);
    const sm = ctx.sessionSchoolMember(req); if (sm) scopes.add(sm.school.id);
    const pr = ctx.sessionParent(req);
    if (pr) for (const l of ctx.readGuardianLinks().links) if (l.accountId === pr.accountId && l.status === 'approved') scopes.add(l.schoolId);
    return { scopes, all };
  }
  function emit(scope, kind) {
    const msg = 'data: ' + JSON.stringify({ s: scope === 'platform' ? 'platform' : 'school', k: kind, at: Date.now() }) + '\n\n';
    for (const c of clients) {
      if (c.all || c.scopes.has(scope)) { try { c.res.write(msg); } catch { clients.delete(c); } }
    }
  }
  function handleEvents(req, res) {
    const ip = ctx.clientIp(req);
    let mine = 0; for (const c of clients) if (c.ip === ip) mine++;
    if (clients.size >= MAX_CLIENTS || mine >= MAX_PER_IP) return fail(res, 503, 'عدد الاتصالات المباشرة كبير الآن. سيستمر التحديث الدوري.');
    const v = viewerScopes(req);
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
    res.write('retry: 4000\n\n: connected\n\n');
    const c = { res, ip, scopes: v.scopes, all: v.all };
    clients.add(c);
    const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch { cleanup(); } }, 25000);
    function cleanup() { clearInterval(beat); clients.delete(c); }
    req.on('close', cleanup); res.on('error', cleanup);
  }
  function mutationTargets(req, pathname) {
    if (!MUTATING.includes(req.method) || !pathname.startsWith('/api/')) return null;
    if (/\/(login|logout|register)$/.test(pathname) || pathname.startsWith('/api/learn/') || pathname === '/api/events') return null;
    if (pathname.startsWith('/api/school-admin/')) { const s = ctx.sessionSchoolAdmin(req); return s ? [[s.schoolId, 'data']] : null; }
    if (pathname.startsWith('/api/school-member/')) { const s = ctx.sessionSchoolMember(req); return s ? [[s.school.id, 'data']] : null; }
    if (pathname.startsWith('/api/admin/schools')) return [['platform', 'schools']];
    if (/^\/api\/(admin\/(platform|content|teacher-drafts|about|feedback)|curriculum|platform)/.test(pathname) || pathname === '/api/feedback') return [['platform', /about/.test(pathname) ? 'about' : /feedback/.test(pathname) ? 'feedback' : 'library']];
    return null;
  }

  // =====================================================================
  // 2) Idempotent retries
  // =====================================================================
  const idem = new Map();
  function idemGuard(req, res, pathname) {
    const key = String(req.headers['x-idempotency-key'] || '');
    if (!MUTATING.includes(req.method) || !/^[A-Za-z0-9-]{16,64}$/.test(key)) return false;
    const id = pathname + '|' + key; const hit = idem.get(id);
    if (hit) { req.resume(); res.writeHead(hit.status, { 'Content-Type': hit.type, 'X-Idempotent-Replay': '1', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(hit.body); return true; }
    const chunks = []; const w = res.write.bind(res), e = res.end.bind(res);
    res.write = (c, ...a) => { if (c && typeof c !== 'function' && chunks.length < 50) chunks.push(Buffer.from(c)); return w(c, ...a); };
    res.end = (c, ...a) => {
      try {
        if (c && typeof c !== 'function') chunks.push(Buffer.from(c));
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const b = Buffer.concat(chunks);
          if (b.length < 60000) { idem.set(id, { status: res.statusCode, type: res.getHeader('Content-Type') || 'application/json; charset=utf-8', body: b }); if (idem.size > 3000) idem.delete(idem.keys().next().value); }
        }
      } catch { /* never block a response */ }
      return e(c, ...a);
    };
    return false;
  }

  // =====================================================================
  // 3) Fees and results
  // =====================================================================
  const DEFAULT_TYPES = [['registration', 'رسوم التسجيل'], ['monthly', 'الرسوم الشهرية'], ['monthly-exam', 'رسوم الطبع والاختبار الشهري'], ['midterm', 'رسوم الاختبار النصفي'], ['final', 'رسوم نهاية العام والنتائج'], ['certificate', 'رسوم الشهادات']];
  const DEFAULT_EXAMS = ['الاختبار الشهري', 'الاختبار النصفي', 'الاختبار النهائي'];
  function feeConfig(school) {
    const f = school.fees || {};
    const types = (Array.isArray(f.types) && f.types.length ? f.types : DEFAULT_TYPES.map(([id, name]) => ({ id, name, amount: 0, active: true })))
      .map(t => ({ id: String(t.id), name: str(t.name, 60) || 'رسوم', amount: Math.max(0, money(t.amount) || 0), active: t.active !== false }));
    const p = f.policy || {};
    return {
      currency: str(f.currency, 20) || 'ريال', types,
      policy: { mode: p.mode === 'balance' ? 'balance' : 'off', maxBalance: Math.max(0, money(p.maxBalance) || 0), feeTypeIds: Array.isArray(p.feeTypeIds) ? p.feeTypeIds.map(String) : [] },
      examTypes: Array.isArray(school.examTypes) && school.examTypes.length ? school.examTypes : DEFAULT_EXAMS
    };
  }
  const readPayments = () => { const d = readJsonFile(paymentsFile, {}); return { payments: Array.isArray(d.payments) ? d.payments : [], dues: Array.isArray(d.dues) ? d.dues : [] }; };
  const readResults = () => { const d = readJsonFile(resultsFile, {}); return { results: Array.isArray(d.results) ? d.results : [], overrides: d.overrides && typeof d.overrides === 'object' ? d.overrides : {} }; };
  function financeFor(school, studentId, pay) {
    const cfg = feeConfig(school);
    const rows = cfg.types.filter(t => t.active).map(t => {
      const o = pay.dues.find(d => d.schoolId === school.id && d.studentId === studentId && d.feeTypeId === t.id);
      const due = o ? money(o.due) : t.amount;
      const paid = money(pay.payments.filter(p => p.schoolId === school.id && p.studentId === studentId && p.feeTypeId === t.id && !p.voided).reduce((a, p) => a + p.amount, 0));
      return { typeId: t.id, name: t.name, due, paid, remaining: Math.max(0, money(due - paid)), custom: !!o };
    });
    const counted = cfg.policy.feeTypeIds.length ? rows.filter(r => cfg.policy.feeTypeIds.includes(r.typeId)) : rows;
    return {
      rows, totalDue: money(rows.reduce((a, r) => a + r.due, 0)), totalPaid: money(rows.reduce((a, r) => a + r.paid, 0)),
      remaining: money(rows.reduce((a, r) => a + r.remaining, 0)), countedRemaining: money(counted.reduce((a, r) => a + r.remaining, 0))
    };
  }
  function hiddenState(school, studentId, fin, res) {
    const cfg = feeConfig(school); const ov = res.overrides[school.id + ':' + studentId] || '';
    if (ov === 'show') return { hidden: false, override: ov };
    if (ov === 'hide') return { hidden: true, override: ov, reason: 'manual' };
    if (cfg.policy.mode === 'balance' && fin.countedRemaining > cfg.policy.maxBalance) return { hidden: true, override: '', reason: 'balance' };
    return { hidden: false, override: '' };
  }
  // =====================================================================
  // Roster: the school's own list of students. An e-mail account is only a link to a roster name.
  // =====================================================================
  const readRoster = () => { const d = readJsonFile(rosterFile, {}); return { students: Array.isArray(d.students) ? d.students : [] }; };
  const saveRoster = d => saveJsonFile(rosterFile, d);
  function migrateRoster() { // accounts created before 2.80 become roster entries (same id, so earlier fees/results stay valid)
    const md = ctx.readSchoolMembers(), rd = readRoster(); let rc = false, mc = false;
    for (const m of md.members) {
      if (m.role !== 'student' || m.rosterId || m.status !== 'approved') continue;
      if (!rd.students.some(r => r.id === m.id)) rd.students.push({ id: m.id, schoolId: m.schoolId, name: m.name, grade: m.grade || '', section: m.section || '', guardianPhone: '', active: true, createdAt: m.createdAt || now() });
      m.rosterId = m.id; rc = mc = true;
    }
    if (rc) saveRoster(rd); if (mc) ctx.saveSchoolMembers(md);
  }
  migrateRoster();
  const accountFor = (rosterId, members) => (members || ctx.readSchoolMembers().members).find(m => m.rosterId === rosterId && m.role === 'student' && m.status !== 'rejected') || null;
  const approvedStudents = schoolId => readRoster().students.filter(r => r.schoolId === schoolId && r.active !== false);
  const cleanName = v => str(v, 120).replace(/\s+/g, ' ');
  const sameName = (a, b) => learn.normalizeArabic(a).replace(/\s+/g, ' ') === learn.normalizeArabic(b).replace(/\s+/g, ' ');
  const accountView = a => a ? { email: a.email, status: a.status, active: a.active, memberId: a.id } : null;

  // registration: the student picks his own name from the school's list, so the e-mail is tied to that name
  function prepareStudentRegistration(school, b) {
    const students = readRoster().students.filter(r => r.schoolId === school.id && r.active !== false);
    if (school.joinCode && String(b.joinCode || '').trim() !== String(school.joinCode)) return { error: 'رمز التسجيل غير صحيح. اطلبه من إدارة المدرسة.', status: 403 };
    if (!students.length) return {}; // the school has not entered names yet: the old free-name flow keeps working
    const entry = students.find(r => r.id === String(b.rosterId || ''));
    if (!entry) return { error: 'اختر اسمك من قائمة طلاب صفك. إن لم تجد اسمك فاطلب من الإدارة إضافته.', status: 400 };
    if (accountFor(entry.id)) return { error: 'هذا الاسم مرتبط ببريد آخر أو بانتظار الموافقة. راجع إدارة المدرسة.', status: 409 };
    return { entry };
  }
  function syncRosterFromMember(m) { // grade/section edited in the Members tab: the roster is the source of truth, keep it equal
    if (m.role !== 'student' || !m.rosterId) return; const rd = readRoster(), r = rd.students.find(x => x.id === m.rosterId);
    if (r && (r.grade !== (m.grade || '') || r.section !== (m.section || ''))) { r.grade = m.grade || ''; r.section = m.section || ''; saveRoster(rd); }
  }
  function onMemberReviewed(m) { // approving an old-style request (no roster name) creates its roster entry
    if (m.role !== 'student' || m.status !== 'approved' || m.rosterId) return;
    const rd = readRoster(); if (!rd.students.some(r => r.id === m.id)) rd.students.push({ id: m.id, schoolId: m.schoolId, name: m.name, grade: m.grade || '', section: m.section || '', guardianPhone: '', active: true, createdAt: now() });
    saveRoster(rd); const md = ctx.readSchoolMembers(), mm = md.members.find(x => x.id === m.id); if (mm) { mm.rosterId = m.id; ctx.saveSchoolMembers(md); }
  }
  function maskedResults(list, hidden) {
    return list.map(r => hidden ? { id: r.id, subject: r.subject, title: r.title, examType: r.examType, term: r.term, hidden: true } : { id: r.id, subject: r.subject, title: r.title, examType: r.examType, term: r.term, score: r.score, max: r.max, note: r.note, createdAt: r.createdAt });
  }
  function studentFinanceView(school, student) {
    const cfg = feeConfig(school), pay = readPayments(), rs = readResults();
    const fin = financeFor(school, student.id, pay), st = hiddenState(school, student.id, fin, rs);
    const mine = rs.results.filter(r => r.schoolId === school.id && r.studentId === student.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return {
      schoolName: school.name, studentName: student.name, grade: student.grade || '', section: student.section || '', currency: cfg.currency, fees: fin.rows, totals: { due: fin.totalDue, paid: fin.totalPaid, remaining: fin.remaining },
      resultsHidden: st.hidden, hiddenReason: st.hidden ? (st.reason === 'manual' ? 'أخفت إدارة المدرسة النتيجة مؤقتًا.' : 'النتيجة محجوبة لوجود رسوم متبقية. يرجى مراجعة إدارة المدرسة.') : '',
      balanceForHiding: st.hidden && st.reason === 'balance' ? fin.countedRemaining : null, results: maskedResults(mine, st.hidden)
    };
  }
  function paymentsSummary(school, st) {
    const pay = readPayments(), rs = readResults();
    const members = ctx.readSchoolMembers().members;
    const students = approvedStudents(school.id).map(m => {
      const fin = financeFor(school, m.id, pay), hs = hiddenState(school, m.id, fin, rs), acc = accountFor(m.id, members);
      return { id: m.id, name: m.name, email: acc ? acc.email : '', hasAccount: !!(acc && acc.status === 'approved' && acc.active), guardianPhone: m.guardianPhone || '', grade: m.grade || '', section: m.section || '', fees: fin.rows, totalDue: fin.totalDue, totalPaid: fin.totalPaid, remaining: fin.remaining, resultsHidden: hs.hidden, override: hs.override, resultsCount: rs.results.filter(r => r.schoolId === school.id && r.studentId === m.id).length };
    });
    return { students, summary: { due: money(students.reduce((a, s) => a + s.totalDue, 0)), paid: money(students.reduce((a, s) => a + s.totalPaid, 0)), remaining: money(students.reduce((a, s) => a + s.remaining, 0)), hidden: students.filter(s => s.resultsHidden).length } };
  }

  async function handleSchoolAdmin(req, res, pathname) {
    const P = '/api/school-admin/';
    if (!/^\/api\/school-admin\/(fees|results|roster)/.test(pathname)) return false;
    const ss = ctx.requireSchoolAdmin(req, res); if (!ss) return true;
    const school = ss.school, sid = ss.schoolId, principal = ss.account.schoolRole !== 'deputy';
    const m = req.method, sub = pathname.slice(P.length);
    try {
      if (m === 'GET' && sub === 'fees/config') return send(res, 200, feeConfig(school)), true;
      if (m === 'PUT' && sub === 'fees/config') {
        if (!principal) return fail(res, 403, 'تعديل إعدادات الرسوم متاح لمدير المدرسة فقط.'), true;
        const b = await body(req, 30000), schools = ctx.readSchools(), s = schools.schools.find(x => x.id === sid), old = feeConfig(s);
        const incoming = Array.isArray(b.types) ? b.types.slice(0, 40) : old.types;
        const pay = readPayments(); const used = new Set([...pay.payments.filter(p => p.schoolId === sid).map(p => p.feeTypeId), ...pay.dues.filter(d => d.schoolId === sid).map(d => d.feeTypeId)]);
        const seen = new Set(); const types = [];
        for (const t of incoming) {
          const name = str(t.name, 60); if (!name) continue;
          let id = /^[a-z0-9-]{3,40}$/i.test(String(t.id || '')) ? String(t.id) : 'f-' + crypto.randomBytes(4).toString('hex');
          if (seen.has(id)) id = 'f-' + crypto.randomBytes(4).toString('hex'); seen.add(id);
          types.push({ id, name, amount: Math.max(0, Math.min(1e9, money(t.amount) || 0)), active: t.active !== false });
        }
        for (const t of old.types) if (!seen.has(t.id) && used.has(t.id)) types.push({ ...t, active: false }); // never lose payment history
        if (!types.length) return fail(res, 400, 'أضف نوع رسوم واحدًا على الأقل.'), true;
        const pol = b.policy || {};
        s.fees = { currency: str(b.currency, 20) || old.currency, types, policy: { mode: pol.mode === 'balance' ? 'balance' : 'off', maxBalance: Math.max(0, Math.min(1e9, money(pol.maxBalance) || 0)), feeTypeIds: (Array.isArray(pol.feeTypeIds) ? pol.feeTypeIds : []).map(String).filter(id => types.some(t => t.id === id)).slice(0, 40) } };
        if (Array.isArray(b.examTypes)) s.examTypes = [...new Set(b.examTypes.map(x => str(x, 60)).filter(Boolean))].slice(0, 20);
        s.updatedAt = now(); saveJsonFile(ctx.schoolsFile, schools); audit(ss.email, 'school.fees.config', { schoolId: sid });
        return send(res, 200, feeConfig(s)), true;
      }
      if (m === 'GET' && sub === 'fees/overview') return send(res, 200, { ...paymentsSummary(school), config: feeConfig(school) }), true;
      if (m === 'GET' && sub.startsWith('fees/student/')) {
        const id = sub.slice('fees/student/'.length); const st = approvedStudents(sid).find(x => x.id === id);
        if (!st) return fail(res, 404, 'الطالب غير موجود في مدرستك.'), true;
        const pay = readPayments(); return send(res, 200, { payments: pay.payments.filter(p => p.schoolId === sid && p.studentId === id).sort((a, b) => b.at.localeCompare(a.at)) }), true;
      }
      if (m === 'POST' && sub === 'fees/payment') {
        const b = await body(req, 4000), st = approvedStudents(sid).find(x => x.id === String(b.studentId || ''));
        const cfg = feeConfig(school), type = cfg.types.find(t => t.id === String(b.feeTypeId || ''));
        const amount = money(b.amount);
        if (!st) return fail(res, 404, 'الطالب غير موجود في مدرستك.'), true;
        if (!type) return fail(res, 400, 'اختر نوع الرسوم.'), true;
        if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) return fail(res, 400, 'أدخل مبلغًا صحيحًا أكبر من صفر.'), true;
        const pay = readPayments();
        const p = { id: crypto.randomUUID(), schoolId: sid, studentId: st.id, feeTypeId: type.id, feeName: type.name, amount, note: str(b.note, 200), at: now(), by: ss.email, voided: false };
        pay.payments.push(p); saveJsonFile(paymentsFile, pay); audit(ss.email, 'school.fees.payment', { schoolId: sid, studentId: st.id, amount });
        const fin = financeFor(school, st.id, pay);
        notify.add({ schoolId: sid, rosterId: st.id, kind: 'payment', title: 'تم تسجيل دفعة', text: 'سُجّلت دفعة ' + amount + ' ' + cfg.currency + ' (' + type.name + '). المتبقي الآن: ' + fin.remaining + ' ' + cfg.currency + '.' }).catch(() => {});
        return send(res, 201, { payment: p, finance: fin }), true;
      }
      if (m === 'DELETE' && sub.startsWith('fees/payment/')) {
        const id = sub.slice('fees/payment/'.length), pay = readPayments(), p = pay.payments.find(x => x.id === id && x.schoolId === sid);
        if (!p) return fail(res, 404, 'الدفعة غير موجودة.'), true;
        p.voided = true; p.voidedAt = now(); p.voidedBy = ss.email; saveJsonFile(paymentsFile, pay); audit(ss.email, 'school.fees.void', { schoolId: sid, paymentId: id });
        return send(res, 200, { voided: true }), true;
      }
      if (m === 'POST' && sub === 'fees/due') {
        const b = await body(req, 3000), st = approvedStudents(sid).find(x => x.id === String(b.studentId || '')), type = feeConfig(school).types.find(t => t.id === String(b.feeTypeId || ''));
        if (!st || !type) return fail(res, 404, 'الطالب أو نوع الرسوم غير موجود.'), true;
        const pay = readPayments(); pay.dues = pay.dues.filter(d => !(d.schoolId === sid && d.studentId === st.id && d.feeTypeId === type.id));
        if (b.due !== null && b.due !== '' && b.due !== undefined) { const due = money(b.due); if (!Number.isFinite(due) || due < 0 || due > 1e9) return fail(res, 400, 'أدخل مبلغًا صحيحًا.'), true; pay.dues.push({ schoolId: sid, studentId: st.id, feeTypeId: type.id, due }); }
        saveJsonFile(paymentsFile, pay); return send(res, 200, { finance: financeFor(school, st.id, pay) }), true;
      }
      if (m === 'POST' && sub === 'results/visibility') {
        const b = await body(req, 2000), st = approvedStudents(sid).find(x => x.id === String(b.studentId || ''));
        if (!st) return fail(res, 404, 'الطالب غير موجود في مدرستك.'), true;
        const rs = readResults(), key = sid + ':' + st.id, v = ['show', 'hide'].includes(b.override) ? b.override : '';
        if (v) rs.overrides[key] = v; else delete rs.overrides[key];
        saveJsonFile(resultsFile, rs); audit(ss.email, 'school.results.visibility', { schoolId: sid, studentId: st.id, override: v || 'auto' });
        return send(res, 200, { override: v }), true;
      }
      if (m === 'GET' && sub === 'results') {
        const studentId = new URL(req.url, 'http://x').searchParams.get('studentId') || '';
        const names = new Map(readRoster().students.filter(x => x.schoolId === sid).map(x => [x.id, x.name]));
        const list = readResults().results.filter(r => r.schoolId === sid && (!studentId || r.studentId === studentId)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 500).map(r => ({ ...r, studentName: names.get(r.studentId) || 'طالب' }));
        return send(res, 200, { results: list, examTypes: feeConfig(school).examTypes }), true;
      }
      if (m === 'POST' && (sub === 'results' || sub === 'results/bulk')) {
        const b = await body(req, 60000), subject = str(b.subject, 100), examType = str(b.examType, 60), title = str(b.title, 120), term = str(b.term, 60), note = str(b.note, 300);
        const max = money(b.max === undefined || b.max === '' ? 100 : b.max);
        if (!subject) return fail(res, 400, 'اختر المادة.'), true;
        if (!Number.isFinite(max) || max <= 0 || max > 1e6) return fail(res, 400, 'أدخل الدرجة العظمى بشكل صحيح.'), true;
        const students = new Map(approvedStudents(sid).map(x => [x.id, x]));
        const rows = sub === 'results' ? [{ studentId: b.studentId, score: b.score, clientRef: b.clientRef }] : (Array.isArray(b.rows) ? b.rows.slice(0, 500) : []);
        const rs = readResults(), added = [];
        for (const r of rows) {
          if (r.score === '' || r.score === null || r.score === undefined) continue;
          const st = students.get(String(r.studentId || '')), score = money(r.score);
          if (!st) { if (sub === 'results') return fail(res, 404, 'الطالب غير موجود في مدرستك.'), true; continue; }
          if (!Number.isFinite(score) || score < 0 || score > max) { if (sub === 'results') return fail(res, 400, 'الدرجة يجب أن تكون بين 0 و' + max + '.'), true; continue; }
          const rec = { id: crypto.randomUUID(), schoolId: sid, studentId: st.id, subject, examType, title, term, score, max, note, academicYear: String(school.schoolYear || ''), createdAt: now(), createdBy: ss.email };
          rs.results.push(rec); added.push(rec);
        }
        if (!added.length) return fail(res, 400, 'لم تُدخل أي درجة صالحة.'), true;
        saveJsonFile(resultsFile, rs); audit(ss.email, 'school.results.add', { schoolId: sid, count: added.length, subject });
        notify.addMany(added.map(r => ({ schoolId: sid, rosterId: r.studentId, kind: 'result', title: 'نتيجة جديدة', text: 'أُضيفت نتيجتك في مادة ' + subject + (examType ? ' (' + examType + ')' : '') + '.' }))).catch(() => {});
        return send(res, 201, { added: added.length }), true;
      }
      if ((m === 'PATCH' || m === 'DELETE') && sub.startsWith('results/')) {
        const id = sub.slice('results/'.length), rs = readResults(), i = rs.results.findIndex(r => r.id === id && r.schoolId === sid);
        if (i < 0) return fail(res, 404, 'النتيجة غير موجودة.'), true;
        if (m === 'DELETE') { rs.results.splice(i, 1); saveJsonFile(resultsFile, rs); audit(ss.email, 'school.results.delete', { schoolId: sid, id }); return send(res, 200, { deleted: true }), true; }
        const b = await body(req, 3000), r = rs.results[i];
        if (b.score !== undefined) { const sc = money(b.score), mx = b.max !== undefined ? money(b.max) : r.max; if (!Number.isFinite(sc) || sc < 0 || sc > mx) return fail(res, 400, 'الدرجة غير صحيحة.'), true; r.score = sc; r.max = mx; }
        if (b.note !== undefined) r.note = str(b.note, 300);
        if (b.title !== undefined) r.title = str(b.title, 120);
        r.updatedAt = now(); saveJsonFile(resultsFile, rs); return send(res, 200, { result: r }), true;
      }

      // ---------- roster ----------
      if (m === 'GET' && sub === 'roster') {
        migrateRoster(); const members = ctx.readSchoolMembers().members;
        const students = readRoster().students.filter(r => r.schoolId === sid).map(r => ({ id: r.id, name: r.name, grade: r.grade, section: r.section, guardianPhone: r.guardianPhone || '', active: r.active !== false, account: accountView(accountFor(r.id, members)) }));
        return send(res, 200, { students, joinCode: school.joinCode || '', legacyPending: members.filter(x => x.schoolId === sid && x.role === 'student' && x.status === 'pending' && !x.rosterId).length }), true;
      }
      if (m === 'PUT' && sub === 'roster/settings') {
        if (!principal) return fail(res, 403, 'هذا الإعداد لمدير المدرسة فقط.'), true;
        const b = await body(req, 1000), code = str(b.joinCode, 20).replace(/\s+/g, ''); if (code && code.length < 4) return fail(res, 400, 'رمز التسجيل لا يقل عن 4 خانات (أو اتركه فارغًا لإلغائه).'), true;
        const schools = ctx.readSchools(), s2 = schools.schools.find(x => x.id === sid); s2.joinCode = code; s2.updatedAt = now(); saveJsonFile(ctx.schoolsFile, schools);
        return send(res, 200, { joinCode: code }), true;
      }
      const checkGrade = g => !school.grades || !school.grades.length || school.grades.includes(g);
      if (m === 'POST' && sub === 'roster') {
        const b = await body(req, 3000), name = cleanName(b.name), grade = str(b.grade, 80), section = str(b.section, 80);
        if (!name) return fail(res, 400, 'اكتب اسم الطالب الكامل.'), true; if (!checkGrade(grade)) return fail(res, 400, 'اختر صفًا من صفوف المدرسة.'), true;
        const rd = readRoster(); if (rd.students.some(r => r.schoolId === sid && r.grade === grade && sameName(r.name, name))) return fail(res, 409, 'هذا الاسم موجود مسبقًا في الصف نفسه.'), true;
        const rec = { id: 'r-' + crypto.randomBytes(6).toString('hex'), schoolId: sid, name, grade, section, guardianPhone: str(b.guardianPhone, 30).replace(/[^\d+]/g, ''), active: true, createdAt: now() };
        rd.students.push(rec); saveRoster(rd); audit(ss.email, 'school.roster.add', { schoolId: sid }); return send(res, 201, { student: rec }), true;
      }
      if (m === 'POST' && sub === 'roster/bulk') {
        const b = await body(req, 120000), grade = str(b.grade, 80), defSection = str(b.section, 80);
        if (!checkGrade(grade)) return fail(res, 400, 'اختر صفًا من صفوف المدرسة.'), true;
        const lines = (Array.isArray(b.names) ? b.names : String(b.names || '').split(/\r?\n/)).slice(0, 600), rd = readRoster(); let added = 0, skipped = 0;
        for (const line of lines) {
          const parts = String(line).split(/[|،,\t]/).map(x => x.trim()), name = cleanName(parts[0]), section = str(parts[1] || defSection, 80);
          if (!name) continue;
          if (rd.students.some(r => r.schoolId === sid && r.grade === grade && sameName(r.name, name))) { skipped++; continue; }
          rd.students.push({ id: 'r-' + crypto.randomBytes(6).toString('hex'), schoolId: sid, name, grade, section, guardianPhone: '', active: true, createdAt: now() }); added++;
        }
        if (added) saveRoster(rd); audit(ss.email, 'school.roster.bulk', { schoolId: sid, added });
        return send(res, 200, { added, skipped }), true;
      }
      if (sub.startsWith('roster/') && m === 'POST' && sub.endsWith('/unlink')) {
        const id = sub.slice(7, -7), md = ctx.readSchoolMembers(), acc = accountFor(id, md.members);
        if (!acc || acc.schoolId !== sid) return fail(res, 404, 'لا يوجد بريد مربوط بهذا الطالب.'), true;
        acc.status = 'rejected'; acc.active = false; acc.reviewedAt = now(); ctx.saveSchoolMembers(md); ctx.revokeMemberSessions(acc.id);
        audit(ss.email, 'school.roster.unlink', { schoolId: sid, rosterId: id }); return send(res, 200, { unlinked: true }), true;
      }
      if (sub.startsWith('roster/') && (m === 'PATCH' || m === 'DELETE')) {
        const id = sub.slice(7), rd = readRoster(), r = rd.students.find(x => x.id === id && x.schoolId === sid);
        if (!r) return fail(res, 404, 'الطالب غير موجود في القائمة.'), true;
        if (m === 'DELETE') {
          if (accountFor(id)) return fail(res, 409, 'للطالب بريد مربوط. اضغط «إلغاء ربط البريد» أولًا.'), true;
          const pay = readPayments(), rs = readResults();
          if (pay.payments.some(p => p.studentId === id) || rs.results.some(x => x.studentId === id)) return fail(res, 409, 'لهذا الطالب رسوم أو نتائج مسجلة. بدل الحذف عطّله (أرشفة) ليبقى سجله.'), true;
          rd.students = rd.students.filter(x => x.id !== id); saveRoster(rd); return send(res, 200, { deleted: true }), true;
        }
        const b = await body(req, 3000);
        if (b.name !== undefined) { const n = cleanName(b.name); if (!n) return fail(res, 400, 'الاسم مطلوب.'), true; r.name = n; }
        if (b.grade !== undefined) { const g = str(b.grade, 80); if (!checkGrade(g)) return fail(res, 400, 'اختر صفًا من صفوف المدرسة.'), true; r.grade = g; }
        if (b.section !== undefined) r.section = str(b.section, 80);
        if (b.guardianPhone !== undefined) r.guardianPhone = str(b.guardianPhone, 30).replace(/[^\d+]/g, '');
        if (b.active !== undefined) r.active = !!b.active;
        saveRoster(rd);
        const md = ctx.readSchoolMembers(), acc = accountFor(id, md.members); if (acc) { acc.name = r.name; acc.grade = r.grade; acc.section = r.section; ctx.saveSchoolMembers(md); }
        return send(res, 200, { student: r }), true;
      }
      // ---------- reminders and collection report ----------
      if (m === 'POST' && sub === 'fees/remind') {
        const b = await body(req, 20000), cfg = feeConfig(school), pay = readPayments(), ids = Array.isArray(b.studentIds) && b.studentIds.length ? new Set(b.studentIds.map(String)) : null;
        const items = [];
        for (const r of approvedStudents(sid)) {
          if (ids && !ids.has(r.id)) continue; const fin = financeFor(school, r.id, pay); if (fin.remaining <= 0) continue;
          items.push({ schoolId: sid, rosterId: r.id, kind: 'fee-reminder', title: 'تذكير بالرسوم المدرسية', text: str(b.message, 300) || ('المتبقي على الطالب ' + r.name + ' هو ' + fin.remaining + ' ' + cfg.currency + '. نرجو المراجعة أو السداد. شكرًا لكم.') });
        }
        const n = await notify.addMany(items); audit(ss.email, 'school.fees.remind', { schoolId: sid, count: n });
        return send(res, 200, { sent: n }), true;
      }
      if (m === 'GET' && sub === 'fees/report') {
        const cfg = feeConfig(school), pay = readPayments(), list = approvedStudents(sid).map(r => ({ r, fin: financeFor(school, r.id, pay) }));
        const byGrade = {}, byType = {}, byMonth = {};
        for (const { r, fin } of list) {
          const g = byGrade[r.grade || 'بدون صف'] ||= { grade: r.grade || 'بدون صف', students: 0, due: 0, paid: 0, remaining: 0 }; g.students++; g.due += fin.totalDue; g.paid += fin.totalPaid; g.remaining += fin.remaining;
          for (const f of fin.rows) { const t = byType[f.typeId] ||= { name: f.name, due: 0, paid: 0, remaining: 0 }; t.due += f.due; t.paid += f.paid; t.remaining += f.remaining; }
        }
        for (const p of pay.payments) if (p.schoolId === sid && !p.voided) { const k = String(p.at).slice(0, 7); byMonth[k] = money((byMonth[k] || 0) + p.amount); }
        const rnd = o => { for (const k of Object.keys(o)) if (typeof o[k] === 'number') o[k] = money(o[k]); return o; };
        const tot = list.reduce((a, x) => ({ due: a.due + x.fin.totalDue, paid: a.paid + x.fin.totalPaid, remaining: a.remaining + x.fin.remaining }), { due: 0, paid: 0, remaining: 0 });
        return send(res, 200, { currency: cfg.currency, totals: rnd(tot), students: list.length, fullyPaid: list.filter(x => x.fin.remaining <= 0 && x.fin.totalDue > 0).length, byGrade: Object.values(byGrade).map(rnd), byType: Object.values(byType).map(rnd),
          byMonth: Object.entries(byMonth).sort().slice(-12).map(([month, amount]) => ({ month, amount })), topDebtors: list.filter(x => x.fin.remaining > 0).sort((a, b) => b.fin.remaining - a.fin.remaining).slice(0, 10).map(x => ({ id: x.r.id, name: x.r.name, grade: x.r.grade, remaining: x.fin.remaining })) }), true;
      }
    } catch (e) { guard(res, e, 'تعذّر تنفيذ العملية.'); return true; }
    return false;
  }

  async function handleMember(req, res, pathname) {
    if (pathname === '/api/school-member/finance' && req.method === 'GET') {
      const ss = ctx.requireSchoolMember(req, res); if (!ss) return true;
      if (ss.member.role !== 'student') return fail(res, 403, 'هذه الصفحة مخصصة للطلاب.'), true;
      const entry = readRoster().students.find(r => r.id === ss.member.rosterId && r.schoolId === ss.school.id);
      if (!entry) return fail(res, 404, 'لم يُربط حسابك باسم طالب في قائمة المدرسة بعد. راجع الإدارة.'), true;
      return send(res, 200, studentFinanceView(ss.school, entry)), true;
    }
    if (pathname === '/api/school-roster' && req.method === 'GET') { // public: lets a student pick his own name when linking an e-mail
      const rl = rateLimit(req, 'roster-list', 60); if (!rl.allowed) return fail(res, 429, 'طلبات كثيرة. انتظر قليلًا.'), true;
      const q = new URL(req.url, 'http://x').searchParams, school = ctx.readSchools().schools.find(x => x.id === String(q.get('schoolId') || '') && x.active);
      if (!school) return fail(res, 404, 'المدرسة غير موجودة.'), true;
      const all = readRoster().students.filter(r => r.schoolId === school.id && r.active !== false);
      if (school.joinCode && String(q.get('code') || '').trim() !== String(school.joinCode)) return send(res, 200, { joinCodeRequired: true, hasRoster: all.length > 0, students: [] }), true;
      const grade = String(q.get('grade') || ''), members = ctx.readSchoolMembers().members;
      const free = all.filter(r => (!grade || r.grade === grade) && !accountFor(r.id, members)).sort((a, b) => a.name.localeCompare(b.name, 'ar')).map(r => ({ id: r.id, name: r.name, section: r.section }));
      return send(res, 200, { joinCodeRequired: !!school.joinCode, hasRoster: all.length > 0, students: free }), true;
    }
    if (pathname === '/api/school-member/notifications') {
      const ss = ctx.requireSchoolMember(req, res); if (!ss) return true; const ids = ss.member.rosterId ? [ss.member.rosterId] : [];
      if (req.method === 'GET') return send(res, 200, { items: notify.listFor(ids, ss.school.id) }), true;
      if (req.method === 'POST') { notify.markRead(ids, ss.school.id, 'student'); return send(res, 200, { ok: true }), true; }
    }
    if (pathname === '/api/parent/notifications') {
      const session = ctx.sessionParent(req); if (!session) return fail(res, 401, 'سجّل الدخول بحساب ولي الأمر أولًا.'), true;
      const members = ctx.readSchoolMembers().members, roster = readRoster().students, items = [];
      for (const l of ctx.readGuardianLinks().links) {
        if (l.accountId !== session.accountId || l.status !== 'approved') continue;
        const acc = members.find(x => x.id === l.studentId), r = acc && roster.find(x => x.id === acc.rosterId); if (!r) continue;
        if (req.method === 'POST') notify.markRead([r.id], l.schoolId, 'parent');
        else items.push(...notify.listFor([r.id], l.schoolId, 30).map(i => ({ ...i, studentName: r.name })));
      }
      return send(res, 200, req.method === 'POST' ? { ok: true } : { items: items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60) }), true;
    }
    if (pathname === '/api/push/key' && req.method === 'GET') return send(res, 200, { supported: notify.supported(), key: notify.supported() ? notify.publicKey() : '' }), true;
    if (pathname === '/api/push/subscribe' && req.method === 'POST') {
      const rl = rateLimit(req, 'push-sub', 30); if (!rl.allowed) return fail(res, 429, 'محاولات كثيرة.'), true;
      try {
        if (!notify.supported()) return fail(res, 503, 'الإشعارات غير مفعّلة على هذا الخادم.'), true;
        const b = await body(req, 4000), sm = ctx.sessionSchoolMember(req), pr = ctx.sessionParent(req);
        const viewer = sm ? { kind: 'member', schoolId: sm.school.id, rosterId: sm.member.rosterId || '', memberId: sm.member.id } : pr ? { kind: 'parent', accountId: pr.accountId } : null;
        if (!viewer) return fail(res, 401, 'سجّل الدخول أولًا لتفعيل الإشعارات.'), true;
        notify.subscribe(viewer, b.subscription); return send(res, 200, { subscribed: true }), true;
      } catch (e) { guard(res, e, 'تعذّر تفعيل الإشعارات.'); return true; }
    }
    if (pathname === '/api/push/unsubscribe' && req.method === 'POST') { try { const b = await body(req, 2000); notify.unsubscribe(b.endpoint); return send(res, 200, { ok: true }), true; } catch (e) { guard(res, e, 'تعذّر الإلغاء.'); return true; } }
    if (pathname === '/api/parent/finance' && req.method === 'GET') {
      const session = ctx.sessionParent(req); if (!session) return fail(res, 401, 'سجّل الدخول بحساب ولي الأمر أولًا.'), true;
      const schools = ctx.readSchools().schools, members = ctx.readSchoolMembers().members;
      const out = [];
      for (const l of ctx.readGuardianLinks().links) {
        if (l.accountId !== session.accountId || l.status !== 'approved') continue;
        const school = schools.find(x => x.id === l.schoolId), acc = members.find(x => x.id === l.studentId && x.schoolId === l.schoolId && x.role === 'student' && x.active && x.status === 'approved');
        const st = acc && readRoster().students.find(r => r.id === acc.rosterId && r.schoolId === l.schoolId);
        if (school && st) out.push({ linkId: l.id, studentName: st.name, ...studentFinanceView(school, st) });
      }
      return send(res, 200, { students: out }), true;
    }
    return false;
  }

  // =====================================================================
  // 4) About page, rating and feedback
  // =====================================================================
  const REASONS = { great: 'التطبيق جميل جدًا', improve: 'يحتاج إلى تحسين', bug: 'وجدت مشكلة أو خطأ', suggestion: 'اقتراح ميزة جديدة', other: 'أخرى' };
  const ABOUT_DEFAULT = {
    intro: 'تطبيق تعليمي مجاني يرافق الطالب في دراسة كتبه المدرسية بالشرح والاختبار واللعب، ويربط الطالب والمعلم والمدرسة وولي الأمر في مكان واحد.',
    features: [
      { icon: '📖', title: 'شرح مبسّط بالصوت', text: 'يشرح لك الدروس من كتابك المدرسي بأسلوب معلّم ودود، مع قراءة صوتية وتمييز للكلمات أثناء القراءة.' },
      { icon: '📚', title: 'الكتب كاملة', text: 'تصفّح الكتاب من أول صفحة إلى آخرها بصوره ورسوماته، وتنقّل بين الوحدات والدروس من الفهرس.' },
      { icon: '📝', title: 'اختبارات وتصحيح فوري', text: 'أسئلة من كتاب واحد أو من كل الكتب معًا، مع تشجيع وتوضيح للإجابة الصحيحة.' },
      { icon: '🎮', title: 'ألعاب تعليمية', text: 'حروف وأرقام وألوان وجمع وطرح بالصور والصوت للصغار.' },
      { icon: '🏫', title: 'مدرستي', text: 'منشورات المعلمين والواجبات وتسليم الحلول، ومتابعة الدرجات والنتائج.' },
      { icon: '👨‍👩‍👧', title: 'متابعة ولي الأمر', text: 'يتابع ولي الأمر أبناءه والواجبات والرسوم والنتائج أولًا بأول.' },
      { icon: '🔄', title: 'تحديث فوري وبدون إنترنت', text: 'ما تضيفه الإدارة يظهر مباشرة للجميع، وما تسجّله دون اتصال يُرسل تلقائيًا عند عودة الإنترنت.' },
      { icon: '🆓', title: 'مجاني للجميع', text: 'هدية تعليمية لكل طالب وطالبة دون استثناء.' }
    ],
    email: '', whatsapp: '+967711000121', showEmail: true, showWhatsapp: true, feedbackEnabled: true,
    feedbackNote: 'برأيك نستطيع تطوير التطبيق أكثر. شاركنا تقييمك وملاحظاتك.', version: ''
  };
  function readAbout() { const d = readJsonFile(aboutFile, null); return { ...ABOUT_DEFAULT, ...(d && typeof d === 'object' ? d : {}) }; }
  function publicAbout() { const a = readAbout(); return { intro: a.intro, features: a.features, email: a.showEmail ? a.email : '', whatsapp: a.showWhatsapp ? a.whatsapp : '', feedbackEnabled: a.feedbackEnabled, feedbackNote: a.feedbackNote, version: a.version || ctx.version, reasons: REASONS }; }
  const readFeedback = () => { const d = readJsonFile(feedbackFile, {}); return Array.isArray(d.items) ? d.items : []; };

  async function handleAbout(req, res, pathname) {
    if (req.method === 'GET' && pathname === '/api/platform/about') return send(res, 200, publicAbout()), true;
    if (pathname === '/api/admin/platform/about') {
      const a = ctx.sessionAdmin(req); if (!a) return fail(res, 401, 'سجّل الدخول أولًا.'), true;
      if (a.role !== 'superadmin') return fail(res, 403, 'تعديل صفحة «حول التطبيق» متاح لمالك المنصة فقط.'), true;
      if (req.method === 'GET') return send(res, 200, readAbout()), true;
      if (req.method === 'PUT') {
        try {
          const b = await body(req, 30000), old = readAbout();
          const email = str(b.email, 254), wa = str(b.whatsapp, 30).replace(/[^\d+]/g, '');
          if (email && !EMAIL_RE.test(email)) return fail(res, 400, 'البريد الإلكتروني غير صحيح.'), true;
          const next = {
            intro: str(b.intro, 2000), email, whatsapp: wa, showEmail: !!b.showEmail, showWhatsapp: !!b.showWhatsapp, feedbackEnabled: b.feedbackEnabled !== false,
            feedbackNote: str(b.feedbackNote, 400) || old.feedbackNote, version: str(b.version, 30),
            features: (Array.isArray(b.features) ? b.features : old.features).slice(0, 20).map(f => ({ icon: str(f.icon, 8) || '✨', title: str(f.title, 80), text: str(f.text, 500) })).filter(f => f.title)
          };
          saveJsonFile(aboutFile, next); audit(a.email, 'platform.about.update', {});
          return send(res, 200, next), true;
        } catch (e) { guard(res, e, 'تعذّر الحفظ.'); return true; }
      }
    }
    if (req.method === 'POST' && pathname === '/api/feedback') {
      const rl = rateLimit(req, 'feedback', 6); if (!rl.allowed) { res.setHeader('Retry-After', String(rl.retryAfter)); return fail(res, 429, 'أرسلت ملاحظات كثيرة. حاول لاحقًا.'), true; }
      try {
        if (!readAbout().feedbackEnabled) return fail(res, 403, 'استقبال الملاحظات متوقف حاليًا.'), true;
        const b = await body(req, 4000), rating = Math.round(Number(b.rating));
        const reason = REASONS[b.reason] ? b.reason : 'other', text = str(b.text, 1000);
        if (!(rating >= 1 && rating <= 5) && !text) return fail(res, 400, 'اختر عدد النجوم أو اكتب رأيك.'), true;
        const items = readFeedback();
        items.unshift({ id: crypto.randomUUID(), rating: rating >= 1 && rating <= 5 ? rating : 0, reason, text, app: str(b.app, 40), at: now() });
        saveJsonFile(feedbackFile, { items: items.slice(0, 3000) });
        return send(res, 201, { thanks: true }), true;
      } catch (e) { guard(res, e, 'تعذّر إرسال الملاحظة.'); return true; }
    }
    if (pathname === '/api/admin/feedback') {
      const a = ctx.sessionAdmin(req); if (!a) return fail(res, 401, 'سجّل الدخول أولًا.'), true;
      if (req.method === 'GET') {
        const items = readFeedback(), rated = items.filter(x => x.rating > 0);
        const dist = [1, 2, 3, 4, 5].map(n => rated.filter(x => x.rating === n).length);
        return send(res, 200, { items: items.slice(0, 300), stats: { count: items.length, rated: rated.length, average: rated.length ? Math.round(rated.reduce((s, x) => s + x.rating, 0) / rated.length * 10) / 10 : null, distribution: dist }, reasons: REASONS }), true;
      }
      if (req.method === 'DELETE') {
        if (a.role !== 'superadmin') return fail(res, 403, 'الحذف لمالك المنصة فقط.'), true;
        const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
        saveJsonFile(feedbackFile, { items: readFeedback().filter(x => x.id !== id) }); return send(res, 200, { deleted: true }), true;
      }
    }
    return false;
  }

  // =====================================================================
  // 5) Book reader: real page images + table of contents with page numbers
  // =====================================================================
  const infoCache = new Map(); const renders = new Map(); let busy = 0;
  const cleanId = s => String(s || '').replace(/[^a-zA-Z0-9_-]/g, '');
  function findBook(id) { return ctx.readDataCached().books.find(b => b.id === cleanId(id) && b.pdfUploaded === true && b.fileName); }
  const pdfPath = book => path.join(ctx.uploadDir, path.basename(book.fileName));
  const normKey = s => learn.normalizeArabic(s).replace(/\s+/g, ' ').replace(/[\s.·…_\-–—\d]+$/u, '').trim();

  async function pageCount(book) {
    try { const { stdout } = await ctx.execFileAsync('pdfinfo', [pdfPath(book)], { timeout: 15000, maxBuffer: 1e6 }); const m = /Pages:\s+(\d+)/.exec(stdout); if (m) return Number(m[1]); } catch { /* fall through */ }
    return Number(book.pages) || 0;
  }
  async function pageTexts(book) {
    const stored = ctx.bookjobs && ctx.bookjobs.pagesTexts(book.id); // already extracted (text layer + OCR) by the background job
    if (stored) { const MARK = '\n@@PG@@\n'; return learn.fixVisualOrderArabic(stored.join(MARK)).text.split(/\n?@@PG@@\n?/); }
    try {
      const { stdout } = await ctx.execFileAsync('pdftotext', ['-enc', 'UTF-8', '-q', pdfPath(book), '-'], { timeout: 90000, maxBuffer: 64 * 1024 * 1024 });
      const pages = stdout.split('\f'); if (pages.length && !pages[pages.length - 1].trim()) pages.pop();
      const MARK = '\n@@PG@@\n';
      const fixed = learn.fixVisualOrderArabic(pages.join(MARK)).text; // many Arabic PDFs extract reversed
      return fixed.split(/\n?@@PG@@\n?/);
    } catch { return []; }
  }
  async function buildInfo(book) {
    const total = await pageCount(book), texts = await pageTexts(book);
    try { const d = path.join(pageCacheDir, cleanId(book.id)); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'texts.json'), JSON.stringify(texts)); } catch { /* optional */ }
    const prep = ctx.preparedBook(book), o = prep.outline, flat = [];
    if (o.intro) flat.push({ id: 'intro', title: o.intro.title, kind: 'intro', level: 0, start: o.intro.start });
    for (const u of o.units) { flat.push({ id: u.id, title: u.title, kind: 'unit', level: 0, start: u.start }); for (const l of u.lessons) flat.push({ id: l.id, title: l.title, kind: 'lesson', level: 1, start: l.start }); }
    for (const l of o.lessons) if (!l.unitId) flat.push({ id: l.id, title: l.title, kind: 'lesson', level: 0, start: l.start });
    for (const p of o.parts) flat.push({ id: p.id, title: p.title, kind: 'part', level: 0, start: p.start });
    flat.sort((a, b) => a.start - b.start);
    const norm = texts.map(t => learn.normalizeArabic(t).replace(/\s+/g, ' '));
    const heads = flat.filter(x => x.kind === 'unit' || x.kind === 'lesson');
    const keyOf = new Map(heads.map(h => [h.id, normKey(h.title)]));
    const tocPages = new Set();
    if (heads.length >= 4 && norm.length) {
      const need = Math.max(4, Math.ceil(heads.length * 0.5));
      for (let i = 0; i < Math.min(norm.length, 25); i++) { let c = 0; for (const h of heads) { const k = keyOf.get(h.id); if (k && norm[i].includes(k)) c++; } if (c >= need) tocPages.add(i); }
    }
    let cursor = tocPages.size ? Math.max(...tocPages) + 1 : 0, last = 1;
    const textLen = Math.max(1, prep.text.length);
    const toc = o.intro ? [] : [{ id: 'cover', title: 'الغلاف والصفحات الأولى', level: 0, page: 1, kind: 'cover' }];
    for (const f of flat) {
      let page = null, approx = false;
      if (f.kind === 'intro') page = 1;
      else if (f.kind === 'part') page = Math.min(total || 1, Math.max(1, Math.round(f.start / textLen * (total || 1)) + 1));
      else {
        const k = keyOf.get(f.id);
        if (k && norm.length) for (let i = cursor; i < norm.length; i++) if (!tocPages.has(i) && norm[i].includes(k)) { page = i + 1; cursor = i; break; }
        if (page == null) { page = last; approx = true; }
      }
      last = page || last; toc.push({ id: f.id, title: f.title, level: f.level, page, kind: f.kind, approx });
    }
    toc.forEach((t, i) => { const nx = toc.slice(i + 1).find(x => x.page > t.page); t.end = nx ? nx.page - 1 : total || t.page; });
    return { pages: total, hasText: texts.some(t => t.trim().length > 20), toc };
  }
  async function bookInfo(book) {
    const key = book.id + ':' + (book.pages || 0) + ':' + String(book.extractedText ? book.extractedText.length : 0);
    let v = infoCache.get(key); if (v) return v;
    const file = path.join(pageCacheDir, cleanId(book.id), 'info.json');
    try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); if (d && d.key === key) { infoCache.set(key, d.info); return d.info; } } catch { /* rebuild */ }
    v = await buildInfo(book); infoCache.set(key, v); if (infoCache.size > 30) infoCache.delete(infoCache.keys().next().value);
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify({ key, info: v })); } catch { /* cache only */ }
    return v;
  }
  async function renderPage(book, n, w) {
    const dir = path.join(pageCacheDir, cleanId(book.id)); fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, n + '-' + w + '.jpg'); if (fs.existsSync(out)) return out;
    const k = out; if (renders.has(k)) return renders.get(k);
    const job = (async () => {
      while (busy >= 3) await new Promise(r => setTimeout(r, 120));
      busy++;
      try {
        await ctx.execFileAsync('pdftoppm', ['-f', String(n), '-l', String(n), '-jpeg', '-jpegopt', 'quality=82', '-scale-to-x', String(w), '-scale-to-y', '-1', '-singlefile', pdfPath(book), path.join(dir, n + '-' + w)], { timeout: 45000, maxBuffer: 1e6 });
      } finally { busy--; }
      if (!fs.existsSync(out)) throw new Error('render-failed');
      return out;
    })();
    renders.set(k, job); try { return await job; } finally { renders.delete(k); }
  }
  async function handleReader(req, res, pathname) {
    if (req.method !== 'GET') return false;
    if (!['/api/learn/book-info', '/api/learn/page', '/api/learn/page-text'].includes(pathname)) return false;
    const rl = rateLimit(req, 'reader:' + pathname, pathname.endsWith('page') ? 6000 : 400);
    if (!rl.allowed) { res.setHeader('Retry-After', String(rl.retryAfter)); return fail(res, 429, 'طلبات كثيرة. انتظر قليلًا.'), true; }
    const q = new URL(req.url, 'http://x').searchParams, book = findBook(q.get('bookId'));
    if (!book) return fail(res, 404, 'الكتاب غير موجود.'), true;
    if (!fs.existsSync(pdfPath(book))) return fail(res, 404, 'ملف الكتاب غير موجود على التخزين. على مدير المنصة تفعيل التخزين الدائم.'), true;
    try {
      if (pathname === '/api/learn/page-text') {
        const n = Math.floor(Number(q.get('n'))), total = (await bookInfo(book)).pages || 0;
        if (!(n >= 1) || (total && n > total)) return fail(res, 404, 'رقم الصفحة غير موجود.'), true;
        const tf = path.join(pageCacheDir, cleanId(book.id), 'texts.json'); let texts = null;
        try { texts = JSON.parse(fs.readFileSync(tf, 'utf8')); } catch { texts = await pageTexts(book); try { fs.writeFileSync(tf, JSON.stringify(texts)); } catch { /* optional */ } }
        const text = String(texts[n - 1] || '').replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim().slice(0, 6000);
        return send(res, 200, { page: n, text }), true;
      }
      if (pathname === '/api/learn/book-info') { const info = await bookInfo(book); return send(res, 200, { title: book.title, subject: book.subject || '', grade: book.grade || '', ...info }), true; }
      const n = Math.floor(Number(q.get('n'))), w = [600, 900, 1200].includes(Number(q.get('w'))) ? Number(q.get('w')) : 900;
      const total = (await bookInfo(book)).pages || 0;
      if (!(n >= 1) || (total && n > total)) return fail(res, 404, 'رقم الصفحة غير موجود.'), true;
      const file = await renderPage(book, n, w);
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': fs.statSync(file).size, 'Cache-Control': 'public, max-age=604800, immutable', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' });
      fs.createReadStream(file).pipe(res); return true;
    } catch (e) {
      const missing = e && e.code === 'ENOENT';
      fail(res, missing ? 503 : 500, missing ? 'أدوات عرض صفحات الكتاب (poppler) غير مثبتة على الخادم.' : 'تعذّر عرض هذه الصفحة الآن.'); return true;
    }
  }

  // =====================================================================
  // entry points used by server.js
  // =====================================================================
  function attach(req, res, pathname) {
    if (idemGuard(req, res, pathname)) return true;
    const targets = mutationTargets(req, pathname);
    if (targets) res.on('finish', () => {
      if (res.statusCode >= 400) return;
      for (const [scope, kind] of targets) emit(scope, kind);
      if (req.method === 'POST' && /^\/api\/school-(admin|member)\/(posts|teacher-posts)$/.test(pathname) && targets[0][0] !== 'platform') notify.broadcast(targets[0][0], 'منشور جديد من المدرسة', 'نُشر منشور جديد. افتح التطبيق للاطلاع عليه.');
    });
    return false;
  }
  // ---------- school logo (uploaded image instead of a link) ----------
  const logoDir = path.join(dataDir, 'school-logos'); fs.mkdirSync(logoDir, { recursive: true });
  const LOGO_MAX = 600 * 1024, LOGO_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };
  const sniffImage = b => b.length > 12 && ((b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') ? 'png' : (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ? 'jpg' : (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') ? 'webp' : null);
  function rawBody(req, max) { return new Promise((resolve, reject) => { const ch = []; let n = 0; req.on('data', d => { n += d.length; if (n > max) { req.pause(); reject(Object.assign(new Error('حجم الصورة يتجاوز ' + Math.round(max / 1024) + ' كيلوبايت. صغّرها أو اختر صورة أخف.'), { status: 413 })); return; } ch.push(d); }); req.on('end', () => resolve(Buffer.concat(ch))); req.on('error', reject); }); }
  const logoFiles = id => Object.keys(LOGO_TYPES).map(e => path.join(logoDir, cleanId(id) + '.' + e));
  function setSchoolLogo(schoolId, url) { const schools = ctx.readSchools(), sc = schools.schools.find(x => x.id === schoolId); if (!sc) return false; sc.logoUrl = url; sc.updatedAt = now(); saveJsonFile(ctx.schoolsFile, schools); return true; }
  async function saveLogo(req, res, schoolId, who) {
    const buf = await rawBody(req, LOGO_MAX), ext = sniffImage(buf);
    if (!ext) return fail(res, 400, 'الملف ليس صورة PNG أو JPG أو WebP صالحة. (صور SVG غير مسموحة لأسباب أمنية.)'), true;
    for (const f of logoFiles(schoolId)) { try { fs.unlinkSync(f); } catch { /* none */ } }
    fs.writeFileSync(path.join(logoDir, cleanId(schoolId) + '.' + ext), buf, { mode: 0o600 });
    const url = '/api/public/school-logo/' + cleanId(schoolId) + '?v=' + Date.now(); if (!setSchoolLogo(schoolId, url)) return fail(res, 404, 'المدرسة غير موجودة.'), true;
    audit(who, 'school.logo.set', { schoolId }); return send(res, 200, { logoUrl: url }), true;
  }
  function dropLogo(res, schoolId, who) { for (const f of logoFiles(schoolId)) { try { fs.unlinkSync(f); } catch { /* none */ } } setSchoolLogo(schoolId, ''); audit(who, 'school.logo.remove', { schoolId }); return send(res, 200, { logoUrl: '' }), true; }
  async function handleLogo(req, res, pathname) {
    let m = /^\/api\/public\/school-logo\/([A-Za-z0-9_-]+)$/.exec(pathname);
    if (m && req.method === 'GET') {
      const f = logoFiles(m[1]).find(x => fs.existsSync(x)); if (!f) return fail(res, 404, 'لا يوجد شعار.'), true;
      res.writeHead(200, { 'Content-Type': LOGO_TYPES[path.extname(f).slice(1)], 'Content-Length': fs.statSync(f).size, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'cross-origin' });
      fs.createReadStream(f).pipe(res); return true;
    }
    try {
      m = /^\/api\/admin\/schools\/([A-Za-z0-9_-]+)\/logo$/.exec(pathname);
      if (m && (req.method === 'POST' || req.method === 'DELETE')) {
        const a = ctx.sessionAdmin(req); if (!a) return fail(res, 401, 'سجّل الدخول أولًا.'), true;
        if (!ctx.readSchools().schools.some(x => x.id === m[1])) { req.resume(); return fail(res, 404, 'المدرسة غير موجودة.'), true; }
        return req.method === 'POST' ? await saveLogo(req, res, m[1], a.email) : dropLogo(res, m[1], a.email);
      }
      if (pathname === '/api/school-admin/logo' && (req.method === 'POST' || req.method === 'DELETE')) {
        const ss = ctx.requireSchoolAdmin(req, res); if (!ss) return true;
        if (ss.account.schoolRole === 'deputy') { req.resume(); return fail(res, 403, 'تغيير الشعار لمدير المدرسة فقط.'), true; }
        return req.method === 'POST' ? await saveLogo(req, res, ss.schoolId, ss.email) : dropLogo(res, ss.schoolId, ss.email);
      }
    } catch (e) { guard(res, e, 'تعذّر حفظ الشعار.'); return true; }
    return false;
  }
  async function suggestForBook(bookId) {
    const book = ctx.readDataCached().books.find(b => b.id === bookId); if (!book || !book.pdfUploaded) return null;
    const texts = await pageTexts(book); if (!texts.length) return { created: 0, skipped: 0, items: [], reason: 'no-text' };
    const r = interactives.detect(book, texts);
    if (r.created && ctx.bookjobs && ctx.bookjobs.notice) ctx.bookjobs.notice('interactives-suggested', bookId, book.title, 'اقترح النظام ' + r.created + ' تجربة تفاعلية من نص «' + book.title + '» وهي بانتظار مراجعتك واعتمادك.');
    return r;
  }
  async function handleInteractives(req, res, pathname) {
    const books = () => new Map((ctx.readDataCached().books || []).map(b => [b.id, b]));
    if (req.method === 'GET' && pathname === '/api/learn/interactives') { // students: approved experiments only
      const rl = rateLimit(req, 'interactives', 600); if (!rl.allowed) return fail(res, 429, 'طلبات كثيرة.'), true;
      const q = new URL(req.url, 'http://x').searchParams, bookId = cleanId(q.get('bookId')), bm = books();
      if (!bm.has(bookId)) return fail(res, 404, 'الكتاب غير موجود.'), true;
      return send(res, 200, { items: interactives.approvedFor(bookId, q.get('page')).map(i => interactives.publicView(i, bm)) }), true;
    }
    if (!pathname.startsWith('/api/admin/interactives') && !/^\/api\/admin\/books\/[A-Za-z0-9_-]+\/suggest-interactives$/.test(pathname)) return false;
    const a = ctx.sessionAdmin(req); if (!a) return fail(res, 401, 'سجّل الدخول أولًا.'), true;
    try {
      const sm = /^\/api\/admin\/books\/([A-Za-z0-9_-]+)\/suggest-interactives$/.exec(pathname);
      if (sm && req.method === 'POST') { const r = await suggestForBook(sm[1]); if (!r) return fail(res, 404, 'الكتاب غير موجود أو بلا ملف PDF.'), true; audit(a.email, 'interactives.suggest', { bookId: sm[1], created: r.created }); return send(res, 200, { created: r.created, skipped: r.skipped, reason: r.reason || '' }), true; }
      if (req.method === 'GET' && pathname === '/api/admin/interactives') { const q = new URL(req.url, 'http://x').searchParams, bm = books(); return send(res, 200, { items: interactives.list({ bookId: q.get('bookId') || '', status: q.get('status') || '' }).map(i => ({ ...i, bookTitle: (bm.get(i.bookId) || {}).title || '' })) }), true; }
      if (req.method === 'POST' && pathname === '/api/admin/interactives') {
        const b = await body(req, 8000), book = books().get(String(b.bookId || '')), it = interactives.create({ bookId: String(b.bookId || ''), template: String(b.template || ''), title: b.title, params: b.params, pages: b.pages, note: b.note }, book);
        audit(a.email, 'interactives.create', { id: it.id }); return send(res, 201, { item: it }), true;
      }
      const m = /^\/api\/admin\/interactives\/([0-9a-f-]{36})(\/status)?$/.exec(pathname);
      if (m) {
        const id = m[1], cur = interactives.get(id); if (!cur) return fail(res, 404, 'التجربة غير موجودة.'), true;
        if (m[2] && req.method === 'POST') { const b = await body(req, 1000), it = interactives.setStatus(id, String(b.status || ''), a.email); audit(a.email, 'interactives.' + it.status, { id }); return send(res, 200, { item: it }), true; }
        if (req.method === 'PATCH') { const b = await body(req, 8000); return send(res, 200, { item: interactives.update(id, b, books().get(cur.bookId)) }), true; }
        if (req.method === 'DELETE') { interactives.remove(id); audit(a.email, 'interactives.delete', { id }); return send(res, 200, { deleted: true }), true; }
      }
    } catch (e) { guard(res, e, 'تعذّرت العملية.'); return true; }
    return false;
  }
  async function handleBookJobs(req, res, pathname) {
    if (!pathname.startsWith('/api/admin/books/') && !pathname.startsWith('/api/admin/notices')) return false;
    const a = ctx.sessionAdmin(req); if (!a) return fail(res, 401, 'سجّل الدخول أولًا.'), true;
    const bj = ctx.bookjobs;
    try {
      if (pathname === '/api/admin/notices') {
        if (req.method === 'GET') { const items = bj.notices(); return send(res, 200, { items: items.slice(0, 50), unread: items.filter(i => !i.read).length }), true; }
        if (req.method === 'POST') { bj.markNoticesRead(); return send(res, 200, { ok: true }), true; }
      }
      if (req.method === 'GET' && pathname === '/api/admin/books/jobs') {
        const books = new Map((ctx.readDataCached().books || []).map(b => [b.id, b]));
        const rows = bj.list().map(j => { const b = books.get(j.bookId) || {}; return { ...j, subject: b.subject || '', grade: b.grade || '', title: b.title || j.title }; });
        return send(res, 200, { jobs: rows, stats: bj.stats(), ocrLangs: process.env.OCR_LANGS || 'ara+eng', maxPages: bj.maxPages }), true;
      }
      const m = /^\/api\/admin\/books\/(?:jobs\/)?([A-Za-z0-9_-]+)\/(reprocess|cancel|resume|analyze)$/.exec(pathname);
      if (m && req.method === 'POST') {
        const [, id, op] = m, book = ctx.readDataCached().books.find(b => b.id === id);
        if (!book) return fail(res, 404, 'الكتاب غير موجود.'), true;
        if (op === 'analyze') { // legacy books: build the per-page store (also lifts the old 100-page OCR cap)
          if (!(await bj.available())) return fail(res, 503, 'التحليل يحتاج أدوات Poppler على الخادم.'), true;
          if (!book.fileName) return fail(res, 400, 'لا يوجد ملف PDF لهذا الكتاب.'), true;
          const cur = bj.get(id); if (cur && (cur.status === 'running' || cur.status === 'queued')) return fail(res, 409, 'المعالجة جارية بالفعل.'), true;
          audit(a.email, 'book.analyze', { bookId: id }); return send(res, 202, { job: bj.start(book) }), true;
        }
        const b = await body(req, 2000);
        if (op === 'reprocess') {
          if (b.mode === 'all' && a.role !== 'superadmin') return fail(res, 403, 'إعادة معالجة الكتاب كله لمالك المنصة فقط.'), true;
          audit(a.email, 'book.reprocess', { bookId: id, mode: b.mode, from: b.from, to: b.to }); return send(res, 202, { job: bj.reprocess(id, b) }), true;
        }
        if (op === 'cancel') return send(res, 200, { job: bj.cancel(id) }), true;
        if (op === 'resume') return send(res, 202, { job: bj.resume(id) }), true;
      }
    } catch (e) { guard(res, e, 'تعذّرت العملية.'); return true; }
    return false;
  }
  async function handleBackups(req, res, pathname) {
    if (!pathname.startsWith('/api/admin/backups')) return false;
    const a = ctx.sessionAdmin(req); if (!a) return fail(res, 401, 'سجّل الدخول أولًا.'), true;
    if (a.role !== 'superadmin') return fail(res, 403, 'النسخ الاحتياطي لمالك المنصة فقط.'), true;
    try {
      if (req.method === 'GET' && pathname === '/api/admin/backups') return send(res, 200, { backups: backup.list() }), true;
      if (req.method === 'POST' && pathname === '/api/admin/backups') { const r = backup.run(); audit(a.email, 'platform.backup.run', r); return send(res, 201, r), true; }
      if (req.method === 'GET' && pathname === '/api/admin/backups/download') { audit(a.email, 'platform.backup.download', {}); backup.download(res, new URL(req.url, 'http://x').searchParams.get('pdfs') === '1'); return true; }
    } catch (e) { guard(res, e, 'تعذّرت العملية.'); return true; }
    return false;
  }
  async function handle(req, res, pathname) {
    if (req.method === 'GET' && pathname === '/api/events') return handleEvents(req, res), true;
    if (await handleBackups(req, res, pathname)) return true;
    if (await handleBookJobs(req, res, pathname)) return true;
    if (await handleInteractives(req, res, pathname)) return true;
    if (await handleLogo(req, res, pathname)) return true;
    if (await handleReader(req, res, pathname)) return true;
    if (await handleAbout(req, res, pathname)) return true;
    if (await handleMember(req, res, pathname)) return true;
    if (await handleSchoolAdmin(req, res, pathname)) return true;
    return false;
  }
  return { attach, handle, emit, studentFinanceView, feeConfig, prepareStudentRegistration, onMemberReviewed, syncRosterFromMember, suggestForBook, removeInteractives: id => interactives.removeForBook(id), invalidateInteractives: id => interactives.invalidateForBook(id), interactives };
};

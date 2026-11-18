'use strict';
// Background analysis of uploaded books (phase 1 of the interactive-book work).
//
//  * One job per book. A job walks the PDF page by page: text layer first, OCR for pages that have
//    no text (so mixed books and scanned books are both handled, with no 100-page cap).
//  * Every page result is written to disk the moment it is ready (DATA_DIR/book-pages/<book>/p-N.json),
//    so nothing is lost when the connection drops or the server restarts, and a page that is already
//    done is never produced twice.
//  * The job list lives in DATA_DIR/book-jobs.json. On start-up, jobs that were running are resumed.
//  * Failed pages are retried (3 tries); what still fails is listed, and can be re-run on its own,
//    as can any page range, without touching the rest of the book.
//  * When the pages are done the book's text and outline are assembled from the page files, and the
//    admin gets a notice (finished / partly failed / failed).
//  * The original PDF is never modified.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

module.exports = function createBookJobs(ctx) {
  const { dataDir, uploadDir, execFileAsync, readJsonFile, saveJsonFile } = ctx;
  const pagesRoot = path.join(dataDir, 'book-pages');
  const jobsFile = path.join(dataDir, 'book-jobs.json');
  const noticesFile = path.join(dataDir, 'admin-notices.json');
  const statsFile = path.join(dataDir, 'book-jobs-stats.json');
  fs.mkdirSync(pagesRoot, { recursive: true });
  const now = () => new Date().toISOString();
  const OCR_LANGS = process.env.OCR_LANGS || 'ara+eng';
  const MAX_PAGES = Math.max(1, Number(process.env.BOOK_MAX_PAGES) || 2500);
  const OCR_DPI = Math.max(72, Math.min(300, Number(process.env.OCR_DPI) || 150));
  const CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.BOOK_JOBS_CONCURRENCY) || 1));
  const TEST_FAIL = process.env.NODE_ENV === 'test' ? String(process.env.BOOKJOBS_FAIL_PAGES || '') : ''; // "5:2,7:99" = page 5 fails twice, page 7 always (tests only)
  const failPlan = new Map(TEST_FAIL.split(',').filter(Boolean).map(x => x.split(':').map(Number)).map(([p, n]) => [p, n]));
  const failSeen = new Map();
  const TEST_DELAY = process.env.NODE_ENV === 'test' ? Math.max(0, Number(process.env.BOOKJOBS_PAGE_DELAY_MS) || 0) : 0; // slows pages so tests can interrupt a running job

  // ---------- job store ----------
  let jobs = (() => { const d = readJsonFile(jobsFile, {}), j = d && typeof d.jobs === 'object' && d.jobs ? d.jobs : {}; for (const x of Object.values(j)) { delete x._running; delete x._cancel; } return j; })();
  let lastSave = 0, saveTimer = null;
  function persist(force) {
    const t = Date.now();
    if (!force && t - lastSave < 800) { if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = null; persist(true); }, 900); return; }
    lastSave = t; try { saveJsonFile(jobsFile, { jobs: Object.fromEntries(Object.entries(jobs).map(([k, j]) => { const { _running, _cancel, ...rest } = j; return [k, rest]; })) }); } catch (e) { console.error('book-jobs save failed:', e.message); }
  }
  const pageDir = id => path.join(pagesRoot, String(id).replace(/[^a-zA-Z0-9_-]/g, ''));
  const pageFile = (id, n) => path.join(pageDir(id), 'p-' + n + '.json');
  function readPage(id, n) { try { return JSON.parse(fs.readFileSync(pageFile(id, n), 'utf8')); } catch { return null; } }
  function writePage(id, n, rec) { fs.mkdirSync(pageDir(id), { recursive: true }); const f = pageFile(id, n), tmp = f + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(rec)); fs.renameSync(tmp, f); }
  const pdfPathOf = book => path.join(uploadDir, path.basename(book.fileName));

  // ---------- stats (consumption monitor) ----------
  function bump(kind, ms) {
    const d = readJsonFile(statsFile, {}), day = new Date().toISOString().slice(0, 10), row = d[day] ||= { pages: 0, ocr: 0, failed: 0, ms: 0 };
    row[kind] = (row[kind] || 0) + 1; if (ms) row.ms += ms;
    const keys = Object.keys(d).sort(); for (const k of keys.slice(0, Math.max(0, keys.length - 45))) delete d[k];
    saveJsonFile(statsFile, d);
  }
  const stats = () => readJsonFile(statsFile, {});

  // ---------- admin notices ----------
  function notice(kind, bookId, title, text) {
    const d = readJsonFile(noticesFile, {}), items = Array.isArray(d.items) ? d.items : [];
    items.unshift({ id: crypto.randomUUID(), kind, bookId, title, text, at: now(), read: false });
    saveJsonFile(noticesFile, { items: items.slice(0, 300) });
    if (ctx.emit) ctx.emit('platform', 'jobs');
  }
  const notices = () => { const d = readJsonFile(noticesFile, {}); return Array.isArray(d.items) ? d.items : []; };
  function markNoticesRead() { const items = notices(); items.forEach(i => { i.read = true; }); saveJsonFile(noticesFile, { items }); }

  // ---------- tools ----------
  let toolsOk = null;
  async function available() {
    if (toolsOk !== null) return toolsOk;
    try { await execFileAsync('pdfinfo', ['-v'], { timeout: 8000 }); toolsOk = true; } catch (e) { toolsOk = e && e.code !== 'ENOENT' ? true : false; }
    return toolsOk;
  }
  let ocrOk = null;
  async function ocrAvailable() {
    if (ocrOk !== null) return ocrOk;
    try {
      const { stdout, stderr } = await execFileAsync('tesseract', ['--list-langs'], { timeout: 8000 });
      const have = new Set(String(stdout + stderr).split(/\s+/)); ocrOk = OCR_LANGS.split('+').every(l => have.has(l));
    } catch { ocrOk = false; }
    return ocrOk;
  }
  async function pageCount(file) {
    const { stdout } = await execFileAsync('pdfinfo', [file], { timeout: 20000, maxBuffer: 1e6 });
    const m = /Pages:\s+(\d+)/.exec(stdout); if (!m) throw new Error('تعذّر قراءة عدد الصفحات.'); return Number(m[1]);
  }
  const sha256File = file => new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej); });
  const clean = t => String(t || '').replace(/\u0000/g, ' ').replace(/\r/g, '\n').replace(/[\t\f\v]+/g, ' ').replace(/[ \u00a0]{2,}/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  async function extractPage(pdf, n, canOcr) {
    const t0 = Date.now(); let text = '';
    const { stdout } = await execFileAsync('pdftotext', ['-f', String(n), '-l', String(n), '-enc', 'UTF-8', '-q', pdf, '-'], { timeout: 40000, maxBuffer: 16 * 1024 * 1024 });
    text = clean(stdout);
    if (text.length >= 25) return { text, source: 'text', ms: Date.now() - t0 };
    if (!canOcr) return { text, source: 'empty', needsOcr: true, ms: Date.now() - t0 };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'taallam-ocr-'));
    try {
      await execFileAsync('pdftoppm', ['-f', String(n), '-l', String(n), '-r', String(OCR_DPI), '-jpeg', '-singlefile', pdf, path.join(dir, 'p')], { timeout: 90000, maxBuffer: 4 * 1024 * 1024 });
      const r = await execFileAsync('tesseract', [path.join(dir, 'p.jpg'), 'stdout', '-l', OCR_LANGS, '--psm', '3'], { timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
      text = clean(r.stdout); bump('ocr', 0);
      return { text, source: text.length >= 8 ? 'ocr' : 'empty', ms: Date.now() - t0 };
    } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* temp */ } }
  }

  // ---------- queue / worker ----------
  const queue = []; let active = 0;
  const tick = () => new Promise(r => setImmediate(r));
  function enqueue(bookId) { if (!queue.includes(bookId) && !(jobs[bookId] && jobs[bookId]._running)) queue.push(bookId); pump(); }
  function pump() { while (active < CONCURRENCY && queue.length) { const id = queue.shift(); active++; run(id).catch(e => console.error('book job crashed:', e.message)).finally(() => { active--; pump(); }); } }

  function newJob(book) {
    return { bookId: book.id, title: book.title, status: 'queued', total: 0, done: 0, failed: 0, failedPages: [], attempts: {}, sources: { text: 0, ocr: 0, empty: 0 }, errors: [], needsOcr: 0, createdAt: now(), updatedAt: now(), startedAt: null, finishedAt: null, pdfSha: '', runs: 0 };
  }
  function create(book) { const j = newJob(book); jobs[book.id] = j; persist(true); return j; }
  const publicJob = j => { const { _running, _cancel, ...rest } = j; return { ...rest, percent: rest.total ? Math.floor((rest.done + rest.failed) * 100 / rest.total) : 0 }; };

  async function run(bookId) {
    const job = jobs[bookId]; const book = ctx.getBook(bookId);
    if (!job || !book || !book.fileName) { if (job) { job.status = 'error'; job.errors.push({ page: 0, message: 'الكتاب أو ملفه غير موجود.', at: now() }); persist(true); } return; }
    job._running = true; job._cancel = false; job.status = 'running'; job.runs++; job.startedAt = job.startedAt || now(); job.updatedAt = now();
    if (ctx.emit) ctx.emit('platform', 'jobs'); persist(true);
    const pdf = pdfPathOf(book);
    try {
      const sha = await sha256File(pdf), total = await pageCount(pdf);
      if (total > MAX_PAGES) throw Object.assign(new Error('عدد صفحات الكتاب (' + total + ') يتجاوز الحد المسموح (' + MAX_PAGES + ').'), { fatal: true });
      if (job.pdfSha && job.pdfSha !== sha) { fs.rmSync(pageDir(bookId), { recursive: true, force: true }); job.attempts = {}; job.failedPages = []; } // the file was replaced: old page results are void
      job.pdfSha = sha; job.total = total;
      const canOcr = await ocrAvailable();
      const todo = []; let done = 0;
      for (let n = 1; n <= total; n++) { const p = readPage(bookId, n); if (p && p.sha === sha) done++; else todo.push(n); }
      job.done = done; job.failed = 0; job.failedPages = []; recount(job, bookId, total);
      let idx = 0;
      const worker = async () => {
        while (idx < todo.length && !job._cancel) {
          const n = todo[idx++]; let ok = false, lastErr = '';
          for (let attempt = 1; attempt <= 3 && !ok && !job._cancel; attempt++) {
            job.attempts[n] = (job.attempts[n] || 0) + 1;
            try {
              if (failPlan.has(n)) { const seen = (failSeen.get(n) || 0) + 1; failSeen.set(n, seen); if (seen <= failPlan.get(n)) throw new Error('فشل مقصود للاختبار'); }
              const r = await extractPage(pdf, n, canOcr);
              writePage(bookId, n, { n, text: r.text, source: r.source, needsOcr: !!r.needsOcr, chars: r.text.length, sha, at: now() });
              bump('pages', r.ms); ok = true;
            } catch (e) { lastErr = e.message || String(e); await new Promise(r => setTimeout(r, 150 * attempt)); }
          }
          if (ok) job.done++; else if (!job._cancel) { job.failed++; job.failedPages.push(n); job.errors.push({ page: n, message: lastErr.slice(0, 300), at: now() }); job.errors = job.errors.slice(-100); bump('failed', 0); }
          if (TEST_DELAY) await new Promise(r => setTimeout(r, TEST_DELAY));
          job.updatedAt = now(); persist(false); if (ctx.emit && (job.done + job.failed) % 5 === 0) ctx.emit('platform', 'jobs'); await tick();
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      if (job._cancel) { job.status = 'cancelled'; job.updatedAt = now(); persist(true); if (ctx.emit) ctx.emit('platform', 'jobs'); return; }
      job.failedPages.sort((a, b) => a - b); recount(job, bookId, total);
      await assemble(job, book, total);
      job.status = job.failed ? 'partial' : 'done'; job.finishedAt = now(); job.updatedAt = now(); persist(true);
      const nOcrMissing = job.needsOcr;
      if (job.failed) notice('book-partial', bookId, book.title, 'اكتملت معالجة «' + book.title + '» مع فشل ' + job.failed + ' صفحة (' + job.failedPages.slice(0, 12).join('، ') + '). يمكنك إعادة محاولة الصفحات الفاشلة من «معالجة الكتب».');
      else notice('book-done', bookId, book.title, 'اكتملت معالجة «' + book.title + '» (' + total + ' صفحة)' + (nOcrMissing ? ' — ' + nOcrMissing + ' صفحة مصورة لم تُقرأ لأن OCR غير مثبّت.' : '.'));
      if (ctx.afterAssemble) Promise.resolve(ctx.afterAssemble(bookId)).catch(e => console.error('after-assemble hook failed:', e.message)); // e.g. suggest experiments from the new text
    } catch (e) {
      job.status = 'error'; job.errors.push({ page: 0, message: String(e.message || e).slice(0, 300), at: now() }); job.finishedAt = now(); job.updatedAt = now(); persist(true);
      notice('book-error', bookId, book.title, 'فشلت معالجة «' + book.title + '»: ' + String(e.message || e).slice(0, 200));
    } finally { job._running = false; if (ctx.emit) ctx.emit('platform', 'jobs'); }
  }
  function recount(job, bookId, total) {
    const s = { text: 0, ocr: 0, empty: 0 }; let needs = 0;
    for (let n = 1; n <= total; n++) { const p = readPage(bookId, n); if (p) { s[p.source] = (s[p.source] || 0) + 1; if (p.needsOcr) needs++; } }
    job.sources = s; job.needsOcr = needs;
  }
  // build the book's full text and outline from the page files (deterministic: running it twice gives the same book)
  async function assemble(job, book, total) {
    const parts = [];
    for (let n = 1; n <= total; n++) { const p = readPage(book.id, n); if (p && p.text) parts.push(p.text); }
    const raw = parts.join('\n\n'), text = ctx.prepareBookText(ctx.normalize(raw)).text;
    ctx.updateBook(book.id, b => {
      b.pages = total; b.extractedChars = text.length; b.extractedText = text.slice(0, 2500000); b.outline = ctx.inferOutline(text);
      b.ocrUsed = job.sources.ocr > 0; b.ocrPages = job.sources.ocr;
      b.processing = { status: job.failed ? 'partial' : 'done', total, done: job.done, failed: job.failed, failedPages: job.failedPages.slice(0, 200), finishedAt: now(), sources: job.sources };
    });
  }

  // ---------- public operations ----------
  function start(book) { const j = create(book); const b = ctx.getBook(book.id); ctx.updateBook(book.id, x => { x.processing = { status: 'queued', total: 0, done: 0, failed: 0 }; }); enqueue(book.id); return publicJob(j); }
  function reprocess(bookId, { mode, from, to }) {
    const job = jobs[bookId], book = ctx.getBook(bookId); if (!job || !book) throw Object.assign(new Error('لا توجد مهمة معالجة لهذا الكتاب.'), { status: 404 });
    if (job._running) throw Object.assign(new Error('المعالجة جارية الآن. انتظر انتهاءها أو ألغِها أولًا.'), { status: 409 });
    let pages = [];
    if (mode === 'failed') pages = job.failedPages.slice();
    else if (mode === 'range') { const a = Math.max(1, Math.floor(Number(from))), b = Math.min(job.total || a, Math.floor(Number(to) || a)); if (!(a >= 1 && b >= a)) throw Object.assign(new Error('نطاق الصفحات غير صحيح.'), { status: 400 }); for (let n = a; n <= b; n++) pages.push(n); }
    else if (mode === 'all') { fs.rmSync(pageDir(bookId), { recursive: true, force: true }); job.attempts = {}; job.failedPages = []; job.done = 0; job.failed = 0; }
    else throw Object.assign(new Error('اختر نوع إعادة المعالجة.'), { status: 400 });
    if (mode !== 'all' && !pages.length) throw Object.assign(new Error('لا توجد صفحات فاشلة لإعادة معالجتها.'), { status: 400 });
    for (const n of pages) { try { fs.unlinkSync(pageFile(bookId, n)); } catch { /* not there */ } delete job.attempts[n]; failSeen.delete(n); }
    job.failedPages = job.failedPages.filter(n => !pages.includes(n)); job.status = 'queued'; job.finishedAt = null; job.updatedAt = now(); job.errors = job.errors.filter(e => !pages.includes(e.page));
    persist(true); enqueue(bookId); return publicJob(job);
  }
  function cancel(bookId) { const job = jobs[bookId]; if (!job) throw Object.assign(new Error('لا توجد مهمة.'), { status: 404 }); if (job._running) job._cancel = true; else if (job.status === 'queued') { const i = queue.indexOf(bookId); if (i >= 0) queue.splice(i, 1); job.status = 'cancelled'; persist(true); } return publicJob(job); }
  function resume(bookId) { const job = jobs[bookId]; if (!job) throw Object.assign(new Error('لا توجد مهمة.'), { status: 404 }); if (job._running) return publicJob(job); job.status = 'queued'; persist(true); enqueue(bookId); return publicJob(job); }
  function forget(bookId) { delete jobs[bookId]; try { fs.rmSync(pageDir(bookId), { recursive: true, force: true }); } catch { /* ok */ } persist(true); }
  function list() { return Object.values(jobs).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(publicJob); }
  const get = id => jobs[id] ? publicJob(jobs[id]) : null;
  function pagesTexts(bookId) { // texts for the reader (null if the page store is incomplete)
    const job = jobs[bookId]; if (!job || !job.total) return null; const out = [];
    for (let n = 1; n <= job.total; n++) { const p = readPage(bookId, n); if (!p) return null; out.push(p.text || ''); }
    return out;
  }
  // after a restart: jobs that were running or waiting go back to the queue
  function resumeAll() {
    for (const j of Object.values(jobs)) if (!j._running && (j.status === 'running' || j.status === 'queued')) { j.status = 'queued'; if (ctx.getBook(j.bookId)) enqueue(j.bookId); else { j.status = 'error'; } }
    persist(true);
  }
  return { notice, available, start, reprocess, cancel, resume, forget, list, get, stats, notices, markNoticesRead, pagesTexts, resumeAll, pageCount, maxPages: MAX_PAGES };
};

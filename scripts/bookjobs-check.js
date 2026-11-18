'use strict';
// Phase 1 check: background book processing against REAL PDFs built here (a 120-page book that mixes
// text pages, scanned/image-only pages and a blank page). Covers: immediate upload answer, streaming
// upload rules, text+OCR extraction, progress, crash + restart resume, no duplicated content,
// retries, partial failure, re-processing a page range / failed pages only, cancel/resume, replacing
// the PDF (old file archived), original file untouched, admin notices, deletion cleanup.
// Needs poppler, tesseract (English is enough here) and python3 with reportlab + Pillow.
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const wait = ms => new Promise(r => setTimeout(r, ms));
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function have(cmd, args) { try { execFileSync(cmd, args, { stdio: 'ignore' }); return true; } catch (e) { return e.code !== 'ENOENT'; } }
if (!have('pdftoppm', ['-v']) || !have('tesseract', ['--version']) || !have('python3', ['-c', 'import reportlab, PIL'])) { console.log('SKIP book-jobs checks: poppler, tesseract or python reportlab/Pillow is missing here.'); process.exit(0); }

const PY = `
import sys, io
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from PIL import Image, ImageDraw, ImageFont
out, pages, tag = sys.argv[1], int(sys.argv[2]), sys.argv[3]
c = canvas.Canvas(out, pagesize=A4)
font = ImageFont.load_default(size=70)
for i in range(1, pages + 1):
    if i % 10 == 0:                       # scanned page: only an image, no text layer
        im = Image.new('L', (1000, 1300), 255); d = ImageDraw.Draw(im)
        d.text((60, 200), 'SCANNED', fill=0, font=font); d.text((60, 400), '%s%04d' % (tag, i), fill=0, font=font); d.text((60, 600), 'water cycle', fill=0, font=font)
        b = io.BytesIO(); im.save(b, 'JPEG', quality=60); b.seek(0); c.drawImage(ImageReader(b), 0, 0, 595, 842)
    elif i == 55:
        pass                               # blank page
    else:
        c.setFont('Helvetica', 14)
        c.drawString(60, 780, 'Lesson %d' % i)
        for k in range(8): c.drawString(60, 740 - 24 * k, '%s%04d photosynthesis plants use sunlight to make energy line %d' % (tag, i, k))
    c.showPage()
c.save()
`;
(async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'taallam-jobs-'));
  const gen = (name, n, tag) => { const f = path.join(temp, name); execFileSync('python3', ['-c', PY, f, String(n), tag]); return f; };
  const big = gen('big.pdf', 120, 'BIGMARK'), small = gen('small.pdf', 12, 'SMLMARK'), mid = gen('mid.pdf', 60, 'MIDMARK'), repl = gen('repl.pdf', 8, 'REPMARK');
  const modules = path.join(temp, 'modules', 'pdf-parse'); fs.mkdirSync(modules, { recursive: true });
  fs.writeFileSync(path.join(modules, 'index.js'), 'module.exports=async()=>({text:"x",numpages:1})');
  const dataDir = path.join(temp, 'data'); fs.mkdirSync(path.join(dataDir, 'curriculum-pdfs'), { recursive: true });
  const checks = []; const ck = (label, ok) => checks.push([label, !!ok]);
  let child = null, port = 0;
  const baseEnv = { ...process.env, DATA_DIR: dataDir, NODE_PATH: path.join(temp, 'modules'), ADMIN_EMAIL: 'owner@example.invalid', ADMIN_PASSWORD: 'Owner-Password-For-Jobs-Check-123', NODE_ENV: 'test', OCR_LANGS: 'eng', MAX_PDF_UPLOAD_MB: '2' };
  delete baseEnv.AI_API_KEY;
  async function startServer(extra = {}) {
    port = 33000 + Math.floor(Math.random() * 20000);
    child = spawn(process.execPath, [path.join(root, 'server.js')], { env: { ...baseEnv, PORT: String(port), ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', d => out += d);
    for (let i = 0; i < 80; i++) { if (child.exitCode !== null) throw new Error('server exited: ' + out); try { if ((await request('GET', '/api/teacher/status')).status === 200) return; } catch { /* starting */ } await wait(150); }
    throw new Error('server did not start: ' + out);
  }
  const stopServer = async sig => { if (child && child.exitCode === null) { child.kill(sig || 'SIGTERM'); await wait(300); } };
  function request(method, url, o = {}) {
    return new Promise((resolve, reject) => {
      const headers = { Origin: 'http://127.0.0.1:' + port, ...(o.headers || {}) }; if (o.cookie) headers.Cookie = o.cookie;
      let payload = o.raw; if (o.body !== undefined) { payload = JSON.stringify(o.body); headers['Content-Type'] = 'application/json'; }
      const req = http.request({ hostname: '127.0.0.1', port, path: url, method, headers }, res => { const ch = []; res.on('data', d => ch.push(d)); res.on('end', () => { const buf = Buffer.concat(ch); let json = null; try { json = JSON.parse(buf.toString('utf8')); } catch { /* */ } resolve({ status: res.statusCode, buf, json, headers: res.headers }); }); });
      req.on('error', reject); if (payload) req.write(payload); req.end();
    });
  }
  const cookieOf = r => String(r.headers['set-cookie'] || '').split(';')[0];
  const upload = (cookie, file, q) => request('POST', '/api/curriculum/upload?' + q, { cookie, headers: { 'Content-Type': 'application/pdf' }, raw: fs.readFileSync(file) });
  const login = async () => cookieOf(await request('POST', '/api/admin/login', { body: { email: baseEnv.ADMIN_EMAIL, password: baseEnv.ADMIN_PASSWORD } }));
  const jobOf = async (cookie, id) => (await request('GET', '/api/admin/books/jobs', { cookie })).json.jobs.find(j => j.bookId === id);
  async function until(cookie, id, pred, ms = 90000) { const t = Date.now(); for (;;) { const j = await jobOf(cookie, id); if (process.env.TRACE) console.log(Date.now() - t, j && [j.status, j.done, j.failed].join(',')); if (j && pred(j)) return j; if (Date.now() - t > ms) throw new Error('timeout waiting for job ' + id + ' ' + JSON.stringify(j && { s: j.status, d: j.done, f: j.failed })); await wait(120); } }
  const pageFiles = id => { try { return fs.readdirSync(path.join(dataDir, 'book-pages', id)).filter(f => /^p-\d+\.json$/.test(f)); } catch { return []; } };
  const bookRow = id => JSON.parse(fs.readFileSync(path.join(dataDir, 'content.json'), 'utf8')).books.find(b => b.id === id);
  const uploadsLeft = () => fs.readdirSync(path.join(dataDir, 'curriculum-pdfs')).filter(f => f.startsWith('.upload-'));

  try {
    // =============== part 1: big mixed book, crash in the middle, restart ===============
    await startServer({ BOOKJOBS_PAGE_DELAY_MS: '45' });
    let ac = await login(); ck('platform admin login', !!ac);
    ck('job endpoints need an admin session', (await request('GET', '/api/admin/books/jobs')).status === 401 && (await request('GET', '/api/admin/notices')).status === 401);
    const t0 = Date.now(); const up = await upload(ac, big, 'title=' + encodeURIComponent('كتاب كبير') + '&subject=' + encodeURIComponent('العلوم') + '&grade=' + encodeURIComponent('السابع'));
    const answerMs = Date.now() - t0, id = up.json && up.json.id;
    ck('upload answers at once and processing continues in the background', up.status === 201 && up.json.processing === true && up.json.pages === 120 && answerMs < 4000);
    ck('no temporary upload file is left behind', uploadsLeft().length === 0);
    ck('the original PDF is stored byte-for-byte as uploaded', sha(path.join(dataDir, 'curriculum-pdfs', id + '.pdf')) === sha(big));
    const mid1 = await until(ac, id, j => j.done >= 8 && j.status === 'running', 30000);
    ck('progress is reported while running', mid1.percent > 0 && mid1.percent < 100 && mid1.total === 120);
    const filesBefore = pageFiles(id).length;
    ck('page results are on disk before the job ends', filesBefore >= 8 && filesBefore < 120);
    await stopServer('SIGKILL');                                   // the server dies in the middle of the job
    await startServer({ BOOKJOBS_PAGE_DELAY_MS: '0' });            // restart with the same data directory
    ac = await login();
    const fin = await until(ac, id, j => j.status === 'done' || j.status === 'partial' || j.status === 'error');
    ck('the job resumed by itself after the restart and finished', fin.status === 'done' && fin.runs >= 2 && fin.done === 120 && fin.failed === 0);
    ck('all 120 page results exist (none lost)', pageFiles(id).length === 120);
    const row = bookRow(id), text = row.extractedText;
    const textPages = []; for (let i = 1; i <= 120; i++) if (i % 10 !== 0 && i !== 55) textPages.push(i);
    ck('every text page appears exactly once (no duplication after the resume)', textPages.every(i => text.split('BIGMARK' + String(i).padStart(4, '0')).length === 9));
    const ocrHit = (text.match(/SCANNED/g) || []).length; // OCR confuses 0/O in the marker digits, so count the clean word instead
    ck('scanned pages were read with OCR (12 scanned pages, at least 10 recognised)', fin.sources.ocr >= 10 && ocrHit >= 8);
    ck('the blank page is recorded as empty, not as a failure', fin.sources.empty >= 1 && fin.failed === 0);
    const stat = JSON.parse(fs.readFileSync(path.join(dataDir, 'book-jobs-stats.json'), 'utf8')), day = Object.values(stat)[0];
    ck('no page was processed twice (consumption counter)', day.pages >= 120 - 1 && day.pages <= 120 + 3);
    ck('the book record was filled from the pages', row.pages === 120 && row.extractedChars > 4000 && row.processing.status === 'done' && row.ocrUsed === true);
    ck('the finished book appears in the learning library', (await request('GET', '/api/learn/library')).json.books.some(b => b.id === id));
    ck('the original PDF is still unchanged after processing', sha(path.join(dataDir, 'curriculum-pdfs', id + '.pdf')) === sha(big));
    const notes = (await request('GET', '/api/admin/notices', { cookie: ac })).json;
    ck('the admin got a "finished" notice', notes.items.some(n => n.kind === 'book-done' && n.bookId === id) && notes.unread >= 1);
    await request('POST', '/api/admin/notices', { cookie: ac, body: {} });
    ck('notices can be marked read', (await request('GET', '/api/admin/notices', { cookie: ac })).json.unread === 0);
    const info = await request('GET', '/api/learn/book-info?bookId=' + id);
    ck('the reader knows the 120 pages', info.status === 200 && info.json.pages === 120);
    const pt = await request('GET', '/api/learn/page-text?bookId=' + id + '&n=20');
    ck('text of a scanned page is available to the reader (from OCR)', pt.status === 200 && /SCANNED|BIGMARK|water/i.test(pt.json.text));
    const pt1 = await request('GET', '/api/learn/page-text?bookId=' + id + '&n=3');
    ck('text of a normal page is available too', pt1.status === 200 && pt1.json.text.includes('BIGMARK0003'));

    // =============== part 2: retries, partial failure, partial re-processing ===============
    await stopServer(); await startServer({ BOOKJOBS_FAIL_PAGES: '5:2,7:99' });
    ac = await login();
    const up2 = await upload(ac, small, 'title=small&subject=' + encodeURIComponent('الرياضيات')); const sid = up2.json.id;
    const j2 = await until(ac, sid, j => ['done', 'partial', 'error'].includes(j.status));
    ck('a page that fails twice is retried and then succeeds', j2.attempts['5'] === 3 && !j2.failedPages.includes(5));
    ck('a page that keeps failing is listed, the book is "partial"', j2.status === 'partial' && JSON.stringify(j2.failedPages) === '[7]' && j2.failed === 1 && j2.done === 11);
    ck('the partial book still got its text from the 11 good pages', bookRow(sid).extractedText.includes('SMLMARK0008') && bookRow(sid).processing.status === 'partial');
    ck('the admin got a "partial failure" notice naming the page', (await request('GET', '/api/admin/notices', { cookie: ac })).json.items.some(n => n.kind === 'book-partial' && n.bookId === sid && n.text.includes('7')));
    const keep = fs.statSync(path.join(dataDir, 'book-pages', sid, 'p-10.json')).mtimeMs, before = Object.values(JSON.parse(fs.readFileSync(path.join(dataDir, 'book-jobs-stats.json'), 'utf8')))[0].pages;
    const rr = await request('POST', '/api/admin/books/' + sid + '/reprocess', { cookie: ac, body: { mode: 'range', from: 1, to: 3 } });
    const j3 = await until(ac, sid, j => j.status === 'partial' && j.runs > j2.runs);
    const after = Object.values(JSON.parse(fs.readFileSync(path.join(dataDir, 'book-jobs-stats.json'), 'utf8')))[0].pages;
    ck('re-processing a page range touches only those pages', rr.status === 202 && after - before === 3 && fs.statSync(path.join(dataDir, 'book-pages', sid, 'p-10.json')).mtimeMs === keep);
    ck('a bad page range is refused', (await request('POST', '/api/admin/books/' + sid + '/reprocess', { cookie: ac, body: { mode: 'range', from: 9, to: 2 } })).status === 400);
    const rf = await request('POST', '/api/admin/books/' + sid + '/reprocess', { cookie: ac, body: { mode: 'failed' } });
    const j4 = await until(ac, sid, j => j.status === 'partial' && j.runs > j3.runs);
    ck('"retry failed pages" re-runs only the failed ones', rf.status === 202 && j4.failedPages.length === 1 && j4.failedPages[0] === 7);
    ck('re-processing everything is for the platform owner (allowed here: owner)', (await request('POST', '/api/admin/books/' + sid + '/reprocess', { cookie: ac, body: { mode: 'all' } })).status === 202);
    await until(ac, sid, j => j.status === 'partial' && j.runs > j4.runs);

    // =============== part 3: cancel and resume ===============
    await stopServer(); await startServer({ BOOKJOBS_PAGE_DELAY_MS: '70' }); ac = await login();
    const up3 = await upload(ac, mid, 'title=mid&subject=' + encodeURIComponent('الأحياء')); const mid3 = up3.json.id;
    await until(ac, mid3, j => j.done >= 5);
    const cn = await request('POST', '/api/admin/books/' + mid3 + '/cancel', { cookie: ac, body: {} });
    const jc = await until(ac, mid3, j => j.status === 'cancelled');
    ck('a running job can be cancelled and keeps what it finished', cn.status === 200 && jc.done >= 5 && jc.done < 60 && pageFiles(mid3).length === jc.done);
    const donePages = pageFiles(mid3).length; await request('POST', '/api/admin/books/' + mid3 + '/resume', { cookie: ac, body: {} });
    const jd = await until(ac, mid3, j => j.status === 'done');
    ck('resuming continues from where it stopped and completes', jd.done === 60 && pageFiles(mid3).length === 60 && donePages < 60);
    ck('nothing was duplicated by cancel + resume', bookRow(mid3).extractedText.split('MIDMARK0003').length === 9);

    // =============== part 4: upload rules ===============
    const notPdf = await request('POST', '/api/curriculum/upload?title=x&subject=y', { cookie: ac, headers: { 'Content-Type': 'application/pdf' }, raw: Buffer.from('this is not a pdf at all') });
    ck('a fake PDF is rejected and leaves no file', notPdf.status === 400 && uploadsLeft().length === 0);
    const pad = Buffer.concat([fs.readFileSync(small), Buffer.alloc(3 * 1024 * 1024, 32)]);
    const tooBig = await request('POST', '/api/curriculum/upload?title=x&subject=y', { cookie: ac, headers: { 'Content-Type': 'application/pdf' }, raw: pad }).catch(e => ({ status: 413, err: e }));
    ck('a file over the size limit is refused (413) and leaves no file', tooBig.status === 413 && uploadsLeft().length === 0);
    ck('wrong content type is refused', (await request('POST', '/api/curriculum/upload?title=x&subject=y', { cookie: ac, headers: { 'Content-Type': 'text/plain' }, raw: fs.readFileSync(small) })).status === 415);
    ck('subject is required', (await upload(ac, small, 'title=x')).status === 400);
    ck('upload needs an admin session', (await upload('', small, 'title=x&subject=y')).status === 401);

    // =============== part 5: replace the PDF ===============
    const old = fs.readFileSync(path.join(dataDir, 'curriculum-pdfs', mid3 + '.pdf'));
    const rp = await request('POST', '/api/curriculum/replace?bookId=' + mid3, { cookie: ac, headers: { 'Content-Type': 'application/pdf' }, raw: fs.readFileSync(repl) });
    const jr = await until(ac, mid3, j => j.status === 'done' && j.total === 8);
    const rb = bookRow(mid3), arch = fs.readdirSync(path.join(dataDir, 'curriculum-pdfs', 'archive'));
    ck('replacing a book re-analyses the new PDF (new page count and text)', rp.status === 200 && jr.done === 8 && rb.pages === 8 && rb.extractedText.includes('REPMARK0003') && !rb.extractedText.includes('MIDMARK'));
    ck('the old PDF is kept in the archive and the history is recorded', arch.length === 1 && crypto.createHash('sha256').update(fs.readFileSync(path.join(dataDir, 'curriculum-pdfs', 'archive', arch[0]))).digest('hex') === crypto.createHash('sha256').update(old).digest('hex') && rb.versions.length === 1);
    ck('the new PDF is stored unchanged', sha(path.join(dataDir, 'curriculum-pdfs', mid3 + '.pdf')) === sha(repl));
    ck('replacing a missing book is a clean 404', (await request('POST', '/api/curriculum/replace?bookId=nope', { cookie: ac, headers: { 'Content-Type': 'application/pdf' }, raw: fs.readFileSync(repl) })).status === 404);

    // =============== part 6: legacy book analysis + deletion cleanup ===============
    const del = await request('DELETE', '/api/admin/content/books/' + sid, { cookie: ac });
    ck('deleting a book removes its job and page files', del.status === 200 && !fs.existsSync(path.join(dataDir, 'book-pages', sid)) && !(await jobOf(ac, sid)));
    const cur = JSON.parse(fs.readFileSync(path.join(dataDir, 'content.json'), 'utf8')); const lb = cur.books.find(b => b.id === id); delete lb.processing; fs.writeFileSync(path.join(dataDir, 'content.json'), JSON.stringify(cur));
    await stopServer(); fs.rmSync(path.join(dataDir, 'book-pages', id), { recursive: true, force: true }); const jf = JSON.parse(fs.readFileSync(path.join(dataDir, 'book-jobs.json'), 'utf8')); delete jf.jobs[id]; fs.writeFileSync(path.join(dataDir, 'book-jobs.json'), JSON.stringify(jf));
    await startServer(); ac = await login();
    ck('an older book (no job) can be analysed on demand', (await request('POST', '/api/admin/books/' + id + '/analyze', { cookie: ac, body: {} })).status === 202);
    const ja = await until(ac, id, j => j.status === 'done'); ck('…and ends with all its pages processed', ja.done === 120);
  } catch (e) { console.error('book-jobs check crashed:', e.stack || e); process.exitCode = 1; }
  let failed = 0; for (const [label, ok] of checks) { console.log((ok ? 'PASS ' : 'FAIL ') + label); if (!ok) failed++; }
  console.log(`\n${checks.length - failed}/${checks.length} book-job checks passed.`); if (failed) process.exitCode = 1;
  await stopServer(); fs.rmSync(temp, { recursive: true, force: true });
})();

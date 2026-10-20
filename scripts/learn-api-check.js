'use strict';
// End-to-end check of /api/learn/* with a local mock AI provider and a book whose text is stored reversed (as many Arabic PDFs extract).
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const { spawn } = require('child_process');
const root = path.resolve(__dirname, '..');
const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'seed-book-reversed.txt'), 'utf8');
const wait = ms => new Promise(r => setTimeout(r, ms));
function request(port, urlPath, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method: opts.method || 'GET', headers: opts.body ? { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:' + port } : {} }, res => {
      let b = ''; res.setEncoding('utf8'); res.on('data', d => b += d); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} resolve({ status: res.statusCode, json: j, body: b }); });
    });
    req.on('error', reject); if (opts.body) req.write(JSON.stringify(opts.body)); req.end();
  });
}
function startMockAI() {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      const body = JSON.parse(b || '{}'); const user = body.messages.map(m => m.content).join('\n'); seen.push(user);
      let content;
      if (user.includes('أخرج JSON فقط بلا أي شرح')) content = '```json\n' + JSON.stringify({ questions: [
        { type: 'mcq', q: 'ما معنى الصدق؟', options: ['قول الحقيقة', 'إخفاء الخطأ', 'الكذب'], answer: 0, why: 'الصدق قول الحقيقة' },
        { type: 'write', q: 'لماذا نصدق؟', model: 'لأن الصدق يبني الثقة بين الناس' }] }) + '\n```';
      else if (user.includes('تصحح إجابة طالب')) content = '{"score":2,"feedback":"أحسنت"}';
      else content = '**مرحبًا** يا صديقي!\n\nالصدق خلق عظيم.\n\nالصدق يبني الثقة بين الناس.';
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port, seen })));
}
async function startServer(extraEnv) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'taallam-learn-'));
  const modules = path.join(temp, 'modules', 'pdf-parse'); fs.mkdirSync(modules, { recursive: true });
  fs.writeFileSync(path.join(modules, 'index.js'), 'module.exports=async()=>({text:"x",numpages:1})');
  const dataDir = path.join(temp, 'data'); fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'content.json'), JSON.stringify({ books: [{ id: 'book1', title: 'التربية الإسلامية', grade: 'الثالث', subject: 'تربية إسلامية', pages: 6, extractedText: raw }], plans: [], lessons: [], units: [] }));
  const port = 32000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env, PORT: String(port), DATA_DIR: dataDir, NODE_PATH: path.join(temp, 'modules'), ADMIN_EMAIL: 'a@example.invalid', ADMIN_PASSWORD: 'Test-Password-For-Learn-Check-123', ...extraEnv };
  delete env.AI_API_KEY; Object.assign(env, extraEnv);
  const child = spawn(process.execPath, [path.join(root, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = ''; child.stdout.on('data', d => out += d); child.stderr.on('data', d => out += d);
  for (let i = 0; i < 60; i++) { try { if ((await request(port, '/api/learn/status')).status === 200) return { port, child }; } catch {} await wait(250); }
  throw new Error('server not ready: ' + out);
}
(async () => {
  const checks = []; const mock = await startMockAI(); let withAI, noAI;
  try {
    withAI = await startServer({ AI_API_KEY: 'test-key', AI_BASE_URL: 'http://127.0.0.1:' + mock.port });
    const P = withAI.port;
    const lib = await request(P, '/api/learn/library'); checks.push(['library lists the book without its text', lib.json?.books?.some(b => b.id === 'book1') && !lib.body.includes('extractedText')]);
    const out = await request(P, '/api/learn/outline?bookId=book1'); checks.push(['outline finds 4 lessons in the (reversed) book', out.json?.looseLessons?.length === 4 && out.json.looseLessons[0].title.includes('الصدق')]);
    const t1 = await request(P, '/api/learn/teach', { method: 'POST', body: { bookId: 'book1', query: 'اشرح الدرس الأول', mode: 'explain', stage: 'kids' } });
    checks.push(['teach returns clean slides (no markdown)', t1.status === 200 && t1.json.slides.length === 3 && !t1.json.slides.join('').includes('*') && t1.json.configured === true]);
    checks.push(['AI prompt received repaired (not reversed) book text', mock.seen.some(s => s.includes('الصدق خلق عظيم')) && !mock.seen.some(s => s.includes('قدصلا')) ]);
    const t2 = await request(P, '/api/learn/teach', { method: 'POST', body: { bookId: 'book1', query: 'اشرح الوحدة السابعة' } });
    checks.push(['unknown unit gives a clear 404', t2.status === 404 && t2.json.error.includes('الوحدة')]);
    const t3 = await request(P, '/api/learn/teach', { method: 'POST', body: { bookId: 'nope', query: 'x' } }); checks.push(['unknown book is rejected', t3.status === 404]);
    const q = await request(P, '/api/learn/quiz', { method: 'POST', body: { bookId: 'book1', sectionId: 'l1', count: 4, stage: 'reader' } });
    checks.push(['quiz returns validated mcq + write questions', q.status === 200 && q.json.questions.some(x => x.type === 'mcq' && x.answer === 0) && q.json.questions.some(x => x.type === 'write')]);
    const g = await request(P, '/api/learn/grade', { method: 'POST', body: { q: 'لماذا نصدق؟', model: 'لأن الصدق يبني الثقة', answer: 'لأنه يبني الثقة' } }); checks.push(['grading returns score and feedback', g.json?.score === 2 && !!g.json.feedback]);
    const bad = await request(P, '/api/learn/teach', { method: 'POST', body: { bookId: 'book1', mode: 'ask', question: '' } }); checks.push(['empty question is rejected', bad.status === 400]);
    noAI = await startServer({});
    const f1 = await request(noAI.port, '/api/learn/teach', { method: 'POST', body: { bookId: 'book1', sectionId: 'l2', mode: 'explain' } });
    checks.push(['without AI key: falls back to the book text, flagged', f1.status === 200 && f1.json.configured === false && f1.json.slides.join(' ').includes('الأمانة') && !!f1.json.notice]);
    const f2 = await request(noAI.port, '/api/learn/quiz', { method: 'POST', body: { bookId: 'book1', sectionId: 'l1', count: 3 } });
    checks.push(['without AI key: offline cloze quiz still works', f2.status === 200 && f2.json.questions.length > 0 && f2.json.questions[0].options.length === 3]);
    const f3 = await request(noAI.port, '/api/learn/grade', { method: 'POST', body: { q: 'ما الصدق؟', model: 'قول الحقيقة وعدم خداع الآخرين', answer: 'قول الحقيقة وعدم الخداع' } });
    checks.push(['without AI key: keyword grading works', f3.json?.score >= 1 && f3.json.approximate === true]);
  } catch (e) { console.error(e); checks.push(['no exception', false]); }
  finally { withAI?.child.kill(); noAI?.child.kill(); mock.srv.close(); }
  let failed = 0; for (const [n, ok] of checks) { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) failed++; }
  console.log(`\n${checks.length - failed}/${checks.length} learn API checks passed.`); process.exit(failed ? 1 : 0);
})();

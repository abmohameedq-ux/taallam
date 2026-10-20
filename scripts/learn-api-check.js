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
  const seen = []; let speechCalls = 0, geminiCalls = 0;
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      if (req.url.includes(':generateContent')) { geminiCalls++; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: Buffer.alloc(4800, 3).toString('base64') } }] } }] })); }
      if (req.url.endsWith('/audio/speech')) { speechCalls++; res.setHeader('Content-Type', 'audio/mpeg'); return res.end(Buffer.alloc(2048, 7)); }
      const body = JSON.parse(b || '{}'); const user = body.messages.map(m => m.content).join('\n'); seen.push(user);
      let content;
      if (user.includes('أخرج JSON فقط بلا أي شرح')) content = '```json\n' + JSON.stringify({ questions: [
        { type: 'mcq', q: 'ما معنى الصدق؟', options: ['قول الحقيقة', 'إخفاء الخطأ', 'الكذب'], answer: 0, why: 'الصدق قول الحقيقة' },
        { type: 'write', q: 'لماذا نصدق؟', model: 'لأن الصدق يبني الثقة بين الناس' }] }) + '\n```';
      else if (user.includes('تصحح إجابة طالب')) content = '{"score":2,"feedback":"أحسنت"}';
      else content = '**مرحبًا** يا صديقي!\n\nانظر ماذا قال النبي صلى الله عليه وسلم عن الصدق.\n\nنص الكتاب: الصدق خلق عظيم.';
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port, seen, calls: () => speechCalls, gemini: () => geminiCalls })));
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
  const checks = []; const mock = await startMockAI(); let withAI, noAI, gem;
  try {
    withAI = await startServer({ AI_API_KEY: 'test-key', AI_BASE_URL: 'http://127.0.0.1:' + mock.port });
    const P = withAI.port;
    const lib = await request(P, '/api/learn/library'); checks.push(['library lists the book without its text', lib.json?.books?.some(b => b.id === 'book1') && !lib.body.includes('extractedText')]);
    const out = await request(P, '/api/learn/outline?bookId=book1'); checks.push(['outline finds 4 lessons in the (reversed) book', out.json?.looseLessons?.length === 4 && out.json.looseLessons[0].title.includes('الصدق')]);
    const t1 = await request(P, '/api/learn/teach', { method: 'POST', body: { bookId: 'book1', query: 'اشرح الدرس الأول', mode: 'explain', stage: 'kids' } });
    checks.push(['teach returns clean slides (no markdown)', t1.status === 200 && t1.json.slides.length === 3 && !t1.json.slides.map(x => x.t).join('').includes('*') && t1.json.configured === true]);
    checks.push(['final slide is marked as the book\'s original text', t1.json.slides[2].src === true && t1.json.slides[2].t.startsWith('نص الكتاب') && t1.json.slides[0].src === false]);
    checks.push(['teacher-style rules are sent to the AI (explain, quote book text, solve math step by step)', mock.seen.some(s => s.includes('لا تقرأ النص كما هو') && s.includes('نص الكتاب:') && s.includes('خطوة خطوة'))]);
    checks.push(['AI prompt received repaired (not reversed) book text', mock.seen.some(s => s.includes('الصدق خلق عظيم')) && !mock.seen.some(s => s.includes('قدصلا')) ]);
    const t2 = await request(P, '/api/learn/teach', { method: 'POST', body: { bookId: 'book1', query: 'اشرح الوحدة السابعة' } });
    checks.push(['unknown unit gives a clear 404', t2.status === 404 && t2.json.error.includes('الوحدة')]);
    const t3 = await request(P, '/api/learn/teach', { method: 'POST', body: { bookId: 'nope', query: 'x' } }); checks.push(['unknown book is rejected', t3.status === 404]);
    const q = await request(P, '/api/learn/quiz', { method: 'POST', body: { bookId: 'book1', sectionId: 'l1', count: 4, stage: 'reader' } });
    checks.push(['quiz returns validated mcq + write questions', q.status === 200 && q.json.questions.some(x => x.type === 'mcq' && x.answer === 0) && q.json.questions.some(x => x.type === 'write')]);
    const g = await request(P, '/api/learn/grade', { method: 'POST', body: { q: 'لماذا نصدق؟', model: 'لأن الصدق يبني الثقة', answer: 'لأنه يبني الثقة' } }); checks.push(['grading returns score and feedback', g.json?.score === 2 && !!g.json.feedback]);
    const bad = await request(P, '/api/learn/teach', { method: 'POST', body: { bookId: 'book1', mode: 'ask', question: '' } }); checks.push(['empty question is rejected', bad.status === 400]);
    const st = await request(P, '/api/learn/status'); checks.push(['status reports AI and cloud voice available', st.json?.ai === true && st.json?.tts === true]);
    const sp1 = await request(P, '/api/learn/speak', { method: 'POST', body: { text: 'مرحبًا بك يا صديقي' } });
    const sp2 = await request(P, '/api/learn/speak', { method: 'POST', body: { text: 'مرحبًا بك يا صديقي' } });
    checks.push(['cloud voice returns audio and caches repeated text', sp1.status === 200 && sp1.body.length > 100 && sp2.status === 200 && mock.calls() === 1]);
    const sp3 = await request(P, '/api/learn/speak', { method: 'POST', body: { text: ' ' } }); checks.push(['cloud voice rejects empty text', sp3.status === 400]);
    gem = await startServer({ AI_API_KEY: 'gem-key', AI_BASE_URL: 'http://127.0.0.1:' + mock.port + '/v1beta/openai/', TTS_BASE_URL: 'http://127.0.0.1:' + mock.port + '/v1beta', TTS_PROVIDER: 'gemini' });
    const g1 = await request(gem.port, '/api/learn/speak', { method: 'POST', body: { text: 'مرحبًا بك يا صديقي' } });
    checks.push(['Gemini voice: raw PCM is wrapped as a playable WAV (RIFF, 24 kHz, 16-bit mono)', g1.status === 200 && g1.body.startsWith('RIFF') && mock.gemini() === 1]);
    await request(gem.port, '/api/learn/speak', { method: 'POST', body: { text: 'مرحبًا بك يا صديقي' } }); checks.push(['Gemini voice is cached after the first call', mock.gemini() === 1]);
    noAI = await startServer({});
    const spn = await request(noAI.port, '/api/learn/speak', { method: 'POST', body: { text: 'مرحبا' } }); checks.push(['cloud voice is cleanly unavailable without a key', spn.status === 503 && (await request(noAI.port, '/api/learn/status')).json.tts === false]);
    const f1 = await request(noAI.port, '/api/learn/teach', { method: 'POST', body: { bookId: 'book1', sectionId: 'l2', mode: 'explain' } });
    checks.push(['without AI key: falls back to the book text, flagged', f1.status === 200 && f1.json.configured === false && f1.json.slides.map(x => x.t).join(' ').includes('الأمانة') && !!f1.json.notice]);
    const f2 = await request(noAI.port, '/api/learn/quiz', { method: 'POST', body: { bookId: 'book1', sectionId: 'l1', count: 3 } });
    checks.push(['without AI key: offline cloze quiz still works', f2.status === 200 && f2.json.questions.length > 0 && f2.json.questions[0].options.length === 3]);
    const f3 = await request(noAI.port, '/api/learn/grade', { method: 'POST', body: { q: 'ما الصدق؟', model: 'قول الحقيقة وعدم خداع الآخرين', answer: 'قول الحقيقة وعدم الخداع' } });
    checks.push(['without AI key: keyword grading works', f3.json?.score >= 1 && f3.json.approximate === true]);
  } catch (e) { console.error(e); checks.push(['no exception', false]); }
  finally { withAI?.child.kill(); noAI?.child.kill(); gem?.child.kill(); mock.srv.close(); }
  let failed = 0; for (const [n, ok] of checks) { console.log((ok ? 'PASS ' : 'FAIL ') + n); if (!ok) failed++; }
  console.log(`\n${checks.length - failed}/${checks.length} learn API checks passed.`); process.exit(failed ? 1 : 0);
})();

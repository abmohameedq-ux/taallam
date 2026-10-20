'use strict';
// HTTP integration smoke test. Uses a temporary parser stub because this test
// verifies routing/auth/HTTP behavior, not real PDF extraction quality.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'taallam-http-test-'));
const modules = path.join(temp, 'modules', 'pdf-parse');
fs.mkdirSync(modules, { recursive: true });
fs.writeFileSync(path.join(modules, 'index.js'), "module.exports = async function(){ return { text: 'اختبار نص PDF تجريبي يتجاوز الحد الأدنى للاختبار، ويُستخدم فقط للتحقق من مسارات HTTP وليس لاختبار استخراج PDF الحقيقي.', numpages: 1 }; };\n");
const port = 31000 + Math.floor(Math.random() * 20000);
const env = { ...process.env, PORT: String(port), DATA_DIR: path.join(temp, 'data'), NODE_PATH: path.join(temp, 'modules'), ADMIN_EMAIL: 'test-admin@example.invalid', ADMIN_PASSWORD: 'TestPassword-Only-For-Smoke-Check-123', NODE_ENV: 'test' };
const child = spawn(process.execPath, [path.join(root, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', d => output += d.toString());
child.stderr.on('data', d => output += d.toString());
const wait = ms => new Promise(r => setTimeout(r, ms));
function request(urlPath, options={}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: urlPath, method: options.method || 'GET', headers: options.headers || {} }, res => {
      let body=''; res.setEncoding('utf8'); res.on('data', d => body += d); res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject); if (options.body) req.write(options.body); req.end();
  });
}
(async () => {
  const checks=[];
  try {
    let ready=false;
    for(let i=0;i<60;i++){ if(child.exitCode!==null) throw new Error('Server exited before readiness. '+output); try { const r=await request('/api/teacher/status'); if(r.status===200){ready=true;break;} } catch {} await wait(200); }
    if(!ready) throw new Error('Server did not become ready. '+output);
    for(const [label,url] of [['public homepage','/'],['student portal','/student'],['teacher portal','/teacher'],['guardian portal','/guardian'],['school admin portal','/school-admin'],['school portal','/school'],['admin portal','/admin']]) {
      const r=await request(url); checks.push([label,r.status===200 && r.headers['content-type']?.includes('text/html')]);
    }
    for(const [label,url,needle] of [['admin scoped service worker','/admin/sw.js','taallam-admin-shell-v2.86.0'],['school admin scoped service worker','/school-admin/sw.js','taallam-school-admin-shell-v2.74.0'],['admin manifest','/manifest-admin.webmanifest','/admin/'],['school admin manifest','/manifest-school-admin.webmanifest','/school-admin/']]) { const r=await request(url); checks.push([label,r.status===200 && r.body.includes(needle)]); }
    const status=await request('/api/teacher/status'); checks.push(['teacher status API responds JSON',status.status===200 && JSON.parse(status.body).configured===false]);
    const askNoBook=await request('/api/teacher/ask',{method:'POST',headers:{'Content-Type':'application/json','Origin':`http://127.0.0.1:${port}`},body:JSON.stringify({question:'اشرح الدرس'})});
    checks.push(['teacher question requires selected curriculum book',askNoBook.status===400 && JSON.parse(askNoBook.body).error.includes('اختر كتابًا')]);
    const adminPdfStatus=await request('/api/admin/pdf-status'); checks.push(['PDF diagnostic rejects unauthenticated access',adminPdfStatus.status===401]);
    const studentProgress=await request('/api/school-member/learning-progress'); checks.push(['learning progress is private to authenticated school students',studentProgress.status===401]);
    const schoolProgress=await request('/api/school-admin/learning-progress'); checks.push(['school-wide learning progress requires school administrator login',schoolProgress.status===401]);
    const login=await request('/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json','Origin':`http://127.0.0.1:${port}`},body:JSON.stringify({email:env.ADMIN_EMAIL,password:env.ADMIN_PASSWORD})});
    let cookie=''; if(login.status===200) cookie=String(login.headers['set-cookie']||'').split(';')[0];
    checks.push(['admin login accepts configured test credentials',login.status===200 && !!cookie]);
    const diag=await request('/api/admin/pdf-status',{headers:{Cookie:cookie}});
    let diagOk=false; try { const j=JSON.parse(diag.body); diagOk=diag.status===200 && j.pdfParser.available===true && typeof j.ocr==='object' && typeof j.storage==='object'; } catch {}
    checks.push(['authenticated PDF diagnostic returns structured readiness data',diagOk]);
    let failed=0; for(const [label,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${label}`);if(!ok)failed++;}
    console.log(`\n${checks.length-failed}/${checks.length} HTTP integration checks passed (PDF parser is a test stub; real PDF parsing/OCR is not tested here).`);
    if(failed) process.exitCode=1;
  } catch(e) { console.error('HTTP smoke test failed:',e.stack||e); process.exitCode=1; }
  finally { child.kill('SIGTERM'); await wait(150); fs.rmSync(temp,{recursive:true,force:true}); }
})();

const http = require('http');
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const learn = require('./lib/learn.js');
const execFileAsync = promisify(execFile);
const root = __dirname;
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(root, 'data');
const uploadDir = path.join(dataDir, 'curriculum-pdfs');
const assignmentPdfDir = path.join(dataDir, 'school-assignment-pdfs');
const submissionPdfDir = path.join(dataDir, 'school-submission-pdfs');
for (const dir of [uploadDir, assignmentPdfDir, submissionPdfDir]) fs.mkdirSync(dir, { recursive: true });
// PDF processing is a core platform dependency (curriculum ingestion and learning workflows).
// Fail during startup rather than serving a partially working education platform.
let pdfParse;
try {
  pdfParse = require('pdf-parse');
  if (typeof pdfParse !== 'function') throw new TypeError('pdf-parse did not export a parser function');
} catch (error) {
  console.error('FATAL: PDF support is required. Install production dependencies with `npm ci` (or `npm install`) before starting the server.');
  console.error(error.message);
  process.exit(1);
}
const dataFile = path.join(dataDir, 'content.json');
const accountsFile = path.join(dataDir, 'parent-accounts.json');
const sessionsFile = path.join(dataDir, 'parent-sessions.json');
const adminSessionsFile = path.join(dataDir, 'admin-sessions.json');
const adminsFile = path.join(dataDir, 'admins.json');
const teachersFile = path.join(dataDir, 'teachers.json');
const teacherSessionsFile = path.join(dataDir, 'teacher-sessions.json');
const schoolsFile = path.join(dataDir, 'schools.json');
const schoolSessionsFile = path.join(dataDir, 'school-sessions.json');
const schoolPostsFile = path.join(dataDir, 'school-posts.json');
const schoolMembersFile = path.join(dataDir, 'school-members.json');
const schoolMemberSessionsFile = path.join(dataDir, 'school-member-sessions.json');
const schoolSubmissionsFile = path.join(dataDir, 'school-submissions.json');
const guardianLinksFile = path.join(dataDir, 'guardian-links.json');
const schoolFeesFile = path.join(dataDir, 'school-fees.json');
const feedbackFile = path.join(dataDir, 'app-feedback.json');
const schoolArchivesFile = path.join(dataDir, 'school-archives.json');
const settingsFile = path.join(dataDir, 'platform-settings.json');
const auditFile = path.join(dataDir, 'audit-log.json');
const adminSessions = new Map();
const teacherSessions = new Map();
const schoolSessions = new Map();
const schoolMemberSessions = new Map();
function loadTeacherSessions(){try{for(const [token,session] of JSON.parse(fs.readFileSync(teacherSessionsFile,'utf8')))if(session&&session.expires>Date.now())teacherSessions.set(token,session);}catch{}}
function saveTeacherSessions(){writeFileAtomic(teacherSessionsFile,JSON.stringify([...teacherSessions.entries()]),{mode:0o600});}
function sessionTeacher(req){const raw=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('taallam_teacher='));const token=raw?raw.slice('taallam_teacher='.length):'';const session=teacherSessions.get(token);if(!session||session.expires<Date.now()){if(token)teacherSessions.delete(token);return null;}return {token,...session};}
function teacherCookie(res,token,maxAge){res.setHeader('Set-Cookie',`taallam_teacher=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.NODE_ENV==='production'?'; Secure':''}`);}
function readJsonFile(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}}
function writeFileAtomic(file,data,opts){const tmp=file+'.'+process.pid+'.tmp';fs.writeFileSync(tmp,data,opts);fs.renameSync(tmp,file);}
function saveJsonFile(file,data){writeFileAtomic(file,JSON.stringify(data,null,2),{mode:0o600});}
function readSchools(){const d=readJsonFile(schoolsFile,{schools:[]});return {schools:Array.isArray(d.schools)?d.schools:[]};}
function readSchoolPosts(){const d=readJsonFile(schoolPostsFile,{posts:[]});return {posts:Array.isArray(d.posts)?d.posts:[]};}
function readSchoolMembers(){const d=readJsonFile(schoolMembersFile,{members:[]});return {members:Array.isArray(d.members)?d.members:[]};}
function readSchoolSubmissions(){const d=readJsonFile(schoolSubmissionsFile,{submissions:[]});return {submissions:Array.isArray(d.submissions)?d.submissions:[]};}
function readGuardianLinks(){const d=readJsonFile(guardianLinksFile,{links:[]});return {links:Array.isArray(d.links)?d.links:[]};}
function saveGuardianLinks(d){saveJsonFile(guardianLinksFile,d);}
function saveSchoolMembers(d){saveJsonFile(schoolMembersFile,d);}
function saveSchoolMemberSessions(){saveJsonFile(schoolMemberSessionsFile,[...schoolMemberSessions.entries()]);}
function memberCookie(res,token,maxAge){res.setHeader('Set-Cookie',`taallam_school_member=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.NODE_ENV==='production'?'; Secure':''}`);}
function sessionSchoolMember(req){const raw=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('taallam_school_member='));const token=raw?raw.slice('taallam_school_member='.length):'';const ss=schoolMemberSessions.get(token);if(!ss||ss.expires<Date.now()){if(token)schoolMemberSessions.delete(token);return null;}const member=readSchoolMembers().members.find(m=>m.id===ss.memberId&&m.active&&m.status==='approved');const school=member&&readSchools().schools.find(x=>x.id===member.schoolId&&x.active);if(!member||!school){schoolMemberSessions.delete(token);saveSchoolMemberSessions();return null;}return {token,...ss,member,school};}
function requireSchoolMember(req,res){const ss=sessionSchoolMember(req);if(!ss){send(res,401,{error:'سجّل الدخول بحساب مدرسي معتمد أولًا.'});return null;}return ss;}
function readPlatformSettings(){return readJsonFile(settingsFile,{appName:'تعلّم مع الهيثم',tagline:'كل طفل يستحق معلّمًا.',description:'منصة تعليمية عربية',logoUrl:'',contactEmail:'',phoneNumbers:[],socialLinks:[],aboutText:'منصة تعلّم مع الهيثم مساحة تعليمية تهدف إلى تيسير الوصول إلى العلم والمعرفة، ومساعدة المتعلمين على تنمية قدراتهم وبناء مستقبلهم.',dedicationText:'إلى كل طفل وطفلة، وإلى كل شاب وشابة، وإلى كل طالب وطالبة، وإلى كل إنسان يحمل في قلبه شغف العلم وحب المعرفة. أهدي هذا العمل المتواضع راجيًا من الله أن يكون بابًا للعلم النافع ونافذة للأمل وعونًا لكل من يسعى إلى المعرفة، مهما كان عمره أو ظروفه. عمل وتصميم وتطوير المهندس هيثم القاضي. هدية للجميع دون استثناء؛ لأن العلم حق للجميع والمعرفة نور والتعليم أمل يصنع مستقبلًا أجمل.',footerText:'هدية للجميع، دون استثناء؛ لأن العلم حق للجميع، والمعرفة نور، والتعليم أمل يصنع مستقبلًا أجمل. عمل وتصميم وتطوير المهندس هيثم القاضي.',newsTicker:{enabled:false,text:''},ads:[],updatedAt:null});}
function sessionSchoolAdmin(req){const raw=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('taallam_school_admin='));const token=raw?raw.slice('taallam_school_admin='.length):'';const session=schoolSessions.get(token);if(!session||session.expires<Date.now()){if(token)schoolSessions.delete(token);return null;}const school=readSchools().schools.find(x=>x.id===session.schoolId&&x.active);const account=school?.admins?.find(x=>x.id===session.schoolAdminId&&x.active);if(!school||!account){schoolSessions.delete(token);saveJsonFile(schoolSessionsFile,[...schoolSessions.entries()]);return null;}return {token,...session,school,account};}
function saveSchoolSessions(){saveJsonFile(schoolSessionsFile,[...schoolSessions.entries()]);}
function schoolAdminCookie(res,token,maxAge){res.setHeader('Set-Cookie',`taallam_school_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.NODE_ENV==='production'?'; Secure':''}`);}
function requireSchoolAdmin(req,res){const ss=sessionSchoolAdmin(req);if(!ss){send(res,401,{error:'سجّل الدخول بحساب إدارة المدرسة أولًا.'});return null;}return ss;}
function publicSchool(s){const accounts=Array.isArray(s.admins)?s.admins:[];const principal=accounts.find(a=>(a.schoolRole||'principal')==='principal'&&a.active);const deputy=accounts.find(a=>a.schoolRole==='deputy'&&a.active);return {id:s.id,name:s.name,slug:s.slug||'',description:s.description||'',logoUrl:s.logoUrl||'',contactEmail:s.contactEmail||'',phone:s.phone||'',active:!!s.active,createdAt:s.createdAt,schoolYear:s.schoolYear||'',grades:s.grades||[],subjects:s.subjects||[],sections:s.sections||[],gradeSections:s.gradeSections||{},resultBalanceThreshold:Number.isFinite(Number(s.resultBalanceThreshold))?Number(s.resultBalanceThreshold):-1,principal:principal?{name:principal.name,email:principal.email}:null,deputy:deputy?{name:deputy.name,email:deputy.email}:null};}
function audit(actor,action,details={}){try{let rows=[];try{rows=JSON.parse(fs.readFileSync(auditFile,'utf8'));}catch{}rows.unshift({at:new Date().toISOString(),actor:String(actor||'system').slice(0,254),action:String(action).slice(0,100),details:Object.fromEntries(Object.entries(details).slice(0,10).map(([k,v])=>[String(k).slice(0,50),String(v).slice(0,180)]))});writeFileAtomic(auditFile,JSON.stringify(rows.slice(0,2000),null,2),{mode:0o600});}catch(e){console.error('Audit log write failed:',e.message);}}
function readTeachers(){try{const d=JSON.parse(fs.readFileSync(teachersFile,'utf8'));return Array.isArray(d.teachers)?d:{teachers:[]};}catch{return {teachers:[]};}}
function saveTeachers(d){writeFileAtomic(teachersFile,JSON.stringify(d,null,2),{mode:0o600});}
function requireTeacher(req,res){const t=sessionTeacher(req);if(!t){send(res,401,{error:'سجّل الدخول بحساب المعلّم أولًا.'});return null;}return t;}
function loadAdminSessions(){try{for(const [token,session] of JSON.parse(fs.readFileSync(adminSessionsFile,'utf8')))if(session&&session.expires>Date.now())adminSessions.set(token,session);}catch{}}
function saveAdminSessions(){try{writeFileAtomic(adminSessionsFile,JSON.stringify([...adminSessions.entries()]),{mode:0o600});}catch(e){console.error('Could not persist admin sessions:',e.message);}}
function readAdmins(){try{const d=JSON.parse(fs.readFileSync(adminsFile,'utf8'));return Array.isArray(d.admins)?d:{admins:[]};}catch{return {admins:[]};}}
function saveAdmins(d){writeFileAtomic(adminsFile,JSON.stringify(d,null,2),{mode:0o600});}
function sessionAdmin(req){const raw=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('taallam_admin='));const token=raw?raw.slice('taallam_admin='.length):'';const session=adminSessions.get(token);if(!session||session.expires<Date.now()){if(token)adminSessions.delete(token);return null;}if(session.role!=='superadmin'){const a=readAdmins().admins.find(x=>x.id===session.adminId&&x.active);if(!a){adminSessions.delete(token);saveAdminSessions();return null;}}return {token,...session};}
function adminCookie(res,token,maxAge){res.setHeader('Set-Cookie',`taallam_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.NODE_ENV==='production'?'; Secure':''}`);}
function requireAdmin(req,res){if(!sessionAdmin(req)){send(res,401,{error:'تسجيل دخول مدير المنصة مطلوب لإدارة المناهج والمحتوى.'});return false;}return true;}
const parentSessions = new Map();
const rateBuckets = new Map();
const RATE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT = 8;
const REGISTER_LIMIT = 5;
function loadSessions(){try{const rows=JSON.parse(fs.readFileSync(sessionsFile,'utf8'));for(const [token,session] of rows)if(session&&session.expires>Date.now())parentSessions.set(token,session);}catch{}}
function saveSessions(){try{writeFileAtomic(sessionsFile,JSON.stringify([...parentSessions.entries()]),{mode:0o600});}catch(e){console.error('Could not persist sessions:',e.message);}}
const TRUST_PROXY_HOPS=Math.max(0,Number.parseInt(process.env.TRUST_PROXY_HOPS??((process.env.RAILWAY_ENVIRONMENT||process.env.RAILWAY_PROJECT_ID)?'1':'0'),10)||0);
function clientIp(req){const direct=String(req.socket.remoteAddress||'unknown');if(!TRUST_PROXY_HOPS)return direct;const xff=String(req.headers['x-forwarded-for']||'').split(',').map(s=>s.trim()).filter(Boolean);if(!xff.length)return direct;return xff[Math.max(0,xff.length-TRUST_PROXY_HOPS)]||direct;}
function rateLimit(req,key,limit){const now=Date.now();const ip=clientIp(req);const id=key+':'+ip;let bucket=rateBuckets.get(id);if(!bucket||bucket.until<=now)bucket={count:0,until:now+RATE_WINDOW_MS};bucket.count++;rateBuckets.set(id,bucket);if(rateBuckets.size>5000){for(const [k,v] of rateBuckets)if(v.until<=now)rateBuckets.delete(k);}return {allowed:bucket.count<=limit, retryAfter:Math.max(1,Math.ceil((bucket.until-now)/1000))};}
function sameOrigin(req){const origin=req.headers.origin;if(!origin)return true;try{return new URL(origin).host===String(req.headers.host||'');}catch{return false;}}
loadSessions();
loadAdminSessions();
loadTeacherSessions();
if(!fs.existsSync(teachersFile))writeFileAtomic(teachersFile,JSON.stringify({teachers:[]},null,2),{mode:0o600});
if(!fs.existsSync(adminsFile))writeFileAtomic(adminsFile,JSON.stringify({admins:[]},null,2),{mode:0o600});
if(!fs.existsSync(auditFile))writeFileAtomic(auditFile,'[]',{mode:0o600});
if(!fs.existsSync(schoolsFile))saveJsonFile(schoolsFile,{schools:[]});
if(!fs.existsSync(schoolPostsFile))saveJsonFile(schoolPostsFile,{posts:[]});
if(!fs.existsSync(schoolFeesFile))saveJsonFile(schoolFeesFile,{types:[],payments:[]});
if(!fs.existsSync(feedbackFile))saveJsonFile(feedbackFile,{items:[]});
if(!fs.existsSync(schoolMembersFile))saveJsonFile(schoolMembersFile,{members:[]});
if(!fs.existsSync(schoolArchivesFile))saveJsonFile(schoolArchivesFile,{archives:[]});
try{for(const [token,session] of readJsonFile(schoolMemberSessionsFile,[]))if(session&&session.expires>Date.now())schoolMemberSessions.set(token,session);}catch{}
if(!fs.existsSync(settingsFile))saveJsonFile(settingsFile,readPlatformSettings());
try{for(const [token,session] of readJsonFile(schoolSessionsFile,[]))if(session&&session.expires>Date.now())schoolSessions.set(token,session);}catch{}
if (!fs.existsSync(accountsFile)) writeFileAtomic(accountsFile, JSON.stringify({accounts:[]}, null, 2));
function readAccounts(){try{const d=JSON.parse(fs.readFileSync(accountsFile,'utf8'));d.accounts ||= [];return d;}catch{return {accounts:[]};}}
function saveAccounts(d){writeFileAtomic(accountsFile,JSON.stringify(d,null,2),{mode:0o600});}
function sessionParent(req){const raw=String(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('taallam_session='));const token=raw?raw.slice('taallam_session='.length):'';const session=parentSessions.get(token);if(!session||session.expires<Date.now()){if(token)parentSessions.delete(token);return null;}return {token,...session};}
function cookie(res,token,maxAge){res.setHeader('Set-Cookie',`taallam_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${process.env.NODE_ENV==='production'?'; Secure':''}`);}

fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(dataFile)) writeFileAtomic(dataFile, JSON.stringify({ books: [], plans: [], lessons: [], units: [] }, null, 2));
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.webmanifest':'application/manifest+json; charset=utf-8', '.svg':'image/svg+xml' };
function readData(){ try { const d=JSON.parse(fs.readFileSync(dataFile,'utf8')); d.books ||= []; d.plans ||= []; d.lessons ||= []; d.units ||= []; return d; } catch { return {books:[],plans:[],lessons:[],units:[]}; } }
function send(res, status, body, type='application/json; charset=utf-8'){res.writeHead(status, {'Content-Type':type,'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':'camera=(), geolocation=(), payment=()','Cache-Control':'no-store','Cross-Origin-Resource-Policy':'same-origin'});if(Buffer.isBuffer(body)||typeof body==='string'){res.end(body);}else{res.end(JSON.stringify(body));}}
const maxPdfUploadMb = Math.max(1, Math.min(1024, Number.parseInt(process.env.MAX_PDF_UPLOAD_MB || '300', 10) || 300));
function readRaw(req, max=maxPdfUploadMb*1024*1024){return new Promise((resolve,reject)=>{const chunks=[];let size=0;let failed=false;req.on('data',chunk=>{if(failed)return;size+=chunk.length;if(size>max){failed=true;reject(Object.assign(new Error(`حجم الملف يتجاوز الحد المسموح (${Math.floor(max/(1024*1024))} ميغابايت).`),{status:413}));req.pause();return;}chunks.push(chunk);});req.on('end',()=>{if(!failed)resolve(Buffer.concat(chunks));});req.on('error',err=>{if(!failed)reject(err);});});}
async function extractPdfContent(buffer) {
  const parsed = await pdfParse(buffer);
  let text = normalizeCurriculumText(parsed.text || '');
  let ocrUsed = false;
  let ocrPages = 0;
  // Scanned books often have no text layer. Use optional system OCR when deployed with
  // Poppler + Tesseract Arabic/English language data; never silently claim OCR succeeded.
  if (text.length < 40) {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taallam-pdf-'));
    try {
      const input = path.join(tempDir, 'source.pdf');
      fs.writeFileSync(input, buffer, { flag: 'wx' });
      const totalPages = Math.max(1, Number(parsed.numpages) || 1);
      const pagesToOcr = Math.min(totalPages, 100);
      await execFileAsync('pdftoppm', ['-f', '1', '-l', String(pagesToOcr), '-r', '120', '-jpeg', input, path.join(tempDir, 'page')], { timeout: 180000, maxBuffer: 2 * 1024 * 1024 });
      const images = fs.readdirSync(tempDir).filter(n => /^page-\d+\.jpg$/i.test(n)).sort((a,b) => Number(a.match(/(\d+)/)[1])-Number(b.match(/(\d+)/)[1]));
      const chunks = [];
      for (const imageName of images) {
        const { stdout } = await execFileAsync('tesseract', [path.join(tempDir, imageName), 'stdout', '-l', 'ara+eng', '--psm', '3'], { timeout: 45000, maxBuffer: 2 * 1024 * 1024 });
        if (stdout && stdout.trim()) chunks.push(stdout.trim());
        ocrPages++;
      }
      text = normalizeCurriculumText(chunks.join('\n\n'));
      ocrUsed = text.length >= 40;
      if (text.length < 40) throw new Error('PDF_TEXT_NOT_EXTRACTABLE');
    } catch (error) {
      if (error.message === 'PDF_TEXT_NOT_EXTRACTABLE') throw error;
      const e = new Error('تعذّر استخراج النص من الملف. للكتب المصوّرة ثبّت pdftoppm وTesseract مع حزم اللغة العربية والإنجليزية على الخادم، ثم أعد المحاولة.');
      e.code = 'OCR_UNAVAILABLE'; throw e;
    } finally { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {} }
  }
  return { parsed, text, ocrUsed, ocrPages, ocrPartial: ocrUsed && ocrPages < (Number(parsed.numpages) || ocrPages) };
}

function inferOutline(text){const lines=text.split(/\r?\n/).map(x=>x.trim()).filter(x=>x.length>2&&x.length<140);const re=/^(?:الوحدة|الفصل|الباب|الدرس|الموضوع|Unit|Chapter|Lesson)\s*[:：-]?\s*[\d٠-٩]*\s*.*$/i;const heads=[];for(const line of lines){if(re.test(line)||/^(?:الوحدة|الفصل|الباب|الدرس|الموضوع)\s+[\d٠-٩]+/.test(line)){if(!heads.includes(line))heads.push(line);}}return heads.slice(0,100).map((title,i)=>({id:'outline-'+i,title}));}
function readBody(req, max=100000){return new Promise((resolve,reject)=>{let body='';req.on('data',chunk=>{body+=chunk;if(body.length>max){reject(Object.assign(new Error('البيانات كبيرة جدًا'),{status:413}));req.destroy();}});req.on('end',()=>{try{resolve(JSON.parse(body||'{}'));}catch{reject(Object.assign(new Error('صيغة البيانات غير صحيحة'),{status:400}));}});req.on('error',reject);});}
const systemPrompt = `أنت المعلّم المساعد في منصة «تعلّم مع الهيثم»، تخاطب طفلًا عربيًا بلطف واحترام. اشرح بالعربية الواضحة البسيطة المناسبة للأطفال، ويمكنك فهم اللهجة اليمنية والرد بفصحى سهلة من دون السخرية من لهجة الطفل. اشرح خطوة بخطوة، استخدم مثالًا صغيرًا ثم اسأل سؤالًا يساعد على الفهم. لا تدّع أنك إنسان. لا تطلب الاسم الكامل أو العنوان أو رقم الهاتف أو كلمة المرور أو أي بيانات شخصية. لا تقدّم محتوى جنسيًا أو عنيفًا أو خطيرًا أو إرشادات لإيذاء النفس أو الآخرين. إذا ذكر الطفل خطرًا مباشرًا أو أذى أو إساءة، شجعه على إخبار ولي أمر موثوق أو معلّم موثوق فورًا، وفي حالة الطوارئ اطلب مساعدة شخص بالغ قريب. إذا لم تعرف إجابة مؤكدة فقل ذلك بوضوح ولا تخترع. لا تقدّم تشخيصًا طبيًا أو نصائح قانونية أو مالية عالية المخاطر. اجعل الرد مختصرًا ومشجعًا.`;
async function teacherAnswer(question, history=[], curriculum=null){
  const key=process.env.AI_API_KEY;
  if(!key) return {configured:false, grounded:Boolean(curriculum), bookTitle:curriculum?.book?.title||null, answer:curriculum?'الكتاب «'+curriculum.book.title+'» محدد، لكن خدمة المعلّم الذكي غير مفعّلة على الخادم؛ لذلك لا أريد عرض كلمات مستخرجة من PDF وكأنها شرح صحيح. فعّل AI_API_KEY في إعدادات الاستضافة، ثم أعد طلب الشرح.':'خدمة المعلّم الذكي غير مفعّلة على الخادم.'};
  const base=(process.env.AI_BASE_URL||'https://api.openai.com/v1').replace(/\/$/,'');
  const model=process.env.AI_MODEL||'gpt-4o-mini';
  const groundedRules=curriculum?`\n\nقيد تعليمي إلزامي: افهم سؤال الطفل بصيغته الطبيعية واللهجة ولا تشترط تطابق كلمات السؤال مع نص الكتاب. أجب اعتمادًا على المقتطف من الكتاب المحدد، ولا تنسب للكتاب معلومات غير موجودة فيه. إذا طلب شرحًا عامًا، ابدأ بشرح تمهيدي مما يظهر في المقتطف؛ وإذا لم يكفِ النص فاطلب منه عنوان الدرس أو توضيحًا بلطف. اجعل الشرح مناسبًا للصوت: جمل قصيرة، خطوة خطوة، مع مثال محسوس وأسئلة بسيطة عند الحاجة.\nالكتاب: ${curriculum.book.title} | الصف: ${curriculum.book.grade||'غير محدد'} | المادة: ${curriculum.book.subject||'غير محددة'}.\nمقتطف نص الكتاب:\n${curriculum.excerpt}`:'';
  const messages=[{role:'system',content:systemPrompt+groundedRules}];
  for(const item of history.slice(-6)) if(item && ['user','assistant'].includes(item.role) && typeof item.content==='string') messages.push({role:item.role,content:item.content.slice(0,1500)});
  messages.push({role:'user',content:question.slice(0,2000)});
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),25000);
  try{
    const r=await fetch(base+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},body:JSON.stringify({model,messages,temperature:0.55,max_tokens:700}),signal:controller.signal});
    const payload=await r.json().catch(()=>({}));
    if(!r.ok){console.error('AI provider returned status',r.status);throw new Error('تعذّر الوصول إلى المعلّم الذكي الآن. حاول بعد قليل.');}
    const answer=payload.choices?.[0]?.message?.content;
    if(typeof answer!=='string'||!answer.trim()) throw new Error('وصل رد غير مكتمل. حاول مرة أخرى.');
    return {configured:true,answer:answer.trim().slice(0,5000)};
  }catch(e){if(e.name==='AbortError')throw new Error('تأخر الرد. حاول مرة أخرى.');throw e;}finally{clearTimeout(timer);}
}
// ===================== Student learning API (public + rate-limited) =====================
const bookCache=new Map();
function preparedBook(book){
  const raw=String(book.extractedText||''); const key=book.id+':'+raw.length; let v=bookCache.get(key);
  if(!v){const fx=learn.prepareBookText(raw); v={text:fx.text,fixed:fx.fixed,outline:learn.buildOutline(fx.text)}; bookCache.set(key,v); if(bookCache.size>40)bookCache.delete(bookCache.keys().next().value);}
  return v;
}
let aiDay={d:'',n:0};
async function aiChat(messages,{temperature=0.4,max_tokens=1000,timeoutMs=30000}={}){
  const key=process.env.AI_API_KEY;
  if(!key){const e=new Error('المعلّم الذكي غير مفعّل على الخادم.');e.code='NO_AI';throw e;}
  const today=new Date().toISOString().slice(0,10); if(aiDay.d!==today)aiDay={d:today,n:0};
  if(aiDay.n>=Number(process.env.AI_DAILY_LIMIT||3000)){const e=new Error('وصلت المنصة إلى الحد اليومي لاستخدام المعلّم الذكي. حاول غدًا.');e.status=429;throw e;}
  aiDay.n++;
  const base=(process.env.AI_BASE_URL||'https://api.openai.com/v1').replace(/\/$/,''); const model=process.env.AI_MODEL||'gpt-4o-mini';
  if(/generativelanguage\.googleapis\.com/.test(base))max_tokens=Math.min(8000,max_tokens*3); // Gemini 2.5 models spend part of the budget on hidden reasoning
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const r=await fetch(base+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},body:JSON.stringify({model,messages,temperature,max_tokens}),signal:controller.signal});
    const payload=await r.json().catch(()=>({}));
    if(!r.ok){console.error('AI provider status',r.status,JSON.stringify(payload).slice(0,300));const hints={400:'رفض المزوّد الطلب؛ تحقق من AI_MODEL.',401:'مفتاح AI_API_KEY غير صحيح.',403:'مفتاح AI_API_KEY غير مفعّل أو غير مسموح له.',404:'اسم النموذج AI_MODEL أو عنوان AI_BASE_URL غير صحيح.',429:'تجاوزت حدّ الاستخدام المجاني لدى المزوّد؛ انتظر قليلًا.'};const e=new Error('تعذّر الوصول إلى المعلّم الذكي ('+r.status+'): '+(hints[r.status]||'خطأ من المزوّد.'));e.providerStatus=r.status;throw e;}
    const out=payload.choices?.[0]?.message?.content;
    if(typeof out!=='string'||!out.trim())throw new Error('وصل رد فارغ من المزوّد (قد يكون النموذج يستهلك الحد في التفكير الداخلي). جرّب نموذجًا آخر في AI_MODEL.');
    return out.trim();
  }catch(e){if(e.name==='AbortError')throw new Error('تأخر الرد. حاول مرة أخرى.');throw e;}finally{clearTimeout(timer);}
}
function parseJsonLoose(raw){
  let s=String(raw).trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try{return JSON.parse(s);}catch{}
  const a=s.indexOf('{'),b=s.lastIndexOf('}'); if(a>=0&&b>a){try{return JSON.parse(s.slice(a,b+1));}catch{}}
  return null;
}
const LEARN_BASE_RULES='أنت «الهيثم»، معلّم عربي بارع ولطيف يشرح لطلاب المدارس. مهمتك أن تُفهِم الطالب درسه الموجود في نص الكتاب المرفق. لا تقرأ النص كما هو ولا تنقله جملة بجملة؛ بل اشرحه بأسلوبك كمعلّم يحدّث طلابه (مثل: «انظر يا صديقي ماذا قال النبي صلى الله عليه وسلم…»)، وبسّط الكلمات الصعبة، وأعطِ أمثلة من حياة الطالب. التزم بموضوع الكتاب ومعانيه: لا تغيّر المعنى ولا تضف أحكامًا أو معلومات جديدة غير موجودة في الكتاب، ويجوز فقط التوضيح والتمثيل المرتبط بالموضوع نفسه. وحين تذكر مثالًا فابدأه بكلمة «مثلًا» (كأن تقول: مثلًا، إذا قام طالب بكسر قلم زميله فعليه أن يخبره بذلك). إذا ذكرت النبي فاكتب «صلى الله عليه وسلم» كاملة ولا تستخدم الرموز المختصرة. في الفقرة الأخيرة اذكر النص الأصلي المهم من الكتاب (آية أو حديثًا أو تعريفًا أو قاعدة) بادئًا بعبارة «نص الكتاب:» ثم النص حرفيًا كما ورد في المقتطف دون أي تغيير. وإذا كان القسم مسألة أو قاعدة في الرياضيات أو العلوم فحلّها وفسّرها خطوة خطوة بأعداد وأمثلة محسوسة (كتفاحات نطرح منها أو نضيف إليها)، مع توضيح كل عملية قبل ذكر الناتج. لا تطلب أي بيانات شخصية، والتزم بمحتوى مناسب للأطفال.';
function stageStyle(stage){return stage==='kids'
  ?'الطالب في الصفوف الأولى من الابتدائية: استخدم جملًا قصيرة جدًا وكلمات سهلة ومثالًا من حياة الطفل، وابدأ بترحيب قصير، واجعل في الشرح سؤالًا بسيطًا يشجّعه على التفكير. يمكنك استخدام رمز تعبيري واحد في بعض الفقرات فقط.'
  :'الطالب يقرأ جيدًا: اشرح بوضوح وتنظيم مع أمثلة مناسبة، وابدأ بالفكرة العامة ثم التفاصيل، ثم اختم بخلاصة قصيرة قبل «نص الكتاب:».';}
const FORMAT_RULE='اكتب نصًا عاديًا فقط دون رموز تنسيق (لا نجوم ولا # ولا قوائم مرقمة ولا جداول). قسّم الكلام إلى فقرات قصيرة يفصل بينها سطر فارغ، وكل فقرة من جملة إلى ثلاث جمل ليقرأها الطالب بصوت عالٍ.';
const TEACH_TASKS={
  explain:'اشرح القسم التالي شرحًا وافيًا ومبسّطًا كأنك تعلّمه لطلابك (لا تنقل النص): من 6 إلى 9 فقرات قصيرة، ثم فقرة أخيرة تبدأ بـ«نص الكتاب:».',
  simple:'بسّط هذا القسم لطالب صغير: أعد شرح الفكرة بكلمات أسهل بكثير وبأمثلة جديدة من حياته، ولا تُعد نص الدرس ولا جمله. من 4 إلى 6 فقرات قصيرة، ثم فقرة أخيرة تبدأ بـ«نص الكتاب:».',
  summary:'لخّص الدرس تلخيصًا شارحًا كما يُلخَّص أي كتاب: ابدأ بفقرة تقول عمّا يتحدث الدرس، ثم اذكر أهم النقاط (من 4 إلى 6 فقرات قصيرة) بأسلوبك وكلماتك دون نسخ جمل الكتاب، ثم فقرة أخيرة تبدأ بـ«نص الكتاب:».',
  ask:'أجب عن سؤال الطالب إجابة مباشرة ومحددة مستخلصة من النص: ابدأ بالإجابة نفسها (كالتعريف)، ثم اشرح باختصار ما ورد في النص عنها من معانٍ وأمثلة وأحاديث، ولا تشرح الدرس كاملًا. من 2 إلى 5 فقرات قصيرة، وإن وُجد نص مهم يخص السؤال فاختم بفقرة تبدأ بـ«نص الكتاب:».'
};

function learnBook(bookId){
  const book=readData().books.find(b=>b.id===String(bookId||'')&&b.extractedText&&b.extractedText.length>100);
  return book?{book,prep:preparedBook(book)}:null;
}
function learnResolve(body){
  const sectionId=String(body.sectionId||'').slice(0,20); const query=String(body.query||body.question||'').slice(0,300);
  if(String(body.bookId||'')==='__all__'){
    const terms=learn.queryTerms(query); const books=readData().books.filter(b=>b.extractedText&&b.extractedText.length>100).slice(0,100);
    if(!books.length)return {status:404,error:'لا توجد كتب جاهزة للتعلّم بعد.'};
    const ranked=books.map(book=>{const prep=preparedBook(book);const chunks=prep.text.split(/(?<=[.!؟])\s+|\n+/).filter(x=>x.trim().length>35);const scored=chunks.map((text,index)=>({text,index,score:terms.reduce((n,t)=>n+(text.toLowerCase().includes(t.toLowerCase())?1:0),0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,5);return {book,prep,scored,score:scored.reduce((n,x)=>n+x.score,0)};}).sort((a,b)=>b.score-a.score);
    const selected=ranked.filter(x=>x.scored.length).slice(0,5);
    if(!selected.length)return {status:404,error:'لم أجد نصًا مرتبطًا بسؤالك في الكتب المتاحة. جرّب ذكر اسم الدرس أو موضوع السؤال.'};
    const text=selected.map(x=>'[الكتاب: '+String(x.book.title||'كتاب')+' | المادة: '+String(x.book.subject||'غير محددة')+' | الصف: '+String(x.book.grade||'غير محدد')+']\n'+x.scored.map(c=>c.text).join('\n')).join('\n\n').slice(0,12000);
    return {lb:{book:{id:'__all__',title:'كل الكتب'},prep:{text,outline:{}}},sec:{id:'all-search',title:query||'سؤال من جميع الكتب',kind:'search',text,notFound:false}};
  }
  const lb=learnBook(body.bookId); if(!lb)return {status:404,error:'لم أجد هذا الكتاب. اختر كتابًا من القائمة.'};
  const sec=learn.resolveSection(lb.prep.text,lb.prep.outline,{sectionId,query});
  if(!sec)return {status:404,error:'لم أجد في الكتاب ما يخص طلبك. جرّب اختيار الدرس من القائمة أو اكتب اسم الدرس.'};
  if(sec.notFound){const names={unit:'الوحدة',lesson:'الدرس'};return {status:404,error:'لم أجد «'+names[sec.ref.kind]+' رقم '+sec.ref.num+'» في هذا الكتاب. اختر من القائمة.'};}
  if(sec.unreadable||sec.text.length<40)return {status:422,error:'النص المستخرج من هذا الجزء غير واضح. اطلب من مدير المنصة إعادة رفع الكتاب بجودة أفضل.'};
  return {lb,sec};
}
function splitSlides(answer,stage){
  const cleaned=learn.cleanForSpeech(answer).replace(/\n{3,}/g,'\n\n');
  let paras=cleaned.split(/\n{2,}/).map(s=>s.replace(/\n/g,' ').trim()).filter(Boolean);
  if(paras.length<2)paras=learn.slidesFromText(cleaned,8,stage==='kids'?160:240);
  return paras.slice(0,12).map(s=>({t:s.slice(0,700),src:/^نص الكتاب\s*[:：]/.test(s)}));
}
const plainSlides=list=>list.map(s=>({t:s,src:false}));
const ttsCache=new Map(); let ttsDay={d:'',n:0};
function ttsConfigured(){return process.env.TTS_ENABLED!=='0'&&Boolean(process.env.TTS_API_KEY||process.env.AI_API_KEY);}
function ttsProvider(){
  const forced=String(process.env.TTS_PROVIDER||'').toLowerCase(); if(forced==='gemini'||forced==='openai')return forced;
  return /generativelanguage\.googleapis\.com/.test((process.env.TTS_BASE_URL||'')+(process.env.AI_BASE_URL||''))?'gemini':'openai';
}
// Gemini returns raw 16-bit mono PCM (base64); browsers need a WAV container to play it.
function pcmToWav(pcm,rate){
  const h=Buffer.alloc(44); h.write('RIFF',0); h.writeUInt32LE(36+pcm.length,4); h.write('WAVEfmt ',8); h.writeUInt32LE(16,16); h.writeUInt16LE(1,20); h.writeUInt16LE(1,22);
  h.writeUInt32LE(rate,24); h.writeUInt32LE(rate*2,28); h.writeUInt16LE(2,32); h.writeUInt16LE(16,34); h.write('data',36); h.writeUInt32LE(pcm.length,40);
  return Buffer.concat([h,pcm]);
}
async function synthesize(text,signal){
  const key=process.env.TTS_API_KEY||process.env.AI_API_KEY;
  if(ttsProvider()==='gemini'){
    const model=process.env.TTS_MODEL||'gemini-2.5-flash-preview-tts',voice=process.env.TTS_VOICE||'Kore';
    const base=(process.env.TTS_BASE_URL||'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/,'');
    const r=await fetch(base+'/models/'+encodeURIComponent(model)+':generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key},signal,
      body:JSON.stringify({contents:[{parts:[{text}]}],generationConfig:{responseModalities:['AUDIO'],speechConfig:{voiceConfig:{prebuiltVoiceConfig:{voiceName:voice}}}}})});
    if(!r.ok){console.error('TTS (gemini) provider status',r.status);return null;}
    const j=await r.json().catch(()=>null); const part=j?.candidates?.[0]?.content?.parts?.find(x=>x.inlineData?.data);
    if(!part){console.error('TTS (gemini) returned no audio');return null;}
    const rate=Number((/rate=(\d+)/.exec(part.inlineData.mimeType||'')||[])[1])||24000;
    return {buf:pcmToWav(Buffer.from(part.inlineData.data,'base64'),rate),type:'audio/wav',id:'gemini|'+model+'|'+voice};
  }
  const model=process.env.TTS_MODEL||'tts-1',voice=process.env.TTS_VOICE||'alloy';
  const base=(process.env.TTS_BASE_URL||process.env.AI_BASE_URL||'https://api.openai.com/v1').replace(/\/$/,'');
  const r=await fetch(base+'/audio/speech',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},body:JSON.stringify({model,voice,input:text,response_format:'mp3'}),signal});
  if(!r.ok){console.error('TTS provider status',r.status);return null;}
  return {buf:Buffer.from(await r.arrayBuffer()),type:r.headers.get('content-type')||'audio/mpeg',id:'openai|'+model+'|'+voice};
}
async function handleSpeak(res,body){
  if(!ttsConfigured())return send(res,503,{error:'الصوت السحابي غير مفعّل على الخادم.'});
  const text=learn.cleanForSpeech(String(body.text||'')).slice(0,800);
  if(text.length<2)return send(res,400,{error:'لا يوجد نص للقراءة.'});
  const key=crypto.createHash('sha1').update(ttsProvider()+'|'+(process.env.TTS_MODEL||'')+'|'+(process.env.TTS_VOICE||'')+'|'+text).digest('hex');
  const hit=ttsCache.get(key);
  if(hit){ttsCache.delete(key);ttsCache.set(key,hit);return send(res,200,hit.buf,hit.type);}
  const day=new Date().toISOString().slice(0,10); if(ttsDay.d!==day)ttsDay={d:day,n:0};
  if(ttsDay.n+text.length>Number(process.env.TTS_DAILY_CHARS||400000))return send(res,429,{error:'وصل الصوت السحابي إلى حدّه اليومي.'});
  ttsDay.n+=text.length;
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),30000);
  try{
    const out=await synthesize(text,controller.signal);
    if(!out||out.buf.length<100)return send(res,502,{error:'تعذّر توليد الصوت الآن.'});
    ttsCache.set(key,out); if(ttsCache.size>300)ttsCache.delete(ttsCache.keys().next().value);
    return send(res,200,out.buf,out.type);
  }catch(e){return send(res,502,{error:e.name==='AbortError'?'تأخر توليد الصوت.':'تعذّر توليد الصوت الآن.'});}finally{clearTimeout(timer);}
}
async function handleLearn(req,res,pathname){
  try{
    const limits={'/api/learn/speak':300,'/api/learn/teach':60,'/api/learn/quiz':30,'/api/learn/grade':150,'/api/learn/library':200,'/api/learn/outline':300,'/api/learn/status':300};
    if(!(pathname in limits))return send(res,404,{error:'غير موجود'});
    const rl=rateLimit(req,'learn:'+pathname,limits[pathname]);
    if(!rl.allowed){res.setHeader('Retry-After',String(rl.retryAfter));return send(res,429,{error:'طلبات كثيرة في وقت قصير. انتظر قليلًا ثم حاول مرة أخرى.'});}
    if(req.method==='GET'&&pathname==='/api/learn/status')return send(res,200,{ai:Boolean(process.env.AI_API_KEY),tts:ttsConfigured()});
    if(req.method==='GET'&&pathname==='/api/learn/library'){
      const books=readData().books.filter(b=>b.extractedText&&b.extractedText.length>100).slice(0,100).map(b=>({id:b.id,title:String(b.title||'كتاب').slice(0,120),grade:b.grade||'',subject:b.subject||'',term:b.term||'',pages:b.pages||0}));
      return send(res,200,{books});
    }
    if(req.method==='GET'&&pathname==='/api/learn/outline'){
      const id=new URL(req.url,'http://x').searchParams.get('bookId'); const lb=learnBook(id);
      if(!lb)return send(res,404,{error:'لم أجد هذا الكتاب.'});
      return send(res,200,{title:lb.book.title,...learn.outlineForClient(lb.prep.outline)});
    }
    if(req.method!=='POST')return send(res,405,{error:'طريقة غير مسموحة'});
    const body=await readBody(req,16000);
    if(pathname==='/api/learn/speak')return handleSpeak(res,body);
    const stage=body.stage==='kids'?'kids':'reader';
    if(pathname==='/api/learn/teach'){
      let mode=Object.keys(TEACH_TASKS).includes(body.mode)?body.mode:'explain';
      if(mode==='ask'&&!String(body.question||'').trim())return send(res,400,{error:'اكتب سؤالك أولًا.'});
      const qText=String(body.query||body.question||'');
      if(mode==='explain'&&!body.sectionId){if(/(?:لخّص|لخص|ملخص|تلخيص)/.test(qText))mode='summary';else if(/(?:بسّط|بسط|ابسط|أبسط|تبسيط)/.test(qText))mode='simple';}
      const r=learnResolve(body); if(r.error)return send(res,r.status,{error:r.error});
      const {lb,sec}=r;
      if(sec.kind==='search'&&mode==='explain'){mode='ask';body.question=qText;} // a topic question wants a direct answer, not a whole-lesson explanation
      const base={title:sec.title,sectionId:/^[ulp]\d+$/.test(sec.id)?sec.id:null,bookTitle:lb.book.title,mode};
      let slides,configured=true,notice='';
      try{
        const sys=LEARN_BASE_RULES+'\n'+stageStyle(stage)+'\n'+FORMAT_RULE;
        const user=TEACH_TASKS[mode]+(mode==='ask'?'\nسؤال الطالب: '+String(body.question).slice(0,500):'')+'\n\nعنوان القسم: '+sec.title+'\nالكتاب: '+lb.book.title+' | الصف: '+(lb.book.grade||'غير محدد')+'\nنص الكتاب:\n'+sec.text;
        const out=await aiChat([{role:'system',content:sys},{role:'user',content:user}],{temperature:0.4,max_tokens:stage==='kids'?1400:1900});
        slides=splitSlides(out,stage);
      }catch(e){
        if(e.code!=='NO_AI'&&e.status===429)throw e;
        configured=e.code!=='NO_AI'?true:false;
        slides=plainSlides(mode==='summary'?learn.simpleSummary(sec.text,5):learn.slidesFromText(sec.text,8,stage==='kids'?160:240));
        notice=e.code==='NO_AI'?'هذا نص الكتاب نفسه، لأن المعلّم الذكي غير مفعّل على الخادم.':'تعذّر الشرح الذكي الآن، فهذا نص الكتاب نفسه. السبب: '+(e.message||'غير معروف');
        console.error('learn/teach fallback:',e.message);
      }
      if(!slides.length)return send(res,422,{error:'لم أستطع تجهيز الشرح لهذا الجزء.'});
      return send(res,200,{...base,slides,configured,notice});
    }
    if(pathname==='/api/learn/quiz'){
      const r=learnResolve(body); if(r.error)return send(res,r.status,{error:r.error});
      const {lb,sec}=r; const count=Math.max(3,Math.min(8,Number(body.count)||5)); let questions=[],configured=true,notice='';
      const avoid=(Array.isArray(body.avoid)?body.avoid:[]).map(x=>String(x).trim().slice(0,140)).filter(Boolean).slice(0,15);
      try{
        const kinds=stage==='kids'?'كلها اختيار من متعدد بثلاثة خيارات قصيرة جدًا وسهلة.':'كلها اختيار من متعدد بثلاثة خيارات، ما عدا السؤال الأخير فيكون سؤالًا يُجاب عنه بجملة قصيرة (type: write) مع إجابة نموذجية.';
        const prompt='أنشئ '+count+' أسئلة لاختبار فهم الطالب اعتمادًا حصريًا على النص أدناه. '+stageStyle(stage)+' '+kinds+' لا تضف معلومات من خارج النص.'+(avoid.length?' هذه أسئلة سبق أن سُئلها الطالب فلا تكررها ولا تعد صياغتها، واختر جوانب أخرى من النص: '+avoid.map(a=>'«'+a+'»').join(' ')+'.':' نوّع الأسئلة بين التعريفات والأمثلة والتطبيق.')+' أخرج JSON فقط بلا أي شرح خارجه بهذا الشكل: {"questions":[{"type":"mcq","q":"...","options":["...","...","..."],"answer":0,"why":"سبب قصير للإجابة الصحيحة"},{"type":"write","q":"...","model":"إجابة نموذجية قصيرة"}]} حيث answer فهرس الإجابة الصحيحة يبدأ من صفر.\nعنوان القسم: '+sec.title+'\nالنص:\n'+sec.text.slice(0,7000);
        const raw=await aiChat([{role:'system',content:LEARN_BASE_RULES},{role:'user',content:prompt}],{temperature:0.7,max_tokens:1400});
        const parsed=parseJsonLoose(raw);
        questions=(Array.isArray(parsed?.questions)?parsed.questions:[]).slice(0,8).map(q=>{
          const text=String(q.q||q.question||'').trim().slice(0,400);
          if(q.type==='write'&&text&&String(q.model||'').trim())return {type:'write',q:text,model:String(q.model).trim().slice(0,400)};
          const options=(Array.isArray(q.options)?q.options:[]).slice(0,4).map(o=>String(o).trim().slice(0,200));
          const answer=Number(q.answer);
          if(text&&options.length>=2&&options.every(Boolean)&&Number.isInteger(answer)&&answer>=0&&answer<options.length)return {type:'mcq',q:text,options,answer,why:String(q.why||'').trim().slice(0,300)};
          return null;
        }).filter(Boolean);
      }catch(e){
        if(e.status===429)throw e;
        notice=e.code==='NO_AI'?'الأسئلة هنا مولّدة آليًا من جمل الكتاب لأن المعلّم الذكي غير مفعّل.':'تعذّر توليد أسئلة ذكية الآن، فهذه أسئلة آلية من جمل الكتاب.';
        configured=e.code!=='NO_AI';
      }
      if(!questions.length){questions=learn.makeCloze(sec.text,count);if(!notice)notice='هذه أسئلة آلية من جمل الكتاب.';}
      if(!questions.length)return send(res,422,{error:'لم أستطع تجهيز أسئلة لهذا الجزء. جرّب جزءًا آخر.'});
      return send(res,200,{title:sec.title,sectionId:sec.id,bookTitle:lb.book.title,questions,configured,notice});
    }
    if(pathname==='/api/learn/grade'){
      const q=String(body.q||'').slice(0,400),model=String(body.model||'').slice(0,400),answer=String(body.answer||'').trim().slice(0,600);
      if(!q||!model)return send(res,400,{error:'بيانات السؤال ناقصة.'});
      if(answer.length<2)return send(res,200,{score:0,feedback:'اكتب إجابتك أولًا.'});
      try{
        const raw=await aiChat([{role:'system',content:'أنت معلّم لطيف تصحح إجابة طالب. قارن إجابته بالإجابة النموذجية بالمعنى لا بالحرف. أخرج JSON فقط: {"score":0 أو 1 أو 2,"feedback":"جملة تشجيع قصيرة وتوضيح ما ينقص إن وُجد"} حيث 2 صحيحة و1 صحيحة جزئيًا و0 خاطئة.'},{role:'user',content:'السؤال: '+q+'\nالإجابة النموذجية: '+model+'\nإجابة الطالب: '+answer}],{temperature:0.1,max_tokens:200,timeoutMs:20000});
        const g=parseJsonLoose(raw); const score=Number(g?.score);
        if([0,1,2].includes(score))return send(res,200,{score,feedback:String(g.feedback||'').slice(0,300)});
      }catch(e){if(e.status===429)throw e;}
      const mt=learn.queryTerms(model),at=new Set(learn.queryTerms(answer)); const hit=mt.length?mt.filter(w=>[...at].some(a=>a.includes(w)||w.includes(a))).length/mt.length:0;
      const score=hit>=0.6?2:hit>=0.3?1:0;
      return send(res,200,{score,feedback:score===2?'أحسنت! إجابتك قريبة من إجابة الكتاب.':'الإجابة في الكتاب: '+model,approximate:true});
    }
    return send(res,404,{error:'غير موجود'});
  }catch(e){return send(res,e.status||502,{error:e.message||'تعذّر تنفيذ الطلب الآن.'});}
}

function normalizeCurriculumText(value){
  return String(value||'').replace(/\u0000/g,' ').replace(/\r/g,'\n').replace(/[\t\f\v]+/g,' ')
    .replace(/[ \u00a0]{2,}/g,' ').replace(/\n[ \t]+/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
function curriculumTextQuality(value){
  const text=normalizeCurriculumText(value); const chars=[...text].filter(c=>!/[\s\d٠-٩.,،؛:!?؟()\[\]{}<>«»"'“”‘’ـ+−=/%_*#@|\\-]/u.test(c));
  const arabic=(text.match(/[\u0600-\u06ff]/g)||[]).length; const latin=(text.match(/[A-Za-z]/g)||[]).length;
  const letters=arabic+latin; const words=text.split(/\s+/).filter(Boolean); const shortWords=words.filter(w=>w.length<=1).length;
  const arabicRatio=letters?arabic/letters:0; const letterRatio=text.length?letters/text.length:0;
  const score= text.length>=80 && letterRatio>=0.25 && shortWords/Math.max(1,words.length)<0.48 && (arabicRatio>=0.25 || latin/Math.max(1,letters)>0.7);
  return {ok:score,text,arabicRatio,letterRatio,words:words.length};
}
function curriculumContext(question, bookId){
  const db=readData(); const books=(db.books||[]).filter(b=>b.extractedText && b.extractedText.length>30).map(b=>({...b,extractedText:preparedBook(b).text}));
  const chosen=bookId?books.filter(b=>b.id===bookId):books;
  if(!chosen.length)return null;
  const q=String(question||'').trim();
  // Resolve requests such as "اشرح الدرس الثاني" against headings extracted from the selected book.
  const ordinalWords={'الأول':1,'الاول':1,'الأولى':1,'الاولى':1,'الثاني':2,'الثانية':2,'الثالث':3,'الثالثة':3,'الرابع':4,'الرابعة':4,'الخامس':5,'الخامسة':5,'السادس':6,'السادسة':6,'السابع':7,'السابعة':7,'الثامن':8,'الثامنة':8,'التاسع':9,'التاسعة':9,'العاشر':10,'العاشرة':10};
  const lessonRequest=/(?:درس|الدرس|دروس|lesson)/i.test(q);
  // Arabic word boundaries are not reliable with JavaScript \b; parse ordinals explicitly.
  const ordinalPattern='(?:[0-9٠-٩]+|الأول|الاول|الأولى|الاولى|الثاني|الثانية|الثالث|الثالثة|الرابع|الرابعة|الخامس|الخامسة|السادس|السادسة|السابع|السابعة|الثامن|الثامنة|التاسع|التاسعة|العاشر|العاشرة)';
  const ordinalMatch=q.match(new RegExp('(?:الدرس|درس|lesson)\\s*(?:رقم\\s*)?('+ordinalPattern+')','i'));
  const pageRequest=/صفحة|الصفحة|page/i.test(q);
  if(pageRequest){return {book:chosen[0],excerpt:'',matched:false,reason:'page-index-unavailable'};}
  if(lessonRequest&&ordinalMatch){
    const raw=ordinalMatch[1]; const num=/^[0-9٠-٩]+$/.test(raw)?Number(raw.replace(/[٠-٩]/g,d=>'٠١٢٣٤٥٦٧٨٩'.indexOf(d))):ordinalWords[raw];
    for(const book of chosen){
      const text=normalizeCurriculumText(book.extractedText);
      const heads=inferOutline(text).filter(h=>/^(?:الدرس|درس|Lesson)(?:\s|[:：-]|[0-9٠-٩])/i.test(h.title));
      if(num&&heads.length>=num){
        const title=heads[num-1].title; const at=text.indexOf(title); const next=heads[num]?.title; const nextAt=next?text.indexOf(next,at+title.length):-1;
        const excerpt=text.slice(at,nextAt>at?nextAt:Math.min(text.length,at+9000)).trim().slice(0,6500);
        if(excerpt.length>40 && curriculumTextQuality(excerpt).ok)return {book,excerpt,matched:true,lessonTitle:title,lessonNumber:num};
      }
    }
    return {book:chosen[0],excerpt:'',matched:false,reason:'lesson-not-found'};
  }
  const terms=q.toLowerCase().replace(/[^\u0600-\u06ff\w\s]/g,' ').split(/\s+/).filter(w=>w.length>2&&!['كيف','ماذا','لماذا','اشرح','لي','من','الى','على','هذا','هذه','الذي','التي','عن','في','هل','أريد','اريد'].includes(w));
  let best=null;
  for(const book of chosen){const chunks=normalizeCurriculumText(book.extractedText).split(/\n{2,}|(?<=[.!؟])\s+/).map(x=>x.trim()).filter(x=>x.length>=45&&curriculumTextQuality(x).ok);for(const text of chunks){const low=text.toLowerCase();let score=0;for(const term of terms)if(low.includes(term))score++;if(score&&(!best||score>best.score))best={book,text,score};}}
  if(!best){
    const book=chosen[0]; const text=normalizeCurriculumText(book.extractedText||'');
    if(!curriculumTextQuality(text.slice(0,Math.min(text.length,5500))).ok)return {book,excerpt:'',matched:false,reason:'text-quality-low'};
    // A generic learning request is not evidence that the first extracted page is the requested lesson.
    // Only permit a general overview when the user explicitly asks for an overview of the whole book.
    if(/(?:ملخص|لخّص|لخص|نظرة عامة|محتوى الكتاب كامل|اشرح الكتاب كامل)/i.test(q)&&text.length>40)
      return {book,excerpt:text.slice(0,5500),matched:true,semanticFallback:true};
    return {book,excerpt:'',matched:false,reason:'topic-not-found'};
  }
  const chunks=normalizeCurriculumText(best.book.extractedText).split(/\n{2,}|(?<=[.!؟])\s+/).map(x=>x.trim()).filter(x=>x.length>=45&&curriculumTextQuality(x).ok);const idx=chunks.indexOf(best.text);const excerpt=[chunks[idx-1],best.text,chunks[idx+1]].filter(Boolean).join('\n').slice(0,3500);
  return {book:best.book,excerpt,matched:true};
}
function demoAnswer(q){const n=q.toLowerCase();if(/نبات|الشمس|ضوء|الماء/.test(n))return 'سؤال جميل! يحتاج النبات إلى الماء والضوء والهواء لينمو. تساعده أشعة الشمس على صنع غذائه، وتمتص الجذور الماء من التربة. ما الأشياء التي يحتاجها النبات؟';if(/جمع|تفاح|٢|2|ثلاث|ثلاثة/.test(n))return 'في الجمع نضمّ الكميات إلى بعضها. مثلًا: تفاحتان ومعهما تفاحة واحدة يصبح لدينا ثلاث تفاحات: ٢ + ١ = ٣. هل تريد أن نجرب مثالًا آخر؟';if(/ألف|حرف|أسد|أرنب/.test(n))return 'حرف الألف هو (أ)، ونسمع صوته في بداية كلمات مثل «أسد» و«أرنب». هل تستطيع ذكر كلمة أخرى تبدأ بحرف الألف؟';return 'وصل سؤالك، لكن المعلّم الذكي غير مفعّل بعد. يمكن تفعيل الإجابات الذكية بإضافة مفتاح خدمة الذكاء الاصطناعي في إعدادات متغيرات البيئة على الخادم. إلى ذلك الحين، جرّب أحد الدروس المتاحة.';}
const server = http.createServer(async (req,res)=>{
  const pathname=decodeURIComponent((req.url||'/').split('?')[0]);
  if(['POST','PUT','PATCH','DELETE'].includes(req.method)&&pathname.startsWith('/api/')&&!sameOrigin(req))return send(res,403,{error:'تم رفض الطلب لأنه لم يأتِ من نفس الموقع.'});
  if(pathname==='/api/admin/login'&&req.method==='POST'){const r=rateLimit(req,'admin-login',5);if(!r.allowed){res.setHeader('Retry-After',String(r.retryAfter));return send(res,429,{error:'محاولات الدخول الإداري كثيرة. انتظر قليلًا.'});}}
  if(req.method==='POST'&&pathname==='/api/admin/login'){try{const b=await readBody(req,5000);const email=String(b.email||'').trim().toLowerCase();const password=String(b.password||'');const expectedEmail=String(process.env.ADMIN_EMAIL||'').trim().toLowerCase();const expectedPassword=String(process.env.ADMIN_PASSWORD||'');let role='',adminId=null,good=false; if(expectedEmail&&expectedPassword&&email===expectedEmail&&password.length===expectedPassword.length)good=crypto.timingSafeEqual(Buffer.from(password),Buffer.from(expectedPassword));if(good){role='superadmin';}else{const a=readAdmins().admins.find(x=>x.email===email&&x.active);const salt=a?.salt||'00000000000000000000000000000000';const expected=a?.hash?Buffer.from(a.hash,'hex'):Buffer.alloc(64);const hash=await scrypt(password,salt,64);good=!!a&&expected.length===hash.length&&crypto.timingSafeEqual(hash,expected);if(good){role='admin';adminId=a.id;}}if(!good)return send(res,401,{error:'بيانات الدخول غير صحيحة أو الحساب غير مفعّل.'});const token=crypto.randomBytes(32).toString('hex');adminSessions.set(token,{role,adminId,email,expires:Date.now()+8*60*60*1000});saveAdminSessions();adminCookie(res,token,8*60*60);audit(email,'admin.login',{role});return send(res,200,{authenticated:true,role,email});}catch(e){return send(res,e.status||400,{error:e.message||'تعذّر تسجيل الدخول الإداري.'});}}
  if(req.method==='POST'&&pathname==='/api/admin/logout'){const a=sessionAdmin(req);if(a){adminSessions.delete(a.token);saveAdminSessions();}adminCookie(res,'',0);return send(res,200,{authenticated:false});}
  if(req.method==='GET'&&pathname==='/api/admin/me'){const a=sessionAdmin(req);return send(res,200,{authenticated:Boolean(a),role:a?.role||null,email:a?.email||null});}
  if(req.method==='GET'&&pathname==='/api/admin/admins'){const ss=sessionAdmin(req);if(!ss)return send(res,401,{error:'سجّل الدخول أولًا.'});if(ss.role!=='superadmin')return send(res,403,{error:'إضافة المديرين وإدارة حساباتهم متاحة للمدير الرئيسي فقط.'});return send(res,200,{admins:readAdmins().admins.map(({id,name,email,active,createdAt})=>({id,name,email,active,createdAt}))});}
  if(req.method==='POST'&&pathname==='/api/admin/admins'){const ss=sessionAdmin(req);if(!ss)return send(res,401,{error:'سجّل الدخول أولًا.'});if(ss.role!=='superadmin')return send(res,403,{error:'إضافة المديرين متاحة للمدير الرئيسي فقط.'});try{const b=await readBody(req,8000);const email=String(b.email||'').trim().toLowerCase(),name=String(b.name||'').trim().slice(0,100),password=String(b.password||'');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!name||password.length<8||password.length>128)return send(res,400,{error:'أدخل اسمًا وبريدًا صحيحًا وكلمة مرور من 8 خانات على الأقل.'});if(email===String(process.env.ADMIN_EMAIL||'').trim().toLowerCase()||readAdmins().admins.some(a=>a.email===email))return send(res,409,{error:'يوجد حساب إداري بهذا البريد.'});const d=readAdmins();const salt=crypto.randomBytes(16).toString('hex'),hash=await scrypt(password,salt,64);const a={id:crypto.randomUUID(),name,email,salt,hash:hash.toString('hex'),active:true,createdAt:new Date().toISOString()};d.admins.push(a);saveAdmins(d);audit(ss.email,'admin.create',{email,name});return send(res,201,{id:a.id,name,email,active:true});}catch(e){return send(res,e.status||400,{error:e.message||'تعذّر إنشاء حساب المدير.'});}}
  if(req.method==='POST'&&pathname==='/api/admin/admins/status'){const ss=sessionAdmin(req);if(!ss)return send(res,401,{error:'سجّل الدخول أولًا.'});if(ss.role!=='superadmin')return send(res,403,{error:'إدارة حسابات المديرين متاحة للمدير الرئيسي فقط.'});try{const b=await readBody(req,3000),d=readAdmins(),a=d.admins.find(x=>x.id===String(b.id||''));if(!a)return send(res,404,{error:'حساب المدير غير موجود.'});a.active=b.active===true;saveAdmins(d);for(const [token,session] of adminSessions)if(session.adminId===a.id)adminSessions.delete(token);saveAdminSessions();audit(ss.email,'admin.status',{email:a.email,active:a.active});return send(res,200,{id:a.id,active:a.active});}catch{return send(res,400,{error:'تعذّر تحديث حساب المدير.'});}}
  if(req.method==='POST'&&pathname==='/api/feedback'){
    const lim=rateLimit(req,'app-feedback',5);if(!lim.allowed){res.setHeader('Retry-After',String(lim.retryAfter));return send(res,429,{error:'أرسلت ملاحظات كثيرة خلال وقت قصير. حاول لاحقًا.'});}
    try{const b=await readBody(req,6000),rating=Number(b.rating),category=String(b.category||'suggestion'),comment=String(b.comment||'').trim(),email=String(b.email||'').trim().toLowerCase();
      if(!Number.isInteger(rating)||rating<1||rating>5)return send(res,400,{error:'اختر تقييمًا من نجمة إلى خمس نجوم.'});
      if(!['suggestion','bug','content','excellent','improvement','other'].includes(category))return send(res,400,{error:'اختر نوع ملاحظة صحيحًا.'});
      if(comment.length>3000||email.length>254|| (email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))return send(res,400,{error:'تحقق من نص الملاحظة أو البريد الإلكتروني.'});
      if(!comment&&rating<4)return send(res,400,{error:'اكتب ملاحظة قصيرة لتوضيح تقييمك.'});
      const submissionId=String(b.submissionId||'').trim().slice(0,80);if(submissionId&&!/^[a-zA-Z0-9-]{16,80}$/.test(submissionId))return send(res,400,{error:'معرّف الإرسال غير صحيح.'});const d=readJsonFile(feedbackFile,{items:[]});d.items||=[];if(submissionId&&d.items.some(x=>x.submissionId===submissionId))return send(res,200,{saved:true,duplicate:true,message:'تم حفظ تقييمك مسبقًا، شكرًا لك.'});const item={id:crypto.randomUUID(),submissionId:submissionId||null,rating,category,comment,email:email||null,createdAt:new Date().toISOString(),status:'new'};d.items.unshift(item);d.items=d.items.slice(0,10000);saveJsonFile(feedbackFile,d);return send(res,201,{saved:true,message:'شكرًا لمشاركتك رأيك ومساعدتنا على تطوير التطبيق.'});
    }catch(e){return send(res,e.status||400,{error:e.message||'تعذّر حفظ الملاحظة.'});}
  }
  if(req.method==='GET'&&pathname==='/api/admin/feedback'){const ss=sessionAdmin(req);if(!ss)return send(res,401,{error:'سجّل الدخول أولًا.'});if(ss.role!=='superadmin')return send(res,403,{error:'عرض ملاحظات التطبيق متاح لمالك المنصة فقط.'});const d=readJsonFile(feedbackFile,{items:[]});return send(res,200,{items:d.items||[],summary:{count:(d.items||[]).length,average:(d.items||[]).length?Math.round((d.items||[]).reduce((n,x)=>n+x.rating,0)/(d.items||[]).length*100)/100:0}});}
  if(req.method==='GET'&&pathname==='/api/platform/settings'){const x=readPlatformSettings();return send(res,200,{appName:x.appName,tagline:x.tagline,description:x.description,logoUrl:x.logoUrl,contactEmail:x.contactEmail,phoneNumbers:x.phoneNumbers,socialLinks:x.socialLinks,aboutText:x.aboutText,dedicationText:x.dedicationText,footerText:x.footerText,newsTicker:x.newsTicker,ads:(x.ads||[]).filter(a=>a.active&&(!a.startsAt||Date.parse(a.startsAt)<=Date.now())&&(!a.endsAt||Date.parse(a.endsAt)>=Date.now())).map(({id,title,text,imageUrl,link,placement})=>({id,title,text,imageUrl,link,placement})),updatedAt:x.updatedAt});}
  if(req.method==='GET'&&pathname==='/api/admin/platform/settings'){const ss=sessionAdmin(req);if(!ss)return send(res,401,{error:'سجّل الدخول أولًا.'});if(ss.role!=='superadmin')return send(res,403,{error:'إعدادات المنصة متاحة لمالك المنصة فقط.'});return send(res,200,readPlatformSettings());}
  if(req.method==='PUT'&&pathname==='/api/admin/platform/settings'){const ss=sessionAdmin(req);if(!ss)return send(res,401,{error:'سجّل الدخول أولًا.'});if(ss.role!=='superadmin')return send(res,403,{error:'تعديل إعدادات المنصة العامة متاح لمالك المنصة فقط.'});try{const b=await readBody(req,30000),old=readPlatformSettings();const str=(k,max,def='')=>String(b[k]??def).trim().slice(0,max);const next={...old,appName:str('appName',100,old.appName)||old.appName,tagline:str('tagline',220,old.tagline),description:str('description',2000,old.description),logoUrl:str('logoUrl',1000,old.logoUrl),contactEmail:str('contactEmail',254,old.contactEmail),phoneNumbers:Array.isArray(b.phoneNumbers)?b.phoneNumbers.map(x=>String(x).trim().slice(0,40)).filter(Boolean).slice(0,10):old.phoneNumbers,socialLinks:Array.isArray(b.socialLinks)?b.socialLinks.slice(0,10).map(x=>({label:String(x.label||'').slice(0,40),url:String(x.url||'').slice(0,500)})).filter(x=>/^https:\/\//i.test(x.url)):old.socialLinks,aboutText:str('aboutText',5000,old.aboutText),dedicationText:str('dedicationText',8000,old.dedicationText||''),footerText:str('footerText',1000,old.footerText||''),newsTicker:{enabled:!!b.newsTicker?.enabled,text:String(b.newsTicker?.text||'').trim().slice(0,1000)},ads:Array.isArray(b.ads)?b.ads.slice(0,30).map(a=>({id:String(a.id||crypto.randomUUID()),title:String(a.title||'').trim().slice(0,160),text:String(a.text||'').trim().slice(0,1000),imageUrl:String(a.imageUrl||'').trim().slice(0,1000),link:/^https:\/\//i.test(String(a.link||''))?String(a.link).slice(0,1000):'',placement:['home-top','home-middle','home-bottom'].includes(a.placement)?a.placement:'home-middle',startsAt:String(a.startsAt||'').slice(0,40),endsAt:String(a.endsAt||'').slice(0,40),active:!!a.active})):old.ads,updatedAt:new Date().toISOString()};saveJsonFile(settingsFile,next);audit(ss.email,'platform.settings.update',{appName:next.appName});return send(res,200,{saved:true,settings:next});}catch(e){return send(res,400,{error:e.message||'تعذّر حفظ إعدادات المنصة.'});}}
  if(req.method==='GET'&&pathname==='/api/admin/schools'){const ss=sessionAdmin(req);if(!ss)return send(res,401,{error:'سجّل الدخول أولًا.'});if(ss.role!=='superadmin')return send(res,403,{error:'إدارة المدارس متاحة لمالك المنصة فقط.'});return send(res,200,{schools:readSchools().schools.map(publicSchool)});}
  if(req.method==='POST'&&pathname==='/api/admin/schools'){const ss=sessionAdmin(req);if(!ss)return send(res,401,{error:'سجّل الدخول أولًا.'});if(ss.role!=='superadmin')return send(res,403,{error:'إضافة المدارس متاحة لمالك المنصة فقط.'});try{const b=await readBody(req,12000);const name=String(b.name||'').trim().slice(0,160),email=String(b.adminEmail||'').trim().toLowerCase(),adminName=String(b.adminName||'مدير المدرسة').trim().slice(0,100),password=String(b.adminPassword||''),deputyName=String(b.deputyName||'').trim().slice(0,100),deputyEmail=String(b.deputyEmail||'').trim().toLowerCase(),deputyPassword=String(b.deputyPassword||'');if(!name)return send(res,400,{error:'اسم المدرسة مطلوب.'});if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<8||password.length>128)return send(res,400,{error:'أدخل بريد مدير المدرسة الصحيح وكلمة مرور لا تقل عن 8 خانات.'});const wantsDeputy=!!(deputyName||deputyEmail||deputyPassword);if(wantsDeputy&&(!deputyName||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(deputyEmail)||deputyPassword.length<8||deputyPassword.length>128))return send(res,400,{error:'لإضافة وكيل، أدخل اسمه وبريده وكلمة مرور لا تقل عن 8 خانات.'});if(wantsDeputy&&deputyEmail===email)return send(res,400,{error:'يجب أن يكون بريد الوكيل مختلفًا عن بريد المدير.'});const d=readSchools();if(d.schools.some(s=>s.name.toLowerCase()===name.toLowerCase()||s.admins?.some(a=>[email,...(wantsDeputy?[deputyEmail]:[])].includes(a.email))))return send(res,409,{error:'اسم المدرسة أو بريد أحد حساباتها مستخدم بالفعل.'});const createAccount=async(accountName,accountEmail,accountPassword,schoolRole)=>{const salt=crypto.randomBytes(16).toString('hex'),hash=await scrypt(accountPassword,salt,64);return {id:crypto.randomUUID(),name:accountName,email:accountEmail,salt,hash:hash.toString('hex'),schoolRole,active:true,createdAt:new Date().toISOString()}};const admins=[await createAccount(adminName,email,password,'principal')];if(wantsDeputy)admins.push(await createAccount(deputyName,deputyEmail,deputyPassword,'deputy'));const school={id:crypto.randomUUID(),name,slug:String(b.slug||'').trim().toLowerCase().replace(/[^a-z0-9-]/g,'').slice(0,80),description:String(b.description||'').trim().slice(0,2000),logoUrl:String(b.logoUrl||'').trim().slice(0,1000),contactEmail:String(b.contactEmail||'').trim().slice(0,254),phone:String(b.phone||'').trim().slice(0,50),active:true,schoolYear:String(b.schoolYear||new Date().getFullYear()).slice(0,30),grades:Array.isArray(b.grades)?b.grades.map(x=>String(x).slice(0,80)).slice(0,100):[],subjects:[],sections:[],gradeSections:{},admins,createdAt:new Date().toISOString()};d.schools.push(school);saveJsonFile(schoolsFile,d);audit(ss.email,'school.create',{schoolId:school.id,name,email,deputyEmail:wantsDeputy?deputyEmail:''});return send(res,201,{school:publicSchool(school),schoolAdmin:{name:adminName,email},schoolDeputy:wantsDeputy?{name:deputyName,email:deputyEmail}:null});}catch(e){return send(res,400,{error:e.message||'تعذّر إنشاء المدرسة.'});}}
  if(req.method==='PATCH'&&pathname.startsWith('/api/admin/schools/')){const ss=sessionAdmin(req);if(!ss)return send(res,401,{error:'سجّل الدخول أولًا.'});if(ss.role!=='superadmin')return send(res,403,{error:'تعديل المدارس متاح لمالك المنصة فقط.'});try{const id=pathname.slice('/api/admin/schools/'.length),b=await readBody(req,12000),d=readSchools(),school=d.schools.find(x=>x.id===id);if(!school)return send(res,404,{error:'المدرسة غير موجودة.'});for(const k of ['name','description','logoUrl','contactEmail','phone','schoolYear'])if(b[k]!==undefined)school[k]=String(b[k]).trim().slice(0,({'name':160,'description':2000,'logoUrl':1000,'contactEmail':254,'phone':50,'schoolYear':30})[k]);if(b.active!==undefined)school.active=!!b.active;if(Array.isArray(b.grades))school.grades=b.grades.map(x=>String(x).slice(0,80)).slice(0,100);if(Array.isArray(b.subjects))school.subjects=b.subjects.map(x=>String(x).slice(0,80)).slice(0,100);school.updatedAt=new Date().toISOString();saveJsonFile(schoolsFile,d);audit(ss.email,'school.update',{schoolId:id,active:school.active});return send(res,200,{school:publicSchool(school)});}catch(e){return send(res,400,{error:e.message||'تعذّر تحديث المدرسة.'});}}
  if(req.method==='POST'&&['/api/school-members/register','/api/student/register'].includes(pathname)){
    const isStudentOnlyRoute=pathname==='/api/student/register';
    const lim=rateLimit(req,isStudentOnlyRoute?'student-register':'school-member-register',8);if(!lim.allowed){res.setHeader('Retry-After',String(lim.retryAfter));return send(res,429,{error:'طلبات التسجيل كثيرة. انتظر قليلًا.'});}
    try{const b=await readBody(req,8000),schoolId=String(b.schoolId||''),name=String(b.name||'').trim().slice(0,120),email=String(b.email||'').trim().toLowerCase(),password=String(b.password||''),role=isStudentOnlyRoute?'student':(['student','teacher'].includes(b.role)?b.role:'student'),grade=String(b.grade||'').trim().slice(0,80),section=String(b.section||'').trim().slice(0,80),subjects=Array.isArray(b.subjects)?b.subjects.map(x=>String(x).trim().slice(0,100)).filter(Boolean).slice(0,20):[];
    const school=readSchools().schools.find(x=>x.id===schoolId&&x.active);if(!school)return send(res,404,{error:'المدرسة غير موجودة أو غير مفعّلة.'});if(!name||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<8||password.length>128)return send(res,400,{error:'أدخل الاسم والبريد الصحيح وكلمة مرور لا تقل عن 8 خانات.'});if(role==='student'&&school.grades?.length&&!school.grades.includes(grade))return send(res,400,{error:'اختر صفًا من الصفوف المعتمدة في المدرسة.'});if(readSchoolMembers().members.some(m=>m.email===email))return send(res,409,{error:'يوجد طلب أو حساب بهذا البريد في المدرسة.'});const salt=crypto.randomBytes(16).toString('hex'),hash=await scrypt(password,salt,64);const member={id:crypto.randomUUID(),schoolId,name,email,role,grade,section,subjects,salt,hash:hash.toString('hex'),status:'pending',active:false,createdAt:new Date().toISOString(),reviewedAt:null};const d=readSchoolMembers();d.members.push(member);saveSchoolMembers(d);audit(email,'school_member.register',{schoolId,role});return send(res,201,{submitted:true,status:'pending',message:'وصل طلبك إلى إدارة المدرسة. لن تستطيع دخول المساحة المدرسية قبل اعتماد الحساب.'});}catch(e){return send(res,e.status||400,{error:e.message||'تعذّر إرسال طلب الانضمام.'});}
  }
  if(req.method==='POST'&&pathname==='/api/school-member/login'){
    const lim=rateLimit(req,'school-member-login',8);if(!lim.allowed){res.setHeader('Retry-After',String(lim.retryAfter));return send(res,429,{error:'محاولات كثيرة. انتظر قبل إعادة المحاولة.'});}
    try{const b=await readBody(req,5000),email=String(b.email||'').trim().toLowerCase(),password=String(b.password||''),d=readSchoolMembers(),m=d.members.find(x=>x.email===email);const salt=m?.salt||'00000000000000000000000000000000',expected=m?.hash?Buffer.from(m.hash,'hex'):Buffer.alloc(64),hash=await scrypt(password,salt,64);if(!m||expected.length!==hash.length||!crypto.timingSafeEqual(hash,expected))return send(res,401,{error:'بيانات الدخول غير صحيحة.'});if(m.status!=='approved'||!m.active)return send(res,403,{error:'حسابك ينتظر اعتماد إدارة المدرسة أو أنه غير مفعّل.'});const school=readSchools().schools.find(x=>x.id===m.schoolId&&x.active);if(!school)return send(res,403,{error:'المدرسة غير مفعّلة حاليًا.'});const token=crypto.randomBytes(32).toString('hex');schoolMemberSessions.set(token,{memberId:m.id,expires:Date.now()+8*60*60*1000});saveSchoolMemberSessions();memberCookie(res,token,8*60*60);audit(email,'school_member.login',{schoolId:m.schoolId,role:m.role});return send(res,200,{authenticated:true,member:{id:m.id,name:m.name,email:m.email,role:m.role,grade:m.grade,section:m.section,subjects:m.subjects},school:publicSchool(school)});}catch(e){return send(res,400,{error:e.message||'تعذّر تسجيل الدخول.'});}
  }
  if(req.method==='GET'&&pathname==='/api/school-member/me'){const ss=sessionSchoolMember(req);return send(res,200,{authenticated:!!ss,member:ss?{id:ss.member.id,name:ss.member.name,email:ss.member.email,role:ss.member.role,grade:ss.member.grade,section:ss.member.section,subjects:ss.member.subjects}:null,school:ss?publicSchool(ss.school):null});}
  if(req.method==='POST'&&pathname==='/api/school-member/logout'){const ss=sessionSchoolMember(req);if(ss){schoolMemberSessions.delete(ss.token);saveSchoolMemberSessions();}memberCookie(res,'',0);return send(res,200,{authenticated:false});}
  if(req.method==='GET'&&pathname==='/api/school-member/posts'){const ss=requireSchoolMember(req,res);if(!ss)return;let posts=readSchoolPosts().posts.filter(p=>p.schoolId===ss.school.id&&p.status==='published');if(ss.member.role==='student'){posts=posts.filter(p=>(!p.grade||p.grade===ss.member.grade)&&(!p.section||p.section===ss.member.section));}else{posts=posts.filter(p=>p.type==='announcement'&&(!p.grade||!ss.member.grade||p.grade===ss.member.grade)||((!p.grade&& !ss.member.grade)||(!!ss.member.grade&&p.grade===ss.member.grade))&&((!p.section&&!ss.member.section)||(!!ss.member.section&&p.section===ss.member.section))&&((!p.subject&&!ss.member.subjects?.length)||(!p.subject)||(!!ss.member.subjects?.includes(p.subject))));}posts=posts.map(({attachmentFile,...p})=>({...p,hasAttachment:!!attachmentFile,attachmentUrl:attachmentFile?'/api/school-member/assignment-pdf/'+p.id:null}));return send(res,200,{school:publicSchool(ss.school),member:{name:ss.member.name,role:ss.member.role,grade:ss.member.grade,section:ss.member.section},posts});}
  if(req.method==='POST'&&pathname==='/api/school-member/teacher-posts'){const ss=requireSchoolMember(req,res);if(!ss)return;if(ss.member.role!=='teacher')return send(res,403,{error:'هذه الوظيفة مخصصة للمعلمين.'});try{const b=await readBody(req,20000),title=String(b.title||'').trim(),content=String(b.content||'').trim(),type=['announcement','lesson','summary','assignment','quiz'].includes(b.type)?b.type:'lesson',grade=String(b.grade||'').trim().slice(0,80),section=String(b.section||'').trim().slice(0,80),subject=String(b.subject||'').trim().slice(0,100);if(!title||!content)return send(res,400,{error:'العنوان والتفاصيل مطلوبان.'});if(!ss.member.subjects?.includes(subject))return send(res,403,{error:'لا يمكنك النشر في مادة غير مسندة إليك.'});if(grade&&ss.member.grade&&grade!==ss.member.grade)return send(res,403,{error:'لا يمكنك النشر لصف غير مسند إليك.'});const post={id:crypto.randomUUID(),schoolId:ss.schoolId,academicYear:String(ss.school.schoolYear||''),createdBy:ss.member.id,createdByRole:'teacher',title,content,type,grade:grade||ss.member.grade||'',section:section||ss.member.section||'',subject,dueAt:String(b.dueAt||'').slice(0,40),status:b.publish===false?'draft':'published',createdAt:new Date().toISOString()};const d=readSchoolPosts();d.posts.unshift(post);saveJsonFile(schoolPostsFile,d);audit(ss.member.email,'teacher.school_post.create',{schoolId:ss.schoolId,postId:post.id,type});return send(res,201,{post});}catch(e){return send(res,400,{error:e.message||'تعذّر نشر المحتوى.'});}}
  if(req.method==='GET'&&pathname==='/api/school-admin/members'){const ss=requireSchoolAdmin(req,res);if(!ss)return;const members=readSchoolMembers().members.filter(m=>m.schoolId===ss.schoolId).map(({id,name,email,role,grade,section,subjects,status,active,createdAt,reviewedAt})=>({id,name,email,role,grade,section,subjects,status,active,createdAt,reviewedAt}));return send(res,200,{members});}
  if(req.method==='POST'&&pathname==='/api/school-admin/members/review'){const ss=requireSchoolAdmin(req,res);if(!ss)return;if(ss.account.schoolRole==='deputy'&&!(ss.school.delegation?.deputyId===ss.account.id&&Date.parse(ss.school.delegation.expiresAt)>Date.now()))return send(res,403,{error:'مراجعة طلبات الحسابات تتطلب تفويضًا مؤقتًا ساريًا من مدير المدرسة.'});try{const b=await readBody(req,3000),d=readSchoolMembers(),m=d.members.find(x=>x.id===String(b.id||'')&&x.schoolId===ss.schoolId);if(!m)return send(res,404,{error:'طلب الانضمام غير موجود في مدرستك.'});if(!['approve','reject','disable'].includes(b.action))return send(res,400,{error:'الإجراء غير معروف.'});if(b.action==='approve'){m.status='approved';m.active=true;}else if(b.action==='reject'){m.status='rejected';m.active=false;}else{m.status='approved';m.active=false;}m.reviewedAt=new Date().toISOString();saveSchoolMembers(d);for(const [token,s] of schoolMemberSessions)if(s.memberId===m.id)schoolMemberSessions.delete(token);saveSchoolMemberSessions();audit(ss.email,'school_member.review',{schoolId:ss.schoolId,memberId:m.id,action:b.action});return send(res,200,{id:m.id,status:m.status,active:m.active});}catch(e){return send(res,400,{error:e.message||'تعذّرت مراجعة الطلب.'});}}
  if(req.method==='POST'&&pathname==='/api/school-admin/login'){const lim=rateLimit(req,'school-admin-login',5);if(!lim.allowed){res.setHeader('Retry-After',String(lim.retryAfter));return send(res,429,{error:'محاولات كثيرة. انتظر قليلًا.'});}try{const b=await readBody(req,5000),email=String(b.email||'').trim().toLowerCase(),password=String(b.password||''),d=readSchools();let match=null,account=null;for(const school of d.schools.filter(x=>x.active)){const a=(school.admins||[]).find(x=>x.email===email&&x.active);if(a){match=school;account=a;break;}}const salt=account?.salt||'00000000000000000000000000000000',expected=account?.hash?Buffer.from(account.hash,'hex'):Buffer.alloc(64),hash=await scrypt(password,salt,64);if(!account||expected.length!==hash.length||!crypto.timingSafeEqual(hash,expected))return send(res,401,{error:'بيانات الدخول غير صحيحة أو حساب المدرسة غير مفعّل.'});const token=crypto.randomBytes(32).toString('hex');schoolSessions.set(token,{schoolId:match.id,schoolAdminId:account.id,email,expires:Date.now()+8*60*60*1000});saveSchoolSessions();schoolAdminCookie(res,token,8*60*60);audit(email,'school_admin.login',{schoolId:match.id});return send(res,200,{authenticated:true,role:account.schoolRole==='deputy'?'school_deputy':'school_admin',schoolRole:account.schoolRole||'principal',email,school:publicSchool(match)});}catch(e){return send(res,400,{error:e.message||'تعذّر تسجيل الدخول.'});}}
  if(req.method==='GET'&&pathname==='/api/school-admin/me'){const ss=sessionSchoolAdmin(req);return send(res,200,{authenticated:!!ss,role:ss?(ss.account.schoolRole==='deputy'?'school_deputy':'school_admin'):null,schoolRole:ss?.account.schoolRole||'principal',email:ss?.email||null,school:ss?publicSchool(ss.school):null});}
  if(req.method==='POST'&&pathname==='/api/school-admin/delegation'){const ss=requireSchoolAdmin(req,res);if(!ss)return;if(ss.account.schoolRole!=='principal')return send(res,403,{error:'تفعيل التفويض المؤقت متاح لمدير المدرسة فقط.'});try{const b=await readBody(req,3000),minutes=Math.max(15,Math.min(480,Number(b.minutes)||120)),d=readSchools(),school=d.schools.find(x=>x.id===ss.schoolId),deputy=(school?.admins||[]).find(a=>a.schoolRole==='deputy'&&a.active);if(!deputy)return send(res,400,{error:'لا يوجد وكيل نشط مرتبط بهذه المدرسة.'});school.delegation={deputyId:deputy.id,startedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+minutes*60000).toISOString(),startedBy:ss.account.id};saveJsonFile(schoolsFile,d);audit(ss.email,'school.delegation.start',{schoolId:ss.schoolId,deputyId:deputy.id,minutes});return send(res,200,{active:true,expiresAt:school.delegation.expiresAt});}catch(e){return send(res,400,{error:e.message||'تعذّر تفعيل التفويض.'});}}
  if(req.method==='DELETE'&&pathname==='/api/school-admin/delegation'){const ss=requireSchoolAdmin(req,res);if(!ss)return;if(ss.account.schoolRole!=='principal')return send(res,403,{error:'إلغاء التفويض متاح لمدير المدرسة فقط.'});const d=readSchools(),school=d.schools.find(x=>x.id===ss.schoolId);if(school?.delegation){delete school.delegation;saveJsonFile(schoolsFile,d);audit(ss.email,'school.delegation.end',{schoolId:ss.schoolId});}return send(res,200,{active:false});}
  if(req.method==='POST'&&pathname==='/api/school-admin/logout'){const ss=sessionSchoolAdmin(req);if(ss){schoolSessions.delete(ss.token);saveSchoolSessions();}schoolAdminCookie(res,'',0);return send(res,200,{authenticated:false});}
  if(req.method==='GET'&&pathname==='/api/school-admin/posts'){const ss=requireSchoolAdmin(req,res);if(!ss)return;return send(res,200,{posts:readSchoolPosts().posts.filter(p=>p.schoolId===ss.schoolId)});}
  if(req.method==='POST'&&pathname==='/api/school-admin/posts'){const ss=requireSchoolAdmin(req,res);if(!ss)return;try{const b=await readBody(req,20000),title=String(b.title||'').trim(),content=String(b.content||'').trim(),type=['announcement','lesson','summary','assignment','quiz'].includes(b.type)?b.type:'announcement';if(!title||!content)return send(res,400,{error:'العنوان والمحتوى مطلوبان.'});const post={id:crypto.randomUUID(),schoolId:ss.schoolId,academicYear:String(ss.school.schoolYear||''),createdBy:ss.schoolAdminId,createdByRole:'school_admin',title:title.slice(0,180),content:content.slice(0,15000),type,grade:String(b.grade||'').trim().slice(0,80),section:String(b.section||'').trim().slice(0,80),subject:String(b.subject||'').trim().slice(0,100),dueAt:String(b.dueAt||'').slice(0,40),status:b.publish===false?'draft':'published',createdAt:new Date().toISOString()};const d=readSchoolPosts();d.posts.unshift(post);saveJsonFile(schoolPostsFile,d);audit(ss.email,'school.post.create',{schoolId:ss.schoolId,postId:post.id,type});return send(res,201,{post});}catch(e){return send(res,400,{error:e.message||'تعذّر حفظ المنشور.'});}}
  if(req.method==='GET'&&pathname==='/api/school-admin/fees'){const ss=requireSchoolAdmin(req,res);if(!ss)return;const d=readJsonFile(schoolFeesFile,{types:[],payments:[],assessments:[]}),members=readSchoolMembers().members.filter(m=>m.schoolId===ss.schoolId&&m.role==='student'&&m.status==='approved'&&m.active);d.assessments||=[];const types=d.types.filter(x=>x.schoolId===ss.schoolId),payments=d.payments.filter(x=>x.schoolId===ss.schoolId),assessments=d.assessments.filter(x=>x.schoolId===ss.schoolId);const balances=members.map(m=>{const studentPayments=payments.filter(p=>p.studentId===m.id);const feeDetails=types.filter(t=>t.active!==false).map(t=>{const assessment=assessments.find(a=>a.studentId===m.id&&a.typeId===t.id),due=Number(assessment?assessment.amount:t.defaultAmount||0),paid=studentPayments.filter(p=>p.typeId===t.id).reduce((n,p)=>n+Number(p.amount||0),0);return {typeId:t.id,typeName:t.name,period:t.period||'custom',due,paid,remaining:Math.max(0,Math.round((due-paid)*100)/100),customAssessment:!!assessment}});const due=feeDetails.reduce((n,x)=>n+x.due,0),paid=studentPayments.reduce((n,p)=>n+Number(p.amount||0),0),remaining=feeDetails.reduce((n,x)=>n+x.remaining,0);return {studentId:m.id,name:m.name,grade:m.grade||'',section:m.section||'',due,paid,remaining,feeDetails}});return send(res,200,{types,payments:payments.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),balances,summary:{due:balances.reduce((n,x)=>n+x.due,0),paid:balances.reduce((n,x)=>n+x.paid,0),remaining:balances.reduce((n,x)=>n+x.remaining,0)}});}
  if(req.method==='POST'&&pathname==='/api/school-admin/fees/types'){const ss=requireSchoolAdmin(req,res);if(!ss)return;try{const b=await readBody(req,5000),name=String(b.name||'').trim().slice(0,100),amount=Number(b.defaultAmount);if(!name||!Number.isFinite(amount)||amount<0)return send(res,400,{error:'أدخل اسم الرسوم ومبلغًا افتراضيًا صحيحًا.'});const d=readJsonFile(schoolFeesFile,{types:[],payments:[]});d.types||=[];if(d.types.some(t=>t.schoolId===ss.schoolId&&t.name.toLowerCase()===name.toLowerCase()))return send(res,409,{error:'يوجد نوع رسوم بهذا الاسم بالفعل.'});const item={id:crypto.randomUUID(),schoolId:ss.schoolId,name,defaultAmount:Math.round(amount*100)/100,period:['once','monthly','term','yearly','custom'].includes(b.period)?b.period:'custom',active:b.active!==false,createdAt:new Date().toISOString()};d.types.push(item);saveJsonFile(schoolFeesFile,d);audit(ss.email,'school.fee_type.create',{schoolId:ss.schoolId,typeId:item.id});return send(res,201,{type:item});}catch(e){return send(res,400,{error:e.message||'تعذرت إضافة نوع الرسوم.'});}}
  if(req.method==='PATCH'&&pathname.startsWith('/api/school-admin/fees/types/')){const ss=requireSchoolAdmin(req,res);if(!ss)return;try{const id=pathname.slice('/api/school-admin/fees/types/'.length),b=await readBody(req,5000),d=readJsonFile(schoolFeesFile,{types:[],payments:[]}),t=d.types.find(x=>x.id===id&&x.schoolId===ss.schoolId);if(!t)return send(res,404,{error:'نوع الرسوم غير موجود.'});if(b.name!==undefined){const name=String(b.name).trim().slice(0,100);if(!name)return send(res,400,{error:'اسم الرسوم مطلوب.'});t.name=name;}if(b.defaultAmount!==undefined){const amount=Number(b.defaultAmount);if(!Number.isFinite(amount)||amount<0)return send(res,400,{error:'المبلغ غير صحيح.'});t.defaultAmount=Math.round(amount*100)/100;}if(b.period!==undefined&&['once','monthly','term','yearly','custom'].includes(b.period))t.period=b.period;if(b.active!==undefined)t.active=!!b.active;t.updatedAt=new Date().toISOString();saveJsonFile(schoolFeesFile,d);audit(ss.email,'school.fee_type.update',{schoolId:ss.schoolId,typeId:id});return send(res,200,{type:t});}catch(e){return send(res,400,{error:e.message||'تعذر تعديل نوع الرسوم.'});}}
  if(req.method==='DELETE'&&pathname.startsWith('/api/school-admin/fees/types/')){const ss=requireSchoolAdmin(req,res);if(!ss)return;const id=pathname.slice('/api/school-admin/fees/types/'.length),d=readJsonFile(schoolFeesFile,{types:[],payments:[]}),t=d.types.find(x=>x.id===id&&x.schoolId===ss.schoolId);if(!t)return send(res,404,{error:'نوع الرسوم غير موجود.'});if(d.payments.some(p=>p.schoolId===ss.schoolId&&p.typeId===id))return send(res,409,{error:'لا يمكن حذف نوع رسوم له مدفوعات مسجلة؛ عطّله بدلًا من ذلك للحفاظ على السجل المالي.'});d.types=d.types.filter(x=>x.id!==id);saveJsonFile(schoolFeesFile,d);audit(ss.email,'school.fee_type.delete',{schoolId:ss.schoolId,typeId:id});return send(res,200,{deleted:true});}
  if(req.method==='POST'&&pathname==='/api/school-admin/fees/assessments'){const ss=requireSchoolAdmin(req,res);if(!ss)return;try{const b=await readBody(req,5000),studentId=String(b.studentId||''),typeId=String(b.typeId||''),amount=Number(b.amount),members=readSchoolMembers().members,d=readJsonFile(schoolFeesFile,{types:[],payments:[],assessments:[]}),student=members.find(m=>m.id===studentId&&m.schoolId===ss.schoolId&&m.role==='student'&&m.status==='approved'&&m.active),type=d.types.find(t=>t.id===typeId&&t.schoolId===ss.schoolId);if(!student||!type)return send(res,400,{error:'اختر طالبًا ونوع رسوم تابعين لمدرستك.'});if(!Number.isFinite(amount)||amount<0)return send(res,400,{error:'المبلغ المستحق يجب أن يكون صفرًا أو أكثر.'});d.assessments||=[];let item=d.assessments.find(a=>a.schoolId===ss.schoolId&&a.studentId===studentId&&a.typeId===typeId);if(item){item.amount=Math.round(amount*100)/100;item.updatedAt=new Date().toISOString();}else{item={id:crypto.randomUUID(),schoolId:ss.schoolId,studentId,typeId,amount:Math.round(amount*100)/100,createdAt:new Date().toISOString()};d.assessments.push(item);}saveJsonFile(schoolFeesFile,d);audit(ss.email,'school.fee.assessment.set',{schoolId:ss.schoolId,studentId,typeId,amount:item.amount});return send(res,200,{assessment:item,message:'تم تحديث المبلغ المستحق لهذا الطالب.'});}catch(e){return send(res,400,{error:e.message||'تعذّر تعديل استحقاق الطالب.'});}}
  if(req.method==='POST'&&pathname==='/api/school-admin/fees/payments'){const ss=requireSchoolAdmin(req,res);if(!ss)return;try{const b=await readBody(req,5000),studentId=String(b.studentId||''),typeId=String(b.typeId||''),amount=Number(b.amount),members=readSchoolMembers().members,student=members.find(m=>m.id===studentId&&m.schoolId===ss.schoolId&&m.role==='student'&&m.status==='approved'&&m.active),d=readJsonFile(schoolFeesFile,{types:[],payments:[]}),type=d.types.find(t=>t.id===typeId&&t.schoolId===ss.schoolId);if(!student||!type)return send(res,400,{error:'اختر طالبًا ونوع رسوم تابعين لمدرستك.'});if(!Number.isFinite(amount)||amount<=0)return send(res,400,{error:'قيمة الدفعة يجب أن تكون أكبر من صفر.'});const payment={id:crypto.randomUUID(),receiptNo:'TH-'+Date.now().toString(36).toUpperCase()+'-'+crypto.randomBytes(2).toString('hex').toUpperCase(),schoolId:ss.schoolId,studentId,studentName:student.name,typeId,typeName:type.name,amount:Math.round(amount*100)/100,method:['cash','transfer','card','other'].includes(b.method)?b.method:'cash',note:String(b.note||'').trim().slice(0,300),receivedBy:ss.email,createdAt:new Date().toISOString()};d.payments.push(payment);saveJsonFile(schoolFeesFile,d);audit(ss.email,'school.fee_payment.create',{schoolId:ss.schoolId,paymentId:payment.id,studentId,amount:payment.amount});return send(res,201,{payment});}catch(e){return send(res,400,{error:e.message||'تعذر تسجيل الدفعة.'});}}
  if(req.method==='GET'&&pathname==='/api/school-admin/overview'){const ss=requireSchoolAdmin(req,res);if(!ss)return;const members=readSchoolMembers().members.filter(m=>m.schoolId===ss.schoolId),posts=readSchoolPosts().posts.filter(p=>p.schoolId===ss.schoolId),subs=readSchoolSubmissions().submissions.filter(x=>x.schoolId===ss.schoolId);return send(res,200,{school:publicSchool(ss.school),counts:{students:members.filter(m=>m.role==='student'&&m.status==='approved'&&m.active).length,teachers:members.filter(m=>m.role==='teacher'&&m.status==='approved'&&m.active).length,pending:members.filter(m=>m.status==='pending').length,posts:posts.length,assignments:posts.filter(p=>p.type==='assignment').length,submissions:subs.length}});}
  if(req.method==='PUT'&&pathname==='/api/school-admin/settings'){const ss=requireSchoolAdmin(req,res);if(!ss)return;if(ss.account.schoolRole==='deputy')return send(res,403,{error:'تعديل إعدادات المدرسة الأساسية متاح لمدير المدرسة فقط.'});try{const b=await readBody(req,16000),d=readSchools(),school=d.schools.find(x=>x.id===ss.schoolId);if(!school)return send(res,404,{error:'المدرسة غير موجودة.'});for(const [k,max] of Object.entries({name:160,description:2000,logoUrl:1000,contactEmail:254,phone:50,schoolYear:30}))if(b[k]!==undefined)school[k]=String(b[k]).trim().slice(0,max);if(b.resultBalanceThreshold!==undefined){const threshold=Number(b.resultBalanceThreshold);if(!Number.isFinite(threshold)||threshold < -1 || threshold > 100000000)return send(res,400,{error:'حد المديونية غير صحيح. استخدم -1 لتعطيل حجب النتائج أو صفرًا فأكثر لتفعيله.'});school.resultBalanceThreshold=threshold;}for(const k of ['grades','subjects','sections'])if(Array.isArray(b[k]))school[k]=[...new Set(b[k].map(x=>String(x).trim().slice(0,80)).filter(Boolean))].slice(0,100);if(b.gradeSections&&typeof b.gradeSections==='object'&&!Array.isArray(b.gradeSections)){const next={};for(const grade of (school.grades||[])){const key=String(grade);const values=Array.isArray(b.gradeSections[key])?b.gradeSections[key]:[];next[key]=[...new Set(values.map(x=>String(x).trim().slice(0,80)).filter(Boolean))].slice(0,100);}school.gradeSections=next;school.sections=[...new Set(Object.values(next).flat())].slice(0,100);}school.updatedAt=new Date().toISOString();saveJsonFile(schoolsFile,d);audit(ss.email,'school.settings.update',{schoolId:ss.schoolId});return send(res,200,{school:publicSchool(school)});}catch(e){return send(res,400,{error:e.message||'تعذّر حفظ إعدادات المدرسة.'});}}
  if(req.method==='POST'&&pathname==='/api/school-admin/members/assign'){const ss=requireSchoolAdmin(req,res);if(!ss)return;try{const b=await readBody(req,6000),d=readSchoolMembers(),m=d.members.find(x=>x.id===String(b.id||'')&&x.schoolId===ss.schoolId);if(!m)return send(res,404,{error:'الحساب غير موجود في مدرستك.'});const requestedGrade=String(b.grade||'').trim().slice(0,80),requestedSection=String(b.section||'').trim().slice(0,80),school=readSchools().schools.find(x=>x.id===ss.schoolId);if(requestedGrade&&(school.grades||[]).length&&!school.grades.includes(requestedGrade))return send(res,400,{error:'اختر صفًا من الصفوف المعتمدة في المدرسة.'});const allowedSections=school.gradeSections?.[requestedGrade]||school.sections||[];if(requestedSection&&allowedSections.length&&!allowedSections.includes(requestedSection))return send(res,400,{error:'اختر شعبة تابعة للصف المحدد.'});m.grade=requestedGrade;m.section=requestedSection;m.subjects=Array.isArray(b.subjects)?[...new Set(b.subjects.map(x=>String(x).trim().slice(0,100)).filter(Boolean))].slice(0,30):[];m.updatedAt=new Date().toISOString();saveSchoolMembers(d);audit(ss.email,'school_member.assign',{schoolId:ss.schoolId,memberId:m.id,role:m.role});return send(res,200,{id:m.id,grade:m.grade,section:m.section,subjects:m.subjects});}catch(e){return send(res,400,{error:e.message||'تعذّر حفظ الإسناد.'});}}
  if(req.method==='PATCH'&&pathname.startsWith('/api/school-admin/posts/')){const ss=requireSchoolAdmin(req,res);if(!ss)return;try{const id=pathname.slice('/api/school-admin/posts/'.length),b=await readBody(req,20000),d=readSchoolPosts(),p=d.posts.find(x=>x.id===id&&x.schoolId===ss.schoolId);if(!p)return send(res,404,{error:'المنشور غير موجود في مدرستك.'});for(const [k,max] of Object.entries({title:180,content:15000,grade:80,section:80,subject:100,dueAt:40}))if(b[k]!==undefined)p[k]=String(b[k]).trim().slice(0,max);if(b.type!==undefined&&['announcement','lesson','summary','assignment','quiz'].includes(b.type))p.type=b.type;if(b.status!==undefined&&['draft','published','archived'].includes(b.status))p.status=b.status;p.updatedAt=new Date().toISOString();saveJsonFile(schoolPostsFile,d);audit(ss.email,'school.post.update',{schoolId:ss.schoolId,postId:id});return send(res,200,{post:p});}catch(e){return send(res,400,{error:e.message||'تعذّر تحديث المنشور.'});}}
  if(req.method==='DELETE'&&pathname.startsWith('/api/school-admin/posts/')){const ss=requireSchoolAdmin(req,res);if(!ss)return;const id=pathname.slice('/api/school-admin/posts/'.length),d=readSchoolPosts(),i=d.posts.findIndex(x=>x.id===id&&x.schoolId===ss.schoolId);if(i<0)return send(res,404,{error:'المنشور غير موجود في مدرستك.'});d.posts.splice(i,1);saveJsonFile(schoolPostsFile,d);const sd=readSchoolSubmissions();sd.submissions=sd.submissions.filter(x=>x.postId!==id);saveJsonFile(schoolSubmissionsFile,sd);audit(ss.email,'school.post.delete',{schoolId:ss.schoolId,postId:id});return send(res,200,{deleted:true});}
  if(req.method==='GET'&&pathname==='/api/school-admin/years'){
    const ss=requireSchoolAdmin(req,res);if(!ss)return;
    const archives=readJsonFile(schoolArchivesFile,{archives:[]}).archives.filter(a=>a.schoolId===ss.schoolId).map(a=>({id:a.id,academicYear:a.academicYear,createdAt:a.createdAt,counts:a.counts,checksum:a.checksum}));
    const posts=readSchoolPosts().posts.filter(p=>p.schoolId===ss.schoolId),subs=readSchoolSubmissions().submissions.filter(x=>x.schoolId===ss.schoolId);
    const years=new Set([String(ss.school.schoolYear||'').trim(),...posts.map(p=>String(p.academicYear||ss.school.schoolYear||'').trim()),...subs.map(x=>String(x.academicYear||ss.school.schoolYear||'').trim())].filter(Boolean));
    return send(res,200,{currentYear:ss.school.schoolYear||'',years:[...years].map(y=>({academicYear:y,archived:archives.some(a=>a.academicYear===y),archive:archives.find(a=>a.academicYear===y)||null})),archives});
  }
  if(req.method==='POST'&&pathname==='/api/school-admin/years/archive'){
    const ss=requireSchoolAdmin(req,res);if(!ss)return;
    try{
      const b=await readBody(req,2000),year=String(b.academicYear||'').trim();if(!year||year.length>30)return send(res,400,{error:'حدد العام الدراسي المراد أرشفته.'});
      const db=readJsonFile(schoolArchivesFile,{archives:[]});if(db.archives.some(a=>a.schoolId===ss.schoolId&&a.academicYear===year))return send(res,409,{error:'توجد نسخة أرشيفية لهذا العام بالفعل. لن نستبدلها تلقائيًا حفاظًا على السجل التاريخي.'});
      const members=readSchoolMembers().members.filter(m=>m.schoolId===ss.schoolId).map(({id,schoolId,name,email,role,grade,section,subjects,status,active,createdAt,reviewedAt,updatedAt})=>({id,schoolId,name,email,role,grade,section,subjects,status,active,createdAt,reviewedAt,updatedAt})),posts=readSchoolPosts().posts.filter(p=>p.schoolId===ss.schoolId&&String(p.academicYear||ss.school.schoolYear||'')===year),postIds=new Set(posts.map(p=>p.id)),submissions=readSchoolSubmissions().submissions.filter(x=>x.schoolId===ss.schoolId&&(postIds.has(x.postId)||String(x.academicYear||ss.school.schoolYear||'')===year)),links=readGuardianLinks().links.filter(l=>l.schoolId===ss.schoolId);
      const snapshot={id:crypto.randomUUID(),schoolId:ss.schoolId,schoolName:ss.school.name,academicYear:year,createdAt:new Date().toISOString(),counts:{members:members.length,posts:posts.length,submissions:submissions.length,guardianLinks:links.length},data:{members,posts,submissions,guardianLinks:links}};
      snapshot.checksum=crypto.createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');db.archives.push(snapshot);saveJsonFile(schoolArchivesFile,db);audit(ss.email,'school.year.archive',{schoolId:ss.schoolId,academicYear:year,archiveId:snapshot.id,checksum:snapshot.checksum});
      return send(res,201,{archive:{id:snapshot.id,academicYear:year,createdAt:snapshot.createdAt,counts:snapshot.counts,checksum:snapshot.checksum}});
    }catch(e){return send(res,400,{error:e.message||'تعذّرت أرشفة العام الدراسي.'});}
  }
  if(req.method==='GET'&&pathname.startsWith('/api/school-admin/years/archive/')){
    const ss=requireSchoolAdmin(req,res);if(!ss)return;const id=decodeURIComponent(pathname.slice('/api/school-admin/years/archive/'.length)),a=readJsonFile(schoolArchivesFile,{archives:[]}).archives.find(x=>x.id===id&&x.schoolId===ss.schoolId);if(!a)return send(res,404,{error:'النسخة الأرشيفية غير موجودة في مدرستك.'});return send(res,200,{archive:a});
  }
  if(req.method==='GET'&&pathname==='/api/school-admin/reports/academic'){
    const ss=requireSchoolAdmin(req,res);if(!ss)return;
    const members=readSchoolMembers().members.filter(m=>m.schoolId===ss.schoolId&&m.role==='student'&&m.active&&m.status==='approved');
    const posts=readSchoolPosts().posts.filter(p=>p.schoolId===ss.schoolId&&p.type==='assignment'&&p.status==='published');
    const subs=readSchoolSubmissions().submissions.filter(s=>s.schoolId===ss.schoolId);
    const year=String(ss.school.schoolYear||'');
    const rows=members.map(m=>{const target=posts.filter(p=>(!p.grade||p.grade===m.grade)&&(!p.section||p.section===m.section));const studentSubs=target.map(p=>({post:p,sub:subs.find(z=>z.postId===p.id&&z.studentId===m.id)}));const graded=studentSubs.filter(z=>z.sub?.status==='graded'&&Number.isFinite(Number(z.sub.score)));const subjectMap={};for(const z of studentSubs){const subject=String(z.post.subject||'غير مصنّف');(subjectMap[subject]??={subject,total:0,submitted:0,graded:0,scores:[]});subjectMap[subject].total++;if(z.sub)subjectMap[subject].submitted++;if(z.sub?.status==='graded'&&Number.isFinite(Number(z.sub.score))){subjectMap[subject].graded++;subjectMap[subject].scores.push(Number(z.sub.score));}}return {id:m.id,name:m.name,email:m.email,grade:m.grade||'',section:m.section||'',assignments:target.length,submitted:studentSubs.filter(z=>z.sub).length,graded:graded.length,average:graded.length?Math.round(graded.reduce((a,z)=>a+Number(z.sub.score),0)/graded.length*10)/10:null,subjects:Object.values(subjectMap).map(v=>({subject:v.subject,total:v.total,submitted:v.submitted,graded:v.graded,average:v.scores.length?Math.round(v.scores.reduce((a,b)=>a+b,0)/v.scores.length*10)/10:null}))};});
    const subjectStats={};for(const row of rows)for(const v of row.subjects){const a=subjectStats[v.subject]??={subject:v.subject,students:0,assignments:0,submitted:0,graded:0,scores:[]};a.students++;a.assignments+=v.total;a.submitted+=v.submitted;a.graded+=v.graded;if(v.average!==null)a.scores.push(v.average);}
    return send(res,200,{school:{id:ss.schoolId,name:ss.school.name,schoolYear:year},summary:{students:rows.length,gradedStudents:rows.filter(r=>r.graded>0).length,assignments:posts.length,submissions:subs.filter(z=>posts.some(p=>p.id===z.postId)).length,gradedSubmissions:subs.filter(z=>z.status==='graded'&&posts.some(p=>p.id===z.postId)).length},students:rows,subjects:Object.values(subjectStats).map(a=>({subject:a.subject,students:a.students,assignments:a.assignments,submitted:a.submitted,graded:a.graded,average:a.scores.length?Math.round(a.scores.reduce((q,v)=>q+v,0)/a.scores.length*10)/10:null}))});
  }
  if(req.method==='GET'&&pathname==='/api/school-admin/submissions'){const ss=requireSchoolAdmin(req,res);if(!ss)return;const members=readSchoolMembers().members.filter(m=>m.schoolId===ss.schoolId),byId=new Map(members.map(m=>[m.id,m]));const posts=readSchoolPosts().posts.filter(p=>p.schoolId===ss.schoolId&&p.type==='assignment');const postIds=new Set(posts.map(p=>p.id));const submissions=readSchoolSubmissions().submissions.filter(x=>x.schoolId===ss.schoolId&&postIds.has(x.postId)).map(({attachmentFile,...x})=>({...x,hasAttachment:!!attachmentFile,attachmentUrl:attachmentFile?'/api/school-admin/submission-pdf/'+x.id:null,studentName:byId.get(x.studentId)?.name||'طالب'}));return send(res,200,{submissions,assignments:posts.map(p=>({id:p.id,title:p.title,grade:p.grade,section:p.section,dueAt:p.dueAt}))});}
  if(req.method==='GET'&&pathname.startsWith('/api/school-admin/submission-pdf/')){const ss=requireSchoolAdmin(req,res);if(!ss)return;const id=pathname.slice('/api/school-admin/submission-pdf/'.length),sub=readSchoolSubmissions().submissions.find(x=>x.id===id&&x.schoolId===ss.schoolId&&x.attachmentFile);if(!sub)return send(res,404,{error:'ملف الحل غير موجود.'});const file=path.join(submissionPdfDir,path.basename(sub.attachmentFile));if(!fs.existsSync(file))return send(res,404,{error:'ملف الحل غير متوفر على التخزين.'});res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':'inline; filename="submission.pdf"','X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store','X-Frame-Options':'SAMEORIGIN'});return fs.createReadStream(file).pipe(res);}
  if(req.method==='POST'&&pathname==='/api/school-admin/submissions/grade'){const ss=requireSchoolAdmin(req,res);if(!ss)return;try{const b=await readBody(req,4000),d=readSchoolSubmissions(),sub=d.submissions.find(x=>x.id===String(b.id||'')&&x.schoolId===ss.schoolId);if(!sub)return send(res,404,{error:'التسليم غير موجود في مدرستك.'});const score=Number(b.score);if(!Number.isFinite(score)||score<0||score>100)return send(res,400,{error:'أدخل درجة من 0 إلى 100.'});sub.score=score;sub.feedback=String(b.feedback||'').trim().slice(0,2000);sub.status='graded';sub.gradedAt=new Date().toISOString();sub.gradedBy=ss.schoolAdminId;saveJsonFile(schoolSubmissionsFile,d);audit(ss.email,'school.assignment.grade',{schoolId:ss.schoolId,submissionId:sub.id,score});return send(res,200,{submission:sub});}catch(e){return send(res,400,{error:e.message||'تعذّر حفظ الدرجة.'});}}
  if(req.method==='POST'&&pathname==='/api/school-member/assignment-pdf'){
    const ss=requireSchoolMember(req,res);if(!ss)return;
    if(ss.member.role!=='teacher')return send(res,403,{error:'إرفاق ملف الواجب متاح للمعلم فقط.'});
    try{const postId=String(new URL(req.url,'http://localhost').searchParams.get('postId')||'');const d=readSchoolPosts(),post=d.posts.find(p=>p.id===postId&&p.schoolId===ss.schoolId&&p.createdBy===ss.member.id&&p.type==='assignment');if(!post)return send(res,404,{error:'الواجب غير موجود أو ليس من منشوراتك.'});
      if(!/^application\/pdf(?:\s*;|$)/i.test(String(req.headers['content-type']||'')))return send(res,415,{error:'أرسل الملف بصيغة PDF.'});const buffer=await readRaw(req,12*1024*1024);if(buffer.length<8||buffer.subarray(0,5).toString()!=='%PDF-')return send(res,400,{error:'الملف لا يحمل توقيع PDF صالحًا.'});try{await pdfParse(buffer);}catch{return send(res,400,{error:'تعذّر قراءة بنية ملف PDF؛ أعد تصديره وحاول مجددًا.'});}
      const fileId=crypto.randomUUID()+'.pdf';fs.writeFileSync(path.join(assignmentPdfDir,fileId),buffer,{mode:0o600,flag:'wx'});post.attachmentFile=fileId;post.attachmentName='ملف الواجب.pdf';post.attachmentSize=buffer.length;post.attachmentUpdatedAt=new Date().toISOString();saveJsonFile(schoolPostsFile,d);audit(ss.member.email,'school.assignment.pdf.attach',{schoolId:ss.schoolId,postId});return send(res,201,{attached:true,attachmentUrl:'/api/school-member/assignment-pdf/'+post.id});
    }catch(e){return send(res,e.status||400,{error:e.message||'تعذّر إرفاق ملف الواجب.'});}
  }
  if(req.method==='GET'&&pathname.startsWith('/api/school-member/assignment-pdf/')){
    const ss=requireSchoolMember(req,res);if(!ss)return;const postId=pathname.slice('/api/school-member/assignment-pdf/'.length);const post=readSchoolPosts().posts.find(p=>p.id===postId&&p.schoolId===ss.schoolId&&p.type==='assignment'&&p.attachmentFile);if(!post)return send(res,404,{error:'ملف الواجب غير موجود.'});
    if(ss.member.role==='student'&&((post.grade&&post.grade!==ss.member.grade)||(post.section&&post.section!==ss.member.section)||post.status!=='published'))return send(res,403,{error:'لا تملك صلاحية معاينة هذا الواجب.'});if(ss.member.role==='teacher'&&post.createdBy!==ss.member.id)return send(res,403,{error:'يمكنك معاينة ملفات الواجبات التي نشرتها فقط.'});
    const file=path.join(assignmentPdfDir,path.basename(post.attachmentFile));if(!fs.existsSync(file))return send(res,404,{error:'ملف الواجب غير متوفر على التخزين.'});res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':'inline; filename="assignment.pdf"','X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store','X-Frame-Options':'SAMEORIGIN'});return fs.createReadStream(file).pipe(res);
  }
  if(req.method==='POST'&&pathname==='/api/school-member/submission-pdf'){
    const ss=requireSchoolMember(req,res);if(!ss)return;if(ss.member.role!=='student')return send(res,403,{error:'رفع الحل متاح لحساب الطالب فقط.'});
    try{const postId=String(new URL(req.url,'http://localhost').searchParams.get('postId')||''),post=readSchoolPosts().posts.find(p=>p.id===postId&&p.schoolId===ss.schoolId&&p.type==='assignment'&&p.status==='published');if(!post)return send(res,404,{error:'الواجب غير موجود أو غير متاح.'});if((post.grade&&post.grade!==ss.member.grade)||(post.section&&post.section!==ss.member.section))return send(res,403,{error:'هذا الواجب غير موجه إلى صفك أو شعبتك.'});if(!/^application\/pdf(?:\s*;|$)/i.test(String(req.headers['content-type']||'')))return send(res,415,{error:'أرسل الحل بصيغة PDF.'});const buffer=await readRaw(req,12*1024*1024);if(buffer.length<8||buffer.subarray(0,5).toString()!=='%PDF-')return send(res,400,{error:'الملف لا يحمل توقيع PDF صالحًا.'});try{await pdfParse(buffer);}catch{return send(res,400,{error:'تعذّر قراءة بنية ملف PDF؛ أعد تصديره وحاول مجددًا.'});}
      const fileId=crypto.randomUUID()+'.pdf';fs.writeFileSync(path.join(submissionPdfDir,fileId),buffer,{mode:0o600,flag:'wx'});const d=readSchoolSubmissions();let sub=d.submissions.find(x=>x.postId===post.id&&x.studentId===ss.member.id);if(sub){if(sub.attachmentFile){try{fs.unlinkSync(path.join(submissionPdfDir,path.basename(sub.attachmentFile)))}catch{}}sub.attachmentFile=fileId;sub.attachmentName='حل الواجب.pdf';sub.attachmentSize=buffer.length;sub.updatedAt=new Date().toISOString();sub.status='submitted';sub.score=null;sub.feedback='';sub.gradedAt=null;}else{sub={id:crypto.randomUUID(),schoolId:ss.schoolId,academicYear:String(post.academicYear||ss.school.schoolYear||''),postId:post.id,studentId:ss.member.id,answer:'',attachmentFile:fileId,attachmentName:'حل الواجب.pdf',attachmentSize:buffer.length,status:'submitted',submittedAt:new Date().toISOString(),score:null,feedback:'',gradedAt:null};d.submissions.push(sub);}saveJsonFile(schoolSubmissionsFile,d);audit(ss.member.email,'school.assignment.pdf.submit',{schoolId:ss.schoolId,postId});return send(res,201,{submission:{id:sub.id,status:sub.status,submittedAt:sub.submittedAt||sub.updatedAt,attachmentUrl:'/api/school-member/submission-pdf/'+sub.id}});
    }catch(e){return send(res,e.status||400,{error:e.message||'تعذّر تسليم ملف الحل.'});}
  }
  if(req.method==='GET'&&pathname.startsWith('/api/school-member/submission-pdf/')){
    const ss=requireSchoolMember(req,res);if(!ss)return;const id=pathname.slice('/api/school-member/submission-pdf/'.length),sub=readSchoolSubmissions().submissions.find(x=>x.id===id&&x.schoolId===ss.schoolId&&x.attachmentFile);if(!sub)return send(res,404,{error:'ملف الحل غير موجود.'});const post=readSchoolPosts().posts.find(p=>p.id===sub.postId&&p.schoolId===ss.schoolId);if(!post)return send(res,404,{error:'الواجب المرتبط بالحل غير موجود.'});if(ss.member.role==='student'&&sub.studentId!==ss.member.id)return send(res,403,{error:'لا تملك صلاحية معاينة هذا الحل.'});if(ss.member.role==='teacher'&&post.createdBy!==ss.member.id)return send(res,403,{error:'يمكنك معاينة حلول الواجبات التي نشرتها فقط.'});const file=path.join(submissionPdfDir,path.basename(sub.attachmentFile));if(!fs.existsSync(file))return send(res,404,{error:'ملف الحل غير متوفر على التخزين.'});res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':'inline; filename="submission.pdf"','X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store','X-Frame-Options':'SAMEORIGIN'});return fs.createReadStream(file).pipe(res);
  }
  if(req.method==='POST'&&pathname==='/api/school-member/submissions'){const ss=requireSchoolMember(req,res);if(!ss)return;if(ss.member.role!=='student')return send(res,403,{error:'تسليم الواجبات متاح لحساب الطالب فقط.'});try{const b=await readBody(req,12000),post=readSchoolPosts().posts.find(p=>p.id===String(b.postId||'')&&p.schoolId===ss.school.id&&p.type==='assignment'&&p.status==='published');if(!post)return send(res,404,{error:'الواجب غير موجود أو غير متاح.'});if((post.grade&&post.grade!==ss.member.grade)||(post.section&&post.section!==ss.member.section))return send(res,403,{error:'هذا الواجب غير موجه إلى صفك أو شعبتك.'});const answer=String(b.answer||'').trim();const d=readSchoolSubmissions();const prior=d.submissions.find(x=>x.postId===post.id&&x.studentId===ss.member.id);if(!answer&&!prior?.attachmentFile)return send(res,400,{error:'اكتب إجابتك أو أرفق ملف PDF للحل.'});let sub=d.submissions.find(x=>x.postId===post.id&&x.studentId===ss.member.id);if(sub){if(answer)sub.answer=answer.slice(0,10000);sub.updatedAt=new Date().toISOString();sub.status='submitted';sub.score=null;sub.feedback='';sub.gradedAt=null;}else{sub={id:crypto.randomUUID(),schoolId:ss.school.id,academicYear:String(post.academicYear||ss.school.schoolYear||''),postId:post.id,studentId:ss.member.id,answer:answer.slice(0,10000),status:'submitted',submittedAt:new Date().toISOString(),score:null,feedback:'',gradedAt:null};d.submissions.push(sub);}saveJsonFile(schoolSubmissionsFile,d);audit(ss.member.email,'school.assignment.submit',{schoolId:ss.school.id,postId:post.id});return send(res,201,{submission:{id:sub.id,status:sub.status,submittedAt:sub.submittedAt||sub.updatedAt}});}catch(e){return send(res,400,{error:e.message||'تعذّر تسليم الواجب.'});}}
  if(req.method==='GET'&&pathname==='/api/school-member/submissions'){const ss=requireSchoolMember(req,res);if(!ss)return;if(ss.member.role!=='student')return send(res,403,{error:'هذه الوظيفة مخصصة للطلاب.'});const threshold=Number.isFinite(Number(ss.school.resultBalanceThreshold))?Number(ss.school.resultBalanceThreshold):-1;let remaining=0;if(threshold>=0){const fees=readJsonFile(schoolFeesFile,{types:[],payments:[],assessments:[]});fees.assessments||=[];const types=(fees.types||[]).filter(t=>t.schoolId===ss.school.id&&t.active!==false);const payments=(fees.payments||[]).filter(p=>p.schoolId===ss.school.id&&p.studentId===ss.member.id);remaining=types.reduce((sum,t)=>{const a=fees.assessments.find(x=>x.schoolId===ss.school.id&&x.studentId===ss.member.id&&x.typeId===t.id),due=Number(a?a.amount:t.defaultAmount||0),paid=payments.filter(p=>p.typeId===t.id).reduce((n,p)=>n+Number(p.amount||0),0);return sum+Math.max(0,Math.round((due-paid)*100)/100)},0);}const resultHeld=threshold>=0&&remaining>threshold;const posts=readSchoolSubmissions().submissions.filter(x=>x.schoolId===ss.school.id&&x.studentId===ss.member.id).map(({attachmentFile,...x})=>({...x,score:resultHeld&&x.status==='graded'?null:x.score,feedback:resultHeld&&x.status==='graded'?'':x.feedback,resultsHidden:resultHeld&&x.status==='graded',attachmentUrl:attachmentFile?'/api/school-member/submission-pdf/'+x.id:null}));return send(res,200,{submissions:posts,resultHold:resultHeld?{held:true,threshold,remaining,message:'النتائج محجوبة مؤقتًا وفق إعدادات المدرسة بسبب وجود رسوم مستحقة. يرجى مراجعة إدارة المدرسة.'}:{held:false}});}
  // Guardian requests are deliberately reviewed by the school before any student data is exposed.
  if(req.method==='POST'&&pathname==='/api/parent/guardian-links/request'){
    const limit=rateLimit(req,'guardian-link-request',8);if(!limit.allowed){res.setHeader('Retry-After',String(limit.retryAfter));return send(res,429,{error:'أرسلت طلبات ربط كثيرة. انتظر قليلًا ثم حاول مجددًا.'});}
    const session=sessionParent(req);if(!session)return send(res,401,{error:'سجّل الدخول بحساب ولي الأمر أولًا.'});
    try{const b=await readBody(req,5000),schoolId=String(b.schoolId||''),studentEmail=String(b.studentEmail||'').trim().toLowerCase(),relationship=['أب','أم','ولي أمر','أخرى'].includes(String(b.relationship||''))?String(b.relationship):'ولي أمر';
      const school=readSchools().schools.find(x=>x.id===schoolId&&x.active);if(!school)return send(res,404,{error:'المدرسة غير موجودة أو غير مفعّلة.'});
      if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(studentEmail))return send(res,400,{error:'أدخل البريد الإلكتروني الذي يستخدمه الطالب في حساب المدرسة.'});
      const d=readGuardianLinks();const existing=d.links.find(x=>x.accountId===session.accountId&&x.schoolId===schoolId&&x.studentEmail===studentEmail&&['pending','approved'].includes(x.status));
      if(existing)return send(res,200,{submitted:true,status:existing.status,message:existing.status==='approved'?'هذا الطالب مرتبط بحسابك بالفعل.':'طلب الربط موجود وبانتظار مراجعة المدرسة.'});
      const link={id:crypto.randomUUID(),accountId:session.accountId,schoolId,studentEmail,studentId:null,relationship, status:'pending',requestedAt:new Date().toISOString(),reviewedAt:null,reviewedBy:null};d.links.push(link);saveGuardianLinks(d);const a=readAccounts().accounts.find(x=>x.id===session.accountId);audit(a?.email||session.accountId,'guardian.link.request',{schoolId,studentEmail});return send(res,201,{submitted:true,status:'pending',message:'أرسلنا طلب الربط إلى إدارة المدرسة. لن تظهر بيانات الطالب قبل اعتماد الطلب.'});
    }catch(e){return send(res,e.status||400,{error:e.message||'تعذّر إرسال طلب الربط.'});}
  }
  if(req.method==='GET'&&pathname==='/api/parent/guardian-links'){
    const session=sessionParent(req);if(!session)return send(res,401,{error:'سجّل الدخول بحساب ولي الأمر أولًا.'});
    const links=readGuardianLinks().links.filter(x=>x.accountId===session.accountId);const schools=readSchools().schools;const members=readSchoolMembers().members;const posts=readSchoolPosts().posts;const subs=readSchoolSubmissions().submissions;
    const result=links.map(l=>{const school=schools.find(x=>x.id===l.schoolId);const student=l.status==='approved'?members.find(m=>m.id===l.studentId&&m.schoolId===l.schoolId&&m.role==='student'&&m.active&&m.status==='approved'):null;let assignments=[];if(student){const targeted=posts.filter(p=>p.schoolId===l.schoolId&&p.status==='published'&&p.type==='assignment'&&(!p.grade||p.grade===student.grade)&&(!p.section||p.section===student.section));assignments=targeted.map(p=>{const sub=subs.find(x=>x.schoolId===l.schoolId&&x.postId===p.id&&x.studentId===student.id);return {id:p.id,title:p.title,subject:p.subject||'',dueAt:p.dueAt||'',status:sub?.status||'not_submitted',score:sub?.status==='graded'?sub.score:null,feedback:sub?.status==='graded'?sub.feedback:'',submittedAt:sub?.submittedAt||sub?.updatedAt||null};});}
      const subjectMap={};for(const a of assignments){const subject=a.subject||'غير مصنّف';(subjectMap[subject]??={subject,total:0,submitted:0,graded:0,scores:[]});const z=subjectMap[subject];z.total++;if(a.status!=='not_submitted')z.submitted++;if(a.status==='graded'&&Number.isFinite(Number(a.score))){z.graded++;z.scores.push(Number(a.score));}}const progress=Object.values(subjectMap).map(z=>({subject:z.subject,total:z.total,submitted:z.submitted,graded:z.graded,average:z.scores.length?Math.round(z.scores.reduce((a,b)=>a+b,0)/z.scores.length*10)/10:null}));return {id:l.id,schoolId:l.schoolId,schoolName:school?.name||'مدرسة غير متاحة',studentEmail:l.studentEmail,relationship:l.relationship,status:l.status,requestedAt:l.requestedAt,reviewedAt:l.reviewedAt,student:student?{id:student.id,name:student.name,grade:student.grade,section:student.section}:null,assignments,progress};});return send(res,200,{links:result});
  }
  if(req.method==='GET'&&pathname==='/api/school-admin/guardian-links'){
    const ss=requireSchoolAdmin(req,res);if(!ss)return;const links=readGuardianLinks().links.filter(x=>x.schoolId===ss.schoolId);const accounts=readAccounts().accounts;const members=readSchoolMembers().members;return send(res,200,{links:links.map(l=>({id:l.id,studentEmail:l.studentEmail,relationship:l.relationship,status:l.status,requestedAt:l.requestedAt,reviewedAt:l.reviewedAt,parentEmail:accounts.find(a=>a.id===l.accountId)?.email||'حساب ولي أمر',studentName:members.find(m=>m.id===l.studentId)?.name||''}))});
  }
  if(req.method==='POST'&&pathname==='/api/school-admin/guardian-links/review'){
    const ss=requireSchoolAdmin(req,res);if(!ss)return;try{const b=await readBody(req,3000),d=readGuardianLinks(),link=d.links.find(x=>x.id===String(b.id||'')&&x.schoolId===ss.schoolId);if(!link)return send(res,404,{error:'طلب الربط غير موجود في مدرستك.'});if(!['approve','reject'].includes(b.action))return send(res,400,{error:'الإجراء غير معروف.'});if(b.action==='approve'){const student=readSchoolMembers().members.find(m=>m.schoolId===ss.schoolId&&m.role==='student'&&m.active&&m.status==='approved'&&m.email===link.studentEmail);if(!student)return send(res,409,{error:'لا يوجد طالب معتمد في مدرستك بهذا البريد. تحقق من البريد أو اعتمد حساب الطالب أولًا.'});const duplicate=d.links.find(x=>x.id!==link.id&&x.accountId===link.accountId&&x.schoolId===ss.schoolId&&x.studentId===student.id&&x.status==='approved');if(duplicate)return send(res,409,{error:'هذا الطالب مرتبط بحساب ولي الأمر بالفعل.'});link.studentId=student.id;link.status='approved';}else{link.status='rejected';link.studentId=null;}link.reviewedAt=new Date().toISOString();link.reviewedBy=ss.schoolAdminId;saveGuardianLinks(d);audit(ss.email,'guardian.link.review',{schoolId:ss.schoolId,linkId:link.id,action:b.action});return send(res,200,{id:link.id,status:link.status});}catch(e){return send(res,e.status||400,{error:e.message||'تعذّرت مراجعة طلب الربط.'});}
  }
  if(req.method==='GET'&&pathname==='/api/schools'){return send(res,200,{schools:readSchools().schools.filter(x=>x.active).map(publicSchool)});}
  if(req.method==='GET'&&pathname.startsWith('/api/schools/')&&pathname.endsWith('/posts')){const id=pathname.slice('/api/schools/'.length,-'/posts'.length).replace(/\/$/,'');const ss=sessionSchoolAdmin(req);if(!ss)return send(res,401,{error:'يتطلب عرض منشورات المدرسة تسجيل الدخول بحساب مخوّل.'});if(ss.schoolId!==id)return send(res,403,{error:'لا تملك صلاحية الوصول إلى منشورات هذه المدرسة.'});const school=readSchools().schools.find(x=>x.id===id&&x.active);if(!school)return send(res,404,{error:'المدرسة غير موجودة.'});const posts=readSchoolPosts().posts.filter(p=>p.schoolId===id&&p.status==='published');return send(res,200,{school:publicSchool(school),posts});}
  if(req.method==='GET'&&pathname==='/api/admin/teachers'){if(!requireAdmin(req,res))return;return send(res,200,{teachers:readTeachers().teachers.map(({id,email,name,active,createdAt})=>({id,email,name,active,createdAt}))});}
  if(req.method==='POST'&&pathname==='/api/admin/teachers'){if(!requireAdmin(req,res))return;try{const b=await readBody(req,8000);const email=String(b.email||'').trim().toLowerCase(),name=String(b.name||'').trim().slice(0,100),password=String(b.password||'');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!name||password.length<8||password.length>128)return send(res,400,{error:'أدخل اسمًا وبريدًا صحيحًا وكلمة مرور من 8 خانات على الأقل.'});const d=readTeachers();if(d.teachers.some(t=>t.email===email))return send(res,409,{error:'يوجد حساب معلّم بهذا البريد.'});const salt=crypto.randomBytes(16).toString('hex'),hash=await scrypt(password,salt,64);const t={id:crypto.randomUUID(),email,name,salt,hash:hash.toString('hex'),active:true,createdAt:new Date().toISOString()};d.teachers.push(t);saveTeachers(d);audit(String(process.env.ADMIN_EMAIL||'admin'),'teacher.create',{email,name});return send(res,201,{id:t.id,email:t.email,name:t.name,active:true});}catch(e){return send(res,e.status||400,{error:e.message||'تعذّر إنشاء حساب المعلم.'});}}
  if(req.method==='POST'&&pathname==='/api/admin/teachers/status'){if(!requireAdmin(req,res))return;try{const b=await readBody(req,3000),d=readTeachers(),t=d.teachers.find(x=>x.id===String(b.id||''));if(!t)return send(res,404,{error:'حساب المعلم غير موجود.'});t.active=b.active===true;saveTeachers(d);for(const [token,ss] of teacherSessions)if(ss.teacherId===t.id){teacherSessions.delete(token);}saveTeacherSessions();audit(String(process.env.ADMIN_EMAIL||'admin'),'teacher.status',{email:t.email,active:t.active});return send(res,200,{id:t.id,active:t.active});}catch(e){return send(res,400,{error:'تعذّر تحديث الحساب.'});}}
  if(req.method==='GET'&&pathname==='/api/admin/audit'){if(!requireAdmin(req,res))return;let rows=[];try{rows=JSON.parse(fs.readFileSync(auditFile,'utf8'));}catch{}return send(res,200,{events:rows.slice(0,200)});}
  if(req.method==='POST'&&pathname==='/api/teacher/login'){const lim=rateLimit(req,'teacher-login',8);if(!lim.allowed){res.setHeader('Retry-After',String(lim.retryAfter));return send(res,429,{error:'محاولات كثيرة. انتظر قبل إعادة المحاولة.'});}try{const b=await readBody(req,5000),email=String(b.email||'').trim().toLowerCase(),password=String(b.password||''),t=readTeachers().teachers.find(x=>x.email===email);const salt=t?.salt||'00000000000000000000000000000000',expected=t?.hash?Buffer.from(t.hash,'hex'):Buffer.alloc(64),hash=await scrypt(password,salt,64);if(!t||!t.active||expected.length!==hash.length||!crypto.timingSafeEqual(hash,expected))return send(res,401,{error:'بيانات الدخول غير صحيحة أو الحساب غير مفعّل.'});const token=crypto.randomBytes(32).toString('hex');teacherSessions.set(token,{teacherId:t.id,role:'teacher',expires:Date.now()+8*60*60*1000});saveTeacherSessions();teacherCookie(res,token,8*60*60);audit(t.email,'teacher.login');return send(res,200,{authenticated:true,name:t.name,email:t.email,role:'teacher'});}catch(e){return send(res,e.status||400,{error:e.message||'تعذّر تسجيل الدخول.'});}}
  if(req.method==='GET'&&pathname==='/api/teacher/me'){const ss=sessionTeacher(req);if(!ss)return send(res,200,{authenticated:false});const t=readTeachers().teachers.find(x=>x.id===ss.teacherId&&x.active);return send(res,200,{authenticated:!!t,name:t?.name,email:t?.email,role:t?'teacher':null});}
  if(req.method==='POST'&&pathname==='/api/teacher/logout'){const ss=sessionTeacher(req);if(ss){teacherSessions.delete(ss.token);saveTeacherSessions();}teacherCookie(res,'',0);return send(res,200,{authenticated:false});}
  if(req.method==='GET'&&pathname==='/api/teacher/drafts'){const ss=requireTeacher(req,res);if(!ss)return;const d=readData();return send(res,200,{lessons:d.lessons.filter(l=>l.createdBy===ss.teacherId).map(({id,title,subject,grade,status,createdAt})=>({id,title,subject,grade,status,createdAt}))});}
  if(req.method==='POST'&&pathname==='/api/teacher/drafts'){const ss=requireTeacher(req,res);if(!ss)return;try{const b=await readBody(req,20000),title=String(b.title||'').trim(),content=String(b.content||'').trim();if(!title||!content)return send(res,400,{error:'عنوان الدرس وشرحه مطلوبان.'});const d=readData();const lesson={id:crypto.randomUUID(),createdAt:new Date().toISOString(),createdBy:ss.teacherId,createdByRole:'teacher',title:title.slice(0,180),content:content.slice(0,12000),grade:String(b.grade||'').slice(0,80),subject:String(b.subject||'').slice(0,80),status:'draft',reviewRequired:true};d.lessons.unshift(lesson);writeFileAtomic(dataFile,JSON.stringify(d,null,2),{mode:0o600});audit(ss.email,'lesson.draft.create',{id:lesson.id,title:lesson.title});return send(res,201,{id:lesson.id,status:'draft',message:'حُفظ الدرس كمسودة تنتظر مراجعة المدير.'});}catch(e){return send(res,e.status||400,{error:e.message||'تعذّر حفظ المسودة.'});}}
  if(req.method==='POST' && pathname==='/api/parent/login'){const r=rateLimit(req,'login',LOGIN_LIMIT);if(!r.allowed){res.setHeader('Retry-After',String(r.retryAfter));return send(res,429,{error:'محاولات تسجيل الدخول كثيرة. انتظر قليلًا ثم حاول مجددًا.'});}}
  if(pathname==='/api/parent/register'&&req.method==='POST'){const r=rateLimit(req,'register',REGISTER_LIMIT);if(!r.allowed){res.setHeader('Retry-After',String(r.retryAfter));return send(res,429,{error:'طلبات إنشاء الحساب كثيرة. انتظر قليلًا ثم حاول مجددًا.'});}}
  if(req.method==='POST' && pathname==='/api/parent/register'){
    try{const b=await readBody(req,5000);const email=String(b.email||'').trim().toLowerCase();const password=String(b.password||'');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return send(res,400,{error:'أدخل بريدًا إلكترونيًا صحيحًا.'});if(password.length<8||password.length>128)return send(res,400,{error:'اجعل كلمة المرور 8 خانات على الأقل، وبحد أقصى 128 خانة.'});const db=readAccounts();if(db.accounts.some(a=>a.email===email))return send(res,409,{error:'يوجد حساب بهذا البريد بالفعل. سجّل الدخول بدلًا من ذلك.'});const salt=crypto.randomBytes(16).toString('hex');const hash=await scrypt(password,salt,64);const account={id:crypto.randomUUID(),email,salt,hash:hash.toString('hex'),profiles:[],createdAt:new Date().toISOString()};db.accounts.push(account);saveAccounts(db);const token=crypto.randomBytes(32).toString('hex');parentSessions.set(token,{accountId:account.id,expires:Date.now()+7*24*60*60*1000});saveSessions();cookie(res,token,7*24*60*60);return send(res,201,{authenticated:true,email,profiles:[]});}catch(e){return send(res,e.status||400,{error:e.message||'تعذّر إنشاء الحساب.'});}
  }
  if(req.method==='POST' && pathname==='/api/parent/login'){
    try{const b=await readBody(req,5000);const email=String(b.email||'').trim().toLowerCase();const password=String(b.password||'');const db=readAccounts();const account=db.accounts.find(a=>a.email===email);const salt=account?.salt||'00000000000000000000000000000000';const expected=account?.hash?Buffer.from(account.hash,'hex'):Buffer.alloc(64);const hash=await scrypt(password,salt,64);if(!account||expected.length!==hash.length||!crypto.timingSafeEqual(hash,expected))return send(res,401,{error:'البريد أو كلمة المرور غير صحيحة.'});const token=crypto.randomBytes(32).toString('hex');parentSessions.set(token,{accountId:account.id,expires:Date.now()+7*24*60*60*1000});saveSessions();cookie(res,token,7*24*60*60);return send(res,200,{authenticated:true,email,profiles:account.profiles||[]});}catch(e){return send(res,e.status||400,{error:e.message||'تعذّر تسجيل الدخول.'});}
  }
  if(req.method==='POST' && pathname==='/api/parent/logout'){const session=sessionParent(req);if(session){parentSessions.delete(session.token);saveSessions();}cookie(res,'',0);return send(res,200,{authenticated:false});}
  if(req.method==='GET' && pathname==='/api/parent/me'){const session=sessionParent(req);if(!session)return send(res,200,{authenticated:false});const a=readAccounts().accounts.find(x=>x.id===session.accountId);if(!a)return send(res,200,{authenticated:false});return send(res,200,{authenticated:true,email:a.email,profiles:a.profiles||[]});}
  if((req.method==='PUT'||req.method==='POST') && pathname==='/api/parent/profiles'){
    const session=sessionParent(req);if(!session)return send(res,401,{error:'سجّل الدخول أولًا لحفظ ملفات الأطفال على الخادم.'});
    try{const b=await readBody(req,200000);if(!Array.isArray(b.profiles)||b.profiles.length<1||b.profiles.length>8)return send(res,400,{error:'يجب إرسال ملف طفل واحد على الأقل وبحد أقصى 8 ملفات.'});const profiles=b.profiles.map(p=>({id:String(p.id||'').slice(0,100),name:String(p.name||'الطفل').trim().slice(0,40)||'الطفل',progress:{completed:Array.isArray(p.progress?.completed)?p.progress.completed.map(x=>String(x).slice(0,120)).slice(0,500):[],attempts:Math.max(0,Math.min(100000,Number(p.progress?.attempts)||0)),correct:Math.max(0,Math.min(100000,Number(p.progress?.correct)||0)),name:String(p.progress?.name||'').slice(0,40),lessonStats:p.progress?.lessonStats&&typeof p.progress.lessonStats==='object'?Object.fromEntries(Object.entries(p.progress.lessonStats).slice(0,500).map(([k,v])=>[String(k).slice(0,120),{title:String(v.title||'درس').slice(0,180),attempts:Math.max(0,Number(v.attempts)||0),correct:Math.max(0,Number(v.correct)||0),wrong:Math.max(0,Number(v.wrong)||0),lastAttempt:typeof v.lastAttempt==='string'?v.lastAttempt.slice(0,40):null,lastCorrect:typeof v.lastCorrect==='boolean'?v.lastCorrect:null}])):{},answerHistory:Array.isArray(p.progress?.answerHistory)?p.progress.answerHistory.slice(0,100).map(a=>({id:String(a.id||'').slice(0,100),lessonId:String(a.lessonId||'').slice(0,120),lessonTitle:String(a.lessonTitle||'درس').slice(0,180),question:String(a.question||'').slice(0,500),chosen:String(a.chosen||'').slice(0,250),expected:String(a.expected||'').slice(0,250),correct:!!a.correct,at:typeof a.at==='string'?a.at.slice(0,40):null})):[]}}));if(profiles.some(p=>!p.id))return send(res,400,{error:'أحد ملفات الأطفال لا يحتوي على معرّف صالح.'});const db=readAccounts();const a=db.accounts.find(x=>x.id===session.accountId);if(!a)return send(res,401,{error:'انتهت الجلسة. سجّل الدخول مجددًا.'});a.profiles=profiles;a.updatedAt=new Date().toISOString();saveAccounts(db);return send(res,200,{saved:true,profiles:a.profiles});}catch(e){return send(res,e.status||400,{error:e.message||'تعذّر حفظ الملفات.'});}
  }
  if(req.method==='GET'&&pathname==='/api/admin/teacher-drafts'){if(!requireAdmin(req,res))return;const d=readData();return send(res,200,{lessons:d.lessons.filter(l=>l.createdByRole==='teacher').map(l=>({...l,createdByName:readTeachers().teachers.find(t=>t.id===l.createdBy)?.name||'معلّم'}))});}
  if(req.method==='POST'&&pathname==='/api/admin/teacher-drafts/review'){if(!requireAdmin(req,res))return;try{const b=await readBody(req,3000),d=readData(),l=d.lessons.find(x=>x.id===String(b.id||'')&&x.createdByRole==='teacher');if(!l)return send(res,404,{error:'مسودة المعلم غير موجودة.'});if(b.action==='approve'){l.status='approved';l.reviewRequired=false;l.reviewedAt=new Date().toISOString();}else if(b.action==='reject'){l.status='rejected';l.reviewRequired=true;}else return send(res,400,{error:'الإجراء غير معروف.'});writeFileAtomic(dataFile,JSON.stringify(d,null,2),{mode:0o600});audit(String(process.env.ADMIN_EMAIL||'admin'),'teacher.lesson.review',{id:l.id,action:b.action,title:l.title});return send(res,200,{id:l.id,status:l.status});}catch(e){return send(res,400,{error:'تعذّرت مراجعة المسودة.'});}}
  if(req.method==='DELETE' && pathname.startsWith('/api/admin/content/books/')){
    if(!requireAdmin(req,res))return;
    const id=pathname.slice('/api/admin/content/books/'.length).replace(/[^a-zA-Z0-9_-]/g,'');
    const db=readData(); const index=(db.books||[]).findIndex(b=>b.id===id);
    if(index<0)return send(res,404,{error:'الكتاب غير موجود.'});
    const [book]=db.books.splice(index,1);
    // Remove linked curriculum units/lessons so deleted books cannot remain visible elsewhere.
    const removedLessonIds=new Set((db.lessons||[]).filter(l=>l.sourceBookId===id).map(l=>l.id));
    db.lessons=(db.lessons||[]).filter(l=>l.sourceBookId!==id);
    db.units=(db.units||[]).filter(u=>u.bookId!==id);
    db.plans=(db.plans||[]).filter(p=>p.bookId!==id);
    writeFileAtomic(dataFile,JSON.stringify(db,null,2),{mode:0o600});
    if(book.fileName){const file=path.join(uploadDir,path.basename(book.fileName));try{if(fs.existsSync(file))fs.unlinkSync(file)}catch(e){console.error('Could not remove deleted curriculum PDF:',e.message)}}
    audit(String(process.env.ADMIN_EMAIL||'admin'),'curriculum.delete',{bookId:id,title:book.title,removedLessons:removedLessonIds.size});
    return send(res,200,{deleted:true,bookId:id});
  }
  if(req.method==='GET' && pathname==='/api/admin/content'){if(!requireAdmin(req,res))return;return send(res,200,readData());}
  if(req.method==='GET' && pathname==='/api/content'){const db=readData();db.books=(db.books||[]).map(({extractedText,...b})=>b);db.lessons=(db.lessons||[]).filter(l=>l.createdByRole!=='teacher'||l.status==='approved').filter(l=>!l.sourceBookId||l.status==='approved').map(l=>({...l,quizQuestions:(l.quizQuestions||[]).filter(q=>q.status==='approved')}));db.units=(db.units||[]).filter(u=>u.status==='approved');return send(res,200,db);}
  if(req.method==='POST' && pathname==='/api/curriculum/organize'){
    if(!requireAdmin(req,res))return;
    try{
      const body=await readBody(req,30000); const db=readData(); const book=db.books.find(b=>b.id===String(body.bookId||''));
      if(!book||!book.extractedText) return send(res,404,{error:'لم نجد كتابًا يحتوي على نص مستخرج.'});
      const titles=(Array.isArray(body.outline)?body.outline:[]).map(x=>String(typeof x==='string'?x:x.title||'').trim()).filter(x=>x.length>1&&x.length<180).slice(0,100);
      if(!titles.length) return send(res,400,{error:'أضف عنوان وحدة أو درس واحدًا على الأقل قبل التنظيم.'});
      const full=String(book.extractedText); const found=titles.map(title=>({title,index:full.indexOf(title)})).filter(x=>x.index>=0).sort((a,b)=>a.index-b.index);
      const unique=[]; for(const h of found) if(!unique.length||unique[unique.length-1].title!==h.title) unique.push(h);
      const units=[]; const newLessons=[]; let currentUnit=null;
      for(let i=0;i<unique.length;i++){
        const h=unique[i]; const normalized=h.title.replace(/[\s:：-]+$/,'');
        const isUnit=/^(الوحدة|الفصل|الباب|القسم)(?:\s|$)|^(unit|chapter)(?:\s|$)/i.test(normalized);
        const nextIndex=i+1<unique.length?unique[i+1].index:Math.min(full.length,h.index+7000);
        const start=h.index+h.title.length; let content=full.slice(start,nextIndex).replace(/^\s*[\r\n:：-]+/,'').trim().slice(0,7000);
        if(isUnit){ currentUnit={id:'u-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6),bookId:book.id,title:normalized,grade:book.grade||'',subject:book.subject||'',status:'draft',reviewRequired:true,createdAt:new Date().toISOString()}; units.push(currentUnit); }
        else {
          if(!currentUnit){currentUnit={id:'u-'+Date.now().toString(36)+'-general',bookId:book.id,title:'دروس غير مصنفة',grade:book.grade||'',subject:book.subject||'',status:'draft',reviewRequired:true,createdAt:new Date().toISOString()};units.push(currentUnit);}
          if(content.length<80) content='لم يُستخرج نص كافٍ بعد هذا العنوان. افتح الكتاب وراجع الصفحة يدويًا ثم أكمل محتوى الدرس.';
          newLessons.push({id:'l-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),createdAt:new Date().toISOString(),title:normalized,grade:book.grade||'',subject:book.subject||'عام',content,sourceBookId:book.id,sourceBookTitle:book.title,unitId:currentUnit.id,unitTitle:currentUnit.title,status:'draft',reviewRequired:true,question:'',answers:[],correct:0});
        }
      }
      if(!unique.length) return send(res,422,{error:'لم نعثر على العناوين المقترحة داخل نص الكتاب. عدّل العناوين أو راجع النص المستخرج.'});
      db.units=(db.units||[]).filter(u=>u.bookId!==book.id).concat(units);
      db.lessons=(db.lessons||[]).filter(l=>l.sourceBookId!==book.id).concat(newLessons);
      book.units=units; book.organizedAt=new Date().toISOString(); book.outline=(Array.isArray(body.outline)?body.outline:[]).map((x,i)=>({id:'outline-'+i,title:String(typeof x==='string'?x:x.title||'').trim()})).filter(x=>x.title);
      writeFileAtomic(dataFile,JSON.stringify(db,null,2));
      return send(res,200,{bookId:book.id,unitsCreated:units.length,lessonsCreated:newLessons.length,reviewRequired:true,message:'تم إنشاء مسودة تنظيمية. الوحدات والدروس لم تُنشر تلقائيًا؛ راجعها وصححها قبل اعتمادها.'});
    }catch(e){return send(res,e.status||400,{error:e.message||'تعذّر تنظيم محتوى الكتاب.'});}
  }
  if(req.method==='POST' && pathname.startsWith('/api/curriculum/lessons/') && pathname.endsWith('/generate-quiz')){
    if(!requireAdmin(req,res))return;
    try{
      const id=pathname.split('/')[4]; const db=readData(); const lesson=db.lessons.find(x=>x.id===id&&x.sourceBookId);
      if(!lesson) return send(res,404,{error:'الدرس المرتبط بالمنهج غير موجود.'});
      if(String(lesson.content||'').trim().length<80) return send(res,422,{error:'محتوى الدرس قصير جدًا. أكمل الشرح وراجعه أولًا.'});
      if(!process.env.AI_API_KEY) return send(res,503,{error:'اقتراح الأسئلة الذكي يحتاج تفعيل خدمة الذكاء الاصطناعي في إعدادات الخادم (AI_API_KEY). يمكنك مراجعة الدرس أولًا ثم المحاولة بعد التفعيل.'});
      const base=(process.env.AI_BASE_URL||'https://api.openai.com/v1').replace(/\/$/,''); const model=process.env.AI_MODEL||'gpt-4o-mini';
      const prompt='أنت مساعد لإعداد اختبارات تعليمية للأطفال. أنشئ 3 أسئلة اختيار من متعدد باللغة العربية السهلة اعتمادًا حصريًا على نص الدرس أدناه. لكل سؤال 3 خيارات قصيرة، وإجابة صحيحة واحدة. لا تضف معلومات غير مذكورة في النص. أخرج JSON فقط بالشكل {"questions":[{"question":"...","answers":["...","...","..."],"correct":0}]} حيث correct فهرس الإجابة الصحيحة يبدأ من صفر. اجعل الأسئلة متنوعة ومناسبة لعمر الطفل. إذا لم يكف النص، أنشئ أسئلة مما ورد فقط. عنوان الدرس: '+lesson.title+'\nنص الدرس:\n'+String(lesson.content).slice(0,9000);
      const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),25000);
      let payload; try { const r=await fetch(base+'/chat/completions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.AI_API_KEY},body:JSON.stringify({model,messages:[{role:'system',content:'أخرج JSON صالحًا فقط دون markdown أو شرح إضافي.'},{role:'user',content:prompt}],temperature:0.2,max_tokens:900}),signal:controller.signal}); payload=await r.json().catch(()=>({})); if(!r.ok) throw Error('تعذّر الاتصال بخدمة الذكاء الاصطناعي. حاول لاحقًا.'); } finally {clearTimeout(timer)}
      let raw=payload.choices?.[0]?.message?.content; if(typeof raw!=='string') throw Error('لم تصل أسئلة قابلة للقراءة. حاول مرة أخرى.'); raw=raw.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''); const parsed=JSON.parse(raw); const qs=(Array.isArray(parsed.questions)?parsed.questions:[]).slice(0,5).map(q=>({id:'q-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6),question:String(q.question||'').trim().slice(0,500),answers:(Array.isArray(q.answers)?q.answers:[]).slice(0,3).map(a=>String(a).slice(0,250)),correct:Number(q.correct),status:'draft',reviewRequired:true})).filter(q=>q.question&&q.answers.length===3&&q.answers.every(Boolean)&&Number.isInteger(q.correct)&&q.correct>=0&&q.correct<3);
      if(!qs.length) throw Error('لم تنتج الخدمة أسئلة صالحة. أعد المحاولة أو راجع محتوى الدرس.'); lesson.quizQuestions=qs; lesson.quizGeneratedAt=new Date().toISOString(); lesson.quizStatus='draft'; writeFileAtomic(dataFile,JSON.stringify(db,null,2)); return send(res,200,{lessonId:id,questions:qs,reviewRequired:true,message:'تم اقتراح الأسئلة كمسودة فقط. راجع صياغة كل سؤال والإجابة الصحيحة قبل اعتمادها.'});
    }catch(e){return send(res,e.status||422,{error:e.name==='AbortError'?'تأخر توليد الأسئلة. حاول مرة أخرى.':e.message||'تعذّر توليد الأسئلة.'});}
  }
  if(req.method==='POST' && pathname.startsWith('/api/curriculum/lessons/') && pathname.endsWith('/review-quiz')){
    if(!requireAdmin(req,res))return;
    try{
      const id=pathname.split('/')[4]; const body=await readBody(req,15000); const db=readData(); const lesson=db.lessons.find(x=>x.id===id&&x.sourceBookId); if(!lesson)return send(res,404,{error:'الدرس غير موجود.'});
      const qs=Array.isArray(body.questions)?body.questions.slice(0,10):[]; if(!qs.length)return send(res,400,{error:'أضف سؤالًا واحدًا على الأقل.'});
      const cleaned=qs.map(q=>({id:String(q.id||('q-'+Math.random().toString(36).slice(2,8))),question:String(q.question||'').trim().slice(0,500),answers:(Array.isArray(q.answers)?q.answers:[]).slice(0,3).map(a=>String(a).trim().slice(0,250)),correct:Number(q.correct)}));
      if(cleaned.some(q=>!q.question||q.answers.length!==3||q.answers.some(a=>!a)||!Number.isInteger(q.correct)||q.correct<0||q.correct>2))return send(res,400,{error:'كل سؤال يحتاج نصًا وثلاثة خيارات وإجابة صحيحة محددة.'});
      if(body.action==='approve'){lesson.quizQuestions=cleaned.map(q=>({...q,status:'approved',reviewRequired:false}));lesson.quizStatus='approved';lesson.quizReviewedAt=new Date().toISOString();}else if(body.action==='draft'){lesson.quizQuestions=cleaned.map(q=>({...q,status:'draft',reviewRequired:true}));lesson.quizStatus='draft';}else return send(res,400,{error:'الإجراء غير معروف.'});
      writeFileAtomic(dataFile,JSON.stringify(db,null,2)); return send(res,200,{id:lesson.id,quizStatus:lesson.quizStatus,questions:lesson.quizQuestions.length});
    }catch(e){return send(res,e.status||400,{error:e.message||'تعذّر حفظ الأسئلة.'});}
  }
  if(req.method==='POST' && pathname.startsWith('/api/curriculum/lessons/') && pathname.endsWith('/review')){
    if(!requireAdmin(req,res))return;
    try{const id=pathname.split('/')[4];const body=await readBody(req,20000);const db=readData();const lesson=db.lessons.find(x=>x.id===id&&(x.sourceBookId||x.createdByRole==='teacher'));if(!lesson)return send(res,404,{error:'مسودة الدرس غير موجودة.'});if(body.action==='approve'){if(!String(body.title||lesson.title).trim()||!String(body.content||lesson.content).trim())return send(res,400,{error:'عنوان الدرس وشرحه مطلوبان.'});lesson.title=String(body.title||lesson.title).slice(0,180);lesson.content=String(body.content||lesson.content).slice(0,12000);lesson.status='approved';lesson.reviewRequired=false;lesson.reviewedAt=new Date().toISOString();}else if(body.action==='draft'){lesson.title=String(body.title||lesson.title).slice(0,180);lesson.content=String(body.content||lesson.content).slice(0,12000);lesson.status='draft';lesson.reviewRequired=true;}else return send(res,400,{error:'الإجراء غير معروف.'});writeFileAtomic(dataFile,JSON.stringify(db,null,2));audit(String(process.env.ADMIN_EMAIL||'admin'),'lesson.review',{id:lesson.id,status:lesson.status});return send(res,200,{id:lesson.id,status:lesson.status});}catch(e){return send(res,e.status||400,{error:e.message||'تعذّر حفظ المراجعة.'});}
  }
  if(req.method==='POST' && pathname==='/api/curriculum/upload'){
    if(!requireAdmin(req,res))return;
    let savedPath='';
    try{
      const type=String(req.headers['content-type']||'').split(';')[0].trim().toLowerCase();
      if(type!=='application/pdf') return send(res,415,{error:'اختر ملف PDF صالحًا.'});
      const buffer=await readRaw(req,maxPdfUploadMb*1024*1024);
      if(buffer.length<8||buffer.subarray(0,5).toString()!=='%PDF-') return send(res,400,{error:'الملف لا يبدو ملف PDF صالحًا.'});
      const url=new URL(req.url,'http://localhost');
      const requestedTitle=String(url.searchParams.get('title')||'').trim().slice(0,180);
      const grade=String(url.searchParams.get('grade')||'').trim().slice(0,80);
      const subject=String(url.searchParams.get('subject')||'').trim().slice(0,80);
      const term=String(url.searchParams.get('term')||'').trim().slice(0,80);
      const author=String(url.searchParams.get('author')||'').trim().slice(0,180);
      const notes=String(url.searchParams.get('notes')||'').trim().slice(0,1000);
      const title=requestedTitle||subject;
      if(!subject) return send(res,400,{error:'اختر المادة قبل رفع الكتاب.'});
      if(!title) return send(res,400,{error:'اختر المادة قبل رفع الكتاب.'});
      if(typeof pdfParse!=='function') return send(res,503,{error:'ميزة قراءة PDF غير جاهزة لأن مكتبات المشروع لم تُثبّت بعد. أعد تشغيل npm install ثم أعد المحاولة.'});
      const extraction=await extractPdfContent(buffer);
      const {parsed,text:rawExtracted,ocrUsed,ocrPages,ocrPartial}=extraction; const extracted=learn.prepareBookText(rawExtracted).text;
      if(extracted.length<40) return send(res,422,{error:'لم نستطع استخراج نص مقروء من هذا الملف.'});
      const id=Date.now().toString(36)+Math.random().toString(36).slice(2,8);
      const filename=id+'.pdf'; savedPath=path.join(uploadDir,filename); fs.writeFileSync(savedPath,buffer,{flag:'wx'});
      const db=readData(); if(!Array.isArray(db.books)) db.books=[];
      const outline=inferOutline(extracted);
      const book={id,createdAt:new Date().toISOString(),title,grade,subject,term,author,notes:[notes,ocrUsed?'تم استخراج النص باستخدام OCR؛ راجع النص قبل الاعتماد.':'تم استخراج النص من طبقة النص داخل PDF.'].filter(Boolean).join(' — '),fileName:filename,pages:Number(parsed.numpages)||0,extractedChars:extracted.length,outline,extractedText:extracted.slice(0,2500000),pdfUploaded:true,ocrUsed,ocrPages};
      db.books.unshift(book); writeFileAtomic(dataFile,JSON.stringify(db,null,2)); audit(String(process.env.ADMIN_EMAIL||'admin'),'curriculum.upload',{bookId:id,title});
      return send(res,201,{id,title,pages:book.pages,extractedChars:book.extractedChars,outlineCount:outline.length,outline,ocrUsed,ocrPages,warning:(ocrUsed?'تم استخراج النص باستخدام OCR؛ راجع النتائج لاحتمال وجود أخطاء. ':'')+(ocrPartial?'تنبيه: تم فحص أول 100 صفحة فقط بالـ OCR. ':'')+(outline.length?'تم اقتراح عناوين أولية؛ راجعها يدويًا قبل اعتمادها.':'لم نتعرف على عناوين الوحدات تلقائيًا؛ راجع النص يدويًا.')});
    }catch(e){if(savedPath&&fs.existsSync(savedPath))try{fs.unlinkSync(savedPath)}catch{};console.error('Curriculum PDF processing failed:',e.message);return send(res,e.status||422,{error:e.status===413?e.message:e.code==='OCR_UNAVAILABLE'||e.message==='PDF_TEXT_NOT_EXTRACTABLE'?e.message:'تعذّر قراءة ملف PDF. تأكد أنه غير تالف وحاول مرة أخرى.'});}
  }
  // Public read-only curriculum library: visitors may download published PDF books without admin login.
  if(req.method==='GET' && pathname.startsWith('/api/public/curriculum/pdf/')){
    const id=pathname.slice('/api/public/curriculum/pdf/'.length).replace(/[^a-zA-Z0-9_-]/g,'');
    if(!id) return send(res,400,{error:'معرّف الكتاب غير صالح.'});
    const book=readData().books.find(x=>x.id===id && x.pdfUploaded===true && x.fileName);
    if(!book) return send(res,404,{error:'الكتاب غير موجود أو غير متاح للتنزيل.'});
    const file=path.join(uploadDir,path.basename(book.fileName));
    if(!fs.existsSync(file)) return send(res,404,{error:'ملف الكتاب غير موجود على التخزين الحالي. على مدير المنصة تفعيل التخزين الدائم.'});
    const safeTitle=String(book.title||'كتاب المنهج').normalize('NFKD').replace(/[^\w\u0600-\u06FF -]/g,'').trim().slice(0,100)||'curriculum-book';
    res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${path.basename(book.fileName)}"; filename*=UTF-8''${encodeURIComponent(safeTitle)}.pdf`,'Content-Length':fs.statSync(file).size,'X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=300','Cross-Origin-Resource-Policy':'same-origin'});
    return fs.createReadStream(file).pipe(res);
  }
  if(req.method==='GET' && pathname.startsWith('/api/public/curriculum/view/')){
    const id=pathname.slice('/api/public/curriculum/view/'.length).replace(/[^a-zA-Z0-9_-]/g,'');
    const book=readData().books.find(x=>x.id===id&&x.pdfUploaded===true&&x.fileName);
    if(!book)return send(res,404,{error:'الكتاب غير موجود أو حُذف من المكتبة.'});
    const file=path.join(uploadDir,path.basename(book.fileName));
    if(!fs.existsSync(file))return send(res,404,{error:'ملف PDF غير موجود على التخزين الحالي. تحقق من إعداد التخزين الدائم في Railway.'});
    res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':`inline; filename=\"${path.basename(book.fileName)}\"`,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store','X-Frame-Options':'SAMEORIGIN'});
    return fs.createReadStream(file).pipe(res);
  }
  if(req.method==='GET' && pathname.startsWith('/api/curriculum/pdf/')){
    if(!requireAdmin(req,res))return;
    const id=pathname.slice('/api/curriculum/pdf/'.length).replace(/[^a-zA-Z0-9_-]/g,'');
    const book=readData().books.find(x=>x.id===id&&x.fileName);
    if(!book)return send(res,404,{error:'الكتاب غير موجود.'});
    const file=path.join(uploadDir,path.basename(book.fileName));
    if(!fs.existsSync(file))return send(res,404,{error:'ملف PDF غير موجود على التخزين الحالي. قد تحتاج إلى تفعيل Volume دائم في Railway.'});
    res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':`inline; filename="${book.fileName}"`,'X-Content-Type-Options':'nosniff'});return fs.createReadStream(file).pipe(res);
  }

  if(req.method==='GET' && pathname==='/api/admin/pdf-status'){
    if(!requireAdmin(req,res))return;
    const checkCommand=async(command,args=[])=>{try{const r=await execFileAsync(command,args,{timeout:5000,maxBuffer:200000});return {available:true,version:String(r.stdout||r.stderr||'').trim().split('\n')[0].slice(0,180)}}catch(e){return {available:false,error:e.code==='ENOENT'?'غير مثبت':String(e.message||'تعذّر الفحص').slice(0,120)}}};
    const [poppler,tesseract]=await Promise.all([checkCommand('pdftoppm',['-v']),checkCommand('tesseract',['--version'])]);
    let languageList=[];if(tesseract.available){try{const r=await execFileAsync('tesseract',['--list-langs'],{timeout:5000,maxBuffer:200000});languageList=String(r.stdout||r.stderr).split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&x!=='List of available languages:')}catch{}}
    return send(res,200,{pdfParser:{available:typeof pdfParse==='function',required:true},ocr:{available:poppler.available&&tesseract.available&&languageList.includes('ara')&&languageList.includes('eng'),poppler,tesseract,arabic:languageList.includes('ara'),english:languageList.includes('eng'),languages:languageList},storage:{dataDir,configured:!!process.env.DATA_DIR}});
  }
  if(pathname.startsWith('/api/learn/')) return handleLearn(req,res,pathname);
  if(req.method==='GET' && pathname==='/api/teacher/status') return send(res,200,{configured:Boolean(process.env.AI_API_KEY),model:process.env.AI_MODEL||'gpt-4o-mini'});
  if(req.method==='POST' && pathname==='/api/teacher/ask'){
    {const r=rateLimit(req,'teacher-ask',Number(process.env.ASK_LIMIT_PER_15MIN||60));if(!r.allowed){res.setHeader('Retry-After',String(r.retryAfter));return send(res,429,{error:'أسئلة كثيرة في وقت قصير. انتظر قليلًا ثم حاول مرة أخرى.'});}}
    try{const body=await readBody(req,12000);const question=String(body.question||'').trim();if(!question)return send(res,400,{error:'اكتب سؤالك أولًا.'});if(question.length>2000)return send(res,413,{error:'اختصر السؤال قليلًا ثم أرسله.'});const bookId=String(body.bookId||'').trim();if(!bookId)return send(res,400,{error:'اختر كتابًا من مكتبة المناهج حتى تكون الإجابة مستندة إلى محتوى الكتاب.'});const curriculum=curriculumContext(question,bookId);if(!curriculum)return send(res,404,{error:'لم نجد نصًا مستخرجًا لهذا الكتاب. تأكد من رفعه ونجاح قراءة PDF أولًا.'});if(!curriculum.matched){let answer=curriculum.reason==='page-index-unavailable'?'الكتاب موجود، لكن النص المستخرج لا يحفظ أرقام الصفحات بدقة. افتح ملف PDF وحدد عنوان الدرس أو انسخ فقرة منه حتى لا أشرح صفحة خاطئة.':curriculum.reason==='text-quality-low'?'تم العثور على الكتاب، لكن النص المستخرج منه غير واضح أو غير مرتب بما يكفي لشرح موثوق. أعد رفع PDF بجودة أوضح، وإذا كان مصوّرًا فتأكد من تفعيل OCR العربي على الخادم.':curriculum.reason==='topic-not-found'?'لم أجد في النص المستخرج فقرة مرتبطة بهذا الطلب بدرجة كافية، لذلك لن أختار نصًا عشوائيًا من الكتاب. اكتب عنوان الدرس أو اطلب ملخصًا عامًا للكتاب.':'لم أتمكن من تحديد هذا الدرس داخل النص المستخرج من الكتاب. جرّب كتابة عنوان الدرس أو أعد رفع نسخة أوضح من PDF.';return send(res,200,{configured:Boolean(process.env.AI_API_KEY),grounded:true,matched:false,reason:curriculum.reason||'not-matched',bookTitle:curriculum.book.title,answer});}const quality=curriculumTextQuality(curriculum.excerpt);if(!quality.ok)return send(res,200,{configured:Boolean(process.env.AI_API_KEY),grounded:true,matched:false,reason:'text-quality-low',bookTitle:curriculum.book.title,answer:'تم العثور على الكتاب، لكن النص المستخرج من صفحاته غير واضح أو مختلط بعناصر أخرى، ولذلك لن أعرضه لك على أنه شرح صحيح. أعد رفع نسخة PDF أوضح، وتأكد من توفر OCR باللغة العربية إذا كان الكتاب مصوّرًا.'});const result=await teacherAnswer(question,Array.isArray(body.history)?body.history:[],curriculum);return send(res,200,{...result,grounded:true,matched:true,bookTitle:curriculum.book.title});}catch(e){return send(res,e.status||502,{error:e.message||'تعذّر الحصول على إجابة الآن.'});}
  }
  if(req.method==='POST' && ['/api/books','/api/plans','/api/lessons'].includes(pathname)){
    if(!requireAdmin(req,res))return;
    try{const item=await readBody(req,100000);if(!item||typeof item!=='object')throw Error('bad');const db=readData();const key=pathname.split('/').pop();const allowed={books:['title','grade','subject','author','notes'],plans:['title','grade','subject','objectives','steps','materials','assessment'],lessons:['title','grade','subject','topic','content','question','answers','correct']}[key];const clean={id:Date.now().toString(36)+Math.random().toString(36).slice(2,7),createdAt:new Date().toISOString()};for(const k of allowed)if(item[k]!==undefined)clean[k]=Array.isArray(item[k])?item[k].map(x=>String(x).slice(0,500)).slice(0,10):String(item[k]).slice(0,12000);if(!clean.title||!clean.title.trim())return send(res,400,{error:'العنوان مطلوب'});db[key].unshift(clean);writeFileAtomic(dataFile,JSON.stringify(db,null,2));audit(String(process.env.ADMIN_EMAIL||'admin'),'content.create',{type:key,id:clean.id,title:clean.title});return send(res,201,clean);}catch(e){return send(res,e.status||400,{error:e.message==='bad'?'تعذّر قراءة البيانات':e.message||'تعذّر الحفظ'});}
  }
  let filePath=pathname==='/'?'/index.html':((pathname==='/admin'||pathname==='/admin/')?'/admin.html':((pathname==='/school-admin'||pathname==='/school-admin/')?'/school-admin.html':((pathname==='/school'||pathname==='/school/')?'/school.html':((pathname==='/student/school'||pathname==='/student/school/')?'/student-school.html':((pathname==='/student'||pathname==='/student/')?'/student.html':((pathname==='/teacher'||pathname==='/teacher/')?'/teacher.html':((pathname==='/guardian'||pathname==='/guardian/')?'/guardian.html':pathname)))))));const file=path.resolve(root,'public','.'+filePath);const publicRoot=path.resolve(root,'public');if(!file.startsWith(publicRoot+path.sep)&&file!==publicRoot)return send(res,403,'Forbidden','text/plain');fs.readFile(file,(err,content)=>{if(err)return send(res,404,'Not found','text/plain; charset=utf-8');send(res,200,content,types[path.extname(file)]||'application/octet-stream');});
});
server.requestTimeout=15*60*1000; server.timeout=15*60*1000; server.headersTimeout=16*60*1000;
async function seedTrainingBookOnce(){
  const marker=path.join(dataDir,'.training-book-seeded-v1');
  if(fs.existsSync(marker))return;
  // Mark the one-time attempt before import so a deliberately deleted sample never reappears on restart.
  fs.writeFileSync(marker,new Date().toISOString(),{flag:'wx'});
  const source=path.join(root,'seed-books','التربية-الإسلامية-كتاب-تجريبي.pdf');
  if(!fs.existsSync(source))return;
  try{
    const buffer=fs.readFileSync(source);const extraction=await extractPdfContent(buffer);const extracted=learn.prepareBookText(String(extraction.text||'')).text;
    if(extracted.length<100){console.warn('Training PDF found, but text extraction was too short; sample book not imported.');return;}
    const db=readData();db.books||=[];
    const id='sample-islamic-studies-v1';const filename=id+'.pdf';
    fs.copyFileSync(source,path.join(uploadDir,filename));
    db.books.unshift({id,createdAt:new Date().toISOString(),title:'التربية الإسلامية',grade:'الرابع الأساسي',subject:'التربية الإسلامية',term:'الترم الأول',author:'إعداد تدريبي لمنصة تعلّم مع الهيثم',notes:'كتاب تدريبي تجريبي من 6 صفحات، وليس كتابًا رسميًا. يمكن حذفه من لوحة الإدارة.',fileName:filename,pages:Number(extraction.parsed?.numpages)||6,extractedChars:extracted.length,outline:inferOutline(extracted),extractedText:extracted.slice(0,2500000),pdfUploaded:true,trainingSample:true,ocrUsed:!!extraction.ocrUsed,ocrPages:extraction.ocrPages||0});
    writeFileAtomic(dataFile,JSON.stringify(db,null,2),{mode:0o600});console.log('Imported optional six-page training curriculum book.');
  }catch(e){console.warn('Training book import skipped:',e.message);}
}
const port=process.env.PORT||3000;seedTrainingBookOnce().finally(()=>server.listen(port,'0.0.0.0',()=>console.log(`Taallam platform listening on ${port}; AI ${process.env.AI_API_KEY?'configured':'demo mode'}`)));

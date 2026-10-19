'use strict';
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const school = fs.readFileSync(path.join(root, 'public', 'school.html'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'public', 'school-admin.html'), 'utf8');
const checks = [
  ['assignment PDF upload route', server.includes("pathname==='/api/school-member/assignment-pdf'")],
  ['student submission PDF upload route', server.includes("pathname==='/api/school-member/submission-pdf'")],
  ['teacher role required for assignment upload', server.includes("ss.member.role!=='teacher'") && server.includes('إرفاق ملف الواجب متاح للمعلم فقط')],
  ['student role required for solution upload', server.includes("ss.member.role!=='student'") && server.includes('رفع الحل متاح لحساب الطالب فقط')],
  ['PDF MIME and signature checks', server.includes("'content-type'") && server.includes("buffer.subarray(0,5).toString()!=='%PDF-'")],
  ['PDF parser validates uploaded structure', (server.match(/await pdfParse\(buffer\)/g) || []).length >= 2],
  ['12 MiB upload cap', (server.match(/readRaw\(req,12\*1024\*1024\)/g) || []).length >= 2],
  ['student portal includes assignment PDF upload control', school.includes('name="attachment"') && school.includes('name="solutionPdf"')],
  ['school admin portal previews solution PDFs', admin.includes('/api/school-admin/submissions') && admin.includes('معاينة حل PDF')],
  ['school curriculum editor adds grades and subjects without comma-separated fields', admin.includes('id="addGrade"') && admin.includes('id="addSubject"') && !admin.includes('name="gradesText"')],
  ['sections are configured under their specific grade', admin.includes('id="gradeSectionEditors"') && admin.includes('data-add-section')],
  ['grade-specific sections are persisted and returned by the server', server.includes('gradeSections:s.gradeSections||{}') && server.includes('school.gradeSections=next')],
  ['member assignment rejects a section outside the selected grade', server.includes('اختر شعبة تابعة للصف المحدد.') && server.includes('school.gradeSections?.[requestedGrade]')],
  ['legacy sections remain available for older schools', server.includes('school.gradeSections?.[requestedGrade]||school.sections||[]')],
  ['teacher can only preview own assignment PDF', server.includes('يمكنك معاينة ملفات الواجبات التي نشرتها فقط')],
  ['Railway persistent storage documented', fs.readFileSync(path.join(root,'README.md'),'utf8').includes('DATA_DIR') && fs.readFileSync(path.join(root,'README.md'),'utf8').includes('Volume دائم')],
  ['scanned PDF OCR fallback is implemented', server.includes('async function extractPdfContent') && server.includes('pdftoppm') && server.includes('tesseract') && server.includes('ara+eng')],
  ['OCR output status is returned explicitly', server.includes('ocrUsed,ocrPages') && server.includes('OCR_UNAVAILABLE')],
  ['school term metadata is stored for library search', server.includes('const term=String(url.searchParams.get') && server.includes('subject,term,author')],
  ['OCR prerequisites and limitations documented', fs.readFileSync(path.join(root,'README.md'),'utf8').includes('Tesseract') && fs.readFileSync(path.join(root,'README.md'),'utf8').includes('أول 100 صفحة')]
  ,['Docker image installs Arabic and English OCR prerequisites', fs.readFileSync(path.join(root,'Dockerfile'),'utf8').includes('tesseract-ocr-ara') && fs.readFileSync(path.join(root,'Dockerfile'),'utf8').includes('tesseract-ocr-eng') && fs.readFileSync(path.join(root,'Dockerfile'),'utf8').includes('poppler-utils')]
  ,['PDF runtime diagnostic is admin-protected', server.includes("pathname==='/api/admin/pdf-status'") && server.includes('pdfParser:{available:typeof pdfParse===')]
  ,['Docker deployment and persistent storage documented', fs.readFileSync(path.join(root,'README.md'),'utf8').includes('DATA_DIR=/app/data') && fs.readFileSync(path.join(root,'Dockerfile'),'utf8').includes('ENV DATA_DIR=/app/data')]
  ,['curriculum book is mandatory for teacher questions', server.includes('اختر كتابًا من مكتبة المناهج حتى تكون الإجابة مستندة إلى محتوى الكتاب')]
  ,['unmatched questions do not fall back to general answers', server.includes('page-index-unavailable') && server.includes('حتى لا أشرح صفحة خاطئة')]
  ,['lesson-number requests resolve against extracted book headings', server.includes('lessonRequest&&ordinalMatch') && server.includes('inferOutline(text)')]
  ,['page requests do not pretend extracted text preserves PDF page numbers', server.includes('page-index-unavailable') && server.includes('حتى لا أشرح صفحة خاطئة')]
  ,['student UI uses a compact free-form lesson request instead of a long prompt row', fs.readFileSync(path.join(root,'public','index.html'),'utf8').includes('placeholder="اكتب: اشرح الدرس الأول"') && !fs.readFileSync(path.join(root,'public','index.html'),'utf8').includes('data-teacher-prompt=')]
  ,['AI prompt explicitly restricts answer to selected book excerpt', server.includes('أجب اعتمادًا على المقتطف من كتاب المنهج المحدد فقط')]
  ,['public question UI provides a concise curriculum book selector', fs.readFileSync(path.join(root,'public','index.html'),'utf8').includes('id="curriculumBookSelect"') && fs.readFileSync(path.join(root,'public','index.html'),'utf8').includes('اختر كتاب المنهج')]
  ,['question UI blocks send without a selected book', fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('اختر كتاب المنهج أولًا حتى يكون الشرح مرتبطًا بمحتواه.')]
  ,['voice request is one-shot and submits recognized speech for spoken explanation', fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('function startOneShotListening()') && fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('answerQuestion({speakAnswer:true})')]
  ,['voice stop cancels spoken lesson audio', fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('function stopLessonAudio') && fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('speechSynthesis.cancel()')]
  ,['voice errors provide microphone permission guidance', fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('اسمح للمتصفح باستخدام الميكروفون')]
  ,['voice input does not start a continuous conversation', fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('rec.continuous=false') && !fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('voiceConversationActive')]
  ,['speech playback waits for Android voices and falls back to Arabic locales', fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('voiceschanged') && fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('ar[-_]SA')]
  ,['teacher answer supports replaying the spoken explanation', fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('أعد الاستماع') && fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('speak(currentSpeechText)')]
  ,['teacher answer controls are compact and do not add extra follow-up prompts', !fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('const followups=')]
  ,['school creation uses selectable grade checkboxes and no subjects text field', fs.readFileSync(path.join(root,'public','admin.html'),'utf8').includes('name=\"gradeChoice\"') && !fs.readFileSync(path.join(root,'public','admin.html'),'utf8').includes('name=\"subjectsText\"')]
  ,['student grade is selected from the chosen school grades', fs.readFileSync(path.join(root,'public','student.html'),'utf8').includes('<select name=\"grade\" required>') && fs.readFileSync(path.join(root,'public','student.html'),'utf8').includes('grade.innerHTML=') ]
  ,['school and admin account creation accepts eight-character passwords server-side', server.includes('password.length<8||password.length>128') && server.includes('كلمة مرور لا تقل عن 8 خانات')]
  ,['public library offers a direct browse-and-download call to action', fs.readFileSync(path.join(root,'public','index.html'),'utf8').includes('تصفّح الكتب وتنزيلها')]
  ,['public books are grouped hierarchically by grade then subject', fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('class=\"book-grade\"') && fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('class=\"book-subject\"')]
  ,['each public book keeps an explicit download action', fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('/api/public/curriculum/pdf/') && fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('⬇ تنزيل')]
  ,['hierarchical book browser has responsive and keyboard-focus styling', fs.readFileSync(path.join(root,'public','styles.css'),'utf8').includes('.book-grade summary:focus-visible') && fs.readFileSync(path.join(root,'public','styles.css'),'utf8').includes('@media(max-width:520px)')]
  ,['teacher portal separates lesson composition and draft list into tabs', fs.readFileSync(path.join(root,'public','teacher.html'),'utf8').includes('data-teacher-tab=\"compose\"') && fs.readFileSync(path.join(root,'public','teacher.html'),'utf8').includes('data-teacher-tab=\"drafts\"') && fs.readFileSync(path.join(root,'public','teacher.html'),'utf8').includes('function teacherTab(tab)')]
  ,['student portal separates school posts from submissions and results', fs.readFileSync(path.join(root,'public','student.html'),'utf8').includes('data-student-tab=\"posts\"') && fs.readFileSync(path.join(root,'public','student.html'),'utf8').includes('data-student-tab=\"work\"') && fs.readFileSync(path.join(root,'public','student.html'),'utf8').includes('function studentTab(tab)')]
  ,['student and teacher tabs expose accessible pressed state', fs.readFileSync(path.join(root,'public','student.html'),'utf8').includes('aria-pressed') && fs.readFileSync(path.join(root,'public','teacher.html'),'utf8').includes('aria-pressed')]
  ,['student portal includes a grade-filtered book library with search, subject filter, and PDF download', fs.readFileSync(path.join(root,'public','student.html'),'utf8').includes('data-student-tab=\"books\"') && fs.readFileSync(path.join(root,'public','student.html'),'utf8').includes('function loadStudentBooks()') && fs.readFileSync(path.join(root,'public','student.html'),'utf8').includes('/api/public/curriculum/pdf/') && fs.readFileSync(path.join(root,'public','student.html'),'utf8').includes('id=\"bookSearch\"') && fs.readFileSync(path.join(root,'public','student.html'),'utf8').includes('id=\"bookSubject\"') ]
  ,['student book library filters books to the student grade when a grade is assigned', fs.readFileSync(path.join(root,'public','student.html'),'utf8').includes('studentGrade=String(d.member.grade||\'\').trim()') && fs.readFileSync(path.join(root,'public','student.html'),'utf8').includes('String(b.grade||\'\').trim()===studentGrade')]
  ,['school admin navigation is grouped into task-oriented sections', admin.includes('إدارة المدرسة</div>') && admin.includes('التعليم والمحتوى</div>') && admin.includes('المتابعة والتقارير</div>')]
  ,['school admin navigation exposes active page state accessibly', admin.includes("x.setAttribute('aria-current',active?'page':'false')") && admin.includes('aria-current="page"')]
  ,['school admin controls have visible keyboard focus styling', admin.includes('button:focus-visible') && admin.includes('outline-offset:2px')]
  ,['school member grade assignment uses configured grade dropdown and preserves legacy grade', admin.includes('data-field=\"grade\"') && admin.includes('school.grades||[]') && admin.includes('m.grade?[m.grade]:[]')]
  ,['school member section assignment uses configured section dropdown and preserves legacy section', admin.includes('data-field=\"section\"') && admin.includes('school.sections||[]') && admin.includes('m.section?[m.section]:[]')]
  ,['teacher subjects are assigned using selectable checkboxes rather than comma-separated text', admin.includes('data-subject-choice') && admin.includes('subjects:[...([...document.querySelectorAll') && !admin.includes('name=\"subjects\" value=\"${esc((m.subjects||[]).join')]
  ,['student results include submission summary metrics and average grade', fs.readFileSync(path.join(root,'public','student.html'),'utf8').includes('id="workSummary"') && fs.readFileSync(path.join(root,'public','student.html'),'utf8').includes('متوسط الدرجات')]
  ,['student submissions can be filtered by correction status', fs.readFileSync(path.join(root,'public','student.html'),'utf8').includes('id="submissionFilter"') && fs.readFileSync(path.join(root,'public','student.html'),'utf8').includes('function renderMySubmissions()')]
  ,['student submission cards show assignment title, teacher feedback, and attached solution link', fs.readFileSync(path.join(root,'public','student.html'),'utf8').includes('ملاحظات المعلم') && fs.readFileSync(path.join(root,'public','student.html'),'utf8').includes('s.attachmentUrl') && fs.readFileSync(path.join(root,'public','student.html'),'utf8').includes('studentPosts.find(p=>p.id===s.postId)')]
];
// PWA installability checks for all role-specific manifests.
for (const name of ['manifest-public.webmanifest','manifest-admin.webmanifest','manifest-school-admin.webmanifest']) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root,'public',name),'utf8'));
  checks.push([`${name} includes installable PNG icons`, manifest.icons.some(icon=>/\.png$/.test(icon.src)&&icon.sizes==='192x192'&&icon.type==='image/png')&&manifest.icons.some(icon=>/\.png$/.test(icon.src)&&icon.sizes==='512x512'&&icon.type==='image/png')]);
}
const installer = fs.readFileSync(path.join(root,'public','install.js'),'utf8');
const serviceWorker = fs.readFileSync(path.join(root,'public','sw.js'),'utf8');
checks.push(['installer keeps one declared manifest per portal', installer.includes("document.querySelector('link[rel=\\\"manifest\\\"]')")]);
checks.push(['public service worker cache is versioned for the three-app PWA architecture', serviceWorker.includes('taallam-shell-v2.60.0')]);
for (const [role, scope, cache] of [['admin','/admin/','taallam-admin-shell-v2.57.0'],['school-admin','/school-admin/','taallam-school-admin-shell-v2.57.0']]) { const worker=fs.readFileSync(path.join(root,'public',role,'sw.js'),'utf8'); checks.push([`${role} has an independent scoped service worker`, worker.includes(`const CACHE_NAME = '${cache}'`) && worker.includes(`caches.match('${scope}')`)]); }
checks.push(['admin portals register separate scoped service workers', installer.includes("role==='admin'?'/admin/sw.js':role==='school-admin'?'/school-admin/sw.js':'/sw.js'") && installer.includes("scope,updateViaCache:'none'")]);
checks.push(['service worker caches the three installable manifests and distinct app icons', serviceWorker.includes('/manifest-public.webmanifest')&&serviceWorker.includes('/manifest-admin.webmanifest')&&serviceWorker.includes('/manifest-school-admin.webmanifest')&&serviceWorker.includes('/icons/taallam-admin-512.png')&&serviceWorker.includes('/icons/taallam-school-512.png')]);
for (const [manifestName,iconBase] of [['manifest-public.webmanifest','taallam-learn'],['manifest-admin.webmanifest','taallam-admin'],['manifest-school-admin.webmanifest','taallam-school']]) { const m=JSON.parse(fs.readFileSync(path.join(root,'public',manifestName),'utf8')); checks.push([`${manifestName} uses its own distinct app icon`, m.icons.some(icon=>icon.src===`/icons/${iconBase}-192.png`)&&m.icons.some(icon=>icon.src===`/icons/${iconBase}-512.png`)]); }
const installPages = { '/':'manifest-public.webmanifest', '/student':'manifest-public.webmanifest', '/teacher':'manifest-public.webmanifest', '/guardian':'manifest-public.webmanifest', '/admin':'manifest-admin.webmanifest', '/school-admin':'manifest-school-admin.webmanifest' };
for (const [route, manifestName] of Object.entries(installPages)) { const file = route==='/' ? 'index.html' : route.slice(1)+'.html'; const html = fs.readFileSync(path.join(root,'public',file),'utf8'); checks.push([`${route} uses the intended shared install identity`, html.includes(`/`+manifestName)]); }
for (const name of ['manifest-admin.webmanifest','manifest-school-admin.webmanifest']) { const m=JSON.parse(fs.readFileSync(path.join(root,'public',name),'utf8')); checks.push([`${name} scope includes its exact start URL`, m.scope===m.start_url]); }
checks.push(['installer exposes three identities with trailing-slash route support', installer.includes("'/admin/':'admin'") && installer.includes("'/school-admin/':'school-admin'") && installer.includes("const role=roles[path]||'public'")]);
const publicManifest = JSON.parse(fs.readFileSync(path.join(root,'public','manifest-public.webmanifest'),'utf8'));
checks.push(['learning app has a unique install identity distinct from the site root and admin apps', publicManifest.id==='/learn-app' && publicManifest.start_url==='/' && publicManifest.scope==='/']);
let failed = 0;
for (const [label, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; }
console.log(`\n${checks.length - failed}/${checks.length} source checks passed.`);
if (failed) process.exitCode = 1;

checks.push(['teacher request UI is compact with explain and voice controls only', fs.readFileSync(path.join(root,'public','index.html'),'utf8').includes('id="askBtn"') && fs.readFileSync(path.join(root,'public','index.html'),'utf8').includes('id="voiceBtn"') && !fs.readFileSync(path.join(root,'public','index.html'),'utf8').includes('data-teacher-prompt=')]);

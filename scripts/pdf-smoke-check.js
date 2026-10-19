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
  ,['unmatched questions do not fall back to general answers', server.includes('لن أستبدل محتوى المنهج بإجابة من خارج الكتاب') && server.includes("if(!best)return {book:chosen[0],excerpt:'',matched:false}")]
  ,['AI prompt explicitly restricts answer to selected book excerpt', server.includes('أجب اعتمادًا على المقتطف من كتاب المنهج المحدد فقط')]
  ,['public question UI marks book as required', fs.readFileSync(path.join(root,'public','index.html'),'utf8').includes('اختر كتاب المنهج الذي تريد السؤال عنه (مطلوب)')]
  ,['question UI blocks send without a selected book', fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('اختر كتاب المنهج أولًا حتى تكون الإجابة مرتبطة بمحتواه.')]
  ,['voice conversation re-listens after the answer', fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('startListening()') && fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('انتهت الإجابة. يمكنك طرح سؤالك التالي.') ]
  ,['voice stop cancels recognition and speech', fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('function stopVoiceConversation') && fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('speechSynthesis.cancel()')]
  ,['voice errors provide microphone and network guidance', fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('الميكروفون غير مسموح') && fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('تعذّر الاتصال بخدمة التعرّف على الكلام')]
  ,['voice recognition stops retrying after fatal network or permission errors', fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes("['not-allowed','service-not-allowed','audio-capture','network'].includes(e.error)") && fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('أوقفت المحاولة التلقائية')]
  ,['speech startup watchdog allows a longer startup window', fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('let finished=false,started=false') && fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('},5000)')]
  ,['teacher answer offers simpler explanation follow-up', fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('اشرحها بطريقة أبسط') && fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('اشرح الفكرة التي سألت عنها للتو بطريقة أبسط جدًا')]
  ,['teacher answer offers book-grounded practice question', fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('اختبر فهمي') && fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('اطرح سؤال تدريب واحدًا مناسبًا')]
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
];
let failed = 0;
for (const [label, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; }
console.log(`\n${checks.length - failed}/${checks.length} source checks passed.`);
if (failed) process.exitCode = 1;

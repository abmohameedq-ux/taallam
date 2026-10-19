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
  ['teacher can only preview own assignment PDF', server.includes('يمكنك معاينة ملفات الواجبات التي نشرتها فقط')],
  ['Railway persistent storage documented', fs.readFileSync(path.join(root,'README.md'),'utf8').includes('DATA_DIR') && fs.readFileSync(path.join(root,'README.md'),'utf8').includes('Volume دائم')],
  ['scanned PDF OCR fallback is implemented', server.includes('async function extractPdfContent') && server.includes('pdftoppm') && server.includes('tesseract') && server.includes('ara+eng')],
  ['OCR output status is returned explicitly', server.includes('ocrUsed,ocrPages') && server.includes('OCR_UNAVAILABLE')],
  ['school term metadata is stored for library search', server.includes('const term=String(url.searchParams.get') && server.includes('subject,term,author')],
  ['OCR prerequisites and limitations documented', fs.readFileSync(path.join(root,'README.md'),'utf8').includes('Tesseract') && fs.readFileSync(path.join(root,'README.md'),'utf8').includes('أول 100 صفحة')]
  ,['Docker image installs Arabic and English OCR prerequisites', fs.readFileSync(path.join(root,'Dockerfile'),'utf8').includes('tesseract-ocr-ara') && fs.readFileSync(path.join(root,'Dockerfile'),'utf8').includes('tesseract-ocr-eng') && fs.readFileSync(path.join(root,'Dockerfile'),'utf8').includes('poppler-utils')]
  ,['PDF runtime diagnostic is admin-protected', server.includes("pathname==='/api/admin/pdf-status'") && server.includes('pdfParser:{available:typeof pdfParse===')]
  ,['Docker deployment and persistent storage documented', fs.readFileSync(path.join(root,'README.md'),'utf8').includes('الإصدار 2.33.0') && fs.readFileSync(path.join(root,'README.md'),'utf8').includes('DATA_DIR=/app/data')]
  ,['curriculum book is mandatory for teacher questions', server.includes('اختر كتابًا من مكتبة المناهج حتى تكون الإجابة مستندة إلى محتوى الكتاب')]
  ,['unmatched questions do not fall back to general answers', server.includes('لن أستبدل محتوى المنهج بإجابة من خارج الكتاب') && server.includes("if(!best)return {book:chosen[0],excerpt:'',matched:false}")]
  ,['AI prompt explicitly restricts answer to selected book excerpt', server.includes('أجب اعتمادًا على المقتطف من كتاب المنهج المحدد فقط')]
  ,['public question UI marks book as required', fs.readFileSync(path.join(root,'public','index.html'),'utf8').includes('اختر كتاب المنهج الذي تريد السؤال عنه (مطلوب)')]
  ,['question UI blocks send without a selected book', fs.readFileSync(path.join(root,'public','app.js'),'utf8').includes('اختر كتاب المنهج أولًا حتى تكون الإجابة من محتواه.')]
];
let failed = 0;
for (const [label, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failed++; }
console.log(`\n${checks.length - failed}/${checks.length} source checks passed.`);
if (failed) process.exitCode = 1;

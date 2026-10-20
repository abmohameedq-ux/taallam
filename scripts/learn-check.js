'use strict';
// Unit checks for lib/learn.js using a synthetic Arabic book (table of contents + two units with repeating lesson numbers).
const L = require('../lib/learn.js');
const P = n => ('هذه فقرة شرح عن الموضوع رقم ' + n + ' تتحدث عن الإيمان والصلاة والصدق وبر الوالدين بأسلوب واضح للطلاب. ').repeat(5);
const book = [
  'فهرس الكتاب', 'الوحدة الأولى: العقيدة ........ 3', 'الدرس الأول: أركان الإسلام ........ 4', 'الدرس الثاني: أركان الإيمان ........ 9',
  'الوحدة الثانية: العبادات ........ 15', 'الدرس الأول: الصلاة ........ 16', 'الدرس الثاني: الصيام ........ 21', '',
  'الوحدة الأولى: العقيدة', P(1), 'الدرس الأول: أركان الإسلام', 'الشهادتان والصلاة والزكاة والصيام والحج هي أركان الإسلام الخمسة. ' + P(2), 'الدرس الثاني: أركان الإيمان', 'الإيمان بالله وملائكته وكتبه ورسله واليوم الآخر والقدر. ' + P(3),
  'الوحدة الثانية: العبادات', P(4), 'الدرس الأول: الصلاة', 'الصلاة عماد الدين وهي خمس صلوات في اليوم والليلة. ' + P(5), 'الدرس الثاني: الصيام', 'الصيام في رمضان ركن من أركان الإسلام يمسك فيه المسلم عن الطعام. ' + P(6)
].join('\n');
const checks = [];
const o = L.buildOutline(book);
checks.push(['detects 2 units (TOC entries ignored)', o.units.length === 2]);
checks.push(['detects 4 lessons nested in units', o.lessons.length === 4 && o.units[0].lessons.length === 2 && o.units[1].lessons.length === 2]);
checks.push(['unit text is the real section, not the TOC', L.resolveSection(book, o, { query: 'اشرح لي الوحدة الثانية' }).text.includes('الصلاة عماد الدين')]);
checks.push(['"الوحدة السابعة" reports not found', L.resolveSection(book, o, { query: 'اشرح الوحدة السابعة' }).notFound === true]);
const r1 = L.resolveSection(book, o, { query: 'اشرح الدرس الثاني من الوحدة الثانية' });
checks.push(['lesson-in-unit reference resolves correctly', r1.text.includes('الصيام في رمضان')]);
const r2 = L.resolveSection(book, o, { query: 'اشرح الدرس الأول' });
checks.push(['bare lesson reference uses first matching lesson', r2.text.includes('الشهادتان')]);
const r3 = L.resolveSection(book, o, { query: 'ما هي اركان الاسلام؟' });
checks.push(['keyword search normalizes hamza/taa marbuta', r3 && r3.text.includes('الشهادتان')]);
checks.push(['search with الصَّلاة diacritics still matches', !!L.resolveSection(book, o, { query: 'الصَّلاةُ' })]);
checks.push(['normalizeArabic unifies forms', L.normalizeArabic('الأولى') === L.normalizeArabic('الاولي') && L.normalizeArabic('مَدْرَسَة') === 'مدرسه']);
checks.push(['digits and ordinals both parse', L.parseRef('الدرس 3').num === 3 && L.parseRef('الوحدة السابعة').num === 7 && L.parseRef('الفصل الحادي عشر').num === 11]);
const sl = L.slidesFromText(r1.text, 6, 200);
checks.push(['slides are short and bounded', sl.length > 0 && sl.length <= 6 && sl.every(s => s.length <= 420)]);
const cz = L.makeCloze(r1.text + ' ' + r2.text, 3);
checks.push(['offline cloze questions are well formed', cz.length > 0 && cz.every(q => q.options.length === 3 && q.options[q.answer] && q.q.includes('_____'))]);
const flat = L.buildOutline(('نص عادي بلا عناوين. ').repeat(400));
checks.push(['book without headings falls back to parts', flat.parts.length > 0 && flat.units.length === 0]);
let failed = 0;
for (const [name, ok] of checks) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) failed++; }
console.log(`\n${checks.length - failed}/${checks.length} learn-library checks passed.`);
process.exit(failed ? 1 : 0);

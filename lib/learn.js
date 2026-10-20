'use strict';
// Pure helpers for understanding a school book: Arabic normalization, unit/lesson outline,
// section resolution ("اشرح الوحدة السابعة"), passage search, and offline fallbacks.

const TASHKEEL = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
function normalizeArabic(s) {
  return String(s || '').replace(TASHKEEL, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).toLowerCase();
}

// ---- ordinals (on normalized text) ----
const ORD_BASE = ['اول', 'ثاني', 'ثالث', 'رابع', 'خامس', 'سادس', 'سابع', 'ثامن', 'تاسع', 'عاشر'];
const ORD_FEM = ['اولي', 'ثانيه', 'ثالثه', 'رابعه', 'خامسه', 'سادسه', 'سابعه', 'ثامنه', 'تاسعه', 'عاشره'];
const TEEN = ['حادي', 'ثاني', 'ثالث', 'رابع', 'خامس', 'سادس', 'سابع', 'ثامن', 'تاسع'];
const TEEN_FEM = ['حاديه', 'ثانيه', 'ثالثه', 'رابعه', 'خامسه', 'سادسه', 'سابعه', 'ثامنه', 'تاسعه'];
const ORD = new Map();
ORD_BASE.forEach((w, i) => ORD.set('ال' + w, i + 1));
ORD_FEM.forEach((w, i) => ORD.set('ال' + w, i + 1));
TEEN.forEach((w, i) => ORD.set('ال' + w + ' عشر', i + 11));
TEEN_FEM.forEach((w, i) => ORD.set('ال' + w + ' عشره', i + 11));
const ORD_PATTERN = '(?:' + [...ORD.keys()].sort((a, b) => b.length - a.length).join('|') + '|\\d{1,3})';
const KIND_WORDS = { unit: ['الوحده', 'وحده'], chapter: ['الفصل', 'فصل', 'الباب', 'باب'], lesson: ['الدرس', 'درس'] };
const KIND_PATTERN = '(الوحده|وحده|الفصل|فصل|الباب|باب|الدرس|درس)';
const HEAD_RE = new RegExp('^' + KIND_PATTERN + '\\s*(?:رقم\\s*)?(' + ORD_PATTERN + ')?\\s*(?:[:\\-–—.،]\\s*)?(.*)$');
const QUERY_RE = new RegExp(KIND_PATTERN + '\\s*(?:رقم\\s*)?(' + ORD_PATTERN + ')');

function kindOf(word) {
  if (KIND_WORDS.unit.includes(word) || KIND_WORDS.chapter.includes(word)) return 'unit';
  return 'lesson';
}
function ordToNum(raw) {
  if (raw == null) return null;
  if (/^\d+$/.test(raw)) return Number(raw);
  return ORD.get(raw) || null;
}
function stripTrailingPage(s) { return s.replace(/[\s.·…_\-–—\d]+$/u, '').trim(); }

// ---- outline ----
function buildOutline(text) {
  text = String(text || '');
  const cands = [];
  let pos = 0;
  for (const rawLine of text.split('\n')) {
    const lineStart = pos; pos += rawLine.length + 1;
    const line = rawLine.trim();
    if (line.length < 3 || line.length > 110) continue;
    const n = normalizeArabic(line).replace(/\s+/g, ' ');
    const m = n.match(HEAD_RE);
    if (!m) continue;
    const num = ordToNum(m[2]);
    const rest = (m[3] || '').trim();
    // Reject ordinary sentences that merely start with the word "درس": need a number, a colon, or a very short line.
    const hasColon = /^(?:\S+\s*){1,4}[:：]/.test(line);
    if (num == null && !hasColon && n.length > 32) continue;
    cands.push({ kind: kindOf(m[1]), num, title: line.replace(/\s+/g, ' '), key: stripTrailingPage(n), pos: lineStart, rest });
  }
  if (!cands.length) return fallbackParts(text);
  const all = cands.map((c, i) => ({ ...c, i }));
  // distance to the next heading of any kind (units: next unit) — table-of-contents entries have tiny distances.
  for (let i = 0; i < all.length; i++) {
    const c = all[i];
    let next = text.length;
    for (let j = i + 1; j < all.length; j++) { if (c.kind === 'lesson' || all[j].kind === 'unit') { next = all[j].pos; break; } }
    c.dist = next - c.pos;
  }
  const pickBest = (arr, keyFn) => {
    const map = new Map();
    for (const c of arr) { const k = keyFn(c); const cur = map.get(k); if (!cur || c.dist > cur.dist) map.set(k, c); }
    return [...map.values()];
  };
  const units = pickBest(all.filter(c => c.kind === 'unit'), c => c.num + '|' + c.key).filter(c => c.dist >= 120).sort((a, b) => a.pos - b.pos);
  const unitIdxAt = p => { let idx = -1; for (let i = 0; i < units.length; i++) if (units[i].pos <= p) idx = i; return idx; };
  let lessons = pickBest(all.filter(c => c.kind === 'lesson'), c => unitIdxAt(c.pos) + '|' + c.key).filter(c => c.dist >= 120);
  if (units.length) {
    const realKeys = new Set(lessons.filter(c => unitIdxAt(c.pos) >= 0).map(c => c.key));
    lessons = lessons.filter(c => unitIdxAt(c.pos) >= 0 || !realKeys.has(c.key));
  }
  lessons.sort((a, b) => a.pos - b.pos);
  const secs = [...units.map(u => ({ ...u, type: 'unit' })), ...lessons.map(l => ({ ...l, type: 'lesson' }))].sort((a, b) => a.pos - b.pos);
  if (!secs.length) return fallbackParts(text);
  const outUnits = [], outLessons = [];
  units.forEach((u, i) => {
    const nextUnit = units[i + 1];
    outUnits.push({ id: 'u' + (i + 1), kind: 'unit', num: u.num || i + 1, title: u.title, start: u.pos, end: nextUnit ? nextUnit.pos : text.length, lessons: [] });
  });
  lessons.forEach((l, i) => {
    const nxt = secs.find(s => s.pos > l.pos);
    const ui = unitIdxAt(l.pos);
    const lesson = { id: 'l' + (i + 1), kind: 'lesson', num: l.num || i + 1, title: l.title, start: l.pos, end: nxt ? nxt.pos : text.length, unitId: ui >= 0 ? outUnits[ui].id : null };
    outLessons.push(lesson);
    if (ui >= 0) outUnits[ui].lessons.push(lesson);
  });
  return { units: outUnits, lessons: outLessons, parts: [] };
}
function fallbackParts(text) {
  const paras = String(text || '').split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  const parts = []; let cur = '', start = 0, offset = 0;
  for (const p of paras) {
    if (!cur) start = String(text).indexOf(p, offset);
    cur += (cur ? '\n\n' : '') + p; offset = start + cur.length;
    if (cur.length >= 2800) { parts.push({ id: 'p' + (parts.length + 1), kind: 'part', num: parts.length + 1, title: 'الجزء ' + (parts.length + 1), start, end: start + cur.length }); cur = ''; }
  }
  if (cur.length > 200) parts.push({ id: 'p' + (parts.length + 1), kind: 'part', num: parts.length + 1, title: 'الجزء ' + (parts.length + 1), start, end: start + cur.length });
  return { units: [], lessons: [], parts: parts.slice(0, 40) };
}
function outlineForClient(o) {
  const strip = x => ({ id: x.id, kind: x.kind, num: x.num, title: x.title.slice(0, 110) });
  return {
    units: o.units.map(u => ({ ...strip(u), lessons: u.lessons.map(strip) })),
    looseLessons: o.lessons.filter(l => !l.unitId).map(strip),
    parts: o.parts.map(strip)
  };
}
function allSections(o) { return [...o.units, ...o.lessons, ...o.parts]; }
function sectionText(text, sec, max) {
  const t = String(text).slice(sec.start, sec.end).trim();
  return t.length > max ? t.slice(0, max) : t;
}


// ---- visual-order (reversed) Arabic repair ----
// Some PDFs store Arabic in visual order, so extractors return every line reversed ("قدصلا :لوألا سردلا").
function looksReversedArabic(text) {
  const words = String(text || '').replace(/[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g, '').replace(TASHKEEL, '').split(/[\s.,،؛:!؟?()«»"']+/).filter(w => /^[\u0621-\u064A]{3,}$/.test(w));
  if (words.length < 30) return false;
  let fwd = 0, rev = 0;
  for (const w of words) {
    if (w.startsWith('ال') || w.startsWith('وال')) fwd++;
    if (w.endsWith('لا') && !w.endsWith('الا')) rev++;       // reversed "ال" prefix
    if (w.endsWith('ال') && w.length > 3 && !w.startsWith('ال')) rev += 0; // neutral
  }
  const common = ['في', 'من', 'على', 'الي', 'عن', 'ان', 'ما'];
  const commonRev = ['يف', 'نم', 'ىلع', 'ىلا', 'نع', 'نا', 'ام'];
  let cf = 0, cr = 0;
  for (const w of words) { if (common.includes(w)) cf++; if (commonRev.includes(w)) cr++; }
  return (rev >= 8 && rev > fwd * 1.5) || (cr >= 6 && cr > cf * 2);
}
function reverseLineKeepingRuns(line) {
  const rev = [...line].reverse().join('');
  // numbers and Latin words must keep their own left-to-right order
  const fixed = rev.replace(/[0-9٠-٩A-Za-z]+(?:[.,:/][0-9٠-٩A-Za-z]+)*/g, m => [...m].reverse().join(''));
  // combining marks must follow their base letter again
  return fixed.replace(/([\u064B-\u0652\u0670]+)([\u0621-\u064A])/g, '$2$1');
}
function fixVisualOrderArabic(text) {
  const clean = String(text || '').replace(/[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g, '');
  if (!looksReversedArabic(clean)) return { text: clean, fixed: false };
  const out = clean.split('\n').map(l => (/[\u0600-\u06FF]/.test(l) ? reverseLineKeepingRuns(l) : l)).join('\n');
  return { text: out, fixed: true };
}


// Cleans extracted text: repairs reversed Arabic, removes page footers and form feeds.
function prepareBookText(raw) {
  const fx = fixVisualOrderArabic(String(raw || '').replace(/\u0000/g, ' ').replace(/\r/g, '\n'));
  const lines = fx.text.replace(/\f/g, '\n').split('\n').map(l => l.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter(l => !/^(?:صفحة|ص)\s*\d+\s*(?:من|\/)\s*\d+/.test(l) && !/^\d{1,3}$/.test(l));
  return { text: lines.join('\n').replace(/\n{3,}/g, '\n\n').trim(), fixed: fx.fixed };
}

// ---- readability ----
function readable(s) {
  const t = String(s || '').replace(/\s+/g, '');
  if (t.length < 60) return false;
  const arabic = (t.match(/[\u0600-\u06FF]/g) || []).length;
  return arabic / t.length >= 0.45;
}

// ---- passage search ----
const STOP = new Set(['كيف', 'ماذا', 'لماذا', 'اشرح', 'لي', 'من', 'الي', 'علي', 'هذا', 'هذه', 'الذي', 'التي', 'عن', 'في', 'هل', 'اريد', 'ما', 'هو', 'هي', 'لخص', 'ملخص', 'اعطني', 'وضح', 'بسط', 'ارجو', 'قل', 'علمني', 'تعلم', 'اكتب', 'درس', 'الدرس', 'وحده', 'الوحده', 'كتاب', 'الكتاب'].map(normalizeArabic));
function stem(w) {
  let s = w.replace(/^(?:وال|بال|كال|فال|لل|ال)/, '');
  if (s.length < 3) s = w;
  return s.replace(/(?:ات|ون|ين|ان|ها|هم|كم|نا)$/, m => (s.length - m.length >= 3 ? '' : m));
}
function queryTerms(q) {
  return [...new Set(normalizeArabic(q).replace(/[^\u0600-\u06FFa-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)).map(stem).filter(w => w.length > 2))];
}
function passages(text, maxLen = 700) {
  const pieces = String(text || '').split(/\n{2,}|(?<=[.!؟?])\s+/).map(s => s.trim()).filter(s => s.length > 15);
  const out = []; let cur = '';
  for (const p of pieces) {
    if (cur && (cur.length + p.length) > maxLen) { out.push(cur); cur = ''; }
    cur += (cur ? ' ' : '') + p;
  }
  if (cur) out.push(cur);
  return out;
}
function rankPassages(text, query, k = 3, maxChars = 5500) {
  const terms = queryTerms(query);
  if (!terms.length) return null;
  const ps = passages(text).map(t => ({ t, n: normalizeArabic(t) }));
  if (!ps.length) return null;
  const df = terms.map(term => ps.reduce((c, p) => c + (p.n.includes(term) ? 1 : 0), 0));
  const scored = ps.map((p, idx) => {
    let score = 0;
    terms.forEach((term, i) => { if (df[i] && p.n.includes(term)) score += 1 + Math.log(1 + ps.length / df[i]); });
    return { idx, score, t: p.t };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score || a.idx - b.idx).slice(0, k).sort((a, b) => a.idx - b.idx);
  if (!scored.length) return null;
  let out = ''; for (const s of scored) { if ((out + s.t).length > maxChars) break; out += (out ? '\n\n' : '') + s.t; }
  return out;
}

// ---- resolving a request to a piece of the book ----
function parseRef(query) {
  const m = normalizeArabic(query).replace(/\s+/g, ' ').match(QUERY_RE);
  if (!m) return null;
  const num = ordToNum(m[2]);
  return num ? { kind: kindOf(m[1]), num } : null;
}
function resolveSection(text, outline, { sectionId, query } = {}, maxChars = 9000) {
  const secs = allSections(outline);
  if (sectionId) {
    const sec = secs.find(s => s.id === sectionId);
    if (!sec) return null;
    const t = sectionText(text, sec, maxChars);
    return readable(t) ? { id: sec.id, title: sec.title, kind: sec.kind, text: t } : { id: sec.id, title: sec.title, kind: sec.kind, text: t, unreadable: true };
  }
  const q = String(query || '');
  const ref = parseRef(q);
  if (ref) {
    let unitRef = null; const nq = normalizeArabic(q);
    // "الدرس الثالث من الوحدة الثانية"
    const all = [...nq.matchAll(new RegExp(KIND_PATTERN + '\\s*(?:رقم\\s*)?(' + ORD_PATTERN + ')', 'g'))];
    if (all.length >= 2) { const u = all.map(m => ({ kind: kindOf(m[1]), num: ordToNum(m[2]) })).find(x => x.kind === 'unit'); if (u) unitRef = u.num; }
    let sec = null;
    if (ref.kind === 'unit') sec = outline.units.find(u => u.num === ref.num);
    else {
      let pool = outline.lessons;
      if (unitRef) { const u = outline.units.find(x => x.num === unitRef); if (u) pool = u.lessons; }
      sec = pool.find(l => l.num === ref.num);
    }
    if (sec) { const t = sectionText(text, sec, maxChars); return { id: sec.id, title: sec.title, kind: sec.kind, text: t, unreadable: !readable(t) }; }
    return { notFound: true, ref };
  }
  if (/(?:كامل|كل الكتاب|ملخص الكتاب|نظره عامه)/.test(normalizeArabic(q)) && /كتاب/.test(normalizeArabic(q))) {
    const parts = secs.slice(0, 8).map(s => sectionText(text, s, 900)).join('\n\n') || String(text).slice(0, 5000);
    return { id: 'overview', title: 'نظرة عامة على الكتاب', kind: 'overview', text: parts.slice(0, maxChars) };
  }
  const found = rankPassages(text, q, 3, Math.min(maxChars, 5500));
  if (found) return { id: 'search', title: 'ما يخص طلبك في الكتاب', kind: 'search', text: found, unreadable: !readable(found) };
  return null;
}

// ---- offline fallbacks (no AI key) ----
function cleanForSpeech(t) { return String(t || '').replace(/[*#`_>|~]+/g, '').replace(/^\s*[-•]\s+/gm, '').replace(/[ \t]+/g, ' ').trim(); }
function sentences(t) { return cleanForSpeech(t).split(/(?<=[.!؟?۔])\s+|\n+/).map(s => s.trim()).filter(s => s.length > 8); }
function slidesFromText(t, maxSlides = 8, maxChars = 230) {
  const out = []; let cur = '';
  for (const s of sentences(t)) {
    if (cur && (cur.length + s.length) > maxChars) { out.push(cur); cur = ''; }
    cur += (cur ? ' ' : '') + s;
  }
  if (cur) out.push(cur);
  return out.slice(0, maxSlides);
}
function simpleSummary(t, n = 5) {
  const ss = sentences(t); if (ss.length <= n) return ss;
  const step = ss.length / n; const out = [];
  for (let i = 0; i < n; i++) out.push(ss[Math.floor(i * step)]);
  return out;
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function contentWords(t) {
  return [...new Set(cleanForSpeech(t).split(/[\s،,؛:.!؟?()«»"'\-–—]+/).filter(w => w.length >= 4 && !/\d/.test(w) && !STOP.has(normalizeArabic(w))))];
}
function makeCloze(t, count = 5) {
  const words = contentWords(t);
  const sents = sentences(t).filter(s => s.length >= 35 && s.length <= 170 && s.split(/\s+/).length >= 6);
  const qs = [];
  for (const s of shuffle(sents.slice())) {
    if (qs.length >= count) break;
    const inSent = contentWords(s).sort((a, b) => b.length - a.length);
    const target = inSent[0]; if (!target) continue;
    const pool = words.filter(w => !s.includes(w) && Math.abs(w.length - target.length) <= 3);
    if (pool.length < 2) continue;
    const opts = shuffle([target, ...shuffle(pool.slice()).slice(0, 2)]);
    qs.push({ type: 'mcq', q: 'أكمل الجملة: ' + s.replace(target, '_____'), options: opts, answer: opts.indexOf(target), why: 'هكذا وردت الجملة في الكتاب: ' + s });
  }
  return qs;
}

module.exports = { prepareBookText, fixVisualOrderArabic, looksReversedArabic, normalizeArabic, buildOutline, outlineForClient, resolveSection, rankPassages, parseRef, readable, slidesFromText, simpleSummary, makeCloze, cleanForSpeech, sentences, queryTerms };

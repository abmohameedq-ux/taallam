'use strict';
// Interactive experiments attached to book pages (phase 2).
// An experiment = a simulation template (public/sim/templates.js: real equations) + parameters + the
// book pages it was derived from. Suggestions come from the book's own text (keywords per page) and
// always start as "needs review": nothing reaches students until an admin approves it, and approval is
// refused when the template's verification checks fail. Re-running the suggestion never duplicates.
const crypto = require('crypto');
const path = require('path');
const SIMT = require('../public/sim/templates.js');

module.exports = function createInteractives(ctx) {
  const { dataDir, readJsonFile, saveJsonFile, learn } = ctx;
  const file = path.join(dataDir, 'book-interactives.json');
  const now = () => new Date().toISOString();
  const read = () => { const d = readJsonFile(file, {}); return Array.isArray(d.items) ? d.items : []; };
  const write = items => saveJsonFile(file, { items });
  const norm = t => learn.normalizeArabic(String(t || '')).toLowerCase().replace(/\s+/g, ' ');
  const err = (m, status = 400) => Object.assign(new Error(m), { status });
  const cleanPages = (pages, max) => [...new Set((Array.isArray(pages) ? pages : []).map(Number).filter(n => Number.isInteger(n) && n >= 1 && (!max || n <= max)))].sort((a, b) => a - b).slice(0, 40);
  const failing = it => (it.checks || []).filter(c => !c.ok);

  function list({ bookId, status } = {}) { return read().filter(i => (!bookId || i.bookId === bookId) && (!status || i.status === status)).sort((a, b) => a.pages[0] - b.pages[0] || a.createdAt.localeCompare(b.createdAt)); }
  const get = id => read().find(i => i.id === id) || null;
  function publicView(i, books) { const b = books && books.get(i.bookId); return { id: i.id, bookId: i.bookId, bookTitle: b ? b.title : '', template: i.template, title: i.title, params: i.params, pages: i.pages, excerpt: i.source && i.source.excerpt || '', note: i.note || '' }; }
  const approvedFor = (bookId, page) => list({ bookId, status: 'approved' }).filter(i => !page || i.pages.includes(Number(page)));

  function create({ bookId, template, title, params, pages, note, origin = 'manual', excerpt = '', confidence = 1 }, book) {
    const t = SIMT.TEMPLATES[template]; if (!t) throw err('نوع التجربة غير معروف.');
    if (!book) throw err('الكتاب غير موجود.', 404);
    const v = SIMT.validate(template, params); if (!v.ok) throw err(v.error);
    const pg = cleanPages(pages, book.pages); if (!pg.length) throw err('حدّد صفحة واحدة على الأقل من الكتاب تُشتق منها التجربة.');
    const checks = SIMT.selfCheckAll(template);
    const item = { id: crypto.randomUUID(), bookId, template, title: String(title || '').trim().slice(0, 140) || (t.title + ' — صفحة ' + pg[0]), params: v.params, pages: pg, source: { pages: pg, excerpt: String(excerpt).slice(0, 400), kind: excerpt ? 'book-text' : 'none' }, note: String(note || '').slice(0, 500), origin, status: failing({ checks }).length ? 'error' : 'needs_review', confidence, checks, createdAt: now(), updatedAt: now(), reviewedBy: '', reviewedAt: '' };
    const items = read(); items.push(item); write(items); return item;
  }
  function update(id, patch, book) {
    const items = read(), it = items.find(i => i.id === id); if (!it) throw err('التجربة غير موجودة.', 404);
    if (patch.title !== undefined) it.title = String(patch.title).trim().slice(0, 140) || it.title;
    if (patch.note !== undefined) it.note = String(patch.note).slice(0, 500);
    if (patch.params !== undefined) { const v = SIMT.validate(it.template, patch.params); if (!v.ok) throw err(v.error); it.params = v.params; }
    if (patch.pages !== undefined) { const pg = cleanPages(patch.pages, book && book.pages); if (!pg.length) throw err('حدّد صفحة واحدة على الأقل.'); it.pages = pg; it.source.pages = pg; }
    if (it.status === 'approved') it.status = 'needs_review'; // an edited experiment must be approved again
    it.updatedAt = now(); write(items); return it;
  }
  function setStatus(id, status, by) {
    if (!['approved', 'rejected', 'needs_review'].includes(status)) throw err('حالة غير صالحة.');
    const items = read(), it = items.find(i => i.id === id); if (!it) throw err('التجربة غير موجودة.', 404);
    if (status === 'approved') {
      it.checks = SIMT.selfCheckAll(it.template); // verification is re-run at approval time
      const bad = failing(it); if (bad.length) { it.status = 'error'; write(items); throw err('لا يمكن الاعتماد: فشل التحقق من «' + bad[0].name + '».', 422); }
      if (!it.pages.length) throw err('لا يمكن الاعتماد دون مرجع صفحة.', 422);
    }
    it.status = status; it.reviewedBy = by || ''; it.reviewedAt = now(); it.updatedAt = now(); write(items); return it;
  }
  function remove(id) { const items = read(), n = items.length, next = items.filter(i => i.id !== id); if (next.length === n) throw err('التجربة غير موجودة.', 404); write(next); }
  function invalidateForBook(bookId) { const items = read(); let n = 0; for (const i of items) if (i.bookId === bookId && i.status === 'approved') { i.status = 'needs_review'; i.note = ((i.note ? i.note + ' · ' : '') + 'استُبدل ملف الكتاب: راجع مراجع الصفحات.').slice(0, 500); n++; } if (n) write(items); return n; }
  const removeForBook = bookId => { const items = read(), next = items.filter(i => i.bookId !== bookId); if (next.length !== items.length) write(next); };

  // pages: array of page texts (index 0 = page 1). Suggestions are grouped by consecutive pages and de-duplicated.
  function detect(book, pageTexts) {
    const normPages = pageTexts.map(norm), kw = Object.fromEntries(Object.entries(SIMT.KEYWORDS).map(([k, arr]) => [k, arr.map(w => ({ raw: w, n: norm(w) }))]));
    const existing = new Set(read().map(i => i.bookId + '|' + i.template + '|' + i.pages[0]));
    let created = 0, skipped = 0; const made = [];
    for (const [tid, words] of Object.entries(kw)) {
      const hitPages = [];
      normPages.forEach((txt, i) => { const hits = words.filter(w => txt.includes(w.n)); const strong = hits.some(w => w.n.length >= 10); if (hits.length >= 2 || strong) hitPages.push({ n: i + 1, hits: hits.length, first: hits[0] }); });
      const runs = []; for (const h of hitPages) { const last = runs[runs.length - 1]; if (last && h.n - last.pages[last.pages.length - 1] <= 1) { last.pages.push(h.n); last.hits += h.hits; } else runs.push({ pages: [h.n], hits: h.hits, first: h.first }); }
      for (const run of runs) {
        if (existing.has(book.id + '|' + tid + '|' + run.pages[0])) { skipped++; continue; }
        if (list({ bookId: book.id }).length + made.length >= 80) break;
        const raw = String(pageTexts[run.pages[0] - 1] || ''), sentences = raw.split(/(?<=[.!؟?۔])\s+|\n+/).map(s => s.trim()).filter(Boolean);
        const ex = sentences.find(s => norm(s).includes(run.first.n)) || sentences[0] || '';
        const conf = Math.min(0.95, 0.4 + 0.12 * run.hits + 0.05 * run.pages.length);
        made.push(create({ bookId: book.id, template: tid, pages: run.pages.slice(0, 6), origin: 'rule', excerpt: ex.slice(0, 300), confidence: Math.round(conf * 100) / 100 }, book)); created++;
      }
    }
    return { created, skipped, items: made };
  }
  return { list, get, publicView, approvedFor, create, update, setStatus, remove, removeForBook, detect, invalidateForBook, SIMT };
};

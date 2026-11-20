'use strict';
// Teacher management used by both the school admin page and the platform admin's school editor.
// TEACHERS.mount(host, { base }) draws the list of teachers of one school and opens dialogs to add a
// teacher, change what he teaches (subject + grades), set a new password, or disable the account.
// `base` is the API prefix: '/api/school-admin/teachers' or '/api/admin/schools/<id>/teachers'.
(function () {
  if (window.TEACHERS) return;
  const h = (tag, attrs, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v); } for (const c of kids.flat(Infinity)) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c))); return n; };
  async function call(url, method, body) {
    const r = await TQ.fetch(url, { method: method || 'GET', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'تعذّر تنفيذ الطلب.'); return d;
  }
  // rows of [subject] x [grades it is taught in]; get() returns [{grade, subject}]
  function assignEditor(options, initial) {
    const rows = h('div', { class: 'asg-rows' }), OTHER = '__other__';
    function addRow(subject, grades) {
      const known = options.subjects.includes(subject), sel = h('select', { class: 'asg-subject', 'aria-label': 'المادة' }, h('option', { value: '', text: '— اختر المادة —' }), ...options.subjects.map(s => h('option', { value: s, text: s, ...(s === subject ? { selected: true } : {}) })), h('option', { value: OTHER, text: 'أخرى…', ...(subject && !known ? { selected: true } : {}) }));
      const free = h('input', { class: 'asg-free', maxlength: '100', placeholder: 'اكتب اسم المادة', value: subject && !known ? subject : '' }); free.hidden = !(subject && !known);
      sel.addEventListener('change', () => { free.hidden = sel.value !== OTHER; if (!free.hidden) free.focus(); });
      const checks = h('div', { class: 'asg-grades' }, options.grades.map(g => h('label', {}, h('input', { type: 'checkbox', value: g, ...((grades || []).includes(g) ? { checked: true } : {}) }), ' ' + g)));
      const row = h('div', { class: 'asg-row' }, h('div', { class: 'asg-top' }, sel, free, h('button', { type: 'button', class: 'danger', 'aria-label': 'حذف هذه المادة', text: '✕', onclick: () => row.remove() })), h('small', { class: 'muted', text: 'الصفوف التي يدرّس فيها هذه المادة:' }), checks);
      rows.append(row); return row;
    }
    const byS = new Map(); for (const a of initial || []) { if (!byS.has(a.subject)) byS.set(a.subject, []); byS.get(a.subject).push(a.grade); }
    if (byS.size) for (const [s, g] of byS) addRow(s, g); else addRow('', []);
    const el = h('div', {}, rows, h('button', { type: 'button', class: 'secondary', text: '➕ إضافة مادة أخرى', onclick: () => addRow('', []).querySelector('select').focus() }));
    return { el, get() { const out = []; rows.querySelectorAll('.asg-row').forEach(r => { const sv = r.querySelector('.asg-subject').value, subject = sv === OTHER ? r.querySelector('.asg-free').value.trim() : sv; if (!subject) return; r.querySelectorAll('input[type=checkbox]:checked').forEach(c => out.push({ grade: c.value, subject })); }); return out; } };
  }
  function mount(host, { base }) {
    let data = { teachers: [], options: { grades: [], subjects: [] } }; const status = h('p', { class: 'status', role: 'status' }), list = h('div', {});
    const say = t => { status.textContent = t || ''; };
    async function load() { try { data = await call(base); render(); } catch (e) { say(e.message); } }
    function chips(t) { const g = new Map(); for (const a of t.assignments) { if (!g.has(a.subject)) g.set(a.subject, []); g.get(a.subject).push(a.grade); } return [...g].map(([s, gr]) => h('span', { class: 'pill', text: s + ' — ' + gr.join('، ') })); }
    function render() {
      list.replaceChildren(...(data.teachers.length ? data.teachers.map(t => h('div', { class: 'item' }, h('div', { style: 'flex:1' }, h('b', { text: '👨‍🏫 ' + t.name }), ' ', h('span', { class: 'pill', text: t.active ? 'نشط' : 'معطّل' }), h('small', { dir: 'ltr', text: t.email }), h('div', { class: 'asg-chips' }, chips(t))),
        h('div', { class: 'top-actions' }, h('button', { type: 'button', class: 'secondary', text: '✏️ المواد والصفوف', onclick: () => form(t) }), h('button', { type: 'button', class: 'secondary', text: '🔑 كلمة مرور جديدة', onclick: () => pw(t) }), h('button', { type: 'button', class: t.active ? 'danger' : 'secondary', text: t.active ? 'تعطيل' : 'تفعيل', onclick: () => toggle(t) })))) : [h('div', { class: 'empty', text: 'لا يوجد معلمون بعد. اضغط «إضافة معلم».' })]));
    }
    function form(t) {
      const ed = assignEditor(data.options, t ? t.assignments : []), f = h('form', {}, h('div', { class: 'grid' }, h('label', {}, 'اسم المعلم', h('input', { name: 'name', required: true, maxlength: '120', value: t ? t.name : '' })), t ? null : h('label', {}, 'البريد الإلكتروني (للدخول)', h('input', { name: 'email', type: 'email', required: true, maxlength: '254', dir: 'ltr' })), t ? null : h('label', {}, 'كلمة مرور مؤقتة (8 أحرف على الأقل)', h('input', { name: 'password', type: 'text', required: true, minlength: '8', maxlength: '128', dir: 'ltr', autocomplete: 'off' }))),
        h('h3', { text: 'المواد التي يدرّسها' }), ed.el, h('p', { class: 'status', role: 'status' }), h('button', { class: 'primary', text: t ? 'حفظ التعديلات' : 'إضافة المعلم' }));
      const dlg = UI.open(t ? 'تعديل: ' + t.name : 'إضافة معلم', [f], { size: 'lg' }), st = f.querySelector('.status');
      f.onsubmit = async e => {
        e.preventDefault(); const assignments = ed.get(); if (!assignments.length) { st.textContent = 'اختر مادة واحدة على الأقل مع صف واحد على الأقل.'; return; }
        try { const body = t ? { name: f.name.value, assignments } : { name: f.name.value, email: f.email.value, password: f.password.value, assignments }; const d = await call(base + (t ? '/' + encodeURIComponent(t.id) : ''), t ? 'PATCH' : 'POST', body); if (d.queued) { say('سيُحفظ عند عودة الإنترنت.'); dlg.close(); return; } dlg.close(); say(t ? 'تم حفظ التعديلات.' : 'أُضيف المعلم. أعطه بريده وكلمة المرور المؤقتة ليدخل.'); load(); } catch (err) { st.textContent = err.message; }
      };
    }
    async function pw(t) { const v = prompt('كلمة المرور الجديدة للمعلم ' + t.name + ' (8 أحرف على الأقل). سيُسجَّل خروجه من كل الأجهزة:'); if (!v) return; try { await call(base + '/' + encodeURIComponent(t.id), 'PATCH', { newPassword: v }); say('تم تغيير كلمة المرور.'); } catch (e) { say(e.message); } }
    async function toggle(t) { if (t.active && !confirm('تعطيل حساب المعلم ' + t.name + '؟ لن يستطيع الدخول.')) return; try { await call(base + '/' + encodeURIComponent(t.id), 'PATCH', { active: !t.active }); load(); } catch (e) { say(e.message); } }
    host.replaceChildren(h('div', { class: 'ui-bar' }, h('button', { type: 'button', text: '➕ إضافة معلم', onclick: () => form(null) })), status, list); load();
    return { reload: load };
  }
  const st = document.createElement('style');
  st.textContent = '.asg-row{border:2px solid #e3ebe2;border-radius:14px;padding:10px;margin:8px 0;background:#fbfdfb}.asg-top{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px}.asg-top select,.asg-top input{flex:1;min-width:150px}.asg-grades{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:4px 10px;margin-top:6px}.asg-grades label{display:flex;gap:6px;align-items:center;font-weight:400}.asg-grades input{width:auto;margin:0}.asg-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}';
  document.head.append(st);
  window.TEACHERS = { mount, assignEditor };
})();

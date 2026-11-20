'use strict';
// Shared UI kit for the admin screens.
//  - UI.open(title, nodes, opts): a dialog (centred on computers, full-screen sheet on phones) whose body is
//    made of EXISTING page elements. The elements are moved in and moved back to their exact place when the
//    dialog closes, so every handler, id and form value keeps working and nothing is duplicated.
//  - UI.hub(container, tiles): a grid of big action tiles (icon, title, one-line help, optional badge).
//  - UI.actions(container, buttons): a row of buttons that each open a dialog.
// Accessible: role=dialog, focus is moved into the dialog and returned, Tab is trapped, Esc closes.
(function () {
  if (window.UI) return;
  const css = `
.ui-lock{overflow:hidden}
.ui-ov{position:fixed;inset:0;z-index:900;background:#0f2a2299;display:flex;align-items:center;justify-content:center;padding:16px;animation:uiFade .15s ease-out}
.ui-modal{background:var(--ui-bg,#fff);color:inherit;width:min(100%,760px);max-height:min(92vh,100%);border-radius:20px;box-shadow:0 24px 70px #0006;display:flex;flex-direction:column;overflow:hidden;animation:uiPop .18s ease-out}
.ui-modal.lg{width:min(100%,1040px)}.ui-modal.sm{width:min(100%,520px)}
.ui-head{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #0001;background:var(--ui-head,#f6f9f4)}
.ui-head h2{margin:0;font-size:18px;flex:1;line-height:1.5}
.ui-x{border:0;background:#0000000d;border-radius:12px;min-width:44px;min-height:44px;font:inherit;font-size:18px;cursor:pointer;color:inherit}
.ui-x:hover{background:#00000018}.ui-x:focus-visible{outline:3px solid #d6a85f}
.ui-body{padding:14px 16px 20px;overflow:auto;-webkit-overflow-scrolling:touch;flex:1}
.ui-body>.card{box-shadow:none;border:0;padding:0;margin:0}
.ui-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;margin-top:10px}
.ui-tile{display:flex;flex-direction:column;align-items:flex-start;gap:4px;text-align:start;padding:16px;border-radius:18px;border:2px solid #e3ebe2;background:#fff;color:inherit;cursor:pointer;font:inherit;min-height:112px;position:relative;transition:transform .08s,border-color .15s,box-shadow .15s}
.ui-tile:hover{border-color:#2b7a5f;box-shadow:0 6px 18px #173f3622}.ui-tile:active{transform:scale(.98)}.ui-tile:focus-visible{outline:3px solid #d6a85f}
.ui-tile .ic{font-size:30px;line-height:1}.ui-tile b{font-size:16px}.ui-tile small{color:#5d7167;line-height:1.5}
.ui-tile .ui-badge{position:absolute;top:10px;inset-inline-end:12px;background:#d8533f;color:#fff;border-radius:99px;min-width:24px;padding:0 8px;text-align:center;font-size:13px;line-height:24px}
.ui-bar{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}.ui-bar button{min-height:44px}
@keyframes uiFade{from{opacity:0}to{opacity:1}}@keyframes uiPop{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}
@media (max-width:640px){.ui-ov{padding:0;align-items:stretch}.ui-modal,.ui-modal.lg,.ui-modal.sm{width:100%;max-height:100%;height:100%;border-radius:0;animation:uiSlide .2s ease-out}.ui-head{padding-top:max(12px,env(safe-area-inset-top))}.ui-body{padding-bottom:max(20px,env(safe-area-inset-bottom))}.ui-tiles{grid-template-columns:1fr 1fr}.ui-tile{min-height:104px;padding:14px}}
@keyframes uiSlide{from{transform:translateY(40px);opacity:.4}to{transform:none;opacity:1}}
@media (prefers-reduced-motion:reduce){.ui-ov,.ui-modal{animation:none}}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--ui-bg:#17231f;--ui-head:#1d2c27}.ui-tile{background:#1d2c27;border-color:#2f453d}.ui-tile small{color:#a9bdb3}}`;
  const st = document.createElement('style'); st.textContent = css; document.head.append(st);
  const el = (tag, attrs, ...kids) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs || {})) { if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? '' : v); } for (const c of kids.flat(Infinity)) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c))); return n; };
  const stack = []; let seq = 0;
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  const visible = n => !!(n.offsetWidth || n.offsetHeight || n.getClientRects().length);

  // open a dialog. nodes: elements to MOVE in (a function returning Node(s) builds new content instead)
  function open(title, nodes, opts = {}) {
    const id = 'ui-t' + (++seq), restore = [], opener = document.activeElement;
    const body = el('div', { class: 'ui-body' }), x = el('button', { type: 'button', class: 'ui-x', 'aria-label': 'إغلاق', text: '✕' });
    const box = el('section', { class: 'ui-modal ' + (opts.size || ''), role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id, tabindex: '-1' }, el('div', { class: 'ui-head' }, el('h2', { id, text: title }), x), body);
    const ov = el('div', { class: 'ui-ov' }, box);
    const list = typeof nodes === 'function' ? [].concat(nodes() || []) : [].concat(nodes || []);
    for (const n0 of list) { const n = typeof n0 === 'string' ? document.querySelector(n0) : n0; if (!n) continue; if (n.parentNode && !n.dataset.uiBuilt) { const ph = document.createComment('ui-home'); n.parentNode.insertBefore(ph, n); restore.push([n, ph]); } body.append(n); n.classList.remove('hidden'); n.hidden = false; }
    let closed = false;
    function close(why) {
      if (closed) return; if (opts.beforeClose && opts.beforeClose(why) === false) return; closed = true;
      for (const [n, ph] of restore.reverse()) { if (ph.parentNode) { ph.parentNode.insertBefore(n, ph); ph.remove(); } }
      ov.remove(); stack.splice(stack.indexOf(api), 1); if (!stack.length) document.documentElement.classList.remove('ui-lock');
      document.removeEventListener('keydown', onKey, true); if (opts.onClose) opts.onClose(why); if (opener && opener.focus && document.contains(opener)) opener.focus();
    }
    function onKey(e) {
      if (stack[stack.length - 1] !== api) return;
      if (e.key === 'Escape') { e.stopPropagation(); close('esc'); return; }
      if (e.key !== 'Tab') return;
      const f = [...box.querySelectorAll(FOCUSABLE)].filter(visible); if (!f.length) { e.preventDefault(); box.focus(); return; }
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    const api = { el: ov, box, body, close, setTitle: t => { box.querySelector('h2').textContent = t; } };
    x.addEventListener('click', () => close('x'));
    ov.addEventListener('mousedown', e => { if (e.target === ov && opts.dismissable !== false) close('backdrop'); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(ov); document.documentElement.classList.add('ui-lock'); stack.push(api);
    const first = box.querySelector('input:not([type=hidden]):not([type=file]),select,textarea'); setTimeout(() => (opts.focus === false ? box : (first && visible(first) ? first : box)).focus({ preventScroll: true }), 30);
    if (opts.onOpen) opts.onOpen(api);
    return api;
  }
  // the children of a stash section (all but its heading) as the dialog body
  function openSection(selector, title, opts = {}) {
    const sec = document.querySelector(selector); if (!sec) return null;
    const h = sec.querySelector(':scope > h2, :scope > h3'), kids = [...sec.children].filter(c => c !== h);
    return open(title || (h && h.textContent.trim()) || '', kids, opts);
  }
  // tiles: [{icon, title, desc, badge:'#id' or fn, show: fn, nodes: [selectors] | section: selector | click: fn, size}]
  function hub(container, tiles) {
    container.replaceChildren(...tiles.filter(t => !t.show || t.show()).map(t => {
      const badge = el('span', { class: 'ui-badge hidden', ...(t.badgeId ? { id: t.badgeId } : {}) });
      return el('button', { type: 'button', class: 'ui-tile', onclick: () => { if (t.click) t.click(); else if (t.section) openSection(t.section, t.title, { size: t.size, onOpen: t.onOpen, onClose: t.onClose }); else open(t.title, t.nodes, { size: t.size, onOpen: t.onOpen, onClose: t.onClose }); } },
        el('span', { class: 'ic', 'aria-hidden': 'true', text: t.icon || '•' }), el('b', { text: t.title }), t.desc ? el('small', { text: t.desc }) : null, badge);
    }));
  }
  // a row of buttons that open dialogs (used on screens whose main content is a list)
  function actions(container, buttons, where) {
    const bar = el('div', { class: 'ui-bar' }, buttons.filter(b => !b.show || b.show()).map(b => el('button', { type: 'button', class: b.primary === false ? 'secondary' : '', onclick: () => { if (b.click) b.click(); else if (b.section) openSection(b.section, b.title || b.label, { size: b.size, onOpen: b.onOpen, onClose: b.onClose }); else open(b.title || b.label, b.nodes, { size: b.size, onOpen: b.onOpen, onClose: b.onClose }); } }, b.label)));
    if (where === 'prepend') container.prepend(bar); else container.append(bar); return bar;
  }
  const api = { open, openSection, hub, actions, el, closeAll: () => { while (stack.length) stack[stack.length - 1].close('all'); } };
  window.UI = api;
})();

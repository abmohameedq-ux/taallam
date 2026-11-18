'use strict';
// Small shared helpers: printing (receipts / statements), CSV export, and push-notification opt-in.
(() => {
  if (window.TOOLS) return;
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fm = n => Number(n || 0).toLocaleString('ar', { maximumFractionDigits: 2 });
  const css = 'body{font-family:Tahoma,Arial,sans-serif;margin:24px;color:#173f36;line-height:1.7}h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:18px 0 6px}.muted{color:#5d7167;font-size:13px}table{width:100%;border-collapse:collapse;margin:8px 0}th,td{border:1px solid #cfd8d2;padding:7px 9px;text-align:right}th{background:#f1f5ef}.tot{font-weight:700;background:#f8f4e8}.box{border:2px solid #173f36;border-radius:12px;padding:14px 18px;margin:12px 0}.sign{display:flex;justify-content:space-between;margin-top:46px}.sign div{width:40%;border-top:1px solid #173f36;padding-top:6px;text-align:center}@media print{button{display:none}}';
  function print(title, body) {
    const w = window.open('', '_blank');
    if (!w) { (window.TQ ? TQ.toast : alert)('اسمح بالنوافذ المنبثقة ثم أعد المحاولة للطباعة.'); return; }
    w.document.write('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title><style>' + css + '</style></head><body>' + body + '<p><button onclick="print()">🖨️ طباعة / حفظ PDF</button></p></body></html>');
    w.document.close(); setTimeout(() => { try { w.focus(); w.print(); } catch { /* user can press the button */ } }, 400);
  }
  const head = (school, title) => '<h1>' + esc(school || 'المدرسة') + '</h1><div class="muted">' + esc(title) + ' — ' + esc(new Date().toLocaleDateString('ar')) + '</div>';
  // statement of account for one student
  function statement({ school, name, grade, section, currency, fees, totals, payments }) {
    return head(school, 'كشف حساب الرسوم') + '<div class="box"><b>الطالب:</b> ' + esc(name) + ' &nbsp; <b>الصف:</b> ' + esc([grade, section].filter(Boolean).join(' · ') || '—') + '</div>'
      + '<table><tr><th>الرسوم</th><th>المطلوب</th><th>المدفوع</th><th>المتبقي</th></tr>' + (fees || []).map(f => '<tr><td>' + esc(f.name) + '</td><td>' + fm(f.due) + '</td><td>' + fm(f.paid) + '</td><td>' + fm(f.remaining) + '</td></tr>').join('')
      + '<tr class="tot"><td>الإجمالي (' + esc(currency) + ')</td><td>' + fm(totals.due) + '</td><td>' + fm(totals.paid) + '</td><td>' + fm(totals.remaining) + '</td></tr></table>'
      + (payments && payments.length ? '<h2>سجل الدفعات</h2><table><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>ملاحظة</th></tr>' + payments.map(p => '<tr><td>' + esc(new Date(p.at).toLocaleDateString('ar')) + '</td><td>' + esc(p.feeName) + '</td><td>' + fm(p.amount) + '</td><td>' + esc(p.note || '') + '</td></tr>').join('') + '</table>' : '');
  }
  // receipt for one payment
  function receipt({ school, name, grade, currency, payment, remaining }) {
    return head(school, 'سند استلام رسوم') + '<div class="box"><p><b>استلمنا من ولي أمر الطالب:</b> ' + esc(name) + ' (' + esc(grade || '—') + ')</p><p><b>مبلغ وقدره:</b> ' + fm(payment.amount) + ' ' + esc(currency) + '</p><p><b>عن:</b> ' + esc(payment.feeName) + '</p>'
      + (payment.note ? '<p><b>ملاحظة:</b> ' + esc(payment.note) + '</p>' : '') + '<p><b>التاريخ:</b> ' + esc(new Date(payment.at).toLocaleString('ar')) + ' &nbsp; <b>رقم السند:</b> ' + esc(String(payment.id).slice(0, 8)) + '</p>'
      + (remaining != null ? '<p class="muted">المتبقي على الطالب بعد هذه الدفعة: ' + fm(remaining) + ' ' + esc(currency) + '</p>' : '') + '</div><div class="sign"><div>المستلم</div><div>ولي الأمر</div></div>';
  }
  function csv(filename, rows) {
    const cell = v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const blob = new Blob(['\ufeff' + rows.map(r => r.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---- push opt-in ----
  const key64 = s => { const p = '='.repeat((4 - s.length % 4) % 4), b = (s + p).replace(/-/g, '+').replace(/_/g, '/'), raw = atob(b); return Uint8Array.from([...raw].map(c => c.charCodeAt(0))); };
  const PUSH = {
    supported: () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
    async state() {
      if (!PUSH.supported()) return 'unsupported'; if (Notification.permission === 'denied') return 'denied';
      try { const reg = await navigator.serviceWorker.ready; return (await reg.pushManager.getSubscription()) ? 'on' : 'off'; } catch { return 'off'; }
    },
    async enable() {
      if (!PUSH.supported()) throw new Error('هذا المتصفح لا يدعم الإشعارات. على الآيفون ثبّت التطبيق على الشاشة الرئيسية أولًا.');
      const k = await (await fetch('/api/push/key')).json(); if (!k.supported) throw new Error('الإشعارات غير مفعّلة على الخادم بعد.');
      if ((await Notification.requestPermission()) !== 'granted') throw new Error('لم تسمح بالإشعارات. يمكنك السماح بها من إعدادات المتصفح.');
      const reg = await navigator.serviceWorker.ready; let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key64(k.key) });
      const r = await fetch('/api/push/subscribe', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'تعذّر تفعيل الإشعارات.');
    },
    async disable() {
      const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription(); if (!sub) return;
      await fetch('/api/push/unsubscribe', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {}); await sub.unsubscribe();
    },
    // a ready-made button: shows the state and toggles it
    async button(host) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'secondary'; host.append(b);
      const paint = async () => { const s = await PUSH.state(); b.hidden = s === 'unsupported'; b.textContent = s === 'on' ? '🔕 إيقاف الإشعارات' : s === 'denied' ? '🔔 الإشعارات محظورة في المتصفح' : '🔔 تفعيل الإشعارات'; b.disabled = s === 'denied'; b.dataset.s = s; };
      b.onclick = async () => { try { if (b.dataset.s === 'on') await PUSH.disable(); else await PUSH.enable(); } catch (e) { (window.TQ ? TQ.toast : alert)(e.message); } paint(); };
      paint(); return b;
    }
  };
  window.TOOLS = { esc, fm, print, statement, receipt, csv }; window.PUSH = PUSH;
})();

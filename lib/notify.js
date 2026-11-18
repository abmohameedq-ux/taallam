'use strict';
// In-app notifications (bell list) and Web Push.
//  - A notification belongs to a school roster student; the student's own account and the
//    guardians linked to that student can read it.
//  - Push needs the `web-push` package (listed in package.json). If it is not installed or no
//    subscription exists, notifications still work in-app and nothing breaks.
const crypto = require('crypto');
const path = require('path');

module.exports = function createNotify(ctx) {
  const { dataDir, readJsonFile, saveJsonFile } = ctx;
  const itemsFile = path.join(dataDir, 'notifications.json');
  const subsFile = path.join(dataDir, 'push-subscriptions.json');
  const keysFile = path.join(dataDir, 'push-keys.json');
  const now = () => new Date().toISOString();
  let webpush = null; try { webpush = require('web-push'); } catch { webpush = null; }

  // ---- VAPID keys (generated once, kept in the data directory) ----
  const b64u = b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  function vapid() {
    let k = readJsonFile(keysFile, null);
    if (!k || !k.publicKey || !k.privateKey) {
      const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
      k = { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()), createdAt: now() };
      saveJsonFile(keysFile, k);
    }
    return k;
  }
  function configure() {
    if (!webpush) return false;
    const k = vapid();
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:noreply@example.com', k.publicKey, k.privateKey);
    return true;
  }
  const supported = () => !!webpush;
  const publicKey = () => vapid().publicKey;

  // ---- subscriptions ----
  const readSubs = () => { const d = readJsonFile(subsFile, {}); return Array.isArray(d.subs) ? d.subs : []; };
  const saveSubs = subs => saveJsonFile(subsFile, { subs: subs.slice(-20000) });
  function subscribe(viewer, sub) {
    const endpoint = String(sub && sub.endpoint || ''), keys = sub && sub.keys || {};
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 1200 || !keys.p256dh || !keys.auth || String(keys.p256dh).length > 200 || String(keys.auth).length > 100) throw Object.assign(new Error('اشتراك الإشعارات غير صالح.'), { status: 400 });
    const subs = readSubs().filter(s => s.endpoint !== endpoint);
    subs.push({ endpoint, keys: { p256dh: String(keys.p256dh), auth: String(keys.auth) }, ...viewer, at: now() });
    saveSubs(subs);
  }
  const unsubscribe = endpoint => saveSubs(readSubs().filter(s => s.endpoint !== String(endpoint || '')));

  async function pushTo(filter, payload) {
    if (!configure()) return 0;
    const targets = readSubs().filter(filter); if (!targets.length) return 0;
    const dead = new Set(); let sent = 0; const body = JSON.stringify(payload);
    await Promise.all(targets.map(async s => {
      try { await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, { TTL: 86400 }); sent++; }
      catch (e) { if (e && (e.statusCode === 404 || e.statusCode === 410)) dead.add(s.endpoint); }
    }));
    if (dead.size) saveSubs(readSubs().filter(s => !dead.has(s.endpoint)));
    return sent;
  }

  // ---- who can see a student's notifications ----
  function accountOf(rosterId) { return ctx.readSchoolMembers().members.find(m => m.rosterId === rosterId && m.role === 'student' && m.status !== 'rejected'); }
  function parentsOf(memberId) { return new Set(ctx.readGuardianLinks().links.filter(l => l.studentId === memberId && l.status === 'approved').map(l => l.accountId)); }
  function parentsOfSchool(schoolId) { return new Set(ctx.readGuardianLinks().links.filter(l => l.schoolId === schoolId && l.status === 'approved').map(l => l.accountId)); }

  // ---- notification list ----
  const readItems = () => { const d = readJsonFile(itemsFile, {}); return Array.isArray(d.items) ? d.items : []; };
  async function add({ schoolId, rosterId, kind, title, text, url }) {
    const items = readItems();
    const item = { id: crypto.randomUUID(), schoolId, rosterId, kind, title: String(title).slice(0, 120), text: String(text).slice(0, 400), at: now(), read: { student: false, parent: false } };
    items.unshift(item); saveJsonFile(itemsFile, { items: items.slice(0, 6000) });
    const acc = accountOf(rosterId), parents = acc ? parentsOf(acc.id) : new Set();
    const payload = { title: item.title, body: item.text, url: url || '/student/school', tag: kind + ':' + rosterId };
    pushTo(s => (s.kind === 'member' && s.rosterId === rosterId) || (s.kind === 'parent' && parents.has(s.accountId)), payload).catch(() => {});
    return item;
  }
  // many notifications at once (e.g. a whole class got results): one file write
  async function addMany(list) {
    if (!list.length) return 0;
    const items = readItems(), made = [];
    for (const x of list) made.push({ id: crypto.randomUUID(), schoolId: x.schoolId, rosterId: x.rosterId, kind: x.kind, title: String(x.title).slice(0, 120), text: String(x.text).slice(0, 400), at: now(), read: { student: false, parent: false } });
    saveJsonFile(itemsFile, { items: [...made, ...items].slice(0, 6000) });
    const members = ctx.readSchoolMembers().members, links = ctx.readGuardianLinks().links;
    for (const it of made) {
      const acc = members.find(m => m.rosterId === it.rosterId && m.role === 'student' && m.status !== 'rejected');
      const parents = new Set(acc ? links.filter(l => l.studentId === acc.id && l.status === 'approved').map(l => l.accountId) : []);
      pushTo(sb => (sb.kind === 'member' && sb.rosterId === it.rosterId) || (sb.kind === 'parent' && parents.has(sb.accountId)), { title: it.title, body: it.text, url: '/student/school', tag: it.kind + ':' + it.rosterId }).catch(() => {});
    }
    return made.length;
  }
  // a message for everybody in a school (new post, announcement) - push only, no per-student item
  function broadcast(schoolId, title, text, url) {
    const parents = parentsOfSchool(schoolId);
    return pushTo(s => (s.kind === 'member' && s.schoolId === schoolId) || (s.kind === 'parent' && parents.has(s.accountId)), { title, body: text, url: url || '/student/school', tag: 'school:' + schoolId }).catch(() => 0);
  }
  function listFor(rosterIds, schoolId, limit = 60) {
    const set = new Set(rosterIds);
    return readItems().filter(i => i.schoolId === schoolId && set.has(i.rosterId)).slice(0, limit);
  }
  function markRead(rosterIds, schoolId, who) {
    const set = new Set(rosterIds), items = readItems(); let n = 0;
    for (const i of items) if (i.schoolId === schoolId && set.has(i.rosterId) && !i.read[who]) { i.read[who] = true; n++; }
    if (n) saveJsonFile(itemsFile, { items }); return n;
  }
  return { add, addMany, broadcast, listFor, markRead, subscribe, unsubscribe, supported, publicKey, pushTo };
};

/* Samba Inventory: the public part of the app.
 *
 * The web address (and the Android app) holds only this: the login screen. The program itself is kept in the
 * database and only a logged-in, active employee can fetch it. After a login it is fetched, kept on the device (so
 * the app opens at once next time, also without internet) and run. A newer version is fetched when the app opens
 * with internet. Logging out removes the program from the device.
 */
(function () {
'use strict';
const CFG = window.SAMBA_CFG || {};
const FACTORY = 'مصنع سامبا للصناعات البلاستيكية';
const sb = window.supabase.createClient(CFG.url, CFG.key, {
  auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'samba-inv-auth'},
  realtime: {params: {eventsPerSecond: 100}}
});
window.SAMBA_SB = sb;   // the program uses this same connection (one login per page)

const $ = s => document.querySelector(s);
const toLatin = v => String(v == null ? '' : v).replace(/[٠-٩۰-۹]/g, d => String(d.charCodeAt(0) - (d.charCodeAt(0) >= 0x6F0 ? 0x6F0 : 0x660)));
const isNet = e => !!e && (e.name === 'AuthRetryableFetchError' || e.status === 0 || /Failed to fetch|NetworkError|Load failed|fetch failed|network|timeout/i.test(String(e.message || e)));
const LS = {get: k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }};
const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

// ---------- the program kept on the device (IndexedDB) ----------
const DB = (() => {
  let p;
  const db = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open('samba-inventory-app', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('b');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const run = (mode, f) => db().then(d => new Promise((res, rej) => {
    const t = d.transaction('b', mode), q = f(t.objectStore('b'));
    t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  }));
  return {get: k => run('readonly', s => s.get(k)), set: (k, v) => run('readwrite', s => s.put(v, k)), del: k => run('readwrite', s => s.delete(k))};
})();

// ---------- running the program ----------
let started = false;
function run(b) {
  if (started) return; started = true;
  LOADER.version = b.version;
  const names = ['samba-sync.js', 'samba-main.js', 'samba-app.js'];
  b.parts.forEach((code, i) => {
    const s = document.createElement('script');
    s.textContent = code + '\n//# sourceURL=' + (names[i] || ('samba-part' + i + '.js'));
    document.body.appendChild(s);
  });
}
async function fetchBundle() {
  const {data, error} = await sb.rpc('app_bundle');
  if (error) throw error;
  if (!data || !Array.isArray(data.parts)) return null;
  await DB.set('bundle', data).catch(() => {});
  return data;
}

// ---------- the login screen (the reference's, as it looks there) ----------
let fails = 0, lockUntil = 0, busy = false;
function loginHTML(msg) {
  const lock = lockUntil && Date.now() < lockUntil, year = LS.get('samba-inv-year') || 2026;
  const m = lock ? 'محاولات كتير غلط. استنى نص دقيقة وجرّب مرة تانية.' : (msg || '');
  return `<div class="login"><div class="panel lbox"><div class="brand"><b>Samba Inventory</b><span class="muted small">${FACTORY} · الجرد السنوي ${year}</span></div>
  <h1>تسجيل الدخول</h1><form id="loginForm" autocomplete="on"><label>اسم الدخول<input id="lg_user" dir="ltr" data-user autocomplete="username" autocapitalize="off" spellcheck="false" ${lock ? 'disabled' : ''}></label>
  <label>الرقم السري<input id="lg_pin" type="password" inputmode="numeric" data-keep0 dir="ltr" autocomplete="current-password" ${lock ? 'disabled' : ''}></label>
  <div id="formErr" class="err" ${m ? '' : 'hidden'}>${m}</div><button class="btn primary big" ${lock ? 'disabled' : ''}>دخول</button></form>
  <p class="hint">نسيت رقمك السري؟ المدير بيعطيك رقم جديد.</p></div></div>`;
}
function showLogin(msg) {
  if (started) return;
  $('#app').innerHTML = loginHTML(msg);
  const f = $('#loginForm'); f.addEventListener('submit', onLogin);
  const pin = $('#lg_pin'); pin.addEventListener('input', () => { const v = toLatin(pin.value).replace(/\D/g, ''); if (v !== pin.value) pin.value = v; });
  const u = $('#lg_user'); if (u && !u.disabled && !('ontouchstart' in window)) u.focus();
}
function err(m) { const e = $('#formErr'); if (e) { e.textContent = m; e.hidden = false; } }
function setBusy(on, label) {
  busy = on; const f = $('#loginForm'); if (!f) return;
  f.querySelectorAll('input,button').forEach(x => { x.disabled = on; });
  const b = f.querySelector('button.primary'); if (b) b.textContent = on ? (label || 'عم يفوت…') : 'دخول';
}
async function onLogin(e) {
  e.preventDefault();
  if (busy || started) return;
  const un = $('#lg_user').value.trim().toLowerCase(), pin = toLatin($('#lg_pin').value.trim());
  if (!un) return err('اكتب اسم الدخول.');
  if (!pin) return err('اكتب الرقم السري.');
  if (lockUntil && Date.now() < lockUntil) return;
  setBusy(true);
  try {
    const r1 = await sb.rpc('login_email', {login: un});
    if (r1.error) throw r1.error;
    let ok = false;
    if (r1.data) {
      const r2 = await sb.auth.signInWithPassword({email: r1.data, password: pin});
      if (r2.error) { if (isNet(r2.error)) throw r2.error; if (r2.error.status === 429) { setBusy(false); return err('محاولات كتير. استنى شوي وجرّب مرة تانية.'); } }
      else ok = true;
    }
    if (!ok) {
      sb.rpc('log_login_fail', {login: un}).then(() => {}, () => {});
      setBusy(false); fails++;
      if (fails >= 5) { fails = 0; lockUntil = Date.now() + 30000; showLogin(); setTimeout(() => showLogin(), 30500); return; }
      return err('اسم الدخول أو الرقم السري غلط.');
    }
    const w = await sb.rpc('whoami');
    if (w.error) throw w.error;
    if (!w.data) { await sb.auth.signOut({scope: 'local'}).catch(() => {}); setBusy(false); return err('هذا الحساب موقوف. راجع المدير.'); }
    setBusy(true, 'عم ينزّل البرنامج…');
    const b = await fetchBundle();
    if (!b) { setBusy(false); return err('البرنامج مش جاهز على السيرفر لسا. جرّب بعد شوي.'); }
    fails = 0; LOADER.justLoggedIn = true; run(b);
  } catch (x) {
    setBusy(false);
    err(isNet(x) || /timeout/.test(String(x && x.message)) ? 'ما في اتصال بالإنترنت. أول دخول على هالجهاز بدّه إنترنت.' : 'ما زبط الدخول. جرّب كمان مرة.');
  }
}

// ---------- start ----------
async function start() {
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !window.Capacitor) navigator.serviceWorker.register('sw.js').catch(() => {});
  const cached = await DB.get('bundle').catch(() => null);
  let ses = null, netErr = false;
  try { const r = await sb.auth.getSession(); ses = r.data && r.data.session; if (r.error && isNet(r.error)) netErr = true; } catch (e) { netErr = true; }
  const last = LS.get('samba-inv-last');
  if (!ses) {
    // without internet the login can't be checked: the person did not log out, so carry on with what is on the device
    if (cached && last && (netErr || navigator.onLine === false)) return run(cached);
    if (cached) await DB.del('bundle').catch(() => {});
    return showLogin();
  }
  if (navigator.onLine !== false) {
    try {
      const v = await timeout(sb.rpc('app_version'), 8000);
      if (v && !v.error) {
        if (v.data && (!cached || cached.version !== v.data)) { const b = await fetchBundle(); if (b) return run(b); }
        if (!v.data) {
          const w = await sb.rpc('whoami');
          if (!w.error && !w.data) { await sb.auth.signOut({scope: 'local'}).catch(() => {}); await DB.del('bundle').catch(() => {}); return showLogin('هذا الحساب موقوف. راجع المدير.'); }
        }
      }
    } catch (e) {}
  }
  if (cached) return run(cached);
  showLogin(navigator.onLine === false ? 'ما في اتصال بالإنترنت. أول دخول على هالجهاز بدّه إنترنت.' : '');
}

const LOADER = window.LOADER = {
  version: null,
  justLoggedIn: false,
  // the program calls this after logging out (or when the login ended): it leaves the device and the login screen comes back
  async signedOut() {
    try { await DB.del('bundle'); } catch (e) {}
    try { await sb.auth.signOut({scope: 'local'}); } catch (e) {}
    location.reload();
  }
};
start();
})();

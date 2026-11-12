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
// the owner's «forgot PIN» email link opens the app with a one-time login in the address
const RECOVERY = /type=recovery/.test(location.hash);
const LINK_BAD = /error_code=|error=access_denied/.test(location.hash);
const sb = window.supabase.createClient(CFG.url, CFG.key, {
  auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'samba-inv-auth'},
  realtime: {params: {eventsPerSecond: 100}}
});
window.SAMBA_SB = sb;   // the program uses this same connection (one login per page)

const $ = s => document.querySelector(s);
// what can be typed in a box, as in every box of the program (fieldRule / fieldHint in reference/prototype.html): Arabic
// digits are refused with the reference's message. The login PIN keeps letters: the owner's first password was set in
// Supabase and may have them (a digits PIN is chosen right after such a login).
const AR_ANY = /[٠-٩۰-۹٫٬]/, AR_MSG = 'الأرقام بالإنجليزي بس';
const RULES = {
  user: {re: /[A-Za-z0-9._-]/, msg: 'أحرف وأرقام إنجليزية، و«.» «_» «-» بس', lower: true},
  pin: {re: /[^٠-٩۰-۹٫٬]/, msg: AR_MSG},
  digits: {re: /[0-9]/, msg: 'الرقم السري أرقام إنجليزية بس'}
};
function fieldHint(t, msg) {
  let h = document.getElementById('fhint');
  if (!h) { h = document.createElement('div'); h.id = 'fhint'; h.setAttribute('role', 'status'); document.body.appendChild(h); }
  const b = t.getBoundingClientRect(); h.textContent = msg; h.hidden = false;
  h.style.top = Math.max(4, Math.min(innerHeight - 44, b.bottom + 4)) + 'px'; h.style.right = Math.max(8, innerWidth - b.right) + 'px';
  clearTimeout(h._t); h._t = setTimeout(() => { h.hidden = true; }, 3200);
}
function guard(t, r) {
  if (!t) return;
  const clean = v => { const out = [...v].filter(c => r.re.test(c)).join(''); return {out: r.lower ? out.toLowerCase() : out, bad: out !== v}; };
  t.addEventListener('input', () => { const v = t.value, c = clean(v); if (c.out !== v) { t.value = c.out; if (c.bad) fieldHint(t, AR_ANY.test(v) ? AR_MSG : r.msg); } });
  t.addEventListener('paste', e => {
    const tx = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (tx && clean(tx).bad) { e.preventDefault(); fieldHint(t, AR_ANY.test(tx) ? 'ما انلصق: فيه أرقام عربية' : 'ما انلصق: ' + r.msg); }
  });
}
const AR_BOX = 'في مربع فيه أرقام عربية. اكتبها بالإنجليزي.';
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
  <p class="hint"><a href="#" id="lg_forgot">نسيت رقمك السري؟</a></p></div></div>`;
}
function showLogin(msg) {
  if (started) return;
  $('#app').innerHTML = loginHTML(msg);
  const f = $('#loginForm'); f.addEventListener('submit', onLogin);
  guard($('#lg_pin'), RULES.pin); guard($('#lg_user'), RULES.user);
  const u = $('#lg_user'); if (u && !u.disabled && !('ontouchstart' in window)) u.focus();
  $('#lg_forgot').addEventListener('click', e => { e.preventDefault(); showForgot(); });
}
// employees get a new PIN from management; the owner gets an email link (only the owner's account has a real email)
function showForgot(msg, ok) {
  if (started) return;
  $('#app').innerHTML = `<div class="login"><div class="panel lbox"><div class="brand"><b>Samba Inventory</b><span class="muted small">${FACTORY}</span></div>
  <h1>نسيت رقمك السري؟</h1>
  <p class="muted" style="margin:0 0 6px"><b>إذا إنت موظف:</b> المدير بيعطيك رقم جديد.</p>
  <p class="muted" style="margin:0 0 10px"><b>إذا إنت المالك:</b> اكتب إيميلك، وبيوصلك عليه رابط بتختار منه رقم سري جديد.</p>
  <form id="loginForm"><label>الإيميل<input id="fg_mail" type="email" dir="ltr" autocomplete="email" autocapitalize="off" spellcheck="false"></label>
  ${ok ? `<div class="okbox small">${msg}</div>` : ''}<div id="formErr" class="err" ${msg && !ok ? '' : 'hidden'}>${msg && !ok ? msg : ''}</div>
  <button class="btn primary big">ابعتلي الرابط</button></form>
  <p class="hint"><a href="#" id="fg_back">رجوع لتسجيل الدخول</a></p></div></div>`;
  $('#fg_back').addEventListener('click', e => { e.preventDefault(); showLogin(); });
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault(); if (busy) return;
    const em = $('#fg_mail').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return err('اكتب إيميلك كامل وصح.');
    setBusy(true, 'عم يبعت…');
    const r = await sb.auth.resetPasswordForEmail(em, {redirectTo: location.origin + location.pathname}).catch(x => ({error: x}));
    busy = false;
    if (r.error) return showForgot(isNet(r.error) ? 'ما في اتصال بالإنترنت. جرّب كمان مرة.' : r.error.status === 429 ? 'انبعت رابط من شوي. استنى شوي وجرّب كمان مرة.' : 'ما زبط الإرسال: ' + String(r.error.message || r.error));
    showForgot('إذا هاد إيميل المالك، وصلك هلأ رابط عليه. افتحه، وبيفتح البرنامج على شاشة بتختار فيها رقمك السري الجديد. إذا ما لقيته، شوف بالـ Junk أو Spam.', true);
  });
  guard($('#fg_mail'), RULES.pin);
  $('#fg_mail').focus();
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
  const un = $('#lg_user').value.trim().toLowerCase(), pin = $('#lg_pin').value.trim();
  if (AR_ANY.test(un) || AR_ANY.test(pin)) return err(AR_BOX);
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
    fails = 0;
    // in the app a PIN is English digits only (6 to 12); a first password set outside the app (the owner's, in
    // Supabase) may have letters: then a PIN is chosen now, before the program opens
    if (!/^\d{6,12}$/.test(pin)) { setBusy(false); return showNewPin(); }
    await openProgram();
  } catch (x) {
    setBusy(false);
    err(isNet(x) || /timeout/.test(String(x && x.message)) ? 'ما في اتصال بالإنترنت. أول دخول على هالجهاز بدّه إنترنت.' : 'ما زبط الدخول. جرّب كمان مرة.');
  }
}

async function openProgram() {
  setBusy(true, 'عم ينزّل البرنامج…');
  try {
    const b = await fetchBundle();
    if (!b) { setBusy(false); return err('البرنامج مش جاهز على السيرفر لسا. جرّب بعد شوي.'); }
    LOADER.justLoggedIn = true; run(b);
  } catch (x) { setBusy(false); err(isNet(x) ? 'ما في اتصال بالإنترنت. جرّب كمان مرة.' : 'ما زبط تنزيل البرنامج. جرّب كمان مرة.'); }
}
function showNewPin(msg, why) {
  const intro = why === 'recovery' ? 'فتحت رابط «نسيت رقمك السري». اختار رقمك السري الجديد: أرقام إنجليزية بس، من 6 لـ 12 رقم. ومن هلأ ورايح بتدخل فيه.'
    : 'كلمة السر الي دخلت فيها فيها أحرف. بالبرنامج الرقم السري أرقام إنجليزية بس، من 6 لـ 12 رقم. اختار رقمك الجديد، ومن هلأ ورايح بتدخل فيه.';
  $('#app').innerHTML = `<div class="login"><div class="panel lbox"><div class="brand"><b>Samba Inventory</b><span class="muted small">${FACTORY}</span></div>
  <h1>اختار رقمك السري</h1><p class="muted small" style="margin:0 0 10px">${intro}</p>
  <form id="loginForm"><label>الرقم السري الجديد<input id="np_1" type="password" inputmode="numeric" dir="ltr" autocomplete="new-password"></label>
  <label>أعد كتابة الرقم الجديد<input id="np_2" type="password" inputmode="numeric" dir="ltr" autocomplete="new-password"></label>
  <div id="formErr" class="err" ${msg ? '' : 'hidden'}>${msg || ''}</div><button class="btn primary big">حفظ الرقم والدخول</button></form></div></div>`;
  ['np_1', 'np_2'].forEach(id => guard($('#' + id), RULES.digits));
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault(); if (busy) return;
    const a = $('#np_1').value.trim(), b2 = $('#np_2').value.trim();
    if (AR_ANY.test(a) || AR_ANY.test(b2)) return err(AR_BOX);
    if (!/^\d{6,12}$/.test(a)) return err('الرقم السري أرقام إنجليزية بس، من 6 لـ 12 رقم.');
    if (a !== b2) return err('الرقم الجديد والتأكيد مش متطابقين.');
    setBusy(true, 'عم يحفظ…');
    const r = await sb.auth.updateUser({password: a}).catch(x => ({error: x}));
    if (r.error) { setBusy(false); return err(isNet(r.error) ? 'ما في اتصال بالإنترنت. جرّب كمان مرة.' : 'ما انحفظ الرقم: ' + String(r.error.message || r.error)); }
    LOADER.pinChanged = true;
    await openProgram();
  });
  $('#np_1').focus();
}

// ---------- start ----------
async function start() {
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol) && !window.Capacitor) navigator.serviceWorker.register('sw.js').catch(() => {});
  const cached = await DB.get('bundle').catch(() => null);
  let ses = null, netErr = false;
  try { const r = await sb.auth.getSession(); ses = r.data && r.data.session; if (r.error && isNet(r.error)) netErr = true; } catch (e) { netErr = true; }
  const last = LS.get('samba-inv-last');
  if (RECOVERY || LINK_BAD) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} }
  if (RECOVERY && ses) return showNewPin('', 'recovery');
  if ((RECOVERY || LINK_BAD) && !ses) { if (cached) await DB.del('bundle').catch(() => {}); return showLogin('الرابط انتهى أو انستعمل قبل. اطلب رابط جديد من «نسيت رقمك السري؟».'); }
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
  pinChanged: false,
  // the program calls this after logging out (or when the login ended): it leaves the device and the login screen comes back
  async signedOut() {
    try { await DB.del('bundle'); } catch (e) {}
    try { await sb.auth.signOut({scope: 'local'}); } catch (e) {}
    location.reload();
  }
};
start();
})();

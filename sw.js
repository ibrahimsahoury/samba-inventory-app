/* Samba Inventory: keeps the app's own files on the device, so it opens without internet (the data has its own
   copy on the device, see sync.js). Each build gets its own cache, filled in one go, so the files of two versions
   never mix; the old cache is removed once the new one is complete. */
const V = 'samba-app-02d6aabf60e4';
const FILES = ["./", "index.html", "loader.js", "config.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "vendor/supabase.js", "vendor/xlsx.full.min.js", "vendor/exceljs.min.js", "vendor/html2canvas.min.js", "vendor/jspdf.umd.min.js"];
// fetched fresh (not from the browser's short-term cache), so a new version never keeps an old file
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(FILES.map(f => new Request(f, {cache: 'reload'})))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('samba-app-') && k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url); if (u.origin !== self.location.origin) return;
  e.respondWith(caches.open(V).then(async c => {
    const hit = await c.match(r, {ignoreSearch: true});
    if (hit) return hit;
    try { return await fetch(r); }
    catch (err) { return (r.mode === 'navigate' && await c.match('index.html')) || Response.error(); }
  }));
});

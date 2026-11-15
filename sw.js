// Cambia VERSIONE quando aggiorni index.html, così il tablet scarica la nuova app.
const VERSIONE = 'app-v2';
const BASE = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSIONE).then(c => c.addAll(BASE))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSIONE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // contenuti: prima la rete, se manca internet usa la copia salvata
  if (u.pathname.endsWith('contenuti.json')) {
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(VERSIONE).then(x => x.put('data/contenuti.json', c)); return r; })
      .catch(() => caches.match('data/contenuti.json')));
    return;
  }
  // app e font: copia salvata subito, aggiornata in background
  e.respondWith(caches.match(e.request).then(hit => {
    const rete = fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') { const c = r.clone(); caches.open(VERSIONE).then(x => x.put(e.request, c)); } return r; }).catch(() => hit);
    return hit || rete;
  }));
});

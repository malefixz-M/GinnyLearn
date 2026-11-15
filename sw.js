// Cambia VERSIONE quando aggiorni index.html, così il tablet scarica la nuova app.
const VERSIONE = 'app-v5';
const BASE = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png',
  ...['ecstatic','starry','sad','crying','encouraging','happy','sleepy','thinking'].map(n => `mia/head/${n}.webp`),
  ...['master','celebrating','jumping','encouraging','thinking'].map(n => `mia/fullbody/${n}.webp`)];
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

// notifiche: il ponte manda un push vuoto, qui si leggono le novità
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let n = { titolo: '📒 Compiti aggiornati', testo: 'Apri il diario dei compiti', quanti: 1 };
    try {
      const c = await caches.match('data/contenuti.json'); const ponte = c && (await c.json()).ponte;
      if (ponte) n = { ...n, ...(await (await fetch(ponte.replace(/\/compiti$/, '/novita'), { cache: 'no-store' })).json()) };
    } catch {}
    if (n.quanti && self.navigator.setAppBadge) self.navigator.setAppBadge(n.quanti).catch(() => {});
    await self.registration.showNotification(n.titolo, { body: n.testo, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'compiti', data: { url: './index.html#/compiti' } });
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window' }).then(ws => {
    const w = ws[0]; if (w) { w.navigate(e.notification.data.url).catch(() => {}); return w.focus(); }
    return clients.openWindow(e.notification.data.url);
  }));
});

// Ponte compiti: Cloudflare Worker che entra in Scuola Online e restituisce i compiti in JSON.
// Variabili (Settings > Variables and Secrets):
//   SOL_USER, SOL_PASS  -> segreti (tipo "Secret"), nome utente e password di Scuola Online
//   SOL_SCUOLA         -> codice scuola (es. SOL_0000), come Secret
//   ORIGINE             -> indirizzo dell'app, es. https://TUONOME.github.io (facoltativo, default "*")
//   VAPID_PUBLIC, VAPID_PRIVATE -> chiavi per le notifiche push (VAPID_PRIVATE come Secret)
//   KV                  -> binding a un namespace KV (Bindings > KV namespace, nome variabile "KV")
//   FOTO_CODICE         -> Secret: codice che si scrive una volta sul tablet per poter inviare foto
//   GH_TOKEN            -> Secret: token GitHub "fine-grained" con permesso Contents: Read and write
//                          SOLO sulla repo privata delle foto
//   GH_REPO             -> repo privata delle foto, es. malefixz-M/GinnyLearn-inbox
//                          (anche i progressi salvati: progressi/<nome>.json)
// GET /eventi -> registro delle novità (compiti nuovi alle 16/23, foto arrivate) per l'attività
//   programmata di Claude che avvisa papà nell'app Claude. ?visto=N segna come letti fino a N; ?tutti = ultimi 40.
//   CLAUDE_FIRE_URL, CLAUDE_FIRE_TOKEN -> (facoltativi) indirizzo /fire e token dell'attività di Claude
//                          "GinnyLearn – novità compiti e foto" (API trigger su claude.ai/code/routines): se ci sono,
//                          il Worker la fa partire solo quando c'è una novità.
// Cron Triggers: "0 14,15,21,22 * * *" (UTC) per i compiti + "*/10 * * * *" per avvisare Claude. Il codice lavora solo quando a Roma sono le 16 o le 23,
// così l'orario resta giusto sia con l'ora solare sia con quella legale.
const DURATA_CACHE = 15 * 60; // secondi
const ORE_CONTROLLO = [16, 23];

export default {
  async fetch(req, env, ctx) {
    const cors = {
      'Access-Control-Allow-Origin': env.ORIGINE || '*',
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Content-Type': 'application/json; charset=utf-8'
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(req.url);
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: cors });
    if (url.pathname === '/vapid') return json({ chiave: env.VAPID_PUBLIC || null });
    if (url.pathname === '/novita') return json(env.KV ? (await env.KV.get('novita', 'json')) || {} : {});
    if (url.pathname === '/eventi') return json(await eventi(url, env));
    // GET /controlla?codice=<FOTO_CODICE>: controllo dei compiti adesso (come alle 16/23) e, se ci sono novità, avvisa subito Claude
    if (url.pathname === '/controlla') {
      if (!env.FOTO_CODICE || url.searchParams.get('codice') !== env.FOTO_CODICE) return json({ errore: 'codice sbagliato' }, 403);
      try { await controlla(env); } catch (e) { return json({ errore: 'Scuola Online: ' + (e.message || e) }, 502); }
      const r = (await env.KV.get('eventi', 'json')) || { ultimo: 0, lista: [] };
      const visto = Math.max(+((await env.KV.get('eventi-visto')) || 0), +((await env.KV.get('eventi-avvisato')) || 0));
      const nuovi = r.lista.filter(e => e.n > visto).length;
      const claude = nuovi ? await avvisaClaude(env, true) : false;
      return json({ ok: true, novita: nuovi, claudeAvvisato: claude });
    }
    // POST /iscrivi -> avvisi dei compiti (notifiche web in Chrome)
    if (url.pathname === '/iscrivi' && req.method === 'POST') {
      if (!env.KV) return json({ errore: 'KV mancante' }, 500);
      const sub = await req.json().catch(() => null);
      if (!sub?.endpoint?.startsWith('https://')) return json({ errore: 'iscrizione non valida' }, 400);
      const lista = ((await env.KV.get('iscrizioni', 'json')) || []).filter(x => x.endpoint !== sub.endpoint);
      if (!url.searchParams.has('via')) lista.push({ endpoint: sub.endpoint });
      await env.KV.put('iscrizioni', JSON.stringify(lista.slice(-10)));
      return json({ ok: true, iscritti: lista.length });
    }
    if (url.pathname === '/pagina') return leggiPagina(url, env, cors);
    if (url.pathname === '/foto' && req.method === 'POST') return json(...await salvaFoto(req, env));
    if (url.pathname === '/progressi') return json(...await progressi(req, url, env));
    if (url.pathname === '/prova-push' && env.KV) {
      await env.KV.put('novita', JSON.stringify({ quando: new Date().toISOString(), titolo: '🔔 Prova', testo: 'Le notifiche funzionano!', quanti: 0 }));
      return json({ inviate: await inviaATutti(env) });
    }
    if (url.pathname !== '/compiti') return new Response('{"errore":"usa /compiti"}', { status: 404, headers: cors });

    const cache = caches.default, chiave = new Request(url.origin + '/compiti-cache');
    if (!url.searchParams.has('fresco')) {
      const hit = await cache.match(chiave);
      if (hit) return new Response(hit.body, { headers: cors });
    }
    try {
      const html = await scaricaCompiti(env.SOL_SCUOLA, env.SOL_USER, env.SOL_PASS);
      const compiti = leggiCompiti(html);
      if (url.searchParams.has('diagnosi')) {
        // solo numeri e intestazioni, niente nomi
        const t = tabella(html);
        return new Response(JSON.stringify({ trovataTabella: !!t, colonne: t ? t.intestazioni : [], righeTabella: t ? t.righe.length : 0, compiti: compiti.length,
          dal: (html.match(/name="[^"]*TextBoxDataDa"[^>]*value="([^"]*)"/) || [])[1], al: (html.match(/name="[^"]*TextBoxDataA"[^>]*value="([^"]*)"/) || [])[1] }, null, 1), { headers: cors });
      }
      const corpo = JSON.stringify({ aggiornato: new Date().toISOString(), compiti });
      ctx.waitUntil(cache.put(chiave, new Response(corpo, { headers: { 'Cache-Control': `max-age=${DURATA_CACHE}` } })));
      if (env.KV) ctx.waitUntil(env.KV.put('ultimo', corpo));
      return new Response(corpo, { headers: cors });
    } catch (e) {
      // se Scuola Online non risponde restituisce l'ultimo risultato salvato dal cron
      const ultimo = env.KV && await env.KV.get('ultimo');
      if (ultimo && !url.searchParams.has('diagnosi')) return new Response(ultimo, { headers: cors });
      return new Response(JSON.stringify({ errore: String(e.message || e) }), { status: 502, headers: cors });
    }
  },

  async scheduled(evento, env, ctx) {
    if (evento.cron === '*/10 * * * *') return ctx.waitUntil(avvisaClaude(env));
    const ora = +new Date(evento.scheduledTime).toLocaleString('en-GB', { timeZone: 'Europe/Rome', hour: '2-digit', hour12: false });
    if (!ORE_CONTROLLO.includes(ora)) return;
    ctx.waitUntil(controlla(env));
  }
};

/* ---- controllo programmato e notifiche ---- */
async function controlla(env) {
  if (!env.KV) return;
  const compiti = leggiCompiti(await scaricaCompiti(env.SOL_SCUOLA, env.SOL_USER, env.SOL_PASS));
  // 'visto-cron' lo scrive solo il cron: 'ultimo' lo aggiorna anche l'app, e i compiti già visti dall'app sparirebbero dal confronto
  const prima = JSON.parse((await env.KV.get('visto-cron')) || (await env.KV.get('ultimo')) || '{"compiti":null}').compiti;
  const corpo = JSON.stringify({ aggiornato: new Date().toISOString(), compiti });
  await env.KV.put('ultimo', corpo); await env.KV.put('visto-cron', corpo);
  if (!prima) return; // primo giro: niente notifica
  const vecchi = new Map(prima.map(c => [c.id, c]));
  const nuovi = compiti.filter(c => !vecchi.has(c.id));
  const cambiati = compiti.filter(c => vecchi.has(c.id) && (vecchi.get(c.id).testo !== c.testo || vecchi.get(c.id).data !== c.data));
  if (!nuovi.length && !cambiati.length) return;
  const parti = [];
  if (nuovi.length) parti.push(nuovi.length === 1 ? '1 compito nuovo' : `${nuovi.length} compiti nuovi`);
  if (cambiati.length) parti.push(cambiati.length === 1 ? '1 compito cambiato' : `${cambiati.length} compiti cambiati`);
  const elenco = [...nuovi, ...cambiati].slice(0, 4).map(c => `${c.materia}: ${c.testo}`.slice(0, 80)).join('\n');
  const novita = { quando: new Date().toISOString(), titolo: '📒 ' + parti.join(' e '), testo: elenco, quanti: nuovi.length + cambiati.length };
  await env.KV.put('novita', JSON.stringify(novita));
  await aggiungiEvento(env, { tipo: 'compiti', titolo: novita.titolo,
    compiti: [...nuovi.map(c => ({ ...c, stato: 'nuovo' })), ...cambiati.map(c => ({ ...c, stato: 'cambiato' }))] });
  await inviaATutti(env);
}

/* ---- registro eventi per l'attività programmata di Claude ---- */
// KV 'eventi' = { ultimo: N, lista: [{ n, quando, tipo, ... }] } (ultimi 40); KV 'eventi-visto' = ultimo n letto.
async function aggiungiEvento(env, ev) {
  const r = (await env.KV.get('eventi', 'json')) || { ultimo: 0, lista: [] };
  r.ultimo++; r.lista.push({ n: r.ultimo, quando: new Date().toISOString(), ...ev }); r.lista = r.lista.slice(-40);
  await env.KV.put('eventi', JSON.stringify(r));
}
// Ogni 10 minuti: se ci sono eventi non letti fa partire l'attività di Claude (una sola sessione per gruppo di novità).
// Aspetta 3 minuti dall'ultimo evento (più foto di fila = un solo avviso) e non riparte prima di 30 minuti.
async function avvisaClaude(env, subito = false) {
  if (!env.KV || !env.CLAUDE_FIRE_URL || !env.CLAUDE_FIRE_TOKEN) return false;
  const r = (await env.KV.get('eventi', 'json')) || { ultimo: 0, lista: [] };
  const visto = +((await env.KV.get('eventi-visto')) || 0), avvisato = +((await env.KV.get('eventi-avvisato')) || 0);
  const nuovi = r.lista.filter(e => e.n > Math.max(visto, avvisato));
  if (!nuovi.length) return false;
  const adesso = Date.now(), ultimoEv = Date.parse(nuovi[nuovi.length - 1].quando), ultimoFire = +((await env.KV.get('fire-quando')) || 0);
  if (!subito && (adesso - ultimoEv < 3 * 60e3 || adesso - ultimoFire < 30 * 60e3)) return false;
  // le novità complete viaggiano nel messaggio di avvio (la sessione di Claude non riesce a rileggere il ponte in modo affidabile)
  const testo = JSON.stringify({ ultimo: r.ultimo, eventi: nuovi }).slice(0, 15000);
  const res = await fetch(env.CLAUDE_FIRE_URL, { method: 'POST', headers: { Authorization: `Bearer ${env.CLAUDE_FIRE_TOKEN}`,
    'anthropic-beta': 'experimental-cc-routine-2026-04-01', 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'NOVITA_GINNYLEARN ' + testo }) });
  await env.KV.put('fire-quando', String(adesso));
  if (res.ok) await env.KV.put('eventi-avvisato', String(r.ultimo));
  return res.ok;
}
async function eventi(url, env) {
  if (!env.KV) return { errore: 'KV mancante' };
  const r = (await env.KV.get('eventi', 'json')) || { ultimo: 0, lista: [] };
  let visto = +((await env.KV.get('eventi-visto')) || 0);
  const v = parseInt(url.searchParams.get('visto'), 10);
  if (v >= 0 && v <= r.ultimo) { visto = v; await env.KV.put('eventi-visto', String(v)); return { ok: true, visto }; }
  return { ora: new Date().toISOString(), visto, ultimo: r.ultimo, eventi: url.searchParams.has('tutti') ? r.lista : r.lista.filter(e => e.n > visto) };
}

// Push senza contenuto (niente cifratura): il service worker poi legge /novita.
async function inviaATutti(env, chiave = 'iscrizioni') {
  if (!env.KV || !env.VAPID_PUBLIC || !env.VAPID_PRIVATE) return 0;
  const lista = (await env.KV.get(chiave, 'json')) || [];
  const tenere = []; let ok = 0;
  for (const s of lista) {
    const ep = new URL(s.endpoint);
    const jwt = await firmaVapid(env, ep.origin);
    const r = await fetch(s.endpoint, { method: 'POST', headers: { TTL: '86400', Urgency: 'normal', Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC}`, 'Content-Length': '0' } });
    if (r.status === 404 || r.status === 410) continue; // iscrizione scaduta
    tenere.push(s); if (r.ok) ok++;
  }
  if (tenere.length !== lista.length) await env.KV.put(chiave, JSON.stringify(tenere));
  return ok;
}
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const daB64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function firmaVapid(env, aud) {
  const pub = daB64u(env.VAPID_PUBLIC);
  const chiave = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const enc = o => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const dati = enc({ typ: 'JWT', alg: 'ES256' }) + '.' + enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:noreply@ginnylearn.app' });
  const firma = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, chiave, new TextEncoder().encode(dati));
  return dati + '.' + b64u(firma);
}

/* ---- sessione con cookie ---- */
function barattolo() {
  const c = {};
  return {
    prendi(res) { for (const s of res.headers.getSetCookie?.() || []) { const [kv] = s.split(';'); const i = kv.indexOf('='); c[kv.slice(0, i).trim()] = kv.slice(i + 1); } },
    header() { return Object.entries(c).map(([k, v]) => `${k}=${v}`).join('; '); }
  };
}
async function vai(jar, url, opz = {}) {
  // segue i redirect a mano per non perdere i cookie
  for (let n = 0; n < 6; n++) {
    const res = await fetch(url, { ...opz, redirect: 'manual', headers: { ...(opz.headers || {}), Cookie: jar.header(), 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) QuadernoGiochi/1.0' } });
    jar.prendi(res);
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) { url = new URL(res.headers.get('location'), url).href; opz = {}; continue; }
    return { res, url, html: await res.text() };
  }
  throw new Error('troppi redirect');
}
const nascosti = html => {
  const out = {};
  for (const m of html.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
    const n = m[0].match(/name="([^"]+)"/), v = m[0].match(/value="([^"]*)"/);
    if (n) out[decodifica(n[1])] = v ? decodifica(v[1]) : '';
  }
  return out;
};

// tutti i campi del form come li invierebbe il browser (hidden, testo, select)
function campiForm(html) {
  const out = nascosti(html);
  for (const m of html.matchAll(/<input[^>]*type="text"[^>]*>/g)) {
    const n = m[0].match(/name="([^"]+)"/), v = m[0].match(/value="([^"]*)"/);
    if (n) out[decodifica(n[1])] = v ? decodifica(v[1]) : '';
  }
  for (const m of html.matchAll(/<select[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const sel = m[2].match(/<option[^>]*selected[^>]*value="([^"]*)"/) || m[2].match(/<option[^>]*value="([^"]*)"[^>]*selected/) || m[2].match(/<option[^>]*value="([^"]*)"/);
    out[decodifica(m[1])] = sel ? decodifica(sel[1]) : '';
  }
  return out;
}
function dataIt(giorniAvanti) {
  const d = new Date(Date.now() + giorniAvanti * 864e5);
  const [a, m, g] = d.toLocaleDateString('en-CA', { timeZone: 'Europe/Rome' }).split('-');
  return `${g}/${m}/${a}`;
}

async function scaricaCompiti(scuola, user, pass) {
  if (!scuola || !user || !pass) throw new Error('credenziali mancanti');
  const BASE = `https://scuolaonline.soluzione-web.it/${scuola}/`;
  const jar = barattolo();
  const login = await vai(jar, BASE + 'login.aspx');
  const campi = { ...nascosti(login.html),
    'LoginPrincipale$CodiceScuola': scuola, 'LoginPrincipale$UserName': user, 'LoginPrincipale$Password': pass,
    'LoginPrincipale$LoginButton': 'Accedi', __EVENTTARGET: '', __EVENTARGUMENT: '' };
  const azione = (login.html.match(/<form[^>]*action="([^"]+)"/) || [])[1];
  await vai(jar, azione ? new URL(decodifica(azione), login.url).href : BASE + 'login.aspx', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(campi).toString()
  });
  const pag = await vai(jar, BASE + 'Compiti/List.aspx');
  if (!pag.html.includes('GridViewCompiti') && !pag.html.includes('TextBoxDataDa')) throw new Error(/LoginPrincipale/.test(pag.html) ? 'login non riuscito' : 'pagina compiti non trovata');
  // la lista predefinita copre solo 7 giorni: rifà la ricerca "Cerca" da oggi a +21 giorni
  try {
    const campi = { ...campiForm(pag.html), __EVENTTARGET: 'ctl00$ContentPlaceHolder1$LinkButtonCerca', __EVENTARGUMENT: '' };
    for (const k of Object.keys(campi)) {
      if (k.endsWith('TextBoxDataDa')) campi[k] = dataIt(0);
      if (k.endsWith('TextBoxDataA')) campi[k] = dataIt(21);
      if (k.endsWith('DropDownListPageSize')) campi[k] = campi[k] || '10';
    }
    const cerca = await vai(jar, BASE + 'Compiti/List.aspx', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(campi).toString()
    });
    if (leggiCompiti(cerca.html).length >= leggiCompiti(pag.html).length) return cerca.html;
  } catch (e) { /* se la ricerca fallisce usa la lista predefinita */ }
  return pag.html;
}

/* ---- lettura tabella ---- */
// Nell'HTML del server le celle NON hanno data-content (lo aggiunge il JavaScript della pagina):
// le colonne si riconoscono dalle intestazioni <th>.
function tabella(html) {
  const i = html.indexOf('GridViewCompiti'); if (i < 0) return null;
  const inizio = html.lastIndexOf('<table', i), fine = html.indexOf('</table>', i);
  const tab = html.slice(inizio < 0 ? i : inizio, fine < 0 ? undefined : fine);
  const intestazioni = [...tab.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(m => testo(m[1]).replace(/:$/, ''));
  const righe = [];
  for (const r of tab.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    if (/<th/i.test(r[1])) continue;
    const celle = {}; let n = 0;
    for (const c of r[1].matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)) {
      const dc = (c[1].match(/data-content="([^"]*)"/) || [])[1];
      celle[(dc || intestazioni[n] || '').replace(/:\s*$/, '').trim()] = c[2]; n++;
    }
    righe.push({ celle, grezzo: r[1] });
  }
  return { intestazioni, righe };
}
export function leggiCompiti(html) {
  const t = tabella(html); if (!t) return [];
  const out = [];
  for (const { celle, grezzo } of t.righe) {
    const cella = k => celle[k] ? testo(celle[k]) : '';
    const consegna = cella('Data consegna'), compito = cella('Compito');
    if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(consegna) || !compito) continue;
    const [g, m, a] = consegna.split('/');
    const idSol = (grezzo.match(/HiddenFieldIdTabellaCollegata[^>]*value="(\d+)"/) || [])[1];
    const materiaGrezza = cella('Materia').replace(/\s*\(.*\)\s*$/, '');
    out.push({
      id: 'sol-' + (idSol || `${a}${m}${g}-${hash(compito)}`),
      data: `${a}-${m.padStart(2, '0')}-${g.padStart(2, '0')}`,
      materia: materiaGrezza.toLowerCase().trim(),
      testo: maiuscolaIniziale(compito),
      verifica: /verific/i.test(compito)
    });
  }
  return out;
}
function testo(h) {
  return decodifica(h.replace(/<br\s*\/?>/gi, ' ').replace(/<\/p>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
}
function decodifica(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
function maiuscolaIniziale(s) {
  // il registro a volte scrive tutto in MAIUSCOLO: lo rendiamo più leggibile
  if (s === s.toUpperCase() && /[A-Z]{4}/.test(s)) s = s.toLowerCase().replace(/\bpag\./g, 'pag.');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); }

// Foto di compiti e schede dal tablet -> cartella inbox/ della repo privata (GH_REPO).
// Riceve JSON { codice, nome, dati } con dati = immagine in base64 (già rimpicciolita dall'app).
async function salvaFoto(req, env) {
  if (!env.GH_TOKEN || !env.GH_REPO || !env.FOTO_CODICE) return [{ errore: 'foto non configurate' }, 501];
  let b; try { b = await req.json(); } catch { return [{ errore: 'dati non validi' }, 400]; }
  if (b.codice !== env.FOTO_CODICE) return [{ errore: 'codice sbagliato' }, 403];
  if (typeof b.dati !== 'string' || b.dati.length > 7_000_000) return [{ errore: 'foto troppo grande' }, 413];
  const nomeSicuro = String(b.nome || 'foto').replace(/[^\w-]/g, '').slice(0, 60) || 'foto';
  const ora = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Rome' }).replace(/[: ]/g, '-');
  const percorso = `inbox/${ora}_${nomeSicuro}.jpg`;
  const r = await fetch(`https://api.github.com/repos/${env.GH_REPO}/contents/${percorso}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${env.GH_TOKEN}`, 'User-Agent': 'ginny-ponte', Accept: 'application/vnd.github+json' },
    body: JSON.stringify({ message: `Foto dal tablet ${ora}`, content: b.dati })
  });
  if (!r.ok) return [{ errore: 'GitHub ' + r.status }, 502];
  // evento per l'attività di Claude: la foto è arrivata, si possono preparare gli esercizi
  if (env.KV) {
    const [, materia = '', compito = ''] = nomeSicuro.match(/^([a-z]+)_(.*)$/i) || [];
    const c = (JSON.parse((await env.KV.get('ultimo')) || '{}').compiti || []).find(x => x.id === compito);
    await aggiungiEvento(env, { tipo: 'foto', file: percorso, materia, compito, testo: c?.testo || '', consegna: c?.data || '' }).catch(() => {});
  }
  return [{ ok: true, file: percorso }, 200];
}

// Pagina di un libro: pagine/<materia>/<n>.jpg nella repo privata. Serve il codice (FOTO_CODICE).
async function leggiPagina(url, env, cors) {
  const m = (url.searchParams.get('m') || '').replace(/[^a-z]/g, ''), n = parseInt(url.searchParams.get('n'), 10);
  if (!env.GH_TOKEN || !env.GH_REPO || url.searchParams.get('codice') !== env.FOTO_CODICE || !m || !(n > 0)) return new Response('no', { status: 403, headers: cors });
  const r = await fetch(`https://api.github.com/repos/${env.GH_REPO}/contents/pagine/${m}/${n}.jpg`, {
    headers: { Authorization: `Bearer ${env.GH_TOKEN}`, 'User-Agent': 'ginny-ponte', Accept: 'application/vnd.github.raw' }
  });
  if (!r.ok) return new Response('manca', { status: 404, headers: cors });
  return new Response(r.body, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=86400', 'Access-Control-Allow-Origin': cors['Access-Control-Allow-Origin'] } });
}

// Progressi salvati online: progressi/<nome>.json nella repo privata. Serve il codice delle foto (FOTO_CODICE).
// POST { codice, nome, dati: { ae_prog, ae_piano, ae_prof } } -> salva;  GET ?nome=&codice= -> { salvato, dati }
const aB64testo = s => { const by = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < by.length; i += 0x8000) bin += String.fromCharCode(...by.subarray(i, i + 0x8000)); return btoa(bin); };
const daB64testo = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0)));
async function progressi(req, url, env) {
  if (!env.GH_TOKEN || !env.GH_REPO || !env.FOTO_CODICE) return [{ errore: 'salvataggio non configurato' }, 501];
  const post = req.method === 'POST';
  let b = {};
  if (post) { try { b = await req.json(); } catch { return [{ errore: 'dati non validi' }, 400]; } }
  if ((post ? b.codice : url.searchParams.get('codice')) !== env.FOTO_CODICE) return [{ errore: 'codice sbagliato' }, 403];
  const nome = String((post ? b.nome : url.searchParams.get('nome')) || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 30);
  if (!nome) return [{ errore: 'nome mancante' }, 400];
  const api = `https://api.github.com/repos/${env.GH_REPO}/contents/progressi/${nome}.json`;
  const h = { Authorization: `Bearer ${env.GH_TOKEN}`, 'User-Agent': 'ginny-ponte', Accept: 'application/vnd.github+json' };
  const r = await fetch(api, { headers: h });
  if (!post) {
    if (r.status === 404) return [{ errore: 'nessun salvataggio con questo nome' }, 404];
    if (!r.ok) return [{ errore: 'GitHub ' + r.status }, 502];
    return [JSON.parse(daB64testo((await r.json()).content)), 200];
  }
  if (!b.dati || typeof b.dati !== 'object') return [{ errore: 'dati mancanti' }, 400];
  const salvato = new Date().toISOString(), testo = JSON.stringify({ salvato, dati: b.dati });
  if (testo.length > 500_000) return [{ errore: 'progressi troppo grandi' }, 413];
  const sha = r.ok ? (await r.json()).sha : undefined;
  const w = await fetch(api, { method: 'PUT', headers: h, body: JSON.stringify({ message: `Progressi ${nome}`, content: aB64testo(testo), sha }) });
  if (!w.ok) return [{ errore: 'GitHub ' + w.status }, 502];
  return [{ ok: true, salvato }, 200];
}

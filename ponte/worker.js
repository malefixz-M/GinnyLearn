// Ponte compiti: Cloudflare Worker che entra in Scuola Online e restituisce i compiti in JSON.
// Variabili (Settings > Variables and Secrets):
//   SOL_USER, SOL_PASS  -> segreti (tipo "Secret"), nome utente e password di Scuola Online
//   SOL_SCUOLA         -> codice scuola (es. SOL_0000), come Secret
//   ORIGINE             -> indirizzo dell'app, es. https://TUONOME.github.io (facoltativo, default "*")
const DURATA_CACHE = 15 * 60; // secondi

export default {
  async fetch(req, env, ctx) {
    const cors = {
      'Access-Control-Allow-Origin': env.ORIGINE || '*',
      'Access-Control-Allow-Methods': 'GET',
      'Content-Type': 'application/json; charset=utf-8'
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(req.url);
    if (url.pathname !== '/compiti') return new Response('{"errore":"usa /compiti"}', { status: 404, headers: cors });

    const cache = caches.default, chiave = new Request(url.origin + '/compiti-cache');
    if (!url.searchParams.has('fresco')) {
      const hit = await cache.match(chiave);
      if (hit) return new Response(hit.body, { headers: cors });
    }
    try {
      const html = await scaricaCompiti(env.SOL_SCUOLA, env.SOL_USER, env.SOL_PASS);
      const corpo = JSON.stringify({ aggiornato: new Date().toISOString(), compiti: leggiCompiti(html) });
      ctx.waitUntil(cache.put(chiave, new Response(corpo, { headers: { 'Cache-Control': `max-age=${DURATA_CACHE}` } })));
      return new Response(corpo, { headers: cors });
    } catch (e) {
      return new Response(JSON.stringify({ errore: String(e.message || e) }), { status: 502, headers: cors });
    }
  }
};

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
  if (!pag.html.includes('GridViewCompiti')) throw new Error(/LoginPrincipale/.test(pag.html) ? 'login non riuscito' : 'pagina compiti non trovata');
  return pag.html;
}

/* ---- lettura tabella ---- */
export function leggiCompiti(html) {
  const i = html.indexOf('GridViewCompiti'); if (i < 0) return [];
  const fine = html.indexOf('</table>', i), tab = html.slice(i, fine);
  const out = [];
  for (const r of tab.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cella = et => { const m = r[1].match(new RegExp(`data-content="${et}:?"[^>]*>([\\s\\S]*?)<\\/td>`)); return m ? testo(m[1]) : ''; };
    const consegna = cella('Data consegna'), compito = cella('Compito');
    if (!consegna || !compito) continue;
    const [g, m, a] = consegna.split('/');
    const idSol = (r[1].match(/HiddenFieldIdTabellaCollegata[^>]*value="(\d+)"/) || [])[1];
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

# GinnyLearn (Quaderno dei giochi) — documento di progetto

App di esercizi in stile Wordwall per un tablet Android (quinta elementare).
Materie: matematica, storia, geografia. Temi presi dai suoi libri e quaderni.

Repository GitHub: `malefixz-M/GinnyLearn` (pubblica), sito su GitHub Pages: https://malefixz-m.github.io/GinnyLearn/
Chat del progetto: GINNYLEARN (le successive si chiamano GINNYLEARN 2, 3, ...).
**Regola: la repo GitHub non va aggiornata senza l'ok esplicito di Daniele.**

## Architettura
- **App**: PWA statica (`index.html` + `sw.js` + `manifest.webmanifest` + `icons/`). Si installa da Chrome con "Aggiungi a schermata Home". Funziona offline.
- **Contenuti**: un solo file `data/contenuti.json` con temi, giochi e compiti. A ogni apertura, e quando torna in primo piano, l'app lo riscarica. Se `versione` è aumentata, mostra "Sono arrivati temi nuovi".
- **Progressi** (punti, stelle, record, compiti spuntati, profilo): salvati in `localStorage` sul tablet.
- **Futuro, classifica con le amiche**: oggetto `Sync` in `index.html` (ora non fa niente). Si collegherà a Firebase (piano gratuito). Gruppo privato con codice invito, solo soprannome e avatar, niente dati personali. Serve l'ok dei genitori delle amiche.

## Ponte compiti (Cloudflare Worker)
- Codice in `ponte/worker.js`. Entra in Scuola Online (codice scuola nel Secret `SOL_SCUOLA`, login.aspx in ASP.NET WebForms con __VIEWSTATE), apre `Compiti/List.aspx` e legge la tabella `GridViewCompiti`. Usa le celle con data-content "Materia", "Data consegna" e "Compito"; l'id viene da `HiddenFieldIdTabellaCollegata`.
- Restituisce `GET /compiti` → `{ aggiornato, compiti: [{ id: "sol-351", data, materia, testo, verifica }] }`. Tiene una copia per 15 minuti; con `?fresco` forza un nuovo download. Non restituisce mai nomi di docenti né la classe.
- Variabili su Cloudflare: `SOL_SCUOLA`, `SOL_USER` e `SOL_PASS` come Secret, `ORIGINE` = `https://malefixz-m.github.io`.
- Nell'app l'indirizzo del ponte sta nel campo `"ponte"` di `contenuti.json`. Ogni volta che si apre, l'app scarica i compiti e li unisce a quelli manuali. Senza internet usa l'ultima copia.
- La lista predefinita della pagina copre da oggi a +7 giorni: il ponte rifà la ricerca "Cerca" (postback `LinkButtonCerca`) da oggi a +21 giorni.
- **Attenzione**: nell'HTML del server le celle non hanno `data-content` (lo aggiunge il JavaScript della pagina; le pagine salvate dal browser invece ce l'hanno). Il ponte riconosce le colonne dalle intestazioni `<th>`.
- **Cron e notifiche (v3)**: Cron Trigger `0 14,15,21,22 * * *` (UTC); il codice lavora solo quando a Roma sono le 16 o le 23 (vale con ora solare e legale). Salva l'ultimo risultato in KV (`ultimo`); se trova compiti nuovi o cambiati salva `novita` e manda un push vuoto a tutte le iscrizioni (`iscrizioni`, max 10). Il service worker legge `/novita` e mostra la notifica; toccandola apre `#/compiti`.
- Altri indirizzi: `/vapid` (chiave pubblica), `POST /iscrivi` (salva l'iscrizione), `/novita`, `/prova-push` (manda una notifica di prova). Se Scuola Online non risponde, `/compiti` restituisce l'ultimo risultato in KV.
- Variabili in più: `VAPID_PUBLIC` (testo), `VAPID_PRIVATE` (Secret), binding KV con nome `KV`.
- Nell'app: bottone "🔔 Attiva notifiche" nella pagina Premi; pallino sull'icona con il numero di compiti da fare (`setAppBadge`); scorciatoia "Compiti" tenendo premuta l'icona (`shortcuts` nel manifest).
- Diagnosi: `/compiti?diagnosi&fresco` restituisce solo numeri e nomi delle colonne.
- Collegamento compito → tema: campo `"parole"` del tema, per esempio `["etrusch"]`. Se il testo del compito di quella materia contiene una delle parole, compare il bottone "Esercitati".
- Le pagine HTML di riferimento salvate da Daniele sono in Scuola_online.zip; non vanno pubblicate perché contengono nomi.

## Come si aggiungono temi e compiti
1. Daniele manda a Claude foto o screenshot (pagina del libro, quaderno, oppure l'agenda dell'app SCUOLA ONLINE per i compiti).
2. Claude legge la pagina e scrive i nuovi temi o compiti nel formato qui sotto. Le domande devono essere adatte alla quinta elementare e fedeli al libro.
3. Daniele controlla l'anteprima e dà l'ok.
4. Claude aggiorna `data/contenuti.json`: aggiunge in coda, **aumenta `versione` di 1** e aggiorna `aggiornato`. Poi fa il commit su GitHub.
5. Il tablet scarica i contenuti nuovi alla prossima apertura.

Se cambia `index.html`, va aumentato anche `VERSIONE` in `sw.js`.

## Schema di `data/contenuti.json`
```json
{
  "versione": 1,
  "aggiornato": "AAAA-MM-GG",
  "ponte": "https://ginny-ponte.XXXX.workers.dev/compiti",
  "materie": { "storia": { "nome": "Storia", "icona": "🏺", "mondo": "papiro" } },
  "temi": [ { "id": "sto-etruschi", "materia": "storia", "titolo": "Gli Etruschi", "fonte": "Libro storia pag. 40", "giochi": [ ... ] } ],
  "compiti": [ { "id": "c-20261116-1", "data": "2026-11-16", "materia": "storia", "testo": "Studiare pag. 40-42", "tema": "sto-etruschi", "verifica": false } ]
}
```
- `mondo`: `spazio` (matematica), `papiro` (storia), `mare` (geografia). È la grafica dei giochi.
- `id` del tema: prefisso materia (`mat-`, `sto-`, `geo-`) più una parola chiave. Non si cambia mai, perché i record sono legati all'id.
- `parole` nel tema: radici di parole che collegano in automatico i compiti del registro, per esempio `["grec"]`.
- Il campo `tema` nei compiti è facoltativo. Se c'è, compare il bottone "Esercitati".

### Tipi di gioco
| tipo | dati | note |
|---|---|---|
| `quiz` | `domande: [{ "d": "domanda", "r": ["GIUSTA", "sbagliata", "sbagliata", "sbagliata"] }]` | la prima risposta è quella giusta, l'app le mescola; 10 domande al massimo per partita |
| `completa` | `frasi: [{ "f": "testo con ___ al posto della parola", "r": ["GIUSTA", "sb", "sb"] }]` | |
| `verofalso` | `frasi: [{ "f": "frase", "v": true }]` | |
| `abbina` | `coppie: [["a", "b"], ...]` | 6 coppie per partita, testi brevi |
| `memory` | `coppie: [["a", "b"], ...]` | 6 coppie, massimo 3 parole per carta |
| `ordina` | `istruzione`, `elementi: ["primo", "secondo", ...]` | nell'ordine corretto, da 4 a 8 elementi |
| `anagramma` | `parole: [{ "p": "PAROLA", "indizio": "..." }]` | una sola parola, senza spazi |
| `categorie` | `gruppi: { "Gruppo A": ["...", ...], "Gruppo B": [...] }` | da 2 a 4 gruppi, 12 carte per partita |
| `cartina` | `mappa: "italia"`, `punti: [{ "n": "Roma", "lat": 41.9, "lon": 12.5, "tipo": "citta" }]` | cartina muta: si trascina il nome sul punto (o si tocca il punto). `tipo`: citta, monte, fiume, lago, regione. Massimo 8 punti per partita. Al posto di lat/lon si può dare `x`,`y` in % |

Ogni gioco può avere un `titolo`. Per ogni tema conviene preparare 4-6 giochi di tipi diversi.

## Stato
- v1 (14/11/2026): app base con 8 tipi di gioco, grafica a tema per materia, calendario compiti, medaglie, profilo. 3 temi di esempio.
- v2 (14/11/2026): ponte compiti da Scuola Online (testato sulla pagina salvata, non ancora sul sito vero), materie extra (italiano, inglese…), collegamento automatico compito → tema. I compiti finti sono stati tolti.
- Da fare, in ordine:
  1. FATTO: repo GinnyLearn creata e primo push (15/11). Daniele deve attivare Pages (Settings → Pages → Deploy from a branch → main / root).
  2. Daniele crea il Worker `ginny-ponte` su Cloudflare, incolla `ponte/worker.js` e inserisce i Secret. Claude poi scrive l'URL in `contenuti.json` → `ponte`.
  3. Temi veri dalle foto. Urgente: verifica sui Greci lunedì 16/11 (storia, pag. 22-23 e 29).
  - 15/11: risolto il problema "0 righe" (vedi Attenzione sopra), provato sul sito vero: 5 compiti letti. Da incollare su Cloudflare.
  - 15/11: ponte pubblicato (ginny-ponte.malefixz.workers.dev) e scritto in contenuti.json; tema sto-greci creato (v2), in attesa di commit.
  - 15/11 (GINNYLEARN 4): v3 con cron 16/23, KV, notifiche push, pallino e scorciatoia (sw `app-v3`); poi compiti spuntati restano barrati in home fino al giorno della consegna (sw `app-v4`). In attesa di: KV + cron + chiavi su Cloudflare, ok per commit.
  - 15/11 (GINNYLEARN 5): **Mia**, la guida dell'app (sw `app-v5`). Immagini WebP trasparenti in `mia/head/` e `mia/fullbody/`, ritagliate dalla tavola in `AppEsercizi/personaggi` (sorgente e anteprima in `personaggi/Mia_web`). In `index.html` l'oggetto `MIA` collega reazioni → testa/posa/frasi; `miaDice(chiave)` durante i giochi (giusta, serie, sbagliata, tantiErrori, riprova, inizio, inattività dopo 25 s), posa a corpo intero nella schermata finale, saluto in home. Frasi sempre **neutre** (niente maschile/femminile, es. "Ottimo lavoro!" e non "Bravissima!"). Non ridisegnare Mia in SVG. In attesa di ok per commit.
  4. Classifica con le amiche: stesso Worker con KV/D1 al posto di Firebase.
  - 15/11 (GINNYLEARN 6): controllati i file (JS valido, contenuti v2). Chiavi VAPID generate in `CHIAVI_VAPID_NON_PUBBLICARE.txt` (escluso da git con `.gitignore`, insieme agli `.zip`). In attesa: ok di Daniele per commit/push e configurazione Cloudflare (KV `KV`, VAPID, cron).
  - 15/11 (GINNYLEARN 6): v5 pubblicata (commit 0375548). Cloudflare completo: KV `KV`→ginny-kv, VAPID, cron. Notifiche provate: funzionano.
  - Richieste nuove di Daniele (da fare in GINNYLEARN 7):
    a. Nome app installata: deve essere "GinnyLearn" (ora "Quaderno"): manifest name/short_name + title; sul tablet reinstallare.
    b. Geografia: nuovo tipo di gioco `cartina` (cartina muta SVG, trascinare città/monti/fiumi al punto giusto).
    c. Aggiornamento automatico senza PC: valutare se il libro Sanoma è raggiungibile (probabilmente no: login + protezione); alternativa = attività programmata in cloud che prepara i temi dai compiti/foto, da approvare.
    d. Foto di compiti/schede dal tablet: bottone "📷 Invia foto" → Worker → cartella `inbox/` in una repo GitHub **privata** (le foto possono contenere nomi) → Claude le legge e crea i temi.
    e. Nuovi personaggi **Nico, Lilli e Tomo** in `C:\Users\malef\Desktop\---CLAUDE---\AppEsercizi\personaggi`: prepararli come Mia (WebP trasparenti head/fullbody, stesse reazioni, frasi neutre).
    f. Al primo avvio: si sceglie il nome e uno dei 4 personaggi (Mia, Nico, Lilli, Tomo), che diventa la guida (oggetto `MIA` da generalizzare in `GUIDA`; scelta salvata nel profilo, cambiabile dopo).
    g. All'inizio della chat allineare in automatico la cartella del PC con GitHub (`git fetch` + `git reset --hard origin/main`; serve il permesso di cancellare nella cartella; il push si fa dal cloud con la repo collegata).
  - 15/11 (GINNYLEARN 7): v6 (sw `app-v6`, contenuti v3), **in attesa di ok per commit**.
    - g. Il PC non raggiunge GitHub (proxy 403): l'allineamento si fa clonando la repo nel cloud e confrontando i file; il contenuto del PC era già uguale a origin/main (0375548), cambiava solo PROGETTO.md. Il git locale del PC resta indietro di storia: dopo il push, se serve, su Windows `git fetch` + `git reset --hard origin/main`.
    - a. Nome "GinnyLearn" in manifest e title. Sul tablet: disinstallare e reinstallare da Chrome.
    - e. Nico, Lilli, Tomo in `guide/<nome>/head/happy.webp` e `guide/<nome>/fullbody/master.webp`, scontornati dai master (sorgente `personaggi/*_Asset_Pack_Claude.zip`). Hanno **una sola espressione e una sola posa**: le reazioni usano la stessa immagine con le animazioni (salta, scuoti, dondola). Quando ci saranno le 12 espressioni e le pose come Mia, basta copiarle con gli stessi nomi di Mia e mettere `completa: true` in `GUIDE`.
    - f. `MIA` → `GUIDA` (reazioni) + `GUIDE` (personaggi); scelta nel profilo (`PROF.guida`, default mia), cambiabile da Premi → "Cambia nome, avatar o guida". Benvenuto neutro.
    - d. Bottone "📷 Invia foto" nella pagina Compiti → `POST /foto` del ponte → `inbox/` della repo privata. Da fare su GitHub/Cloudflare: creare repo privata `GinnyLearn-inbox`; token fine-grained solo su quella repo (Contents: Read and write); sul Worker Secret `GH_TOKEN`, `FOTO_CODICE` e variabile `GH_REPO`; incollare il nuovo `ponte/worker.js`. Il codice si scrive una volta sul tablet. Le foto sono rimpicciolite a 1600 px.
    - b. Gioco `cartina` + `mappe/italia.svg` (confini regioni da openpolis/geojson-italy, CC BY 4.0). Esempio nel tema geo-regioni: città, monti, Po, Garda.
    - c. Non fatto (solo da valutare).

  - 15/11 (GINNYLEARN 7, seconda parte): v7 (sw `app-v7`, contenuti v4), **in attesa di ok per commit**.
    - Home: tutti i compiti futuri; materie ordinate per tema più recente (ultimo in `temi`), aggiunte tutte le materie dell'orario (`MATERIE_BASE`, campo `colore`). `normMateria()` converte i nomi del registro (es. "lingua inglese" → inglese).
    - Compiti: futuri, poi "Compiti passati" ingrigiti (si può ancora fare Esercitati); campo 🔍 Cerca su temi e compiti.
    - "📷 Invia foto del quaderno" solo nei compiti con "quaderno" o "q."; la foto arriva in `inbox/` con nome `<data>_<materia>_<idcompito>.jpg`.
    - Pagine del libro: "pag. 40", "pagg. 40-42", "p. 7" nel compito → bottoni 📄. Il ponte (`GET /pagina?m=&n=&codice=`) legge `pagine/<materia>/<n>.jpg` dalla repo privata (le pagine dei libri non vanno nella repo pubblica).
    - 🎒 Orario per lo zaino: `img/orario.webp` (senza titolo con i nomi) + `orario` in contenuti.json → "Domani nello zaino".
  - 15/11: Nico, Lilli, Tomo **completi** (sw `app-v8`): 10 espressioni + 5 pose ritagliate dalla tavola `Tavola_completa_espressioni.png` (nei pacchetti `*_ESPRESSIONI_CORRETTE.zip`), sfondo reso trasparente. Nomi come Mia (`crying` = copia di `sad`, `encouraging` corpo = `waving`); in più `neutral`, `curious`, `confused`, `waving`, `studying`. Il `master` ora viene dalla tavola, per avere lo stesso stile delle espressioni.

  - 15/11 (GINNYLEARN 8): contenuti **v5**: temi `ing-someany` (Inglese, some/any, 7 giochi) e `ita-sanmartino` (Italiano, poesia di Carducci + leggenda del mantello + estate di San Martino, 7 giochi). Commit e push di v8 completo (personaggi inclusi) dal cloud.

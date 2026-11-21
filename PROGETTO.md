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
- **APK "guscio" (v11)**: cartella `android/`, app Android (Java, WebView) che apre `https://malefixz-m.github.io/GinnyLearn/index.html` a schermo intero. Serve perché con Family Link l'app installata da Chrome conta come Chrome e si blocca quando finisce il tempo di Chrome. Gli aggiornamenti arrivano dal sito; l'APK si reinstalla solo se cambia `android/`. Vedi sezione "APK guscio".

## Ponte compiti (Cloudflare Worker)
- Codice in `ponte/worker.js`. Entra in Scuola Online (codice scuola nel Secret `SOL_SCUOLA`, login.aspx in ASP.NET WebForms con __VIEWSTATE), apre `Compiti/List.aspx` e legge la tabella `GridViewCompiti`. Usa le celle con data-content "Materia", "Data consegna" e "Compito"; l'id viene da `HiddenFieldIdTabellaCollegata`.
- Restituisce `GET /compiti` → `{ aggiornato, compiti: [{ id: "sol-351", data, materia, testo, verifica }] }`. Tiene una copia per 15 minuti; con `?fresco` forza un nuovo download. Non restituisce mai nomi di docenti né la classe.
- Variabili su Cloudflare: `SOL_SCUOLA`, `SOL_USER` e `SOL_PASS` come Secret, `ORIGINE` = `https://malefixz-m.github.io`.
- Nell'app l'indirizzo del ponte sta nel campo `"ponte"` di `contenuti.json`. Ogni volta che si apre, l'app scarica i compiti e li unisce a quelli manuali. Senza internet usa l'ultima copia.
- La lista predefinita della pagina copre da oggi a +7 giorni: il ponte rifà la ricerca "Cerca" (postback `LinkButtonCerca`) da oggi a +21 giorni.
- **Attenzione (16/11)**: un compito con allegato ha una `<table>` annidata nella cella Allegati. `tabella()` ora trova la fine della griglia contando le tabelle annidate e le toglie prima di leggere le righe (prima si perdevano tutte le righe dopo il primo allegato).
- **Attenzione**: nell'HTML del server le celle non hanno `data-content` (lo aggiunge il JavaScript della pagina; le pagine salvate dal browser invece ce l'hanno). Il ponte riconosce le colonne dalle intestazioni `<th>`.
- **Cron e notifiche (v3)**: Cron Trigger `0 14,15,21,22 * * *` (UTC); il codice lavora solo quando a Roma sono le 16 o le 23 (vale con ora solare e legale). Salva l'ultimo risultato in KV (`ultimo`); se trova compiti nuovi o cambiati salva `novita` e manda un push vuoto a tutte le iscrizioni (`iscrizioni`, max 10). Il service worker legge `/novita` e mostra la notifica; toccandola apre `#/compiti`.
- Altri indirizzi: `/vapid` (chiave pubblica), `POST /iscrivi` (salva l'iscrizione), `/novita`, `/prova-push` (manda una notifica di prova), `/eventi` (vedi "Avvisi a Daniele"). Se Scuola Online non risponde, `/compiti` restituisce l'ultimo risultato in KV.
- Il cron confronta con la chiave KV `visto-cron` (scritta solo dal cron; `ultimo` lo aggiorna anche l'app e prima nascondeva i compiti già visti dal tablet).
- (v12) Tolti l'avviso foto al genitore e la pagina `#/genitore`: gli avvisi a Daniele passano dall'app Claude. Le chiavi KV `iscrizioni-genitore` e `novita-genitore` restano ma non si usano più.
- Variabili in più: `VAPID_PUBLIC` (testo), `VAPID_PRIVATE` (Secret), binding KV con nome `KV`.
- Nell'app: bottone "🔔 Attiva notifiche" nella pagina Premi; pallino sull'icona con il numero di compiti da fare (`setAppBadge`); scorciatoia "Compiti" tenendo premuta l'icona (`shortcuts` nel manifest).
- Diagnosi: `/compiti?diagnosi&fresco` restituisce solo numeri e nomi delle colonne.
- **Allegati (v4 del ponte, 16/11)**: dalla tabella annidata della cella Allegati il ponte tiene i link (`<a href>`, nel server sono relativi tipo `../FileUtenti/31/Compiti_5e.pdf`). Ogni compito ha `allegati: [{ nome, file }]` con `file = allegati/<idcompito>/<nome>` nella repo privata. Al controllo delle 16/23 e con `/controlla` il ponte li scarica con la stessa sessione (cookie) e li salva in `GinnyLearn-inbox` (KV `allegati-salvati`; max 20 MB; se arriva una pagina HTML è login scaduto e riprova al giro dopo). `GET /allegato?c=<idcompito>&f=<nome>&codice=<FOTO_CODICE>` restituisce il file dalla repo, oppure lo scarica al volo se non c'è ancora. Un allegato aggiunto o cambiato rende il compito "cambiato" (solo se la copia vecchia aveva già il campo `allegati`).
- Nell'app: bottone "📎 <nome>" nel compito (`apriAllegato`): nell'APK si apre fuori (Chrome o il lettore PDF), in Chrome in una scheda nuova. Chiede il codice come le pagine del libro.
- Collegamento compito → tema: campo `"parole"` del tema, per esempio `["etrusch"]`. Se il testo del compito di quella materia contiene una delle parole, compare il bottone "Esercitati".
- Le pagine HTML di riferimento salvate da Daniele sono in Scuola_online.zip; non vanno pubblicate perché contengono nomi.

## APK guscio (Android)
- Codice: `android/` (pacchetto `it.ginnylearn.app`, minSdk 24, target 35). `MainActivity`: WebView con JavaScript, localStorage, service worker e cache attivi, suoni senza tocco, schermo intero, indietro = pagina precedente, link di altri siti aperti fuori, bottone 📷 = scelta tra Fotocamera e Galleria (FileProvider, niente permesso CAMERA). Se manca internet alla prima apertura mostra "Riprova".
- La pagina vede `window.GinnyApp` (costante `APP` in index.html): `versione()`, `notificheAttive()`, `provaNotifica()`, `controllaOra()`, `riprova()`, `orientamento('orizzontale'|'libero')` (v12, per lo zaino; l'APK vecchio non ce l'ha e la pagina prova `screen.orientation.lock`). In Premi, dentro l'APK, al posto di "Attiva notifiche" ci sono "Prova notifica" e "Controlla adesso".
- **Notifiche native** (`ControlloCompiti`, WorkManager ogni ora circa): controlla davvero una volta dopo le 16:05 e una dopo le 23:05 (recupera se il tablet era spento). Legge `ponte` da `data/contenuti.json`, scarica `/compiti?fresco`, confronta con l'ultimo visto (SharedPreferences) e notifica "📒 N compiti nuovi / cambiati". Il primo giro salva soltanto. Toccando la notifica si apre `#/compiti`. Le notifiche web non funzionano nella WebView.
- **Build**: GitHub Actions `.github/workflows/apk.yml` a ogni push che tocca `android/` (o a mano da Actions → "APK guscio" → Run workflow). Pubblica la Release `apk-<n>` con `GinnyLearn.apk`; link fisso: https://github.com/malefixz-M/GinnyLearn/releases/latest/download/GinnyLearn.apk . versionCode = numero della build.
- **Firma**: Secret della repo `KEYSTORE_B64` e `KEYSTORE_PASS` (file dati a Daniele, da conservare: **sempre la stessa chiave**, altrimenti il tablet non installa l'aggiornamento). Senza Secret il workflow fa solo un APK di prova (artifact), senza Release.
- **Installazione sul tablet**: in Family Link (telefono del genitore) → profilo della figlia → dispositivo → impostazioni → attivare "App da origini sconosciute"; sul tablet aprire il link dell'APK in Chrome e installare; poi in Family Link mettere GinnyLearn su "Sempre consentita" (e si può rispegnere "origini sconosciute"). Prima di disinstallare la vecchia app di Chrome: Premi → "☁️ Salva adesso"; nell'APK: primo avvio → "🔄 Recupera i progressi".

## Avvisi a Daniele nell'app Claude (v12)
- Il Worker tiene un registro in KV `eventi` (ultimi 40): `{ n, quando, tipo: 'compiti', titolo, compiti: [{ id, data, materia, testo, verifica, stato: nuovo|cambiato }] }` dal cron delle 16/23, e `{ n, quando, tipo: 'foto', file, materia, compito, testo, consegna }` a ogni `POST /foto`.
- `GET /eventi` → `{ ora, visto, ultimo, eventi }` con solo gli eventi non ancora letti; `GET /eventi?visto=N` li segna letti fino a N; `?tutti` = tutti gli ultimi 40. Niente codice: contiene solo i compiti (già pubblici da `/compiti`) e i nomi dei file.
- **Avvio dal Worker (v13)**: con i Secret `CLAUDE_FIRE_URL` e `CLAUDE_FIRE_TOKEN` (API trigger dell'attività, da claude.ai/code/routines) e il Cron Trigger in più `*/10 * * * *`, ogni 10 minuti il Worker guarda se ci sono eventi non letti: se sì (aspetta 3 min dall'ultimo evento, al massimo un avvio ogni 30 min) fa partire l'attività di Claude con `POST /fire`. Così la sessione, e la notifica, arrivano solo quando c'è davvero una novità. KV: `eventi-avvisato`, `fire-quando`. Fatto questo, togliere la pianificazione oraria dall'attività.
- **Le novità viaggiano nel messaggio di avvio**: `POST /fire` con `text = "NOVITA_GINNYLEARN " + JSON { ultimo, eventi }`. La sessione NON deve rileggere `/eventi` con WebFetch: WebFetch restituisce copie vecchie (stessa risposta anche cambiando i parametri). Istruzioni dell'attività in `ponte/istruzioni_attivita.md` (da incollare a mano su claude.ai/code/routines: le attività create da Daniele non si possono modificare da Claude).
- **Controllo a mano**: `GET /controlla?codice=<FOTO_CODICE>` fa subito il controllo dei compiti (come alle 16/23) e, se ci sono novità, avvisa subito Claude. Risponde `{ ok, novita, claudeAvvisato }`.
- **Attività programmata di Claude** "GinnyLearn – novità compiti e foto" (alle 16:20 e 23:20 ora di Roma, notifica sul telefono): legge `/eventi` con WebFetch (dal cloud solo WebFetch raggiunge workers.dev), se non c'è niente chiude subito; altrimenti manda a Daniele compiti nuovi, foto arrivate e la proposta di temi, segna gli eventi letti e aspetta la risposta nella stessa sessione. Con un solo ok (dal 17/11) crea i giochi e li pubblica direttamente su main. Le foto e le pagine dei libri stanno nella repo privata `GinnyLearn-inbox`: la sessione chiede a Daniele di poterla collegare.

## Progressi online (v11)
- `POST /progressi` `{ codice, nome, dati: { ae_prog, ae_piano, ae_prof } }` → `progressi/<nome>.json` nella repo privata (`GH_REPO`), con `{ salvato, dati }`. `GET /progressi?nome=&codice=` lo restituisce. Codice = `FOTO_CODICE`. Nome = soprannome del profilo in minuscolo senza accenti (es. "Ginny" → `ginny`).
- Nell'app: salvataggio automatico 15 s dopo ogni cambiamento (fine partita, compito spuntato, foto inviata, piano, profilo) e subito quando l'app va in background, solo se il codice è già stato scritto e se qualcosa è cambiato (`ae_cloud_firma`). Premi → "☁️ Progressi online": ultimo salvataggio, "Salva adesso", "Recupera progressi" (chiede nome e codice, mostra stelle/punti e chiede conferma prima di sostituire). Al primo avvio c'è "🔄 Hai già giocato su un altro dispositivo?".
- **Foto inviata**: dopo `POST /foto` riuscito il compito mostra "✅ Foto inviata <giorno, ora>" e il bottone diventa "📷 Rimanda foto" (in `PROG.fotoInviate[idCompito]`, quindi salvato con i progressi). Se l'invio fallisce compare "❌ Foto NON inviata…" per 6 secondi e non si segna niente.

## Come si aggiungono temi e compiti
1. Daniele manda a Claude foto o screenshot (pagina del libro, quaderno, oppure l'agenda dell'app SCUOLA ONLINE per i compiti).
2. Claude legge la pagina e scrive i nuovi temi o compiti nel formato qui sotto. Le domande devono essere adatte alla quinta elementare e fedeli al libro.
3. Daniele controlla l'anteprima e dà l'ok.
4. Claude aggiorna `data/contenuti.json`: aggiunge in coda, **aumenta `versione` di 1** e aggiorna `aggiornato`. Poi fa il commit su GitHub.
5. Il tablet scarica i contenuti nuovi alla prossima apertura.

Se cambia `index.html`, va aumentato anche `VERSIONE` in `sw.js`.

## Regole per creare i giochi (dal 21/11, decise da Daniele)
1. **Tutte le pagine da studiare.** Prima di scrivere, fai per ogni pagina l'elenco di cosa contiene: parole in **grassetto**, concetti chiave, box e trafiletti laterali di approfondimento (quelli accanto alle immagini, con didascalie). Distribuisci domande e carte su tutte le pagine, in proporzione: se le pagine sono due, nessuna deve restare senza domande.
2. **Cosa chiedere, in ordine di importanza**: parole in grassetto (definizioni, significato, uso), concetti chiave (cause, conseguenze, confronti, sequenze), poi alcune domande (circa 1 su 5) sui trafiletti di approfondimento e sulle didascalie delle immagini.
3. **Niente ripetizioni tra i giochi.** Ogni gioco del tema copre aspetti diversi. Lo stesso fatto può comparire al massimo in 2 giochi, e se succede va chiesto in modo diverso (per esempio definizione → esempio). Non si riusa la stessa frase cambiando solo la modalità.
4. **Domande autosufficienti.** Non fare mai riferimento agli esercizi o ai testi degli esercizi del libro ("nell'esercizio 3", "secondo il brano letto", "guarda la figura a pag. 90"). Nella domanda metti tutti i dati che servono per rispondere: numeri, nomi, una breve frase di contesto.
5. **Immagini del libro nelle domande.** Se per rispondere serve una figura (cartina, schema, grafico, tabella, foto con didascalia), ritagliala dalla pagina e mettila nella domanda con il campo `img` (vedi sotto). Il ritaglio va solo nella repo privata, mai in quella pubblica.
6. Se possibile, controlla la copertura prima di pubblicare: per ogni grassetto e ogni trafiletto c'è almeno una domanda? Nessuna domanda è ripetuta?

### Immagini nelle domande (`img`)
- Nei giochi `quiz`, `completa` e `verofalso` ogni domanda può avere `"img": "<idtema>/<file>"` (es. `"sci-universo-vicino/luna-fasi.jpg"`).
- Il file va in `GinnyLearn-inbox/figure/<idtema>/<file>` (jpg/png/webp, nomi con lettere minuscole, numeri, - e _; larghezza 800-1000 px). L'app lo legge dal ponte con `GET /figura?f=<idtema>/<file>&codice=<FOTO_CODICE>`.
- L'app usa il codice già scritto sul tablet; se manca il codice o il file, la domanda si vede lo stesso senza immagine. Quindi la domanda deve restare comprensibile anche senza figura, oppure la figura deve esserci di sicuro.
- Le domande con immagine hanno 10 secondi in più.

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
- `testo` nel tema: testo intero da studiare (poesie), `{ "tipo": "poesia", "titolo", "autore", "righe": [...] }` con `""` tra le strofe → bottone "📜 Leggi la poesia".
- `libro` nel tema: quale libro aprono i bottoni 📄 quando la materia ne ha più di uno (vedi `LIBRI` in index.html).
- `pagine` nel tema: numeri di pagina del libro (quelli stampati). Nella pagina del tema compaiono i bottoni 📄, e un compito della stessa materia che cita una di quelle pagine si collega al tema anche senza `parole`.
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
| `componi` | `istruzione`, `frasi: ["frase o verso intero", ...]` | componi la frase: le parole arrivano mescolate e si toccano nell'ordine giusto, una frase per giro (max 8); meglio frasi di 5-8 parole |
| `cartina` | `mappa: "italia"` (oppure una regione: `puglia`, `basilicata`, `campania`, `calabria`, `sicilia`, `sardegna`), `punti: [{ "n": "Roma", "lat": 41.9, "lon": 12.5, "tipo": "citta" }]` | cartina muta: si trascina il nome sul punto (o si tocca il punto). `tipo`: citta, monte, fiume, lago, regione. Massimo 8 punti per partita. Al posto di lat/lon si può dare `x`,`y` in % |

Ogni gioco può avere un `titolo`. Per ogni tema conviene preparare 4-6 giochi di tipi diversi.

**Poesie e testi da imparare a memoria** (regola di Daniele): solo `ordina` (versi o frasi in ordine, anche le strofe), `completa` (parole mancanti) e `componi` (componi la frase). Niente quiz, vero/falso, memory, abbina o categorie.

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

  - 15/11 (GINNYLEARN 10): v10 (sw `app-v10`, contenuti **v7**), **in attesa di ok per commit/push**. Il nuovo `ponte/worker.js` va incollato su Cloudflare.
    - Cavallo del mondo papiro girato verso il traguardo (`scaleX(-1)`); barca e razzo erano già giusti.
    - `sto-greci`: anagramma POLIS → POLEIS (plurale).
    - Tablet in verticale: la guida sta in alto, sotto la pista, con il fumetto accanto alla domanda (`@media (orientation:portrait)`; nel DOM `.mia` ora è prima di `.palco`).
    - Suoni nuovi sintetizzati (campanella, boing morbido, fanfara, click). `audioPronto()` fa `AC.resume()` prima di ogni suono, al ritorno in primo piano e al primo tocco: i suoni non spariscono più dopo il background.
    - **Home divisa in due**: sopra i compiti, sotto le materie, due zone che scorrono separate (`body.in-casa`, `.zona`, altezza `100dvh`). Bottoni 🗓️ Il mio piano, 🎒 Zaino, 📒 Tutti.
    - **Il mio piano** (`#/piano`, anche nella barra in basso): i compiti da consegnare sono carte; si tocca una carta e poi il giorno. ⏱️ per il tempo (15-90 min, verifiche 60 di base), spunta, avvisi "Troppo tardi" (giorno ≥ consegna) e "Giornata piena" (> 90 min), bottone "✨ Aiutami a organizzare" (mette ogni compito nel giorno meno carico prima della consegna). Salvato in `localStorage` `ae_piano`. Nei compiti compare "🗓️ lo fai lunedì".
    - Avviso al genitore quando arriva una foto (vedi Ponte compiti).
    - Temi nuovi: `ing-howmuchmany` (dalla foto del tablet del 15/11, compito sol-426: some/any, How much / How many, 7 giochi) e `civ-unione-europea` (Ed. civica, preparato senza quaderno: simboli, storia, istituzioni, presidenti, euro; 7 giochi). **Da aggiornare nel 2027**: Lagarde lascia la BCE il 7/2/2027, il mandato di Metsola al Parlamento scade a gennaio 2027.
    - Scheda di matematica: tolta dai lavori (decisione di Daniele).
  - 15/11 (GINNYLEARN 9): v9 (sw `app-v9`, contenuti **v6**), **in attesa di ok per commit**.
    - Tolti i temi di prova `mat-frazioni`, `sto-etruschi`, `geo-regioni`.
    - Temi nuovi dai PDF dei libri: `geo-puglia`, `geo-basilicata`, `geo-campania` (verifica 20/11), `geo-calabria`, `geo-sicilia`, `geo-sardegna` (ripasso), 7 giochi ciascuno con 1-2 cartine; `mat-statistica` (mediana, moda, media, pag. 81-84), `mat-decimali` (pag. 170-173), `sci-sistema-solare` (pag. 88-89). Le regioni sono in fondo a `temi` così Geografia è la prima materia in home.
    - Cartine delle regioni: `mappe/<regione>.svg`, ritagli di `italia.svg` (stessa proiezione, `vx`/`vy` in `MAPPE`), regione evidenziata e nomi dei mari. Rigenerabili con lo script in chat.
    - Campo `pagine` nei temi (bottoni 📄 nella pagina del tema + collegamento compito → tema per numero di pagina).
    - Libri: cartella PC `AppEsercizi\LIBRI` (PDF fatti di immagini, senza testo). Scarto +2 su tutti (pag. PDF = pag. libro + 2), vedi `indice_pagine.json` nella repo privata. Pagine singole JPG in `GinnyLearn-inbox/pagine/<materia>/<n>.jpg` (geografia, matematica, scienze, storia, tecnologia; ~100 MB): i bottoni 📄 le leggono dal ponte. Il PDF intero non serve nella repo (troppo pesante da scaricare sul tablet). "Mappe italiano 4-5" è un'antologia, non caricata come italiano.
    - `ita-sanmartino` rifatto con la regola delle poesie: 4 × ordina i versi, ordina le strofe, 2 × parole mancanti, 2 × componi i versi (nuovo tipo `componi`).
    - Libri aggiunti dopo: Grammatica 5 (scarto +2 fino a pag. 136, poi +3), Letture 5, Scrittura 5, Inglese 5 Student's book e Grammar (+2). Cartelle pagine: `grammatica`, `letture`, `scrittura`, `inglese`, `inglesegrammar` (circa 180 MB in tutto). In `index.html` l'oggetto `LIBRI` elenca i libri per materia; `libroDi()` sceglie il libro dal testo del compito ("letture", "scrittura", "grammar"), altrimenti il primo; nella finestra della pagina si può cambiare libro.
    - Tema `ita-modi-indefiniti` (Grammatica pag. 71-73: infinito, participio, gerundio, 6 giochi). San Martino ha il campo `testo` con la poesia intera.
    - Ancora da fare: ed. civica Unione Europea (foto del quaderno), scheda di matematica (rimandata), punti 1-7 della ripartenza (cavallo al contrario, POLEIS, guida in verticale, suoni, piano compiti, notifica foto, home divisa).
  - 15/11 (GINNYLEARN 11): v11 (sw `app-v11`, contenuti v7 invariati), pubblicata su GitHub con l'ok di Daniele. **APK guscio** (`android/` + workflow), **progressi online** (`/progressi` nel Worker), **notifiche native**, **foto inviata**. Da fare da Daniele: incollare il nuovo `ponte/worker.js` su Cloudflare; aggiungere i Secret `KEYSTORE_B64` e `KEYSTORE_PASS` su GitHub e rilanciare il workflow; installare l'APK seguendo "APK guscio".
  - 16/11 (GINNYLEARN 12): v12 (sw `app-v12`, contenuti v7 invariati). **Avvisi nell'app Claude** (registro `/eventi` nel Worker + attività programmata). Tolti "Per i genitori" e "Classifica con le amiche". Home: etichetta col nome in alto a destra, più piccola (non copre più "N nuovi"); stellina centrata nel cerchio giallo. Zaino: si apre in orizzontale e blocca la rotazione finché è aperto (`GinnyApp.orientamento`, serve l'APK nuovo; in Chrome prova `screen.orientation.lock`, altrimenti scritta "Gira il tablet"). Da fare da Daniele: incollare il nuovo `ponte/worker.js` su Cloudflare; installare l'APK nuovo sopra quello vecchio.
  - 16/11 (GINNYLEARN 12, seconda parte): v13 (sw `app-v13`). L'app si ricarica da sola quando arriva una versione nuova (`controllerchange`) e controlla gli aggiornamenti a ogni ritorno in primo piano. Il Worker fa partire l'attività di Claude solo quando ci sono novità (vedi "Avvio dal Worker").
  - 17/11 (GINNYLEARN 13): v16 (sw `app-v16`). Casa: "Prossimi compiti" da domani (quelli di oggi spariscono; anche il pallino sull'icona). Diario: "Da recuperare" e "Ultimi 7 giorni", poi la sezione richiudibile "📚 COMPITI PRECEDENTI" (più vecchi di 7 giorni, per ripassare). Attività di Claude: **un solo ok** = crea i giochi e li pubblica su main (niente ramo e secondo ok); istruzioni in `ponte/istruzioni_attivita.md`, da reincollare su claude.ai/code/routines.
  - 16/11 (GINNYLEARN 13): v15 (sw `app-v15`), ponte v4 con gli **allegati dei compiti** (vedi Ponte compiti). Provato sulla pagina salvata del 16/11: 7 compiti, allegato `Compiti_5e.pdf` del compito sol-426 (inglese). Pagine: `pagineDi()` legge anche le catene "pag. 30-31-32" (prima prendeva solo 30-31). Contenuti **v8**: temi `sto-persiani` (Storia pag. 30-32, compito sol-473), `ita-discorso-diretto` (Grammatica pag. 14-15 e ripasso 139, compito sol-474), `ita-wangari` (Letture pag. 22, compito sol-428). Pubblicata con l'ok di Daniele. Da fare da Daniele: incollare il nuovo `ponte/worker.js` su Cloudflare e le istruzioni nuove di `ponte/istruzioni_attivita.md` nell'attività.
  - 16/11 (GINNYLEARN 12, terza parte): v14 (sw `app-v14`). Tolto "📒 Tutti" accanto al piano; 🎒 Zaino nella barra in basso; niente più avatar (si sceglie solo nome e guida, anche da Premi); nome lungo rimpicciolito per stare su una riga (`stringi()`, anche nelle etichette delle materie); materie con temi nuovi per prime; Premi → "🔄 Controlla adesso i compiti" scrive cosa ha trovato (anche in Chrome). Verificato il 16/11 alle 19:22: il ponte riceve da Scuola Online 5 compiti (ricerca 16/11–07/12, 5 righe), nessuno nuovo.
  - 21/11 (GINNYLEARN 14): v17 (sw `app-v17`, contenuti v11 invariati). **Niente tempo negli esercizi di calcolo**: `conTempo()` toglie la barra del tempo in tutta Matematica, nei giochi con `"tempo": false` e nelle domande con calcoli (numeri con %, ×, ÷, +, −, =, oppure "calcola", "quanto fa"); `"tempo": true` nel gioco lo rimette. Senza tempo il bonus è fisso (5). "Quiz a tempo" ora si chiama "Quiz". Nome in alto: `line-height` più alto, l'emoji non viene più tagliata. "Verifica" è un `inline-block`: non viene più barrata quando il compito è fatto. Compiti in Casa/Diario con lo stesso colore di materia del piano (`coloreMat`).
  - 21/11 (GINNYLEARN 14, seconda parte): v18 (sw `app-v18`). **Regole nuove per creare i giochi** (vedi "Regole per creare i giochi"): tutte le pagine, prima i grassetti e i concetti chiave, alcune domande sui trafiletti, niente ripetizioni tra i giochi, domande autosufficienti, immagini del libro nelle domande (`img`). Ponte: nuovo `GET /figura` (legge `figure/<idtema>/<file>` dalla repo privata), **pubblicato direttamente su Cloudflare da Claude** (connettore Cloudflare con accesso ai Workers: d'ora in poi il ponte non va più incollato a mano; aggiornare solo il contenuto con PUT `/workers/scripts/ginny-ponte/content`, così Secret, KV e cron restano).
    - **Zoom delle pagine** (libro e orario): due dita per allargare, doppio tocco, bottoni − e + in basso a destra (`zoomabile()`; la WebView dell'APK non ha lo zoom del browser).
    - Contenuti **v12**: in `sci-universo-vicino` due giochi nuovi su pag. 90 con le regole nuove: "Guarda il cielo" (quiz con 2 immagini: `via-lattea.jpg`, `andromeda.jpg` in `GinnyLearn-inbox/figure/sci-universo-vicino/`) e "Via Lattea o buco nero?" (categorie).

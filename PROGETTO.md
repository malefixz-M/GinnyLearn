# Quaderno dei giochi — documento di progetto

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
- La lista predefinita della pagina copre da oggi a +7 giorni.
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

Ogni gioco può avere un `titolo`. Per ogni tema conviene preparare 4-6 giochi di tipi diversi.

## Stato
- v1 (14/11/2026): app base con 8 tipi di gioco, grafica a tema per materia, calendario compiti, medaglie, profilo. 3 temi di esempio.
- v2 (14/11/2026): ponte compiti da Scuola Online (testato sulla pagina salvata, non ancora sul sito vero), materie extra (italiano, inglese…), collegamento automatico compito → tema. I compiti finti sono stati tolti.
- Da fare, in ordine:
  1. FATTO: repo GinnyLearn creata e primo push (15/11). Daniele deve attivare Pages (Settings → Pages → Deploy from a branch → main / root).
  2. Daniele crea il Worker `ginny-ponte` su Cloudflare, incolla `ponte/worker.js` e inserisce i Secret. Claude poi scrive l'URL in `contenuti.json` → `ponte`.
  3. Temi veri dalle foto. Urgente: verifica sui Greci lunedì 16/11 (storia, pag. 22-23 e 29).
  4. Classifica con le amiche: stesso Worker con KV/D1 al posto di Firebase.

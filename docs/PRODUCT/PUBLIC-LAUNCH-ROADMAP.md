---
title: 'Roadmap verso il pubblico — la barra, i secchi, le tappe'
doc_version: '1.0.0'
status: active
last_review: '2026-07-26'
owner: 'LucaDominici'
canonical_id: ''
tags: ['audience/maintainer', 'kind/plan']
related: ['docs/PRODUCT/PRD.md', 'ROADMAP.md']
---

# Roadmap verso il pubblico

> **Destinazione superata il 2026-07-26 — le misure no.** Tutto ciò che questo documento
> misura resta valido e non è stato rifatto; è la meta che è cambiata. Il pubblico è fuori
> sequenza: la persona _primaria_ del PRD è già l'owner, e la promessa che il PRD le fa
> (`arbiter update` sicuro) è misurata falsa qui sotto in §1.3. Il confine attivo, con la
> definizione di finito e i secchi ripartiti, è **`docs/PRODUCT/CONFINE.md`**. Leggi quello
> per sapere cosa si fa; leggi questo per sapere cosa è stato misurato e come.

> Questo documento nasce da una misura, non da un'opinione. Ogni affermazione qui dentro
> ha il comando che la sostiene. Dove non ce l'ha, è scritto che non ce l'ha.
>
> Stato di partenza, verificato: **`@arbiter/cli` non è pubblicato** (`npm view @arbiter/cli`
> → `E404`). Non c'è nulla da ritirare. Il badge npm nel README punta oggi a una pagina 404.

---

## 0. Il precedente da non ripetere

`forma` è stato pubblicato su npm e poi si è scoperto che su un progetto Go reale produceva
44 nodi e **zero archi**, che i container mostravano il nome del linguaggio come descrizione,
e che ogni repo appariva completo al 100%. Sul repo di forma stesso funzionava benissimo.

**Il dogfood nascondeva esattamente i difetti che si vedevano altrove.**

arbiter ha la stessa struttura — si governa da sé — quindi può mentirsi allo stesso modo.
La domanda di questo documento non è _"arbiter funziona?"_. È **"arbiter funziona su un
progetto che non è arbiter?"**.

---

## 1. La verifica anti-figuraccia — risultati

Metodo: **`npm pack` → install isolata → si usa quel binario**, mai `node dist/cli.js`. Il
meccanismo di forma era artefatto-pubblicato ≠ albero-di-lavoro; lo `build` di arbiter copia
a mano cinque alberi di asset (`templates`, `i18n`, `compatibility`, `generators`, `kit`) e
`files:` spedisce solo `dist`. È il posto dove un asset mancante si nasconde.

Nove repo bersaglio, tre classi. Cloni usa-e-getta con `origin` rimosso: nessun repo governato
vivo è stato toccato.

### 1.1 `arbiter init` — cosa esce

| repo                       | classe           | `init` | file          | primo `check-all.mjs L1` |
| -------------------------- | ---------------- | ------ | ------------- | ------------------------ |
| arbiter stesso             | dogfood          | —      | —             | **verde**                |
| `empty` (solo `git init`)  | greenfield       | exit 0 | 216           | **rosso — 2**            |
| `onefile` (un `README.md`) | greenfield       | exit 0 | 216           | **rosso — 2**            |
| `go-bare`                  | sintetico        | exit 0 | 221           | verde                    |
| `py-bare`                  | sintetico        | exit 0 | 223           | verde                    |
| `rs-bare`                  | sintetico        | exit 0 | 224           | verde                    |
| `charmbracelet/bubbletea`  | **Go reale**     | exit 0 | 219 (+2 skip) | **rosso — 2**            |
| `pallets/click`            | **Python reale** | exit 0 | 222 (+1 skip) | **rosso — 8**            |

**I fixture sintetici passano. I progetti veri no.** È la forma esatta del difetto che
interessa. → **#2134**, **#2132**.

Sul greenfield il difetto non è che la gate fallisca — fallire chiuso su una configurazione
incompleta è giusto. Il difetto è che `init` **stampa** `Language: unknown (no markers found)`,
poi dichiara `Done! 216 files created`, poi suggerisce `Run: node scripts/check-all.mjs L1`
sapendo che uscirà `[NAMING] ERROR: no naming convention configured for language "unknown".
Gate cannot run.` Sa e non avvisa.

### 1.2 La gate generata può fallire? Sì.

Su `go-bare`, tre iniezioni, tre rossi:

| iniezione                       | esito                                |
| ------------------------------- | ------------------------------------ |
| sorgente Go non formattato      | `fmt (gofmt) FAIL` → gate exit **1** |
| test che fallisce               | gate exit **1**                      |
| chiave AWS in un file tracciato | gate exit **1**                      |

Questa parte del prodotto funziona. Su un repo Go pulito L1 esegue **42 check in 2,3 s**,
40 PASS e 2 SKIP motivati.

### 1.3 `arbiter update` non distrugge nulla? **No. Ed è peggio di come è scritto nella moratoria.**

L'adozione della gate spine è **default-on**: `--no-adopt-gate-spine` serve a _disattivarla_.
Quindi la distruzione non richiede `--adopt`: la produce un `arbiter update` nudo.

Su un clone usa-e-getta del **consumer Go governato**, invariante misurato = l'insieme dei nomi passati a
`runCheck`/`runWarnCheck`:

| comando                                | check prima | check dopo | `scripts/check-all.mjs` |
| -------------------------------------- | ----------- | ---------- | ----------------------- |
| `arbiter update`                       | 75          | **67**     | riscritto (+447 / −342) |
| `arbiter update --no-adopt-gate-spine` | 75          | **75**     | **non toccato**         |

Stesso ramo `Governance/axis change detected — full regeneration` in entrambi i run:
l'attribuzione è **causale**, è l'adozione della gate spine, non la rigenerazione.

Normalizzando i nomi (per non contare i rinomini): **24 check di progetto cancellati**, di cui
**12 di sicurezza** — `action pins`, `caddy auth bypass`, `container hardening`,
`cookie hardening`, `crypto primitives`, `deploy image pins`, `distroless runtime`,
`error disclosure`, `race gate`, `sqli regression`, `suppression justification`,
`workflow hardening` — più l'intera corsia frontend.

**Conseguenza operativa immediata**, già scritta su #2119: la moratoria va riformulata. Non
"non lanciare `--adopt`" — che oggi lascia credere che un `update` nudo sia sicuro — ma
**"lanciare solo `arbiter update --no-adopt-gate-spine` finché #2119 non è chiusa"**.

### 1.4 Le skill e gli hook emessi sono vivi o inerti?

Sonda a due passate. **BARE** = il repo come `init` lo lascia (branch `main`, nessuno stato di
task). **PRIMED** = branch `task/#1-probe` + `.claude/.task/status.json` in fase `green` + un
piano. Un hook vivo solo in PRIMED è un hook che non fa nulla finché l'utente non compie una
cerimonia che nessuno gli ha spiegato. Sorgente completo della sonda: **#2135**.

Tre modi di essere morti, tutti e tre osservati:
**DEAD** (emesso ma assente da `HANDLERS`) · **UNROUTED** (evento non collegato in
`settings.json`) · **INERT** (dispacciato ma la condizione di blocco non può scattare qui).

| repo                  | emessi | DEAD  | blocca BARE | blocca PRIMED | vivo solo via `.ts` |
| --------------------- | ------ | ----- | ----------- | ------------- | ------------------- |
| go-bare               | 23     | 2     | 10          | 12            | 2                   |
| py-bare               | 23     | 2     | 10          | 12            | 2                   |
| empty                 | 22     | 2     | 10          | 12            | —                   |
| bubbletea (Go reale)  | 23     | 2     | 10          | 12            | 2                   |
| click (Python reale)  | 23     | 2     | 10          | 12            | 2                   |
| consumer Go governato | 26     | **3** | 10          | 12            | 2                   |
| consumer TS governato | 23     | 1     | **4**       | **6**         | —                   |

Tre reperti distinti:

**a) Due hook morti su ogni init** — `pre-spawn-worktree-guard.mjs` e `stop-finding-loss.mjs`
sono scritti, non sono in `HANDLERS`, non vengono mai chiamati. Il primo ha un `process.exit(2)`
alla riga 98: è scritto per bloccare, ed è inutile. → **#2129**

**b) Due hook strutturalmente morti fuori da TypeScript** —
`check-no-orphan-todo.mjs:13` e `check-no-placeholders.mjs:11` hanno
`EXTENSIONS = new Set(['.ts','.tsx','.mjs','.js'])` cablato. Su Go, Python, Rust e Java escono
0 su ogni file sorgente del progetto, mentre `AGENTS.md` generato per quel repo dichiara
INV-21 attivo. Il template sa già fare la cosa giusta altrove: `post-edit-dispatch.mjs` viene
reso con `SOURCE_EXTS = [".go"]`. → **#2130**

**c) Consumer TS governato: la guardia dei comandi pericolosi è doppiamente morta.**
`.claude/hooks/stop-dangerous.mjs` è la versione **pre-#1565**: legge
`process.env.CLAUDE_TOOL_INPUT_COMMAND`, che Claude Code non imposta mai, ed esce **1** invece
di **2**. Il commento del template corrente dice testualmente che _"any other non-zero exit
(incl. 1) is non-blocking — the dangerous command would run anyway"_. Canale d'ingresso
sbagliato **e** codice d'uscita non bloccante. La correzione è nel template da mesi e non è
mai arrivata, perché `skipIfExists` congela i file localmente divergenti.

E qui sta il nodo: **la cura c'è già.** `arbiter update --no-adopt-gate-spine` su <consumer-TS>
ripara `stop-dangerous.mjs` (`resolveToolInputCommand` presente, `process.exit(2)`) e lascia
la gate del progetto **intatta a 53 check**. Nessuno la usa perché non è il default e non è
documentata come la via sicura.

### 1.5 Il reperto peggiore: il flusso di punta è impossibile nel repo che arbiter appena configura

Il README vende tre primitivi, e il primo è l'evidenza. Il Quickstart, passo 3: _"Write a
failing test first, then record it: `arbiter task record-red --test-path <file>`."_

`record-red` ha bisogno di un **commit** che contenga il test rosso. Ma il pre-commit hook che
`arbiter init` ha appena armato — annunciandolo: _"Git hooks activated (core.hooksPath →
.githooks) — the gate now guards every commit and push"_ — esegue la gate L1 completa e
rifiuta qualunque commit i cui test falliscano.

```
git commit -m "test(#1): red — feature not implemented"
=== FAILED: 1 check(s) ===
Failed checks:
- unit tests
exit 1        # il commit non atterra
```

**Il flusso di punta del prodotto è strutturalmente impossibile in un repo appena
inizializzato, seguendo il README alla lettera.** Non era mai emerso perché arbiter su se
stesso lavora in worktree dove quell'hook non gira: **il dogfood è esente dalla trappola che
il prodotto installa a tutti gli altri.** → **#2051**

### 1.6 Meccanica di pubblicazione

| verifica                                                                             | esito                                                                                                                                       |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm view @arbiter/cli`                                                              | **E404** — non pubblicato, niente da ritirare                                                                                               |
| `npm i --engine-strict <tarball>` su npm 11.16.0                                     | **exit 1**, `EBADENGINE`, `Required: npm >=10.0.0 <11.0.0` → **#2128**                                                                      |
| `npm i <tarball>` senza engine-strict                                                | riesce, ma stampa `npm warn EBADENGINE` a ogni utente                                                                                       |
| `prepare: git config core.hooksPath .githooks` dirotta la hooksPath del consumatore? | **no** per un tarball — misurato, `.husky` invariato. Ma npm 11 lo espone a **ogni** installatore con un avviso `allow-scripts` → **#2133** |

---

## 2. I quattro secchi

66 issue esaminate (58 aperte all'inizio + 8 aperte da questa verifica). Discriminante unico e
verificabile:

> **BLOCCA IL PUBBLICO se e solo se il difetto è stato riprodotto su un repo che non è
> arbiter, oppure rende falsa un'affermazione di prima pagina del README, oppure impedisce
> l'installazione.**

Tutto il resto è DOPO, salvo l'obsoleto (MAI) e ciò che richiede davvero il proprietario
(DECISIONE OWNER).

### 2.1 BLOCCA IL PUBBLICO — 20 · milestone `v0.6`

**P0 (12)**

| #        | cosa                                                                                                                         | misura                                  |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| **2119** | `arbiter update` nudo cancella 24 check di progetto, 12 di sicurezza                                                         | 75→67 sul consumer Go governato         |
| **2051** | un commit RED genuino è impossibile nel repo che `init` appena configura                                                     | exit 1, commit non atterrato            |
| **2128** | `engines.npm <11.0.0` → install impossibile con `engine-strict`                                                              | exit 1 su npm 11.16.0                   |
| **2131** | `--solo` mette su `main`, `stop-evidence-guard` esce 0 su `main`                                                             | exit 0 vs exit 2 su `task/`             |
| **2135** | **la barra** — matrice anti-figuraccia eseguibile                                                                            | vedi §3                                 |
| **2122** | il gate TDD legge solo lo scope del commit → vacuo                                                                           | shipped in `check-tdd-evidence.mjs.ejs` |
| **2116** | l'evidenza controlla l'esistenza dell'oggetto, non la raggiungibilità                                                        | `git cat-file -e`                       |
| **2054** | l'evidenza è falsificabile via Bash, la deny-list copre solo Edit/Write                                                      | —                                       |
| **2121** | `update` cancella l'entry hook locale per basename: perde `$CLAUDE_PROJECT_DIR` e le virgolette                              | misurato su un consumer governato       |
| **2137** | monorepo pnpm/Astro reale: `init` esce 1 **dopo** aver scritto 233 file, rileva `npm`, assegna `library`, prima gate 8 rossi | `withastro/starlight`                   |
| **2138** | cosign/SLSA/SBOM firmano un artefatto **diverso** da quello che npm pubblica; `workflow_dispatch` raggiunge `npm publish`    | letto nel codice, non eseguito          |
| **2139** | nessun test importa i 4 sottopercorsi pubblici **dal pacchetto installato** — solo il bin                                    | `__tests__/public-api.test.ts:1`        |

**P1 (8)** — #2130 (hook morti fuori da TS) · #2134 (prima gate rossa sui repo veri) ·
#2129 (2 hook mai dispacciati) · #2127 (stato di task stale blocca ogni Edit/Write) ·
#2132 (`init` dichiara Done! e suggerisce un comando che sa fallire) · #2133 (40 script di
sviluppo pubblicati, incluso `prepare`) · #2100 (gitleaks non gira mai, in silenzio, nel
template nightly) · #2031 (l'anti-proforma ha 3 classi di falso positivo: 19 su 19 erano falsi)
· #2123 (due gate L2 completi per ogni push, template condiviso).

**#2126 non è più qui**: era un alert di bot senza diagnosi, e un alert senza verdetto non è un
difetto accertato. Spostato in `v0.7` con il criterio "diagnosticare o chiudere". Contare
l'ignoranza come blocco gonfia il numero e basta.

### 2.2 DOPO — 37 · milestone `v0.7` (15) e `Post-1.0` (22)

`v0.7 — Prima impressione` raccoglie ciò che è visibile al consumatore ma non è una bugia:
#2125, #2111, #2110, #2102, #2044, #2043, #2041, #2036, #2035, #2022, #2016, #2011, #2012,
#1887, #2077.

`Post-1.0` raccoglie ciò che riguarda il processo interno di arbiter, non il prodotto:
#2118, #2113, #2112, #2103, #2098, #2085, #2032, #2023, #2020, #2018, #2017, #2014, #2013,
#2010, #2009, #2007, #1999, #1991, #1943, #1924, #1923, #1922.

Dipendenze da rispettare, altrimenti si fa danno:

- **#2007** (accendere `--enforce` sull'anti-proforma) **dopo #2031**: forzare uno scanner
  sbagliato al 100% sui casi reali peggiora le cose.
- **#2077** (rigenerare i due consumer governati) **dopo #2119**: oggi rigenerarli significa
  cancellargli la gate.

### 2.3 MAI — 4, chiuse con motivo

| #         | motivo                                                                                                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#2000** | ancora di un run di 48h finito; il suo ultimo commento dichiara `CHIUSURA SESSIONE COMPLETA`. Il lavoro nato lì vive nelle singole issue.                                                     |
| **#1770** | epic di rilascio con **zero figli aperti** e checklist stale (T3/T10 `[ ]` ma fatti). Il residuo sono due azioni umane, ora rappresentate dai milestone `v1.0` e da #2053.                    |
| **#1491** | duplicato più vecchio di #1770. Un solo figlio numerato, chiuso. Checklist attivamente fuorviante: B4 è passato per più giri verificato→riaperto→richiuso senza che le caselle lo riflettano. |
| **#2099** | alert di bot già diagnosticato nella issue stessa come flake da saturazione runner ("safe to close"). Il residuo osservabilità vive nello stesso file di #2123.                               |

### 2.4 DECISIONE OWNER — 6 · milestone `Icebox`

| #         | la domanda                                                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **#2107** | la decisione registrata dice "rifiutare l'auto-adozione di `check-all.mjs`". Il codice spedito fa **il contrario**, di default. Quale delle due vince? |
| **#2038** | trasposizione di una metodologia da un repo di riferimento interno, ~60 feature. Prima del pubblico, dopo, o mai?                                      |
| **#2034** | il progetto come autore del proprio catalogo di invarianti. Stessa domanda.                                                                            |
| **#2039** | il comando `method` proposto, nuova superficie TUI. Si aggiunge superficie prima di aver stabilizzato quella che c'è?                                  |
| **#2053** | smarcare `docs/internal/` dal gitignore prima di rendere pubblico il repo espone i documenti interni. Si fa?                                           |
| **#2094** | motore di gating selettivo — PR #2095 è in conflitto e non fu sviluppata test-first: fa parte della decisione già aperta su #2101/#2095.               |

**Fuori dai secchi, ma è una decisione:** i 15 label `human-gated` erano **letti da zero
codice** (zero hit in `src/`, `scripts/`, `.github/`). Stessa cosa per `auto-ok`. Non gatavano
niente: erano cerimonia che dava la sensazione di un controllo inesistente. Il label è stato
rimosso da tutte le issue e marcato deprecato; le 15 issue sono state riclassificate per
contenuto.

### 2.5 Riepilogo numerico

| secchio            | numero | dove                                              |
| ------------------ | ------ | ------------------------------------------------- |
| BLOCCA IL PUBBLICO | **20** | milestone `v0.6 — Blocca il pubblico`             |
| DOPO               | **38** | `v0.7 — Prima impressione` (16) + `Post-1.0` (22) |
| MAI                | **4**  | chiuse con motivo, 2026-07-26                     |
| DECISIONE OWNER    | **6**  | milestone `Icebox — decisione owner`              |
| la barra           | **1**  | milestone `v1.0 — Public launch` (#2135)          |
| **totale**         | **69** | 65 aperte + 4 chiuse                              |

`#2135` è contata **una volta sola**, nella riga "la barra": è la condizione d'uscita, non un
ventunesimo difetto.

---

## 3. La barra per il pubblico

**Non è un'opinione su quando arbiter è pronto: è un comando che esce 0 o esce 1.**
Definizione completa e sorgente della sonda: **#2135**, milestone `v1.0`.

Cinque asserzioni, su **undici** repo, dal **tarball impacchettato**:

1. **`init` non mente.** `arbiter init --yes` esce 0 **e** il comando che stampa subito dopo
   esce 0 — oppure `init` ha avvisato, prima di dichiarare `Done!`, di quali check falliranno
   e perché. E se dice "aborted", **non ha scritto nulla** (#2137).
2. **La gate può fallire.** Iniettando una violazione, `check-all.mjs L1` esce 1.
3. **Nessun hook morto o inerte.** Per ogni hook emesso: o è dispacciato e blocca sull'input su
   cui dichiara di bloccare, o è dichiarato `ADVISORY` con la giustificazione scritta accanto.
   Zero DEAD, zero UNROUTED, zero INERT non giustificati.
4. **Il pacchetto mantiene le promesse del suo `exports`.** Ognuno dei quattro sottopercorsi
   dichiarati è importabile **dal tarball installato**, e il test è derivato da
   `package.json#exports`, non scritto a mano (#2139).
5. **L'artefatto firmato è l'artefatto pubblicato.** Lo sha256 di ciò che cosign firma coincide
   con quello del tarball che finisce su npm (#2138).

La matrice **minima** cresce da nove a undici righe — le due aggiunte sono quelle che la
challenge ha dimostrato mancanti:

- **un JS/TS brownfield reale non governato con pnpm/workspace** (`withastro/starlight` è
  quello su cui il difetto è stato misurato: #2137);
- **almeno un archetipo diverso da `library`.** Tutti e nove i repo della matrice originale si
  sono risolti in `archetype: library`: gli altri cinque archetipi avevano copertura **zero**.

I repo OSS reali restano la parte non negoziabile: sono la sola classe che il dogfood non può
imitare. Sono pinnati a uno SHA.

Condizione d'ingresso a `v1.0 — Public launch`: **milestone `v0.6` vuoto E il workflow della
barra verde su tutte e undici le righe.** Nient'altro.

---

## 4. Le tappe

| tappa                         | contenuto                                       | condizione d'uscita                                        |
| ----------------------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| **v0.6 — Blocca il pubblico** | i 20 difetti riprodotti fuori da arbiter        | milestone vuoto                                            |
| **v0.7 — Prima impressione**  | 16 · brownfield, onboarding, drift              | prima gate verde su 5 repo OSS veri, non 2                 |
| **v1.0 — Public launch**      | `npm publish` + repo pubblico                   | barra #2135 verde in CI, e **richiesta** prima del publish |
| **Post-1.0**                  | 22 · processo interno, promozioni CANON, debito | —                                                          |
| **Icebox**                    | 6 · decisioni del proprietario                  | nessun lavoro finché non sono prese                        |

**Ordine forzato dentro v0.6:** #2135 (la barra) va costruita **per prima**, non per ultima.
Senza, non c'è modo di sapere quando v0.6 è finito, e — come dimostra questo stesso documento —
costruirla trova altri difetti.

### Stima per la prima tappa

Due metodi, perché uno solo non è una stima.

**Per sforzo**, sommando le voci: 3 × XS (0,1–0,2 g) + 8 × S (0,3–0,5 g) + 6 × M (1–1,5 g) +
2 × L (#2119 e #2137) + #2135 ≈ **17–20 giorni-uomo**.

**Per portata osservata**, dai dati del repo:
`gh pr list --state merged --limit 60` → ciclo mediano di una PR **0,7 h**, churn mediano
**355 righe**, e **4–5 PR mergiate al giorno** sostenute sugli ultimi 14 giorni (escludendo un
giorno anomalo da 20). 20 issue ≈ 22–26 PR ≈ **5–6,5 giorni**.

I due numeri divergono perché il primo misura sforzo e il secondo conta PR, comprese le
banali. La stima onesta è la forchetta, con la varianza dichiarata:

> **17–22 giorni-uomo per v0.6**, più il **20–40 %** che la barra troverà quando gira davvero.

**La prima versione di questo documento diceva 10–14 giorni. Era ottimista, e la challenge lo
ha dimostrato voce per voce** — vedi §6.

La maggiorazione non è prudenza generica: questa verifica ha aperto **12 blocchi nuovi in
mezza giornata** misurando 10 repo a mano. Un workflow che li rimisura a ogni push su una
matrice pinnata ne troverà altri — è il suo scopo.

Quattro voci concentrano la varianza e vanno affrontate per prime dopo la barra:

- **#2119** — non è una regex. L'invariante deve essere un'impronta strutturale
  `{livello, tipo di chiamata, nome, comando, argomenti, softness, condizione}` più esistenza e
  hash degli script, più i check inline via `pushResult`, più un test a iniezione di guasto.
- **#2137** — non è un fix: rilevamento del package manager, del framework alla radice, del
  workspace, dell'archetipo e la semantica dell'abort sono sistemi separati.
- **#2051** — la via d'uscita per il RED non può diventare un `--no-verify` generico.
- **#2138** — l'identità dell'artefatto tocca il workflow di rilascio **e** il suo template
  gemello, e va dimostrata con una verifica cosign reale, non con un test di stringa.

---

## 5. Cosa resta scoperto, dichiarato

Onestà sulle lacune di questa stessa verifica:

- **Nessun repo Java o Kotlin** è stato provato, benché `--language` li dichiari supportati.
  un repo Java governato esiste, ma ha una gate propria (`scripts/gates/`) e una sessione
  attiva: non l'ho toccato. **È la lacuna più grande della matrice.**
- **Nessun repo multi-linguaggio** (`language: multi`) è stato provato.
- **Nessun repo Windows o macOS.** Tutto misurato su Linux, Node 22.21.1, npm 11.16.0.
- **`arbiter ship`, `arbiter task`, `arbiter gold-audit`** non sono stati esercitati end-to-end
  su un repo bersaglio. La barra copre `init`, `update`, la gate e gli hook. Non copre
  l'orchestrazione.
- `npm i` da **git URL** (dove `prepare` _verrebbe_ eseguito) non è stato provato: #2133 lo
  dichiara esplicitamente come non misurato.
- **Il workflow di rilascio non è mai stato eseguito.** #2138 è letto nel codice, non misurato.
- **Nessun repo con GitHub Actions realmente eseguite**: tutti i cloni avevano `origin`
  rimosso, e `init --yes` non attiva le chiamate GitHub senza `--github`/`ARBITER_GITHUB=1`.
  Provisioning di label, branch protection, merge settings e project board hanno copertura
  end-to-end **zero**.

---

## 6. Cosa la challenge ha demolito

Prima di consegnare, la roadmap è passata sotto una review avversariale di Codex in sola
lettura, con due domande specifiche: _quale classe di repo manca dalla matrice_ e _l'attribuzione
causale dei 24 check persi regge, dato che entrambi i run loggavano "full regeneration"_.

Ha demolito quattro cose. Tre le ho rimisurate; una l'ha vinta il documento.

**1. La matrice aveva un buco che non avevo dichiarato — e ha prodotto subito il peggior
risultato di tutti.** Codex ha predetto: manca un JS/TS brownfield reale non governato, con
pnpm o workspace. Misurato su `withastro/starlight`: `init` esce **1 dopo aver scritto 233
file** e aver ripuntato `core.hooksPath`, rileva `Build: npm` su un repo pnpm dando come
rimedio "aggiorna npm", assegna `archetype: library` a un'app Astro (quindi zero corsia
frontend), e la prima gate ha **8 rossi**. → #2137. Corollario che mi era sfuggito: **tutti e
nove** i repo della matrice si erano risolti in `archetype: library`; cinque archetipi su sei
avevano copertura zero.

**2. `--no-adopt-gate-spine` non è "la via sicura", è un laccio emostatico.** Misurato dopo il
suo uso su un consumer governato:

```
[safety-adopt-ratchet] 2 protected file(s) are withheld: scripts/check-all.mjs, scripts/lib/glob-walk.mjs
  Erosion detected: ... Run `arbiter update` ... to re-adopt it
exit 1
```

**Il gate va rosso e prescrive il comando che cancella la gate.** Il ciclo è chiuso, e va
scritto nella moratoria: è uno stato dichiarato e datato, non uno stato stabile.

**3. L'invariante che ho misurato dimostra la perdita ma non basta a impedirla.** L'insieme dei
nomi `runCheck` non vede: il passaggio da bloccante ad avvisatorio, `{soft: graceActive}`,
comando/argomenti/timeout, lo spostamento in un livello che non gira, i check inline via
`pushResult` (fra cui gofmt e il gate dell'evidenza), uno script reso vacuo a nome invariato, e
uno script mancante dietro `existsSync`. Il criterio di accettazione di #2119 è stato riscritto
di conseguenza, e la stima di 2 giorni ritirata.

**4. Due bloccanti che non erano in nessun secchio.** L'identità dell'artefatto di rilascio —
cosign firma uno zip di `dist/`, npm pubblica un tarball ricostruito da `prepack`: **firma e
pacchetto sono artefatti diversi**, e lo stesso difetto è nel template spedito ai consumer
(#2138). E nessun test importa i quattro sottopercorsi dichiarati in `exports` **dal pacchetto
installato**: solo il bin è provato, mentre `build` copia a mano cinque alberi di asset — la
classe artefatto-pubblicato ≠ albero-di-lavoro, cioè forma (#2139).

**Cosa non ha vinto.** Codex ha sostenuto che la vera terza variabile è la provenienza del
manifest, e che `--no-adopt-gate-spine` proteggerebbe solo uno spine già divergente. Testato
cancellando il manifest: il flag tiene comunque (75 → 75, file non toccato). E il caso "hash
pristino" è vero nella meccanica ma vacuo nel danno: un file il cui hash combacia con quello
registrato **è** l'output del template, quindi non ha check di progetto da perdere.

**Il conteggio.** Codex ha anche contato: _"P0 ha nove voci, P1 dice nove e ne elenca dieci, e
il totale conta #2135 due volte. L'inventario non sa contare se stesso."_ Aveva ragione su
tutti e tre. Corretto in §2.1 e §2.5, e **#2126 è uscita dai bloccanti**: era un alert di bot
senza diagnosi, e contare l'ignoranza come blocco gonfia il numero e basta.

---

_Ultimo aggiornamento: 2026-07-26. Misure eseguite con `@arbiter/cli@0.5.0` impacchettato
(`npm pack`, shasum `784e2810`), su cloni usa-e-getta con `origin` rimosso._

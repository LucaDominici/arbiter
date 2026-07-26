---
title: 'Il confine — arbiter è affidabile sui tre consumer reali'
doc_version: '1.0.0'
status: active
last_review: '2026-07-26'
owner: 'LucaDominici'
canonical_id: ''
tags: ['audience/maintainer', 'kind/plan']
related: ['docs/PRODUCT/PUBLIC-LAUNCH-ROADMAP.md', 'docs/PRODUCT/PRD.md']
---

# Il confine

> `PUBLIC-LAUNCH-ROADMAP.md` ha misurato bene e ha puntato al posto sbagliato. **Le misure
> restano valide, la destinazione cambia.** Questo documento tira la riga: cosa sta dentro,
> cosa sta fuori, e quando è finito.

**Stadio oggi: 2 (in uso).** Tre consumer governati, uso quotidiano reale.
**Stadio obiettivo: 2 solido — affidabile sui tre consumer.** Non 3, non 4.

---

## 1. Perché non il pubblico, adesso

Tre fatti misurati, non tre opinioni.

### 1.1 La persona primaria del PRD è già Luca — e la promessa che le fa è falsa

`docs/PRODUCT/PRD.md`, §Target Users, **Primary**:

> _"Solo developer with multiple repos. A developer maintaining 3-10 repos who uses Claude Code
> or Codex daily. **They care about idempotency — running `arbiter update` should be safe.**"_

Luca ha cinque prodotti, tre governati, e usa Claude Code e Codex ogni giorno. **È lui la
persona primaria.** Il pubblico è la persona _secondaria_ dello stesso documento.

E la promessa numero uno a quella persona è misurata falsa:

```
arbiter update                      → 75 check → 67   (24 cancellati, 12 di sicurezza)
arbiter update --no-adopt-gate-spine → 75 check → 75   (file non toccato)
```

→ #2119, **chiusa**: il default è ora trattenere la gate spine, `--adopt-gate-spine` è l'opt-in
esplicito e distruttivo, e `--no-adopt-gate-spine` resta accettato come no-op. La misura qui
sopra è evidenza datata di com'era, non un'istruzione. Il tappo del tubo si è ristretto ma non
è saltato: la **classe governance** (`.claude/settings.json`, `AGENTS.md`) è ancora adottata di
default senza flag di opt-out, quindi un `arbiter update` nudo su un consumer governato va
ancora concordato — issue separata.

### 1.2 Il canale di distribuzione che Luca usa non è npm

```
$ readlink -f $(which arbiter)
/home/luca/work/repos/arbiter/dist/cli.js
$ npm ls -g --depth=0 | grep arbiter
└── @arbiter/cli@0.5.0 -> ./../../../../../work/repos/arbiter
```

`npm link` sull'albero di lavoro. I tre consumer non prendono arbiter da un registro e non lo
prenderanno dopo la pubblicazione. **`npm publish` non cambia nulla per gli utenti che
esistono.** Cambia solo per quelli che non esistono.

Corollario diretto: sette dei venti bloccanti di `v0.6` — engines, script pubblicati, identità
dell'artefatto firmato, sottopercorsi di `exports` dal tarball — sono difetti reali di un canale
che nessuno percorre.

### 1.3 Il pubblico non compra la cosa che serve

L'unica cosa che la pubblicazione porterebbe davvero è **occhi esterni che trovano difetti**.
Luca ce li ha già, e hanno appena funzionato: la verifica anti-figuraccia ha prodotto **12
bloccanti nuovi in mezza giornata** e la challenge di Codex ne ha demoliti altri quattro punti.
Il problema non è trovarne: è che negli ultimi 14 giorni su questo repo sono state **aperte 137
issue e chiuse 95** — il backlog è quasi triplicato. Aggiungere una platea a un imbuto già
saturo peggiora esattamente la metrica che fa male.

### 1.4 Quanto costa il pubblico, contro cosa rende

| voce                                                                                | costo                                      |
| ----------------------------------------------------------------------------------- | ------------------------------------------ |
| gli 8 bloccanti solo-estranei (§3)                                                  | ~5–8 g-u (di cui #2137 e #2138 sono due L) |
| la barra a 11 righe invece che a 3 (repo OSS pinnati, 6 archetipi, tarball in CI)   | ~2–4 g-u in più                            |
| Java/Kotlin, `multi`, Windows, macOS — copertura **zero** dichiarata (roadmap §5)   | **non stimato, non stimabile oggi**        |
| `ship` / `task` / `gold-audit` end-to-end — copertura **zero** dichiarata           | **non stimato**                            |
| provisioning GitHub (label, branch protection, merge settings) — copertura **zero** | **non stimato**                            |
| manutenzione perpetua: semver, deprecazioni, issue di sconosciuti, docs in inglese  | ricorrente, a carico di una persona sola   |

| ritorno                          | valore misurato                             |
| -------------------------------- | ------------------------------------------- |
| utenti oggi                      | **0**                                       |
| ricavo                           | **0**                                       |
| obiettivo di business dichiarato | **nessuno** oltre alla vision statement     |
| difetti trovati da estranei      | 0 — quelli trovati finora li ha trovati lui |

**Le tre righe "non stimato" sono la risposta.** Non è che il pubblico costi troppo: è che non
se ne conosce il prezzo, e tre delle voci ignote riguardano un linguaggio (Java) che è già la
lingua di un consumer vivo. Impegnarsi su una data è impegnarsi su un numero che nessuno ha.

**Il fatto che pesa di più**, e che va detto per intero: la roadmap dichiara _"nessun repo Java
o Kotlin è stato provato — è la lacuna più grande della matrice"_.
Il manifest del **consumer Java governato** dice `"language": "java"`. La lacuna più grande della verifica anti-figuraccia **è un consumer che
esiste già**. Il pubblico non è il passo successivo: è il passo che salta quello attuale.

### 1.5 Cosa NON sto dicendo

Non sto dicendo che il pubblico sia sbagliato. Sto dicendo che è **fuori sequenza**. Dodici dei
venti bloccanti si pagano comunque, perché fanno male oggi sui repo di Luca. Farli non allontana
lo stadio 3: lo prepara, e lo prepara con la sola classe di prova che il dogfood non può imitare
— tre repo veri, tre linguaggi diversi, uno dei quali arbiter non ha mai davvero provato.

---

## 2. La definizione di finito

Una frase, un codice d'uscita, due persone che la valutano allo stesso modo:

> **Su cloni usa-e-getta dei tre consumer governati — consumer Go, consumer TS,
> consumer Java — un solo comando esce 0: `arbiter update` lascia il numero di check
> propri del progetto non-decrescente, e ogni hook emesso o blocca sull'input su cui dichiara di
> bloccare, o è dichiarato `ADVISORY` con la giustificazione scritta accanto nel codice —
> zero `DEAD`, zero `UNROUTED`, zero `INERT` non giustificati.**

Perché questa e non un'altra:

- **è un comando**, non un giudizio: esce 0 o esce 1;
- **misura le due cose che oggi sono rotte** e che il consumatore paga: la consegna (§1.1) e
  l'enforcement (§4.2);
- **gira su repo veri**, tre linguaggi diversi, non su fixture sintetici — e i fixture
  sintetici sono precisamente ciò che ha passato la verifica mentre i repo veri la fallivano;
- **la sonda esiste già**: il sorgente completo è in #2135. Non va inventata, va ripuntata da
  undici repo estranei a tre consumer reali, ed è la parte che diventa più economica.

Non è finito quando "funziona". È finito quando quel comando esce 0 in CI, su tutte e tre le
righe, e resta verde a ogni push.

---

## 3. I secchi

Discriminante, unico e verificabile:

> **DENTRO se il difetto è riprodotto su un consumer governato vivo, o sul linguaggio di uno di
> essi. FUORI se serve solo a un utente che non esiste.**

### 3.1 DENTRO — 14 · milestone `v0.6 — Affidabile sui tre consumer`

| #        | cosa                                                               | prova che tocca un consumer vivo                                                                |
| -------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| **2119** | `update` nudo cancella 24 check, 12 di sicurezza                   | 75→67 su clone del consumer Go; oggi blocca **ogni** update sui tre repo                        |
| **2121** | `mergeHookEntry` cancella l'entry hook locale per basename         | misurato su consumer governato                                                                  |
| **2130** | hook `TODO`/placeholder morti fuori da TypeScript                  | riprodotto oggi sul consumer Go: `x.go → exit 0`, `x.ts → exit 2`                               |
| **2129** | hook emessi ma assenti da `HANDLERS`                               | 3 morti sul consumer Go, 1 sul consumer TS (conteggio eseguito)                                 |
| **2131** | `--solo` mette su `main`, `stop-evidence-guard` esce 0 su `main`   | il consumer Go ha già dovuto ripararlo da sé (#575 del consumer Go); il template è ancora rotto |
| **2122** | il gate TDD legge solo lo scope del commit → vacuo                 | vacuo sul consumer Go e su arbiter stesso                                                       |
| **2116** | l'evidenza controlla l'esistenza, non la raggiungibilità           | 80 evidenze su 266 puntano a commit irraggiungibili                                             |
| **2054** | l'evidenza è falsificabile via Bash (deny-list solo Edit/Write)    | la feature di punta, aggirabile                                                                 |
| **2127** | `.claude/.task/status.json` stale blocca ogni Edit/Write           | e il messaggio d'errore nomina la causa sbagliata                                               |
| **2100** | gitleaks non si installa mai: scanner di segreti muto ogni notte   | fallisce identico da ogni notte; template spedito ai consumer                                   |
| **2031** | anti-proforma: 19 rilevamenti su 19 erano falsi positivi           | blocca #2007; uno scanner sbagliato al 100% non è accendibile                                   |
| **2123** | due gate L2 completi per ogni push, template condiviso             | è lo stesso difetto di #556 del consumer Go (contesa sul runner self-hosted)                    |
| **2135** | **la barra** — ripuntata: tre consumer reali, non undici estranei  | è la definizione di finito di §2                                                                |
| **2077** | rigenerare i consumer — **allargata a tre**, consumer Java incluso | criteri riscritti; dipende da #2119                                                             |

**Ordine forzato:** #2135 per prima (senza barra non si sa quando è finito), poi #2119 (senza
consegna nessuna correzione arriva), poi il resto in parallelo, #2077 per ultima.

### 3.2 FUORI — restano aperte, non si lavorano

**8 bloccanti solo-estranei** → milestone `Se un giorno: pubblico`. Difetti veri, nessuno dei
quali tocca un consumer vivo:

#2051 (RED genuino impossibile dopo `init` — arbiter e consumer Go lavorano in worktree dove l'hook
non gira, quindi li risparmia per caso) · #2128 (`engines.npm`) · #2132 (`init` dichiara `Done!`
su linguaggio ignoto) · #2133 (40 script di sviluppo pubblicati) · #2134 (prima gate rossa su
bubbletea e click) · #2137 (monorepo pnpm/Astro: exit 1 dopo 233 file) · #2138 (cosign firma un
artefatto diverso da quello pubblicato) · #2139 (i sottopercorsi di `exports` non provati dal
tarball).

**Il resto** resta dov'è: `v0.7 — Prima impressione` (16), `Post-1.0` (21), `Icebox — decisione
owner` (6).

### 3.3 MORTE — chiuse davvero

**#2023** — chiusa oggi. La sua premessa è falsa su **entrambi** i siti che nomina, e agire su
di essa avrebbe fatto danno:

```
$ grep -c "stop-finding-loss"        .claude/hooks/hooks.mjs   → 0
$ grep -c "pre-spawn-worktree-guard" .claude/hooks/hooks.mjs   → 0
```

L'issue chiedeva di rimuovere la dicitura _"not activated"_ come residuo di drift. Ma
`stop-finding-loss.test.ts:1` dice _"IMPLEMENT-BUT-NOT-ACTIVATED"_ ed è **accurata**; è
`pre-spawn-worktree-guard.mjs:8` a dire _"ACTIVATED advisory per OD-14 … wired into
.claude/settings.json"_, ed **è quella la falsa**. Allineare le diciture come chiedeva l'issue
avrebbe cementato l'affermazione sbagliata. Il difetto vero — nessuno dei due hook è
dispacciato — è #2129, che sta dentro il confine.

**#2000, #1770, #1491, #2099** — chiuse il 2026-07-26 dalla stessa linea di triage: ancora di un
run finito, due epic di rilascio con zero figli aperti e checklist attivamente fuorvianti, un
alert di bot già auto-diagnosticato come flake.

**#2126 non è morta** — è stata diagnosticata in due minuti e sopravvive:
`gh run view 30190274960 --log-failed` → `FAIL drift detected in examples/{go,python,ts}-library/`,
tutte e tre le celle, stessa causa. Non è un flake e non è una regressione di un generatore: sono
le fixture `examples/*` committate che non sono state rigenerate. Igiene interna, nessun impatto
sui consumer → `Post-1.0`, rititolata con la causa.

---

## 4. Le due prove che hanno spostato la decisione

### 4.1 L'enforcement che il consumer Go dichiara è morto sui suoi stessi file

Il consumer Go è `"language": "go"`, e la sua regola `25-todo-folder-policy.md`, caricata a
freddo da ogni sessione, dichiara:

> _"Bare `TODO` … is a gate violation (INV-21) — Enforced by the `check-no-orphan-todo.mjs`
> post-edit hook."_

Misurato, stesso hook, stesso contenuto, due estensioni:

```
x.go  exit=0      # TODO orfano accettato
x.ts  exit=2      # TODO orfano bloccato
```

Causa: `EXTENSIONS = new Set(['.ts','.tsx','.mjs','.js'])` cablato. **La regola che il consumer Go
dichiara a ogni sessione non è applicata da nessuna parte sui suoi file.** Il template sa
già fare la cosa giusta altrove — `post-edit-dispatch.mjs` viene reso con `SOURCE_EXTS = [".go"]`
— quindi il difetto è che due hook non leggono il linguaggio del progetto, non che non si possa.
→ #2130.

### 4.2 Il consumer Java non è governato, ed è il linguaggio della lacuna più grande

```
<consumer-java>/arbiter.json   → "version": "0.2", "language": "java"
<consumer-java>/.claude/hooks/ → 6 file .mjs + lib.sh + run-hook.sh, NESSUN hooks.mjs
<consumer-java>/scripts/check-all.mjs → non esiste
```

Nessun dispatcher, nessuna gate generata, scaffolding di una generazione precedente con hook in
shell. Il terzo consumer non è "un po' indietro": è su un altro impianto. E #2077, l'unica issue
che parla di rigenerare i consumer, ne nominava **due**. È stata allargata a tre — è la ragione
per cui la definizione di finito ha tre righe e non due.

---

## 5. La stima, e come ci sono arrivato

**Sforzo, voce per voce** (le due pesanti restano dentro: #2119 è L, #2135 è la barra):

| voce                       | g-u            |
| -------------------------- | -------------- |
| #2119                      | 4–5            |
| #2135 (barra, 3 righe)     | 2–3            |
| #2077 (3 consumer)         | 1,5–3          |
| #2031                      | 1–1,5          |
| #2121, #2131, #2122, #2054 | 1 ciascuna     |
| #2130, #2116               | 0,5–1 ciascuna |
| #2129, #2127               | 0,5 ciascuna   |
| #2100, #2123               | 0,3 ciascuna   |
| **totale**                 | **15–20**      |

**Portata osservata**, dai dati del repo (`gh pr list --state merged`, PR mergiate per giorno):

```
5–11 lug:   12 14 1 13 13 12 20   → 85 PR / 7 gg  = 12,1/g   (arbiter aveva tutta la flotta)
12–26 lug:  2 3 1 1 5 5 4 0 0 5 5 9 4 3 1 → 48 PR / 15 gg = 3,2/g  (cinque prodotti in concorrenza)
```

14 issue ≈ 16–20 PR ≈ **5–6 giornate-arbiter** nel regime attuale.

**I due numeri divergono di tre volte, e la divergenza è il dato.** Lo sforzo dice 15–20; il
throughput dice 5–6 _giornate in cui arbiter ha l'attenzione_. Nel regime osservato arbiter ne
riceve una o due a settimana, perché i tre consumer e un quinto prodotto competono per la stessa
persona. Quindi:

> **15–20 giorni-uomo di sforzo · 5–6 giornate-arbiter di throughput · 3–8 settimane di
> calendario**, più il 20–40 % che la barra troverà quando gira davvero.

### La roadmap era credibile o ottimista? Entrambe, in punti diversi

- **Il numero di sforzo (17–22 g-u per 20 issue) è credibile.** Ho rifatto la somma su un
  perimetro diverso e sono arrivato a 15–20 per 14 issue: togliere sei voci dal confine fa
  risparmiare **due-quattro giorni, non la metà**, perché le due voci pesanti (#2119, #2135)
  restano dentro. La roadmap non stava gonfiando.
- **Il numero di throughput (5–6,5 giorni) è ottimista**, e si vede da dove viene: 4–5 PR/giorno
  è la media di un periodo che include il regime 12,1/giorno del 5–11 luglio, quando arbiter
  aveva la flotta intera. Da allora sono 3,2, con tre giorni a zero su quindici. Contare PR
  misura la portata di _una giornata dedicata_, non il calendario.
- **Ma l'errore che conta non è nei numeri: è nel perimetro.** `v0.6` non è il prezzo del
  pubblico. È il prezzo di **non mentire sui repo già misurati**. Il prezzo del pubblico
  aggiunge le tre righe "non stimato" di §1.4 — Java, `multi`, Windows, macOS,
  `ship`/`task`/`gold-audit` end-to-end, provisioning GitHub — che la roadmap dichiara con onestà
  in §5 e poi non mette in nessuna stima. Una tappa `v1.0` con una data accanto e sei aree a
  copertura zero non è una tappa: è un auspicio.

---

## 6. Cosa resta a Luca — quattro sì/no

1. **arbiter resta strumento personale: il pubblico si rimanda finché la barra di §2 non è
   verde sui tre consumer.** Sì / No.
2. **#2107** — la decisione registrata dice di _rifiutare_ l'auto-adozione di `check-all.mjs`;
   il codice spedito fa il contrario, di default, ed è la radice di #2119. **Vince la decisione
   registrata (l'adozione diventa opt-in esplicito)?** Sì / No.
3. **Il consumer Java governato resta governato da arbiter** — quindi va migrata dalla generazione 0.2 e conta come
   terza riga della barra? **Sì / No** (se No, la dichiaro non governata e la barra ha due
   righe).
4. **Congelo le tre epiche di nuova superficie** — #2038 (~60 feature di metodologia), #2034
   (catalogo invarianti di progetto), #2039 (la TUI "method" proposta) — finché la barra non è
   verde? Sì / No.

Nota: la decisione 1, se è **Sì**, ne dissolve un'altra da sola. #2053 chiede se smarcare
`docs/internal/` dal gitignore _prima di rendere pubblico il repo_: senza pubblicazione la
domanda non esiste più, e resta solo il difetto vero sotto — un nuovo ADR sparisce con
`git add -A` senza un avviso. Riclassificata da decisione a difetto.

---

## 7. Trovato e non aperto

Osservato durante questo lavoro, **deliberatamente non trasformato in issue** — aprirne è
esattamente il comportamento che ha fatto crescere il backlog:

- **La duplicazione di #2123 è visibile sulla PR #2136 stessa**: `Debt Ratchet`,
  `Lint + Typecheck`, `Unit Tests`, `SonarCloud`, `Tech Debt Gates`, `Security` compaiono
  ciascuno **due volte** in `gh pr checks 2136`, da due run distinti. Prova aggiuntiva su #2123,
  non un difetto nuovo.
- **Cinque milestone storici** (`M1`, `M2`, `M4`, `M5`) sono chiusi al 100 % ma ancora aperti
  come milestone. Rumore, non debito.
- **`docs/PRODUCT/PRD.md` è fermo al 2026-06-04** e dichiara `Version 0.2 (in-progress)` mentre
  il pacchetto è `0.5.0`. La persona primaria che descrive è corretta; i numeri no.
- **#2012 e #2016 sono la stessa classe di #2129/#2130** — enforcement dichiarato che non può
  scattare (`pr-size` e `drift-manifest` in SKIP permanente per config assente; `shouldReactivate`
  con 9 test e zero consumatori, `scripts/check-solo-reactivation.mjs` inesistente). Verificato,
  entrambe già tracciate, entrambe fuori confine perché riguardano arbiter su arbiter.
- **La cartella hook del consumer Java contiene `logs/`** dentro la cartella degli hook. Non indagato.

---

_2026-07-26. Le misure di `PUBLIC-LAUNCH-ROADMAP.md` restano valide e non sono state rifatte:
questo documento ne cambia la destinazione, non i numeri. Fatti nuovi qui dentro: §1.2
(`readlink -f $(which arbiter)`), §4.1 (hook su `.go` vs `.ts` sul consumer Go), §4.2 (consumer Java sulla
generazione 0.2), §5 (PR/giorno per finestra), §3.3 (#2023 e #2126)._

---
title: 'Ship redesign joint algorithm'
doc_version: '1.0.0'
status: active
last_review: '2026-09-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/internal']
related: []
---

# /ship e /drain — algoritmo congiunto Fable ⇄ Codex

Data: 2026-09-19. Metodo: analisi indipendente di Fable (scritta prima di leggere il cutover), poi due round
di contraddittorio con Codex in sandbox read-only. Questo documento emenda `ARBITER_2026_CUTOVER_PROJECT.md`
e `SHIP_RESULT_FIRST_EXECUTION_PLAN.md` (#2724); non apre un nuovo programma.

## Funzione obiettivo

min E[token + wall-clock + attenzione umana + rework]
s.t. P(difetto su main) sotto soglia · esito riprendibile · enforcement meccanico.
Un passo resta solo se `Δrischio · C_escape > costo + P(falso positivo) · C_sblocco`.

## Principio: percorso libero, confine duro — deriva, non dichiarare

Evidenza: PR #2395 = 67 commit, 26 review-loop, 8 SHA-bump, 22.7 h. bypass-log = 336, di cui 309 `SKIP_DOCS`.
30 hook (8 Pre + 13 Post per ogni edit, 24 con exit 2). `check-tdd-evidence` = 400+ righe legate a subject/trailer.
Il 2026-09-19 la spawn-guard ha bloccato due Explore read-only e lo stop-hook li ha contati come "tornati".

## Algoritmo

1. `/drain` raccoglie tutto il pending, poi apre al massimo 2 lane: N+1 parte solo con N in attesa CI
   (freeze + push + receipt locale verde) e file-set disgiunto PROVATO (inclusi generati, lockfile, contratti).
2. N ha priorità assoluta: rosso/rework su N sospende N+1, che perde ogni evidenza e va ribasata.
3. Pre-codice: brief + AC, ognuno col comando/test che lo prova; stima di costo. Nessuna assurance, nessun tier
   certificato, nessun plan challenge salvo sensibile/ambiguo.
4. Implementazione libera. Hook bloccanti solo per: comandi distruttivi, segreti/PII, scritture SSOT/read-only,
   mutazioni fuori confine. Tutto il resto advisory per-edit e duro al freeze. Nessun hook muta sorgenti.
5. Freeze: SHA, diff, caller/metodi/grafo → trattamento derivato dal candidato (può solo allargare).
   Scope verificato sul diff, non su manifest pre-dichiarato.
6. Verifier: test nuovi/modificati su base e candidato, stesso runner → receipt ASSERT/COMPILE/ERROR legata
   agli SHA. `record-red` pubblico, commit RED-first obbligato e force-add spariscono. Esegue le AC meccaniche.
7. Affinità train: `JOIN` solo su fatti (overlap o catena causale, check affetti condivisi dal
   gate-affects-registry, budget, nessun rischio sensibile indipendente); altrimenti `SEAL(reason)`. Niente pesi.
8. Preflight + affected checks sullo SHA congelato (propagazione template → esempi → bake inclusa).
9. Un reviewer indipendente sempre (0 solo docs-only/meccanico puro): input = diff + AC + esiti verifier,
   niente transcript; economy su XS/S. Review e AC-fit nello stesso ritorno; MUST FIX con riproduzione.
   Specialista solo su auth/dati/concorrenza/denaro/migrazioni/deploy.
10. Reviewer e full L2 partono in PARALLELO sullo stesso SHA, read-only. Finding e rossi → un solo fix batch;
    nuovo SHA invalida le prove; round 2 solo sul delta; massimo 2 round, poi BLOCKED.
11. Un commit di evidence, un push, CI, merge osservato in foreground, CI post-merge.
12. Stato: fase derivata da Git/PR/CI/receipt; `status.json` = `{task, acHash, treatment, round}` come guardia
    di monotonicità. Superficie agente: `arbiter ship #N` (fatti + prossima azione) e `arbiter verify`.
    Done = `MERGED` + CI post-merge verde.

## Chi ha ceduto cosa

| Punto                                 | Esito                                                                                  |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| RED dichiarato → derivato             | Codex concede; aggiunge classe ASSERT/COMPILE/ERROR e runner identico                  |
| AC-fit secondo seggio LLM             | Codex concede (AC eseguibili, un solo reviewer); Fable concede: 1 reviewer anche su XS |
| Tier pre-codice / unknown→Standard    | Codex concede il tier al freeze; resta stima di budget pre-codice per `/drain`         |
| Affinità a 8 booleani auto-dichiarati | Codex concede; Fable concede che "stessi file+metodi" non basta                        |
| Hook sul percorso                     | Codex: "l'omissione più grave" del cutover; confine resta duro                         |
| Stato dichiarato                      | Codex concede; resta lo stato minimo monotono                                          |
| Evidence in-tree                      | Fable concede (binding già corretto); un solo commit prima del push                    |
| Full L2 locale                        | Fable concede che resta; Codex concede il parallelo con la review                      |
| Lane singola in drain                 | Codex concede pipeline profondità 2 con prelazione                                     |

## Delta da portare in #2724

C1 verifier base/candidato · C5 declassamento hook per-edit ad advisory + preflight duro · C3 tier al freeze e
rimozione del blocco plan-anchor · C4 affinità derivata · C6 stato minimo e due comandi · P1/P2 in `/drain` e `/ship`.
Da NON prendere dal comparatore: enforcement in sola prosa, self-review come unico controllo, "la cerimonia
ereditata non vincola".

## Function hooks (middleware in-process, early access) — posizione

Codex li ha già valutati (`DARIO_FONTANEL_HOOKS_AUDIT_ANALYSIS.md`: F04 migrazione massiva REJECT, F05 adapter
sottile STUDY). Fable concorda e aggiunge un criterio di collocazione che il nuovo algoritmo rende naturale:

- Un function hook è **fail-open** (eccezione ⇒ il motore lo salta) e **solo-Claude**. Quindi MAI per i controlli
  duri (distruzione, segreti/PII, SSOT, confine): quelli restano command hook fail-closed + gate, validi su ogni host.
- Il nuovo algoritmo declassa ~20 controlli per-edit ad **advisory**. Advisory + fail-open + opzionale per host è
  esattamente il profilo di un function hook: UN modulo in-process al posto di ~13 spawn `node` per edit.
- Due usi unici, entrambi non autorevoli: `prompt.submit`→`drop` per servire `arbiter ship #N` (stato/prossima
  azione) senza un turno di modello; `tool.call`+`next()` per cronometrare i tool a costo zero.
- Non è nel percorso critico di #2724. Entra come **leva candidata L-FH** del loop qui sotto, solo se la misura
  mostra che latenza/rumore degli hook per-edit è un bucket di spreco rilevante. Qualifica prima dell'uso:
  caricato / esercitato / BAD-CLEAN / eccezione / headless / reload.

## Loop di misura e revisione (il GO è condizionato a questo)

Nessun nuovo store, dashboard o gate sulle metriche: si estende `scripts/ship-kpi.mjs` (già legge git, gh e i
transcript) e si tiene UN log append-only `SHIP_TUNING_LOG.md`.

**Misure per consegna, tutte derivate** (git/gh/receipt + transcript JSONL del worktree):
lead time diviso in lavoro · verifica · review · attesa CI · rework · cerimonia (blocchi hook, commit di evidence);
token per ruolo (writer/reviewer/orchestrazione); messaggi umani durante il task (= babysitting); round; full L2
eseguiti; CI rosse; escape = fix/revert/issue che cita la PR entro 14 giorni. Token ignoti = NO DATA.
**Attribuzione delle sessioni (#2774):** una sessione appartiene a una consegna solo se il suo primo prompt umano
(testo intero, anche se in blocchi) è `/ship #N` per quell'unica issue, oppure se UNO qualsiasi dei suoi branch/cwd
(anche dopo una ripresa, purché visitato prima del merge) è il branch/worktree del task, oppure, per Codex, se discende da una sessione già attribuita.
Sessioni che citano più issue, o una sola da un altro cwd (coordinatori), finiscono in `unattributed`. Ogni riga PR
elenca `sessions: [{file, rule, costUnits, humanMessages}]` per rendere l'attribuzione verificabile. Il JSON non
contiene orologio (niente `generatedAt`, niente `live`): sessioni concluse danno righe identiche a byte. Una sessione
attribuita ancora in scrittura (file toccato negli ultimi 10 minuti) è segnalata su stderr, perché il suo costo può
ancora crescere. Le trascrizioni riprese dopo `--until` restano incluse: conta l'inizio della sessione, non l'mtime. Con `--until` la vecchiaia delle PR aperte è misurata alla fine della finestra, senza `--until` all'istante del report.
Strati: XS/S · Standard · Sensitive/train. Si riportano mediana E p90: la mediana di settembre è già 0.9 h,
il dolore ("12 h per 2 issue") sta nella coda, nei token e nel babysitting, che oggi non sono misurati.

**Indici (due, mai sommati):** `overhead_time = lead_time / floor_time` e `overhead_tokens = token / floor_tokens`.
`floor_time` = durate MISURATE a passata singola della stessa consegna (1 preflight + 1 L2 da receipt + 1 review +
1 CI) + tempo writer di riferimento dello strato. Il riferimento writer (tempo e token) è la mediana dello strato
calcolata UNA volta sui primi 30 casi storici e poi congelata: così thrash e rework del writer non gonfiano il floor.
Ogni misura mancante ⇒ `NO DATA`, e `NO DATA` non produce verdetto.

**Campione n:** i lead time sono log-normali a coda pesante (σ_ln ≈ 1.7 grezza, ≈ 0.6 dentro uno strato). Con
n = 10 per strato si distingue solo un effetto ≥ ~2×: va bene, perché un effetto più piccolo non ripaga una
modifica — è la definizione operativa di plateau. n = 10 è un checkpoint leggero, non un test: a quel n mediana e p90
sono instabili, quindi le soglie sotto sono PROVVISORIE, si calibrano sui primi 30 casi storici per strato e poi
si congelano. Revisione ogni **10 consegne** (contatore in ship-kpi; `/ship`
a fine consegna e `/drain` a inizio wave stampano `REVIEW DUE`). **Andon** fuori ciclo: una consegna > 3× la
mediana corrente dello strato, o qualsiasi escape, apre subito una revisione.

**Verdetti della revisione:**

- `PLATEAU` — per DUE checkpoint consecutivi: overhead mediano ≤ 1.3, p90 ≤ 2, nessun bucket > baseline +20%,
  ultima modifica < 10%:
  algoritmo congelato, cadenza a 30 consegne.
- `TUNE` — un bucket sopra baseline +20% con direzione coerente tra i due indici: una modifica mirata dalla lista leve (L-FH function hook advisory, L-affected
  selezione check, L-review contesto/modello reviewer, L-train recall di JOIN, L-CI dedupe per tree-hash…).
- `RETHINK` — overhead mediano > 2 o p90 > 4 dopo due TUNE consecutivi senza effetto ≥ 2× sul bucket: sessione
  di ripensamento vero — root cause sui casi peggiori, ricerca online dello stato dell'arte, contraddittorio
  Fable⇄Codex, alternative strutturali (incluso sostituire un meccanismo con uno nativo dell'host).
- `ROLLBACK` — escape attribuibile a un controllo rimosso: si ripristina QUEL controllo (ablation al contrario).

**Disciplina:** una sola modifica per ciclo (altrimenti niente attribuzione); effetto atteso e bucket bersaglio
preregistrati nel log PRIMA di applicarla; il ciclo successivo la conferma o la ritira. La qualità è un vincolo,
non un termine da scambiare: nessuna leva può rimuovere una prova richiesta.

**Anti-cerimonia del loop stesso:** il checkpoint ordinario è AUTOMATICO — `ship-kpi` calcola, precompila la voce
del log ed emette il verdetto; se è `PLATEAU`/nessuna azione non consuma un turno né attenzione umana. Modello e
owner intervengono solo su `TUNE`, `RETHINK`, `ROLLBACK` o andon.

**Function hook sotto misura:** fail-open per il task ma mai silenzioso — il receipt porta i contatori
`loaded / exercised / skipped / exception / headless / reload`. Oltre soglia di errore L-FH vale `NO DATA`, non un
miglioramento (un hook saltato sembra "meno latenza"). `prompt.submit→drop` cambia il comportamento osservabile:
non è advisory, va qualificato come capability a sé e resta fuori dal primo pilot.

Round 3 con Codex (2026-09-19): concessi separazione advisory/duro, log unico, strati, andon; corretti su sua
richiesta floor, separazione tempo/token, NO DATA, soglie provvisorie, revisione automatica, contatori hook.

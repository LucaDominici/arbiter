---
title: 'Ship redesign journal'
doc_version: '1.0.0'
status: active
last_review: '2026-09-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/internal']
related: []
---

# Ship — diario dei loop (fonte unica del percorso fatto)

**Invariante dell'owner (2026-09-19):** a ogni loop si RILEGGE questo file prima di agire e lo si AGGIORNA alla
fine con: punti di caduta, miglioramenti misurati, SOTA consultata, scelte fatte (e scartate) e perché.
Goal attivo: eliminare la coreografia conversazionale di ship; chiuso quando un revisore Fable e uno Codex Astra
non trovano più cerimonia inutile e concordano che ship non è ulteriormente ottimizzabile.

Materiale collegato: `SHIP_REDESIGN_ALGORITHM.md` (algoritmo congiunto), `ARBITER_2026_CUTOVER_PROJECT.md`,
`SHIP_C1A_POSTMORTEM.md`, `CAMPAIGN_STATE.md`; nel repo prodotto `docs/internal/SYSTEM/SHIP_TUNING_LOG.md` (#2725).

## Scelte ferme (non ridiscutere senza un dato nuovo)

| #   | Scelta                                                                                                                                     | Perché                                                                                                 | Alternativa scartata                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| S1  | Non si riscrive il prodotto; si riscrive da zero la SUPERFICIE per l'agente (AGENTS.md, CLAUDE.md, regole, ship.md, hook)                  | CLI/gate/generatori/18k test costano zero token; il costo è turni × contesto                           | From-scratch totale: butta garanzie provate                |
| S2  | Percorso libero, confine duro; stato DERIVATO, non dichiarato                                                                              | 4 casi vivi di "dichiara-non-deriva" in un giorno                                                      | State machine guidata a mano dall'agente                   |
| S3  | CLAUDE.md = shim `@AGENTS.md`; AGENTS.md sottile ≤150 righe; catalogo invarianti on-demand                                                 | Claude Code ≥2.1.277 legge AGENTS.md nativo ma non con telemetria off/Bedrock; il lint impone l'import | Cancellare CLAUDE.md (rompe consumer senza lettura nativa) |
| S4  | INV-91 emendato in trunk-solo: check presente e verde con messaggio esplicito                                                              | Decisione owner; coerente con INV-74; gate impossibile per sviluppatore unico                          | Label applicata da un agente (attestazione falsa)          |
| S5  | Routing modelli: Luna xhigh = bounded ≤2 file con oracolo; Terra = multi-file scoped; Sol = long-horizon e review; effort SEMPRE esplicito | Prezzi set-2026, CodeRabbit (Terra dominato sul long-horizon), config Codex eredita xhigh              | Terra default per tutto                                    |
| S6  | Un reviewer indipendente sempre; AC eseguibili; review ∥ full gate sullo stesso SHA; max 2 round                                           | Review ha trovato garanzie sparite (#2724) e impianto KPI finto (#2725)                                | Seggi multipli LLM; zero review sotto soglia               |
| S7  | Gate umani: l'agente non firma mai al posto dell'owner; se l'owner emenda la policy, lo si fa in chiaro con ADR                            | Un'attestazione falsa è ciò che il gate esiste per impedire                                            | —                                                          |

## Numeri di riferimento (misurati)

- 115 consegne dal 2026-08-20: Standard mediana 7.5 h / p90 152 h; XS-S 2.6 h / 143 h; 8 interventi umani mediani.
- **CORREZIONE 2026-09-20:** il costo "12M unità mediane" era gonfiato ~9× (input Codex contato due volte: `input_tokens`
  OpenAI include la cache). Valori corretti su 117 consegne: Standard mediana 296k input fresco / 5.7M cache / 52k
  output = **1.3M unità di costo (p90 11.7M)**, interventi umani mediana **4 (p90 17)**. In unità di costo: cache ~44%,
  fresco ~23%, output ~20%. Copertura attribuzione bassa (claude 17/95, codex 25/95); non attribuito nel mese: 12.1B
  token Claude + 8.5B Codex grezzi su 1825 sessioni. I transcript oltre ~30 giorni non esistono più → calibrare per metrica.
- 13 sessioni di consegna Claude: 97 turni × ~145k contesto ≈ 14M input; output 0.22%; tool result 0.3%; cache read 98%.
- Primo turno headless (`claude -p`, haiku): dir vuota 30.7k · arbiter 47.2k · arbiter con 17 plugin spenti 43.6k.
- Esecuzione Codex delimitata con brief stretto: 140–235k token totali contro 14M di una sessione orchestrata.
- Gate: preflight ~48 s; L2 ~245 s; pre-push = L2 completo.

## Loop 0 — analisi e contraddittorio (2026-09-19 pomeriggio)

Fatto: analisi indipendente, 3 round con Codex, algoritmo in 12 passi, loop di misura. Pulizia 153 worktree (backup
in `.arbiter/bundles/cleanup-20260919-185945/`).
Lezioni: `codex exec` va chiuso con `< /dev/null`; zsh non spezza `$pids` né `$T` (usare cicli o argomenti
espliciti) e `"$1:s…"` è un modificatore (usare `${1}`); la spawn-guard blocca Agent da una sessione rootata in
main → si delega con `codex exec` nel worktree.

## Loop 1 — atterraggio #2724, KPI, INV-91, dieta (2026-09-19 sera)

Punti di caduta osservati:

1. Gate locale cieco al corpus completo: 39 test rossi scoperti solo all'L2 (verifica "per campione").
2. Codex ha classificato "ambientale" un rosso vero tre volte → un rosso è ambientale solo con riproduzione fuori sandbox.
3. Due test imponevano prosa falsa (comando "rimosso" che esiste) → un test che impone doc falsa è un difetto del test.
4. Ratchet dei finding punisce la cattura: `promote` non drena lo spool, il contatore non consulta il ledger (#2733).
5. Byte emessi non formattabili a ogni printWidth: la mia prescrizione "emetti già formattato" era sbagliata (#2737).
6. Cella CI "Generated-gate" non riproducibile dal gate locale: punto cieco; riproduzione = `VITEST_L2=1 vitest run …fixture-functional`.
7. Watch CI in background non risveglia l'agente: 50 minuti di PR rossa con writer idle → attese solo in foreground.
8. #2736: tre gate completi sprecati (~12 min) per errori da preflight (<1 min): regen DOPO l'ultima modifica → preflight → push. Deve essere il comportamento di `arbiter verify`, non disciplina dell'agente.
   9b. Ho comunicato all'owner un numero (12M) prima che l'impianto di misura passasse la review: era sbagliato di ~9×. Un numero non revisionato si dichiara provvisorio.
9. La mia review KPI: avevo dato per buono un impianto superficiale; Sol ha trovato 20 finding (formula del floor, calibrazione non oldest-first, verdetti irraggiungibili, test finti). Lo smoke test non sostituisce un revisore.
10. Brief con path sbagliato (doc migrato nel wiki) → il writer l'ha ricreato: i brief citano solo path verificati.
11. Quota Codex esaurita a metà batch: il lavoro sopravvive nel worktree; si RIPRENDE la stessa sessione (`codex exec resume <id>`), mai rispawn.
12. Ogni messaggio cross-sessione risveglia la sessione idle a contesto pieno: pochi e raggruppati.

Miglioramenti consegnati: #2724 su main (dd9b65e8): niente plan-review pre-codice, un reviewer, preflight economico,
resume puro, wave-drain 487→95 righe; nessun gate rimosso (161 script identici), ratchet stretti. Issue vere aperte:
#2726–#2733, #2735, #2737. In corso: #2725 (rework Sol), #2736 (4° push), #2738 (dieta superficie, Sol high, 3 stadi).

SOTA consultata: Anthropic "Effective context engineering" (retrieval just-in-time, subagent che tornano 1–2k
token, tool-result clearing); Claude Code docs costs/memory (CLAUDE.md <200 righe, regole `paths:`, skills on-demand,
commenti HTML gratis, AGENTS.md nativo da 2.1.277); guida Fable 5.1 (effort high default e medium spesso basta,
nudge per batch di tool call, edit chirurgici, niente retorica anti-formattazione); GPT-5.6 tier/effort (+~50% costo a gradino).

Piano del prossimo loop con verifica avversariale:

1. Atterrare #2736 e #2738; misurare il primo turno con lo stesso script (obiettivo parte-progetto 16.5k → ≤10.7k).
2. Revisore Fable + revisore Codex Astra su superficie e percorso: mandato "trova la cerimonia residua", output MUST/SHOULD con prova.
3. Canary #2490 con il nuovo percorso, misurato da ship-kpi (obiettivo costo ≤25% baseline, ≤2 interventi umani).
4. Passi dell'emendamento per resa: hook per-edit advisory → `arbiter verify` (regen→preflight→RED derivato) → tier al freeze → stato minimo.

## Criterio di chiusura dimostrabile (2026-09-20, richiesta owner)

Nessuno dei tre punti è dimostrabile in assoluto; tutti e tre diventano dimostrabili RELATIVAMENTE a un modello
dichiarato. Il goal si chiude su certificati verificabili, non su un giudizio.

**G1 — Minimalità (sostituisce "ottimo globale").** Modello: la consegna è la scarica di un insieme dichiarato di
OBBLIGHI O. Due proprietà meccanicamente verificabili:

- _Zero cerimonia_: ogni passo rivolto all'agente (comando, hook bloccante, artefatto, seggio) è tracciato a ≥1
  obbligo in una matrice passo→obbligo; un passo senza obbligo è cerimonia per definizione → deve essere 0.
- _Irridondanza_: ogni controllo ha ≥1 caso BAD del corpus negativo che SOLO lui rende rosso (ablation: tolto quel
  controllo, il caso passa). Un controllo il cui insieme di BAD è coperto dall'unione degli altri è dominato → si
  rimuove. È una copertura irridondante, calcolabile sul corpus: `minimal(O, corpus)`.
- _Lower bound_: ogni obbligo va scaricato ≥1 volta sul candidato finale ⇒ costo ≥ LB(O) = base·turni_min + Σ
  singola passata. Il percorso senza rework lo raggiunge (review ∥ gate ⇒ tempo = max, non somma). Gap certificato
  = (misurato − LB)/LB. Abbassare LB richiede togliere un obbligo: decisione esplicita, non ottimizzazione nascosta.
  **G2 — Correttezza (sostituisce "codice corretto").**
- Kernel: lo spazio degli stati del lifecycle (fase × trattamento × round × ricevute) è finito e piccolo → verifica
  ESAUSTIVA delle transizioni contro gli invarianti (nessun merge senza ricevuta sul soggetto esatto, monotonia del
  trattamento, letture pure, terminazione in MERGED|BLOCKED). È una dimostrazione per enumerazione.
- Codice consegnato: AC eseguibili + forza dell'oracolo misurata (mutation score sui file toccati ≥ soglia) +
  limite superiore sul tasso di escape: 0 escape su n consegne ⇒ p ≤ 3/n al 95% (regola del tre).
  **G3 — Misura (sostituisce "monotonia in aspettativa").** Decisione con errore controllato: replay APPAIATO sugli
  stessi task (riduce la varianza), intervalli bootstrap su mediana e p90, test sequenziale con α dichiarato. Garanzia:
  P(accettare un peggioramento) ≤ α per ciclo, ≤ k·α su k cicli. Il verdetto riporta α, β, n ed effetto minimo rilevabile.
  **G4 — Due revisori indipendenti (Fable + Codex Astra)** verificano i CERTIFICATI G1–G3, non un'impressione: provano
  a (a) trovare un passo senza obbligo, (b) trovare un controllo dominato, (c) costruire un caso BAD che passa,
  (d) falsificare il lower bound. Zero riuscite su tutti e quattro = chiusura.

Nota di onestà: G1 è minimalità rispetto a O e al corpus dichiarati; un corpus più ricco può riaprirla. È il
massimo dimostrabile senza un modello chiuso di un LLM.

## G0 — Conservazione delle funzionalità (vincolo che precede G1–G4; richiesta owner 2026-09-20)

Il rischio dichiarato dall'owner: ottimizzare il costo cancellando capacità ("per salvare il pianeta ammazza
l'umanità"). G1 da solo lo permetterebbe. Quindi:

- **L'insieme delle capacità di ship è congelato.** Denominatore = FEATURE_MATRIX/RTM (REQ-NNN con prova) + gli
  script di gate (161 oggi) + il corpus negativo. Nessun loop può ridurre nessuno dei tre. Il corpus può solo crescere.
- **Si ottimizza il COSTO di una capacità, mai la sua esistenza.** Scala obbligatoria per ogni passo cerimonioso,
  ci si ferma al primo gradino che regge: (1) derivarlo dai fatti invece di farlo dichiarare; (2) spostarlo al
  confine (gate/preflight) invece che sul percorso; (3) renderlo advisory o un function hook in-process;
  (4) spostarlo da contesto sempre-caricato a on-demand (skill, regola `paths:`, `arbiter explain`).
- **La rimozione non è un gradino della scala.** Se nessun gradino regge, il passo va nella lista
  "PROPOSTE DI RIMOZIONE PER L'OWNER" qui sotto con: capacità toccata, prova che è dominata, cosa si perde. Si
  esegue solo con un sì esplicito dell'owner. Cancellare PROSA duplicata da un gate/hook che resta NON è una
  rimozione di capacità (la capacità è il gate), ma va elencata lo stesso.
- **Prova meccanica a ogni PR del goal:** conteggio REQ dell'RTM invariato o cresciuto; insieme degli script di
  check invariato o cresciuto; nessun caso del corpus negativo cancellato; ogni capacità toccata ha il suo test
  BAD ancora rosso senza il controllo. I revisori di G4 hanno un quinto mandato: trovare una capacità sparita.

### Proposte di rimozione per l'owner

- (nessuna eseguita) In #2738 stadio 3: prosa delle regole `25-todo-folder-policy` e `95-matrix-fixture-policy`,
  duplicate da `check-no-orphan-todo` e `check-matrix-fixtures` che restano. Capacità invariata; è solo contesto.

## Loop 2 — appunti in corso (2026-09-20 notte)

Punti di caduta nuovi: 13. Un brief che dice "funzioni piccole" senza il comando che lo verifica produce 30 violazioni di complessità scoperte solo al gate completo. Ogni vincolo in un brief porta il suo comando di controllo. 14. Codex si ferma a chiedere "approvi il disegno?" anche con mandato chiaro: nei brief va scritto "operi in autonomia, nessuno risponde, implementa fino in fondo". Costo: un giro a vuoto da 40k token. 15. `git checkout -- <file>` su un file generato ha cancellato una mia correzione non committata (canonical_id del log): prima di ripristinare, committare o verificare il diff. 16. Un artefatto generato (log dei checkpoint) deve nascere già conforme a prettier: riga macchina in commento HTML (prettier non lo tocca, i loader lo tolgono dal contesto). 17. Il preflight da 48 s ha intercettato due volte ciò che prima costava un gate da 4 minuti: regen → preflight → push funziona; va reso un solo comando. 18. La residenza nel contesto moltiplica il peso dei risultati dei tool: mediana 53 turni dopo ogni Read (p90 411), 23.6% dei byte letti è stale. Lo 0.3% "all'ingresso" diventa ~15% cumulato → tool-result clearing è una leva vera.
Scelte: headroom default interattivo con ripiego automatico e senza modello forzato; graphify via hook SessionStart a livello UTENTE (refresh staccato, 2m57s, mai bloccante) perché in arbiter gli hook git sono file tracciati e generati; `graphify query "<identificatore esatto>"` è l'uso che funziona, le domande in linguaggio naturale no. Issue #2741 per proporre i companion in fase di setup.
Consegnato: #2736 su main (f2cfab71). In corso: #2738 (stadi 2-3, Sol), #2725 (refactor complessità, Sol).

## Loop 2 — SOTA interazione Claude↔Codex (2026-09-20)

Fonti: doc OpenAI approvals/security, guida dwgx subagent-dispatch, Nimbalyst orchestration,
danielvaughan (plugin/MCP), openai/codex-plugin-cc issue #765, McQuaid (sandvault), CLI `codex exec --help` locale.

**Scelta S8 — niente yolo; sandbox mirata + `approval_policy=never`.** Verificato con probe reale
(luna low, worktree temporaneo): `-s workspace-write --add-dir <gitdir worktree> --add-dir <hub .git>`
→ `git commit` riesce (exit 0). Il limite "Codex non può committare nei worktree" era solo il gitdir
fuori dai writable roots (issue #765, aperta, nessun fix upstream). Yolo non serve e toglie l'unica
barriera fra un brief sbagliato e il checkout principale dell'owner (stash, file untracked).
Yolo resta ammesso solo dentro un confine esterno (container/utente separato), che qui non c'è.

- `-c approval_policy=never`: elimina le pause "Approve this design?" (default exec = on-request). Costo osservato: 1 resume sprecato su #2725.
- Launcher unico `~/.claude/bin/cx.sh <wt> <model> <effort> <brief> <out> [session]`: effort sempre esplicito, `< /dev/null`, add-dir gitdir+hub+`.vite-temp` (fix EROFS vitest).
- `resume` non accetta sandbox/add-dir/cd: eredita la sessione. Una sessione nata senza add-dir non potrà mai committare → per lavori lunghi partire subito col launcher.
- Reviewer: sempre `-s read-only`, mai scrittura (Nimbalyst + nostro S3). `--output-schema` per verdetti macchina (riduce il parsing del coordinatore).
- MCP server (codex come tool): scartato. Aggiunge schema tool al contesto di ogni turno e i wrapper terzi girano in bypass di default; `exec` + file di output è il valore di ritorno più economico.
- Brief: Goal / Scope / Permissions / comando di verifica esatto / formato di ritorno. La mancanza del comando di verifica ci è costata un gate intero (#2725 complessità).
- Rete nel sandbox (`sandbox_workspace_write.network_access`) NON abilitata: push/PR restano al coordinatore (confine duro).

Lezione ripagata oggi: ciclo TDD-evidence (test RED committati PRIMA) dimenticato su #2738 → 1 push respinto + riscrittura storia. Va in `arbiter verify` come RED derivato (punto 1 dell'algoritmo), non nella memoria dell'agente.

## Loop 2 — checkpoint 2026-09-20 01:30 (lesson learned + stato)

Stato: #2725 gate L2 verde, pushato, PR #2742 aperta, delta review Sol (read-only, high) in corso. #2738 stadi 1-3 fatti, contesto primo turno 43.6k → 37.4k (parte progetto 12.9k → 6.7k, target ≤10.7k centrato); push respinto 2 volte, fix in corso.

Lesson learned (punti di fallimento 19–25): 19. **Report del writer ≠ verifica.** Sol ha dichiarato "all gates pass" ma nel sandbox `.agents/` è read-only → 4 regole Codex STALE + file `.arbiter-backup` orfano, scoperti solo al push. Il coordinatore rilancia SEMPRE i check fuori sandbox prima del push (preflight non basta: self-parity, fail-closed audit e docs:build girano solo in L2). 20. **Preflight verde, L2 rosso su 3 check economici** (codex self-parity 277ms, fail-closed 121ms, docs:build 1.4s). Candidati a entrare in preflight: costano <2s e ci sono costati un gate intero (~10 min). → proposta per `arbiter verify`. 21. **TDD-evidence dimenticata** → push respinto + riscrittura storia (backup ref, reset --soft su origin/main già mergiato, test RED committati prima, `node dist/cli.js lifecycle record-red` — il binario installato ha `task`, quello del worktree `lifecycle`, e `--force` non esiste più). Deve essere RED derivato dalla macchina, non memoria dell'agente. 22. **Sandbox Codex: `.git`, `.agents`, `.codex` sono protetti anche dentro un writable root.** `--add-dir` sblocca il gitdir (commit OK, probe verificato) ma NON `.agents/`. Lavori che toccano `.agents/`/`.codex/` → li materializza il coordinatore (procedura: CODEX_PARITY_RUNBOOK §Re-materialization, emissione in scratch dir vuota + copia). 23. **Con `--add-dir` Terra ha avuto `spawnSync node EPERM`** (vitest/regen bloccati) che le sessioni Sol senza add-dir non avevano. Da capire prima di standardizzare cx.sh: finché non è chiarito, cx.sh = commit sì, ma verifica test sempre fuori sandbox. 24. **Fix "fail-closed" meccanico che rompe i chiamanti**: trasformare un `catch → Set vuoto` in `throw` ha rotto 10 test (repo temporanei senza HEAD). Root cause: la funzione era superflua — un file in `git ls-files` che non esiste È un file cancellato nel worktree; basta `existsSync`. Meno codice > marker FAIL-OPEN. 25. **Helper da 3 righe estratto in un nuovo file** (display.mjs) ha fatto scattare l'audit fail-closed → gate perso. Inline. Regola nei brief di refactor: "nessun nuovo file salvo necessità". 26. **Regole cancellate: verificare G0 prima.** CLOSER mode: le regole 3–7 sembravano vivere solo in prosa, in realtà `src/commands/task.ts:93` le stampa all'ingresso in fase close → il file rule era un duplicato sempre-caricato. Pattern giusto: prosa sempre in contesto → stampa al cambio fase / hook.

Scelte ferme aggiunte: S8 (no yolo, sandbox mirata, vedi sezione sopra). S9: il coordinatore esegue fuori sandbox {self-parity, fail-closed, docs:build, test toccati} prima di ogni push.
Gate sprecati oggi: #2738 ×2, #2725 ×1 (prima ×1 complessità). Costo ≈ 40 min macchina. Tutti e 4 evitabili con S9 + punto 20.

## Loop 2 — checkpoint 2026-09-20 02:30 (goal impostato, lesson learned)

Stato: #2742 (KPI loop) MERGED dall'owner. #2744 = rework KPI (blocking list della 2a review + baseline ricalibrata: tempo writer → NO DATA, costi invariati, Standard writer 2.127.147,6 cu n=20) — DEVE atterrare prima della prima delle tre consegne misurate (condizione (a) del goal: baseline su main prima, mai ricalibrata dopo). #2743 = dieta superficie agente, gate L2 verde. Goal owner impostato alle ~02:20 (testo integrale nell'issue di tracking).

Correzione da non perdere: il PERCHÉ del goal cita "12M unità di costo e 8 interventi". I numeri misurati corretti sono mediana 1,3M cu (p90 11,7M) per consegna intera e 4 messaggi umani; la baseline congelata dello strato Standard è 2,13M cu (writer) + 0,64M (review). Il 12M era gonfiato ~9× dal doppio conteggio dei token cached di Codex. La prova del goal usa il rapporto sulla baseline del file, quindi il refuso non altera il verdetto.

Lesson learned 27–32: 27. **L'integration suite è il vero guardiano di G0.** Ha trovato due capacità sparite nella compressione di #2738 che né il writer, né il preflight, né io avevamo visto: la riga collaboration-mode nello shim CLAUDE.md e la sezione CANON-22 della regola exec-protocol. Regola: ogni compressione di superficie agente si chiude SOLO dopo integration suite verde; mai fidarsi di "ho tenuto l'essenziale". 28. **tdd-evidence vuole evidenza PRODOTTA SUL RAMO** (#2217/#2307): un follow-up su un task già mergiato richiede un nuovo record-red sul nuovo ramo. Sequenza: commit test → `reset --soft` del fix → stash → `node dist/cli.js lifecycle record-red` → pop → commit fix con `git add -f` dell'evidenza. 29. **Check `docs`**: codice/test cambiati senza doc = rosso. Non usare `[skip-docs]`: scrivere la doc vera (semantica, limiti noti). 30. **Snapshot bake e golden sono conseguenze, non conflitti**: `BAKE_UPDATE_SNAPSHOTS=1 npm run -s test:e2e:bake`; golden Codex = copia della regola canonica (protocollo CODEX_PARITY_RUNBOOK §Golden evolution); pin dogfood con `--update-divergences` solo dopo aver letto il diff. 31. **Il constraint-scan legge la prosa**: "never commit to main" in CLAUDE.md è diventato un vincolo UNENFORCEABLE e ha alzato il ratchet. Nelle superfici agente descrivere il percorso ("land through a PR branch"), non il divieto, se il divieto è già imposto altrove. 32. **Gate completi spesi stanotte: 9** (#2738 ×5, #2725 ×4), di cui 7 evitabili. Cause in ordine di costo: check L2-only economici assenti dal preflight (3), tdd-evidence (2), integration suite mai girata prima del push (2). È il dato più forte a favore di `arbiter verify` = regen → preflight esteso → RED derivato → integration mirata.

Regola di scrittura/lettura (invariante di progetto, owner 2026-09-19): a inizio loop rileggere "Scelte ferme", "Criterio di chiusura", G0 e l'ultimo checkpoint; a fine loop (e periodicamente durante) appendere stato, lesson learned numerate, SOTA consultata con fonte, scelte con motivazione e correzioni di numeri già comunicati. Mai riscrivere le voci passate: si corregge con una voce nuova che cita la vecchia.

## Loop 2 — #2747 Codex writer dispatch lane (2026-09-20, checkpoint doc)

`scripts/lib/codex-dispatch-lib.mjs` (`buildCodexArgs`, `buildCodexReviewArgs`) e la CLI sottile `scripts/codex-dispatch.mjs` sostituiscono `~/.claude/bin/cx.sh` con un builder tracciato nel repo (testato in `__tests__/scripts/codex-dispatch-lib.test.ts`, fixture su worktree git reale). Semantica: `buildCodexArgs` produce l'argv per il writer (`-s workspace-write -c approval_policy=never --add-dir <gitdir worktree> --add-dir <hub .git> --add-dir <.vite-temp>`, effort sempre esplicito); `buildCodexReviewArgs` produce l'argv per il reviewer read-only. Nessuna spawn qui dentro: la libreria costruisce solo l'array di argomenti, il caller decide come eseguirlo.

Limite noto confermato in questo loop: l'EPERM (`spawnSync node EPERM`) osservato in precedenza con Terra + `--add-dir` (lesson 23 sopra) è stato riprodotto una volta dentro il sandbox Codex e poi verificato assente rilanciando lo STESSO test fuori sandbox (3/3 verdi). Non è un difetto del codice: è una restrizione del sandbox Codex sullo spawn di sottoprocessi, indipendente dai permessi di scrittura concessi via `--add-dir`. Implicazione operativa: i test scritti dal writer che shellano fuori (es. `git` reale) vanno sempre riverificati dal coordinatore fuori sandbox prima di fidarsi del loro esito (S9, rinforzato con un caso concreto).

Lesson learned 33: **`spawnSync` senza `cwd` esplicito segue il cwd del chiamante, non il `--worktree` passato in CLI.** La prima esecuzione live di `codex-dispatch.mjs` ha scritto nel worktree del coordinatore invece che nel worktree target, pur avendo i mount `--add-dir` corretti per la destinazione voluta → `bwrap: Can't bind mount ... No such file or directory` e file scritto nel posto sbagliato, con l'`exec` esterno comunque a exit 0 (altro caso concreto di S9: l'exit code del dispatcher non prova nulla sul task interno). Fix: `spawnSync(..., { cwd: realpathSync(worktree) })`, come già fa `cx.sh` con `cd "$wt"`. Verificato live: la seconda run ha mostrato `workdir` corretto e ha scritto il file nel worktree giusto.

Lesson learned 34: **Side-effect nuovo (`mkdirSync node_modules/.vite-temp`) su un worktree senza `npm ci` fa scattare `.githooks/pre-commit` invece di saltarlo**, perché la guardia iniziale è "`node_modules` assente → skip", non "dipendenze installate". Con solo `.vite-temp` dentro, l'hook prosegue fino a `npx prettier --check`, che tenta un fetch di rete assente → hang. Non è una regressione del lane (`cx.sh` ha lo stesso `mkdir -p` incondizionato da mesi): i worktree di dispatch reali passano sempre da `worktree prepare` (npm ci) prima del primo dispatch, quindi la condizione non si presenta in uso normale. Riprodotto isolando la causa (in questo worktree, con `node_modules` reale, lo stesso hook committa senza hang) e depositato come finding a bassa severità (`.arbiter/findings/task__2747-codex-dispatch.jsonl`) invece di allargare il diff di #2747.

AC-1 (metà 1, "un writer dispatchato committa nel suo worktree con la sandbox attiva") è chiusa da tre prove concordanti: il probe `cx.sh` citato nel corpo di #2747 ("Verified 2026-09-20", exit 0, commit reale), il test unitario su `buildCodexArgs` (i tre `--add-dir` + `approval_policy=never` nell'argv), e la run live di questo loop che ha provato il targeting corretto del NUOVO script (bug del cwd trovato e fissato proprio grazie a questa run). Non è stato rieseguito un commit end-to-end in uno scratch worktree pulito: ripetere la stessa prova già data da `cx.sh` con un secondo probe da `npm ci` sarebbe ceremonia, non nuova evidenza.

Lesson learned 35 (corregge la voce sopra, non la riscrive — owner invariant "mai riscrivere le voci passate"): la review Astra su PR #2769 ha respinto proprio la frase precedente. A ragione: il probe live di questo loop aveva esercitato solo `workspace-write` (scrittura di un file), mai i due `--add-dir` del gitdir — i mount che esistono SOLO per permettere `git commit` in sandbox. `cx.sh` prova quel meccanismo, non lo script SPEDITO in #2747; un unit test sull'argv non prova che lo spawn reale lo rispetti (vedi lesson 33, trovato proprio da una run live che un unit test non avrebbe scoperto). Rieseguito con un secondo probe, questa volta un commit vero via il codice spedito: worktree scratch fresco (`git worktree add -b probe-2747-scratch main` + `npm ci`, per restare fuori dalla lesson 34), dispatch `node scripts/codex-dispatch.mjs --worktree <scratch> --model gpt-5.6-luna --effort low --brief <crea PROBE.md, git add, git commit> --out <out>`. Verificato FUORI sandbox (S9), non fidandosi dell'output del dispatcher: `git -C <scratch> log -1 --format='%H %s'` → `8078ced40ac675ee7aaa4f356da19c749712ba2c chore: codex-dispatch live probe`, file e commit reali confermati con `git show --stat`. AC-1 è ora provata end-to-end sul codice spedito, non solo su argv + storico `cx.sh`.

Aggiunta anche una CLI-level regression guard (`__tests__/scripts/codex-dispatch-cli.test.ts`): uno stub `codex` su PATH che registra la propria cwd, invocato da una cwd diversa dal worktree target — prova che rimuovere `cwd: worktreePath` da `spawnSync` (lesson 33) farebbe fallire QUESTO test pur lasciando verde il test dell'argv builder. Confermato con una mutazione manuale (rimossa la riga `cwd`, test rosso; riapplicata, test verde) prima di committare.

## #2747 chiuso (2026-09-20, checkpoint)

Stato: PR #2769 MERGED, main=`4989684b`. Round 1 review (Astra, read-only) → REJECT su 2 MUST-fix (commit end-to-end non provato sul codice spedito; fix del cwd non coperto da test a livello CLI). Entrambi risolti (lesson 35 sopra + nuovo test) e riverificati con un round 2 SCOPED — brief che nomina esplicitamente i due item e vieta di riaprire il resto — → PASS su entrambi, verdetto finale PASS. **2 round di review, dentro il cap dichiarato.**

Lesson learned 36 (risposta al meta-check del peer: perché la consegna #2733 aveva avuto 5 round contro un cap di 2, qui solo 2): il brief del round 2 elencava per nome i due MUST-fix e vietava esplicitamente di riaprire item già chiusi ("Do not reopen AC2, the three gate-config changes, or anything else already settled"). Un brief di review non delimitato ("c'è altro da segnalare?") lascia il reviewer libero di trovare N nuovi item ogni giro — è quello, non la qualità del codice, il meccanismo che fa esplodere i round. Regola per i prossimi round-2+: sempre scoped, sempre per item nominato, mai un "any other issue?" aperto dopo il primo giro.

Scope: la PR consegna solo il dispatch script tracciato nel repo (issue lasciata aperta, `Refs #2747` non `Closes`); integrazione `arbiter ship`, `record-red --at <sha>`, brief template restano follow-up.

## #2770 — correzione dell'esenzione fail-closed su codex-dispatch-lib (2026-09-20)

`codex-dispatch-lib.mjs` era esente dal contratto try/catch fail-closed sulla base della prosa "non fa I/O". Falso: importava `node:child_process`/`node:fs` e chiamava `execFileSync`/`readFileSync` per risolvere `gitDir`/`commonGitDir` e leggere il brief. Il test CANON-25 aggiunto per provarlo (PR #2769) usava una blocklist di stringhe (`'node:fs'`, `'exec('`, …) che non copriva i nomi reali usati (`execFileSync`, `readFileSync`) — un test scritto per passare, non per falsificare la claim.

Fix (Opzione A): tutta la I/O si sposta nell'entry point `scripts/codex-dispatch.mjs`, che possiede già il try/catch fail-closed; `buildCodexArgs` diventa una funzione pura che riceve `gitDir`/`commonGitDir`/`briefText` come argomenti. Il test è stato riscritto per vietare gli IMPORT (`node:fs`, `node:child_process`) invece dei nomi di chiamata — non aggirabile rinominando la call. Verificato con `node scripts/check-fail-closed-audit.mjs` diretto (OK, 0 nuove violazioni) e mutation-kill manuale (reintrodurre l'import rompe il test; rimuoverlo lo fa tornare verde).

Lesson learned 37 (risposta al meta-check del peer su #2769): una prova richiesta può diventare una prova conforme-ma-tarata quando il test che la certifica usa una blocklist anziché un allowlist — la blocklist passa finché nessuno prova la stringa esatta usata dal codice reale; un revisore che legge solo il verdetto del test, non il suo contenuto, non lo scopre. Controllo proposto dal peer, adottato qui: il brief di un revisore indipendente su un'esenzione CANON-25 deve elencare esplicitamente i file di gate-config toccati dalla PR e mandatare la falsificazione di ogni commento di giustificazione lì scritto — non "rivedi il diff", ma "prova che questo commento è falso". Vale per ogni futura esenzione fail-closed, non solo questa.

Lesson learned 38 (il controllo di lesson 37, applicato alla PR che l'ha proposto, ha trovato un buco in sé stesso): il revisore indipendente dispatchato su PR #2772 con esattamente quel brief ha falsificato l'allowlist appena scritta — `/from\s+['"]([^'"]+)['"]/g` assume che tra `from` e la stringa ci sia whitespace vero, ma `from/* commento */'node:fs'`, `import 'node:fs'` (senza `from`) ed `export * from 'node:fs'` sono tutte sintassi valide che il regex non copre; ha trovato anche una via di I/O senza alcuna dichiarazione `import` (`process.getBuiltinModule('node:fs')`, Node 20+). Un regex su testo grezzo non è un parser: qualunque forma sintattica non anticipata dall'autore del regex passa. Fix: sostituito il matching testuale con un walk dell'AST via `typescript` (già dipendenza del repo, nessuna nuova dipendenza) su `ts.createSourceFile` — cattura ogni `ImportDeclaration`/`ExportDeclaration` con specifier e ogni `ImportKeyword` in posizione di call-expression per costruzione, non per pattern; il regex resta solo come difesa aggiuntiva mirata sulle due vie di I/O che non passano da un `import` (`require(`, `process.getBuiltinModule`), con un commento `ponytail:` che ne nomina il limite (non esaustivo contro future API Node). Mutation-kill rieseguito su tutte e sei le forme trovate dal revisore: tutte rosse con la mutazione, verdi senza. Regola: un allowlist testuale su una grammatica reale (JS/TS) non è mai la prova finale — o si usa un parser vero, o si dichiara esplicitamente cosa il test NON copre.

## #2773 slice 1 — gate derivation + historical recall (2026-09-20)

La lista dei gate attesi viene ora ricalcolata dai file del piano usando lo stesso
`GATE_AFFECTS_REGISTRY` e lo stesso matcher minimatch del selective gate; la transizione plan→red
rifiuta sia una lista assente sia una lista plausibile ma diversa dalla ricalcolata. Nessun check è
stato tolto da `check-all.mjs`. Quattro entry prima `ALWAYS` sono state ristrette ai loro input
documentati: dogfood, examples drift, emitted markdown refs e integration suite. Il mutation-kill
che rimette examples drift ad `ALWAYS` rende rosso il caso AC-1 docs-only.

Backtest AC-6 reale sui 30 PR mergiati più recenti al momento della misura. I file vengono dal diff
base→head dei commit GitHub; le conclusioni/log CI sono stati letti da GitHub Actions. Il sandbox non
consente rete a `gh`, quindi la raccolta di questa esecuzione è passata dal connettore GitHub; lo
script riproducibile usa `gh pr list`, `gh run list` e `gh run view --log-failed`.

- Failure osservate: 2 (`tdd-evidence` su PR #2734 e #2719).
- Failure previste: 2.
- Miss: 0.
- Recall: **100% (2/2)**.
- Esclusione esplicita: PR #2711, run `35064876150`, è fallita nel checkout per un ref lock prima
  dell'avvio del gate; resta nel report come failure infrastrutturale irrisolta, non nel denominatore.

|   PR | file | gate previsti | failure osservate        | miss |
| ---: | ---: | ------------: | ------------------------ | ---- |
| 2772 |    5 |           175 | —                        | —    |
| 2771 |    1 |           136 | —                        | —    |
| 2769 |   11 |           175 | —                        | —    |
| 2766 |   16 |           154 | —                        | —    |
| 2764 |   37 |           155 | —                        | —    |
| 2762 |   40 |           175 | —                        | —    |
| 2759 |    4 |           139 | —                        | —    |
| 2757 |   49 |           154 | —                        | —    |
| 2754 |    9 |           140 | —                        | —    |
| 2752 |    8 |           140 | —                        | —    |
| 2749 |    4 |           175 | —                        | —    |
| 2750 |    4 |           139 | —                        | —    |
| 2748 |    4 |           136 | —                        | —    |
| 2744 |    5 |           139 | —                        | —    |
| 2743 |  175 |           175 | —                        | —    |
| 2742 |    9 |           139 | —                        | —    |
| 2739 |   17 |           173 | —                        | —    |
| 2734 |  261 |           175 | tdd-evidence             | —    |
| 2723 |   40 |           154 | —                        | —    |
| 2722 |  592 |           175 | —                        | —    |
| 2721 |   54 |           154 | —                        | —    |
| 2720 |   39 |           154 | —                        | —    |
| 2719 |    2 |           138 | tdd-evidence             | —    |
| 2717 |   10 |           154 | —                        | —    |
| 2716 |    9 |           175 | —                        | —    |
| 2715 |   61 |           155 | —                        | —    |
| 2713 |   41 |           132 | —                        | —    |
| 2711 |   83 |           155 | infra: checkout ref lock | n/a  |
| 2708 |   45 |           154 | —                        | —    |
| 2707 |   86 |           155 | —                        | —    |

Gap di precisione nominato, non nascosto: 116 entry del registry restano `ALWAYS`; inoltre blacklist
e limite fail-safe oltre 500 file producono legittimamente tutti i 175 gate. Il backtest prova la
recall sul campione, non una buona precisione. Questo report va copiato anche in #2745 dal
coordinatore; questa slice non modifica #2745.

## #2767 slice C — ammissione criteri di accettazione (2026-09-20)

All'ingresso `plan → red`, un task GitHub confronta il corpo della issue con la lista congelata nel piano.
Sono accettati checkbox o bullet sotto “Acceptance Criteria”; gli id `AC-N` sono preferiti, ma i bullet
senza id usano la posizione e devono comunque avere testo normalizzato identico nel piano namespaced.
Una issue senza criteri leggibili blocca e richiede chiarimento; `gh` indisponibile, timeout o risposta
malformata produce `NO DATA` con exit 2, senza avanzare la fase. Gli id non GitHub (per esempio Jira)
scrivono uno `SKIP` esplicito e continuano con la normale validazione locale del piano.

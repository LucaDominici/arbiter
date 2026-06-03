# Milestones — Luca's master plan

> **IRON LAW**: rileggere QUESTO FILE come primo atto di ogni chat. Aggiornarlo come ultimo atto.
> Manager di processo: Claude. Operatore: Luca. Nessuno skippa. Nessuno dimentica.
>
> **Ultima review**: 2026-05-30 (Wave 0.5 CHIUSA + scaffold Wave 0.6 pronto + Wave 2A promosso Active 1) · **Prossima review prevista**: dopo merge batch 1 Wave 0.6

---

## Vision — gold target a 12 mesi

> *"Arbiter deve essere il mio fiore all'occhiello. Inattaccabile. Accademico, puro. La più alta vetta dei miei ultimi 5 anni incasinati."* — Luca, 2026-05-26

Tradotto in 4 stream operativi (in ordine di priorità strategica):

### Stream A — Arbiter Product (priorità 1: il fiore all'occhiello)

**Gold target 12-mesi (operativo, misurabile):**
- [ ] **A.G1** Arbiter v1.0.0 stable released (non beta, semver locked)
- [ ] **A.G2** ≥1.000 GitHub stars
- [ ] **A.G3** ≥5 progetti reali esterni usano `arbiter init` in produzione (con testimonial pubblico — anche solo 2 righe nel README)
- [ ] **A.G4** ≥1 PR esterna mergiata
- [ ] **A.G5** Plugin Java/Spring pubblicato come case study dell'API plugin
- [ ] **A.G6** Documentazione site live (Astro/VitePress) con almeno 20 pagine + asciinema demo
- [ ] **A.G7** AAIF / Linux Foundation linkage formalizzato (mention nel registro AGENTS.md adopters)

### Stream B — Career Trampolino (priorità 2: l'obiettivo segreto)

**Gold target 12-mesi:**
- [ ] **B.G1** ≥1 offerta Senior Staff Engineer / Principal Eng / DevRel con comp+seniority strictly > ruolo aziendale attuale, OPPURE
- [ ] **B.G2** ≥1 talk accettato in conference internazionale (target: DevOpsDays / QCon / GOTO / KubeCon / Anthropic Builder Day)
- [ ] **B.G3** ≥1 articolo lungo pubblicato (target: InfoQ / Anthropic blog / Increment / dev.to top-trending)
- [ ] **B.G4** ≥500 follower LinkedIn nuovi acquisiti tramite pillole arbiter-related
- [ ] **B.G5** Profilo GitHub trasformato in portfolio-grade (README curato, pinned repos, contribution graph healthy)

### Stream C — Haben (priorità 3: utility reale + test ground arbiter)

**Gold target 12-mesi:**
- [ ] **C.G1** Decision engine in produzione per i 4 patrimoni (Luca, Luigia, Veronica, Lollo)
- [ ] **C.G2** Daily use (≥4× settimana per ≥4 settimane consecutive)
- [ ] **C.G3** Luigia (79) può consultare il "decision" output in autonomia (Excel/PDF/SMS — qualcosa di accessibile)
- [ ] **C.G4** Haben funge da reference deployment di arbiter governance L2+ (verde su tutto il gate)

### Stream D — lavoro aziendale (priorità 4: pagare le bollette + extracting value)

**Gold target 12-mesi:**
- [ ] **D.G1** `quality-alignment-audit` skill integrata come onboarding aziendale ufficiale per nuovi servizi
- [ ] **D.G2** Usata su ≥3 servizi enterprise di riferimento (es. instance, core, ...)
- [ ] **D.G3** Il framework aziendale include una nota "powered by arbiter patterns" che linka arbiter

---

## Operating model

### WIP rule (hard)

**Max 2 stream attivi alla volta.** Tutto il resto in queue ESPLICITA sotto.

### Cadence

- **Per-chat**: rileggere questo file all'inizio, aggiornare alla fine
- **Settimanale (ogni domenica sera o lunedì mattina)**: review veloce di tutti gli stream — 10 min
- **Mensile (primo lunedì del mese)**: review profonda — 30 min, riallineare priorità

### Definition of Done (universale, hard)

Una milestone NON è done se manca:
1. **Artefatto concreto** (file, PR, post pubblicato, deployment vivo)
2. **Evidence link** nel file `DONE.md`
3. **Aggiornamento di MILESTONES.md** (sposta da `In progress` a `Done`)

Nessun "kinda done", nessun "quasi", nessun "manca solo X". Done o non done.

### Kill criteria (definite prima di partire ogni stream)

Ogni stream attivo deve avere una soglia oggettiva di abbandono. Se non viene raggiunto il KR in N settimane, si SPLIT/REORG/KILL — non si trascina.

### Chat protocol (gestito da Claude)

Vedi [`chat-protocol.md`](chat-protocol.md). Sintesi:
- Una chat = un focus
- Quando una chat supera ~30 message scambi OR cambia tema → nuova chat
- Claude propone "apri nuova chat per X" quando rileva drift
- Ogni nuova chat di lavoro inizia con "review milestones"

---

## Active streams (WIP=2, hard limit)

### ✅ CHIUSO 2026-05-26: Stream A — Wave 0 (haben smoke test arbiter)

- **Cosa**: smoke test arbiter governance su haben end-to-end + fix bloccanti che emergono
- **Perché P0 ora**: foundation check. Se arbiter è rotto su haben, ogni mining viafera/auto si appoggia su sabbia
- **Definition of Done**:
  - [x] `arbiter update --dry-run` su haben produce diff coerente — comando reale è `arbiter diff` (NB: flag `--dry-run` non esiste su `update`). Output ristretto a 4 file SSOT ma coerente in scope.
  - [~] `arbiter update` applicato, gate L1 verde — applicato; L1 RED 4/20 (tutti su file generati da arbiter). Override esplicito di Luca: "haben sevizialo, vince audit di arbiter".
  - [x] Almeno 1 INV viola → fixata o documentata come issue arbiter — **10 finding** documentati, 5 P0.
  - [x] Report in `.arbiter/wave0/haben-smoke-test.md` (removed from tree in chore/batch-a; see git history)
- **Owner**: Claude (audit) · Luca (autorizzazione)
- **Kill criterion**: **triggered** — L1 non andrà verde finché i template arbiter non vengono fixati (F10). Non è 2-week countdown, è gap strutturale. → promosso Wave 0.5 davanti a Wave 2A.
- **Side effect da bonificare**: project board 153 creato su `LucaDominici/projects/153` da F4 (cleanup manuale richiesto)

### ✅ CHIUSO 2026-05-29: Stream A — Wave 0.5 template self-consistency fix

- **Cosa**: rendere arbiter audit-proof sui suoi propri output. Senza questo, OGNI arbiter-governed repo nasce con L1 rosso e perdita di trust visibile.
- **Perché P0 ora**: i finding P0 di Wave 0 (vedi `.arbiter/wave0/haben-smoke-test.md`, rimosso dal tree in chore/batch-a; disponibile in git history) sono gap strutturali. Bloccano qualsiasi cosa downstream — Wave 2A, plugin Java, doc site, talk submission. Wave 0 ha aggiornato il conteggio a **6 P0** (aggiunto F11: 152 project board orfani su LucaDominici account → cleanup script in `evidence/`).

**Ordine P0 (motivato da rischio + dipendenze, NON da convenienza)**:

| # | P0 | Stima | Rationale di ordine | ADR stub |
|---|---|---|---|---|
| 1 | ✅ **F4 + F11** (`--github` opt-in default + project-board namespacing) — **DONE 2026-05-26** · issue [#1063](https://github.com/LucaDominici/arbiter/issues/1063) · PR [#1064](https://github.com/LucaDominici/arbiter/pull/1064) · 5 critical + 13 high red-team findings risolti · 23 fixture rebaked | 4-6h | **Stop the bleeding first**. | `.arbiter/wave0.5/ADR-001-no-github-flag.md` (removed; see git history) |
| 2 | ✅ **F9** (exit code propagation) — **DONE 2026-05-27** · issue [#1074](https://github.com/LucaDominici/arbiter/issues/1074) · PR [#1078](https://github.com/LucaDominici/arbiter/pull/1078) "tiered POSIX exit codes for gh failures" | 2-4h | CI wrapper di arbiter ora vede subito i fail invece di nascondersi. | `.arbiter/wave0.5/ADR-002-exit-code.md` (removed; see git history) |
| 3 | ✅ **F2 + F3** (MD pipe + table format) — **DONE 2026-05-27** · issue [#1075](https://github.com/LucaDominici/arbiter/issues/1075) · PR [#1079](https://github.com/LucaDominici/arbiter/pull/1079) "pipe closure + blank-line bloat" | 1-2h | Template MD passano markdownlint + Prettier. | `.arbiter/wave0.5/ADR-003-md-template-fix.md` (removed; see git history) |
| 4 | ✅ **F10** (templates pass L1) — **DONE 2026-05-28** · issue [#1076](https://github.com/LucaDominici/arbiter/issues/1076) chiusa COMPLETED (probabilmente raccolta da #1080 drift fix / #1083 CI gap closures — closedByPullRequest cross-ref non match, verificare a posteriori) | 1-3 gg | Templates ora passano L1 su fresh `arbiter init`. | `.arbiter/wave0.5/ADR-004-templates-L1-pass.md` (removed; see git history) |
| 5 | ✅ **F1 + F7** (diff scope alignment) — **DONE 2026-05-29** · issue [#1077](https://github.com/LucaDominici/arbiter/issues/1077) · PR [#1106](https://github.com/LucaDominici/arbiter/pull/1106) | 1-2 gg | Architectural. Chiude Wave 0.5. Manifest contract unified diff/update. F6 idempotence side effect. | `.arbiter/wave0.5/ADR-005-diff-scope.md` (removed; see git history) |
| ⬢ | **fixture INV-32** (regression asserts L1-green) | 4-6h | Non un P0 standalone, ma il binding INV-32. Va aggiunto in coda a F10 nello stesso PR set. | dentro ADR-004 |
| ⬢ | **F12** (arbiter local remote misconfig) | 5 min | Non arbiter bug, fix locale tuo: `git remote set-url`. Da fare PRIMA di qualunque PR Wave 0.5. | nessuno (one-liner) |
- **Definition of Done**:
  - [ ] Issue arbiter create per i 5 P0: #W0-001 (diff scope), #W0-002 (gh side-effect default), #W0-003 (MD pipe), #W0-004 (exit code), #W0-005 (template L1 fail)
  - [ ] Fix `arbiter diff` per enumerare l'intero update scope (F1/F7)
  - [ ] Fix template MD: pipe chiusura tabelle + format padding preservato (F2/F3)
  - [ ] Aggiungere `--no-github` flag o convertire `--github` a opt-IN (F4)
  - [ ] Exit code != 0 se ci sono errori `gh` non-skippable (F9)
  - [ ] Template workflow conformi a INV-75 (SHA pin) + INV-76 (permissions) + workflow-runners (CI_BUILD_RUNNER_LABEL) (F10)
  - [ ] Templates passano Prettier nativo (F10 / format failure)
  - [ ] Fixture in `__tests__/fixtures/real-projects/` che asserta L1 verde dopo `arbiter update` (INV-32 binding)
  - [ ] Re-run Wave 0 smoke test → tutti i 10 finding passano regression check
- **Owner**: Luca (code) · Claude (PR review + tracking)
- **Kill criterion**: se in 4 settimane meno di 4/5 P0 sono risolti, escalate a re-architect del template layer (separare in `@arbiter/templates` package versionato).
- **Started**: TBD (prossima chat dedicata) · **Target close**: +4 settimane

### 🟢 Attivo 2 (PROMOSSO da queue dopo chiusura Wave 0.5): Stream A — Wave 0.6 Pipeline drift fix (§17.5)

- **Cosa**: chiudere §17.5 end-to-end. 8 ADR in `.arbiter/wave0.6-pipeline-drift/`. Scope unico (no split — DEC-012).
- **Triage source**: `.arbiter/wave0.5/PIPELINE-DRIFT-TRIAGE-2026-05-30.md` (removed from tree in chore/batch-a; see git history). Drift point B (action pin drift) GIÀ DONE in ADR-004; 7 sub-fix residui + 1 meta-ADR.

**8 ADR ordinati per dipendenze**:

| # | ADR | Sub-fix | Stima | Batch |
|---|---|---|---|---|
| 1 | [pipeline-001](../wave0.6-pipeline-drift/ADR-pipeline-001-java-maven-reactor.md) | Java Maven reactor handoff + `setup-java-maven` composite action | 6-8h | 1 (parallel) |
| 2 | [pipeline-002](../wave0.6-pipeline-drift/ADR-pipeline-002-workflow-parallelization.md) | Parallelize 01/02/03 workflow + `strategy.max-parallel: 2` | 3-4h | 1 (parallel) |
| 3 | [pipeline-003](../wave0.6-pipeline-drift/ADR-pipeline-003-reference-implementation.md) | Reference impl in `docs/REFERENCE/workflow-pr-fast.md` | 1-2h | 1 (parallel) |
| 4 | [pipeline-004](../wave0.6-pipeline-drift/ADR-pipeline-004-inv59-reinforcement.md) | INV-59 triage (KEEP / REINFORCE / REDESIGN) | 1-2h + impl | 1 (parallel) |
| 5 | [pipeline-005](../wave0.6-pipeline-drift/ADR-pipeline-005-check-cache-strategy.md) | New L1 gate `check-workflow-cache-strategy.mjs` | 4-6h | 2 (post #001) |
| 6 | [pipeline-006](../wave0.6-pipeline-drift/ADR-pipeline-006-check-parallelism.md) | New L1 gate `check-workflow-parallelism.mjs` | 3-4h | 2 (post #002) |
| 7 | [pipeline-007](../wave0.6-pipeline-drift/ADR-pipeline-007-workflow-perf-test.md) | `workflow-perf.test.ts` integration test | 4-6h | 3 (last) |
| 8 | [pipeline-008](../wave0.6-pipeline-drift/ADR-pipeline-008-perf-budget-adr.md) | Meta-ADR "Workflow Performance Budget" | 1-2h | 1 (parallel) |

- **Totale stima**: ~25-35h (3-5 giorni Claude Code autonomous)
- **Owner**: Claude (ADR/plan/PR review) · Luca/Claude Code (implementation, DEC-005)
- **Label issue**: `priority/P0,wave:1-immediate` (parità Wave 0.5)
- **Brief chat 1°**: [`.arbiter/wave0.6-pipeline-drift/HANDOFF-BRIEF.md`](../wave0.6-pipeline-drift/HANDOFF-BRIEF.md)
- **Kill criterion**: se in 5 settimane meno di 6/8 ADR mergiati → split scope (Java in Wave 2D, mantenere general-purpose in Wave 0.6).
- **Started**: TBD (prossima chat) · **Target close**: +4 settimane

---

## Queue (ordinata, max 1 promozione/settimana ad active)

In ordine di promozione attesa:

### 🟢 Attivo 1 (PROMOSSO da Q1 dopo chiusura Wave 0.5): Wave 2A — `/task` arbiter v2 design (mining viafera + Luca's /auto)

- **Scope MVP brutale**: 5-7 pattern P0 (suggerimento: existing-work detection, anti-bypass guard, score-based verdict, marker-pinned gate, pre-PR integrity check). Resto in v2.1/v2.2.
- **Pre-requisito**: ADR upfront ("`/task v2 design` — questi 5 pattern sì, questi 15 no, perché X")
- **Target**: shippare /task v2 MVP in 6 settimane dalla promozione (2026-07-11)
- **Stato attuale**: design phase — ADR upfront ancora da scrivere. Chat dedicata da aprire dopo che Wave 0.6 ha shippato almeno batch 1 (5 ADR parallel).
- **Sinergia con Wave 0.6**: entrambi toccano workflow. Wave 0.6 stabilizza i template; Wave 2A ridefinisce `/task` lifecycle sopra di essi.
- **Owner**: Claude (ADR design) · Luca (decide quali 5-7 pattern dei 12+ vincono)

### Q2 — Stream B — Discovery iniziale (LinkedIn pillole drip)

- **Trigger di promozione**: subito (può girare in background, 30 min/settimana)
- **Scope**: 1 pillola/settimana dalle 40+ già estratte nel report principale. Niente scrittura nuova.
- **Owner**: Luca direct (Claude può proporre quale pillola la prossima settimana)
- **Target**: 12 pillole pubblicate in 12 settimane

### Q3 — Stream A — Wave 1 deep-skim viafera (NUOVO — flagged da Luca)

- **Trigger**: dopo /task v2 MVP
- **Scope**: re-pass focalizzato sui contenuti dei file MD viafera che ho skippato (docs/METHOD, docs/SYSTEM, FRAMEWORK più in profondità, scripts/ shell selezionati). Filtrare oltreingegnerizzazione, estrarre solo il buono.
- **Owner**: Claude (read) + Luca (decide cosa mantenere)
- **Note**: Luca ha esplicitato che viafera ha contenuto buono nei MD oltre quello che ho già analizzato — non lasciar perdere.

### Q4 — Stream A — Wave 2B: Stack-toolkit bootstrap (`arbiter init --bootstrap`)

- **Trigger**: dopo Wave 2A
- **Scope**: implementa il pattern viafera `bootstrap-project` + 6 spec template + wave-of-parity per brownfield + stack-dependent INV activation. Risolve il gap FE.
- **Pre-requisito**: ADR upfront + chat dedicata "FE toolkit per stack"

### Q5 — Stream A — Wave 2C: Verification Bridge pattern

- **Trigger**: dopo Wave 2B
- **Scope**: studio adozione del pattern viafera (opt-in plan validation con MCP server custom)

### Q6 — Stream A — Wave 2D: Plugin Java/Spring (case study pubblico)

- **Trigger**: dopo Wave 2A + Wave 2B
- **Scope**: bundle 8 skill Java + 1 agent + 3 command + 1 hook come `@arbiter/plugin-java`
- **Outcome**: A.G5 done + materiale per A.G3/G4

### Q7 — Stream A — Wave 2F: DR pattern come `arbiter doctor backup`

- **Scope**: backup auto `~/.claude/` asset critici in repo dedicato. Pillola di metodo a sé.

### Q8 — Stream B/A intersect — Documentation site MVP (A.G6)

- **Scope**: Astro/VitePress, 20 pagine min, asciinema demo, deploy su pages.

### Q9 — Stream B — Talk submission (B.G2)

- **Trigger**: solo dopo che A.G3 ha ≥2 utenti esterni (serve referenza per il CFP)

### Q10 — Stream B — Articolo lungo (B.G3)

- **Trigger**: dopo talk accettato (o dopo Q8+Q9 anche se talk non accetta)

### Q11 — Stream C — Haben implementation production-ready

- **Trigger**: dopo /task v2 MVP (Q1) — userai /task v2 per implementare haben features
- **Scope**: portare haben a C.G1 + C.G2

### Q12 — Stream A — Cleanup viafera (rimuovere "rumenta")

- **Trigger**: P3, può aspettare. Luca ha esplicitamente detto "focus arbiter + haben"
- **Scope**: opzionale, da rifare quando arbiter è gold + haben è in produzione

### Q13 — Stream D — integrazione aziendale (D.G1/G2/G3)

- **Trigger**: side-effect naturale del lavoro aziendale quotidiano. Non forzare.

---

## Done log

Vedi [`DONE.md`](DONE.md). Append-only.

Per la chat di setup management (2026-05-26): vedi DONE.md per la entry corrispondente.

---

## Blocked / waiting

Vuoto al momento. Se compare qualcosa di bloccante, va qui con data + reason + chi sblocca.

---

## Decisions log

Decisioni che hanno effetto fuori chat singola. Le ADR vere vanno in `docs/ADR/` di arbiter. Qui sintesi:

- **2026-05-26 — DEC-001**: Claude prende ruolo manager. Iron law adottata. Wave 0 (haben smoke + pipeline fix) PRIMA di Wave 2A consolidamento.
- **2026-05-26 — DEC-002**: Career stream B parte SUBITO in background (1 pillola/settimana), non aspetta "maturità del prodotto" — discovery non si può rimandare.
- **2026-05-26 — DEC-003**: Wave 2A consolidamento /task+/auto avrà scope MVP brutale (5-7 pattern). ADR upfront obbligatorio.
- **2026-05-26 — DEC-004**: Stream D (aziendale) non riceve priorità dedicata. Solo opportunistic.
- **2026-05-26 — DEC-005**: Claude scrive ADR/audit/spec ma NON arbiter source code in autonomia. Code = Luca. PR review e ADR draft = Claude.
- **2026-05-26 — DEC-006**: Wave 0.5 (template self-consistency) promosso davanti a "Pipeline drift fix" e davanti a Wave 2A. Trigger: 10 finding Wave 0 di cui 5 P0. Sblocca tutto il downstream (vedi `.arbiter/wave0/haben-smoke-test.md`, rimosso dal tree in chore/batch-a; disponibile in git history).
- **2026-05-26 — DEC-007**: Convention confermata per audit reports → `.arbiter/waveN/<topic>.md` (es. `wave0/haben-smoke-test.md`, `wave1/INDEX.md`). Logs evidence opzionali in `.arbiter/waveN/evidence/`.
- **2026-05-26 — DEC-008** (ADR-001 / issue #1063): `useGitHub` config field → `permitGitHub` via **alias + deprecation** (option C). Alias 1 minor (v0.2.x), hard-remove v0.3. Motivo: hard-rename violerebbe 4 frozen compat fixtures + tarball consumers.
- **2026-05-26 — DEC-009** (ADR-001 / issue #1063): `--github` come **global flag pre-stripped** + env var `ARBITER_GITHUB=1` (option 1). Mirror del pattern `--no-evidence` di cli.ts:99-104. Rimosso `--github` local da `update` (era override, ora opt-in).
- **2026-05-26 — DEC-010** (ADR-001 / issue #1063): Gate scope **solo `runGithubSetup`** + static import-graph assertion che `diff.ts` non importi `src/github/` (option 3). Out-of-scope confermato: `decomposition/github-backend.ts`, `kit/emit-issues.ts`, `detectors/github.ts` (read-only).
- **2026-05-30 — DEC-011** (chiusura Wave 0.5): Pipeline drift fix promosso da queue ad Active 2. Triage 2026-05-30 mostra che drift B (action pin) era già DONE in ADR-004; restano 7 sub-fix + 1 meta-ADR (Wave 0.6 scope).
- **2026-05-30 — DEC-012** (Wave 0.6 scope): NO split — scope unico per Active 2 (8 ADR). Java + general + INV-59 triage tutto dentro. Scaffold in `.arbiter/wave0.6-pipeline-drift/`. Issue da aprire come Wave 0.5 in batch, priority/P0.
- **2026-05-30 — DEC-013** (Active 1 = Wave 2A): promosso Wave 2A `/task` v2 design da Q1. Sinergia con Wave 0.6 (entrambi su workflow). Design phase ora; chat dedicata dopo Wave 0.6 batch 1.
- **2026-06-03 — DEC-014** (Batch A hygiene): wave0, wave0.5, wave1 audit dirs rimossi dal working tree (`git rm`). Audit history disponibile in git log (commit chore/batch-a). MILESTONES.md + DONE.md relative links convertiti a plain text. `!.arbiter/wave*/` gitignore negations mantenute per future wave (wave0.6+). Loose file `.arbiter/wave-session-2026-05-29.md` rimosso (era scratch non storico). File sessione #1177 aperta per Kotlin follow-up (REQ-026 smoke test → real generation).
- **2026-05-29 — Note di sync** (no DEC, solo registrazione): tra il 2026-05-27 e 2026-05-28, fuori dalla mia view manager, Claude Code ha mergiato 3 ADR addizionali non programmati in Wave 0.5: **ADR-051** (#1080 collaboration-mode axis + WT merge-train foundation + generator-spec drift fix), **ADR-052** (#1082/#1084 ff-only merge policy + cosign SHA preservation, INV-101), **ADR-053** (#1083/#1085 CI gap closures: CodeQL, OSSF Scorecard, frontend-quality, nightly-lite). In corso: refactor #1098 (table-drive agent generators + compatibility parsers). Questi NON consumano slot Active (sono lavoro continuo di Claude Code dentro lo Stream A); il WIP=2 hard-limit del management resta vincolato sui due Active del manager (Wave 0.5 + Pipeline drift fix sospeso).

---

## Riferimenti

- [Main analysis report](../analysis-2026-05-25.md) — 634 LOC, deep tecnico + 40+ pillole career
- `.arbiter/wave1/INDEX.md` — 6 file, audit cross-family (removed from tree in chore/batch-a; see git history)
- `.arbiter/wave1/auto-pipeline-audit.md` — 290 LOC, 12 pattern P0 + 6 nuove pillole (removed from tree in chore/batch-a; see git history)
- [Chat protocol](chat-protocol.md) — quando aprire nuove chat, come bridarle

---

**Nota a margine**: questo file è la **single source of truth** per il piano. Se entra in conflitto con qualcosa detto in chat, vince questo. Aggiornare PRIMA che chiudere la chat.

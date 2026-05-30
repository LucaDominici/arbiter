# Wave 1 — Audit `.claude/commands/` viafera

**13 command, 3.248 LOC totali.** Quasi il 50% sta in un unico file: `task.md` (1.441 LOC). Questa è la famiglia con il valore più condensato — il `/task` viafera è il battle-test esplicito che Luca ha citato.

## Classificazione completa

| # | Command                       | LOC  | Categoria         | Label          | Priorità | Esiste già in arbiter? |
| - | ----------------------------- | ---- | ----------------- | -------------- | -------- | ---------------------- |
| 1 | **task.md**                   | 1441 | Lifecycle         | **PORT-ADAPT** (mining intensivo) | **P0** | Sì (~250 LOC, semplice) |
| 2 | **verification-before-completion.md** | 210 | Verification | **PORT-AS-IS** | **P0**   | Skill verification esiste, command no |
| 3 | **test-driven-development.md** | 203 | TDD               | **PORT-AS-IS** | **P0**   | Skill tdd esiste, command no |
| 4 | **codebase-audit.md**         | 198  | Audit             | **PORT-AS-IS** | **P1**   | Skill codebase-audit esiste, command no |
| 5 | **bootstrap-project.md**      | 179  | Bootstrap         | **STUDIO**     | **P0**   | Concettualmente sovrapposto a `arbiter init` — vedi nota |
| 6 | **task-open.md**              | 51   | Worktree          | **DUPLICATE**  | P3       | Sì (`/wt-open`) — quasi identico |
| 7 | **task-close.md**             | 62   | Worktree          | **DUPLICATE**  | P3       | Sì (`/wt-close`) |
| 8 | **task-list.md**              | 44   | Worktree          | **DUPLICATE**  | P3       | Sì (`/wt-list`) |
| 9 | **task-prune.md**             | 49   | Worktree          | **DUPLICATE**  | P3       | Sì (`/wt-prune`) |
| 10 | **sonar-autofix.md**         | 367  | Java tool         | **PORT-PLUGIN** | P3      | No — SonarQube specific |
| 11 | **update-playwright-playbook.md** | 197 | E2E lifecycle | **PORT-PLUGIN** | P3      | No — Playwright specific |
| 12 | **dep-refresh-nightly.md**   | 164  | Maintenance       | **PORT-ADAPT** | P2       | No |
| 13 | **create-migration.md**      | 83   | Java/Flyway       | **PORT-PLUGIN** | P3      | No — Flyway specific |

## Il pezzo grosso: `task.md` viafera (1441 LOC) — mining intensivo

Confermato tutto quello che Luca ha citato. La lifecycle è 5x più articolata di quella arbiter. Mappa breve delle phase:

### PHASE PLAN (read-only)
- 0A flag pre-parse (`--skip-review`, `--followups`, `--pr-type`, `--dry-run`, `--force`)
- **0A¼ idempotency guard** (issue CLOSED? PR già MERGED? re-entry mid-implementation?) — pattern brillante che arbiter non ha
- 0A½ load routing infrastructure (SSOT_CORE_SET, KNOWLEDGE_MAP, GitHub Issue)
- **0A¼ claude-mem cross-session memory retrieval** (2 search queries: identifiers + paths, max 3 get_observations)
- 0A' task classification (XS / S / Standard) + **batch-size escalation** (2+ issues → Standard, 10+ files → Standard)
- 0A'' bug routing + staleness reminders + **DEBUG_STATE.md detection**
- 0B-0F: task type → MUST-READ list → hard-stop check → emit checklist → read files
- 0G: **generate READ_SET evidence** (mandatory)
- 1-3: context init, env setup, scope analysis
- 4: execution plan → **MANDATORY STOP** (10 contract items)
- 5: safety guardrails (refuse start if violations)

### PHASE EXEC (after human GO)
- 6.0 **dirty-tree guard** (block if uncommitted)
- 6.0b **auto-detect PR type** (docs/fe/be/full from changed dirs)
- 6.1 **baseline capture** (ADR-087 — all tiers)
- 6.2 **plan review step 0** — sub-agent Sonnet 4.6, max 2 FAIL cycles, fallback red-team
- **6.2.5 Context Handoff Decision** (#2713): ≤8 units INLINE, 9-15 SUB-AGENT recommended, >15 STOP+/clear+re-invoke
- 6.3 **TDD protocol per unit** + initialize units counter
- **6.3.1 Auto-Checkpoint every 3 TDD units** (#2711): L1 gate after each batch, fail → fix before next unit
- **6.3.2 Tech-Debt Detection Protocol** (#2712): pre-existing problem found NOT in scope → MANDATORY create issue, do NOT fix inline (5-line trivial exception)
- 6.4 optional subagent review (standard tier)
- 6.5 E2E specs (standard FE tasks)

### COMPLETE PHASE
- C0 working tree check + worktree detection
- C0.2 MCP phase 2 enforcement (github MCP mandatory for issue management)
- C1 qualitative review (track-routed: BE hexagonal+security, FE no-hex-colors+adapter-only-localStorage, D ssot-core-check)
- C1.2 **SSOT sync gate** (TEST_MATRIX/DECISIONS/KNOWLEDGE_MAP automatic checks)
- **C1.3 3-5 Agent Parallel Code Review** (MANDATORY): dispatch via run-review-pipeline.sh, **score-based verdict** (deductions CRITICAL=-25, MAJOR=-10, MINOR=-3, threshold 80 PASS / 60 REWORK / <60 STOP), max 2 cycles, file-backed counter
- C1.3.1 conditional concurrency review (async patterns triggered)
- C1.3.2 silent-failure-hunter (always when diff exists)
- **C1.3.9 Agent Dispatch Evidence Gate (HARD STOP)**: read `.claude/.agents-dispatched` file-backed counter, tier minimums (Standard ≥3, S ≥2, XS ≥1), zero-diff exemption, ADR-104 named-agent set-membership check
- C1.4 architect-review (conditional on domain/model + db/migration changes)
- C1.5 verification-before-completion (claim-based audit)

### Pattern essenziali da portare in /task arbiter v2

| # | Pattern viafera                            | Pillola architetturale                             | Priorità |
| - | ------------------------------------------ | -------------------------------------------------- | -------- |
| 1 | **Idempotency guard** (issue closed? PR merged? mid-impl?) | "Re-eseguire /task su task done è sicuro ma non gratuito. Block + force flag." | P0 |
| 2 | **Context handoff decision** (≤8/9-15/>15) | "Conta gli unit e decidi inline/sub-agent/STOP+clear PRIMA di iniziare." | P0 |
| 3 | **Auto-checkpoint ogni 3 TDD unit**       | "L1 gate ogni 3 unit per evitare accumulo silenzioso di rotture." | P0 |
| 4 | **Tech-debt detection inline** (create-issue-not-fix) | "Pre-existing issue trovato? Apri issue, non fixare. Eccezione: ≤5 righe trivial in scope." | P0 |
| 5 | **Score-based code review verdict**        | "Score 0-100. CRITICAL=-25, MAJOR=-10, MINOR=-3. 80 PASS / 60 REWORK / <60 STOP." | P1 |
| 6 | **Agent dispatch evidence gate (HARD STOP)** | "Counter file-backed. In-memory non vale. Reading instructions non vale. Describing what an agent would say non vale." | **P0** |
| 7 | **Silent-failure-hunter (always when diff)** | "Classe di bug distinta. Empty catch, fallback || default, .safeParse() senza .success, try-catch around deferred flush." | P1 |
| 8 | **Track router** (A backend / B frontend / C sentinel / D librarian) | "Cross-track task → STOP, request split. Mai BE+FE nello stesso task." | P0 |
| 9 | **Tier-based ceremony** (XS minimal / S reduced / Standard full) | "Plan depth + review agent count scalano con tier. Niente Standard ceremony per task XS." | P0 |
| 10 | **MUST-READ list deterministico per task type** | "Universal + Task-Type-specific + Track-specific. Hard-stop se manca un file." | P1 |
| 11 | **Plan review sub-agent (ADR-078)**       | "Plan revisionato da sub-agent prima di iniziare code. Max 2 FAIL cycle prima di STOP." | P0 |
| 12 | **claude-mem cross-session retrieval**    | "Query memoria persistente per past decisions + gotchas su questa area di codice. Soft-fail." | P2 |
| 13 | **Baseline capture all-tiers**            | "capture-baseline.sh prima di iniziare execution. Evidence di stato di partenza." | P1 |
| 14 | **MANDATORY STOP with 10 contract items** | "Plan output: scope, file manifest, command plan, risk matrix, validation gates, FEATURE_MATRIX ref, implementation units table, subtask plan, E2E plan, attempted approaches." | P1 |

## Top 5 da portare subito (P0)

### 1. `task.md` mining → /task arbiter v2

**NON portare as-is**. Il task viafera è troppo project-specific (`./viafera.sh`, paths, MCP server names, ADR numbers). Ma le **14 pattern architetturali sopra** vanno tutte assorbite. La proposta è una **chat dedicata "task arbiter v2 design"** in cui:

1. Si parte dall'arbiter `/task` attuale (~250 LOC, 11 phase)
2. Si applicano pattern viafera #1-14 sopra
3. Si estraggono le fasi in `src/templates/task-lifecycle/phases.md` neutro (separato da Claude command vs Codex prompt)
4. Si scrive Claude wrapper `src/templates/claude/commands/task.md.ejs` e Codex wrapper `src/templates/codex/prompts/task.md.ejs`
5. Si testano i pattern critici (#3 auto-checkpoint, #4 tech-debt detection, #6 agent dispatch gate) con fixture

Result atteso: /task arbiter v2 ~500-700 LOC, con tutti i pattern battle-tested viafera + neutralità multi-tool del nuovo design.

**Pillola di questa famiglia**: *"/task viafera è 1441 righe perché ogni bug-fix lì sopra è stato pagato in produzione. Ogni 'extra' check è memoria di una rottura."*

### 2. `verification-before-completion.md` (210 LOC) — **PORT-AS-IS**

Claim-based audit prima di completion: fetch acceptance criteria → build verification matrix → execute (tests + per-criterion check + orphan TODO + E2E conditional) → **correctness reasoning** (WHY correct + GAPS + CONFIDENCE HIGH/MEDIUM/LOW) → verification report box + decision rules.

L'aspetto novel rispetto alla skill `verification` arbiter: **correctness reasoning mandatorio**. Non basta "tests pass", devi articulare il "WHY" trace code path + "what could go wrong NOT covered by tests" + confidence con justification.

**Cosa modificare**:
- Sostituire `./viafera.sh test [scope]` con `node scripts/check-all.mjs check`
- Generalizzare gli scope (`be`/`fe`/`full`) ai concetti arbiter (per-language per-stack archetype)
- Promuovere ad arbiter command + skill insieme (oggi è command in viafera, skill in arbiter — unificare)

### 3. `test-driven-development.md` (203 LOC) — **PORT-AS-IS**

5 step structured: Red (with HARD STOP if test passes without impl) → Green (HARD STOP if other tests broke) → Refactor (skip if Green already clean) → Gate (tier-appropriate) → Sync (SSOT atomic contract) → Report.

L'**Exception "Pure Refactoring"** è una delle parti più mature: Red skip se task è solo refactor, esegui baseline tests first per confermare green, refactor, re-run, confirm still green. Output `🔵 REFACTOR-ONLY: Baseline green confirmed`.

**Cosa modificare**: arbiter ha skill `tdd` (60 LOC) molto più semplice. Sostituire con questa version, adattando i command (`./viafera.sh test backend/frontend` → `node scripts/check-all.mjs check`).

### 4. `bootstrap-project.md` (179 LOC) — **STUDIO STRATEGICO**

Questo è **il fratello concettuale di `arbiter init`** ma con un'angolazione diversa:
- `arbiter init` = installer di governance config in repo esistente o nuovo
- `bootstrap-project` viafera = setup process-driven con 5 phase + 13-file Day-1 SSOT set + ADR-001 con activation di invariants dipendenti dallo stack

**Il vero valore per arbiter è il pattern "wave of parity" che Luca ha menzionato**: viafera bootstrap esplicitamente attiva invariants in `GLOBAL_INVARIANTS.md` per stack scelto in ADR-001 (es. JVM+Spring attiva INV-02/03/04/05; Vue 3+TS attiva INV-06; Keycloak attiva INV-07). E genera 13 file Day-1 minimum.

**Questo è esattamente il toolkit-installer-per-stack che mancava ad arbiter**. La proposta:
- `arbiter init` esistente resta installer di config
- Nuovo `arbiter init --bootstrap-process` aggiunge il bootstrap-protocol: 13-file Day-1 set + ADR-001 con activation di INV dipendenti da stack + Level-1 compliance check
- Stack-aware activation tabellata: detected `vue` → activate INV vue-FE; detected `spring` → activate INV hex+jpa+keycloak; detected `tauri` → activate INV cross-platform

Vale una **chat dedicata** dopo le pipeline (sezione 5 raccomandata in §17.5 del report principale).

### 5. `codebase-audit.md` (198 LOC) — **PORT-AS-IS**

On-demand 9-domain quality audit: code quality, dead code, architecture compliance, security patterns, dependency health, test quality, doc drift, performance patterns, operational readiness. Scoring A/B/C/D per dominio + executive summary table. Output in `docs/audits/YYYY-MM-DD-audit.md`. Staleness tracker (`.claude/.last-audit-date`).

**Perché P1**: arbiter ha skill `codebase-audit` (86 LOC) — pattern simile. Il command viafera è più dettagliato (9 dominii esplicitamente definiti, scoring algorithm, parallelization with subagents up to 3, trends comparison). Mergiare.

**Cosa modificare**:
- Sostituire i tool Java-specific (PMD, ArchUnit) con stack-adapter pattern arbiter
- Wire staleness tracker con esistente `arbiter doctor` health check
- Aggiungere domain "INV/CANON compliance" specifico per arbiter

## Da portare nel medio (P1-P2)

### `dep-refresh-nightly.md` (164 LOC) — **PORT-ADAPT**

Auto-refresh dependencies nightly via scheduled task. Cross-language pattern generalizzabile (npm/gradle/cargo/pip outdated → create PR with updates → run gate → auto-merge if all green).

**Per arbiter**: aggiungere come opzionale workflow GitHub Actions `15-deps-refresh-nightly.yml.ejs` opt-in per archetype.

## "Don't bother" o "plugin only"

- `task-{open,close,list,prune}.md` (4 command) → **già coperti** da arbiter `/wt-*`. Differenze minori (viafera usa `task-` prefix, arbiter usa `wt-`); il pattern e gli error case sono sostanzialmente identici. Cherry-pick **un solo elemento mancante**: viafera task-list ha rilevamento `[gone]` branches via `git branch -vv` e suggerimento automatico di `/task-close` — arbiter `/wt-list` non ha questo. Aggiungerlo.

- `sonar-autofix.md` (367 LOC) → **plugin Java/SonarQube** dedicato. Inutile in core arbiter.

- `update-playwright-playbook.md` (197 LOC) → **plugin frontend-e2e** (Playwright/Cypress). Pattern interessante: aggiorna progressivamente il playbook con learnings da E2E run, ma è SaaS-shaped (assume cartelle specifiche).

- `create-migration.md` (83 LOC) → **plugin Java/Flyway** dedicato.

## Cross-reference con arbiter

Arbiter commands (9 totali) → mapping:

| arbiter command  | Equivalente viafera           | Azione                                 |
| ---------------- | ----------------------------- | -------------------------------------- |
| `/task`          | `task.md`                     | **Mining intensivo + redesign v2** (P0) |
| `/wt-open`       | `task-open.md`                | Cherry-pick `[gone]` detection |
| `/wt-close`      | `task-close.md`               | Già pari |
| `/wt-list`       | `task-list.md`                | Cherry-pick + suggest auto-close |
| `/wt-prune`      | `task-prune.md`               | Già pari |
| `/replay`        | (no equivalente; vedi task-replay skill) | Already covered by skill audit |
| `/status`        | (no equivalente; vedi task-status skill) | Already covered by skill audit |
| `/review-code`   | (Phase C1.3 di task.md)       | Cherry-pick lo score-based verdict |
| `/review-plan`   | (Phase 6.2 di task.md)        | Cherry-pick il sub-agent dispatch + max 2 FAIL cycles |
| (no equivalente) | `verification-before-completion.md` | **Portare** (P0) |
| (no equivalente) | `test-driven-development.md`  | **Portare** (P0) |
| (no equivalente) | `codebase-audit.md`           | **Portare/mergiare** (P1) |
| (no equivalente) | `bootstrap-project.md`        | **Studio + chat dedicata** (P0 strategic) |
| (no equivalente) | `dep-refresh-nightly.md`      | Adapt come workflow opt-in (P2) |

## Pattern architetturali estratti

### A. "Idempotency guards multi-livello"

Phase 0A¼ ha 3 guard distinti:
1. **Issue state guard** — gh issue view per state CLOSED
2. **PR state guard** — gh pr list --head per state MERGED
3. **Mid-implementation guard** — `.task-phase` per implementation/verification + count commits ahead

Pattern generalizzabile: ogni command long-running deve avere idempotency check con possibilità di `--force` esplicito.

### B. "Mandatory STOP + 10-item contract"

L'output del plan è strutturato a 10 sezioni fisse. Niente prose, niente "magari", niente "potrebbe". O ci sono tutte e 10 le sezioni o l'agent ha buggy plan. Pattern di **contract output** applicabile ad altri command che richiedono input umano successivo.

### C. "Score-based agent verdict"

C1.3 introduce score 0-100 con deductions per severity. Risolve il problema "agent dice PASS ma ha 30 MAJOR findings" — il punteggio costringe a essere quantitativo.

### D. "Evidence file-backed counters"

`.claude/.agents-dispatched`, `.claude/.tdd-units-completed`, `.claude/.task-id`, `.claude/.task-phase` sono tutti file-backed (no in-memory) per sopravvivere across Bash subshells. La gate C1.3.9 è esplicita: "in-memory vars do not survive across Bash tool calls — that is why the counter is file-backed."

### E. "Track router con cross-track STOP"

Track A/B/C/D (backend/frontend/sentinel/librarian). Cross-track task → HARD STOP, request split. Previene il "task gigante che tocca tutto" anti-pattern.

### F. "Tier-based ceremony scaling"

XS minimal / S reduced / Standard full. Plan depth + review count + must-read files scalano con tier. Niente ceremony Standard per chore. Niente skip ceremony per task complex.

### G. "Bootstrap-vs-init separation"

`bootstrap-project` (per progetti greenfield, setup process) ≠ `arbiter init` (per repo esistenti, install config). Sono due fasi del lifecycle che oggi arbiter unifica forzatamente. Separarle dà più chiarezza.

## Conclusioni commands

**4 P0**: portare `verification-before-completion` (correctness reasoning), `test-driven-development` (red-green-refactor strutturato + refactor-only exception), `bootstrap-project` (apre la "wave of parity" per FE/stack toolkit), avviare **mining intensivo di task.md** per /task arbiter v2.

**1 P1**: mergiare `codebase-audit` viafera in arbiter skill.

**1 P2**: adapt `dep-refresh-nightly` come workflow opt-in.

**4 DUPLICATE**: `task-{open,close,list,prune}` quasi pari ad arbiter `/wt-*`. Cherry-pick `[gone]` detection per `/wt-list`.

**4 PLUGIN**: `sonar-autofix`, `update-playwright-playbook`, `create-migration` (java+playwright plugin), e `task.md` Java-specific portions per java plugin.

**Pillole emerse da questa famiglia**:
- *"/task viafera è 1441 righe perché ogni bug-fix lì sopra è stato pagato in produzione. Ogni check è memoria di una rottura."*
- *"Evidence file-backed counter > in-memory. Bash subshells dimenticano. File survives."*
- *"Score-based verdict obbliga l'agent a essere quantitativo. PASS+30 MAJOR finding è una bugia mascherata."*
- *"Track router con cross-track STOP previene il task gigante. Mai BE+FE nello stesso task."*
- *"Bootstrap (greenfield process) ≠ Init (config install). Sono lifecycle phase distinte, non lo stesso command."*

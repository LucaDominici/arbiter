# Wave 1 — Audit `.claude/agents/` viafera

**8 agent, 1.236 LOC.** Famiglia compatta ma con tre pattern strategici NON presenti in arbiter: MCP-only forensics, surgical invariant fix, fresh library docs.

## Classificazione completa

| # | Agent                | Model  | Effort | LOC | Label          | Priorità | Esiste già in arbiter? |
| - | -------------------- | ------ | ------ | --- | -------------- | -------- | ---------------------- |
| 1 | **antigravity-verify** | sonnet | high   | 389 | **PORT-ADAPT** | P1       | No                     |
| 2 | **fix-invariants**   | sonnet | low    | 198 | **PORT-ADAPT** | **P0**   | No                     |
| 3 | **red-team**         | sonnet | —      | 187 | **DUPLICATE+MERGE** | P1  | Sì (arbiter `red-team`) |
| 4 | **codebase-scanner** | haiku  | low    | 132 | **DUPLICATE**  | P3       | Sì (arbiter `codebase-scanner`) |
| 5 | **ssot-reader**      | haiku  | low    | 108 | **PORT-AS-IS** | **P0**   | No                     |
| 6 | **context7-docs**    | sonnet | low    | 108 | **PORT-AS-IS** | **P0**   | No                     |
| 7 | **code-simplifier**  | —      | medium | 68  | **PORT-AS-IS** | P1       | No                     |
| 8 | **migration-validator** | haiku | —    | 46  | **PORT-PLUGIN** | P3       | No — Flyway-specific |

## Quattro da portare subito (P0)

### 1. `fix-invariants` (198 LOC, sonnet/low effort, worktree isolation) — **PORT-ADAPT**

L'agente che surgicalmente fixa una violazione INV in worktree isolation. Pattern: read audit report, parse violation (INV-XX + file + breach), load INV definition, apply MINIMAL fix, verify with gate, output success/blocked. Constraint forte: "Surgical fixes only - Don't refactor beyond the violation".

**Perché è P0 per arbiter**: arbiter ha 97 INV — molti più di viafera (29). Un agente surgical-fixer è ancora più prezioso per il volume. E si combina nativamente col sistema `arbiter explain INV-NN` esistente.

**Cosa modificare**:
- Sostituire `./viafera.sh ci` con `node scripts/check-all.mjs L1`
- Generalizzare oltre INV-07 (è il primary target in viafera, ma in arbiter ogni INV deve essere candidate)
- Riferimento a `src/invariants/catalog.ts` invece di `docs/METHOD/GLOBAL_INVARIANTS.md`
- Riusare la skill `arbiter:senior-survey` come pre-condizione (se la fix richiede new file)
- Output: usare il formato JSON di arbiter (status: PASS/FAIL/BLOCKED, per INV-53)

**Pillola**: "Surgical fixer agent in worktree isolation. Fixes invariant, not redesigns system."

### 2. `ssot-reader` (108 LOC, haiku, parallel-safe) — **PORT-AS-IS**

Haiku agent per fast SSOT extraction da `GLOBAL_INVARIANTS.md`, `DECISIONS.md`, `ARCHITECTURE.md`. Output JSON strutturato. Cost ~$0.0003 per extraction. Safe per 3+ parallel instances.

**Perché è P0 per arbiter**: arbiter ha `src/invariants/catalog.ts` (97 INV) + `docs/SYSTEM/CANON.md` (21 CANON) + `docs/ADR/` (45+ ADR). Estrarre con haiku in parallelo = molto più economico che leggere file interi con sonnet.

**Cosa modificare**:
- Adattare i path: per arbiter sono `src/invariants/catalog.ts`, `docs/SYSTEM/CANON.md`, `docs/ADR/*.md`
- Aggiungere arbiter-specific extractors: per INV-NN/CANON-NN/ADR-NNN tramite il command `arbiter explain` esistente come backend
- Output JSON con id, title, content, line_range — schema già definito viafera, riusabile

### 3. `context7-docs` (108 LOC, sonnet/low) — **PORT-AS-IS**

Agente delegato per fresh docs via Context7 MCP. Max 2 call per invocation. FAIL-CLOSED se MCP non disponibile. Output formattato come "Documentation: <Library> v<version> ... **Source:** Context7 (<library-id>)".

**Perché è P0 per arbiter**: librerie e framework evolvono velocemente. Un repo arbiter-governed che usa React/Vue/Spring/Tauri/altro beneficia enormemente da fresh docs durante upgrade/migration. È la stessa logica per cui `claude-automation-recommender` raccomanda context7 quasi sempre.

**Cosa modificare**: praticamente niente. La skill esiste già (file separato viafera-skills 22 LOC) + agent. Portare entrambi insieme.

**Caveat**: dipende da MCP esterno context7. Aggiungere documentazione "optional dependency" + fallback to repo docs / pinned versions.

### 4. `code-simplifier` (68 LOC, medium effort) — **PORT-AS-IS**

Agente che applica simplifications targeted al codice del task corrente (`git diff main...HEAD`). Targets in priority order: parameter reduction, method extraction, nesting reduction, duplicate logic, dead assignments, boolean blindness. Limiti deterministici BE vs FE (params, length, nesting depth, methods).

**Perché è P0 per arbiter**: il pattern "simplify recently-changed code post-implementation, before review" è generico e ortogonale agli INV. È quello che fa un senior code reviewer come pass automatico.

**Cosa modificare**:
- Limits BE/FE viafera sono parziali. Generalizzare a "stack adapter" pattern: arbiter ha già `src/adapters/` per stack-specific knowledge. Lì vivono i limits per stack.
- Sostituire `./viafera.sh ci --level L1 --gate be-lint` con `node scripts/check-all.mjs check --filter lint`
- Cita ENGINEERING_DEFAULTS viafera → cita CANON-16 (refactor-first) arbiter

## Due da portare nel medio (P1)

### 5. `antigravity-verify` (389 LOC, sonnet/high effort, MCP-only) — **PORT-ADAPT**

Il pattern più interessante: agente runtime forensics che opera SOLO via MCP (no Read/Write/Bash). Triggered quando E2E test fallisce 3+ volte, container unhealthy, runtime diagnostics needed. Pattern a 6 step: load context → service health → log forensics → DB forensics → hypotheses ranked → next minimal experiment.

L'output è esemplare: 3 hypothesis ranked + next minimal experiment + (se serve) "VISUAL DEBUGGING REQUIRED" escalation handoff.

**Perché è P1 (non P0)**: dipende fortemente da specific MCP servers (`viafera-context`, `viafera-inspector`). Per arbiter va riarchitettato come MCP-agnostic agent che chiama whatever MCP servers sono installed (Postgres MCP, Docker MCP, Sentry MCP, ecc.). Più complesso del semplice porting.

**Cosa modificare**:
- Generalizzare gli MCP server requisiti: invece di hardcoded viafera-context, parametrizzare via config arbiter
- Mantenere il pattern strutturale: 6-step + output contract con hypotheses ranked + next minimal experiment
- Aggiungere fallback graceful quando MCP non disponibili (offrire shell-based equivalent)

**Pillola**: "Runtime forensics READ-ONLY agent. Hypotheses ranked, next minimal experiment. Guide, don't fix."

### 6. `red-team` (187 LOC, sonnet, READ-ONLY) — **DUPLICATE + MERGE**

Arbiter ha già `red-team` nel proprio `.claude/agents/`. Da confrontare line-by-line. Il viafera è ben strutturato:
- Process in 5 step (read plan → load SSOT via MCP → architecture alignment → query past decisions → produce verdict)
- Output contract con tabella SSOT alignment (INV-01..INV-13), Architecture findings, Edge Cases & Risks, Completeness, Past Decisions (from claude-mem), Verdict Details
- Verdict: PASS / WARN / FAIL con definizioni esplicite e action per ognuno
- Constraint "Not a rubber stamp" (look hard first)

**Cosa fare**: cherry-pick gli elementi mancanti dal viafera dentro arbiter `red-team`:
- L'esplicito "past decisions via claude-mem MCP" come step opzionale
- Il blocco "Verdict Definitions" tabella con action chiare
- La sezione "Edge Cases and Risks" con severity matrix
- La constraint finale "Not a rubber stamp"

## Due a bassa priorità

### 7. `codebase-scanner` (132 LOC, haiku) — **DUPLICATE**

Arbiter già ce l'ha. Tipologie ricerca, output JSON structure, error handling, performance target — confronto rapido per cherry-pick di eventuali pattern viafera mancanti. Probabilmente ~zero delta.

### 8. `migration-validator` (46 LOC, haiku) — **PORT-PLUGIN**

Flyway-specific (`V{version}__{description}.sql`, idempotency hints `IF NOT EXISTS`, ecc.). Java/Postgres/SQL domain. Va nel `@arbiter/plugin-java` plugin insieme alle skill Java.

**Pattern riusabile**: il concetto di "validator agent" auto-triggered su file pattern (`**/db/migration/**`). Lo stesso pattern vale per:
- Rust: validator per Cargo.toml dependency additions
- Python: validator per requirements.txt changes
- Frontend: validator per package.json changes (lock file integrity, breaking deps)

Quindi il pattern `domain-validator-on-write` è generico ed è pari a una skill arbiter "validator-on-write" + plugin-specific implementations.

## Cross-reference con arbiter

Arbiter agents (5 totali) → mapping:

| arbiter agent       | Equivalente viafera                           | Azione                |
| ------------------- | --------------------------------------------- | --------------------- |
| `ai-pr-gate`        | (no equivalente — è arbiter-only per INV-91) | Niente |
| `bridge-reviewer`   | (no equivalente — è arbiter-only)            | Niente |
| `codebase-scanner`  | `codebase-scanner` viafera                   | Confronto rapido + cherry-pick |
| `context-checker`   | (no equivalente direct — concepts diversi)   | Niente |
| `red-team`          | `red-team` viafera                           | **Merge cherry-pick** (P1) |
| (no equivalente)    | `fix-invariants`                             | **Portare** (P0) |
| (no equivalente)    | `ssot-reader`                                | **Portare** (P0) |
| (no equivalente)    | `context7-docs`                              | **Portare** (P0) |
| (no equivalente)    | `code-simplifier`                            | **Portare** (P0) |
| (no equivalente)    | `antigravity-verify`                         | **Portare con refactor** (P1) |
| (no equivalente)    | `migration-validator`                        | **Plugin Java** (P3) |

## Pattern architetturali estratti

Tre pattern di valore strutturale, indipendenti dai singoli agent:

### A. "Effort-level tiering" (haiku / sonnet-low / sonnet-medium / sonnet-high)

Viafera dichiara esplicitamente `effort-level` (low/medium/high) e `model` (haiku/sonnet) per ogni agent. Questo permette routing intelligente: read-only quick lookups → haiku (cost $0.0002); adversarial review → sonnet-low; surgical fixes → sonnet-medium; runtime forensics → sonnet-high.

Arbiter ha già `AGENT_REGISTRY.md` con "Model | Effort | Cost Rationale" — pattern allineato. Verificare che l'invocazione concreta degli agent (via Task tool) selezioni effettivamente i modelli giusti.

### B. "Worktree isolation per surgical changes"

`fix-invariants` dichiara `isolation: "worktree"` nel frontmatter. Significa: l'agente apre un worktree separato (forse via `arbiter wt open` o equivalente), opera lì, e il main agent può fare merge selettivo.

**Per arbiter**: il sistema `/wt-open` esiste già. Generalizzare il pattern in un meta-skill "worktree-bound subagent" — qualsiasi agente con `isolation: worktree` viene auto-eseguito in un worktree creato apposta.

### C. "MCP-only agent" (no file/shell access)

Sia `antigravity-verify` che `context7-docs` dichiarano tools puramente MCP. Niente Read/Write/Bash. Questa è una constraint di safety: l'agente non può modificare nulla, solo osservare.

**Per arbiter**: pattern utile da formalizzare come "Discovery agents" → MCP-only. Estendibile per qualsiasi MCP server (Postgres, Sentry, GitHub, Linear, ecc.). Differente dai "Execution agents" che possono modificare file.

## Conclusioni agents

**4 azioni P0**: portare `fix-invariants`, `ssot-reader`, `context7-docs`, `code-simplifier`. Tutti generici, surgical, di alto valore. Quattro nuovi agenti che raddoppiano la suite arbiter (da 5 a 9).

**2 P1**: portare `antigravity-verify` con refactor MCP-agnostic; mergiare cherry-pick `red-team` viafera in arbiter.

**1 plugin**: `migration-validator` va nel java plugin (più il pattern `domain-validator-on-write` generalizzato).

**1 don't bother**: `codebase-scanner` viafera vs arbiter — pari, cherry-pick veloce di max 30 minuti.

**Pillole emerse**:
- *"Effort-level tiering per agent: haiku per scan, sonnet-low per review, sonnet-medium per fix, sonnet-high per runtime forensics."*
- *"Worktree isolation per surgical agents: l'agente fixa in isolation, il main agent merge selettivo."*
- *"MCP-only agents come safety primitive: discovery via MCP, execution via Bash."*

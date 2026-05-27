# Wave 1 — Viafera AI-layer audit · INDICE FINALE

Audit file-per-file degli asset AI-layer di viafera (`.claude/*` + `FRAMEWORK/DOCS/`), con classificazione per portabilità in arbiter.

**Scope (confermato 2026-05-25):** `.claude/skills, agents, hooks, commands, rules, templates, prompts` + `FRAMEWORK/DOCS/`.
**Fuori scope**: `scripts/` shell (162 file, project-specific), sorgente Java/Vue, `99-ARCHIVE/`, `audit/`.

**Volume verificato**: 25 skill + 8 agent + 22 hook + 13 command + 6 rule + 9 template + 1 prompt + 4 framework doc = **88 file, ~16.400 LOC**.

---

## File di audit per famiglia

| File                                                  | Famiglia                            | Volume      | Top finding                             |
| ----------------------------------------------------- | ----------------------------------- | ----------- | --------------------------------------- |
| [skills.md](skills.md)                                | 25 skill                            | ~8.400 LOC  | 5 P0 da portare + 8 plugin Java         |
| [agents.md](agents.md)                                | 8 sub-agent                         | 1.236 LOC   | 4 P0 da portare (raddoppia suite arbiter) |
| [hooks.md](hooks.md)                                  | 22 hook                             | 1.638 LOC   | 3 P0 nuovi pattern + ~15 duplicati      |
| [commands.md](commands.md)                            | 13 command                          | 3.248 LOC   | task.md (1441 LOC) = mining intensivo per /task v2 |
| [rules-templates-prompts-framework.md](rules-templates-prompts-framework.md) | 6 rule + 9 template + 1 prompt + 4 framework doc | ~2.300 LOC  | 6 spec template = "wave of parity" stack toolkit |

---

## Sistema di classificazione utilizzato

Ogni file riceve una label e una priorità:

| Label             | Significato                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------- |
| **PORT-AS-IS**    | Riusabile in arbiter quasi tale quale. Generalizzazione minima.                              |
| **PORT-ADAPT**    | Pattern di valore ma da rifare adattando ai concetti arbiter (INV-NN, governance level, ecc.) |
| **PORT-PLUGIN**   | Verticalmente legato a uno stack (Java/Spring/Vue/Keycloak); candidato per un plugin arbiter |
| **DUPLICATE**     | Arbiter ha già l'equivalente; valutare merge/cherry-pick                                     |
| **VIAFERA-ONLY**  | Project-specific (Mainsim, Tazia, Keycloak…), non portabile                                  |
| **OBSOLETE**      | Sostituito da pattern più moderno, lasciare in viafera                                       |

**Priorità**: P0 (do first), P1 (next), P2 (later), P3 (defer/maybe).

---

## Top 18 candidati P0 — la wave 1 di porting concreto

Aggregati dai 5 file di audit. Ordinati per impatto/costo:

### Categoria A — Pattern di esecuzione (foundationale)

| # | Da viafera                          | Tipo      | A arbiter come                                  |
| - | ----------------------------------- | --------- | ----------------------------------------------- |
| 1 | `context-rot-management` skill      | Skill     | Port-as-is, opt-in via preset                  |
| 2 | `task-replay` skill                 | Skill     | Port-adapt, allineare a phase arbiter           |
| 3 | `task-status` skill                 | Skill     | Port-adapt, unificare con command `/status`     |
| 4 | `task.md` command (1441 LOC)        | Command   | **Mining intensivo → /task arbiter v2** (chat dedicata) |
| 5 | `verification-before-completion`    | Command   | Port-as-is, mergiare con skill `verification`   |
| 6 | `test-driven-development`           | Command   | Port-as-is, sostituisce skill `tdd` light       |

### Categoria B — Agent suite

| # | Da viafera                | Tipo      | A arbiter come                                  |
| - | ------------------------- | --------- | ----------------------------------------------- |
| 7 | `fix-invariants` agent    | Agent     | Port-adapt, generic oltre INV-07                |
| 8 | `ssot-reader` agent       | Agent     | Port-as-is, haiku, parallel-safe                |
| 9 | `context7-docs` agent + skill | Agent+Skill | Port-as-is, MCP-only, cooperative               |
| 10 | `code-simplifier` agent  | Agent     | Port-as-is, medium effort, post-implementation pass |

### Categoria C — Enforcement primitives

| # | Da viafera                          | Tipo      | A arbiter come                                  |
| - | ----------------------------------- | --------- | ----------------------------------------------- |
| 11 | `guard-task-completion.sh` hook    | Hook      | Port-adapt, Stop hook con transcript introspection |
| 12 | `guard-done-evidence.mjs` hook     | Hook      | Port-as-is, SHA-pinning evidence integrity      |
| 13 | `skill-forced-eval.test.sh`         | Hook+test | Port-as-is, esempio applicato di INV-39         |
| 14 | `visual-verification` skill         | Skill     | Promuovere ai template emessi (arbiter ce l'ha solo SELF) |

### Categoria D — Bootstrap, governance, mcp

| # | Da viafera                          | Tipo      | A arbiter come                                  |
| - | ----------------------------------- | --------- | ----------------------------------------------- |
| 15 | `bootstrap-project` command         | Command   | **Studio strategico**, apre la "wave of parity for FE/stack toolkit" |
| 16 | `30-mcp-usage.md` rule              | Rule      | Port-as-is, trigger matrix per qualsiasi MCP    |
| 17 | 6 spec template (product/requirements/design/tech/structure/tasks) | Templates | Port-as-is, opt-in via `arbiter init --with-specs` |
| 18 | `COMMANDS.md` Command Rationalization Policy | Doc | Port-as-is, formalizzare come ADR + check       |

### Bonus strategico

| # | Da viafera                          | Tipo      | A arbiter come                                  |
| - | ----------------------------------- | --------- | ----------------------------------------------- |
| ★ | `VERIFICATION_BRIDGE_HOWTO.md` pattern | Architecture | **Chat dedicata** — valutare adozione del bridge pattern (opt-in plan validation con MCP server custom + JSON schema contractuale) |

---

## Plugin Java/Spring/Flyway/Playwright (P2 strategico)

Bundle dei seguenti asset come **`@arbiter/plugin-java`** (primo case study pubblico per l'API plugin arbiter):

**Skill (8)**: `jpa-patterns`, `spring-boot-patterns`, `java-architecture-patterns`, `java-review-checklist`, `java-migration`, `test-quality`, `concurrency-review`, `design-patterns`

**Agent (1)**: `migration-validator`

**Command (3)**: `sonar-autofix`, `create-migration`, parts of `task.md` Java-specific

**Hook (1)**: `docker-debug-on-failure.sh`

Volume totale plugin: ~5.500 LOC di contenuto battle-tested.

---

## Don't bother — cherry-pick veloce

| Da viafera                       | Perché skip                                                  |
| -------------------------------- | ------------------------------------------------------------ |
| `epic-decompose` viafera         | Arbiter ha già equivalente più semplice. Cherry-pick 2 elementi (Track/Size table + auto-select invariants). |
| `understand-code` viafera        | Probabilmente già allineato con arbiter. Confronto rapido. |
| `architect-review` viafera       | Java-specific in viafera; arbiter ha generica. Cherry-pick quality attributes matrix. |
| `codebase-scanner` viafera       | Pari a quello di arbiter. ~Zero delta. |
| `task-{open,close,prune}` viafera | Pari a arbiter `/wt-*`. Solo cherry-pick: `[gone]` branches detection per `/wt-list`. |
| 15 hook .mjs duplicati           | Arbiter ha già le versioni mjs di tutti. NON tornare alle versioni .sh viafera. |
| `vault-context.md` rule          | Obsidian-specific → plugin separato. |
| `update-playwright-playbook`     | E2E-specific → plugin separato. |
| `dep-refresh-nightly`            | Adapt come workflow opt-in (P2). |

---

## Pattern strutturali estratti (cross-family)

Pattern di valore architetturale, indipendenti dai singoli asset:

### Esecuzione e workflow

1. **Effort-level tiering per agent** (haiku scan / sonnet-low review / sonnet-medium fix / sonnet-high forensics)
2. **Worktree isolation per surgical agents** (`isolation: "worktree"` nel frontmatter)
3. **MCP-only agent come safety primitive** (no Read/Write/Bash, only discovery)
4. **Idempotency guards multi-livello** (issue closed? PR merged? mid-impl?)
5. **Context handoff decision** (≤8 inline / 9-15 sub-agent / >15 STOP+/clear+re-invoke)
6. **Tier-based ceremony scaling** (XS minimal / S reduced / Standard full)

### Enforcement e gate

7. **Stop hook + transcript introspection** per catch claim non supportate da evidence
8. **SHA-pinning evidence files al gate-green** (drift impossibile post-claim)
9. **Hook empirical fire-test con threshold misurabili** (FP ≤ 15%, FN ≤ 5%)
10. **Auto-checkpoint ogni N TDD unit** (no accumulo silenzioso rotture)
11. **Score-based code review verdict** (CRITICAL=-25, MAJOR=-10, MINOR=-3, threshold 80/60/<60)
12. **Evidence file-backed counter** (in-memory non sopravvive Bash subshell)
13. **Agent dispatch evidence gate HARD STOP** (reading instructions ≠ dispatching)

### Governance e MCP

14. **MCP trigger matrix per server** (MANDATORY/RECOMMENDED/Soft + escape clauses)
15. **Command rationalization policy** (anti-sprawl: prefer one entrypoint + compose)
16. **Tech-debt detection inline** (create-issue-not-fix, 5-line trivial exception)
17. **Track router con cross-track STOP** (no BE+FE in stesso task)

### Architettura

18. **Bootstrap (greenfield process) ≠ Init (config install)** — lifecycle phase distinte
19. **Opt-in plan validation bridge** (double opt-in + MCP server custom + JSON schema contractuale)
20. **Audit Mode per dev-local-rapido** (skip audit-only gates, tieni code quality)

---

## Pillole estratte (oltre le 16 esistenti nel report principale)

Aggiungerle alla §14 del `analysis-2026-05-25.md` come "pillole battle-tested viafera":

- *"/task viafera è 1441 righe perché ogni bug-fix è stato pagato in produzione."*
- *"Evidence file-backed counter > in-memory. Bash subshells dimenticano. File survives."*
- *"Score-based verdict obbliga l'agent a essere quantitativo. PASS + 30 MAJOR finding = bugia mascherata."*
- *"Track router con cross-track STOP: mai BE+FE nello stesso task."*
- *"Bootstrap (greenfield process) ≠ Init (config install). Sono lifecycle phase distinte."*
- *"Override semantico di skill esterne è più forte che riscrivere. 20 LOC che ridefiniscono solo terminal state."*
- *"Activation deterministica > auto-everywhere. `Tier=Standard AND units>5` previene overhead inutile."*
- *"Effort-level tiering per agent: haiku scan, sonnet-low review, sonnet-medium fix, sonnet-high forensics."*
- *"Worktree isolation per surgical agents: l'agente fixa in isolation, il main merge selettivo."*
- *"MCP-only agents come safety primitive: discovery via MCP, execution via Bash."*
- *"Stop hook + transcript introspection = enforcement contro claim non supportate da evidence."*
- *"SHA-pinning evidence files al gate-green = drift impossibile."*
- *"Smart hook filtering ha bisogno di empirical fire-test. FP ≤ 15%, FN ≤ 5%."*
- *"Worktree scoperti = silent gate bypass. WorktreeCreate hook obbligatorio."*
- *"MCP trigger matrix per server: senza, ci sono tool installati ma nessuno sa quando usarli."*
- *"6 spec template = minimum viable spec layer per progetti AI-assisted."*
- *"Command Rationalization Policy: prefer one entrypoint + compose. Vale per skill/agent/workflow."*
- *"Audit Mode: in dev locale velocità, in CI completezza. Stesso gate, runtime diverso."*

---

## Raccomandazioni per le wave successive

### Wave 2 candidates (chat dedicate da pianificare)

| Wave 2 | Topic                                                                                  |
| ------ | -------------------------------------------------------------------------------------- |
| **2A** | `/task` arbiter v2 design — mining intensivo task.md viafera + design Codex-side neutro |
| **2B** | Stack-toolkit bootstrap — port di `bootstrap-project` come `arbiter init --bootstrap` con spec template + wave parity brownfield |
| **2C** | Verification Bridge pattern — studio di adozione del pattern viafera come `arbiter bridge` command |
| **2D** | Plugin Java/Spring — primo case study pubblico per API plugin arbiter (8 skill + 1 agent + 3 command + 1 hook) |
| **2E** | Pipeline fix concreto — implementazione fix §17.5 del report principale |

### Wave 3 candidates

| Wave 3 | Topic                                                                                  |
| ------ | -------------------------------------------------------------------------------------- |
| **3A** | Confronto col Mainsim framework (`~/work/repos/Work/mainsim-ai-framework/`) — modello CLAUDE.md hierarchical vs AGENTS.md canonical |
| **3B** | Skill di /auto correggere — quando Luca recupera la sua skill /auto custom dal PC ufficio |
| **3C** | Cleanup viafera — rimuovere "rumenta" come Luca ha menzionato                          |

---

## Stato wave 1

| Famiglia          | Stato       |
| ----------------- | ----------- |
| Setup + index     | ✅          |
| Skills (25)       | ✅          |
| Agents (8)        | ✅          |
| Hooks (22)        | ✅          |
| Commands (13)     | ✅          |
| Rules+templates+prompts+framework (20) | ✅ |
| Aggiornamento report principale + memoria | ⏳ |

_Wave 1 completata: 2026-05-25._

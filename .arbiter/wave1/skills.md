# Wave 1 — Audit `.claude/skills/` viafera

**25 skill, ~8.400 LOC totali.** Tre famiglie nette: workflow/process (battle-tested portabili), governance-core (semi-portabili), Java-domain (per plugin).

## Classificazione completa

| # | Skill                        | LOC | Categoria        | Label          | Priorità | Esiste già in arbiter? |
| - | ---------------------------- | --- | ---------------- | -------------- | -------- | ---------------------- |
| 1 | **context-rot-management**   | 234 | Workflow process | **PORT-AS-IS** | **P0**   | No                     |
| 2 | **task-replay**              | 137 | Workflow process | **PORT-ADAPT** | **P0**   | No (esiste `/replay` command, diverso scope) |
| 3 | **task-status**              | 113 | Workflow process | **PORT-ADAPT** | **P1**   | No (esiste `/status` command, da unificare) |
| 4 | **epic-decompose**           | 221 | Workflow process | **DUPLICATE**  | P2       | Sì — verificare delta vs viafera |
| 5 | **brainstorming-viafera**    | 20  | Pattern di override | **PORT-ADAPT** | P1     | Sì `brainstorming` — pattern di override è interessante per chi usa superpowers |
| 6 | **architect-review**         | 100 | Review           | **DUPLICATE**  | P3       | Sì — Java-specific in viafera, già più generica in arbiter |
| 7 | **understand-code**          | 121 | Discovery        | **DUPLICATE**  | P3       | Sì — quasi identica probabilmente |
| 8 | **visual-verification**      | 130 | Verification     | **PORT-AS-IS** | **P0**   | Sì in `.claude/skills/` di arbiter MA non emessa per i target — promuovere a `src/templates/` |
| 9 | **viafera-ssot-core**        | 173 | Governance       | **PORT-ADAPT** | P1       | Sì — `ssot-navigation` ma il pattern viafera è più maturo, da mergiare |
| 10 | **viafera-gates**           | 226 | Governance       | **PORT-ADAPT** | P2       | No equivalente arbiter — pattern generalizzabile |
| 11 | **context7-docs**           | 22  | External docs    | **PORT-AS-IS** | **P0**   | No — pattern auto-delegate via MCP |
| 12 | **api-contract-review**     | 377 | Review           | **PORT-AS-IS** | P1       | No |
| 13 | **performance-smell-detection** | 349 | Review        | **PORT-AS-IS** | P2       | No |
| 14 | **test-quality**            | 574 | Java domain      | **PORT-PLUGIN** | P2       | No — JUnit 5 + AssertJ specific |
| 15 | **clean-code**              | 576 | Generic + Java   | **PORT-ADAPT** | P2       | Sì arbiter `clean-code` — la viafera è più ricca di esempi |
| 16 | **solid-principles**        | 647 | Generic + Java   | **PORT-ADAPT** | P2       | No |
| 17 | **design-patterns**         | 738 | Java domain      | **PORT-PLUGIN** | P3       | No — GoF in Java |
| 18 | **logging-patterns**        | 521 | Generic-ish      | **PORT-ADAPT** | P2       | No — vale anche per altri linguaggi con minimal port |
| 19 | **security-audit**          | 555 | Generic-ish      | **PORT-ADAPT** | P1       | No — OWASP Top 10, vale cross-language |
| 20 | **java-review-checklist**   | 407 | Java domain      | **PORT-PLUGIN** | P3       | No |
| 21 | **java-architecture-patterns** | 327 | Java domain   | **PORT-PLUGIN** | P3       | No |
| 22 | **java-migration**          | 568 | Java domain      | **PORT-PLUGIN** | P3       | No — migration tra major versions |
| 23 | **jpa-patterns**            | 656 | Java domain      | **PORT-PLUGIN** | P3       | No |
| 24 | **spring-boot-patterns**    | 478 | Java domain      | **PORT-PLUGIN** | P3       | No |
| 25 | **concurrency-review**      | 471 | Java domain      | **PORT-PLUGIN** | P2       | No — concurrency è cross-language ma le primitive sono Java |

## Top 5 da portare subito (P0)

### 1. `context-rot-management` (234 LOC) — **PORT-AS-IS**

Skill battle-tested su Task #2055: 103 E2E specs, 5 phase, 1 compaction, zero re-work. Pattern a 3 layer di ridondanza durabile:
- `.evidence/<task-id>/BACKLOG.md` (git push survives)
- MCP checkpoint con prefisso `CHECKPOINT(#NNN)` searchable
- Git commit messages a phase boundary

**Trigger deterministico**: `Tier=Standard AND (implementation_units > 5 OR user request)`. Su Opus 4.6 con 1M context auto-skip per task piccoli — niente overhead inutile.

**Cosa modificare per arbiter**:
- Path: `.evidence/<task-id>/BACKLOG.md` → già coerente con la struttura `.evidence/#NNN/` di arbiter (vista in `/task` Phase 1)
- Rimuovere riferimenti a viafera-specific (Task #2055 esempio, MCP claude-mem)
- Generalizzare "MCP checkpoint" a "long-term memory layer" (qualunque MCP memory tool)
- Aggiungere collegamento esplicito con INV-27 (evidence artifacts) di arbiter

**Pillola da estrarre**: "Compaction destroy in-memory state. Tre layer durabili indipendenti = zero single-point-of-failure."

### 2. `visual-verification` (130 LOC) — **PROMOTE (esiste già in arbiter ma non emessa)**

Verificato: arbiter HA `~/work/repos/arbiter/.claude/skills/visual-verification/SKILL.md` ma è solo SELF (non in `src/templates/claude/skills/`). Quindi i target progects NON la ricevono.

**Azione**: copiare in `src/templates/claude/skills/visual-verification/SKILL.md.ejs`, rendere opt-in per archetype `frontend-spa`. Aggiungere generator wiring in `src/generators/skills.ts`.

**Cosa è**: protocollo 5-way DOM analysis (chain walk + bg color + padding accumulation + width constraint + screenshot+vision) su 3 viewport standard (375/768/1280). Authority "session-proven March 2026 puliziaGH". Allowed-tools include Playwright MCP browser tools.

**Pillola**: "AI-assisted FE dev senza visual verification è cieco. Misurare l'elemento più interno, non il wrapper. Block elements riempiono sempre il parent."

### 3. `context7-docs` (22 LOC) — **PORT-AS-IS**

Skill minuscola ma ad alto valore: auto-delegate al sub-agent `context7-docs` (vedi `agents.md` per il dettaglio) quando il prompt contiene trigger: upgrade, migrate, integrate, breaking change, deprecated API. Rate-limited a 5 call/task step.

**Cosa modificare**: niente strutturalmente. Va con il sub-agent (vedi nota in agents.md).

### 4. `task-replay` (137 LOC) — **PORT-ADAPT**

Permette di re-eseguire una phase specifica del task (`/task-replay C1.3` per ripetere code review, `/task-replay gate` per ripetere il gate). Validation pre-conditions tramite `status.json`. Phase NON-replayable: C4 (commit/push) e plan (richiede human GO).

**Differenza con arbiter**: il `/replay <phase>` di arbiter è generico (re-present phase instructions). Quello viafera è esecutivo (run the phase output). Sono complementari.

**Cosa modificare**: la mappa phase di viafera (C1.3, C1.5, gate, C2) è tied a `/task` viafera. Per arbiter va riallineata alle 11 phase di arbiter `/task`. Skill rinominabile `task-replay-execute` per differenziarla dal command `/replay` esistente.

### 5. `task-status` (113 LOC) — **PORT-ADAPT**

Stampa report formattato dello stato task usando `.evidence/<task-id>/status.json` e `log.md`. Computa elapsed time. Output box-drawing ASCII gradevole. Phase: plan/implementation/verification/complete/resume.

**Differenza con arbiter**: arbiter ha `/status` command (59 LOC) — coverage simile. Da unificare: una sola skill consultabile sia da `/status` slash che invocata dal modello.

**Cosa modificare**: status.json schema arbiter potrebbe differire da viafera (#2715 ref). Standardizzare lo schema.

## Tre da portare nel medio (P1)

### 6. `api-contract-review` (377 LOC) — **PORT-AS-IS**

Audit REST API: HTTP semantics, versioning, backward compatibility, response consistency. Già scritta in modo cross-framework. Va bene per qualsiasi archetype `*-web-db`. Cita pattern come "Entity leak" (JPA entity in response — INV applicabile), "200 with error", versioning `/v1/users`.

**Promuovere a**: `src/templates/claude/skills/api-contract-review/SKILL.md.ejs`, opt-in per archetype `backend-web-db`.

### 7. `security-audit` (555 LOC) — **PORT-ADAPT**

OWASP Top 10 quick reference + Java mitigations. La struttura è generica (OWASP è language-agnostic), gli esempi sono Java.

**Modifica**: separare la skill in due:
- `security-audit-core` (180 LOC stimate, generic OWASP) → PORT-AS-IS per arbiter
- `security-audit-java` (375 LOC, esempi Java) → PORT-PLUGIN nel java-plugin

### 8. `viafera-ssot-core` (173 LOC) — **PORT-ADAPT**

Pattern: condensed index dei doc SSOT + come usarli + INV quick reference + anti-patterns. Sostanzialmente è quello che arbiter ha in `ssot-navigation` ma più maturo (decision hierarchy esplicita, quick commands, "when in doubt").

**Modifica**: mergiare i pattern viafera dentro arbiter `ssot-navigation`. Particolare valore:
- La tabella "Critical Invariants (Never Violate)" come pattern di "showcase delle top-5"
- "Decision Hierarchy" come list ordinata 1-5 (replica Authority Hierarchy ma applicata operativamente)
- "When in Doubt" → "Check INV → Search ADR → Review task brief → STOP + ask"

### Bonus medio: `brainstorming-viafera` (20 LOC) — pattern di override

20 righe ma concetto forte: **override semantico della skill di superpowers**. Esplicitamente dice "superpowers:brainstorming terminal state OVERRIDDEN for Viafera" e definisce il proprio terminal state (write design doc, create GitHub issue, STOP, do NOT invoke writing-plans).

Questo è il **pattern arbiter dovrebbe usare per coesistere con superpowers**. Per ogni skill superpowers di cui arbiter vuole un comportamento diverso, scrivere un override sottile che ridefinisce solo il terminal state o l'ordine di invocazione, senza riscrivere tutta la skill.

## Tre da portare in plugin (P2/P3 ma alto valore se inquadrato come plugin Java)

Le 7-8 skill Java sono troppo specifiche per il core arbiter ma sono un asset prezioso per il **plugin `@arbiter/plugin-java`**:

- `jpa-patterns` (N+1, lazy, fetch, transaction) — 656 LOC
- `spring-boot-patterns` (controller/service/repo structure) — 478 LOC
- `java-architecture-patterns` (package structure macro) — 327 LOC
- `java-review-checklist` (PR review systematic) — 407 LOC
- `java-migration` (8→11→17→21→25 paths) — 568 LOC
- `test-quality` (JUnit 5 + AssertJ best practices) — 574 LOC
- `concurrency-review` (Virtual Threads, CompletableFuture) — 471 LOC
- `design-patterns` (GoF in Java) — 738 LOC

Totale plugin Java skills: ~4.200 LOC di contenuto battle-tested. È un plugin che giustifica da solo l'esistenza dell'architettura plugin di arbiter, e potrebbe essere il **primo case study pubblico** ("see how arbiter's plugin system works — here's the official Java plugin extracted from a real Spring Boot product").

## "Don't bother" — non vale lo sforzo

- `epic-decompose` viafera vs arbiter — sono molto simili nello scope. La viafera è più dettagliata (220 vs ~95 LOC stimate di arbiter) ma il delta non giustifica il porting. Cherry-pick di 2-3 pezzi (la tabella Track/Size + l'auto-select invariants) e basta.
- `understand-code` viafera vs arbiter — molto simile. Probabilmente arbiter HA già adottato il pattern viafera. Confronto rapido + merge cherry-pick.

## Cross-reference con arbiter (cosa esiste già)

Skill di arbiter (12 totali) → mapping:

| arbiter skill        | Equivalente/relatato in viafera               | Azione                    |
| -------------------- | --------------------------------------------- | ------------------------- |
| `architect-review`   | `architect-review` (viafera, Java-spec)       | Mergiare cherry-pick: la matrice quality attributes |
| `brainstorming`      | `brainstorming-viafera` (pattern override)    | Aggiungere documentazione override pattern |
| `clean-code`         | `clean-code` (viafera, più ricco)             | Mergiare esempi viafera |
| `codebase-audit`     | (no equivalente)                              | Niente |
| `configure`          | (no equivalente)                              | Niente |
| `epic-decompose`     | `epic-decompose` (viafera, più maturo)        | Cherry-pick |
| `senior-survey`      | (no equivalente, è arbiter-original CANON-16) | Niente — è già unico |
| `ssot-navigation`    | `viafera-ssot-core`                           | **Mergiare maturità viafera** (P1) |
| `tdd`                | (no skill, ma `test-driven-development` command) | Niente |
| `understand-code`    | `understand-code`                             | Già allineato verosimilmente |
| `verification`       | (skill arbiter; viafera ha command `verification-before-completion`) | Da confrontare in commands.md |
| `visual-verification`| `visual-verification`                         | **Promuovere a template arbiter** (P0) |

## Conclusioni skills

**5 azioni P0**: portare context-rot-management, promuovere visual-verification ai template, portare context7-docs, adattare task-replay/status, integrare brainstorming override pattern.

**3 P1**: api-contract-review, security-audit-core, merge viafera-ssot-core in arbiter ssot-navigation.

**Plugin Java (P2 strategico)**: bundle 7-8 skill Java come `@arbiter/plugin-java` — un solo plugin pubblico che vale da showcase per l'API plugin.

**Don't bother**: `epic-decompose`, `understand-code`, `architect-review` viafera → tutti già coperti in arbiter con minor delta. Cherry-pick veloce e via.

**Pillole emerse da questa famiglia** (oltre le 13-16 esistenti):
- *"Activation deterministica > auto-everywhere"* — la riga `Tier=Standard AND units>5` di context-rot vale come pattern: smarter triggers tendono a evitare overhead inutile su task piccoli.
- *"Override semantico di skill esterne è più forte che riscrivere"* — il pattern di `brainstorming-viafera` (20 LOC che ridefiniscono solo il terminal state della skill superpowers) è il modo giusto di coesistere con plugin di terzi.

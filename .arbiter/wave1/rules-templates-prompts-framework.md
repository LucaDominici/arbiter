# Wave 1 — Audit `.claude/{rules,templates,prompts}` + `FRAMEWORK/DOCS/` viafera

**4 famiglie minori, 6 + 9 + 1 + 4 = 20 file, ~2.300 LOC totali.** Famiglia con il valore più "trasversale": ci sono pattern policy, doc/spec template per progetti AI, e l'architettura di un Verification Bridge interno.

## Sezione A — Rules (6 file, 243 LOC)

| # | Rule                              | LOC | Label          | Priorità | Esiste in arbiter? |
| - | --------------------------------- | --- | -------------- | -------- | ------------------ |
| 1 | **90-exec-protocol.md**           | 162 | **DUPLICATE+MERGE** | P1  | Sì, ma più scarno   |
| 2 | **30-mcp-usage.md**               | 27  | **PORT-AS-IS** | **P0**   | No                  |
| 3 | **vault-context.md**              | 26  | **PORT-PLUGIN** | P3      | No (Obsidian-specific) |
| 4 | **claude-exec-plan-first.md**     | 16  | **PORT-ADAPT** | P1       | No (concept differente) |
| 5 | **05-agent-lifecycle.md**         | 7   | **DUPLICATE**  | P3       | Sì, identica       |
| 6 | **25-todo-folder-policy.md**      | 5   | **DUPLICATE**  | P3       | Sì, identica       |

### Highlights

**`90-exec-protocol.md` viafera (162 LOC) vs arbiter (più scarno)**:
- Branch enforcement section con tabella esplicita: `main/master` → HARD STOP, `task/#*` → PROCEED. Arbiter ce l'ha, similare.
- **Task tier table** con phase scaling (XS minimal / S reduced / Standard full) per Phase 0-2-4. Arbiter non lo formalizza così. **Merge cherry-pick.**
- **Audit Mode** (`VIAFERA_AUDIT_MODE=off`) per skip audit-only gates. Pattern utile per dev locale rapido. Arbiter non ha equivalente. **Port-adapt.**
- **Stop Conditions tabella** (6 condizioni fail-closed + blocker report format). Pattern oro. **Merge.**
- **Session Isolation Protocol** ("one task one chat", /clear mandatory, /compact only with human approval). Pattern utile. **Merge.**

**`30-mcp-usage.md` (27 LOC) — PORT-AS-IS P0**: trigger matrix MCP server-by-trigger-condition con livelli MANDATORY/RECOMMENDED/Soft, escape clauses esplicite, `--force-mcp-skip` flag. Pattern brillante. Arbiter dovrebbe avere uno simile per tutti i tipi di MCP (github, postgres, sentry, ecc.).

**`claude-exec-plan-first.md` (16 LOC) + omonimo prompt (43 LOC) — PORT-ADAPT P1**: il protocollo "claude-exec mode" con red-team gate tier-conditional. Per tier Standard → red-team MANDATORY pre-code; XS/S → human plan approval sufficient. Pattern di gate condizionale interessante.

**`vault-context.md` (26 LOC) — PORT-PLUGIN P3**: Obsidian-specific. Va in un plugin `obsidian-integration`. Da notare: arbiter ha `OBSIDIAN.md` nel root e un comando `arbiter obsidian --sync` (visto da `vault-context.md`). Quindi il plugin esiste in nuce.

## Sezione B — Templates (9 file + DEBUG_STATE, 828 LOC)

Tutti i template viafera sono **spec-kit-style** (provenienza Kiro/OpenSpec o simili). Standardizzano la documentazione per progetti AI-assisted.

| # | Template                          | LOC | Categoria               | Label          | Priorità |
| - | --------------------------------- | --- | ----------------------- | -------------- | -------- |
| 1 | **product-template.md**           | 51  | Product spec            | **PORT-AS-IS** | **P0**   |
| 2 | **requirements-template.md**      | 44  | Requirements (EARS)     | **PORT-AS-IS** | **P0**   |
| 3 | **design-template.md**            | 90  | Technical design        | **PORT-AS-IS** | **P0**   |
| 4 | **tech-template.md**              | 99  | Tech stack              | **PORT-AS-IS** | **P0**   |
| 5 | **structure-template.md**         | 145 | Project structure       | **PORT-AS-IS** | **P0**   |
| 6 | **tasks-template.md**             | 158 | Implementation plan     | **PORT-AS-IS** | **P0**   |
| 7 | **bug-report-template.md**        | 58  | Bug intake              | **PORT-AS-IS** | P1       |
| 8 | **bug-analysis-template.md**      | 69  | Bug root-cause          | **PORT-AS-IS** | P1       |
| 9 | **bug-verification-template.md**  | 74  | Bug fix verification    | **PORT-AS-IS** | P1       |
| 10 | **DEBUG_STATE.md**               | 40  | Failure state snapshot  | **PORT-ADAPT** | P1       |

### Highlights

**Il pattern "6 spec template core"** (product, requirements, design, tech, structure, tasks) è particolarmente prezioso. Risolve direttamente il punto Luca dice "dovrebbe imporre un set di base + PRD e ADR se non ci sono già". Questi 6 template sono ESATTAMENTE quel set di base.

Mapping al gap che hai identificato (FE/stack toolkit + wave parity brownfield):
- `product.md` template → vision/users/features/objectives/success metrics (PRD-light)
- `requirements.md` template → EARS-format user stories + acceptance criteria
- `design.md` template → high-level architecture + code reuse analysis + integration points
- `tech.md` template → primary language + dependencies + storage + architecture pattern
- `structure.md` template → directory organization + naming conventions
- `tasks.md` template → atomic task requirements (1-3 files, 15-30min, single purpose)

**Proposta concreta**: il `bootstrap-project` viafera (vedi commands.md §4) genera il 13-file Day-1 SSOT set. Per arbiter, integrare questi 6 template come **`arbiter init --with-templates`** flag che li scaffolda in `docs/specs/` quando il repo è greenfield (o quando esplicitamente richiesto in brownfield). Pattern: emit-if-not-exists.

**`tasks-template.md` (158 LOC) ha un pezzo prezioso**: "Atomic Task Requirements" (1-3 file, 15-30 min, single purpose, specific files, agent-friendly). Riferimento explicit ai requirements via `_Requirements: X.Y, Z.A_` e al code reuse via `_Leverage: path/to/file.ts_`. Pattern di tracciabilità requirements→tasks→code via inline references.

**Family bug-{report,analysis,verification}** — 3-step structured bug lifecycle. Pattern utile da affiancare al pattern `/bug-analyze → /bug-fix → /bug-verify` viafera (citato in task.md §0A''). Non urgente ma di valore.

**`DEBUG_STATE.md` (40 LOC)** — già scritto da `debug-state-on-failure.sh` hook (vedi hooks.md). Template canonical per il file. Va con il hook.

## Sezione C — Prompts (1 file, 43 LOC)

**`claude-exec-plan-first.md`** — espande il rule omonimo con tabella esplicita tier→red-team behavior + spiegazione "Why This Matters" (--dangerously-skip-permissions removes confirmation prompts, red-team replaces human checkpoint).

**Label: DUPLICATE+ del rule**. Stesso concetto in due forme (rule = sintetico, prompt = esteso operativo). Per arbiter: portare entrambi se si decide di portare il pattern claude-exec.

## Sezione D — FRAMEWORK/DOCS (4 file, 1187 LOC)

Doc di metodologia/internals. Tutti scritti come SSOT registry o playbook tecnico.

| # | Doc                              | LOC | Categoria         | Label          | Priorità |
| - | -------------------------------- | --- | ----------------- | -------------- | -------- |
| 1 | **COMMANDS.md**                  | 102 | Command registry  | **PORT-AS-IS** | **P0**   |
| 2 | **PLAN_STORAGE.md**              | 42  | Plan dir config   | **PORT-AS-IS** | P1       |
| 3 | **VIAFERA_PLANNER_MCP.md**       | 490 | MCP server ref    | **PORT-PLUGIN** | P2      |
| 4 | **VERIFICATION_BRIDGE_HOWTO.md** | 553 | Bridge playbook   | **PORT-ADAPT** | **P0** strategico |

### Highlights

#### `COMMANDS.md` — il **pattern Command Rationalization Policy**

P0 perché contiene la "Command Rationalization Policy" esplicita:

> **Before adding a new command, verify:** Reuse check → Extension check → Necessity check → Documentation. **Design principles:** prefer one entrypoint over many overlapping commands, compose simple commands rather than create complex variations, avoid microcommands.
> **Anti-pattern: command sprawl** (`/bridge-review` + `/bridge-review-with-retries` + `/bridge-review-verbose` + `/bridge-review-json-output`).
> **Better:** one command with optional flags or composable with other tools.

Questa è una **pillola di disciplina** che arbiter potrebbe formalizzare come ADR + check (esiste già `check-script-cohesion.mjs` per gli script gate, ma niente di equivalente per i command). Aggiungere `check-command-rationalization.mjs` o documentarlo come CANON-22.

#### `VERIFICATION_BRIDGE_HOWTO.md` (553 LOC) — il pattern **opt-in pre-execution plan verification**

Questo è il pezzo più strategicamente importante di tutto il framework dir. Spiega un sistema di **opt-in double opt-in**:
1. **Plan Level**: `review_bridge.enabled=true` in PLAN.json
2. **Command Level**: User esplicitamente runs `/bridge-review`

Default: bridge SKIPPED e never blocks. Use cases: catch scope violations (drive-by edit fuori scope dichiarato), verify orphan debt, enforce English-only UI, detect test skip patterns.

Workflow:
```
Plan Phase → PLAN.json → /bridge-review → REVIEW.json
                              ↓
                         APPROVED → Human GO → Execute
                              ↓
                         REJECTED → Fix Plan → Retry
```

**Per arbiter è P0 strategico** perché ricalca esattamente il pattern di **plan-validation-before-execution** che arbiter già ha in modo implicito (pre-edit-plan-anchor + senior-survey skill + CANON-16). Ma viafera lo ha formalizzato in un **bridge esterno** con MCP server dedicato (`viafera-planner`), schema JSON deterministico, double-opt-in, REVIEW.json di output con violations + ssot_pointer + evidence.

Proposta: studiare se arbiter possa adottare il pattern come `arbiter bridge` command + MCP server `arbiter-plan-validator` opzionale. È un blocco grosso, da valutare in chat dedicata.

#### `VIAFERA_PLANNER_MCP.md` (490 LOC) — il MCP server custom

Reference tecnico completo del MCP server `viafera-planner`. Tool `ssot_verify_plan`: input PLAN JSON, output violations strutturate (rule_id `VB-INV-*`, severity ERROR/WARN, message, ssot_pointer, evidence).

Implementa check come VB-INV-EN-UI (Italian stopwords detection per INV-25 enforcement). Pattern: stack-specific MCP server che incarna gli INV.

**Per arbiter**: P2 plugin pattern. Vale come **template** per come buildare un MCP server "rule verifier" stack-specific. Documentazione modello, non porting diretto.

#### `PLAN_STORAGE.md` (42 LOC) — config plansDirectory

Setting `plansDirectory: "./.claude/plans"` in `settings.json` per spostare i plan da `~/.claude/plans` user-global a repo-local. Pattern semplice ma utile per multi-repo workflow. Arbiter dovrebbe emettere questo setting di default in `settings.json.ejs`.

## Cross-reference riassuntivo

### Cosa arbiter ha già

- `05-agent-lifecycle.md`, `25-todo-folder-policy.md` rules: identiche
- `90-exec-protocol.md`: più scarno; cherry-pick da viafera (Audit Mode, Session Isolation, Stop Conditions tabella, Tier-based phase scaling)
- 8 rules totali (vs 6 viafera): arbiter ha rules extra (`30-canon-enforcement`, `35-refactor-first`, `40-context-economy`, `50-batch-execution`, `95-matrix-fixture-policy`)
- Nessun template `.claude/templates/` in arbiter (verifica)
- Nessun framework-docs equivalente

### Cosa portare in priorità

| # | Da viafera                    | A arbiter come                          | Priorità |
| - | ----------------------------- | --------------------------------------- | -------- |
| 1 | `30-mcp-usage.md`             | Nuovo `30-mcp-usage.md` rule + trigger matrix generic per qualsiasi MCP (github, postgres, sentry, ecc.) | **P0** |
| 2 | 6 spec template (product/requirements/design/tech/structure/tasks) | `src/templates/specs/*.md.ejs` emesso opt-in via `arbiter init --with-specs` | **P0** |
| 3 | `COMMANDS.md` Command Rationalization Policy | ADR-NNN nuovo + check-command-rationalization.mjs | **P0** |
| 4 | `VERIFICATION_BRIDGE_HOWTO.md` pattern | Chat dedicata: valutare adozione del bridge pattern | **P0 strategico** |
| 5 | `90-exec-protocol.md` cherry-pick (Audit Mode, Session Isolation, Stop Conditions) | Merge in arbiter `90-exec-protocol.md` | P1 |
| 6 | `claude-exec-plan-first.md` rule + prompt | Adapt come `claude-exec mode` opt-in con tier-conditional red-team | P1 |
| 7 | `PLAN_STORAGE.md` config | Aggiungere `plansDirectory: "./.claude/plans"` a `settings.json.ejs` di default | P1 |
| 8 | 3 bug template (report/analysis/verification) | `src/templates/specs/bug-*.md.ejs` opt-in | P1 |
| 9 | `vault-context.md` | Plugin `obsidian-integration` (arbiter ha già `OBSIDIAN.md` root) | P2 |
| 10 | `VIAFERA_PLANNER_MCP.md` | Documentation template per "build your own rule-verifier MCP server" | P2 |
| 11 | `DEBUG_STATE.md` template | Va con il hook `debug-state-on-failure.mjs` | P1 |

## Pattern strutturali estratti

### A. "MCP trigger matrix per server"

`30-mcp-usage.md` formalizza: per ogni MCP server, condizioni deterministiche di attivazione (MANDATORY / RECOMMENDED / Soft) + escape clauses esplicite + flag di override (`--force-mcp-skip`). Pattern che chiude il gap "ci sono MCP installati ma nessuno sa quando usarli". Generalizzabile per qualsiasi MCP arbiter integri.

### B. "Spec template core set"

I 6 template (product/requirements/design/tech/structure/tasks) sono il **minimum viable spec layer** per qualsiasi progetto AI-assisted serio. Pattern che risolve direttamente il gap "wave of parity for brownfield" che Luca ha identificato. In brownfield: arbiter rileva file mancanti, propone scaffold; in greenfield: arbiter scaffolda tutti d'ufficio.

### C. "Command Rationalization Policy"

Le 4 check + 3 design principle + 1 anti-pattern descritti in `COMMANDS.md`. Pattern di disciplina che combatte command sprawl. Trasponibile a skill (skill sprawl), agent (agent sprawl), workflow (workflow sprawl). Già arbiter ha `check-script-cohesion.mjs` per script gate — pattern analogo applicato.

### D. "Opt-in plan validation bridge"

Il Verification Bridge viafera è un'architettura completa per fare plan validation pre-execution con:
- Double opt-in (plan-level flag + command-level invocation)
- MCP server custom che incarna gli INV come check deterministici
- Schema JSON contractuale (PLAN.json input, REVIEW.json output)
- Violations con ssot_pointer per traceability

Per arbiter: pattern di riferimento per costruire la prossima generazione di plan validation, oltre l'attuale `pre-edit-plan-anchor` hook.

### E. "Audit Mode per dev-local-rapido"

`VIAFERA_AUDIT_MODE=off` skip degli audit-only gates mantenendo i code quality gates. Pattern che riconosce: "in dev locale serve velocità, in CI serve completezza". Arbiter ha qualcosa di simile con i tier L1/L2/L3/L4 ma non ha un flag esplicito per "skip gates SOLO di audit, tieni il resto".

## Conclusioni rules+templates+prompts+framework

**4 P0**: `30-mcp-usage.md` (trigger matrix), 6 spec templates (core minimum spec layer), Command Rationalization Policy (anti-sprawl), **strategico**: studiare Verification Bridge pattern in chat dedicata.

**5 P1**: merge in arbiter `90-exec-protocol.md` (Audit Mode + Session Isolation + Stop Conditions + Tier-based phase scaling), `claude-exec-plan-first` rule+prompt, plansDirectory setting, 3 bug template, DEBUG_STATE template.

**2 P2**: `VIAFERA_PLANNER_MCP.md` come reference per future custom MCP server, `vault-context.md` come Obsidian plugin.

**Pillole emerse**:
- *"MCP trigger matrix per server: senza, ci sono tool installati ma nessuno sa quando usarli."*
- *"6 spec template = minimum viable spec layer per progetti AI-assisted. Risolve il 'wave of parity for brownfield'."*
- *"Command Rationalization Policy: prefer one entrypoint + compose, evita microcommand sprawl. Vale per skill/agent/workflow."*
- *"Plan validation bridge: opt-in + MCP-backed + ssot_pointer per traceability."*
- *"Audit Mode: in dev locale velocità, in CI completezza. Stesso gate, runtime diverso."*

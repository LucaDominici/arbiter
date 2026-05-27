# Wave 1-bis — Audit `/auto` pipeline + 16 skill workflow Luca (mainsim-ai-framework)

> Audit aggiuntivo della suite skill personale di Luca, recuperata dal Mac via DR snapshot in `~/work/repos/Work/mainsim-ai-framework/dr/claude-skills/`. **Correzione importante**: nel report principale §17.2 avevo scritto che `/auto` "non è tua invenzione, è ufficiale Anthropic". **Sbagliato.** L'Anthropic `claude-automation-recommender` è una skill diversa (recommender read-only); il tuo `/auto` è una **pipeline lifecycle issue→PR completa**, 1.241 LOC, di pari complessità al `/task` viafera.

**Volume**: 17 skill, ~2.700 LOC totali + settings.json + hook enforce-gate-before-pr.sh.

## Inventory

| # | Skill                       | LOC  | Categoria             | Label          | Priorità per arbiter |
| - | --------------------------- | ---- | --------------------- | -------------- | -------------------- |
| 1 | **auto**                    | 1241 | Lifecycle pipeline    | **PORT-ADAPT** (mining) | **P0**          |
| 2 | **review**                  | 317  | Code review           | **PORT-AS-IS** | **P0**               |
| 3 | **quality-alignment-audit** | 198  | Gap analysis          | **PORT-PLUGIN** | P2 (Java/CI plugin) |
| 4 | **spec**                    | 134  | Pre-code spec         | **PORT-AS-IS** | **P0**               |
| 5 | **close**                   | 128  | PR finalization       | **PORT-AS-IS** | **P0**               |
| 6 | **code**                    | 108  | TDD per task          | **PORT-AS-IS** | **P0**               |
| 7 | **plan**                    | 103  | Epic > Story > Task   | **PORT-AS-IS** | **P0**               |
| 8 | **impact**                  | 80   | Cross-module analysis | **PORT-AS-IS** | P1                   |
| 9 | **wt-close**                | 76   | Worktree close+carry  | **PORT-ADAPT** | P1 (merge in arbiter `/wt-close`) |
| 10 | **worktree-manager**       | 75   | Worktree script       | **PORT-AS-IS** | P1                   |
| 11 | **start**                  | 67   | Branch setup          | **PORT-AS-IS** | P1                   |
| 12 | **handoff**                | 64   | Session handoff doc   | **PORT-AS-IS** | P1                   |
| 13 | **preflight**              | 62   | Pre-impl validation   | **PORT-AS-IS** | P1                   |
| 14 | **estimate**               | 61   | S/M/L/XL sizing       | **PORT-AS-IS** | P1                   |
| 15 | **replay**                 | 59   | Extract ADR from spec | **PORT-AS-IS** | P1                   |
| 16 | **wt-open**                | 58   | Worktree open wrapper | **PORT-ADAPT** | P1 (merge in arbiter `/wt-open`) |
| 17 | **status**                 | 40   | Spec dashboard        | **PORT-AS-IS** | P1                   |

Plus: `claude-config/settings.json` (118 LOC) + `claude-config/hooks/enforce-gate-before-pr.sh` (58 LOC).

## /auto — la pipeline (1.241 LOC)

**Una riga**: trasforma una GitHub issue (o un free-text prompt) in una PR mergiata, autonomamente eccetto ai gate di approval. Supporta single-issue, merged (2-5 issue → 1 PR), prompt-text (crea issue).

### Phase structure

| Phase | Nome | Modalità | Cosa fa |
| ----- | ---- | -------- | ------- |
| 0.0 | Startup check | AUTO/STOP | Recovery via `status.json` (anti-bypass guard contro `executing-plans`), tool availability (gh, git), sub-skill reachability (local vs global), claude-mem cross-session retrieval (2 search query budget-capped) |
| 0 | Input parsing | AUTO/GATE | Single-issue / merged / prompt detection, validate (closed, duplicate, in-progress, uncorrelated) |
| 0.5 | **Existing-work detection** | AUTO | Per ogni issue: parse key nouns, grep codebase, git log search, classify NOT/PARTIAL/FULL, gate per FULL |
| 0.9 | Directory bootstrap | AUTO | `.claude/specs/<spec-name>/`, suffix `-multi` per merged |
| 1 | Spec | AUTO | Read CLAUDE.md, create spec.md + status.json + log.md, comment on issue(s) |
| 1.5 | **Spec challenge** | AUTO | Agent `spec-challenger`: completeness, CLAUDE.md constraints, NOT-in-scope, risks (max 1 iter) |
| 2 | Plan | AUTO | Decompose Epic > Story > Task con Context Block self-contained, `originIssue` tag per merged |
| 2.5 | Plan challenge | AUTO | Agent `plan-reviewer`: atomic tasks, dependencies, CLAUDE.md, cross-issue coverage merged (max 2 iter) |
| 2.7 | **Red-team** | AUTO/STOP | **N agent parallel self-select angle** (S/M:1, L:2, XL:3). Output `[RT-<ANGLE>-NN]` con severity. CRITICAL → FAIL → plan rework (max 2 cycle). HIGH/MEDIUM → triage + plan adaptation |
| 3 | Estimate | GATE | S/M/L/XL → user gate; `--ni` auto-approve se ≤L, XL → STOP |
| 3.5 | **Context handoff** | GATE/AUTO | **HARD session boundary**: `ExitPlanMode` + STOP + clear required. In `--ni`: ≤M inline / L sub-agent / XL STOP |
| 4 | **Preflight** | AUTO/STOP | a) standard checks; b) **CLAUDE.md constraint scanner** (NEVER/DO NOT/MUST NOT → derive grep regex → run against tree); c) qualityGateCmd extraction (3-step priority); d) secure coding checklist discovery |
| 5 | Start | AUTO | Branch prefix from labels (fix/feat/chore), fetch + checkout + create branch, build verify, label `in-progress` su tutte le issue |
| 6 | **Implement** | AUTO+GATE | Per task: invoke `superpowers:test-driven-development`, quality gate, AUTO commit con tests green + `qualityGateCmd` passato. **Auto-checkpoint ogni 3 task**. **Tech-debt inline → create issue, NON fixare** (+ `pendingFollowUps[]` fallback) |
| 7 | **Review** | AUTO/STOP | 7.1 Plan alignment (superpowers:code-reviewer), 7.1.5 Red-team checkpoint injection, 7.2 9-auditor con intelligent routing (always-on 2/3/5/8 + tag detection HAS_SQL/HAS_CONTROLLER/HAS_CONCURRENCY/... + booking/availability override). Weighted score (Security 2x, Data Layer 2x). Per-issue coverage table per merged. Cap score 60 per RT-XX UNRESOLVED + [ALIGN-XX] |
| 7.5 | Rebase | AUTO | Fetch + rebase + re-test + re-quality-gate (STOP se rotti post-rebase) |
| 8 | **Close** | GATE | **Pre-PR integrity check** (5 artifacts MUST exist + 4 status.json field MUST be set). PR create con `closes #N` per OGNI issue. Auto-enable automerge. Comment on each issue. **claude-mem persistence via HTTP POST** (port 37777). Render `pendingFollowUps[]` + `techDebtIssues[]` nel PR body se non vuoti |

### Pattern strutturali emersi (e non presenti in arbiter)

**A. opusplan integration**
- Opus per planning phase (0-3), Sonnet per execution (4-8)
- `status.json` è il BRIDGE tra le due sessioni
- Phase 3.5 = hard session boundary deliberato per dare a Sonnet context window pulita
- Setting `"model": "opusplan"` in `.claude/settings.json`
- **Pillola**: *"Sessioni separate per cognitive phase distinte. Opus per pensare, Sonnet per fare. status.json è il bridge."*

**B. Anti-bypass guard**
- Se `status.json` contiene `"pipeline": "auto"`, blocca esplicitamente `executing-plans`, `superpowers:executing-plans`, `finishing-a-development-branch`. Solo `/auto` garantisce red-team + 9-auditor review. Bypass = privilege escalation non rilevata + falsi positivi nei test + PR senza gate
- È nato da un incident reale (2026-04-09)
- **Pillola**: *"Pipeline ownership = anti-bypass guard. Se un'altra skill prende il tuo plan, sta saltando i tuoi gate."*

**C. Status.json atomic update INVARIANTE**
- Prima di iniziare QUALSIASI fase: leggi status.json → aggiorna phase/timestamps/gateDecisions → scrivi → append log.md → SOLO DOPO esegui il lavoro della fase
- BLOCKING: se status.json non riflette la fase corrente, la fase non può procedere
- **Pillola**: *"Status atomic update prima del lavoro = recovery garantito anche dopo crash mid-phase."*

**D. Existing-work detection (Phase 0.5)**
- Per ogni issue: parse key nouns (class names, table names, endpoint paths), grep codebase + git log search, classify NOT/PARTIAL/FULL
- FULLY DONE → gate "Issue già implementata, procedere comunque?"
- PARTIAL → spec scoped solo al delta
- Pattern che evita re-implementazione + scope creep
- **Pillola**: *"Mai iniziare implementazione senza scan dell'esistente. Half-done feature è il bug più comune."*

**E. Red-team con agent self-selecting angle (Phase 2.7)**
- N agent paralleli (S/M:1, L:2, XL:3), each picks own attack angle based on task specifics
- Tagging libero: RT-SEC, RT-CONC, RT-COMP, RT-EDGE, RT-ARCH, RT-TEST, RT-CROSS, RT-PERF, RT-MIG, o angolo custom
- Severity 4-livelli: CRITICAL (concrete + likely) / HIGH (probably surface) / MEDIUM (worth note) / SUGGESTION (no plan change)
- Triage interattivo o auto-confirm HIGH+MEDIUM in `--ni`
- Le HIGH/MEDIUM confermate diventano **checkpoint Phase 7** (review verifica che siano addressed nell'implementazione)
- **Pillola**: *"Red-team agents che SCELGONO il proprio angolo trovano falle che assegnazioni domain-specific miss. Diversity emerges dal prompt, non dal pre-assignment."*

**F. CLAUDE.md constraint scanner (Phase 4b)**
- Read CLAUDE.md → extract lines con NEVER/DO NOT/MUST NOT/PROHIBIT (case-insensitive)
- Per ogni prohibition: parse forbidden artifact → construct regex → grep working tree
- Esempio: "NEVER use JPA" → `grep -rn "javax.persistence\|jakarta.persistence\|@Entity" --include="*.java" src/`
- Any match (non-test, non-config) → FAIL con CLAUDE.md rule text + file:line
- Pattern che trasforma dichiarazione → enforcement automatico
- **Pillola**: *"CLAUDE.md prohibitions devono essere grep-able. Se 'NEVER use X' non si traduce in un regex eseguibile, è una bugia."*

**G. qualityGateCmd extraction priority (Phase 4c)**
- 3-step precedence: (1) explicit `**qualityGateCmd**: \`<cmd>\`` marker, (2) "before every commit" reference, (3) generic gate reference
- NEVER use "fast", "lint-only", "check-only" variant — those are pre-flight, not full gate
- Estratto una volta, usato in Phase 6 pre-commit check + dal hook `enforce-gate-before-pr.sh`
- **Pillola**: *"Gate command extraction deterministica con priority esplicita. Mai usare l'alias 'fast' per il gate finale."*

**H. Tech-debt inline create-issue-not-fix**
- Durante TDD se trovi pre-existing issue NOT in scope: crea GitHub issue con label `tech-debt` + `follow-up`, NON fixare inline (eccezione: trivial + in scope)
- **Soft-fail**: se `gh issue create` fails → append a `pendingFollowUps[]` in status.json → Phase 8 render nel PR body
- No cap su numero di issue create
- **Pillola**: *"Tech-debt found mid-task: GitHub issue, non in-line fix. PR body lista i pendingFollowUps che gh non è riuscito a creare."*

**I. 9-auditor con intelligent routing (Phase 7)**
- Always-on core: Auditor 2 (Code Quality), 3 (Architecture), 5 (Test Coverage), 8 (Build)
- Tag detection sul diff: HAS_SQL → +1+9, HAS_CONTROLLER → +1, HAS_CONCURRENCY → +7, HAS_NEW_CLASS → +3 deeper, HAS_CONFIG → +3 Spring, HAS_POM → +6, HAS_DEPRECATED → +4
- Special override: booking/availability files force +1+7+performance-smell-detection
- Skipped auditor: excluded da numerator AND denominator (no inflation)
- Weighted: Security 2x, Data Layer 2x, others 1x
- Threshold: ≥80 PASS / 60-79 CONCERNS / 40-59 REWORK / <40 FAIL
- Score cap 60 per RT-XX UNRESOLVED o [ALIGN-XX] critical findings (e verdict floor CONCERNS)
- **Pillola**: *"Intelligent routing > all-auditor-always. Skipped auditor exclusi dal weighted average — niente inflation."*

**J. Pre-PR integrity check (Phase 8)**
- 5 artifact MUST exist in `.claude/specs/<spec-name>/`: spec.md, plan.md, log.md (≥4 entries: Phase 0+1+2+7), review.md, status.json
- 4 status.json field MUST be set: reviewScore, reviewVerdict, branch, implementationStarted
- Failure → STOP con lista missing items, NO PR
- **Pillola**: *"PR integrity check sulla coerenza degli artefatti. 5 file + 4 field non vuoti, altrimenti niente PR."*

**K. claude-mem persistence con HTTP API (Phase 8)**
- POST a `http://127.0.0.1:37777/api/memory/save` con title + project + text
- Salva: red-team findings, review findings MAJOR+, STOP events, gotchas, touched paths, refs (issue + PR + spec)
- `save_memory` MCP tool removed in v10.4.4 — auto-save via PostToolUse hooks è continuo
- Soft-fail su curl failure
- **Pillola**: *"Cross-session learnings via HTTP POST a worker locale. MCP per read, HTTP per write."*

**L. Merged mode (multi-issue → 1 PR)**
- 2-5 issue → 1 spec unificata + 1 plan con `originIssue` tag per task + 1 PR con `closes #N` per OGNI issue
- Branch name: `<prefix>/<N1>-<N2>-<N3>-<slug-primary>`
- Spec ha sezione "Per-issue requirements" + "Unified acceptance criteria"
- Plan ha task con originIssue per audit trail granulare in git log
- Review verifica per-issue coverage (table con AC mapped per issue)
- **Pillola**: *"Merged mode: 1 PR per N issue correlate. Audit trail granulare via originIssue tag su ogni task. PR `closes #N` per ognuna."*

**M. Pillole rules — le 11 regole finali della skill**
1. CLAUDE.md is law
2. TDD is not optional (con task-type exception per infra/docs)
3. Commit AUTO quando tests green (nessun gate per commit individuali in interactive, gate solo per Estimate e PR)
4. Never force push
5. If in doubt, STOP
6. Quality gate before every commit
7. Secure coding checklist as review input
8. Issue lifecycle labels (in-progress in Phase 5, closes #N in PR body, in-review/staged/closed via GitHub Actions)
9. Tech debt captured, not fixed inline
10. **Red-team (2.7) + review (7) sono NON BYPASSABILI**
11. Mai delegare a `executing-plans`

## Settings.json — le scoperte

```json
{
  "model": "opusplan",
  "effortLevel": "xhigh",
  "advisorModel": "opus",
  "plansDirectory": "./.claude/specs",
  "language": "It",
  "voiceEnabled": true,
  "skipDangerousModePermissionPrompt": true,
  "skipAutoPermissionPrompt": true,
  "fileCheckpointingEnabled": false,
  "enabledPlugins": {
    "superpowers@claude-plugins-official": true,
    "context7@claude-plugins-official": true,
    "code-review@claude-plugins-official": true,
    "github@claude-plugins-official": true,
    "code-simplifier@claude-plugins-official": true,
    "playwright@claude-plugins-official": true,
    "security-guidance@claude-plugins-official": true,
    "claude-md-management@claude-plugins-official": true,
    "skill-creator@claude-plugins-official": true,
    "claude-code-setup@claude-plugins-official": true,
    "hookify@claude-plugins-official": true,
    "postman@claude-plugins-official": true,
    "microsoft-docs@claude-plugins-official": true,
    "caveman@caveman": true
  }
}
```

Plus hook `enforce-gate-before-pr.sh` come PreToolUse Bash matcher + PostToolUse ExitPlanMode che stampa il banner CONTEXT HANDOFF.

**Note interessanti**:
- `opusplan` model = cognitive routing automatico (Opus per plan/Sonnet per exec)
- 14 plugin abilitati (oltre 1 marketplace custom: caveman) — heavy plugin user
- `plansDirectory: "./.claude/specs"` — coerente con quello che il framework Mainsim già documenta in `PLAN_STORAGE.md` (vedi wave 1 famiglia rules+framework)
- `voiceEnabled: true` — interessante, sperimentazione voice input

## enforce-gate-before-pr.sh — il pattern marker-pinned gate

PreToolUse Bash hook (58 LOC) che blocca `gh pr create` se:
1. `.git/auto/gate-pass.json` non esiste → "Esegui: cd $REPO_ROOT && ./run.sh gate"
2. `marker.head_sha != HEAD` → "gate eseguito su X, HEAD ora Y — re-esegui ./run.sh gate"

Pattern: **il quality gate scrive un marker JSON con `head_sha` al successo**. L'hook PreToolUse verifica che il marker matchi HEAD prima di permettere la PR. Drift impossibile: ogni nuovo commit invalida il marker.

Sopporta anche worktree detection: se il command contiene `cd /path/to/worktree && gh pr create`, l'hook usa il worktree dir come EFFECTIVE_DIR.

**Pillola**: *"Marker-pinned gate. Quality gate scrive `.git/auto/gate-pass.json` con head_sha. PreToolUse hook blocca PR se marker assent o SHA != HEAD. È INV-59 di arbiter ma più semplice e più stretto."*

## Differenze critiche /auto Luca vs claude-automation-recommender ufficiale

Per chiudere il quadro: nel report principale §17.2 avevo confuso le due. Sono cose diverse.

| Aspetto                         | claude-automation-recommender Anthropic | /auto Luca                                 |
| ------------------------------- | --------------------------------------- | ------------------------------------------ |
| Scope                           | Suggerisce automations (read-only)     | Implementa l'intera pipeline issue→PR     |
| Output                          | Lista raccomandazioni (hook/skill/MCP/...) | PR mergiata su develop                |
| Side effects                    | Zero                                    | git commit, gh pr create, gh issue edit, claude-mem write |
| Volume                          | ~289 LOC                                | **1.241 LOC**                              |
| Quando si usa                   | Onboarding nuovo progetto              | Ogni feature/fix/chore                    |
| Pattern                         | Codebase analyzer                       | Lifecycle orchestrator multi-phase        |
| Modalità                        | Suggerisce, l'utente implementa        | Esegue end-to-end, gate solo a punti critici |

**Conclusione**: non sono in competizione. Luca avrebbe potuto creare entrambi (recommender per onboarding repo + auto per implementation lifecycle). Sono complementari.

## Cosa portare in arbiter (priorità)

### P0 — pattern-level (chat dedicata Wave 2A integrata)

Tutti questi sono pattern del `/auto` da incorporare nel design del `/task` arbiter v2 (Wave 2A già pianificato), oltre a quelli viafera già documentati in `commands.md`:

| Pattern Luca's /auto                          | A arbiter come                                            |
| --------------------------------------------- | --------------------------------------------------------- |
| **Existing-work detection (Phase 0.5)**       | Phase pre-spec di `/task` arbiter v2                       |
| **opusplan model integration**                | Default `"model": "opusplan"` in `src/templates/claude/settings.json.ejs` + Phase 3.5 hard handoff |
| **Anti-bypass guard via `"pipeline": "auto"`** | Generalizzato come `"pipeline": "arbiter-task"` in arbiter status.json + check in skill-forced-eval hook |
| **Spec challenger + plan challenger pattern** | Sub-agent dedicated in `/task` arbiter v2 (max 1+2 iterations) |
| **Red-team self-select angle**                | Migliora il `red-team` agent di arbiter (oggi ha verdict ma non self-select angle) |
| **CLAUDE.md constraint scanner**              | Nuovo `pre-edit-claude-md-scanner.mjs` hook che fa grep dei NEVER/DO NOT |
| **Tech-debt inline → issue + pendingFollowUps fallback** | Skill `tech-debt-capture` + integrazione con `/task` arbiter v2 |
| **9-auditor con intelligent routing**         | Migliora il `review` arbiter (oggi più scarno) |
| **Pre-PR integrity check (5 artifact + 4 field)** | Nuovo `check-pre-pr-integrity.mjs` script wired in `/task` arbiter v2 Phase Close |
| **claude-mem HTTP persistence**               | Opt-in se MCP claude-mem detected (vedi wave 1 strategia coesistenza) |
| **Merged mode (2-5 issue → 1 PR)**            | `/task #N1 #N2 #N3` syntax in arbiter v2 |
| **Marker-pinned gate (enforce-gate-before-pr.sh)** | Nuovo hook arbiter `enforce-gate-before-pr.mjs` con marker `.arbiter/gate/last-pass.json` |

### P1 — skill-level (la suite workflow)

Bundle proposto come **opzionale skill set arbiter** (`arbiter init --skills luca-workflow`):
- spec, plan, code, impact, estimate, preflight, start, status, handoff, replay
- worktree-manager + wt-open + wt-close (varianti più mature delle versioni arbiter)
- review (port-as-is, sostituisce review-code arbiter)
- close (port-as-is, sostituisce parte di /task close phase arbiter)

Volume totale: ~1.200 LOC. Tutti tradotti dalle paths viafera-specific a path arbiter-neutral.

### P2 — plugin Mainsim-specific

- **quality-alignment-audit** (198 LOC) → plugin `@arbiter/plugin-quality-alignment-java` (75+ dimensioni, brownfield/gold tier mapping, W0/W1/W2 wave plan, GitHub issue generation)

## Pillole career emerse (oltre le 34 già documentate nel report principale)

Aggiungerle alla §14 del `analysis-2026-05-25.md`. Le 6 più forti:

1. **[T] *"Sessioni separate per cognitive phase. Opus per pensare (Phases 0-3), Sonnet per fare (Phases 4-8). status.json è il bridge."*** — opusplan integration, hard session boundary in Phase 3.5
2. **[T] *"Pipeline ownership = anti-bypass guard. Se un'altra skill prende il tuo plan, sta saltando i tuoi gate."*** — il pattern `"pipeline": "auto"` in status.json + check anti-bypass è una primitive di safety
3. **[T] *"Red-team agents che SCELGONO il proprio angolo trovano falle che assegnazioni domain-specific miss. Diversity emerges dal prompt, non dal pre-assignment."*** — opposto del "1 security agent + 1 perf agent + 1 concurrency agent" standard
4. **[T] *"CLAUDE.md prohibitions devono essere grep-able. Se 'NEVER use X' non si traduce in regex eseguibile, è una bugia."*** — pattern che chiude il gap "doc declaration vs actual enforcement"
5. **[T] *"Marker-pinned gate. Quality gate scrive un JSON con head_sha al successo. PreToolUse hook blocca PR se marker SHA != HEAD. Drift impossibile."*** — variante più stretta di INV-59 arbiter (oggi parity di nomi, qui parity di SHA)
6. **[S] *"/auto è 1.241 righe perché ogni gate è memoria di un incident reale. Il 2026-04-09 una pipeline ha skip red-team + review → privilege escalation reale, falsi positivi nei test, PR senza qualità. La regola 'non bypassabili' è nata da quel giorno."*** — storia umana che rende vivo il "perché" del pattern

## DR strategy (bonus)

Lateral observation: il pattern DR di Luca (snapshot Mac config + skills in `mainsim-ai-framework/dr/`) è esso stesso una pillola di metodo:

- *"Asset critici senza remote = perdita silenziosa al primo guasto. 17 giorni di modifiche non committed in `~/.claude/skills/` sono il bug più comune nei dev AI-first."*

Pattern riusabile come `arbiter doctor backup` command — backup automatico dei `~/.claude/` asset critici (skill custom, hook, settings) in un repo dedicato.

## Conclusioni wave 1-bis

**Cambia il piano per Wave 2A** (`/task` arbiter v2 design). Le pattern viafera (commands.md §13 dell'audit precedente) restano valide ma vanno integrate con le **12 pattern Luca's /auto** sopra. Il risultato è un design molto più ricco:

- viafera porta: idempotency guards, context handoff decision, auto-checkpoint, score-based verdict, file-backed counter, track router, tier ceremony, plan review sub-agent, baseline capture
- Luca's /auto porta: existing-work detection, opusplan integration, anti-bypass guard, spec/plan challenger, red-team self-select angle, CLAUDE.md scanner, 9-auditor intelligent routing, pre-PR integrity check, claude-mem persistence, merged mode, marker-pinned gate, pendingFollowUps fallback

Combinati: il `/task` arbiter v2 punta a essere il **definitive open-source implementation della "AI-assisted task lifecycle"**, con due fonti di battle-testing (viafera Java/Spring product real-world + Luca's Mainsim work cross-project pipeline).

**Bonus**: il DR pattern di Luca è una pillola di metodo a sé stante che merita un proprio `arbiter doctor backup` command.

---

_Audit prodotto dopo recupero dello snapshot DR (`mainsim-ai-framework/dr/`) il 2026-05-26. File letti: `claude-skills/{auto,spec,plan,code,review,close,impact,estimate,preflight,start,status,handoff,replay,worktree-manager,wt-open,wt-close,quality-alignment-audit}/SKILL.md` + `dr/README.md` + `claude-config/settings.json` + `claude-config/hooks/enforce-gate-before-pr.sh` + `docs/adr/ADR-003_local-claude-config-dr.md`._

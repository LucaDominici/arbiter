# Wave 1 — Audit `.claude/hooks/` viafera

**22 hook, 1.638 LOC.** Tre famiglie: governance-enforcement, lifecycle-helper, completeness-guard. Arbiter ha già 19 hook attivi che coprono ~70% del territorio; restano 5-6 pattern viafera con vero valore aggiuntivo.

## Classificazione completa

| # | Hook                          | Event              | LOC | Label          | Priorità | Esiste già in arbiter? |
| - | ----------------------------- | ------------------ | --- | -------------- | -------- | ---------------------- |
| 1 | **guard-task-completion.sh**  | Stop               | 237 | **PORT-ADAPT** | **P0**   | Sì .mjs ma più semplice |
| 2 | **guard-done-evidence.mjs**   | UserPromptSubmit   | 105 | **PORT-AS-IS** | **P0**   | No                     |
| 3 | **skill-forced-eval.test.sh** | (test suite)       | 212 | **PORT-AS-IS** | **P0**   | No (esempio applicato di INV-39) |
| 4 | **worktree-setup.sh**         | WorktreeCreate     | 26  | **PORT-ADAPT** | **P1**   | No                     |
| 5 | **debug-state-on-failure.sh** | PostToolUseFailure | 117 | **PORT-ADAPT** | P1       | Sì .mjs, viafera più strutturato |
| 6 | **docker-debug-on-failure.sh** | PostToolUseFailure | 28  | **PORT-PLUGIN** | P2     | No                     |
| 7 | **post-edit-dispatch.sh**     | PostToolUse Edit\|Write | 103 | **DUPLICATE** | P3       | Sì .mjs                |
| 8 | **stop-dangerous.sh**         | PreToolUse Bash    | 94  | **DUPLICATE**  | P3       | Sì .mjs                |
| 9 | **lib.mjs / lib.sh**          | (lib)              | 141 | **DUPLICATE**  | P3       | Sì                     |
| 10 | **post-commit-check.sh**     | PostToolUse Bash   | 76  | **DUPLICATE**  | P3       | Sì .mjs                |
| 11 | **check-no-unused-exports.mjs** | PostToolUse Edit | 70 | **DUPLICATE** | P3       | Sì .mjs identico       |
| 12 | **check-circular-deps.mjs**  | PostToolUse Edit   | 68  | **DUPLICATE**  | P3       | Sì .mjs identico       |
| 13 | **skill-forced-eval.sh**     | UserPromptSubmit   | 67  | **DUPLICATE+**  | P2       | Sì .mjs (viafera ha keyword filter più ricco) |
| 14 | **run-hook.sh**              | (dispatcher)       | 67  | **DUPLICATE**  | P3       | Sì (lib pattern)        |
| 15 | **check-no-placeholders.mjs** | PostToolUse Edit  | 63  | **DUPLICATE**  | P3       | Sì .mjs identico       |
| 16 | **check-no-pii.mjs**         | PostToolUse Edit   | 57  | **DUPLICATE**  | P3       | Sì .mjs identico       |
| 17 | **pre-edit-ssot-guard.sh**   | PreToolUse Edit    | 33  | **DUPLICATE**  | P3       | Sì .mjs                |
| 18 | **pre-compact.sh**           | PreCompact         | 28  | **DUPLICATE**  | P3       | Sì .mjs                |
| 19 | **pre-edit-plan-anchor.sh**  | PreToolUse Edit    | 23  | **DUPLICATE**  | P3       | Sì .mjs (più maturo)    |
| 20 | **check-no-any.mjs**         | PostToolUse Edit   | 23  | **DUPLICATE**  | P3       | Sì .mjs identico       |
| 21 | logs/, *.log                  | —                 | —   | —              | —        | —                      |

## Tre da portare subito (P0)

### 1. `guard-task-completion.sh` (237 LOC, Stop hook) — **PORT-ADAPT**

Arbiter ha già una versione (`.mjs`) molto più semplice. La viafera è significativamente più sofisticata:

- **Stop hook**, fires alla fine di ogni assistant turn (vs UserPromptSubmit della arbiter version)
- Legge il transcript JSONL del turn corrente per fare introspection
- Detection di completion claim via regex patterns ("task complete", "all phases done", "PR merged", "ready to merge", ecc.) — case-insensitive, word-boundary-aware
- Conservative: se non riesce a leggere il transcript, exit 0 (allow)
- Specific: solo task/# branches con phase != complete
- Loggable: ogni decisione in `~/.claude/guard-task-completion.log`
- Exit 2 (block) quando completion claim senza evidenza Phase 1.3 (code review) + Phase 1.5 (verification)

**Per arbiter va adattato**:
- Sostituire il filtro `*viafera*` con detection neutra (qualsiasi repo arbiter-governed)
- Generalizzare phase Phase 1.3/1.5 a "review-phase-completed + verification-phase-completed" flag nel task state
- Sostituire `.claude/.task-phase` con coerente file arbiter
- Pattern di transcript introspection è oro — riusabile per altri hook

**Pillola**: "Stop hook che blocca declaration 'task complete' senza evidence reale di review + verification. Fail-closed."

### 2. `guard-done-evidence.mjs` (105 LOC, UserPromptSubmit) — **PORT-AS-IS**

Pattern brillante: **SHA-256 pinning di file critici al momento della "evidence capture"**, ricontrollati a ogni claim di completion. Se i file sono cambiati post-evidence → drift detected → BLOCK.

Flow:
1. User claim completion (regex `task complete | task completed | all phases complete | ready to merge | ...`)
2. Hook legge `.claude/.last-done-evidence.json` 
3. Per ogni `pinned_files[]` entry: ricalcola SHA-256 attuale, confronta con `entry.sha256`
4. Mismatch → exit 2 con messaggio "SHA mismatch — drift detected in <file>"
5. Anche `all_green !== true` → block

**Perché P0**: arbiter ha `.evidence/` ma niente SHA-pinning. Significa che oggi un agent può claim "task complete" dopo aver modificato silently un file post-gate-green. Questo hook chiude la finestra.

**Cosa modificare**:
- Generalizzare al concetto arbiter di evidence bundle (INV-27)
- Il file `.claude/.last-done-evidence.json` può vivere in `.evidence/#NNN/last-done-evidence.json` per coerenza
- Aggiungere script equivalente `done-evidence.mjs` che cattura SHA-256 al momento del gate-green

**Pillola tecnica**: *"Completion claim guard: SHA-256 pinning dei file critici al gate-green. Mismatch post-claim = drift detected = block fail-closed."*

### 3. `skill-forced-eval.test.sh` (212 LOC, test suite) — **PORT-AS-IS**

**Non è un hook**, è il TEST SUITE per il hook `skill-forced-eval.sh`. Verifica empiricamente:
- **False-negative rate** (impl prompt non-triggera hook) ≤ 5%
- **False-positive rate** (non-impl prompt triggera hook) ≤ 15%

Test cases divisi in categorie: italiani impl, inglesi impl, prompt domanda (non-impl), prompt comando bash (non-impl), ecc. Esegue il hook contro ogni prompt e conta hit/miss.

**Perché P0**: questo è **l'esempio applicato di INV-39** ("Hook templates require empirical fire-tests"). Arbiter dichiara INV-39 ma non ha empirical fire-tests visibili per i propri hook. Questo è il template che mostra come farli.

**Cosa modificare**:
- Generalizzare il pattern in arbiter come "every hook with smart filtering MUST have a `.test.mjs` file with measured false-positive/false-negative rates"
- Aggiungere il fire-test a `__tests__/hooks/empirical/` (cartella già esistente in arbiter per scripts altri)
- Wire come gate check L2 (drift detection: se la rate trascende le threshold → fail)

**Pillola**: "Smart hook filtering richiede empirical fire-test. False-positive rate ≤ 15%, false-negative ≤ 5%. Misurato, non sperato."

## Due da portare nel medio (P1)

### 4. `worktree-setup.sh` (26 LOC, WorktreeCreate) — **PORT-ADAPT**

26 righe, gravity alta: auto-install git hooks ogni volta che un worktree è creato. Risolve il problema "ADR-073 FEFIX dual-hook failure" (worktree senza hook installati ⇒ commit bypass del gate).

**Per arbiter**: il sistema `/wt-open` esiste già. Aggiungere un hook WorktreeCreate (o equivalente post-create-step) che installi automaticamente i git hooks viaffi `arbiter init --hooks-only` o equivalente. Eliminerebbe il problema di worktree "scoperti" che hanno il gate ma non i pre-commit/pre-push.

**Pillola**: *"Auto-install git hooks on worktree create. Worktree scoperti = silent bypass del gate."*

### 5. `debug-state-on-failure.sh` (117 LOC, PostToolUseFailure) — **PORT-ADAPT**

Arbiter ha la versione .mjs (88 LOC stimati). La viafera è più strutturata:
- Filtra precisamente per gate/test command via regex
- Conta failure totali (`Failure Count: N`) — pattern persistente
- Crea/aggiorna `DEBUG_STATE.md` in `.evidence/task-NNN/` con timestamp, branch, comando, errore truncato a 500 char
- Append entries con attempt count

**Cosa portare in arbiter**:
- Il pattern "failure count + attempts history" — più ricco di un semplice debug log
- Il filtro regex per gate/test commands (più preciso)
- L'output strutturato in MD per essere readable post-mortem

### Plus: `docker-debug-on-failure.sh` (28 LOC) — **PORT-PLUGIN**

Reminder esplicito di MCP forensics quando gate/test fails con Docker dipendency. È sostanzialmente un "soft escalation" verso `antigravity-verify` agent. Va nel plugin Java/Docker insieme alle skill Java.

## Quasi tutto il resto è DUPLICATE

Arbiter ha già equivalenti .mjs di: `stop-dangerous`, `post-commit-check`, `check-no-unused-exports`, `check-circular-deps`, `check-no-placeholders`, `check-no-pii`, `pre-edit-ssot-guard`, `pre-compact`, `pre-edit-plan-anchor`, `check-no-any`, `post-edit-dispatch`.

**Differenza chiave**: arbiter è andato giustamente full-mjs. Viafera è ancora half-bash, half-mjs (legacy). Non rebackport delle .sh viafera, anzi: il fatto che arbiter sia .mjs-only è UN UPGRADE (uniformità di runtime, debug più facile, no jq/bash version skew).

**Cosa cherry-pick comunque**: pattern di filtering o logging più ricchi viafera dovuti all'investimento manutentivo lì. Vale per:
- `post-edit-dispatch` viafera: ha branching FE/BE esplicito (`*/frontend/src/*.{ts,tsx,vue,js,css}` per prettier; `*/backend/*.java` per checkstyle). Arbiter `.mjs` potrebbe non avere questo branching dettagliato — verificare.
- `skill-forced-eval.sh` viafera: ha un keyword filter italiano+inglese più ricco di arbiter `.mjs`. Cherry-pick il regex pattern keyword.

## Pattern strutturali estratti

### A. "Stop hook con transcript introspection"

`guard-task-completion.sh` mostra come usare Stop hook per leggere il JSONL transcript del turn corrente e fare introspection sul testo che l'agent ha scritto. Pattern generalizzabile per:
- Detect quando l'agent fa claim non supportati da evidence
- Detect quando l'agent salta phase obbligatorie
- Detect quando l'agent menziona ma non esegue un comando required

### B. "SHA-pinning di evidence files come anti-drift"

`guard-done-evidence.mjs` mostra il pattern di freeze di un set di file al momento del gate-green con SHA-256, e ricontrollo al momento del claim. È la primitiva per "evidence integrity". Pattern riusabile per:
- Gate-result pinning (parityContentHash è simile concettualmente ma a livello workflow)
- Release artifact pinning (cosign SBOM è related)
- PR snapshot pinning

### C. "Hook empirical fire-test con measurable thresholds"

`skill-forced-eval.test.sh` mostra come trasformare un hook con smart filtering in un sistema misurabile. Threshold esplicite (FP ≤ 15%, FN ≤ 5%), failure caso = il gate fallisce. Pattern obbligatorio per qualsiasi hook con regex/keyword filter — altrimenti come fai a sapere se la regex ha smesso di funzionare?

### D. "Lifecycle hook per worktree create"

`worktree-setup.sh` mostra come usare l'evento WorktreeCreate per auto-installare hook. Pattern generalizzabile per:
- Auto-link `.env` simulato
- Auto-pull node_modules
- Auto-setup git config locale
- Auto-init `.claude/.task-id` se task argument passed

## Conclusioni hooks

**3 P0**: `guard-task-completion` (più sofisticato della arbiter version), `guard-done-evidence` (NUOVO concept SHA-pinning), `skill-forced-eval.test` (esempio applicato di INV-39).

**2 P1**: `worktree-setup` (chiude il "worktree scoperto" gap), `debug-state-on-failure` (più strutturato della arbiter version).

**1 plugin**: `docker-debug-on-failure` insieme alla suite java/docker.

**~15 DUPLICATE**: i 15 hook che arbiter ha già in .mjs non vanno toccati — anzi, il fatto che arbiter sia mjs-uniforme è un upgrade rispetto a viafera half-bash.

**Pillole emerse**:
- *"Stop hook + transcript introspection = enforcement contro claim non supportati da evidence."*
- *"SHA-pinning di evidence files al gate-green = drift impossibile."*
- *"Smart hook filtering ha bisogno di empirical fire-test misurato. FP ≤ 15%, FN ≤ 5%."*
- *"Worktree scoperti = silent gate bypass. WorktreeCreate hook obbligatorio."*

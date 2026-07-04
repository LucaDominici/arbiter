---
context:
  issue: '#1259'
  type: feat
  pipeline: 'plan → red-team → red → green → refactor → gate → PR'
  branch_convention: 'task/#1259-kebab-description'
  base_branch: main
  key_constraints:
    - 'Affinity computed UNCONDITIONALLY on every ship invocation — never behind a flag/option'
    - 'Low-affinity emits a WARNING only — never blocks the ship'
    - 'No any types (INV-04); all CLI shell-outs via runCli (INV-12)'
    - 'Port prior-framework rubric (+2 same domain:* label OR overlapping files; +1 same milestone OR same type:*; threshold 3) — re-derive, do not copy verbatim'
    - 'Keep runTaskShip pure/synchronous; do affinity I/O + reporting in the CLI action wrapper'
    - 'SCOPE FROZEN to #1259: scorer + warning + single-issue wiring only. No batch (#1263), no size→count (#1260), no dispatch matrix (#1267)'
  red_team_warnings:
    - 'Single-issue ship has no second operand for a pairwise score — must define honest reduction (best-match vs open same-milestone siblings; solo => low affinity)'
    - 'gh fetch can fail/be offline — affinity must degrade gracefully (report unavailable, never crash the ship)'
    - 'Dead-code risk: scorer must be wired end-to-end (declared → computed → printed), not an orphan export'
    - 'Dual-sided coherence: generated /ship prose must mention the affinity line so self+generated stay coherent'
  estimate: 'S (2h)'
---

# Plan: Issue #1259 — ship ALWAYS computes affinity + low-affinity warning

## Scope

Make `arbiter ship` ALWAYS compute an issue-correlation affinity score (ported from a prior
internal framework's `/task` correlation analysis) and emit an obvious low-affinity WARNING when the score is below
threshold. No flag — affinity runs on every `arbiter ship` invocation and is surfaced in the
step output. This is the reusable scorer + minimal single-issue wiring that #1260/#1263/#1267
build on. Batch orchestration, size→count, and the dispatch matrix are explicitly OUT of scope.

## Ported rubric (re-derived from a prior internal framework's `start-task §7.3` correlation analysis)

Pairwise factor scoring between two issues:
- +2 — same `domain:*` label OR overlapping files
- +2 — (overlapping files counted once with the domain rule, per the prior internal framework: "+2 for same domain:* label or overlapping files")
- +1 — same milestone
- +1 — same `type:*` label
- Score ≥ 3 → CORRELATED ; Score < 3 → UNCORRELATED (warn)

Re-derivation for arbiter: keep the integer weights and threshold 3; express as a pure function
`scoreAffinity(a, b)` over a minimal `AffinityIssue` shape (labels, milestone, files). Threshold
is a named constant `AFFINITY_THRESHOLD = 3` with an optional override parameter (config wiring
deferred to the #1258 profile resolver; documented in module).

## Single-issue reduction (honest)

`arbiter ship <id>` ships ONE issue. Affinity is computed as the issue's BEST pairwise score
against its open same-milestone sibling issues (fetched via `gh`, capped). Report the matrix of
sibling scores + the max. If no siblings (solo) OR fetch unavailable → affinity is reported as
solo/unavailable, which is itself a LOW-affinity signal → WARNING. This is faithful to the pairwise
rubric, runs always, and is the scaffolding #1263 (batch) reuses to score a fetched issue set.

## Architecture

1. NEW `src/affinity/affinity.ts` — pure scorer (no I/O):
   - `interface AffinityIssue { id; labels; milestone?; files? }`
   - `scoreAffinity(a, b): number` (pairwise)
   - `interface AffinityReport { subjectId; threshold; best; pairs; correlated; reason }`
   - `computeAffinityReport(subject, candidates, threshold?): AffinityReport`
   - `AFFINITY_THRESHOLD = 3`
   - `formatAffinityLines(report): string[]` — step-output rendering incl. the WARNING line
2. NEW `src/affinity/gh-issues.ts` — thin sync `gh` adapter (via runCli/runCliJson) that fetches
   the subject + open same-milestone siblings as `AffinityIssue[]`. Isolated so the pure scorer
   stays I/O-free and #1263 can swap in a batch issue-set.
3. EDIT `src/cli.ts` ship `.action()` — after computing the ship step, fetch issues + compute the
   report + append `formatAffinityLines(report)` to the printed `lines`. Wrapped so a fetch failure
   degrades to an "affinity unavailable" advisory, never throws. `runTaskShip` stays untouched/pure.
4. EDIT `src/templates/claude/commands/ship.md.ejs` — one prose line noting ship surfaces an
   affinity line + low-affinity warning (dual-sided coherence, CANON-01/14).

## Existing Code Survey

- **Target:** `src/affinity/affinity.ts`
- **Decision:** `new file justified`

### Evidence

- `grep "export.*[Aa]ffinity|export.*[Cc]orrelat|correlationScore|intraAffinity" src/ --include="*.ts" -l` → `(no match)`
- `grep "same milestone|domain:|overlapping files|labels.*intersect" src/ --include="*.ts" -l` → `src/notary/parser.ts` (unrelated: SBOM/license parsing, not issue correlation)
- `ls src/decomposition/` → `github-backend.ts markdown-backend.ts registry.ts types.ts` (WorkUnit type lacks milestone; backends do issue CRUD, not scoring)

### Rationale

No affinity or issue-correlation scorer exists anywhere in `src/` — the only label/milestone hit is in `src/notary/parser.ts`, which parses SBOM/license metadata and has zero overlap with issue correlation. The closest sibling, `src/decomposition/`, owns issue CRUD against GitHub/markdown backends and its `WorkUnit` type deliberately omits the `milestone` field the rubric needs; extending `WorkUnit` would pollute the backend abstraction with a ship-only scoring concern and force a milestone field on every decomposition consumer. The scorer is a distinct, pure, reusable responsibility (issue→issue correlation weights + threshold) that #1263/#1267 will consume, so a dedicated `src/affinity/` module with an I/O-free core is the architecturally correct home rather than overloading decomposition or the ship command file.

- **Target:** `src/affinity/gh-issues.ts`
- **Decision:** `new file justified`

### Evidence

- `grep "gh issue view|gh issue list|fetchIssue|getIssue" src/ --include="*.ts" -l` → `src/decomposition/github-backend.ts` `src/commands/task-record-tech-debt.ts`
- `grep "runCliJson|runCli(" src/decomposition/github-backend.ts` → uses runCliJson for `gh repo view` / issue list (backend-internal, returns WorkUnit not AffinityIssue)
- `ls src/affinity/` → `(none — new directory)`

### Rationale

The decomposition `GitHubBackend` already shells to `gh`, but it returns `WorkUnit` objects shaped for the decomposition lifecycle and crucially does not expose the `milestone` field the affinity rubric requires; reusing it would mean widening the backend interface and the `WorkUnit` type for a ship-only need. A thin, isolated adapter that fetches exactly the affinity signals (labels, milestone, files via PR-less heuristic) keeps the pure scorer free of I/O, lets the #1263 batch lane swap in its own issue set, and avoids coupling ship affinity to the decomposition backend contract. It re-uses the shared `runCli`/`runCliJson` helper (INV-12) so it is not a new spawn path.

## TDD (red first)

- `__tests__/affinity/affinity.test.ts` — scoreAffinity weights/threshold; computeAffinityReport best/correlated/solo; formatAffinityLines warning presence below threshold + absence at/above.
- `__tests__/commands/ship.test.ts` (CANON-06) — ship action prints an affinity line unconditionally (no flag); prints WARNING when computed affinity below threshold; degrades to "unavailable" advisory when fetch fails; affinity NOT gated by any option.

## Verification

`node scripts/check-all.mjs --level L2` GREEN. Adversarial verifier confirms: affinity computed
on EVERY invocation (no option guard), end-to-end wiring (declared→computed→printed), no dead code.

## Notes for sibling lanes

- `src/affinity/affinity.ts` `scoreAffinity` / `computeAffinityReport` are the reusable scorer #1263 (batch) and #1267 (matrix) consume.
- `src/affinity/gh-issues.ts` is the swap point: #1263 supplies its own fetched issue set instead of same-milestone siblings.
- Shared edited files (merge surface): `src/cli.ts` (ship action), `src/templates/claude/commands/ship.md.ejs`.

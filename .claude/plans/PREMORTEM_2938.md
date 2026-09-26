# Premortem — #2938 (CUT `arbiter audit run`; residuals of #2917)

Written against base `d70eb7c7` for #2917 (closed); delivered under #2938. Plan, RED path and AC ids use #2938; the allowlist entries being removed are the ones tagged `#2917`.

## 1. #2917 — CUT `arbiter audit run` from the playbook; gdpr doc stops citing the consumer path
### 1.1 Findings (measured at d70eb7c7)
- With both `#2917` entries deleted, `check-doc-links` exit 0, `check-doc-style` exit 0, and `check-phantom-command-scan` exit 1. The scan finds exactly these two phantoms: `phantom (script): docs/REFERENCE/gdpr-overlay.md: scripts/check-gdpr-controls.mjs does not exist` and `phantom: src/templates/governance/qa-audit-phases.md.ejs: arbiter audit run — run is not a registered subcommand of audit`.
- **The playbook is not emitted by any generator.** No `src/**/*.ts` references `governance/qa-audit-phases`. Only `__tests__/templates/governance-render.test.ts` and `__tests__/docs/casing-normalization.test.ts` render or read it. As a result, **0 of 27 bake lanes** hash it (grep over `bake/__snapshots__/*.json` = 0), there is no `examples/` copy, and there is no `.dogfood-divergences.json` entry. Trial GREEN measured `examples:check` exit 0 ("no drift") and `check-self-dogfood` exit 0. The template ships in `dist/templates` but is never rendered, so it is an orphan. Deleting the whole template is out of scope (the owner chose "drop the command").
- "Anything else that documents it": `git grep "audit run"` finds only the template (:78 and :118), the governance-render pin (:109-112), the allowlist reason, and the historical `.claude/plans/task-2917.md` (leave it alone: it is frozen evidence). `arbiter audit` itself is a real command, so no ledger row changes.
- `gdpr-overlay.md` cites the path at :51 (`<project>/scripts/check-gdpr-controls.mjs`) and :69 (`node scripts/check-gdpr-controls.mjs`). The table row at :42 splits the name and the dir into two cells, and the scanner does not flag it.
- The existing `__tests__/scripts/doc-gate-allowlist-2917.test.ts` (runs the three gates, expects exit 0) already exists, and after the cut it becomes the proof that the gates pass **without** the entries. Keep it unchanged.
- **Risk: #2917 is CLOSED**, and `.arbiter/evidence/tdd/#2917.json`, `ac-fit/2917.json`, `.claude/plans/task-2917.md` and `PREMORTEM_2917.md` already exist from the re-date PR. The writer overwrites the plan and the TDD evidence for the same id. `writeTddEvidence` refuses only *another task's* evidence (`task-record-red.ts:589`). Orchestrator pre-step: reopen #2917 (or file a follow-up issue and use its id) before `task start`. I did not probe whether `task start` refuses a closed issue.
- Gates: publicApiSurface 1174/1174 unchanged (measured after build). No TS change, so complexity cannot move. The docs gate is satisfied because `docs/` changes. **CUT gate:** one mechanism (`arbiter audit run`), `src/` delta **−21/+0** (template only). Counters: C7 0, C2 0, C3 0.

### 1.2 Plan `.claude/plans/task-2917.md` (replace), front matter
```yaml
---
context:
  issue: '#2917'
  type: fix
  pipeline: 'plan → red → green → refactor → review → close'
  branch_convention: 'task/#2917-cut-audit-run'
  base_branch: main
  key_constraints:
    - 'CUT: remove exactly `arbiter audit run` (template :75-94 section + :118 bullet); src delta < 0'
    - 'gdpr-overlay.md names check-gdpr-controls.mjs but never the literal scripts/ path; no scanner change'
  red_team_warnings:
    - 'The playbook is rendered by no generator: do not add a generator, bake or examples change'
    - 'Keep doc-gate-allowlist-2917.test.ts; it now proves the gates pass with entries: []'
  estimate: 'XS'
premortem: .claude/plans/PREMORTEM_2917.md
files:
  - .claude/plans/task-2917.md
  - .claude/plans/PREMORTEM_2917.md
  - src/templates/governance/qa-audit-phases.md.ejs
  - docs/REFERENCE/gdpr-overlay.md
  - scripts/data/doc-gate-allowlist.json
  - __tests__/templates/governance-render.test.ts
  - __tests__/scripts/doc-gate-cut-2917.test.ts
  - .arbiter/evidence/tdd/#2917.json
  - .arbiter/evidence/ac-fit/2917.json
---
```
### 1.3 RED `__tests__/scripts/doc-gate-cut-2917.test.ts` (29 lines, eslint exit 0)
Three cases: (1) the rendered playbook does not match `/arbiter audit run/`; (2) `gdpr-overlay.md` does not match `/scripts\/check-gdpr-controls\.mjs/`; (3) the allowlist has no `issue === '#2917'` entry. `record-red`: `npm run build && node dist/cli.js lifecycle record-red --task '#2917' --test-path __tests__/scripts/doc-gate-cut-2917.test.ts --test-command npx --test-arg vitest --test-arg run --test-arg __tests__/scripts/doc-gate-cut-2917.test.ts`

Executed in scratch (`npx vitest run <RED>`):
| State | Result |
|---|---|
| base d70eb7c7 | exit 1, `Tests 3 failed (3)`: × playbook… `arbiter audit run`, × gdpr-overlay…, × allowlist… (`expected [ {…}, {…} ] to deeply equal []`) |
| allowlist only | 2 failed: × playbook, × gdpr |
| allowlist + template | 1 failed: × gdpr |
| allowlist + gdpr (no template) | 1 failed: × playbook |
| template + gdpr (entries kept) | 1 failed: × allowlist |
| full GREEN | exit 0, `Tests 3 passed (3)` |

With full GREEN: `check-doc-links`/`check-doc-style`/`check-phantom-command-scan` exit 0 (`0 file(s) allowlisted`, `OK — every cited command exists in cli.ts (464 file(s) scanned)`). The neighbour run (allowlist-2917, governance-render, casing, phantom-scan test, RED) is `1 failed` until the governance-render pin :109-112 is deleted, then 119/119 pass.

### 1.4 GREEN pseudo-diff
```diff
# src/templates/governance/qa-audit-phases.md.ejs
-## Rerun command ... (lines 75-94: fenced `arbiter audit run [--phase NN] [--all] [--json]`, flags, "Each rerun:" list, trailing para)
-- **The arbiter audit run CLI command itself (planned, not yet shipped).** Stubbed in this PR's audit doc; ...
# docs/REFERENCE/gdpr-overlay.md
-The gate `<project>/scripts/check-gdpr-controls.mjs` maps each GDPR control to a required evidence
-artifact and fails (exit 1, blocking an L4 release) when any is missing or empty:
+The gate `check-gdpr-controls.mjs` (emitted into the project's `scripts/`) maps each GDPR control
+to a required evidence artifact and fails (exit 1, blocking an L4 release) when any is missing or empty:
-node scripts/check-gdpr-controls.mjs   # exit 0 = all controls have evidence; exit 1 = blocking gap
# scripts/data/doc-gate-allowlist.json
-  "entries": [ {…qa-audit-phases…#2917}, {…gdpr-overlay…#2917} ]
+  "entries": []
# __tests__/templates/governance-render.test.ts
-    it('contains arbiter audit run CLI signature', () => { … toMatch(/arbiter audit run/) })
```
The trial diff was 4 files, +3/−45. Optional line: the "Cadence enforcement" section still says "reruns each phase". That is correct, because each phase's own `rerun` command does the rerun. Leave it.
### 1.5 Verification (foreground, in order)
`npm run build` → `npx vitest run __tests__/scripts/doc-gate-cut-2917.test.ts __tests__/scripts/doc-gate-allowlist-2917.test.ts __tests__/templates/governance-render.test.ts __tests__/docs/casing-normalization.test.ts __tests__/scripts/check-phantom-command-scan.test.ts` → `for g in doc-links doc-style phantom-command-scan; do node scripts/check-$g.mjs; done` → `npm run typecheck && npm run lint` → `node scripts/debt-report.mjs --gate publicApiSurface --only-metric publicApiSurface` → `npm run examples:check` → `node scripts/check-self-dogfood.mjs` → `npm run test:e2e:bake` (expect no snapshot change; if any lane changes, STOP: the orphan finding is wrong) → `npx commitlint --from origin/main --to HEAD` → `node scripts/check-all.mjs L1`.
### 1.6 Premortem table
| # | Failure | Likelihood | Guard |
|---|---|---|---|
| 1 | `task start '#2917'` on a CLOSED issue refuses, or reuses stale ac-fit | M | Orchestrator reopens #2917 first; the writer regenerates ac-fit |
| 2 | Writer edits only :78 and leaves the "Each rerun" list and flags, so the prose is orphaned | M | Delete the whole `## Rerun command` section |
| 3 | Writer "fixes" the scanner (emitted-tree resolution) instead of the doc | L | key_constraints: no scanner change |
| 4 | Writer rewrites the gdpr table row :42 or adds `<project>/scripts/…` again | L | RED case 2 regex |
| 5 | Governance-render pin left in, so the suite goes red | H without brief | Delete :109-112 in the GREEN commit |
| 6 | Writer adds bake/examples paths "to be safe" | L | Measured 0 lanes; `files:` lists none |
### 1.7 Reviewer threat model
Check that the `src/` delta is negative and removes only the one mechanism. Check that no new excuse appears anywhere (the allowlist is `[]`, no `.dogfood-divergences` entry, no scanner skip). Confirm the gdpr doc still tells a consumer how to run the gate (through `check-all.mjs --level L2`). Confirm that `doc-gate-allowlist-2917.test.ts` runs unchanged and green, and that the RED was recorded before the GREEN.


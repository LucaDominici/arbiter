---
scenario: pr-red-and-recover
sha: 72a7d3c0426cecaf6913a87f9b453556ea6fb3fd
date: 2026-08-30
persona: An agent whose PR was green locally and is now red on a CI job it has never read
steps: 7
findings:
  blocker: 0
  major: 4
  minor: 2
---

# Tabletop — pr-red-and-recover

My PR was green locally and is red in CI. The closer-mode rule tells me to foreground-wait on
`gh pr checks --watch`, and that flag is real — that part of the loop holds. So I go looking
for which check actually blocks my merge, and the CI tier reference never names one: it is a
catalogue of workflow files and cadences. I ask GitHub directly and there is exactly one
required context, produced by a job the reference does not mention, which in turn waits on two
jobs that have no local command at all. Then I read the fix-on-red reference, which is the
policy I am supposed to apply — and it opens by telling me its own engine was deleted, its CLI
is gone, and the strike file it describes as schema-validated has no schema and no writer. I
run the one gate the catalogue names for confirming local reproducibility. It exits 0 and
tells me it skipped.

| step | doc claim (path:line) | observed | severity | class | proposed permanent check | owner |
| ---- | --------------------- | -------- | -------- | ----- | ------------------------ | ----- |
| 3 | docs/internal/METHOD/TABLETOP-SCENARIOS.md:118 — the exit criterion "Every required check named in the tier docs exists in a workflow" | `docs/REFERENCE/ci-tier-workflows.md` names no branch-protection required check anywhere; its "required set" at :122 is about workflow-FILE presence (INV-73 `minPresent`), not about what blocks a merge. `gh api repos/LucaDominici/arbiter/branches/main/protection/required_status_checks --jq .contexts` returned `["CI Required"]` — one context, produced by the `ci-required` job at `.github/workflows/01-pr-fast.yml:516`, named in no reference doc. The agent recovering from red cannot learn from the docs which check it must turn green | major | doc-drift | `scripts/check-ci-tiers.mjs`: assert every context in the repo's `required_status_checks` (or a checked-in mirror of it) appears as a named row in `docs/REFERENCE/ci-tier-workflows.md` | #2433 |
| 4 | docs/REFERENCE/fix-on-red.md:63 — the 1st-strike decision is `fix`, whose next action is "Reproduce the failed gate locally before push, then fix the root cause", declared at :74-76 a floor invariant "at every autonomy level" | the sole required check `ci-required` (`.github/workflows/01-pr-fast.yml:521`) `needs:` eleven jobs, two of which have no local command in existence: `dependency-review` (the GitHub `dependency-review-action`, API-only) and `iac-scan` (Checkov + tflint). Neither appears in the emitted `scripts/check-all.mjs` gate registry (grep count 0 for `dependency-review`, `iac-scan`, `checkov`, `tflint`) nor as a `Makefile` target — the targets are `help`, `check`, `gate`, `ci`, `full`, `simulate-nightly`, `simulate-weekly`, `evidence`, `clean`. When either goes red the mandated reproduce-before-push step is impossible | major | missing-gate | `scripts/check-local-ci-parity.mjs`: fail when a job that `ci-required` depends on has no counterpart gate id in the emitted registry and no Makefile target — a required CI job with no local twin is an unreproducible gate | #2435 |
| 5 | docs/internal/METHOD/TABLETOP-SCENARIOS.md:115 — the catalogued probe is "run the local-CI parity gate to confirm the failing job is locally reproducible" | `node scripts/check-local-ci-parity.mjs` exited 0 after printing "check-local-ci-parity: no completed CI run found for this branch" and "check-local-ci-parity: SKIP (neutral)". The gate the recovery loop is pointed at returns success without comparing anything about the failing run. `docs/internal/PRODUCT/GAP.md:70` (REQ-046) already records this verbatim — "Exit 0 still proves nothing, and the emitted Makefile/run.sh are executed by no test" | major | missing-gate | close REQ-046 as written there: a trunk-solo + `--github` conformance cell that runs a full L2 lane first, then re-runs the gate and asserts a non-neutral verdict | #2244 |
| 6 | docs/REFERENCE/fix-on-red.md:56 — "Attempts are remembered per task in `.arbiter/ship/<task-id>/attempts.json` (schema-validated, atomic write, gitignored local state)", with a full `ShipAttemptsV1` schema printed at :70-80 and the rule at :82-84 that an invalid file "never silently resets a live strike counter" | nothing validates it and nothing writes it. `grep -rn "attempts.json" src/ scripts/ schemas/` returns no hit; no schema file matching ship/attempts exists under `schemas/`. The doc itself concedes the writer is gone at :86 ("**Removed.** There is no \"arbiter ship-on-red\" binary anymore"), confirmed by `node dist/cli.js ship-on-red` exiting 1 with "error: unknown command 'ship-on-red'". The 2-strike memory that the closer-mode two-strike rule depends on is prose addressed to an agent, with no artifact, no validator and no gate — so a third blind retry is undetectable | major | phantom-command | `scripts/check-unwired-guards.mjs`: fail when a REFERENCE doc publishes a JSON schema block for a runtime artifact that has no schema file under `schemas/` and no writer under `src/` or `scripts/` | #2433 |
| 2 | docs/REFERENCE/ci-tier-workflows.md:46 — `01-pr-fast.yml` is summarised as "PR gate: lint, format, typecheck, unit tests, build, audit" | the live workflow defines fourteen jobs: `config-lint`, `security-early-fail`, `classify-changes`, `dependency-review`, `iac-scan`, `build-workspace`, `gate`, `unit-tests`, `docs-check`, `debt-gates`, `sonar-scan`, `gate-full`, `generated-gate-min`, `ci-required`, plus `post-merge-gate` and `post-merge-notify`. An agent triaging a red job named "IaC Scan (infra-changed)" or "Dependency Review (supply-chain)" will not find it in the row that claims to describe this workflow | minor | doc-drift | `scripts/check-ci-tiers.mjs`: assert each numbered workflow's description row mentions every job that `ci-required` depends on | #2433 |
| 3 | docs/REFERENCE/ci-tier-workflows.md:116-118 — "arbiter-self runs at `minPresent: 6` during the `migrationStatus: 'transition'` window, target projects require the full set" | `node scripts/check-ci-tiers.mjs` printed "OK — 8/8 canonical workflows present (INV-73 minPresent=6)": the repo already satisfies the full set, yet the lowered floor stays in force and neither the doc nor the catalog entry names an expiry date for the transition window. arbiter expires every other suppression (`scripts/check-suppressions.mjs`, `check-suppression-expiry.mjs`); this one is open-ended | minor | missing-gate | `scripts/check-suppression-expiry.mjs` (or `check-ci-tiers.mjs`): require `migrationStatus: 'transition'` in `src/invariants/catalog.ts` to carry an expiry date and fail once past it | #2419 |

## Appendix — verbatim probe output

Pinned tree: `72a7d3c0426cecaf6913a87f9b453556ea6fb3fd`.

Step 1 — the closer-mode rule's watcher flag is real (`gh pr checks --help`), so this leg of
the loop holds:

```
      --required          Only show checks that are required
      --watch             Watch checks until they finish
```

Step 3 — what actually blocks the merge:

```
$ gh api repos/LucaDominici/arbiter/branches/main/protection/required_status_checks --jq '.contexts'
["CI Required"]
```

…and what that job waits on (`.github/workflows/01-pr-fast.yml:521`):

```
    needs: [gate, unit-tests, generated-gate-min, security-early-fail, dependency-review,
            iac-scan, docs-check, sonar-scan, gate-full, debt-gates, classify-changes]
```

Step 4 — the local surface available to reproduce them (`Makefile` targets):

```
help:  check:  gate:  ci: gate  full:  simulate-nightly:  simulate-weekly:  evidence:  clean:
```

Step 5 — the parity gate the catalogue names:

```
$ node scripts/check-local-ci-parity.mjs ; echo EXIT=$?
check-local-ci-parity: static parity OK
check-local-ci-parity: check-level parity OK (156 checks verified)
check-local-ci-parity: no completed CI run found for this branch
check-local-ci-parity: SKIP (neutral)
[SKIP] no completed CI run found for this branch
EXIT=0
```

Step 6 — the strike engine:

```
$ node dist/cli.js ship-on-red ; echo EXIT=$?
error: unknown command 'ship-on-red'
EXIT=1

$ grep -rn "attempts.json" src/ scripts/ schemas/
(no output)
```

Step 3 — the canonical-presence gate:

```
$ node scripts/check-ci-tiers.mjs
check-ci-tiers: OK — 8/8 canonical workflows present (INV-73 minPresent=6)
```

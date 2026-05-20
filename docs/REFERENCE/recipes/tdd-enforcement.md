---
title: 'Recipe: TDD Evidence Enforcement (INV-26)'
doc_version: '1.1.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# Recipe: TDD Evidence Enforcement (INV-26)

Arbiter enforces TDD at the gate level. Every task-ID commit on a branch must
have recorded TDD evidence before it can advance to `green` phase or pass the
L2 gate.

## Workflow

```
1.  Write failing test                       # RED
    npx vitest run path/to/feature.test.ts   # → FAIL expected

2.  Record evidence
    arbiter task record-red --test-path path/to/feature.test.ts

3.  Implement until tests pass               # GREEN
    npx vitest run path/to/feature.test.ts   # → PASS

4.  Advance phase
    arbiter task advance --to green          # validates evidence + git checks

5.  Run gate
    node scripts/check-all.mjs L2           # tdd-evidence step verifies all task IDs
```

## Commands

### `arbiter task record-red --test-path <path>`

Runs `<path>` tests, captures the failure output, extracts a recognised failure
signature, and writes evidence to `.arbiter/evidence/tdd/<task-id>.json`.

The test **must fail** at the time of recording. If it passes, the command
rejects with an explanation.

```
arbiter task record-red --test-path __tests__/unit/feature.test.ts
# → wrote .arbiter/evidence/tdd/#551.json (vitest, 1 failure)
```

Custom test runner (e.g. pytest):

```
arbiter task record-red \
  --test-path tests/feature_test.py \
  --test-cmd "python -m pytest tests/feature_test.py"
```

### `arbiter task advance --to green`

Validates the evidence file:

- Evidence file exists for the current task ID
- `observed_failure` matches a recognised framework signature
- `test_commit_sha` exists in the repository
- `test_path` was present in that commit

Fails with a clear message if any check fails.

### `arbiter verify tdd <task-id> [--json]`

Auditable replay of all four evidence checks. Useful for CI verification and
post-hoc audits.

```
arbiter verify tdd '#551'
# PASS — #551 evidence verified (vitest)

arbiter verify tdd '#551' --json
# → { "status": "PASS", "taskId": "#551", "checks": [...] }
```

## L2 Gate Integration

`scripts/check-tdd-evidence.mjs` runs as part of `check-all.mjs L2`:

1. Finds all task-ID commits since `git merge-base origin/main HEAD`
2. Rejects any commit carrying an `ARBITER-SKIP-TDD: 1` trailer
3. Runs `arbiter verify tdd <id>` for each task ID found
4. Exits 1 if any verification fails

Branches with no task-ID commits pass vacuously (e.g. pure-docs branches).

## Recognised Test Frameworks

| Framework    | Failure signature         |
| ------------ | ------------------------- |
| Vitest       | `FAIL  <file>.test.ts`    |
| Jest         | `FAIL  <file>.spec.ts`    |
| pytest       | `=== FAILURES ===`        |
| Gradle/JUnit | `FAILED` / `BUILD FAILED` |
| Cargo        | `test result: FAILED`     |
| Go test      | `--- FAIL:`               |

## Gate Scope

Integration tests (`__tests__/integration/**`) run at L2+ only and are excluded from the
L1 pre-commit unit-test run. This allows RED integration tests to be committed before
evidence is recorded — the standard TDD cycle for tasks that dogfood arbiter itself.

## Filing Tech-Debt During Implementation

When a pre-existing violation is discovered in code not touched by the current task, file a
GitHub issue rather than scope-creeping the branch:

```bash
arbiter task record-tech-debt \
  --description "brief finding" \
  --triggered-by "#NNN"   # defaults to .claude/.task-id if omitted
```

Creates a GitHub issue labeled `tech-debt` + `follow-up` and appends the issue number to
`.arbiter/evidence/<task-id>/tech-debt.json`. Failure is soft (exit 0); reason written to stderr.

## Invariant

**INV-26** — enforced at L2 gate (`scripts/check-all.mjs L2 — arbiter verify tdd`) and
at `task advance --to green`. Bypass (`ARBITER_SKIP_TDD=1`) is accepted at L1
only; the L2 gate rejects commits carrying the `ARBITER-SKIP-TDD: 1` trailer.

## Non-Node Runners (#973)

For minimal CI runner images that lack Node (typical for Java/Rust/Go pipelines),
arbiter ships a POSIX-shell evidence writer:
`src/templates/scripts/evidence-writer.sh.ejs`. It emits the same
`TddEvidenceV1`-conformant JSON as `arbiter task record-red`, without depending
on Node or `jq`. Scaffolded projects whose primary stack is non-Node, or any
project under governance L3, can use it as a drop-in fallback:

```sh
./scripts/evidence-writer.sh \
  --task-id 999 \
  --test-path tests/feature_test.py \
  --observed-failure "FAIL  tests/feature_test.py"
# → writes .arbiter/evidence/tdd/#999.json
```

The script accepts `--phase`, `--out-dir`, `--test-commit-sha`, and
`--test-run-log-file`. It validates `--task-id` against `^#?[0-9]+$` and
defaults `test_commit_sha` to `git rev-parse HEAD`. Output is schema-validated
by the same `TddEvidenceV1` Zod schema used by the Node writer.

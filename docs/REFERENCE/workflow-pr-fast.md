---
title: 'Reference Implementation: PR Fast (T1) Workflow'
doc_version: '1.0.0'
status: active
last_review: '2026-06-07'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: ['090-workflow-performance-budget']
---

# Reference Implementation — PR Fast (T1) Workflow

> **Ground truth pattern.** Generated templates reference this document. Do not derogate from the
> structural principles described here without a corresponding ADR update.
>
> Performance budget: critical path ≤ 15 min, ≥ 3 parallel jobs, max `needs:` chain depth ≤ 2.
> See [ADR-090](../internal/ADR/090-workflow-performance-budget.md).

---

## Why this pattern?

Sequential CI pipelines are the leading cause of developer feedback latency. A 5-job chain running
sequentially at 5 min each takes 25 min; the same 5 jobs in two parallel stages takes 10 min.

The pattern below achieves ≤ 15 min critical path by:

1. **Fanning out** independent jobs in parallel (lint, unit tests, security scan)
2. **Caching build artifacts** once via a reactor job, reusing across downstream consumers
3. **Limiting `needs:` depth** to 2 hops from entry to any non-deploy sink

---

## Trigger contract — never filter the pull_request base branch (#2476)

On a `pull_request` event, `branches:` filters the **base** branch, not the head. A
merge-gate workflow declaring `branches: [main]` therefore matches nothing for a pull
request whose base is a task or train branch, and **GitHub creates no workflow run at
all**.

That is strictly worse than a red check. The pull request displays no _failing_ checks
because it has no checks, so every human or automated "no failing checks ⇒ mergeable"
read is satisfied by a pull request that was never tested. Branch protection is no
backstop either: protection is configured on the _base_ branch, and a task or train
branch carries none, so nothing is required there. Stacked pull requests are an in-use
practice here — the cloud handover runbooks describe merge trains where each row bases
on the row above — so coverage was being decided by merge order rather than by the gate.

The rule, for any workflow carrying a merge-gate aggregator job (`ci-required`,
`extended-required`):

- **No `branches:` and no `branches-ignore:`** on the `pull_request` /
  `pull_request_target` trigger. Run creation is unconditional in the base branch.
- **No `paths-ignore:`** on that trigger either — it suppresses run creation the same
  way, so the aggregator goes absent instead of reporting.
- Per-branch or per-path economy belongs **inside** the workflow: a job-level `if:`
  (T1's `classify-changes` / `docs_only`) or an in-workflow trigger job (T2's
  `check-trigger`). A skipped job still reports a result the aggregator reads, so the
  required check is always present and always honest.
- The `push:` trigger keeps its branch list. That lane is the post-merge catch-net for
  long-lived branches; widening it would multiply runner cost on every task-branch push
  for coverage the `pull_request` trigger already provides.

Mechanically enforced by `scripts/check-workflow-test-integrity.mjs` (INV-89), which
fails any workflow with a `*-required` aggregator job that filters its pull_request base
branch. Supplementary, path-scoped lanes (CodeQL, the frontend lane, contract smoke
tests) carry no aggregator, are not read as "CI is green", and are exempt.

---

## Annotated reference snippet

```yaml
# Reference: docs/REFERENCE/workflow-pr-fast.md
name: PR Fast (T1)

on:
  push:
    branches: [main]
  workflow_dispatch:
  # No `branches:` here — see "Trigger contract" below (#2476).
  pull_request:

permissions:
  contents: read

jobs:
  # ─── Stage 0: classify ──────────────────────────────────────────────────────
  classify:
    runs-on: ubuntu-latest
    outputs:
      skip-docs: ${{ steps.check.outputs.skip-docs }}
    steps:
      - uses: actions/checkout@v4
      - id: check
        run: |
          echo "skip-docs=${{ contains(github.event.head_commit.message, '[skip-docs]') }}" >> "$GITHUB_OUTPUT"
    # WHY: classify runs instantly and gates the expensive downstream jobs.
    # Anti-pattern: putting classification inside a later stage creates a sequential chain.

  # ─── Stage 1: fan-out (parallel) ────────────────────────────────────────────
  lint:
    needs: [classify]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm # MUST: always cache package manager artifacts
      - run: npm ci --prefer-offline
      - run: npm run lint
      - run: npm run typecheck
    # WHY: lint and typecheck share the same toolchain — combine to save setup overhead.
    # Anti-pattern: separate lint and typecheck jobs double the setup time for negligible parallelism gain.

  unit-tests:
    needs: [classify]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci --prefer-offline
      - run: npm run test -- --coverage
      - uses: actions/upload-artifact@v4
        with:
          name: coverage-${{ github.run_id }}
          path: coverage/
    # WHY: unit tests run independently of lint — parallel execution cuts wall-clock time.
    # The coverage artifact is uploaded for use by the debt-gates job downstream.

  security:
    needs: [classify]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci --prefer-offline
      - run: npm run check:security
    # WHY: security scan is I/O-bound and fits in Stage 1 without blocking lint/tests.

  # ─── Stage 2: convergence ───────────────────────────────────────────────────
  gate:
    needs: [lint, unit-tests, security] # depth = 2 from classify
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci --prefer-offline
      - uses: actions/download-artifact@v4
        with:
          name: coverage-${{ github.run_id }}
          path: coverage/
      - run: node scripts/check-all.mjs L1
    # WHY: gate waits for ALL Stage 1 jobs, then runs the full L1 check list including
    # coverage thresholds and debt ratchets. Running gate before Stage 1 completes would
    # check stale coverage. Running it in Stage 1 would force lint to wait for tests.
    # Anti-pattern: putting gate in Stage 1 (needs: [classify]) creates a false "gate" that
    # passes before unit tests have run.
```

---

## Anti-patterns

| Anti-pattern                                                      | Impact                                                 | Fix                                          |
| ----------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------- |
| `needs: [lint, unit-tests, security, gate, docs]` on a single job | Sequential chain depth ≥ 4; critical path = sum of all | Split into stage 1 + stage 2 fan-out         |
| No `cache: npm` on `setup-node`                                   | Every job re-downloads 200–400 MB                      | Add `cache: npm` or `cache: pnpm`            |
| Separate `lint` and `typecheck` jobs with no shared artifact      | Setup overhead × 2, no benefit                         | Combine in one job (same toolchain)          |
| Coverage gate in Stage 1 before unit tests finish                 | Gate runs against stale/absent coverage report         | Move gate to Stage 2 (`needs: [unit-tests]`) |
| `if: always()` on every gate step                                 | Masks failures; gate passes even if lint fails         | Use `needs:` convergence, not `if: always()` |

---

## Performance budget compliance

| Metric                   | Target           | How to verify                                 |
| ------------------------ | ---------------- | --------------------------------------------- |
| Critical path            | ≤ 15 min         | `gh run view --json timing`                   |
| Parallel jobs in Stage 1 | ≥ 3              | Count jobs with same `needs:` value           |
| Max `needs:` chain depth | ≤ 2              | `node scripts/check-workflow-parallelism.mjs` |
| Cache hit rate           | ≥ 80% after warm | GitHub Actions cache usage report             |

---

## Java/Maven variant

For Java projects, add a build reactor job in Stage 1 that compiles and uploads the artifact:

```yaml
build-reactor:
  needs: [classify]
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-java@v4
      with:
        java-version: '21'
        distribution: temurin
        cache: maven
    - run: mvn -B install -DskipTests -Dmaven.repo.local=.m2/repository
    - uses: actions/upload-artifact@v4
      with:
        name: m2-ci-${{ github.run_id }}
        path: .m2/repository
  # WHY: compiling once and uploading the Maven repo as an artifact avoids
  # re-downloading dependencies in each downstream consumer. The pattern
  # is verified by `check-workflow-cache-strategy.mjs` (L1 gate).

integration-tests:
  needs: [build-reactor] # depth = 2 from classify
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-java@v4
      with:
        java-version: '21'
        distribution: temurin
    - uses: actions/download-artifact@v4
      with:
        name: m2-ci-${{ github.run_id }}
        path: .m2/repository
    - run: mvn -B test -Dmaven.repo.local=.m2/repository
```

---

## Aggregator semantics — docs-only PRs

The `ci-required` aggregator accepts a `skipped` result for the code jobs (gate,
test suites, debt gates) **only** when `classify-changes` succeeded and reported
`docs_only=true` — the classification that skipped those jobs in the first place.
Any other skip, a cancelled job, or a failed/errored classification fails the
aggregator (fail-closed). The classify script's error path reports
`docs_only=false` so a broken classification always runs everything.

`01-pr-fast.yml` also runs on docs-only pull requests and is the sole workflow
allowed to report the required `CI Required` context. A companion docs shim
would create a premature duplicate context and is therefore prohibited.

## Related

- [ADR-090: Workflow Performance Budget](../internal/ADR/090-workflow-performance-budget.md)
- `scripts/check-workflow-parallelism.mjs` — enforces max chain depth
- `scripts/check-workflow-cache-strategy.mjs` — enforces cache/reactor patterns
- `__tests__/integration/workflow-perf.test.ts` — integration test

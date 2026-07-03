---
generated: true
source: 'docs/REFERENCE/workflow-pr-fast.md'
source_sha: '40a151dce21444f27e5fa1b816164d20c4e8925e'
last_updated: '2026-07-03'
---

# Reference Implementation: PR Fast (T1) Workflow

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/workflow-pr-fast.md](../docs/REFERENCE/workflow-pr-fast.md)

# Reference Implementation — PR Fast (T1) Workflow

> **Ground truth pattern.** Generated templates reference this document. Do not derogate from the
> structural principles described here without a corresponding ADR update.
>
> Performance budget: critical path ≤ 15 min, ≥ 3 parallel jobs, max `needs:` chain depth ≤ 2.
> See [ADR-090](../ADR/090-workflow-performance-budget.md).

---

## Why this pattern?

Sequential CI pipelines are the leading cause of developer feedback latency. A 5-job chain running
sequentially at 5 min each takes 25 min; the same 5 jobs in two parallel stages takes 10 min.

The pattern below achieves ≤ 15 min critical path by:

1. **Fanning out** independent jobs in parallel (lint, unit tests, security scan)
2. **Caching build artifacts** once via a reactor job, reusing across downstream consumers
3. **Limiting `needs:` depth** to 2 hops from entry to any non-deploy sink

---

## Annotated reference snippet

```yaml
# Reference: docs/REFERENCE/workflow-pr-fast.md
name: PR Fast (T1)

on:
  push:
    branches: [main, 'task/**']
  pull_request:
    branches: [main]

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

## Related

- [ADR-090: Workflow Performance Budget](../ADR/090-workflow-performance-budget.md)
- `scripts/check-workflow-parallelism.mjs` — enforces max chain depth
- `scripts/check-workflow-cache-strategy.mjs` — enforces c

*[content truncated — see source for full text]*

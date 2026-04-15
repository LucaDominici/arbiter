# ADR-023 — Self-Hosted CI Runner (docker-ci-build)

**Status:** Accepted  
**Date:** 2026-04-15  
**Issue:** [#128](https://github.com/LucaDominici/arbiter/issues/128)

---

## Context

Arbiter's GitHub Actions CI previously ran entirely on GitHub-hosted `ubuntu-latest` runners. The sibling project **haben** already solved this differently: all Linux CI jobs run on a self-hosted runner advertised under the label `docker-ci-build`, with the fallback expression `${{ vars.CI_BUILD_RUNNER_LABEL || 'docker-ci-build' }}` (codified as INV-11 in haben's `docs/SYSTEM/GLOBAL_INVARIANTS.md`).

Running arbiter on `ubuntu-latest` while haben uses `docker-ci-build` creates two problems:

1. **Inconsistency** — projects that arbiter initialises inherit `ubuntu-latest` in their generated CI workflow, diverging from the infra standard on Luca's projects.
2. **Cache miss** — npm and tool caches are never warm on GitHub-hosted ephemeral runners; the self-hosted pool retains these between runs.

---

## Decision

Adopt the haben runner pattern across both surfaces:

### Surface A — Arbiter's own CI

`.github/workflows/ci.yml`: replace `runs-on: ubuntu-latest` on all jobs with:

```yaml
runs-on: ${{ vars.CI_BUILD_RUNNER_LABEL || 'docker-ci-build' }}
```

Add top-level `concurrency:` (cancel-in-progress on non-main branches) and per-job `timeout-minutes:` to prevent hung jobs from blocking the shared runner queue.

### Surface B — Generated CI template

`src/templates/github/workflows/ci.yml.ejs`: same replacement on all 9 `runs-on:` occurrences. Downstream projects initialised by `arbiter init` receive the self-hosted expression by default — strict parity with haben.

The `vars.CI_BUILD_RUNNER_LABEL` escape hatch allows overriding to any label (including `ubuntu-latest`) via a repo variable with no file changes.

---

## Alternatives considered

**`ubuntu-latest` as template fallback** — would make `arbiter init` work out of the box for projects without a self-hosted runner. Rejected: arbiter is Luca-governed infrastructure; all target projects share the `docker-ci-build` pool. A "fail loud" CI on unregistered runners is the intended signal to register the runner, not a reason to silently regress to GitHub-hosted.

**Dedicated `arbiter-ci-build` label** — would isolate arbiter's CI traffic. Rejected: unnecessary ops overhead; the shared `docker-ci-build` pool is sufficient and warm.

---

## Consequences

- All Linux CI legs in arbiter's own repo and in generated workflows target `docker-ci-build` by default.
- Ops can redirect any repo to a different runner (or back to `ubuntu-latest`) by setting `CI_BUILD_RUNNER_LABEL` as a repo variable — no PR required.
- New invariant **INV-13** added to `AGENTS.md` to enforce this permanently.
- Prior art: haben INV-11 (`haben/docs/SYSTEM/GLOBAL_INVARIANTS.md:173-181`).

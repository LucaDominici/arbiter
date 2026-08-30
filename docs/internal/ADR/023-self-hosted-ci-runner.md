---
title: 'ADR-023 — Self-Hosted CI Runner (docker-ci-build)'
doc_version: '1.0.0'
status: superseded
last_review: '2026-07-04'
owner: ''
canonical_id: '023'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-023 — Self-Hosted CI Runner (docker-ci-build)

**Status:** Accepted  
**Date:** 2026-04-15  
**Issue:** [#128](https://github.com/LucaDominici/arbiter/issues/128)

---

## Context

Arbiter's GitHub Actions CI previously ran entirely on GitHub-hosted `ubuntu-latest` runners. A prior internal project already solved this differently: all Linux CI jobs run on a self-hosted runner advertised under the label `docker-ci-build`, with the fallback expression `${{ vars.CI_BUILD_RUNNER_LABEL || 'docker-ci-build' }}` (codified as INV-11 in that prior internal project's `docs/SYSTEM/GLOBAL_INVARIANTS.md`).

Running arbiter on `ubuntu-latest` while the prior internal project uses `docker-ci-build` creates two problems:

1. **Inconsistency** — projects that arbiter initialises inherit `ubuntu-latest` in their generated CI workflow, diverging from the infra standard on Luca's projects.
2. **Cache miss** — npm and tool caches are never warm on GitHub-hosted ephemeral runners; the self-hosted pool retains these between runs.

---

## Decision

Adopt the runner pattern re-derived from a prior internal project across both surfaces:

### Surface A — Arbiter's own CI

`.github/workflows/ci.yml`: replace `runs-on: ubuntu-latest` on all jobs with:

```yaml
runs-on: ${{ vars.CI_BUILD_RUNNER_LABEL || 'docker-ci-build' }}
```

Add top-level `concurrency:` (cancel-in-progress on non-main branches) and per-job `timeout-minutes:` to prevent hung jobs from blocking the shared runner queue.

### Surface B — Generated CI template

`src/templates/github/workflows/ci.yml.ejs`: same replacement on all 9 `runs-on:` occurrences. Downstream projects initialised by `arbiter init` receive the self-hosted expression by default — strict parity with that prior internal convention.

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
- Prior art: a prior internal project's INV-11 (`docs/SYSTEM/GLOBAL_INVARIANTS.md:173-181`).

---

## 2026-05-20 — Default flipped to `ubuntu-latest` (#959)

**Status:** This ADR is superseded (see frontmatter). Its original per-project default
(`docker-ci-build`) was reversed for Track B (target projects arbiter generates) by this
amendment and closed further by the 2026-07-04 amendment below. The override mechanism
(`CI_BUILD_RUNNER_LABEL`) remains intact and unamended. Arbiter's own CI (Track A, this
repo) is unaffected by this flip — it still runs on `docker-ci-build`, governed directly
by AGENTS.md's CI runner convention rather than by this ADR's now-superseded default.

**Reason for flip:** arbiter is a framework for AI-assisted development on heterogeneous projects. Scaffolded projects rarely have a self-hosted pool. Defaulting to `docker-ci-build` forced new users into an infra ramp-up (registering a runner) before CI could green — a silent regression for first-time onboarding.

**What changed:**

- The `${{ vars.CI_BUILD_RUNNER_LABEL || 'docker-ci-build' }}` fallback now uses `'ubuntu-latest'` as the default in every template under `src/templates/github/workflows/` and in arbiter's own `.github/workflows/{01-pr-fast,02-pr-extended}.yml`.
- Projects that DO have a self-hosted pool continue to override via the same `CI_BUILD_RUNNER_LABEL` repo variable — no template change required, no migration.
- INV-13 still enforces "no hardcoded runner strings"; the SSOT is unchanged.

**Operational impact:**

- Arbiter's own CI no longer bottlenecks on the single `arbiter-slot-build` machine. T1/T2 PR jobs run on GitHub-hosted runners (parallel, ~20 concurrent by default for public repos).
- Self-hosted users see no change.
- Future scaffolded projects default to `ubuntu-latest`; users who want self-hosted set the repo variable.

The "Alternatives considered → ubuntu-latest as template fallback" rationale (above) was correct for the closed-stack context of that prior internal project but wrong for arbiter's framework role. This update overturns that rejection.

---

## 2026-07-04 — Drift closed: 5 templates still defaulted to `docker-ci-build` (#1770, #1756)

The 2026-05-20 flip missed the `gated-review + L3Plus` runner branch in five templates
(`06-nightly-lite`, `15-codeql`, `16-frontend-quality`, `17-ossf-scorecard`,
`18-frontend-lane`): their `_runner` ternary still fell back to the bare self-hosted label,
so an `arbiter init` repo without the `CI_BUILD_RUNNER_LABEL` variable rendered workflows
that queue forever. All five now fall back to `'ubuntu-latest'`, with per-template render
tests locking the invariant. Repos that set the variable are unaffected.

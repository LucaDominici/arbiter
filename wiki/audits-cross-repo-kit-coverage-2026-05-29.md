---
generated: true
source: 'docs/audits/cross-repo-kit-coverage-2026-05-29.md'
source_sha: 'f1bac4207453e1f6fb9de6b8eb58d620c763a7a3'
last_updated: '2026-06-07'
---

# Cross-Repo Kit-Coverage Audit — 2026-05-29

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/audits/cross-repo-kit-coverage-2026-05-29.md](../docs/audits/cross-repo-kit-coverage-2026-05-29.md)

# Cross-Repo Kit-Coverage Audit — 2026-05-29

**Scope:** arbiter, viafera, coach-system, haben
**Lens:** the external gold-standard quality kit (Rev02, private source) — 827 dimensions (Java 305 / FE 374 / Infra 148).
**Method:** read-only assessment. The kit is a Java-Spring + Vue standard, so only viafera takes it literally. The three TypeScript/Node repos are scored **by intent** against arbiter's 76-dim canonical rollup (`docs/audits/kit-canonical-mapping.json`); Java-literal dimensions with no TS analogue are **N/A**.

> This is an audit of pre-existing state, not an application pass. Coverage % is `MET / applicable` (applicable = 76 − N/A, per stack).

## Summary

| Repo             | Stack                      | Lens                    | Applicable | MET     | PARTIAL | ABSENT       | N/A | Coverage |
| ---------------- | -------------------------- | ----------------------- | ---------- | ------- | ------- | ------------ | --- | -------- |
| **arbiter**      | TS CLI / self-framework    | 76-canonical            | 47         | 38      | 5       | 4            | 29  | **81%**  |
| **viafera**      | Java/Spring + Vue          | full 827 (178 assessed) | 178        | 105 (Y) | 53 (P)  | 8→**10** (N) | 6   | **63%**  |
| **coach-system** | TS React + Express + Tauri | 76-canonical            | 54         | 33      | 12      | 9            | 22  | **61%**  |
| **haben**        | TS/Node Express (no FE)    | 76-canonical            | 64         | 27      | 22      | 15           | 12  | **42%**  |

## Per-repo findings

### arbiter — 81% (highest)

Self-coverage is exceptional: ~90 gate scripts, ~25 hooks, 100+ enforced invariants, 8-workflow CI with SLSA provenance + cosign + Trivy + SBOM + nightly mutation. The canonical mapping **understates** reality (see Data-integrity #1).

### viafera — 63% (only repo on the full kit)

Strong literal coverage: ArchUnit (27 files / 113 tests), JaCoCo 90/89/90, PITest threshold 90, Pact, CycloneDX SBOM, Flyway (120 migrations). **Central finding (confirmed + understated): "built but not gated"** — the entire L2 gate bundle (jacoco-verify, dep-check, pitest, cosign, trivy-config, sbom) is wired into **zero** CI workflows.

### coach-system — 61%

A real arbiter consumer with fail-closed enforcement. Strong: vitest 90/90/90 per-path, Stryker mutation, Playwright E2E, Zod request validation, Trivy, auth/CSRF/rate-limit middleware.

### haben — 42% (the outlier)

Governance scaffold is heavy (arbiter-init L3, 30 check scripts, 10 workflows, hooks) but the **application barely exists** (5 middleware files, no layers, no Dockerfile, no API spec). So much generated infra (k6, ZAP, Pact, a11y harness) is **configured but inert** — no subject to run against. A maximally-scaffolded skeleton awaiting the app.

## Gap patterns

1. **Accessibility (a11y) is the universal gap** — unmet in arbiter (INV-61 asserted, not self-enforced on the website), coach-system (heavy React UI, zero a11y tooling), and the viafera FE (no axe-core). → **arbiter #1103**.
2. **"Built but not gated"** — capability exists, enforcement doesn't reach CI (viafera L2 bundle in no workflow; partial in arbiter).
3. **Java-literal dims are legitimately N/A** for the Node repos (ArchUnit-Java, Spring annotations, JPA/MyBatis, Maven SBOM, PITest) — intent is covered by TS analogues (madge, Zod, Stryker).
4. **Stack-honest gaps** — coach-system: no circular-dep gate, no commitlint enforcement, no SLSA on release. haben: app-layer dims inert until the app is built.

## Data-integrity findings (why the artifacts can't be cited as proof)

1. **arbiter `kit-canonical-mapping.json` is Rev00** (live source is Rev02), with wrong `arbiter_target_path` values → understates real coverage (~16 dims marked pending are actually live + gated). → **arbiter #1104**.
2. **viafera `kit-status.json` does not reconcile** — totals block sums 172 (Y105/P53/N8/NA6) but the granular array is 178 rows (Y112/P52/N10/NA4). Real absences = **10, not 8**. → **viafera #3578**.

## Follow-up issues

| #                                                            | Repo    | Title                                                              |
| ------------------------------------------------------------ | ------- | ------------------------------------------------------------------ |
| [#1103](https://github.com/LucaDominici/arbiter/issues/1103) | arbiter | Self-enforce a11y (INV-61) on the website                          |
| [#1104](https://github.com/LucaDominici/arbiter/issues/1104) | arbiter | Refresh kit-canonical-mapping Rev00→Rev02 + fix stale target paths |
| [#3578](https://github.com/LucaDominici/viafera/issues/3578) | viafera | Reconcile kit-status.json totals vs granular array                 |

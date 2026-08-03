---
title: 'ADR-104: Trivy fs replaces OWASP Dependency-Check for JVM dependency scanning'
doc_version: '1.0.0'
status: active
last_review: '2026-07-10'
owner: ''
canonical_id: '104'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-104: Trivy fs replaces OWASP Dependency-Check for JVM dependency scanning

**Project:** arbiter
**Date:** 2026-07-10
**Status:** Accepted

## Context

Every java/kotlin/multi dep-audit path arbiter scaffolds (`_shared-security.yml.ejs`
`dep-cve-refresh`, `06-nightly-lite.yml.ejs` `dep-cve-refresh`, `check-all.mjs.ejs`'s local
L2 gate, `AGENTS.md.ejs`) ran the OWASP Dependency-Check CLI: a static zip download plus a
full NVD (National Vulnerability Database) database sync on every run. In practice that NVD
sync is slow and frequently flaky without an `NVD_API_KEY` — a failure mode independently hit
running the equivalent OWASP DC step in another downstream project: multi-minute hangs and
intermittent CI timeouts, entirely independent of the code being scanned.

Separately, arbiter-self already carries a `trivy-fs-scan` release-gate job
(`.github/workflows/05-release.yml`, INV-92) and three more `aquasecurity/trivy-action` call
sites for container scanning (`02-pr-extended.yml.ejs`, `04-deploy-test.yml.ejs`,
`05-release.yml.ejs` `trivy-strict-release`) — the version pin, `.trivyignore` suppression
convention, and `trivy-db` cache pattern are already established in the codebase. OWASP DC
was a second, differently-shaped dependency-scanning stack living alongside a Trivy stack
that already does the same job for container images.

A parallel audit (the "refusi" census, 2026-07-10) also found that this OWASP DC stack had
accumulated dead weight: `owasp-suppressions.xml` was emitted for java/kotlin/multi with no
consumer (R-05); `dependency-check-suppressions.xml` was emitted unconditionally for every
language even though only JVM ever used OWASP DC (R-06); `config/owasp-dependency-check.gradle`
was flagged in #1887 §F as a gradle snippet the generated project's own build never
`apply`-ies; and `dependency-check/Dependency-Check_Action` was a Docker-outside-of-Docker
action (#1785) requiring a bespoke pinned-CLI workaround that Trivy's composite action never
needed in the first place.

## Decision

Replace OWASP Dependency-Check with Trivy fs as the JVM dependency-audit tool everywhere
arbiter scaffolds it:

- **Pattern:** `trivy fs --scanners vuln --severity HIGH,CRITICAL --exit-code 1 --ignorefile
.trivyignore .` — `HIGH,CRITICAL` + `exit-code 1` is the Trivy-fs equivalent of OWASP DC's
  `--failOnCVSS 7` (INV-13: CVSS ≥ 7.0 blocks).
- **CI:** the shared `_partials/trivy-fs-java.ejs` partial (renamed from
  `owasp-dependency-check-java.ejs`) runs `aquasecurity/trivy-action` (the same pinned
  version already used for container scanning) with `scan-type: fs`, included from both
  `_shared-security.yml.ejs` and `06-nightly-lite.yml.ejs` so the two java branches cannot
  drift apart.
- **Kotlin gap closed:** kotlin had no local dep-audit step at all (R-15) despite the
  cross-language-matrix declaring JVM dependency scanning for it; the trivy fs step is now
  wired into `check-all.mjs.ejs`'s kotlin branch too.
- **Suppressions:** `.trivyignore` (CVE allowlist with mandatory `exp:YYYY-MM-DD # reason=…
owner=@…` metadata, INV-31) moves to the project ROOT — every existing Trivy step already
  reads `trivyignores: .trivyignore` there — and its emission condition broadens from
  "JVM only" to "JVM or service archetype", since the container-scan Trivy steps read the
  same root file for services of every language, not just JVM. `owasp-suppressions.xml` and
  the unconditionally-emitted `dependency-check-suppressions.xml` are deleted outright (dead
  weight, R-05/R-06) rather than migrated.
- **05-release.yml.ejs / INV-92 parity:** arbiter-self's `trivy-fs-scan` job is now also
  emitted by the generic 05-release template for every archetype, closing the gap where
  INV-92's enforcement text promised a job the generated output never shipped (R-01/R-09).
- `config/owasp-dependency-check.gradle` is deleted outright — it exits the #1887 §F
  "gradle snippet never wired" backlog instead of needing to be wired in.

## Consequences

### Positive

- No NVD API key, no full-database download — trivy fs queries the GitHub Advisory
  Database / OSV, matching the downstream-project fix referenced above and eliminating
  the slow/flaky-download failure mode entirely.
- One dependency-scanning stack (Trivy) instead of two — the version pin, `.trivyignore`
  suppression format, and cache pattern are shared with container scanning instead of
  duplicated.
- Closes four pre-existing dead-weight refusi in the same swap: `owasp-suppressions.xml`
  (R-05, orphan), `dependency-check-suppressions.xml` (R-06, wrong scope), the
  `dependency-check/Dependency-Check_Action` docker-container workaround and its
  `check-docker-action-runner-safety.mjs` allowlist entry (R-11), and the never-wired
  `config/owasp-dependency-check.gradle` snippet (#1887 §F).
- `.trivyignore`'s expiry/reason/owner metadata is now validated by
  `check-suppressions.mjs` (R-16) — previously only the OWASP DC XML suppressions were
  gate-validated; `.trivyignore` had no expiry enforcement at all.
- Kotlin gets a real local dep-audit gate for the first time (R-15).

### Negative

- Existing arbiter-generated projects that already have `suppressions/owasp-suppressions.xml`,
  `suppressions/dependency-check-suppressions.xml`, or `suppressions/.trivyignore` keep those
  files on disk (`skipIfExists`/user-owned) — `arbiter update` does not delete them. Migrating
  those consumers is a separate, explicit decision (tracked, not part of this ADR).
- OWASP Dependency-Check's CVSS scoring source (NVD) and Trivy's (GitHub Advisory DB/OSV) are
  not byte-identical vulnerability feeds; a CVE present in one and not (yet) mirrored in the
  other is a possible detection-coverage gap in either direction, accepted as a background risk
  shared with every other Trivy call site already in this codebase.

## Links

- Related ADRs: none (ADR-047/ADR-024 predate this decision and are left as historical record)
- Issues: #1785 (Dependency-Check_Action docker-container defect), #1767 (osv-scanner
  pinned-CLI precedent), #1877 (java branch shared-partial extraction), #1887 §F
  (gradle-snippet-never-wired backlog); NVD API key / slow-download experience motivating
  this swap independently observed in another downstream project

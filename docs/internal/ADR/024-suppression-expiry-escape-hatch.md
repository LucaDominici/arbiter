---
title: 'ADR-024 — Suppression Pattern with Mandatory Expiry'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: '024'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-024 — Suppression Pattern with Mandatory Expiry

**Status:** Accepted  
**Date:** 2026-04-16  
**Milestone:** MC (Phase 9.5 Foundation — resolves C5 from antagonist review)

---

## Context

Arbiter's fail-closed gates (OWASP Dependency Check, gitleaks, PII regexes, ArchUnit) have no
escape hatch. False positives create merge deadlocks: a legitimate test-fixture secret or a
transitive CVE with no upstream fix blocks every PR indefinitely. Teams working around the deadlock
disable the gate entirely — the opposite of the intended outcome.

The root tension is "once chosen, enforced" (C1 — coercion into permanent decisions) versus
"fail-closed by default" (the system's core posture). An escape hatch exists in every mature
security programme; the problem is that ad-hoc `// nocheck` style suppressions become
permanent-by-default and accumulate as invisible debt.

---

## Decision

Introduce **principled suppressions** — a `suppressions/` directory generated into every target
project alongside four format-specific files and a meta-schema. Every suppression entry must carry
four mandatory metadata fields. An expiry date is strictly enforced by a new L1 gate script,
`scripts/check-suppressions.mjs`, wired into the generated `check-all.mjs`.

### Suppression files generated

| File                                             | Format               | Validated by        |
| ------------------------------------------------ | -------------------- | ------------------- |
| `suppressions/dependency-check-suppressions.xml` | OWASP DC native XML  | comment-block regex |
| `suppressions/.gitleaksignore`                   | Gitleaks native      | comment-block regex |
| `suppressions/pii-allowlist.json`                | JSON array           | direct field parse  |
| `suppressions/archunit-baseline.json`            | JSON array           | direct field parse  |
| `suppressions/suppressions-schema.json`          | JSON Schema draft-07 | reference only      |
| `scripts/check-suppressions.mjs`                 | Node ESM gate        | —                   |

### Mandatory metadata fields (INV-31)

Every suppression entry must have all four fields. Missing fields fail the gate.

| Field       | Type   | Constraint                                          |
| ----------- | ------ | --------------------------------------------------- |
| `reason`    | string | ≥ 10 chars; must reference a tracking issue         |
| `owner`     | string | GitHub handle format `@username`                    |
| `expiresAt` | string | ISO 8601 date (`YYYY-MM-DD`), must be in the future |
| `scope`     | string | CVE ID, package name, class pattern, or `all`       |

### Metadata convention per format

- **JSON files** — metadata fields are properties on each array entry object.
- **XML** — a `<!-- reason: X | owner: @foo | expiresAt: YYYY-MM-DD | scope: Y -->` comment must
  immediately precede every `<suppress>` element.
- **Gitleaks** — a `# reason: X | owner: @foo | expiresAt: YYYY-MM-DD | scope: Y` comment must
  immediately precede every suppression fingerprint line.

### Gate behaviour

- **Exit 0** — all entries have valid fields and future expiry dates.
- **Exit 1** — any entry has a past expiry date, or any required field is missing.
- **Stderr warning (exit 0)** — any entry expires within 30 days.
- Runs at **L1** (fast-check level, every commit).

### Feature flag

`enableSuppressions: boolean` on `ProjectConfig`, auto-set to `true` for all governance levels in
`buildConfigFromAnswers`. No user wizard question — suppressions are a security/debt concern
independent of governance tier; even L1 projects may encounter CVE false positives.

---

## Consequences

- **No permanent suppressions.** Every waiver must be renewed before the expiry date or removed
  when the underlying issue is resolved. The gate re-triggers when `expiresAt` passes — there is no
  silent accumulation.
- **Merge deadlocks have a principled exit.** Teams can unblock a PR by adding a time-bounded
  suppression entry instead of disabling the gate.
- **XML and gitleaks formats require comment discipline.** A `<suppress>` or fingerprint without a
  preceding meta comment fails the gate — there is no way to add a suppression silently.
- **No runtime schema library.** `check-suppressions.mjs` uses hand-written field validation
  consistent with arbiter's convention of no runtime dependencies in generated scripts.
- **Language-agnostic.** All five suppression files apply uniformly across TypeScript, Java, Rust,
  Go, and Python target projects.

---

## Alternatives rejected

| Alternative                                           | Reason rejected                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| No escape hatch — teams open upstream issues and wait | Practical deadlock when CVE has no fix available; causes gate-disabling, the worst outcome              |
| `// nocheck`-style per-line annotations               | No expiry, no owner, no trackable reason — suppressions silently accumulate forever                     |
| Per-team config file with max duration                | Configurable max duration creates debate; a fixed 30-day warning is simpler and equally effective       |
| JSON sidecar `metadata.json` for XML/gitleaks         | Entries in native files lack inline context; sidecar files drift out of sync with the native format     |
| Derive `enableSuppressions` from `enableDebtGates`    | Suppressions cover gitleaks and PII gates which are active even without debt gates; orthogonal concerns |
| Wizard question for `enableSuppressions`              | Adds wizard length with no useful default-off use case; always-on is safer                              |

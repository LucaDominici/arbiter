---
title: 'Vulnerable dependencies reach production because warnings get ignored'
doc_version: '1.0.0'
status: active
last_review: '2026-06-01'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Vulnerable dependencies reach production because warnings get ignored

> `npm audit` prints a wall of warnings nobody acts on, and a high-severity CVE ships anyway.

## The problem

Dependency advisories are noisy and advisory-only by default, so high-severity vulnerabilities reach
production. A scan that doesn't fail the build is a scan that gets scrolled past.

## Who feels it

- Teams with a supply-chain or security-review obligation.
- Maintainers drowning in advisory noise who want a hard line, not a feed.

## How arbiter enforces it

At **L2**, `arbiter init` generates a per-stack dependency-audit gate (INV-13) that **fails the build
on CVSS ≥ 7.0**:

- npm: `npm audit --audit-level=high`
- Java: OWASP Dependency-Check with `failBuildOnCVSS=7.0`
- Go: `govulncheck` · Python: `pip-audit` · Rust: `cargo audit` (rustsec)

It runs in CI and in the local L2 gate as a HARD check.

Source: invariant catalog (INV-13); [Enforcement Philosophy](/governance/) ("CVSS ≥ 7.0 must fail the
build").

## How to verify

In a generated L2 project:

```bash
# Pin a known-vulnerable dependency version, then:
node scripts/check-all.mjs L2   # the dep-audit step fails the gate
```

## What it does NOT do

- It is **not free of trade-offs** — it adds PR time and can block on transitive CVEs you don't
  control.
- It is **not a silver bullet for legacy debt** — pre-existing vulnerable deps must be triaged into a
  suppression baseline with a mandatory expiry (see [suppression expiry](/problems/suppression-expiry)),
  then enforced forward. arbiter forces the decision; it does not auto-fix the dependency.

## Related

- [Suppressions become permanent](/problems/suppression-expiry)
- [Secrets / PII slip into commits](/problems/secrets-pii)

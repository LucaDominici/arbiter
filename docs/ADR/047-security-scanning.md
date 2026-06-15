---
title: 'ADR-047: Security Scanning Suite (M24)'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: '047'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-047: Security Scanning Suite (M24)

**Date:** 2026-04-17
**Status:** Accepted
**Issue:** #72

---

## Context

Arbiter generated suppression scaffolding (`.gitleaksignore`, `pii-allowlist.json`, `dependency-check-suppressions.xml`) and an expiry gate (`check-suppressions.mjs`) but no scanners to consume them. INV-11/12/13 existed in the catalog with `alwaysActive: false` and no enforcement. Result: generated projects had suppression infrastructure but no security gates.

The prior-art baseline enforces three scanners: OWASP DependencyCheck (CVSS ≥ 7.0 hard fail), Gitleaks (secrets), and a custom regex PII scanner (early-fail, runs before all other gates). M24 ports this to the 5-stack matrix.

---

## Decisions

### 1. INV numbering — upgrade existing, not new

Issue #72 proposed INV-31/32/33, but those IDs were already taken (INV-31=suppression expiry, INV-32=real-project fixtures). Upgraded existing latent INV-11/12/13 from `alwaysActive: false → true`, added `minGovernanceLevel: "L2"`, populated `enforcement` with per-stack commands. No catalog growth. Matches the M22/M23 upgrade pattern.

### 2. INV-12 scope broadened

Original wording "No PII in logs" was runtime-only. Reworded to "No PII in code, tests, or logs" to cover the static scan case. Same invariant ID, broader scope.

### 3. PII scan is HARD early-fail — no grace period

PII scan runs **before the L1 section** in `check-all.mjs`, not in the L2 block. It does not use `soft: graceActive`. Rationale: leaked PII is a compliance violation regardless of where the project is in its governance upgrade journey. Matches production-baseline JOB 00b position.

### 4. Gitleaks and dep audit honor grace period

Unlike PII, gitleaks and dep audit run in the L2 block and use `soft: graceActive` (ADR-028). Rationale: a project upgrading from L1 may have existing secrets or vulnerabilities that require triage time — grace period prevents hard-blocking the team while they remediate.

### 5. Java OWASP DC as snippet, not build.gradle.ejs

Arbiter does not emit `build.gradle.ejs` (the user owns their Gradle file). OWASP DC is emitted as `config/owasp-dependency-check.gradle` + `apply from:` instruction — the same pattern used for `spotbugs.gradle.ejs`. The user wires the `apply from:` line manually.

### 6. Per-stack dep audit tools

| Stack      | Tool                    | Rationale                              |
| ---------- | ----------------------- | -------------------------------------- |
| TypeScript | `npm audit`             | Native, no extra install               |
| Rust       | `cargo audit` (rustsec) | Ecosystem standard                     |
| Java       | OWASP Dependency-Check  | CVSS scoring, suppression file support |
| Go         | `govulncheck`           | Official Go team tool, OSV database    |
| Python     | `pip-audit`             | PISA/PyPA recommended                  |

### 7. Trivy deferred to M25

Trivy is a container/filesystem scanner appropriate for nightly pipelines (M25), not the per-PR gate. Leaving a TODO(#73) placeholder.

### 8. alwaysActive: true for security invariants bypasses tier selection

With INV-11/12/13 as `alwaysActive: true`, they appear in AGENTS.md and GLOBAL_INVARIANTS.md for all presets at L2+ — even if "security" tier is not explicitly selected. This is intentional: security scanning is not opt-in at L2+.

### 9. Three-way scan split — secrets vs PII-in-text vs data/state files (#1407/#1408, INV-129)

Repository content hygiene is enforced by three **non-overlapping** scanners, each owning a distinct failure class. The split exists because no single scanner catches all three, and the gaps between them are exactly where real leaks hide:

| Scanner                          | Targets                                                                   | Skips                                                  | INV     |
| -------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------- | ------- |
| **gitleaks**                     | SECRET PATTERNS in tracked text (API keys, tokens, private-key headers)   | files with no secret-shaped match; binary content     | INV-11  |
| **pii-scan.mjs**                 | TEXT PII (emails, names, phone numbers) in source/tests/logs              | **binaries by extension** (`.png`, `.jpg`, … skipped) | INV-12  |
| **check-no-tracked-artifacts.mjs** | DATA/STATE files (`*.sqlite`/`*.db*`) + build artifacts (`*.tgz`) + compiled binaries (magic-byte ELF/Mach-O/PE) | allowlisted fixtures + font/image/`.wasm`/`.pdf` | INV-117/129 |

**Why a committed `finance.sqlite` trips none of the first two:** it carries no secret-shaped token (gitleaks: clean), and it is a binary so the PII scan skips it by extension (PII-scan: not even read). A SQLite database can hold thousands of PII rows — names, emails, financial records — and pass both secret and PII gates silently. INV-129's `check-no-tracked-artifacts.mjs` is the **only** gate that catches it, by presence (`git ls-files` glob) and by magic-byte binary sniff. This is the load-bearing retroactive fix: it catches files already in the index, where the stack-aware `.gitignore` (greenfield-prevention only, `skipIfExists:true`) cannot help.

INV-117 stays the selfOnly `*.tgz` build-artifact rule (arbiter's own npm-pack hygiene). INV-129 is the broader DATA/STATE axis, `selfOnly:false`, so governed targets inherit the same guard via the generated `check-no-tracked-artifacts.mjs`. Binary detection is magic-byte-PRIMARY so a renamed Go/Rust binary cannot evade it; go.mod / cargo names are a secondary hint only.

---

## Consequences

- Every L2+ project generates PII scan, gitleaks, and dep audit wired into both local gate and CI.
- Security tier now appears in AGENTS.md/GLOBAL_INVARIANTS.md for standard and essential presets at L2+ (previously only appeared for full preset).
- INV-12 now covers static scanning of source code, not just runtime log safety.
- Trivy (container scan) remains ungenerated until M25.

---
generated: true
source: 'docs/REFERENCE/iso27001-overlay.md'
source_sha: '5b0b2c3e45cf708c9716518db63cb89a7ab09d32'
last_updated: '2026-06-08'
---

# ISO 27001 Overlay — Reference

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/iso27001-overlay.md](../docs/REFERENCE/iso27001-overlay.md)

# ISO 27001 Overlay — Reference

**Issue:** #1252 | **Umbrella:** #1248 (CI/CD & Compliance Parity) | **Language:** any (language-neutral)

## Overview

The ISO 27001 overlay emits an **Annex-A controls → gate traceability** document. Unlike a
coverage scorecard (see the static `ISO27001_ANNEX_A.md` Annex-A matrix produced by
`enableIso27001Mapping`), this overlay is a Definition-of-Done: each enforceable Annex-A
technological control is bound to a concrete, fail-closed arbiter gate that an auditor can
re-run. A failing gate is a non-conformity that blocks the release — it does not merely warn.

It is **stackable** — `industryOverlay: 'iso27001'` is an orthogonal enum value that coexists
with the pharma (21 CFR), GDPR, and ISO 9001 compliance work; selecting it does not conflict
with the project's other governance.

## Activation

Set `industryOverlay: 'iso27001'` in your `arbiter.json` (or pass the flag at `arbiter init`):

```bash
arbiter init --industry-overlay iso27001
```

The overlay is language-neutral and emits on any stack.

## Emitted Files

| File                            | Location           | Purpose                                             |
| ------------------------------- | ------------------ | --------------------------------------------------- |
| `iso27001-controls-gate-map.md` | `docs/compliance/` | Annex-A controls → fail-closed arbiter gate mapping |

The file uses `skipIfExists: true` — brownfield re-init never overwrites auditor edits. The
generic audit-trail policy and gate-rules docs (emitted by the shared audit overlay for any
non-`none` overlay) are also produced alongside it.

## Controls Covered

The overlay maps the **technological** Annex-A controls that arbiter can mechanically enforce:

| Annex-A        | Control                                | Bound fail-closed gate                                                             |
| -------------- | -------------------------------------- | ---------------------------------------------------------------------------------- |
| A.8.25         | Secure development life cycle          | `check-all.mjs` (L1/L2/L3) + module-boundary rules (dependency-cruiser / ArchUnit) |
| A.8.26         | Application security requirements      | OWASP / ZAP DAST + STRIDE threat model                                             |
| A.8.28         | Secure coding                          | SAST (eslint-security / semgrep) + dependency-check (`npm audit` / OWASP)          |
| A.8.29         | Security testing                       | `gitleaks` + `pii-scan` + the security test suite                                  |
| A.8.32         | Change management                      | Commit-footer rationale audit (**INV-119**) + ff-only PR/gate process (INV-101)    |
| A.5.15 / A.8.4 | Access control / access to source code | Branch protection + CODEOWNERS + INV-23 (no direct push to `main`)                 |
| A.5.21         | ICT supply-chain security (SBOM)       | SBOM + cosign signing + SLSA provenance + dependency vulnerability scan            |

Organizational, people, and physical controls (A.5 / A.6 / A.7) remain manual and are tracked
in the broader Annex-A coverage matrix.

## Regulatory Context

- **ISO/IEC 27001:2022 Annex A** enumerates 93 controls across four themes (organizational,
  people, physical, technological). This overlay focuses on the technological controls whose
  conformity evidence a CI gate can produce.
- Because the bound gates are the same ones the project already runs, ISO 27001 conformity for
  this enforceable subset is a byproduct of a green pipeline — re-run `node scripts/check-all.mjs`
  to regenerate the evidence.

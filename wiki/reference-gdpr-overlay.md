---
generated: true
source: 'docs/REFERENCE/gdpr-overlay.md'
source_sha: 'd00766686500103fb72923266eb740c1e4b159eb'
last_updated: '2026-07-02'
---

# GDPR Overlay — Reference

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/gdpr-overlay.md](../docs/REFERENCE/gdpr-overlay.md)

# GDPR Overlay — Reference

**Feature:** industryOverlay=gdpr (controls→gates) | **Issue:** #1251 | **Language:** language-neutral

## Overview

The GDPR overlay turns `industryOverlay: 'gdpr'` from a doc-only selection into a **real,
enforceable** generator. It composes the language-neutral audit-trail docs (shared with the
`sox`/`generic` overlays) with a GDPR-specific controls→gates layer: a PASS/FAIL gate script
plus the evidence artifacts that gate enforces (DPIA, personal-data flow map, controls→gate
traceability).

Unlike the pharma overlay (Java-only JPA/ArchUnit scaffolding), the GDPR overlay is
language-neutral — its controls are documentation + an executable gate, so it applies to any
stack and is stackable with the `iso27001` / `cfr` compliance mappings without file collisions.

## Activation

Set `industryOverlay: 'gdpr'` in your `arbiter.json` (or pass the flag at `arbiter init`):

```bash
arbiter init --industry-overlay gdpr
```

## Emitted Files

| File                      | Location                | Purpose                                                             |
| ------------------------- | ----------------------- | ------------------------------------------------------------------- |
| `audit-trail-policy.md`   | `docs/compliance/`      | Shared language-neutral audit-trail policy (from the generic path)  |
| `audit-gate-rules.md`     | `docs/compliance/`      | Shared AUD-01..AUD-07 audit gate rules (from the generic path)      |
| `check-gdpr-controls.mjs` | `scripts/`              | **Enforceable** GDPR controls gate (exit 1 on missing evidence)     |
| `dpia.md`                 | `docs/compliance/gdpr/` | Data Protection Impact Assessment (Art. 35)                         |
| `data-flow-map.md`        | `docs/compliance/gdpr/` | Personal-data flow inventory + retention windows (Art. 30, 5(1)(e)) |
| `controls-to-gates.md`    | `docs/compliance/gdpr/` | Controls→gate traceability matrix                                   |

All files use `skipIfExists: true` — brownfield re-init never overwrites user customisations.

## Controls → Gates

The gate `scripts/check-gdpr-controls.mjs` maps each GDPR control to a required evidence
artifact and fails (exit 1, blocking an L4 release) when any is missing or empty:

| Control | GDPR article | Statement                                      | Evidence artifact                       |
| ------- | ------------ | ---------------------------------------------- | --------------------------------------- |
| GDPR-01 | Art. 35      | A DPIA is documented for high-risk processing. | `docs/compliance/gdpr/dpia.md`          |
| GDPR-02 | Art. 30      | Personal-data flows are inventoried.           | `docs/compliance/gdpr/data-flow-map.md` |
| GDPR-03 | Art. 17      | Right to erasure is implemented and tested.    | `controls-to-gates.md` (erasure hook)   |
| GDPR-04 | Art. 6, 7    | A lawful basis / consent is recorded.          | `controls-to-gates.md` (consent hook)   |
| GDPR-05 | Art. 5(1)(e) | Retention windows are documented and enforced. | `docs/compliance/gdpr/data-flow-map.md` |

## Gate Wiring

The gate is wired into the generated project's L2 quality gate (`check-all.mjs`) via an
`existsSync`-guarded `runCheck` — it only runs for projects where the GDPR overlay emitted the
script, so non-GDPR projects are unaffected:

```bash
node scripts/check-gdpr-controls.mjs   # exit 0 = all controls have evidence; exit 1 = blocking gap
node scripts/check-all.mjs --level L2  # runs the GDPR gate as part of L2
```

## Regulatory Context

- **Art. 35 (DPIA):** high-risk processing requires a documented impact assessment.
- **Art. 30 (records of processing):** controllers must maintain a record of processing activities.
- **Art. 17 (right to erasure):** data subjects can require deletion of their personal data.
- **Art. 6 / 7 (lawful basis / consent):** each processing activity needs a recorded lawful basis.
- **Art. 5(1)(e) (storage limitation):** personal data must not be kept longer than necessary.

## Relationship to Other Overlays

- **pharma** — Java-only audit scaffolding; satisfies the shared AUD-01..AUD-07 rules via JPA +
  ArchUnit. GDPR satisfies them via the language-neutral audit docs.
- **sox / generic** — emit the shared audit docs only. GDPR composes those docs with its
  enforceable controls layer.
- **iso27001 / cfr mappings** — stackable: GDPR controls and the compliance mapping docs coexist
  without file collisions.

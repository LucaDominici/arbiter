---
title: External KIT Sources
type: reference
status: active
date: 2026-05-19
doc_version: '1.0.0'
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# External KIT Sources

Reference pointers to the three source documents that define the engineering quality standard.
All three files are REDACTED-origin: reference their patterns and structure; do not copy verbatim.

---

## KIT Catalog Source

| Field             | Value                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------- |
| File              | `[tools]/KIT_gold-standard_76-dimensions_REDACTED.xlsx`                                                               |
| Revision          | Rev00 07/05/2026                                                                                                      |
| Columns           | A=# · B=Categoria · C=Dimensione · D=Dettaglio/Gate · E=TML · F=Gate Type · G=Planning Source · H=Note Adattamento    |
| Rows              | 1-3 empty · 4 header · 5 category separators · 6-95 data (76 dims)                                                    |
| Arbiter canonical | `src/kit/canonical-mapping.json` (machine-readable, runtime data) · `docs/audits/kit-canonical-mapping.md` (rendered) |

### TML Notation

The XLSX uses `L1/L2/L3` for the "Technical Maturity Level" column.
Arbiter re-maps to `M1/M2/M3` to avoid collision with arbiter's CI gate-depth notation `T1/T2/T3`.
Mapping: `L1=M1`, `L2=M2`, `L3=M3`. Both values stored in JSON (`tml` + `tml_source`).
Authority: ADR-045.

### Gate Type Variants

Enumerated from the XLSX:

- `BLOCKING` — compile-time or fast-test gate; blocks PR merge
- `BLOCKING (ArchUnit R-NN)` — ArchUnit-specific blocking rule
- `BLOCKING(nightly)` — blocks nightly pipeline pass
- `BLOCKING(-Pcontract)` — blocks contract test profile
- `BLOCKING(-Pbehavioral)` — blocks behavioral test profile
- `ADVISORY` — emits warning; does not block
- `REFERENCE` — documentation item; no enforcement gate

### How to Refresh

When the KIT is revised:

1. Obtain new XLSX at the canonical path above
2. Run: `node /tmp/gen-wave1-json.mjs` (or equivalent regeneration script)
3. Diff `src/kit/canonical-mapping.json` to identify changed dims
4. Update arbiter target mappings as needed
5. Run `node scripts/check-kit-catalog-parity.mjs` to verify (W2 deliverable)

---

## CI/CD Developer Reference — Concrete Instance

| Field          | Value                                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| File           | `[tools]/TECH_cicd-developer-reference_REDACTED.md`                                                       |
| Type           | `technical-documentation` — concrete instance for planning service                                        |
| Coverage       | 8 user-active workflows + 9 automatic workflows · PR lifecycle · run.sh↔CI parity table · troubleshooting |
| Arbiter analog | `docs/REFERENCE/cicd-developer-reference.md` (W4 deliverable)                                             |

---

## CI/CD Developer Reference — Template

| Field          | Value                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| File           | `[tools]/TPL_cicd-developer-reference_REDACTED.md`                                                                                    |
| Type           | `template` — placeholder-driven copy template for new services                                                                        |
| Placeholders   | `{{SERVICE_NAME}}` · `{{TEST_URL}}` · `{{NIGHTLY_TOOLS}}` · `{{NIGHTLY_CRON_UTC}}` · `{{WEEKLY_CRON_UTC}}` · `{{WEEKLY_DESCRIPTION}}` |
| Arbiter analog | `docs/REFERENCE/cicd-developer-reference.md` (W4 Track B deliverable)                                                         |

---

## Source Repo: internal-ref

| Field       | Value                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| Path        | `[internal-ref]`                                                                                                         |
| Role        | Concrete instantiation of the KIT — real Java/Spring service with the most complete harness                              |
| Inventory   | `docs/audits/planning-skeleton-inventory.json` (123 items) · `docs/audits/planning-skeleton-audit.md` (rendered)         |
| Disposition | Extract patterns; redesign cleanly. Do NOT copy Java application code. Do NOT leak Spring assumptions into arbiter core. |

---

## Staleness Policy

These files are point-in-time snapshots. If more than 90 days have passed since `date:` in this header,
verify the source files still exist at the paths above before relying on the catalog content.

---
generated: true
source: 'docs/REFERENCE/iso9001-overlay.md'
source_sha: '593f471b79e89195718dd9d634f79f1a298ea63f'
last_updated: '2026-07-02'
---

# ISO 9001 Overlay — Reference

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/REFERENCE/iso9001-overlay.md](../docs/REFERENCE/iso9001-overlay.md)

# ISO 9001 Overlay — Reference

**Feature:** quality-process overlay | **Issue:** #1253 | **Language:** language-neutral

## Overview

The ISO 9001 overlay emits **quality-management-system** scaffolding. It is **orthogonal**
to the audit-trail overlays (`pharma` / `sox` / `gdpr` / `generic`): those concern the audit trail, this concerns the
quality process. The overlay covers three ISO 9001 controls and ships a fail-closed gate that
enforces them — so the requirement→test chain is gate-checkable, not just prose.

## Activation

Set `industryOverlay: 'iso9001'` in your `arbiter.json` (or pass the flag at `arbiter init`):

```bash
arbiter init --industry-overlay iso9001
```

The overlay emits identical artefacts on every stack (TypeScript, Python, Go, Java, Rust).

## Emitted Files

| File                           | Location        | Purpose                                                                 |
| ------------------------------ | --------------- | ----------------------------------------------------------------------- |
| `REQUIREMENTS_TRACEABILITY.md` | `docs/quality/` | Requirement→test RTM (§8.3 / §8.5), sentinel + status ladder            |
| `DOCUMENT_CONTROL.md`          | `docs/quality/` | Controlled-document register (§7.5) — `doc_version` + on-disk existence |
| `CAPA_LOG.md`                  | `docs/quality/` | Corrective & preventive-action log (§10.2)                              |
| `check-iso9001.mjs`            | `scripts/`      | Fail-closed gate validating all three documents                         |

All docs use `skipIfExists: true` — brownfield re-init never overwrites user customisations.

## RTM Reuse (FEATURE_MATRIX machinery)

The RTM mirrors the [FEATURE_MATRIX](../PRODUCT/FEATURE_MATRIX.md) RTM schema: a
sentinel-delimited (`<!-- ISO9001_RTM_START -->` … `END`) pipe table with the same
`status` ladder (`Missing` → `Partial` → `Done`, fail-closed promotion). The gate parses
the sentinel block and checks ref existence exactly as `check-feature-matrix.mjs` does, so
the requirement→test traceability is enforceable.

## Gate (`scripts/check-iso9001.mjs`)

Wired into the generated `scripts/check-all.mjs` (guarded by `existsSync`, so it runs only
when the overlay is selected). Exit codes follow INV-53:

| Exit | Meaning | Triggers                                                                                                                                    |
| ---- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | PASS    | RTM, document-control register, and CAPA log all valid                                                                                      |
| 1    | FAIL    | RTM `Done` row with a missing `test_ref` file; controlled document absent on disk; non-semver `doc_version`; open CAPA without an issue_ref |
| 2    | ERROR   | One of the three controlled documents is missing or its sentinel block is unparseable                                                       |

## ISO 9001 Controls Covered

| Clause | Requirement                                    | Artefact                       |
| ------ | ---------------------------------------------- | ------------------------------ |
| §7.5   | Control of documented information              | `DOCUMENT_CONTROL.md` + gate   |
| §8.3   | Design & development requirements traceability | `REQUIREMENTS_TRACEABILITY.md` |
| §8.7   | Control of nonconforming outputs               | RTM `QR-003` row               |
| §10.2  | Nonconformity & corrective action              | `CAPA_LOG.md` + gate           |

## Stackability

`industryOverlay` is single-valued, so `iso9001` cannot be co-selected with the `pharma`
(21 CFR) overlay through that field. It **does** stack naturally with the boolean compliance
mappings — `enableIso27001Mapping`, `enableNis2Mapping`, `enableGdprMapping` — because those
are independent configuration fields. Combining ISO 9001 (quality process) with ISO 27001
(security controls) is the intended composition.

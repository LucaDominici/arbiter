---
title: 'Reference: Gold Doc-Set + Report'
doc_version: '1.1.0'
status: active
last_review: '2026-06-16'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/reference']
related: []
---

# Reference: Gold Doc-Set + Report

The **gold doc-set** is the canonical documentation every arbiter project must carry — and,
save explicit derogations, _only_ that set. A deterministic audit grades a repo against it and
an updatable **gold report** records the result. **All numbers are computed by code, never by an
AI.**

## Artifacts

| File                         | Role                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `standards/gold-doc-set.yml` | The manifest: every canonical doc, its tier, overlay, and `accept_any` equivalents. |
| `standards/doc-profile`      | Per-repo overlays (`has-api`, `has-plugin-api`, …) + an `allow:` derogation list.   |
| `scripts/check-doc-set.mjs`  | Deterministic presence audit → text or `--json`.                                    |
| `scripts/gold-report.mjs`    | Renders `GOLD-REPORT.md` from the audit.                                            |
| `GOLD-REPORT.md`             | The updatable gold report (regenerated on demand).                                  |

## Tiers and matching

- **mandatory** — required; a gap is a failure under `--strict`.
- **recommended** — advisory; a gap is a warning.
- **conditional** — only applies when its overlay is enabled in `standards/doc-profile`.

A check passes if its `path` exists, or any `accept_any` equivalent exists, or its `glob`
matches ≥1 file. `accept_any` is how equivalents are accepted without false gaps —
`architecture` = `arc42` = `blueprint`, `coding-standards` = `naming-convention` = secure-coding
checklist, `VERSION` = `package.json`, and so on.

## Manifest schema enrichment (#1415)

Every check additionally carries:

- **`phase`** — the ISO/IEC/IEEE 12207 lifecycle phase the doc serves:
  `inception` | `design` | `build` | `release` | `operate`.
- **`drivers[]`** — the standards/regulations that mandate the doc, from a fixed vocabulary:
  `diataxis`, `iso29148`, `gamp5`, `part11`, `iso27001`, `gdpr`, `nis2`, `dd-impresoft`,
  `iso12207`, `iso9001`, `owasp`. These make the manifest a traceable, audit-ready map from each
  doc to _why_ it is required.

## Overlays and doc families

Conditional checks are grouped into doc **families**, each gated by an overlay declared in
`standards/doc-profile`:

| Overlay          | Family / docs                                                                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `has-plugin-api` | `docs/PLUGIN-API.md`                                                                                                                                                                                                               |
| `has-api`        | `docs/api` reference                                                                                                                                                                                                               |
| `customer-data`  | **data** (ER, classification, retention, PII inventory) + **security** (threat-model, encryption, vuln-mgmt, risk-register) — GDPR / ISO 27001                                                                                     |
| `deploys`        | **operations** (observability, SLO, DR-BCP, backup, incidents) + **legal/supply-chain** (SBOM CycloneDX/SPDX, OSS deps) + **delivery** (user-manual, admin-guide, release-notes) + **anti-falso-green** dims — NIS2 / dd-impresoft |
| `gxp`            | CSV validation + audit-trail (GAMP 5 / 21 CFR Part 11)                                                                                                                                                                             |
| `has-ai`         | model card + AI risk assessment                                                                                                                                                                                                    |
| `has-mobile`     | app-store compliance + Playwright coverage                                                                                                                                                                                         |

A `technical-debt` register (`docs/technical-debt.md`) is a recommended, always-on doc.

## ADR dual recognition (#1415)

The ADR check (`adr: true`) recognizes a decision record in any of three filename forms, so an
org-wide repo prefix never produces a false gap:

- legacy bare-numeric — `001-thin-pointer.md`
- legacy `ADR-NNN` — `ADR-001-thin-pointer.md`
- repo-prefixed — `<PREFIX>-NNN_slug.md` (e.g. `ARB-001_thin-pointer.md`)

An optional validator, `scripts/validate-adr-prefix.mjs`, enforces a single org prefix and
unique ADR numbers across a multi-repo org (`--prefix ARB`). It is **not** the canonical ADR
index gate (`check-adr-index.mjs`, INV-107).

## --generate write-safety (#1415)

`--generate` scaffolds a stub **only when the target file is missing** (the `!existsSync`
guard) — it never overwrites any existing file. Stub-refresh-in-place is opt-in via
`--refresh-stubs` and re-renders a doc **only when its bytes equal the freshly rendered stub
template**; a real, hand-written doc is always preserved byte-for-byte.

## Usage

```bash
node scripts/check-doc-set.mjs              # advisory audit (exit 0)
node scripts/check-doc-set.mjs --json       # machine-readable
node scripts/check-doc-set.mjs --strict     # exit 1 if a mandatory doc is missing
node scripts/check-doc-set.mjs --generate   # scaffold stubs for MISSING mandatory+recommended .md docs
node scripts/check-doc-set.mjs --generate --refresh-stubs  # also re-render byte-equal stubs in place
node scripts/validate-adr-prefix.mjs --prefix ARB          # validate ADR repo prefix + unique numbers
node scripts/gold-report.mjs                # (re)write GOLD-REPORT.md
node scripts/gold-report.mjs --check        # exit 1 if the committed report is stale
```

npm aliases: `npm run check:doc-set`, `npm run gold:report`.

## Rollout (this increment)

- **generate-missing + advisory**: the audit is advisory today; missing docs can be scaffolded
  with `--generate`. It is promoted to a blocking gate once a repo reaches zero mandatory gaps.
- The code-quality **gold engine** (registry→Y/P/N, effectiveness overlay, E1–E7, false-gap
  meta-gate, no-regress ratchet) landed in #1373 — see
  [Reference: Gold-Audit Engine](./gold-audit.md). Its score and dimension table now render into
  the report. Downstream `.ejs` propagation of this kit is tracked in #1374.

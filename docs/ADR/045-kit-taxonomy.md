---
title: 'ADR-045: KIT Taxonomy — Wrap-Not-Replace, Field Cross-Walk, and Parity Contract'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# ADR-045: KIT Taxonomy — Wrap-Not-Replace, Field Cross-Walk, and Parity Contract

**Project:** arbiter
**Date:** 2026-05-19
**Status:** Accepted

## Context

Wave 2 of the planning-skeleton migration (issue #878) promotes `src/kit/catalog.json` (W1 SSOT) to
an enforced state with a typed access layer, a `validate` subcommand, and an L1 parity gate. Two
sources of truth exist during the migration: the catalog (76 typed dimensions, N01..N76) and the
mapping (`docs/audits/kit-canonical-mapping.json`, derived from the original XLSX source with
implementation metadata). These two files must stay synchronized.

## Decision

### Wrap-Not-Replace

`src/kit/catalog.ts` is a typed access layer over `catalog.json`. It does NOT replace the JSON
SSOT. The JSON file remains the source of truth for type validation (via Zod) and can be read
directly by scripts without importing TypeScript.

### Authority Hierarchy

`src/kit/catalog.json` is the parity authority. When catalog and mapping fields diverge, the
catalog wins. The mapping conforms to the catalog, not the reverse.

### Field Cross-Walk (INV-86 Parity Contract)

| Catalog field                          | Mapping field                         | Compare rule                                                 |
| -------------------------------------- | ------------------------------------- | ------------------------------------------------------------ |
| `id` (`N01..N76`)                      | `canonical_id` (`N01..N76`, added W2) | exact string                                                 |
| `name`                                 | `name`                                | NFC-normalize, trim, exact                                   |
| `tml` (`L1/L2/L3`)                     | `tml_source` (`L1/L2/L3`)             | exact (NOT `mapping.tml` which is `M1/M2/M3` alias)          |
| `gate` (`BLOCKING/ADVISORY/REFERENCE`) | `gate_type`                           | strip suffix `\s*\([^)]+\)$` from mapping then exact-compare |

Mapping keeps numeric `id` (1..76) for legacy backward compatibility; `canonical_id` (`N01..N76`)
is the parity join key.

### Enforcement Coverage Rule (Rule 3)

For every catalog dimension with `gate === 'BLOCKING'`, at least ONE of the following holds:

- mapping `invariant_id` is populated, OR
- mapping `framework_realization.invariant` is populated, OR
- mapping `framework_realization.validator` is populated, OR
- mapping `framework_realization.template` is populated, OR
- mapping `framework_realization.generator` is populated, OR
- mapping `disposition === 'done'` (already implemented — no future wave required), OR
- mapping `disposition ∈ {'adopt-framework', 'stack-adapter'}` AND `implementing_wave ∈ {W3..W11}` (accepted-wave whitelist; F-prefixed waves and null are rejected)

### Accepted-Wave Whitelist

`ACCEPTED_FUTURE_WAVES = ['W3','W4','W5','W6','W7','W8','W9','W10','W11']`

W1 (listing pass) and W2 (this wave) are excluded — those are already delivered. F-prefixed values
(F2, F5, etc.) and null are rejected to prevent phantom "future wave" deferrals.

### Redaction Rule (Rule 4)

Neither `src/kit/catalog.json` nor `docs/audits/kit-canonical-mapping.json` may contain tokens
from `scripts/data/redaction-lexicon.json`. The `allowContext` field in lexicon entries exempts
lines where the context string appears (e.g., `Keycloak-compatible IdP` exempts `Keycloak`).

### Generation Marker (Brownfield Discrimination)

Generator output files (`docs/REFERENCE/dim-NN-<slug>.md`, `docs/REFERENCE/GLOBAL_KIT.md`) carry
a hash marker as the first line:

```html
<!-- arbiter-generated dim=N01 hash=<sha256-of-body> generator=kit@1 -->
```

On regenerate:

1. If target file absent → write new file with marker.
2. If target present and parseable marker → recompute SHA-256 of body (after marker, LF-normalized); if hash matches → overwrite; if different → user edit detected → skip unless `--force`.
3. If target present but marker absent/malformed → treat as user-managed → skip unless `--force`.

`--prune` removes pristine orphan `dim-*.md` files not in the expected set. Non-pristine orphans
are reported but not deleted.

### Slug Stability

`slug = name.toLowerCase().normalize('NFD').replace(/[^\w\s-]/g,'').trim().replace(/[\s_]+/g,'-').replace(/^-+|-+$/g,'')`

On collision: append `-2`, `-3` etc. by id ASC. Empty slug after strip → `dim-NN-untitled`.

### Idempotency Constraints

Templates must produce stable output across runs:

- No timestamps (neither `new Date()` nor `Date.now()`)
- Iterate dimensions in id-ASC order
- LF line endings (not CRLF)
- Trailing newline at end of file

## Consequences

### Positive

- `src/kit/catalog.json` is the single typed source of truth; consumers do not need to understand the mapping format
- INV-86 parity gate catches any drift between catalog and mapping at L1
- Generator output is brownfield-safe; user edits are preserved unless `--force` is passed
- Wave whitelist prevents phantom deferrals from blocking enforcement checks

### Negative

- Mapping names must be kept in sync with catalog; the reconcile script (`node scripts/reconcile-mapping.mjs`) must be re-run when catalog names change
- Committed generator output (76 doc files) creates large diffs when catalog content changes

## Links

- Related ADRs: ADR-018 (SSOT framework generation), ADR-011 (brownfield-first design)
- Issues: #878 (W2 KIT Canonical SSOT), #875 (planning skeleton migration umbrella)
- Enforcement: `scripts/check-kit-catalog-parity.mjs` (INV-86, L1 gate)

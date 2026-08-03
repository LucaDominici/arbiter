---
title: 'ADR-045: KIT Taxonomy — Wrap-Not-Replace, Field Cross-Walk, and Parity Contract'
doc_version: '1.1.0'
status: active
last_review: '2026-07-10'
owner: ''
canonical_id: '045'
tags: ['audience/dev', 'kind/adr']
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

### R-08 Amendment: Import-Provenance Rules (Rules 5–7)

**Finding:** the original W2 join (this ADR, above) copied `canonical_id`/`name` from the catalog
onto the mapping _positionally_ (row _i_ ↔ catalog dim _i_), but `detail`, `planning_evidence_paths`,
`framework_realization`, and `planning_notes` were never re-keyed — they stayed at their pre-join
row index, which followed the original XLSX import-list ordering, not the catalog's. Because
the catalog and the import list are different orderings of a similar-but-not-identical taxonomy,
59/78 rows ended up with a `name`/`canonical_id` describing one dimension and a `detail`/
`framework_realization` payload describing a different one entirely (e.g. row `N56`
"Dependency audit" carried `SecurityConfig hardening (CORS/CSRF)` detail — the two field groups
had simply never been re-joined after the rename). The 63% self-assessment score was unaffected:
`kit-install.ts`/`measure.ts`/`emit-issues.ts` read `catalog.json` and `derived.json` exclusively —
`canonical-mapping.json` has no scoring consumer, only the parity gate and this ADR reference it.

**Remediation (this section):** the mapping schema grew three fields to make the payload's true
provenance explicit and mechanically checkable, closing the gap Rules 1–4 didn't cover (they only
ever checked `canonical_id`/`name`/`tml_source`/`gate_type` parity, never payload-to-name
consistency):

- `import_source: {import_id, import_name} | null` — when present, this row's `detail`/
  `planning_evidence_paths`/`framework_realization`/`planning_notes` came from the pre-join import
  row `import_id`, originally named `import_name`. `null` means the row is `origin: "arbiter-native"`
  (no import-era payload — either the catalog dimension has no import-era counterpart, or its
  import-era payload was reattached elsewhere by the crosswalk).
- `unmapped_import_dims: Array<{import_id, import_name, detail, planning_evidence_paths,
framework_realization, planning_notes}>` (top-level) — import-era payloads with no canonical home
  (no data loss: every `import_id` not attached via `import_source` lives here instead).
- `import_total: number` (top-level) — the size of the original import-era dimension list (76).
  Rule 7 is gated on this field's presence so mapping fixtures that predate the R-08 crosswalk (or
  minimal test fixtures) skip Rule 7 rather than fail on an inapplicable check.

**Rule 5 — Provenance integrity.** If `import_source` is set, `import_name`'s alphanumeric-only key
must be a prefix of (or be prefixed by) the alphanumeric-only key of `framework_realization.docs`'s
slug portion — or vice versa. Docs slugs are truncated for long names (cut mid-word), so this is a
bidirectional prefix check on normalized keys, not string equality or substring containment. This
is the rule that would have caught the original R-08 join bug: a positionally-misjoined row's name
and payload never share a provenance key.

**Rule 6 — Phantom-path existence.** Every non-null `framework_realization.{template,generator,
validator}` value must either be prefixed `planned:` or exist on disk relative to the arbiter
package root. At the time of the R-08 fix, 53 of 55 such paths referenced files that had never been
built (inherited verbatim from the import-era planning payload, which described aspirational
upstream (import-side) artifacts, not real arbiter paths) — Rule 3 (enforcement coverage) was accepting any
non-null value regardless of existence, so these phantom paths were silently satisfying BLOCKING
enforcement. Rule 6 is skipped when there is no `src/` directory at the check root, since
`framework_realization` paths point into the dev source tree, which never ships in a published
install (#1575) — the check is meaningless without a source tree to verify against.

_Open decision (not resolved by Rule 6):_ whether the 53 `planned:`-prefixed paths should
eventually be built (real templates/generators/validators) or deleted from the mapping. Rule 6
takes the conservative default — mark, don't delete or fail — pending that call.

**Rule 7 — Crosswalk referential integrity.** Every `import_id` in `[1, import_total]` must appear
exactly once, either as some row's `import_source.import_id` or as an entry in
`unmapped_import_dims`. No import-era payload may be silently dropped or attached to two canonical
rows at once.

### Generation Marker (Brownfield Discrimination)

Generator output files (`docs/REFERENCE/coverage/dim-NN-<slug>.md`, `docs/REFERENCE/GLOBAL_KIT.md`) carry
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

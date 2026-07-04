---
title: 'ADR-099: Native zero-dependency xlsx writer (drop exceljs)'
doc_version: '1.0.0'
status: active
last_review: '2026-06-30'
owner: ''
canonical_id: '099'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-099: Native zero-dependency xlsx writer (drop exceljs)

**Project:** arbiter
**Date:** 2026-06-30
**Status:** Accepted

## Context

`@arbiter/cli` shipped `exceljs` as a runtime `dependency` so the
`arbiter feature-matrix export --format xlsx` command could emit an .xlsx.
`exceljs` depends transitively on `uuid@^8.3.0`, which carries
GHSA-w5hq-g745-h8pq. A root `overrides: { uuid: ^11.1.1 }` masked the
vulnerability in arbiter's OWN dev tree, but npm `overrides` apply only to the
root install — they are silently ignored when `@arbiter/cli` is consumed as a
dependency. So every consumer resolved `uuid@8` with zero visibility, while the
gate's `npm audit --omit=dev` audited the dev tree (where the override IS
applied) and always reported 0 vulns (#1670). The `--format xlsx` contract is
shipped to consumers (advertised in `src/templates/docs/FEATURE_MATRIX.md.ejs`),
so `exceljs` could not simply move to `devDependencies`.

## Decision

Replace `exceljs` with a self-contained, zero-dependency xlsx emitter
(`src/export/xlsx-writer.ts`) and remove `exceljs` + the dead `uuid` override
from `package.json`.

The writer produces a valid .xlsx as a ZIP container of OOXML parts using
**STORE** (compression method 0) entries — universally accepted by Excel,
LibreOffice Calc, and exceljs, and trivially correct because
`compressed size == uncompressed size`. CRC-32 is hand-rolled (polynomial
0xEDB88320) because `node:zlib.crc32` only landed mid-Node-22.x while
`engines.node` permits `>=22.0.0`. Cells use inline strings
(`t="inlineStr"`) — structurally text, so they can never be evaluated as
formulas (the real CWE-1236 protection), with `neutralizeFormula` retained as
defense-in-depth. This follows the in-repo precedent of a hand-rolled,
no-external-deps binary writer (`src/commands/report.ts`, POSIX ustar tar via
`node:zlib`).

## Consequences

### Positive

- The `uuid@8` (GHSA-w5hq-g745-h8pq) transitive is eliminated at the source —
  consumers no longer resolve it, and `npm audit --omit=dev --audit-level=high`
  is clean without any override.
- No new supply-chain surface: the writer adds zero runtime dependencies.
- The `--format xlsx` CLI contract is preserved (valid .xlsx, same column
  widths, bold header, formula neutralization).
- `THIRD_PARTY_LICENSES.md` shrinks by ~80 transitive packages (the exceljs
  closure).
- The `buffers@0.1.1` license override (exceljs-only) is removed; the override
  mechanism is retained as a dormant escape hatch, exercised by a synthetic
  fixture test.

### Negative

- arbiter now owns ~270 lines of OOXML/zip code that real Excel/LibreOffice
  must continue to accept. The test suite asserts the structural invariants
  (parts, Content_Types pairing, rels wiring, styles index order, EOCD framing,
  inline-string typing); a one-time manual open in a real spreadsheet reader is
  the remaining human verification (no CI gate opens the file with a real
  reader).
- The class of consumer-facing transitive vulnerabilities is still unguarded
  by a dedicated consumer-resolution audit (`npm pack → install → audit`).
  Dropping exceljs fixes the single instance; the class-wide guard is tracked
  as a follow-up (#1718).

## Links

- Related ADRs: none
- Issues: #1670, #1718 (consumer-resolution audit follow-up), #1717
  (CANON-17 errno translation in feature-matrix export — pre-existing,
  discovered during this work)

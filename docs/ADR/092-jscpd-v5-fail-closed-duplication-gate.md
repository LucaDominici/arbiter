---
title: 'ADR-092: jscpd v5 Migration — Fail-Closed Duplication Gate'
doc_version: '1.0.0'
status: active
last_review: '2026-06-10'
owner: ''
canonical_id: '092'
tags: ['audience/dev', 'kind/adr']
related: ['076-canon-22-evidence-based-quality']
---

# ADR-092 — jscpd v5 Migration: Fail-Closed Duplication Gate

**Status:** Accepted
**Date:** 2026-06-10
**Maps to:** #1286, INV-47, INV-109, CANON-22

---

## Context

jscpd v5 replaced the v4 JavaScript implementation with a Rust binary distributed via six
platform-specific `optionalDependencies` (`cpd-linux-x64-gnu/-musl/-arm64-gnu`, `cpd-darwin-arm64/
-x64`, `cpd-windows-x64-msvc`). Empirically verified breaking changes (5.0.6):

- the config keys `pattern` and `path` are **silently ignored** — the fileset must be passed as
  positional CLI arguments;
- a 0-file scan **exits 0 and writes a 0% JSON report** — a bare `npx jscpd --silent` gate becomes
  vacuous on any fileset drift, and the debt ratchet would record a false 0%;
- the JSON report is always written when the `json` reporter is configured (v4 wrote it only when
  clones were found), and `consoleFull` still works.

Three red-team agents converged on the same CRITICAL: every enforcement layer (check-all step,
debt-lib metric, debt-report ratchet, capture-debt-baseline) degraded fail-open under v5.

## Decision

1. **Fileset SSOT** stays in `.jscpd.json` under the `path` key. jscpd itself disregards the key;
   arbiter's scripts read it and pass it as positional args. A `format` filter replaces the v4
   glob `pattern`.
2. **`jscpdScan` helper** (`scripts/debt-lib.mjs`, dual-sided): validates config (`path` non-empty,
   `reporters` includes `json`, honors custom `output`), removes any stale report pre-spawn, runs
   `npx --no-install jscpd <paths> --silent`, and returns an **error** — never a recorded 0% — on
   0-source scans or report-schema drift. Legacy `pattern`-only configs get an explicit migration
   message.
3. **Hard gate leg**: new `scripts/check-duplication.mjs` (emitted to governed TypeScript projects
   by `src/generators/duplication.ts`) exits 1 on any config/scan error; check-all routes the
   duplication step through it. The template twin WARN-passes the v4-binary case (brownfield
   projects whose devDep was never bumped); the self script fails it (self pins v5).
4. **Ratchet leg fail-closed**: `collectMetrics` surfaces ran-but-failed collections via a
   `collectionErrors` sink; `debt-report --gate` and `capture-debt-baseline` exit 1 on any entry.
   `assertKeyParity` refuses to write a baseline that drops a previously-tracked metric key.
5. **Exact pin `5.0.6`** (no caret) on both the self devDep and the generator's
   `injectDevDependency` — the rewrite is days old and floating ranges would re-introduce
   unreviewed behavior drift into governed projects' gates. Dependabot proposes bumps explicitly.

## Consequences

- Self duplication reading moved 1.36% → 1.39% (459 files) — v5 tokenizer drift on the corrected
  fileset, not new duplication; the debt baseline was recaptured in the same change-set.
- Brownfield governed projects keep their v4 pin until bumped; their force-regenerated
  `debt-report.mjs` hard-fails with a migration message if the config drifts, instead of silently
  recording 0%.
- Any future jscpd fileset/schema drift now fails the gate loudly instead of masking duplication
  (CANON-22).

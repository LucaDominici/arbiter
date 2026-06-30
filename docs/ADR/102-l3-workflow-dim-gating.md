---
title: 'ADR-102: gate the workflow-template-emitted dims at L3'
doc_version: '1.0.0'
status: active
last_review: '2026-07-01'
owner: ''
canonical_id: '102'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-102: gate the workflow-template-emitted dims at L3

**Project:** arbiter
**Date:** 2026-07-01
**Status:** Accepted

## Context

`checkL3MaturityGates` (the L3 init gate) was driven by the registry via
`capabilitiesForGenerator` (commit bd2af868, #1678's predecessor), which maps 10 generator
keys to the 10 `MaturityFeature` dims. But 8 matrix dimensions are emitted only by GitHub
Actions **workflow EJS templates** (the single opaque `'github'` registry key emits CI
workflows for them): `fuzz`, `dast`, `license_scan`, `sbom`, `binary_signing`, `provenance`,
`container_scan`, `secret_scan` — all `beta` for every modelled language. They were absent
from `MaturityFeature` and `capabilitiesForGenerator` returned `[]` for `'github'`, so the
gate never consulted them. An L3 init silently accepted beta workflow tooling with no
`--accept-beta-tools` acknowledgement — the same class #1628 fixed for `a11y`.

## Decision

Extend `MaturityFeature` to include the 8 dims and add `deriveWorkflowCapabilities(config)`
that mirrors the workflow emission predicates (`src/generators/github.ts` file-level
predicates + the EJS job-level `_isService` guards). Route the workflow caps through
`case 'github'` in `capabilitiesForGenerator`, so the existing `spec.enabled` check
(`permitGitHub ?? useGitHub`) gates them — workflow caps are consulted only when github is
actually emitted (no false-block when github is disabled, the #1606 class). `hasMatrixCell`
skips `multi`/unmodelled (no false-block); `isL3Allowed`'s `beta` arm handles the flag.

A job-level drift-detection test (`init-l3-workflow-drift.test.ts`) runs the REAL github
generator for sample configs, parses the rendered YAML, and asserts the gate matches the
actually-emitted (non-`if:false`) jobs' tools — catching mirror drift without rewriting the
generator.

## Consequences

### Positive

- L3 init now blocks on beta/unsafe/unavailable workflow dims unless `--accept-beta-tools`
  — the gate enforces explicit acknowledgement for the whole emission plan, not just the
  registry-reachable half. The `--format xlsx`-class silent acceptance is closed.
- No new runtime dependency; the gate is pure-derivation from `config`.
- The `--format csv`/CLI contracts are unchanged.

### Negative

- `deriveWorkflowCapabilities` mirrors the github.ts + EJS emission logic (a known smell).
  Root-cause extraction (a shared emission-plan module consumed by both the github
  generator and the gate, with `_isService` lifted out of EJS) is a CANON-04/13/05 refactor
  out of scope — tracked as tech-debt (#1723), mitigated by the drift test.
- `kotlin` and `multi` are not gated on the 8 dims (the matrix has no cell → `hasMatrixCell`
  skips). This is a real false-pass for the language-agnostic dims — tracked as follow-ups
  (#1724 kotlin, #1725 multi); the #1606 skip-on-no-cell is kept (no false-block) but the
  gaps are now explicit, not silent.
- The drift test catches drift for the sampled configs only; per-language guards for
  unsampled languages and renamed-job attribution are residual blind spots (documented in
  the test).

## Links

- Related ADRs: none
- Issues: #1678, #1723 (SSOT extraction), #1724 (kotlin matrix gap), #1725 (multi matrix
  gap)

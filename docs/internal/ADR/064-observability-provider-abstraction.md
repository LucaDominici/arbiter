---
title: 'ADR-064: Observability provider abstraction (#725)'
doc_version: '1.0.0'
status: active
last_review: '2026-05-31'
owner: ''
canonical_id: '064'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-064: Observability provider abstraction (#725)

**Date:** 2026-05-16
**Status:** Accepted
**Reference:** Issue #725 (wave:2-medium, provider-abstraction); CANON-04, CANON-05, CANON-11

**Context:** arbiter had no mechanism to emit observability bootstrap docs. Projects needed one-size-fits-all guidance or nothing. Different teams have wildly different observability stacks (self-hosted ClickHouse vs. SaaS APM vs. minimal stdout).

**Decision:**

- New optional `ObservabilityConfig` type (`provider`, `metrics`, `logs`, `traces`, `alerts`) added to `ProjectConfig`.
- `generateObservability` returns empty `files: []` when `observability` is absent or `provider === 'none'` — fully opt-in.
- Single unified template `src/templates/observability/setup.md.ejs` with per-provider conditional blocks. Avoids one-file-per-provider explosion (would have cost +9 template slots vs. +1 actual).
- All providers share the "Structured Logging Requirement" header requiring `traceId` on every log line (invariant satisfied unconditionally).
- Registry key `'observability'`; PATH_TO_KEYS entry `'observability.provider' → ['observability']` for selective re-runs.
- `skipIfExists: true` so user-customised docs survive `arbiter update`.

**CANON-16 survey:** grepped `src/generators/` for similar observability/monitoring generators — none found. Grepped `src/templates/` — no observability directory. New files justified.

**Consequences:** Projects that set `observability.provider` receive a complete, provider-specific setup guide on first `arbiter init`. Subsequent `arbiter update` does not overwrite custom edits.

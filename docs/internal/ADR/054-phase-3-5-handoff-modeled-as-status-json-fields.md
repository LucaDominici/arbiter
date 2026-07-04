---
title: 'ADR-054: Phase 3.5 handoff modeled as status.json fields (#703, 2026-05-18)'
doc_version: '1.0.0'
status: active
last_review: '2026-05-31'
owner: ''
canonical_id: '054'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-054: Phase 3.5 handoff modeled as status.json fields (#703, 2026-05-18)

**Status:** Accepted
**Reference:** Issue #703

**Context:** Phase 3.5 requires a hard session boundary between planning phases (Opus) and
implementation phases (Sonnet). Two design options existed: (a) introduce a new `TaskPhase`
value (e.g., `planning-complete`) to represent the mid-boundary state, or (b) express the
boundary as fields on the existing `status.json` without touching the phase enum.

**Decision:** Model the handoff via `status.json` fields (`handoffStrategy`,
`planningHandoffReady`, `postClearResumed`, `hostCapabilities`) rather than adding a new
phase value. The arbiter phase enum stays: `preflight | plan | red-team-review |
red-team-rework | red | green | refactor | verification | complete`. The gate fires on the
`red-team-review → red` (or `red-team-rework → red`) transition, not at a dedicated phase.

**Consequences:** Phase enum is stable — no downstream consumers (CI workflows, dashboards,
docs) need updating. The handoff state is auditable via `status.json` diff. The boundary can
be re-checked idempotently: `planningHandoffReady` present + `postClearResumed` absent = gate
fires; both present = already resumed, no-op.

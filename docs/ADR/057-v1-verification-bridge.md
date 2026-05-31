---
title: 'ADR-057: V1 Verification Bridge (#253)'
doc_version: '1.0.0'
status: active
last_review: '2026-05-31'
owner: ''
canonical_id: '057'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-057: V1 Verification Bridge (#253)

**Date:** 2026-05-13
**Status:** Accepted
**Reference:** Issue #253; ADR-039

**Context:** Plans submitted to arbiter lacked machine-readable invariant checks. Human review missed Italian UI strings, skipped tests, orphan TODOs, and out-of-scope drive-by files. A CLI-only bridge (per ADR-020) was needed to gate plan merges deterministically.

**Decision:** Add `arbiter verify plan <file>` command implementing 4 rules: VB-INV-EN-UI (Italian stopword check on UI strings), VB-INV-NO-SKIP (skip pattern detection in test files), VB-INV-NO-ORPHAN (TODO without task reference), VB-INV-NO-DRIVEBY (files outside declared scope). Zod validates PlanJsonV1 schema on input. Results written to `.arbiter/plan/REVIEW.json` (pointer) and `.arbiter/plan/runs/<runId>/REVIEW.json` (archive). Exit 0 = APPROVED/SKIPPED; exit 2 = REJECTED/ERROR. Plugin field `verifyPlanRules` allows rule injection; duplicate IDs produce REGISTRY ERROR. `review_bridge.enabled:false` short-circuits to SKIPPED for incremental adoption.

**Consequences:** Plan files violating the 4 invariants are blocked before merge. Archive is append-only per run. Plugin rules extend without forking the binary. No MCP surface added.

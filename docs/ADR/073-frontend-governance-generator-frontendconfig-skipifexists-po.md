---
title: 'ADR-073: Frontend Governance Generator — FrontendConfig + skipIfExists policy'
doc_version: '1.0.0'
status: active
last_review: '2026-05-31'
owner: ''
canonical_id: '073'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-073: Frontend Governance Generator — FrontendConfig + skipIfExists policy

**Status:** Accepted
**Reference:** Issue #1124

**Context:** Arbiter had `playwright-ts` for FE testing but no FE architectural governance generator. Viafera evolved FE001–FE006 (Frontend Constitution) and P1–P9 (Design Principles). Harvesting these into arbiter requires deciding (a) how to gate the generator and (b) whether generated docs are user-customizable or arbiter-managed.

**Decision:** Gate on `archetype === 'frontend-spa' || lanes.includes('frontend')` — both existing config fields, no new mechanism. `FrontendConfig` optional nested object (`framework`, `stateManager`, `validationLib`) added to `ProjectConfig` and `ArbiterConfigV2`; safe-defaults applied at render time so existing `frontend-spa` projects get readable output without explicit config. Both docs use `skipIfExists: true` — they are user-customizable governance documents (same policy as `RISK_REGISTER.md`, `CODING_STANDARDS.md`). Users delete files to force regeneration with new `frontend.*` config.

**Consequences:** New `FrontendConfig` field must be wired through all four config layers (schema → types → resolve-config → init persistence). `diffConfig` deep-walk extended to include `'frontend'`. `buildArbiterConfig` extracted `buildProviderFields()` helper to stay under cyclomatic complexity limit. Template defaults: `vue` → Pinia, `react` → Zustand, absent → generic prose.

---
title: 'ADR-074: Risk register + P×I assessment template'
doc_version: '1.0.0'
status: active
last_review: '2026-05-31'
owner: ''
canonical_id: '074'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-074: Risk register + P×I assessment template

**Status:** Accepted
**Reference:** Issue #712; prior-art baseline R-PORT-03; ISO 27001:2022 §6.1.2

**Context:** The prior-art baseline ships a structured risk register (RISK_REGISTER.md, 489 LOC, 15 risks V-01..V-15) and a reusable per-risk P×I assessment template. Projects using arbiter lack a structured ISO 27001-aligned risk governance baseline.

**Decision:** Add opt-in `enableRiskRegister: true` flag. When set, `generateRiskRegister` emits two files into `docs/GOVERNANCE/`: (1) `RISK_REGISTER.md` — P×I matrix, classification thresholds, 5 universal pre-populated risks, plus archetype-conditional risks (DB for `backend-web-db`/`data-pipeline`, XSS for `frontend-spa`, rate-limit for `hasPublicApi`, tenant isolation for `isMultiTenant`); (2) `RISK_ASSESSMENT_TEMPLATE.md` — reusable per-risk assessment form covering threat description, P×I scoring rationale, treatment options, and approval workflow. Both files are `skipIfExists: true`.

**Consequences:** Teams get an immediately actionable ISO 27001 §6.1.2 risk governance baseline without mandatory adoption. The `industrial-grade` preset (issue #729) will enable this flag by default. The pre-populated risks are intentionally generic — teams customise post-init.

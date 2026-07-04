---
title: 'ADR-062: CLI catalog docs/COMMANDS.md generation (#728, 2026-05-16)'
doc_version: '1.0.0'
status: active
last_review: '2026-05-31'
owner: ''
canonical_id: '062'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-062: CLI catalog docs/COMMANDS.md generation (#728, 2026-05-16)

**Status:** Accepted
**Reference:** Issue #728; prior-art baseline M-19; CANON-04, CANON-05, CANON-11
**Closes:** #728

**Context:** The prior-art baseline ships `FRAMEWORK/DOCS/COMMANDS.md` — a uniform, machine-generated command reference that lists every build/test/lint/format/gate command in one place. arbiter-generated projects had no equivalent, forcing developers to hunt commands across README and CI config.

**Decision:** Add `src/templates/documentation/cli-catalog.md.ejs` rendered as `docs/COMMANDS.md` by `generateDocs` at L2+. Sourced from `buildCommand`, `testCommand`, `lintCommand`, `formatCommand` fields already present in `ProjectConfig`. Uses `skipIfExists` (CANON-11). L1 skipped — L1 projects have minimal governance overhead.

**Consequences:**

- Every L2/L3 arbiter-generated project gets `docs/COMMANDS.md` on first `arbiter init`.
- Template namespace `src/templates/documentation/` created; separate from `src/templates/docs/` (which holds governance docs rendered outside the target project's `docs/` tree).
- No new `ProjectConfig` fields required — uses existing command fields.
- Baseline for `check-template-tests.mjs` bumped from 128 → 129 untested EJS files.

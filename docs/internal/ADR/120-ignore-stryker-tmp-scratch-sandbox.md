---
title: 'ADR-120: Ignore .stryker-tmp/ — Stryker Scratch Sandbox Is Never Formatted Content'
doc_version: '1.0.0'
status: active
last_review: '2026-08-30'
owner: ''
canonical_id: '120'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-120: Ignore .stryker-tmp/ — Stryker Scratch Sandbox Is Never Formatted Content

**Status:** Accepted
**Reference:** Issue #2436

**Context:** Stryker mutation testing extracts the project into `.stryker-tmp/sandbox-*/`
to run each mutant in isolation (default `tempDirName`, unset in `stryker.config.json`). An
interrupted run leaves that sandbox behind, untracked and — because neither `.gitignore` nor
`.prettierignore` listed it — un-ignored. `prettier --check .` then walks straight into the
sandbox's copied files and fails on whatever formatting they happen to carry, turning the
`format` gate red for a reason with nothing to do with any real source change (observed: 398
`[warn]` lines, ~2 extra minutes, on an otherwise-clean tree). Per `.claude/rules/95-closer-mode.md`
rule 2, deleting another agent's untracked sandbox to unblock the gate is forbidden — the fix is
an ignore entry, not a `rm`.

**Decision:** Add `.stryker-tmp/` to both `.gitignore` and `.prettierignore`, matching the
existing pattern for other tool-owned scratch directories (`.coverage-tmp/`,
`.arb-hardness-tmp*/`). Regression coverage:
`__tests__/gates/format-stryker-tmp.test.ts` plants a badly formatted file under
`.stryker-tmp/` and asserts `prettier --check` stays green.

**Consequences:** An interrupted or in-progress mutation run can no longer turn the format
gate (or any other tree-walking tool) red. No change to Stryker's own configuration or
runtime behavior — only the ignore surface.

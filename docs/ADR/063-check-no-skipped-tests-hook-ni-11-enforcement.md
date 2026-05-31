---
title: 'ADR-063: check-no-skipped-tests hook (NI-11 enforcement) (#730)'
doc_version: '1.0.0'
status: active
last_review: '2026-05-31'
owner: ''
canonical_id: '063'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-063: check-no-skipped-tests hook (NI-11 enforcement) (#730)

**Date:** 2026-05-16
**Status:** Accepted
**Reference:** Issue #730 (extended-invariants NI-11); CANON-12

**Context:** The prior-art baseline's `GLOBAL_INVARIANTS.md` (line 89) bans `@Disabled`, `.skip`, `xit`, and commented-out tests. arbiter already enforced no-orphan-TODO and no-direct-spawn via post-edit hooks but had no equivalent for skipped tests.

**Decision:**

- New static hook template `src/templates/claude/hooks/check-no-skipped-tests.mjs` added to the `staticHooks` array in `generateClaudeHooks` — emitted to every target project unconditionally.
- Detection is extension-scoped: JS/TS files → `.skip(`, `.only(`, `xit(`, `xtest(`, `xdescribe(`; Java → `@Disabled`, `@Ignore`; Python → `@pytest.mark.skip/xfail`; Rust → `#[ignore]`.
- Wired in `hooks.mjs.ejs` dispatcher (PostToolUse:Edit|Write) and Codex `config.toml.ejs` adapter.
- Manifest entry added to `.arbiter/hooks-manifest.json` with HARD classification, spawnable fixture, and NI-11 rationale.
- **CANON-16 survey**: grepped `src/templates/claude/hooks/` for similar skip-detection hooks; none found. New file is distinct from `check-no-placeholders.mjs` (which blocks WIP tokens, not language-level test-skip APIs).

**Consequences:** All target projects initialised with arbiter will receive the `check-no-skipped-tests.mjs` hook. Committing a file containing `.skip(`, `@Disabled`, etc. will exit 1 before the commit is finalized. Developers must remove the skip or open a tracking issue before committing.

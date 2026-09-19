---
title: 'arbiter — AGENTS.md'
doc_version: '1.0.2'
status: active
last_review: '2026-09-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/governance']
related: ['docs/internal/SYSTEM/INVARIANT-CATALOG.md', 'docs/INDEX.md']
---

# arbiter — AGENTS.md

Canonical cross-tool entrypoint for the arbiter repository. Tool-specific shims are
`.claude/CLAUDE.md` and `.agents/CODEX.md`.

## Project

- Stack: TypeScript with strict mode.
- Build: `npm run build`
- Test: `npm run test`
- Gate: `node scripts/check-all.mjs` (use `node scripts/check-all.mjs preflight` before freezing).

## Delivery

- Entrypoint: `/ship #NNN`.
- Done means the PR is merged green to `main`, with the gate and delivery evidence recorded.
- Branch: `task/#NNN-short-description`; `main` is protected.
- Commit format: `type(scope): imperative lowercase summary`, at most 72 characters. Types include `feat`, `fix`, `refactor`, `test`, `docs`, `ci`, `chore`, and `perf`.

## Hard rules

- Preserve the check set in `scripts/check-all.mjs` and its existing failure behavior.
- Verify the changed behavior end to end before pushing; after a failure, read the actual failure and fix its root cause before editing again.
- Parallel writers use isolated worktrees; keep secrets and personal data out of the repository.
- Tracked follow-up comments use `TODO(#NNN)`; orphan TODOs fail the gate.
- Test first for behavior changes and preserve strict typing, boundary validation, and error handling.

The full invariant, CI-tier, supply-chain, canon, gate, and debt reference is
[`docs/internal/SYSTEM/INVARIANT-CATALOG.md`](docs/internal/SYSTEM/INVARIANT-CATALOG.md).
Use `arbiter explain <ID>` for an invariant, and [`docs/INDEX.md`](docs/INDEX.md) for the documentation map.

## Working efficiently

First list what you need next; then request every tool call that does not depend on another's result in the same response.
Edit files surgically; do not rewrite a whole file for a small change.

<!-- arbiter:preserve -->

---
title: 'arbiter — Quickstart'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: 'QUICKSTART'
tags: ['audience/dev', 'kind/setup']
related: []
---

# arbiter — Quickstart

Five-minute install + first command + first gate run.

## 1. Install

```sh
npm install -g @arbiter/cli
# or run without installing
npx @arbiter/cli init
```

Requirements: Node.js ≥ 22, git ≥ 2.40.

## 2. Initialize a project

In a project directory:

```sh
arbiter init
```

`init` detects your stack (TypeScript / Python / Rust / Go / Java) and
governance level (L1 / L2 / L3 / L4), then materializes:

- `AGENTS.md` — invariant catalog
- `.claude/` or equivalent agent config
- `.githooks/` — pre-commit / pre-push hooks
- `.github/workflows/` — tiered CI workflows
- `scripts/check-all.mjs` — local gate orchestrator
- `arbiter.json` — project configuration

## 3. Run the gate

```sh
node scripts/check-all.mjs L1   # fast: lint + format + unit tests
node scripts/check-all.mjs L2   # full: L1 + coverage + integration
```

L1 must pass before commit, L2 before push. The `.githooks/` scripts enforce
both automatically once the git hook path is configured.

## 4. Verify hooks

```sh
git config core.hooksPath
# expected: .githooks
```

If empty, run `git config core.hooksPath .githooks` once.

## 5. Open a task

```sh
/task #NNN              # in Claude Code
arbiter task start --id NNN   # equivalent CLI
```

`/task` opens an isolated worktree, sets the task ID, and walks you through
plan → red-phase test → implementation → gate → PR.

## Common next reads

- [`README.md`](../README.md) — feature overview
- [`SETUP.md`](./SETUP.md) — extended install + per-stack notes
- [`GOVERNANCE/README.md`](./GOVERNANCE/README.md) — invariants + ADRs
- [`architecture/README.md`](./architecture/README.md) — system internals
- [`api/README.md`](./api/README.md) — public API surface
- [`OBSIDIAN.md`](../OBSIDIAN.md) — open this repo as an Obsidian vault

## When something fails

- Gate red on lint/format → `npm run format && npm run lint --fix`
- Gate red on tests → run the failing test in isolation; do not bypass with `--no-verify`
- Gate red on TDD evidence (#NNN.json missing) → `arbiter task record-red --test-path <file>`
- Self-hosted CI runner offline → set repo variable `CI_BUILD_RUNNER_LABEL=ubuntu-latest` (default already ubuntu-latest as of #959)

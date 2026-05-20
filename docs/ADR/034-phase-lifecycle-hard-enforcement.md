---
title: 'ADR-034: Phase-Tracked Lifecycle Hard Enforcement'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# ADR-034: Phase-Tracked Lifecycle Hard Enforcement

**Status:** Accepted
**Date:** 2026-05-05
**Issue:** #406

## Context

Arbiter's task lifecycle previously used an advisory completion guard (exit 0, stdout output) that Claude could acknowledge and proceed past. The pre-commit hook had no phase awareness — developers could commit during `preflight` or `plan` phases where no implementation should occur. Phase state was written directly with `echo "phase" > .claude/.task-phase`, making transitions unvalidated and unaudited.

Three related gaps:

1. Completion guard was advisory — Claude could claim completion prematurely without enforcement
2. Pre-commit hook had no phase guard — commits during planning phases were silently allowed
3. No CLI command existed to transition phases with validation or audit trail

## Decision

Promote the completion guard from advisory (exit 0) to hard-blocking (exit 2). A `UserPromptSubmit` hook that exits 2 returns its stderr to Claude as error context, blocking the prompt until the guard is satisfied.

Add a phase guard block to `pre-commit.ejs` that reads `.claude/.task-phase` and refuses commits during `preflight` or `plan` phases. Defaults to "unknown" when file absent, which falls through to allow commits (safe for non-lifecycle projects).

Add `arbiter task advance --to <phase>` CLI that validates forward-only transitions (preflight → plan → implementation → verification → complete), writes `.claude/.task-phase`, and appends `.claude/.task-phase-history` with ISO timestamp and `prev → next`. `--reverse` flag allows backward transitions for exceptional cases.

## Non-Goals

- **Evidence harness validation in `--to complete`** — deferred to a future issue; the hook already checks agent dispatch count
- **Multi-task parallelism** — multiple `.task-phase` files — deferred to v2
- **Auto-detecting phase completion** — too magical; explicit advance is intentional
- **Phase rollback audit log** — `--reverse` with history entry is sufficient for v1

## Consequences

- Claude cannot claim task completion during `implementation` or `verification` without satisfying the guard
- Commits blocked during `preflight`/`plan` enforce the contract that no implementation starts before planning is done
- Phase transitions are audited in `.claude/.task-phase-history`
- Projects not using the task lifecycle are unaffected: absent `.task-phase` → "unknown" → all gates pass

## Enforcement

- `src/templates/claude/hooks/guard-task-completion.mjs.ejs` — exits 2 on premature claim, writes to stderr
- `src/templates/githooks/pre-commit.ejs` — phase guard block rejects `preflight|plan`
- `src/commands/task.ts` — advance validator with forward-only enforcement and audit log
- INV-38 in `src/invariants/catalog.ts` and `AGENTS.md`

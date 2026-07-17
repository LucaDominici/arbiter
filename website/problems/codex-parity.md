---
title: 'The second AI tool quietly gets weaker governance than the first'
doc_version: '1.1.0'
status: active
last_review: '2026-07-17'
owner: ''
canonical_id: ''
tags: []
related: []
---

# The second AI tool quietly gets weaker governance than the first

> When two agent tracks are maintained as parallel copies, the copy drifts: a hard stop
> disappears from one tool's rules and nobody notices, while the docs keep promising parity.

## The problem

arbiter generates governance for both Claude Code and OpenAI Codex. Historically the Codex
track kept its own copies of the shared rules — and the copy of the execution protocol
silently lost the entire CANON-22 Root-Cause Discipline section (one hard stop simply did
not exist for Codex agents). The hand-written "Known Limitations" table in `CODEX.md`
documented 10 Claude hooks while the Claude track actually emitted 24. Nothing failed;
the gap was invisible (issue #1966).

## Who feels it

- Teams running more than one AI coding tool against the same governance set.
- Reviewers who trust the generated docs to state honestly what the second tool does NOT enforce.

## How arbiter enforces it

ADR-106 (Codex-track parity contract), enforced by `scripts/check-codex-parity.mjs` in the
**L2 gate**:

- **Derive-from-Claude**: shared rules have exactly one canonical template
  (`src/templates/claude/rules/`); the Codex generator renders it directly — there is no
  parallel copy left to drift.
- **100% parity-surface classification**: the gate bakes a real project with both tracks,
  scans every emitted file, and requires each one to be DERIVED, ALLOWLISTED (with pinned
  hashes + reason), or declared BY-DESIGN-EXCLUSIVE. An unclassified emission is a failure.
- **Generated Known Limitations**: the `CODEX.md` table is generated from the actual hook
  inventory and re-checked against the bake — a missing or stale row is a failure.
- **Anti-shrinkage baseline**: per-track file identities are ratcheted against the baseline
  at the merge-base with `origin/main`; unexplained shrinkage or a shallow clone fails closed.

## Verify it yourself

```bash
node scripts/check-codex-parity.mjs        # standalone
node scripts/check-all.mjs gate            # as part of the L2 gate
```

Inject drift and watch it fail: remove the CANON-22 section from a baked
`.agents/rules/90-exec-protocol.md` copy and run the check with `--baked-dir` — exit 1,
`derived-drift`.

## Self-applied: the tool's own repo

The same drift hits the tool's own config. Derived Codex rules are written once
(`skipIfExists`), so routine updates never refresh them — and no gate read arbiter's own
`.agents/` and `.codex/` at all. The result was the same failure mode in miniature:
arbiter's own materialized execution-protocol rule had lost the CANON-22 hard stop, two
derived rules were missing, and the config carried a hand-rolled table months out of
date. arbiter now self-applies the contract: `scripts/check-codex-self-parity.mjs`
(also in the **L2 gate**) re-emits the codex track fresh from arbiter's own generator
and config and compares it against the materialized files — every file must match the
fresh emission, carry a dated pin, or be a declared runtime artifact.

```bash
node scripts/check-codex-self-parity.mjs
```

Inject drift and watch it fail: edit any rule under `.agents/rules/` and run the check —
exit 1.

## Limits

- The contract proves parity/disclosure of **generated governance artifacts**, not that
  OpenAI Codex enforces anything at runtime: Codex has no native hook system, and the
  bridged subset runs only through `codex-adapter.mjs`.
- Intentional divergences remain possible — but only as reviewed allowlist entries whose
  staleness is itself gate-checked.
- Operational details: `docs/internal/METHOD/CODEX_PARITY_RUNBOOK.md` (maintainers).

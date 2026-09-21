---
title: 'arbiter — Codex Configuration'
doc_version: '1.0.0'
status: active
last_review: '2026-09-20'
owner: ''
canonical_id: ''
tags: ['audience/agent', 'audience/dev', 'kind/internal']
related: []
---

# arbiter — Codex Configuration

> **Governance rules are in `AGENTS.md` (canonical, AAIF standard).**
> This file adds OpenAI Codex-specific configuration only.

---

## Quick Reference

| Fact | Value |
|------|-------|
| **Project** | arbiter |
| **Test** | `npm run test` |
| **Gate** | `node scripts/check-all.mjs` |
| **Full governance** | `../AGENTS.md` |

---

## Startup Protocol (Read First)

1. Read `AGENTS.md` — this contains ALL governance rules and invariants
2. Read `docs/architecture/ARCHITECTURE.md` if it exists
3. Check current branch: must be `task/#NNN-description` (not `main`)
4. If no task branch exists, create one before any edits

## Execution Model

Codex follows the same result-first Ship contract as every other host. Start or resume with
`arbiter ship #NNN`; persisted task state owns treatment, phase, reviewer policy, evidence,
recovery, and landing. The active Markdown plan freezes acceptance criteria, non-goals, the full
file manifest, proof and rollback. Mechanical admission completes before implementation.

## Task Workflow

Follow this lifecycle for every task:

1. **Start**: Read GitHub issue → read `AGENTS.md` → create `task/#NNN-description` branch
2. **Plan**: Freeze acceptance, non-goals, file manifest, proof and rollback in the active Ship plan
3. **Implement**: Write tests first, then implementation. Run `npm run test` after each unit
4. **Qualify**: Run targeted checks while editing, one L1 on the frozen candidate, and L2 before push
5. **Finalize**: Commit → push → PR → verify CI → merge

## Command Translation

| Claude Code | Codex Equivalent |
|-------------|-----------------|
| `/ship #NNN` | **Orchestration entrypoint** — drive an issue to a merged PR |
| `arbiter lifecycle` | Low-level engine/CLI for recovery or direct lifecycle control |
| `npm run test` | Run tests for this stack |
| `node scripts/check-all.mjs L1` | Qualify the frozen delivery candidate |
| `node scripts/check-all.mjs L2` | Run before push/PR |

## Hard Stops

All hard stops from `AGENTS.md` apply. Additionally:
- Never implement without the active Ship plan and persisted task state
- Never commit directly to `main`
- Never skip the gate

---

## Known Limitations — Codex Governance Parity

Codex has a hook system (`[features] hooks`), but it covers a smaller set of
events than Claude Code. The table below is **generated from
the actual Claude-track inventory for this configuration** (ADR-106, arbiter
#1966) — do not edit it by hand; it is re-derived on every generation and
checked against the emitted hook inventory by the arbiter parity gate.

Hooks marked as *bridged* run in real time on Codex too, via
`.codex/config.toml` → `codex-adapter.mjs`. Everything else is covered at
gate time (`node scripts/check-all.mjs`) or is manual discipline, as stated.

**A bridged hook only runs once you approve it.** Codex requires a one-time
trust approval per project hook entry (stored as a `trusted_hash` under
`[hooks.state]` in `~/.codex/config.toml`); an unapproved entry is skipped
**silently** — no warning, no exit code, the guard simply does not run, and the
table above then overstates your real coverage. Approve them once interactively,
or pass `codex exec --dangerously-bypass-hook-trust` in automation. Editing
`.codex/config.toml` re-invalidates the approval for the entries it changes.

| Claude Code Hook | What it enforces | Codex equivalent |
|-----------------|-----------------|------------------|
| `stop-dangerous.mjs` | Blocks dangerous shell commands before execution | Real-time: bridged via `.codex/config.toml` → `codex-adapter.mjs` |
| `enforce-read-only.mjs` | Blocks edits to read-only / generated paths | Real-time: bridged via `.codex/config.toml` → `codex-adapter.mjs` |
| `pre-edit-ssot-guard.mjs` | Warns on SSOT/governance file edits | Real-time: bridged via `.codex/config.toml` → `codex-adapter.mjs` |
| `check-no-orphan-todo.mjs` | Blocks bare TODO without task ID (INV-06) | Real-time: bridged via `.codex/config.toml` → `codex-adapter.mjs` |
| `check-no-placeholders.mjs` | Blocks stub content and unfinished scaffolding in edited files | Real-time: bridged via `.codex/config.toml` → `codex-adapter.mjs` |
| `enforce-gate-before-pr.mjs` | Blocks PR creation before the local gate passed | Real-time: bridged via `.codex/config.toml` → `codex-adapter.mjs`; gate: `node scripts/check-all.mjs L2` before push |
| `pre-spawn-worktree-guard.mjs` | Refuses a second write-intent sub-agent spawn onto the main tree (E5 #1947) | None — manual worktree discipline |
| `post-subagent-release.mjs` | SubagentStop cleanup companion to pre-spawn-worktree-guard.mjs — releases the finished dispatch agents-active.json sidecar entry (#2403) | Real-time: bridged via `.codex/config.toml` → `codex-adapter.mjs` |
| `post-commit-check.mjs` | Reports one advisory line for a non-conventional commit or an unavailable check; otherwise silent; always exits 0 | Real-time: bridged via `.codex/config.toml` → `codex-adapter.mjs` |
| `check-no-unused-exports.mjs` | Blocks unused TypeScript exports (dead code) | Real-time: bridged via `.codex/config.toml` → `codex-adapter.mjs`; gate: dead-code check (`knip`) in `check-all.mjs` |
| `check-no-skipped-tests.mjs` | Blocks skipped/muted tests at edit time (INV-25) | Real-time: bridged via `.codex/config.toml` → `codex-adapter.mjs` |
| `check-no-any.mjs` | Blocks TypeScript `any` types (INV-04) | Real-time: bridged via `.codex/config.toml` → `codex-adapter.mjs`; gate: `tsc --strict` |
| `pre-edit-plan-anchor.mjs` | Requires plan file in implementation phase | Shared Ship plan + persisted task state |
| `pre-compact.mjs` | Snapshots task state before context compaction | Real-time: bridged via `.codex/config.toml` → `codex-adapter.mjs` |
| `post-edit-dispatch.mjs` | Runs post-edit agents for quality checks | None — manual code review |
| `debug-state-on-failure.mjs` | Persists debug state on gate failure | None — manual logging |
| `skill-forced-eval.mjs` | Requires successful Skill(tdd) evidence before implementation edits | Native phase gates (`arbiter lifecycle advance`); no final-response interception |
| `guard-task-completion.mjs` | Blocks premature done claims | Native phase gates (`arbiter lifecycle advance`); no final-response interception |
| `stop-evidence-guard.mjs` | Fail-closed completion backstop (INV-114) | None — manual discipline |
| `closer-mode-guard.mjs` | CLOSER-mode enforcement in the close phase | Real-time: bridged via `.codex/config.toml` → `codex-adapter.mjs` |
| `exitplanmode-banner.mjs` | Plan-exit banner in the task lifecycle | None — informational only |
| `stop-finding-loss.mjs` | Detects research dispatches with zero persisted findings (E6b #1948) | None — manual discipline |
| `guard-done-evidence.mjs` | Requires recorded evidence before done claims | Native phase gates (`arbiter lifecycle advance`); no final-response interception |
| `post-brainstorm-stop.mjs` | Brainstorm terminal-state guardrail (#1265) | Real-time: bridged via `.codex/config.toml` → `codex-adapter.mjs` |
| `check-circular-deps.mjs` | Detects circular deps per-edit (INV-01) | Real-time: bridged via `.codex/config.toml` → `codex-adapter.mjs`; gate: `madge --circular src` in `check-all.mjs` |
| `check-no-pii.mjs` | Blocks PII patterns in source (real-time) | Real-time: bridged via `.codex/config.toml` → `codex-adapter.mjs` |
| `wiki-on-commit.mjs` | Regenerates the LLM wiki on commit (INV-116) | Gate: wiki-lint check in `check-all.mjs` |

Claude-only surfaces with no Codex equivalent (by design, ADR-106 — accurate
disclosure, not implementation parity):

- **Commands** (6): `/ship`, `/drain`, `/impact`, `/review`, `/audit`, `/tabletop`
- **Agents** (4): `codebase-scanner`, `red-team`, `context-checker`, `bridge-reviewer`
- **Skills** (15): `tdd`, `verification`, `architect-review`, `clean-code`, `understand-code`, `codebase-audit`, `epic-decompose`, `configure`, `brainstorming`, `wave-drain`, `impact`, `gold-audit`, `close-gold-gap`, `levelup`, `tabletop`
- **Rules not derived into the Codex track** (1): `75-impact-vault-reading.md` — each is coupled to a Claude-only mechanism such as the `/impact` skill.

**Decision:** This gap is intentional. OpenAI Codex has no plugin/hook extension
point at the time of writing. When Codex adds a hook system, `codex-adapter.mjs`
should be extended to bridge these checks. Gate-level enforcement catches all
critical violations before merge.

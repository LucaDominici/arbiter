---
title: 'Concepts — arbiter'
doc_version: '1.0.0'
status: active
last_review: '2026-07-04'
owner: ''
canonical_id: ''
tags: ['audience/user', 'kind/reference']
related: ['docs/QUICKSTART.md', 'docs/GOVERNANCE.md']
---

# Concepts

Arbiter rests on three ideas. Understand these and the rest of the tool — hooks,
gates, generators, CLI flags — is just plumbing in service of them.

---

## 1. Self-installing governance

Most quality tooling is something a team configures by hand: a linter here, a CI
YAML there, a wiki page nobody re-reads. Arbiter instead **generates** a working
governance setup into your repo in one command (`npx @arbiter/cli init`) and
keeps it re-runnable — running `init` again refreshes what it manages and leaves
your customizations alone.

What lands is ordinary, inspectable, version-controlled: a canonical `AGENTS.md`
that every supported AI tool (Claude Code, Codex, ...) reads for its rules, thin
per-tool pointer files that add only what that tool uniquely needs, a local gate
script (`scripts/check-all.mjs`), and a matching CI workflow. Nothing runs as a
hidden service — it's all files you can read, diff, and delete.

## 2. Gate-blocked task lifecycle

Work moves through a fixed lifecycle, and each step is machine-checked before the
next one is allowed:

1. **Branch** — direct edits to `main` are refused.
2. **Red** — a failing test is written before the implementation (TDD, enforced
   not suggested).
3. **Green** — the implementation makes the test pass.
4. **Gate** — `node scripts/check-all.mjs L1` (fast: lint, format, unit tests) must
   pass before commit; `L2` (adds integration tests, coverage, and debt checks)
   must pass before push.

The gate is tiered by governance level, so the bar scales with how much you need:

| Level  | Adds on top of the previous level                        |
| ------ | -------------------------------------------------------- |
| **L1** | Lint + format + unit tests                               |
| **L2** | + integration tests, coverage thresholds, debt gates     |
| **L3** | + end-to-end tests, mutation testing                     |
| **L4** | + evidence harness, risk assessment, supply-chain checks |

A handful of these checks are worth knowing by name because they show up
constantly in practice:

- **No dead code / no unused exports** — anything you add must be reachable and
  used, or the gate flags it.
- **No secrets, no PII** — source, tests, and logs are scanned before a commit
  lands, not after a leak.
- **Explicit error handling** — swallowed exceptions and bare panics are
  refused; failures must be visible.
- **Dependency vulnerability scanning** — known-vulnerable packages block the
  gate rather than shipping quietly.
- **Complexity and duplication limits** — a function or a copy-pasted block
  that crosses a threshold is a stop, not a warning.
- **No orphan to-do markers** — a code comment flagging unfinished work must
  reference a tracked issue (e.g. `TODO(#123)`), or it doesn't land.

These are a sample of arbiter's full invariant catalog (see `AGENTS.md` in a
generated repo for the complete, numbered list) — the point isn't the count, it's
that each one is a real, automated check, not a style guideline someone might
skip under deadline pressure.

## 3. Evidence-gated "done"

A task isn't done because someone says it's done — it's done because the
artifacts prove it. Before a change can merge at the higher governance levels,
arbiter looks for concrete evidence tied to that change: a test that failed
before the fix and passes after it, a coverage report, a recorded gate run. A
claim of completion with no matching evidence is treated the same as a failing
gate — it's rejected, not waved through.

This is what makes arbiter useful specifically for AI-assisted development: an
agent (human-directed or autonomous) can move fast precisely because "I'm done"
is never taken on faith. The gate either has the receipts or it doesn't.

---

## Where these show up

- **Self-installing governance** → `arbiter init`, the generators, `AGENTS.md` and
  its per-tool pointers.
- **Gate-blocked lifecycle** → `scripts/check-all.mjs`, the governance-level
  table, the pre-commit/pre-push hooks.
- **Evidence-gated done** → the TDD-evidence and debt-ratchet checks at L2+, the
  evidence harness at L4.

For the mechanics of running a task through this lifecycle, start with
[QUICKSTART.md](QUICKSTART.md).

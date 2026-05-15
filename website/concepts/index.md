# Concepts

Core ideas behind arbiter.

## AGENTS.md — Canonical Governance

`AGENTS.md` is the single source of truth for your project's AI governance. It contains invariants, coding standards, testing policy, and commit conventions. Every AI tool reads it.

Tool-specific files (`.claude/CLAUDE.md`, `.agents/CODEX.md`) add only what that tool uniquely needs — they never duplicate governance.

## Governance Levels

| Level  | What it gates                                                   |
| ------ | --------------------------------------------------------------- |
| **L1** | Lint + format + unit tests (fast, pre-commit)                   |
| **L2** | L1 + integration tests + coverage + audit (default, matches CI) |
| **L3** | L2 + E2E + evidence artifacts (audit-grade)                     |

## Gate Tiers

Gates enforce governance at three points:

- **Commit (L1)** — fast checks run as a pre-commit hook
- **Push (L2)** — full suite before code leaves your machine
- **CI (L2/L3)** — authoritative pass/fail in the pull request

## Idempotency

Running `arbiter init` twice on the same repo is safe. All generated files use deterministic conflict resolution:

- `AGENTS.md`, `CLAUDE.md`, `CODEX.md` — backed up and replaced
- `settings.json` — deep merged (custom hooks preserved)
- Hooks, rules, templates — skipped if already exist

## Further Reading

- [What Gets Generated](/reference/templates)
- [Stack Support](/reference/stacks)
- [CLI Reference](/reference/cli)

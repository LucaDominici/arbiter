---
title: 'Quickstart'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Quickstart

Get arbiter running in under 60 seconds.

<!-- TODO(#530): replace this block with asciinema embed once cast is recorded -->

## Prerequisites

- Node.js ≥ 22 ([download](https://nodejs.org/))
- `git` installed
- `gh` CLI authenticated: `gh auth login`

## Install

```bash
npx @arbiter/cli init
```

That's it. The wizard detects your stack and asks a few questions.

---

## What the wizard does

When you run `arbiter init`, it will:

1. Detect your language and build tooling (TypeScript, Java, Rust, Go, Python)
2. Ask which AI tools you use (Claude Code, Codex, Cursor, Copilot, Windsurf, Aider, Gemini CLI)
3. Ask which governance level to apply (L1 / L2 / L3)
4. Generate everything in under 5 seconds

### Skip the wizard

If you already know what you want:

```bash
# All defaults, no prompts
npx @arbiter/cli init --yes

# Specify tools and level explicitly
npx @arbiter/cli init --yes --tools claude,codex --level L2

# Target a different directory
npx @arbiter/cli init --yes --dir /path/to/your/project
```

---

## Run your first gate

After `arbiter init`, your project has a gate script. Run it:

```bash
node scripts/check-all.mjs L1
```

`L1` is the fast tier: lint + format + unit tests. Expect it to complete in seconds.

For the full CI-equivalent check (coverage + integration tests + audit):

```bash
node scripts/check-all.mjs L2
```

---

## What just happened

Arbiter generated a governance stack tailored to your project. What you got:

| File                                 | What it is                                           |
| ------------------------------------ | ---------------------------------------------------- |
| `AGENTS.md`                          | Canonical governance file — every AI tool reads this |
| `.claude/CLAUDE.md`                  | Thin pointer for Claude Code (if selected)           |
| `.claude/settings.json`              | Hooks wired to enforce invariants at edit time       |
| `<project>/.github/workflows/ci.yml` | CI workflow parameterized to your stack              |
| `scripts/check-all.mjs`              | Gate runner — same command locally and in CI         |
| `.github/PULL_REQUEST_TEMPLATE.md`   | PR checklist                                         |

All generated files use deterministic conflict resolution — re-running is safe.

---

## What to do next

- [Concepts](/concepts/) — understand governance levels and the thin-pointer pattern
- [CLI Reference](/reference/cli) — all options and flags
- [Recipes](/recipes/) — custom invariants, custom generators, brownfield onboarding, writing a plugin
- [Stack Support](/reference/stacks) — which languages and tools are supported

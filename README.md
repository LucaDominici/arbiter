---
title: 'Arbiter — AI governance that installs itself.'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/spine']
related: []
---

# Arbiter — AI governance that installs itself.

[![No Telemetry](https://img.shields.io/badge/telemetry-none-brightgreen)](PRIVACY.md)
[![npm version](https://img.shields.io/npm/v/@arbiter/cli)](https://www.npmjs.com/package/@arbiter/cli)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen)](https://nodejs.org/)
[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/LucaDominici/arbiter)

```bash
npx @arbiter/cli init
```

<!-- TODO(#530): replace this block with asciinema embed once cast is recorded -->

---

## Why Arbiter

Every repo that uses AI coding agents eventually needs the same setup: a canonical governance file that all tools agree on, quality gates that enforce standards rather than just document them, and CI infrastructure that fails on violations rather than emitting warnings nobody reads.

Most alternatives tell the AI _how to think_. Arbiter tells the AI _what rules apply_ — and then enforces those rules mechanically at edit time, commit, push, and CI. The difference is that AI personas drift. Gate scripts don't.

Doing this by hand across stacks and tools is copy-paste work that rots the moment requirements change. Arbiter generates the whole stack from one parameterized source of truth and makes re-running safe.

**No telemetry.** Arbiter collects zero usage data and makes zero unsolicited network calls. See [PRIVACY.md](PRIVACY.md).

**Honest framing.** Arbiter is a governance installer with an optional orchestration layer. Its **core** is the installer — the canonical `AGENTS.md`, hooks, gate scripts, and CI it provisions. On top of that core it ships an _optional_ orchestration layer (`/ship`, `/drain`, and four sub-agents) that drives issues to merged PRs against the same governance contract; you can ignore it entirely and just use the installed gates. It is **not** a persona framework — it never tells the AI _who to be_. See [`docs/PRODUCT/PRD.md`](docs/PRODUCT/PRD.md) for what arbiter is, what it is not, and how it relates to other tools.

---

## How it compares

| Capability                        | arbiter | BMAD | GSD2 | claude-flow | SuperClaude | spec-kit |
| --------------------------------- | ------- | ---- | ---- | ----------- | ----------- | -------- |
| Canonical governance file         | ✓       | —    | —    | —           | —           | —        |
| Language-aware generation         | ✓       | —    | —    | —           | —           | —        |
| L1/L2/L3/L4 governance tiers      | ✓       | —    | —    | —           | —           | —        |
| Generated hook scripts            | ✓       | —    | —    | —           | —           | —        |
| CI workflow generation            | ✓       | —    | —    | —           | —           | —        |
| Idempotent update                 | ✓       | —    | —    | —           | —           | —        |
| Zero telemetry                    | ✓       | —    | —    | —           | —           | —        |
| Specialized sub-agents¹           | ✓       | ✓    | ✓    | ✓           | ✓           | —        |
| Autonomous task execution¹        | ✓       | —    | ✓    | ✓           | —           | —        |
| Parallel agent orchestration¹     | ✓       | —    | —    | ✓           | —           | —        |
| Agent personas / role definitions | —       | ✓    | —    | —           | ✓           | —        |

> ¹ Provided by arbiter's **optional orchestration layer** (`/ship`, `/drain`, and the
> `bridge-reviewer`/`codebase-scanner`/`context-checker`/`red-team` sub-agents) — distinct from the
> installer **core** (rows above the line), which is usable on its own. Arbiter is a governance
> installer with an optional orchestration layer; it is **not** a _persona_ framework.
> [Full comparison →](website/comparisons/index.md)

---

## Architecture

```
AGENTS.md                    ← Canonical governance (AAIF standard, all tools read this)
├── .claude/CLAUDE.md        ← Thin pointer + Claude-specific (hooks, settings, agents)
├── .agents/CODEX.md         ← Thin pointer + Codex-specific (plan schema, exec router)
├── .github/                 ← CI workflows, PR/issue templates, dependabot, CODEOWNERS
├── scripts/check-all.mjs    ← Quality gate runner (parameterized by stack)
└── Root files               ← SECURITY.md, .editorconfig
```

**Key principle:** `AGENTS.md` contains ALL governance (invariants, coding standards, testing policy, commit conventions). Tool-specific files add ONLY what that tool uniquely needs.

See [`docs/architecture/ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) for the full model.

---

## Installation

```bash
# Interactive wizard
npx @arbiter/cli init

# Non-interactive (CI / first setup)
npx @arbiter/cli init --yes

# Specific tools and level
npx @arbiter/cli init --yes --tools claude,codex --level L2
```

Requires: Node.js ≥ 22, `gh` CLI authenticated (`gh auth login`).

---

## CLI Reference

```
arbiter init [options]

Options:
  -y, --yes              Skip wizard — use auto-detected defaults
  --tools <list>         AI tools: claude,codex                    (default: claude,codex)
  --level <level>        Governance level: L1, L2, L3, L4        (default: L2)
  --dir <path>           Target directory                         (default: cwd)
  --quiet                Suppress informational banners
  -h, --help             Show help
```

See the [CLI Reference](website/reference/cli.md) for full option documentation and examples.

---

## What Gets Generated

| File / Directory                   | Always | Claude | Codex | GitHub |
| ---------------------------------- | ------ | ------ | ----- | ------ |
| `AGENTS.md`                        | ✓      |        |       |        |
| `.claude/CLAUDE.md`                |        | ✓      |       |        |
| `.claude/settings.json`            |        | ✓      |       |        |
| `.claude/hooks/`                   |        | ✓      |       |        |
| `.claude/rules/`                   |        | ✓      |       |        |
| `.claude/commands/`                |        | ✓      |       |        |
| `.agents/CODEX.md`                 |        |        | ✓     |        |
| `.agents/rules/`                   |        |        | ✓     |        |
| `.agents/plan/`                    |        |        | ✓     |        |
| `.github/workflows/ci.yml`         |        |        |       | ✓      |
| `.github/PULL_REQUEST_TEMPLATE.md` |        |        |       | ✓      |
| `.github/ISSUE_TEMPLATE/`          |        |        |       | ✓      |
| `.github/dependabot.yml`           |        |        |       | ✓      |
| `.github/CODEOWNERS`               |        |        |       | ✓      |
| `SECURITY.md`                      |        |        |       | ✓      |
| `.editorconfig`                    |        |        |       | ✓      |
| `scripts/check-all.mjs`            |        |        |       | ✓      |

**Conflict resolution:**

- `AGENTS.md`, `CLAUDE.md`, `CODEX.md` — backed up (`.arbiter-backup`) and replaced
- `settings.json` — deep merged (custom hooks preserved)
- Hooks, rules, commands — skipped if already exist (all hooks are empirically tested — see `__tests__/hooks/empirical/`)
- GitHub templates, workflows — skipped if already exist

---

## Governance Levels

| Level  | What it gates                                                        |
| ------ | -------------------------------------------------------------------- |
| **L1** | Lint + format + unit tests (fast, pre-commit)                        |
| **L2** | L1 + integration tests + coverage + debt gates + security scan       |
| **L3** | L2 + E2E + mutation testing                                          |
| **L4** | L3 + evidence harness + STRIDE risk assessment + TRACK_ROUTER + SLSA |

---

## Stack Support

**Supported:** TypeScript, Python, Go · Claude Code, Codex.
**Experimental:** Java, Kotlin, Rust · Cursor, Aider, Copilot, Gemini, Windsurf.

| Language   | Detected from              | Build tool   | Lint          | Format   | Status       |
| ---------- | -------------------------- | ------------ | ------------- | -------- | ------------ |
| TypeScript | `package.json`             | npm          | eslint        | prettier | Supported    |
| Java       | `pom.xml` / `build.gradle` | gradle/maven | checkstyle    | —        | Experimental |
| Rust       | `Cargo.toml`               | cargo        | clippy        | rustfmt  | Experimental |
| Go         | `go.mod`                   | go           | golangci-lint | gofmt    | Supported    |
| Python     | `pyproject.toml`           | pip/uv       | ruff          | ruff     | Supported    |

---

## Idempotency

Running `arbiter init` twice on the same repo is safe. All generated files use deterministic conflict resolution. Re-running on an existing repo will:

- Refresh `AGENTS.md` and pointer files (with backup)
- Deep-merge `settings.json`
- Skip any hooks/rules/templates you've customized
- Re-provision labels (create missing, update existing)

---

## Product Documentation

- [`docs/PRODUCT/PRD.md`](docs/PRODUCT/PRD.md) — Vision, problem, users, features by phase, success metrics
- [`docs/PRODUCT/MILESTONES.md`](docs/PRODUCT/MILESTONES.md) — Phased delivery with exit criteria
- [`llms.txt`](llms.txt) — Agent-native root index ([llmstxt.org](https://llmstxt.org) convention) for external LLM tools that clone this repo. Generated by `scripts/gen-llms-txt.mjs` from [`llms-txt.config.json`](llms-txt.config.json) (the sole hand-maintained input) + the live `docs/INDEX.md` doc count; `--check` mode is wired into the L1 gate so it can never drift.

---

## Plugins (beta)

> **Beta:** The plugin API is public but not stable. Breaking changes are possible before v1.0.

Organizations can extend arbiter with framework-specific generators (Spring Boot, Rails, Django…) without forking:

```bash
arbiter plugin add my-spring-boot-plugin
arbiter plugin list
arbiter plugin remove my-spring-boot-plugin
```

A plugin is a normal npm package that exports an `ArbiterPlugin` object. See [`docs/ADR/031-plugin-api-v1.md`](docs/ADR/031-plugin-api-v1.md) for the contract and [`src/types/plugin.ts`](src/types/plugin.ts) for the TypeScript interfaces.

---

## Design Decisions

The canonical governance contract is [`AGENTS.md`](AGENTS.md) — it defines invariants, coding standards, testing policy, and commit conventions that every AI tool reads.

See [`docs/ADR/`](docs/ADR/) for the rationale behind key choices:

- [ADR-001](docs/ADR/001-agents-md-canonical.md): Why `AGENTS.md` as canonical source (not `CLAUDE.md`)
- [ADR-002](docs/ADR/002-thin-pointer-pattern.md): Why thin pointers instead of full governance in each tool config
- [ADR-003](docs/ADR/003-gh-cli-required.md): Why `gh` CLI is required (not optional)
- [ADR-004](docs/ADR/004-skip-if-exists.md): Why `skipIfExists` on hooks (not overwrite)
- [ADR-005](docs/ADR/005-deep-merge-settings.md): Deep merge for settings.json

---

## Examples

Worked walkthroughs of `arbiter init` on real starter projects — one per archetype:

| Example                                                  | Stack                            | Archetype        |
| -------------------------------------------------------- | -------------------------------- | ---------------- |
| [ts-frontend-spa](examples/ts-frontend-spa.md)           | TypeScript + React + Vitest      | `frontend-spa`   |
| [java-backend-web-db](examples/java-backend-web-db.md)   | Java 21 + Spring Boot 3 + Gradle | `backend-web-db` |
| [rust-cli](examples/rust-cli.md)                         | Rust + Clap                      | `cli`            |
| [go-library](examples/go-library.md)                     | Go module                        | `library`        |
| [python-data-pipeline](examples/python-data-pipeline.md) | Python + uv                      | `data-pipeline`  |

See [`examples/`](examples/) for plugin SDK examples and the arbiter-starter fixture.

---

## Community

- **Discussions** — [github.com/LucaDominici/arbiter/discussions](https://github.com/LucaDominici/arbiter/discussions): Q&A, ideas, show-and-tell, announcements.
- **Good first issues** — see issues labelled [`good first issue`](https://github.com/LucaDominici/arbiter/issues?q=label%3A%22good+first+issue%22+is%3Aopen).
- **RFC process** — see [`docs/METHOD/PROCESS.md`](docs/METHOD/PROCESS.md) for how to propose major changes.

---

## Contributing

Contributions are welcome. Please read our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

To report a security vulnerability, see [SECURITY.md](SECURITY.md).

---

## Sponsoring

arbiter is maintained by volunteers. If you find it useful, consider [sponsoring via GitHub Sponsors](https://github.com/sponsors/LucaDominici).

See [`.github/FUNDING.yml`](.github/FUNDING.yml) for the funding configuration.

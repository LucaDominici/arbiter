# Arbiter — Architecture

## Overview

Arbiter generates a multi-layer governance stack for AI-assisted development. The architecture has one invariant: **a single canonical source of truth**, with all tool-specific configs as thin overlays.

---

## Canonical Source Model

```
AGENTS.md                           ← Layer 0: Canonical governance
│                                      (AAIF standard, read natively by all major AI tools)
│
├── .claude/CLAUDE.md               ← Layer 1: Claude Code overlay
│   ├── settings.json               │   Hooks wiring, permissions, sub-agent definitions
│   ├── hooks/                      │   PreToolUse/PostToolUse enforcement scripts
│   ├── rules/                      │   Additional rules (lifecycle, exec protocol)
│   └── commands/                   │   Slash commands (/start-task, /complete-task)
│
├── .agents/CODEX.md                ← Layer 1: Codex overlay
│   ├── rules/                      │   Mirrored rule set (same content as .claude/rules/)
│   └── plan/                       │   Task plan artifacts (PLAN.json, CONTEXT_PACK.md)
│
├── .github/                        ← Layer 2: GitHub integration
│   ├── workflows/ci.yml            │   CI pipeline (parameterized by stack)
│   ├── PULL_REQUEST_TEMPLATE.md    │   Structured PR descriptions
│   ├── ISSUE_TEMPLATE/             │   Bug, feature, task brief templates
│   ├── dependabot.yml              │   Automated dependency updates
│   └── CODEOWNERS                  │   Review assignment
│
└── scripts/check-all.sh            ← Layer 2: Quality gate runner
```

---

## Layer 0 — AGENTS.md (Canonical)

`AGENTS.md` is the single source of truth for:

- **Project identity** — name, stack, build/test commands, gate command
- **Authority hierarchy** — which documents override which
- **Invariants** — non-negotiable rules (architecture, code quality, process)
- **Coding standards** — language-specific conventions
- **Testing policy** — what must be tested and how
- **Commit convention** — type(scope): summary format
- **Branch strategy** — naming, protection rules
- **Gate system** — L1/L2/L3 layered quality checks
- **Multi-agent extensions** — per-tool capability table

### Why AGENTS.md

`AGENTS.md` was co-donated to the [AAIF (Agentic AI Interoperability Foundation)](https://agents.md/) by Anthropic and OpenAI (December 2025) as the universal AI governance standard. It is:

- Natively read by: Claude Code, Codex, Cursor, Copilot, Gemini CLI, Windsurf
- Adopted by 60,000+ projects
- A Linux Foundation standard under the AAIF

Using `AGENTS.md` as canonical means governance is written once and available to every tool, present and future, without tool-specific duplication.

---

## Layer 1 — Tool Overlays (Thin Pointers)

Each tool config opens with an explicit pointer to `AGENTS.md`:

```markdown
# {project} — Claude Code Configuration

> **Governance rules are in `AGENTS.md` (canonical, AAIF standard).**
> This file adds Claude Code-specific configuration only.
```

### What tool configs add (and only this)

| Tool | Claude Code | Codex |
|------|-------------|-------|
| Auth/Permissions | `settings.json` permissions + allowed tools | — |
| Hook wiring | `settings.json` hooks section | — |
| Hook scripts | `.claude/hooks/*.sh` | — |
| Slash commands | `.claude/commands/*.md` | — |
| Sub-agents | `.claude/agents/*.md` | — |
| Plan schema | — | `CODEX.md` §Plan Schema |
| Exec router | — | `CODEX.md` §Execution Router |
| Context pack | — | `.agents/plan/CONTEXT_PACK.md` |
| Rule mirror | `.claude/rules/` | `.agents/rules/` (same content) |

### What tool configs must NOT contain

- Invariants (those live in `AGENTS.md`)
- Coding standards (those live in `AGENTS.md`)
- Commit conventions (those live in `AGENTS.md`)
- Testing policy (those live in `AGENTS.md`)
- Authority hierarchy (lives in `AGENTS.md`)

Anything duplicated between `AGENTS.md` and a tool config will drift.

---

## Layer 2 — GitHub + Quality Gates

### CI Workflow

Generated at `.github/workflows/ci.yml`, parameterized by detected stack:

- TypeScript: `npm ci → typecheck → lint → test --coverage`
- Java: `gradlew checkstyleMain → gradlew test`
- Rust: `cargo fmt --check → cargo clippy → cargo test`
- Go: `gofmt → golangci-lint → go test`
- Python: `ruff check → ruff format → pytest`

Always includes a `ci-required` job as the merge gate (required status check for branch protection).

### Quality Gate Script (`scripts/check-all.sh`)

Three-level gate system:

| Level | Checks | When |
|-------|--------|------|
| L1 | Format + lint + unit tests | Pre-commit (fast) |
| L2 | L1 + integration + coverage + audit | Pre-push (matches CI) |
| L3 | L2 + E2E + evidence | Release / audit |

```bash
./scripts/check-all.sh L1   # fast local check
./scripts/check-all.sh L2   # full gate (default)
./scripts/check-all.sh       # defaults to L2
```

### Labels

15 standard labels provisioned via `gh label create/edit`:

- **Type:** `bug`, `feature`, `task`, `docs`, `refactor`, `test`, `ci`, `deps`
- **Size:** `size/XS`, `size/S`, `size/M`, `size/L`
- **Priority:** `priority/P0`, `priority/P1`, `priority/P2`

### Branch Protection

Applied to `main` via `gh api`:
- Required status check: `CI Required`
- Required review: 1 approving reviewer
- Dismiss stale reviews on push
- No force-push, no deletions

---

## Conflict Resolution Strategy

| File | Strategy | Reason |
|------|----------|--------|
| `AGENTS.md` | Backup + replace | Always regenerated from template |
| `.claude/CLAUDE.md` | Backup + replace | Thin pointer — stateless |
| `.agents/CODEX.md` | Backup + replace | Thin pointer — stateless |
| `.claude/settings.json` | Deep merge | Custom hooks must be preserved |
| `.claude/hooks/*.sh` | Skip if exists | Project-customized |
| `.claude/rules/*.md` | Skip if exists | Project-customized |
| `.claude/commands/*.md` | Skip if exists | Project-customized |
| `.github/workflows/ci.yml` | Skip if exists | May be heavily customized |
| `.github/PULL_REQUEST_TEMPLATE.md` | Skip if exists | May be customized |
| `.github/ISSUE_TEMPLATE/*` | Skip if exists | May be customized |
| `scripts/check-all.sh` | Skip if exists | May be customized |
| `SECURITY.md`, `.editorconfig` | Skip if exists | Created once |
| GitHub labels | Create missing + update existing | Idempotent provisioning |
| Branch protection | Always apply | Rules are deterministic |

### settings.json Deep Merge

When `.claude/settings.json` already exists, arbiter deep-merges:

- `permissions.allow` — union of arrays, deduplicated by command
- `permissions.deny` — union of arrays, deduplicated by command
- `hooks` — incoming hooks added if their `matcher` isn't already present
- All other keys — incoming wins

This preserves project-specific hook registrations while adding missing ones.

---

## Extensibility (Phases 3–4)

### Phase 3: Update + Diff (planned)

- `arbiter.json` — stores generation config per repo for reproducible re-runs
- `arbiter update` — re-generates while respecting skipIfExists semantics
- `arbiter diff` — dry-run showing what would change

### Phase 4: Additional Targets (planned)

| Tool | File | Status |
|------|------|--------|
| Cursor | `.cursorrules` | Planned |
| Copilot | `.github/copilot-instructions.md` | Planned |
| Gemini CLI | `GEMINI.md` | Planned |
| Windsurf | `.windsurfrules` | Planned |

All future targets follow the same thin-pointer pattern: point to `AGENTS.md`, add only tool-specific configuration.

### ai-rulez Detection

If `.ai-rulez/` or `ai-rulez.yml` is present, arbiter detects it and skips multi-tool config generation (the other tool handles it). GitHub and quality gate generation still proceed.

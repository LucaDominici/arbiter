# Arbiter — Architecture Overview

Arbiter generates a multi-layer governance stack for AI-assisted development. The architecture has one invariant: **a single canonical source of truth**, with all tool-specific configs as thin overlays.

---

## Canonical Source Model

```
AGENTS.md                           <- Layer 0: Canonical governance
|                                      (AAIF standard, read natively by all major AI tools)
|
+-- .claude/CLAUDE.md               <- Layer 1: Claude Code overlay
|   +-- settings.json               |   Hooks wiring, permissions, sub-agent definitions
|   +-- hooks/                      |   PreToolUse/PostToolUse enforcement scripts
|   +-- rules/                      |   Additional rules (lifecycle, exec protocol)
|   +-- commands/                   |   Slash commands (/task)
|
+-- .agents/CODEX.md                <- Layer 1: Codex overlay
|   +-- rules/                      |   Mirrored rule set (same content as .claude/rules/)
|   +-- plan/                       |   Task plan artifacts (PLAN.json, CONTEXT_PACK.md)
|
+-- .github/                        <- Layer 2: GitHub integration
|   +-- workflows/ci.yml            |   CI pipeline (parameterized by stack)
|   +-- PULL_REQUEST_TEMPLATE.md    |   Structured PR descriptions
|   +-- ISSUE_TEMPLATE/             |   Bug, feature, task brief templates
|   +-- dependabot.yml              |   Automated dependency updates
|   +-- CODEOWNERS                  |   Review assignment
|
+-- scripts/check-all.mjs           <- Layer 2: Quality gate runner
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

| Tool             | Claude Code                                 | Codex                           |
| ---------------- | ------------------------------------------- | ------------------------------- |
| Auth/Permissions | `settings.json` permissions + allowed tools | —                               |
| Hook wiring      | `settings.json` hooks section               | —                               |
| Hook scripts     | `.claude/hooks/*.mjs`                       | —                               |
| Slash commands   | `.claude/commands/*.md`                     | —                               |
| Sub-agents       | `.claude/agents/*.md`                       | —                               |
| Plan schema      | —                                           | `CODEX.md` §Plan Schema         |
| Exec router      | —                                           | `CODEX.md` §Execution Router    |
| Context pack     | —                                           | `.agents/plan/CONTEXT_PACK.md`  |
| Rule mirror      | `.claude/rules/`                            | `.agents/rules/` (same content) |

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

- TypeScript: `npm ci -> typecheck -> lint -> test --coverage`
- Java: `gradlew checkstyleMain -> gradlew test`
- Rust: `cargo fmt --check -> cargo clippy -> cargo test`
- Go: `gofmt -> golangci-lint -> go test`
- Python: `ruff check -> ruff format -> pytest`

Always includes a `ci-required` job as the merge gate (required status check for branch protection).

### Quality Gate Script (`scripts/check-all.mjs`)

Three-level gate system:

| Level | Checks                              | When                  |
| ----- | ----------------------------------- | --------------------- |
| L1    | Format + lint + unit tests          | Pre-commit (fast)     |
| L2    | L1 + integration + coverage + audit | Pre-push (matches CI) |
| L3    | L2 + E2E + evidence                 | Release / audit       |

```bash
node scripts/check-all.mjs L1   # fast local check
node scripts/check-all.mjs L2   # full gate (default)
node scripts/check-all.mjs       # defaults to L2
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

## Extensibility

### Phases 3-4: Update + Diff & Additional Targets (DONE)

Phases 3 and 4 are complete and shipped:

- **Phase 3** — `arbiter update` and `arbiter diff` commands with `arbiter.json` config persistence
- **Phase 4** — Additional tool targets (Cursor `.cursorrules`, Copilot `.github/copilot-instructions.md`)

See [CLI Reference](../REFERENCE/CLI.md) for command documentation.

### Additional Tool Targets

| Tool       | File                              | Status              |
| ---------- | --------------------------------- | ------------------- |
| Cursor     | `.cursorrules`                    | Shipped             |
| Copilot    | `.github/copilot-instructions.md` | Shipped             |
| Gemini CLI | `GEMINI.md`                       | Planned (Phase 6-8) |
| Windsurf   | `.windsurfrules`                  | Planned (Phase 6-8) |

All targets follow the same thin-pointer pattern: point to `AGENTS.md`, add only tool-specific configuration.

### Phases 6-8: Future Work

- Gemini CLI and Windsurf overlay generation
- Plugin / extension API for community-contributed tool targets
- Template customization and inheritance

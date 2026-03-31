# Arbiter — Architectural Decision Records

Design decisions, trade-offs, and rationale. Updated as the project evolves.

---

## ADR-001: AGENTS.md as canonical governance source

**Status:** Accepted | **Date:** 2026-04-01

### Context

AI coding tools each have their own config file format:
- Claude Code: `CLAUDE.md` / `.claude/`
- Codex: `AGENTS.md` / `.agents/`
- Cursor: `.cursorrules`
- Copilot: `.github/copilot-instructions.md`
- Gemini CLI: `GEMINI.md`

Maintaining governance in each tool's native format causes drift. The question was: which file is the canonical source?

### Decision

`AGENTS.md` is the canonical source. All other tool configs are thin pointers.

### Rationale

1. **Linux Foundation standard** — AGENTS.md was co-donated to the AAIF by Anthropic and OpenAI (December 2025). It is not a proprietary format.
2. **Universal adoption** — Claude Code, Codex, Cursor, Copilot, Gemini CLI, and Windsurf all read `AGENTS.md` natively as of early 2026.
3. **Single maintenance point** — governance changes propagate to all tools without per-tool updates.
4. **Academically correct** — aligns with the AAIF interoperability vision: one file, all agents.

### Alternatives rejected

- **CLAUDE.md as canonical** — Anthropic-specific; Codex/Cursor don't read it natively.
- **Per-tool canonical sources** — drift is guaranteed and cross-tool consistency is impossible.
- **Shared config via symlink** — breaks on Windows and in many CI environments.

---

## ADR-002: Thin pointer pattern for tool overlays

**Status:** Accepted | **Date:** 2026-04-01

### Context

Tool-specific files need to exist because each tool has unique configuration that doesn't belong in `AGENTS.md` (hooks wiring for Claude, plan JSON schema for Codex, slash commands). The question was how much content to put in each file.

### Decision

Tool configs are thin pointers: they open with an explicit reference to `AGENTS.md`, then add only what that tool uniquely needs. No governance content is duplicated.

### Template

```markdown
# {project} — Claude Code Configuration

> **Governance rules are in `AGENTS.md` (canonical, AAIF standard).**
> This file adds Claude Code-specific configuration only.
```

### Alternatives rejected

- **Full CLAUDE.md with all governance** — this was the pre-arbiter state in viafera/haben/coach-system. It caused drift because each repo's CLAUDE.md diverged independently.
- **Empty pointer with no tool config** — rejected because tool-specific config (hooks, permissions) genuinely needs to live somewhere.

---

## ADR-003: gh CLI as required dependency for GitHub features

**Status:** Accepted | **Date:** 2026-04-01

### Decision

`gh` CLI is required for GitHub features. If not authenticated, GitHub setup is skipped gracefully with a clear message.

### Rationale

- **Simpler security model** — `gh` manages token storage, scopes, and rotation. Arbiter never handles GitHub tokens directly.
- **No token-in-wizard UX** — terminals log commands; prompting for tokens is a security risk.
- **Consistent behavior** — `gh` provides structured output and handles errors well.

### Alternatives rejected

- **GitHub token in wizard** — security risk, poor UX.
- **GitHub MCP server** — optional, not universally installed. May be added as an alternative path later.
- **HTTP directly with token from env** — adds token management complexity to arbiter.

---

## ADR-004: skipIfExists on hooks, rules, and commands

**Status:** Accepted | **Date:** 2026-04-01

### Decision

Hook scripts, rules, and commands use `skipIfExists: true`. Created on first install, never overwritten.

### Rationale

Hooks are the most project-customized part of `.claude/`. Overwriting them destroys local work. The explicit update path is `rm <hook> && arbiter init` (or `arbiter update` in Phase 3).

### Exceptions

- `AGENTS.md`, `CLAUDE.md`, `CODEX.md` — always replaced (backup kept). These are stateless thin pointers with no project-specific content.
- `settings.json` — deep-merged. Has both stateless (hook wiring) and stateful (custom permissions) sections.

---

## ADR-005: Deep merge for settings.json

**Status:** Accepted | **Date:** 2026-04-01

### Decision

Merge rules for existing `.claude/settings.json`:

- `permissions.allow` — union, deduplicated by command string
- `permissions.deny` — union, deduplicated by command string
- `hooks[].matcher` — incoming hooks added only if matcher isn't already present
- All other keys — incoming value wins

### Rationale

Existing project hooks survive. Arbiter's hooks (stop-dangerous, enforce-read-only, etc.) are added if missing. The merge is deterministic and idempotent.

---

## ADR-006: TypeScript + Node for the CLI runtime

**Status:** Accepted | **Date:** 2026-04-01

### Decision

TypeScript + Node, distributed as `@arbiter/cli` on npm. Installed via `npx arbiter init`.

### Rationale

- **Zero install for JS/TS projects** — `npx` works without a global install.
- **Target audience** — most repos that would use arbiter already have Node in their dev environment.
- **EJS templating** — mature, simple, well-typed for parameterized file generation.
- **Ecosystem fit** — governance methodology originated in a TypeScript/Java shop.

### Alternatives rejected

- **Python** — conflicts visually with ai-rulez (also Python). Independent projects but awkward positioning.
- **Rust** — single binary, zero runtime deps. Rejected: compile time too long for an installer; worse DX for contributors.
- **Go** — single binary. Rejected: same reasoning; smaller ecosystem for this specific task.

---

## ADR-007: 15 standard labels as canonical set

**Status:** Accepted | **Date:** 2026-04-01

### Decision

15 labels provisioned idempotently (`gh label create/edit`):

| Category | Labels |
|----------|--------|
| Type (8) | `bug`, `feature`, `task`, `docs`, `refactor`, `test`, `ci`, `deps` |
| Size (4) | `size/XS`, `size/S`, `size/M`, `size/L` |
| Priority (3) | `priority/P0`, `priority/P1`, `priority/P2` |

### Rationale

Type labels mirror commit convention types. Size labels enable capacity planning. Priority labels enable triage. 15 is deliberately minimal — enough for real use without labeling becoming overhead.

---

## ADR-008: Governance levels L1/L2/L3

**Status:** Accepted | **Date:** 2026-04-01

### Decision

Three gate levels, strictly nested (L1 ⊂ L2 ⊂ L3):

| Level | Checks | Default use |
|-------|--------|-------------|
| L1 | Format + lint + unit tests | Pre-commit (fast) |
| L2 | L1 + integration + coverage + audit | Pre-push, CI (default) |
| L3 | L2 + E2E + evidence artifacts | Release, audit-grade repos |

### Rationale

- L2 is the default because it matches CI exactly — local and CI are the same gate, so "works locally" means "will pass CI".
- L1 exists for speed in tight iteration loops (pre-commit hook).
- L3 exists for repos with compliance or audit requirements (viafera being the reference implementation).
- Nesting ensures L2 never passes while L1 fails.

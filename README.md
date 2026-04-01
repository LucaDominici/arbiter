# Arbiter — AI Development Governance Framework

Arbiter installs a complete, standards-aligned AI governance stack into any project in one command.

```bash
npx arbiter init
```

It generates `AGENTS.md` (the canonical governance file, AAIF/Linux Foundation standard), thin-pointer configs for each AI tool, GitHub assets, quality gates, and hook scripts — all parameterized to your stack.

---

## Why Arbiter

Every repo that uses AI coding agents needs the same things:

- A canonical governance file that all tools read (`AGENTS.md`)
- Tool-specific configs that don't duplicate governance (Claude, Codex, Cursor…)
- Quality gate scripts parameterized to your stack
- GitHub templates, labels, and branch protection
- Hook scripts that enforce invariants at edit time

Doing this by hand drifts. Arbiter makes it reproducible and installable.

---

## Architecture

```
AGENTS.md                    ← Canonical governance (AAIF standard, all tools read this)
├── .claude/CLAUDE.md        ← Thin pointer + Claude-specific (hooks, settings, agents)
├── .agents/CODEX.md         ← Thin pointer + Codex-specific (plan schema, exec router)
├── .github/                 ← CI workflows, PR/issue templates, dependabot, CODEOWNERS
├── scripts/check-all.sh     ← Quality gate runner (parameterized by stack)
└── Root files               ← SECURITY.md, .editorconfig
```

**Key principle:** `AGENTS.md` contains ALL governance (invariants, coding standards, testing policy, commit conventions). Tool-specific files add ONLY what that tool uniquely needs.

See [`docs/ARCHITECTURE/OVERVIEW.md`](docs/ARCHITECTURE/OVERVIEW.md) for the full model.

---

## Installation

```bash
# Interactive wizard
npx arbiter init

# Non-interactive (CI / first setup)
npx arbiter init --yes

# Specific tools and level
npx arbiter init --yes --tools claude,codex --level L2
```

Requires: Node.js ≥ 20, `gh` CLI authenticated (`gh auth login`).

---

## CLI Reference

```
arbiter init [options]

Options:
  -y, --yes              Skip wizard — use auto-detected defaults
  --tools <list>         AI tools: claude,codex,cursor,copilot  (default: claude,codex)
  --level <level>        Governance level: L1, L2, L3            (default: L2)
  --dir <path>           Target directory                         (default: cwd)
  -h, --help             Show help
```

See [`docs/REFERENCE/CLI.md`](docs/REFERENCE/CLI.md) for full option documentation and examples.

---

## What Gets Generated

| File / Directory | Always | Claude | Codex | GitHub |
|-----------------|--------|--------|-------|--------|
| `AGENTS.md` | ✓ | | | |
| `.claude/CLAUDE.md` | | ✓ | | |
| `.claude/settings.json` | | ✓ | | |
| `.claude/hooks/` | | ✓ | | |
| `.claude/rules/` | | ✓ | | |
| `.claude/commands/` | | ✓ | | |
| `.agents/CODEX.md` | | | ✓ | |
| `.agents/rules/` | | | ✓ | |
| `.agents/plan/` | | | ✓ | |
| `.github/workflows/ci.yml` | | | | ✓ |
| `.github/PULL_REQUEST_TEMPLATE.md` | | | | ✓ |
| `.github/ISSUE_TEMPLATE/` | | | | ✓ |
| `.github/dependabot.yml` | | | | ✓ |
| `.github/CODEOWNERS` | | | | ✓ |
| `SECURITY.md` | | | | ✓ |
| `.editorconfig` | | | | ✓ |
| `scripts/check-all.sh` | | | | ✓ |

**Conflict resolution:**
- `AGENTS.md`, `CLAUDE.md`, `CODEX.md` — backed up (`.bak`) and replaced
- `settings.json` — deep merged (custom hooks preserved)
- Hooks, rules, commands — skipped if already exist
- GitHub templates, workflows — skipped if already exist

---

## Governance Levels

| Level | What it gates |
|-------|--------------|
| **L1** | Lint + format + unit tests (fast, pre-commit) |
| **L2** | L1 + integration tests + coverage + audit (default, matches CI) |
| **L3** | L2 + E2E + evidence artifacts (audit-grade) |

---

## Stack Support

| Language | Detected from | Build tool | Lint | Format |
|----------|--------------|-----------|------|--------|
| TypeScript | `package.json` | npm | eslint | prettier |
| Java | `pom.xml` / `build.gradle` | gradle/maven | checkstyle | — |
| Rust | `Cargo.toml` | cargo | clippy | rustfmt |
| Go | `go.mod` | go | golangci-lint | gofmt |
| Python | `pyproject.toml` | pip/uv | ruff | ruff |

---

## Idempotency

Running `arbiter init` twice on the same repo is safe. All generated files use deterministic conflict resolution. Re-running on an existing repo will:
- Refresh `AGENTS.md` and pointer files (with backup)
- Deep-merge `settings.json`
- Skip any hooks/rules/templates you've customized
- Re-provision labels (create missing, update existing)

---

## Design Decisions

See [`docs/ADR/`](docs/ADR/) for the rationale behind key choices:
- [ADR-001](docs/ADR/001-agents-md-canonical.md): Why `AGENTS.md` as canonical source (not `CLAUDE.md`)
- [ADR-002](docs/ADR/002-thin-pointer-pattern.md): Why thin pointers instead of full governance in each tool config
- [ADR-003](docs/ADR/003-gh-cli-required.md): Why `gh` CLI is required (not optional)
- [ADR-004](docs/ADR/004-skip-if-exists.md): Why `skipIfExists` on hooks (not overwrite)
- [ADR-005](docs/ADR/005-deep-merge-settings.md): Deep merge for settings.json

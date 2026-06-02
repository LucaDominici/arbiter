---
title: 'Arbiter CLI Reference'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# Arbiter CLI Reference

## Exit codes (canonical convention)

All `arbiter` subcommands obey one exit-code convention:

| Code | Meaning                     | CI semantics                                    |
| ---- | --------------------------- | ----------------------------------------------- |
| `0`  | ok                          | must pass                                       |
| `1`  | warning / recoverable error | CI should pass but surface a flag               |
| `2`  | error / fatal blocker       | CI must fail (hard stop)                        |
| `78` | config error (EX_CONFIG)    | nothing attempted — fix config/state and re-run |

The mapping `ok ↔ 0`, `warning ↔ 1`, `error ↔ 2` is encoded in
`src/utils/json-output.ts::statusToExitCode` and applies to every
command that emits a `--json` envelope. Exit code `78` (POSIX `EX_CONFIG`)
signals that the command could not start due to a configuration or pre-flight
error; no changes were attempted.

### `errorClass` field (JSON output)

When a command emits `--json` output, the envelope may include an `errorClass`
field alongside `status`:

| `errorClass`  | Meaning                                       | Typical exit code |
| ------------- | --------------------------------------------- | ----------------- |
| `recoverable` | gh API errors that do not block CI (e.g. 404) | `1`               |
| `fatal`       | gh API errors that halt execution (e.g. 401)  | `2`               |
| `config`      | config or pre-flight error; nothing attempted | `78`              |

The `errorClass` field is omitted on `status: "ok"` responses.

## Commands

### `arbiter init`

Initialize AI governance in a project directory.

```
arbiter init [options]
```

**Options:**

| Flag                 | Type    | Default        | Description                                                                                          |
| -------------------- | ------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| `-y, --yes`          | boolean | `false`        | Skip wizard — use auto-detected defaults                                                             |
| `--tools <list>`     | string  | `claude,codex` | Comma-separated AI tools to configure                                                                |
| `--level <level>`    | string  | `L2`           | Governance level: `L1`, `L2`, or `L3`                                                                |
| `--language <lang>`  | string  | auto-detected  | Override language detection (`typescript\|java\|kotlin\|rust\|python\|go\|multi`)                    |
| `--archetype <type>` | string  | auto-detected  | Override archetype detection (`backend-web-db\|cli\|library\|data-pipeline\|frontend-spa\|embedded`) |
| `--dir <path>`       | string  | `cwd`          | Target directory (default: current directory)                                                        |
| `--dry-run`          | boolean | `false`        | Preview what would be generated without writing files                                                |
| `--no-verify`        | boolean | `false`        | Skip toolchain compatibility probes after generation                                                 |
| `--json`             | boolean | `false`        | Emit machine-readable JSON output (requires `--yes`)                                                 |
| `--quiet`            | boolean | `false`        | Suppress informational banners (e.g. telemetry notice)                                               |
| `--force`            | boolean | `false`        | Override adverse git state check (detached HEAD, rebase, merge, etc.) — emits warning and continues  |
| `--recipe <path>`    | string  | —              | Path or `https://` URL to a recipe JSON file; pre-fills wizard answers                               |
| `--recipe-sha256`    | string  | —              | Expected SHA-256 hex digest of the recipe file — verified before parse                               |
| `-h, --help`         | —       | —              | Show help                                                                                            |

**Examples:**

```bash
# Interactive wizard — recommended for first use
arbiter init

# Non-interactive — CI, scripted setup, testing
arbiter init --yes

# Configure only Claude Code, L1 governance
arbiter init --yes --tools claude --level L1

# Install into a different directory
arbiter init --yes --dir /path/to/my-project

# All tools, audit-grade governance
arbiter init --yes --tools claude,codex,cursor,copilot,gemini,windsurf,aider --level L3

# Preview what would be generated without writing any files
arbiter init --dry-run
arbiter init --yes --dry-run --tools claude --level L2

# Skip toolchain probe (CI or incomplete dev environment)
arbiter init --yes --no-verify
```

**Wizard flows:**

The interactive wizard is state-reactive — it behaves differently based on what already exists in the project:

- **Greenfield** (no existing governance): detect → ask tools/level/github → confirm file list → generate
- **Brownfield** (AGENTS.md, `.claude/`, or `.agents/` detected): detect → show existing governance → ask tools/level/github → show migration plan → confirm → generate

---

## Tool Values (`--tools`)

| Value      | What it generates                                                    |
| ---------- | -------------------------------------------------------------------- |
| `claude`   | `.claude/CLAUDE.md`, `.claude/settings.json`, hooks, rules, commands |
| `codex`    | `.agents/CODEX.md`, `.agents/rules/`, `.agents/plan/`                |
| `cursor`   | `.cursorrules`                                                       |
| `copilot`  | `.github/copilot-instructions.md`                                    |
| `gemini`   | `.gemini/GEMINI.md` (thin pointer to AGENTS.md)                      |
| `windsurf` | `windsurf-instructions.md` (thin pointer to AGENTS.md)               |
| `aider`    | `.aider.conf.yml` (YAML convention mapping + AGENTS.md reference)    |

Multiple tools: `--tools claude,codex,gemini,windsurf,aider`

---

## Governance Levels (`--level`)

| Level | L1 checks                | L2 adds                                     | L3 adds                       |
| ----- | ------------------------ | ------------------------------------------- | ----------------------------- |
| L1    | Format, lint, unit tests | —                                           | —                             |
| L2    | Same as L1               | Integration tests, coverage, security audit | —                             |
| L3    | Same as L1               | Same as L2                                  | E2E tests, evidence artifacts |

**Choosing a level:**

- `L1` — small projects, fast iteration, no CI yet
- `L2` — standard (default) — matches CI, recommended for all active projects
- `L3` — compliance/audit-grade repos that require evidence

---

## Detection

`arbiter init` auto-detects:

| Signal                                | Detected value                    |
| ------------------------------------- | --------------------------------- |
| `package.json` present                | Language: TypeScript              |
| `Cargo.toml` present                  | Language: Rust                    |
| `pom.xml` / `build.gradle`            | Language: Java                    |
| `go.mod` present                      | Language: Go                      |
| `pyproject.toml` / `requirements.txt` | Language: Python                  |
| `src-tauri/` present                  | Framework: tauri                  |
| `vite.config.*` / `next.config.*`     | Framework: vite/next              |
| `pom.xml` spring-boot dep             | Framework: spring-boot            |
| `git remote get-url origin`           | GitHub owner + repo               |
| `gh auth status`                      | GitHub auth + username            |
| `AGENTS.md` exists                    | Will back up on regeneration      |
| `.claude/` exists                     | Will merge (not overwrite)        |
| `.agents/` exists                     | Will merge (not overwrite)        |
| `.ai-rulez/` exists                   | Skip multi-tool config generation |

---

## Conflict Resolution

| File                               | Behavior                                               |
| ---------------------------------- | ------------------------------------------------------ |
| `AGENTS.md`                        | Backed up as `AGENTS.md.arbiter-backup`, then replaced |
| `.claude/CLAUDE.md`                | Backed up, then replaced                               |
| `.agents/CODEX.md`                 | Backed up, then replaced                               |
| `.claude/settings.json`            | Deep merged — custom hooks preserved                   |
| `.claude/hooks/*.mjs`              | **Skipped** if already exists                          |
| `.claude/rules/*.md`               | **Skipped** if already exists                          |
| `.claude/commands/*.md`            | **Skipped** if already exists                          |
| `.agents/rules/*.md`               | **Skipped** if already exists                          |
| `.github/workflows/ci.yml`         | **Skipped** if already exists                          |
| `.github/PULL_REQUEST_TEMPLATE.md` | **Skipped** if already exists                          |
| `.github/ISSUE_TEMPLATE/*`         | **Skipped** per file if already exists                 |
| `.github/dependabot.yml`           | **Skipped** if already exists                          |
| `scripts/check-all.mjs`            | **Skipped** if already exists                          |
| `SECURITY.md`, `.editorconfig`     | **Skipped** if already exists                          |

**Running arbiter init twice is safe** — idempotent by design.

---

## GitHub Setup

When `gh` is authenticated, `arbiter init` also:

1. **Provisions 15 standard labels** via `gh label create/edit`
2. **Applies branch protection to `main`** via `gh api`
3. **Creates a GitHub Project board** with Priority and Size fields

GitHub setup requires `gh` CLI installed and authenticated (`gh auth login`).

---

## JSON Output (`--json`)

All commands support `--json` for machine-readable output.

**Envelope schema:**

```json
{
  "command": "configure",
  "version": "1",
  "status": "ok | warning | error",
  "data": {},
  "errors": ["..."]
}
```

**Exit codes:**

| Code | Status    | Meaning                        |
| ---- | --------- | ------------------------------ |
| 0    | `ok`      | Command completed successfully |
| 1    | `warning` | Completed with warnings        |
| 2    | `error`   | Fatal error                    |

---

## `arbiter verify`

Probe toolchain compatibility for the detected project stack.

```
arbiter verify [options]
```

| Flag           | Type    | Default | Description                                       |
| -------------- | ------- | ------- | ------------------------------------------------- |
| `--dir <path>` | string  | `cwd`   | Target directory to detect the stack from         |
| `--json`       | boolean | `false` | Emit JSON report instead of human-readable output |

---

## `arbiter upgrade-level`

Upgrade the governance level with a bounded grace period for new gates.

```
arbiter upgrade-level [options]
```

| Flag            | Type    | Default | Description                                                        |
| --------------- | ------- | ------- | ------------------------------------------------------------------ |
| `--target <Lx>` | string  | —       | Target governance level: `L2` or `L3` (required unless `--extend`) |
| `--extend`      | boolean | `false` | Extend an existing active grace period by `--days`                 |
| `--days <n>`    | number  | `30`    | Grace period length in days                                        |
| `--dir <path>`  | string  | `cwd`   | Target directory                                                   |
| `--json`        | boolean | `false` | Emit machine-readable JSON output                                  |

---

## `arbiter update`

Re-generate governance files using stored config from `arbiter.json`.

```
arbiter update [options]
```

**Options:**

| Flag           | Type    | Default | Description                                                                                         |
| -------------- | ------- | ------- | --------------------------------------------------------------------------------------------------- |
| `--dir <path>` | string  | `cwd`   | Target directory (default: current directory)                                                       |
| `--github`     | boolean | `false` | Force GitHub setup even if `useGitHub` is false in config                                           |
| `--json`       | boolean | `false` | Emit machine-readable JSON output                                                                   |
| `--force`      | boolean | `false` | Override adverse git state check (detached HEAD, rebase, merge, etc.) — emits warning and continues |
| `-h, --help`   | —       | —       | Show help                                                                                           |

---

## `arbiter configure`

Modify `arbiter.json` settings without re-running the wizard.

```
arbiter configure --set <path>=<value> [--set <path>=<value> ...]
```

---

## `arbiter doctor`

Diagnose and repair arbiter state.

### `arbiter doctor` (health check)

Run environment and project health checks. Exits 0 when all checks PASS or WARN; exits 1 on any FAIL.

```
arbiter doctor [--dir <dir>] [--json]
```

Checks:

| Check             | PASS condition                                           | On FAIL                               |
| ----------------- | -------------------------------------------------------- | ------------------------------------- |
| Node.js version   | >= 22                                                    | Upgrade Node                          |
| git installed     | git found in PATH                                        | Install git                           |
| AGENTS.md present | file exists (only if arbiter.json found)                 | Run `arbiter init`                    |
| git hooks path    | `core.hooksPath` configured (only if arbiter.json found) | `git config core.hooksPath .githooks` |

### `arbiter doctor repair-state`

Re-derive `.arbiter-generated.json` from `arbiter.json` when the snapshot is corrupt or missing.

```
arbiter doctor repair-state [--dir <dir>] [--json]
```

Writes only `.arbiter-generated.json` — `arbiter.json` is never modified.

---

## `arbiter explain`

Show a detailed explanation for an error code, invariant, or CANON rule.

```
arbiter explain <code>           # INV-NN, CANON-NN, or E_CODE
arbiter explain --list           # list all known codes grouped by category
arbiter explain --format json <code>
```

Codes:

| Prefix     | Source                                          |
| ---------- | ----------------------------------------------- |
| `INV-NN`   | Invariant catalog (`src/invariants/catalog.ts`) |
| `CANON-NN` | Process rules (`docs/SYSTEM/CANON.md`)          |
| `E_*`      | Error catalog (`src/utils/error-catalog.ts`)    |

**`--help` output:**

```
Usage: arbiter explain [options] [code]

Show detailed explanation for an error code, INV-NN invariant, or CANON-NN rule

Options:
  --format <format>  Output format: text (default) or json
  --list             List all known codes grouped by category
  -h, --help         display help for command
```

**`--format json` example:**

```bash
arbiter explain --format json INV-01
```

```json
{
  "code": "INV-01",
  "category": "INV",
  "summary": "No circular dependencies between modules",
  "detail": "Circular imports create tight coupling and make modules impossible to test in isolation. Every module must have a clear single direction of dependency. Detected by static analysis in CI.",
  "enforcement": "CI (madge / go vet / cargo check / pylint)",
  "tier": "architectural",
  "alwaysActive": true
}
```

---

## `arbiter diff`

Show what `arbiter update` would change, without writing any files.

```
arbiter diff [options]
```

---

## `arbiter worktree` / `arbiter wt`

Manage git worktrees for parallel task development.

```
arbiter worktree open <task-id> [slug] [options]
arbiter worktree close <task-id> [options]
arbiter worktree list
```

---

## `arbiter plugin`

Manage third-party generator plugins.

```
arbiter plugin add <pkg>
arbiter plugin remove <pkg>
arbiter plugin list
```

---

## `arbiter.json`

Persisted config written by `arbiter init`, read by `arbiter update` and `arbiter diff`.

Commit this file so that `arbiter update` works in CI and for teammates.

---

## File Write Safety

All file writes performed by arbiter use an **atomic rename pattern**: content is written to a
sibling temp file (`<path>.arbiter-tmp-<hex>`) and then renamed into place. This guarantees that
the destination file is either fully written or unchanged — never partially written.

SIGTERM and SIGINT handlers are registered at startup. If the process is interrupted mid-write,
any in-flight temp files are deleted before the signal is re-raised, so no orphan
`.arbiter-tmp-*` files are left behind.

If a write fails with a recognizable OS error, a user-readable message is emitted:

| Error  | Message                                         |
| ------ | ----------------------------------------------- |
| ENOSPC | Disk full — use `df -h` to check space          |
| EACCES | Permission denied — check file ownership        |
| EROFS  | Read-only filesystem — check mount options      |
| EDQUOT | Disk quota exceeded — free space or raise quota |

---

## Experimental Commands

Experimental commands are gated behind the `ARBITER_EXPERIMENTAL` environment variable and carry no stability guarantee. They may change or be removed without a semver bump.

### `arbiter kit` (experimental)

Read-only catalog browser for the cross-stack quality governance dimensions.

**Enable:**

```bash
ARBITER_EXPERIMENTAL='{"kit":true}' arbiter kit list
```

**Subcommands:**

| Subcommand                  | Description                                        |
| --------------------------- | -------------------------------------------------- |
| `kit list`                  | List all 76 governance dimensions                  |
| `kit list --filter=gaps`    | Show only dimensions with coverage gaps            |
| `kit list --format=json`    | Output as JSON array                               |
| `kit list --format=csv`     | Output as RFC 4180 CSV (header + 76 data rows)     |
| `kit list --stack=<lang>`   | Filter to dimensions covered for a specific stack  |
| `kit list --tml=L1\|L2\|L3` | Filter by Test Maturity Level                      |
| `kit show <id>`             | Show full JSON for a single dimension (e.g. `N01`) |
| `kit explain <id>`          | Human-readable summary with per-stack projection   |

---

## Environment Variables

| Variable                | Usage                                                            |
| ----------------------- | ---------------------------------------------------------------- |
| `ARBITER_WORKTREES_DIR` | Overrides `arbiter.json::worktree.base` for worktree placement   |
| `ARBITER_NO_EVIDENCE`   | Set to `1` to disable command logging globally                   |
| `ARBITER_EXPERIMENTAL`  | JSON object enabling experimental features (e.g. `{"kit":true}`) |

---

## Common Workflows

### Greenfield project

```bash
mkdir my-project && cd my-project
git init && npm init -y
arbiter init
git add -A && git commit -m "chore: bootstrap AI governance"
```

### Brownfield project

```bash
cd existing-project
arbiter init --yes --tools claude,codex --level L2
git diff  # review changes
git add -A && git commit -m "chore: add arbiter governance"
```

### Upgrading after arbiter version bump

```bash
npm update -g @arbiter/cli
arbiter diff    # preview what would change
arbiter update  # regenerate canonical files, preserve customizations
```

<!-- BEGIN GENERATED:cli -->

## Command Reference

| Command                  | Description                                                                    |
| ------------------------ | ------------------------------------------------------------------------------ |
| `arbiter agent-rules`    | Export or verify AI agent governance rules (#265)                              |
| `arbiter benchmark`      | Performance benchmarks for arbiter                                             |
| `arbiter blame`          | —                                                                              |
| `arbiter ci`             | Governance-aware CI planning (#261)                                            |
| `arbiter compare`        | —                                                                              |
| `arbiter configure`      | Modify arbiter.json configuration (interactive on TTY, or use --set)           |
| `arbiter diff`           | Show what arbiter update would change (dry run)                                |
| `arbiter doctor`         | Diagnose and repair arbiter state                                              |
| `arbiter experiments`    | Inspect registered experimental features                                       |
| `arbiter explain`        | —                                                                              |
| `arbiter feature-matrix` | Feature/RTM matrix commands (INV-112)                                          |
| `arbiter gauntlet`       | Pairwise/combinatorial test generation (#260)                                  |
| `arbiter graph`          | —                                                                              |
| `arbiter harness`        | Run the four SSOT gates (ssot-core, doc-links, knowledge-map, canonical-paths) |
| `arbiter init`           | —                                                                              |
| `arbiter integrations`   | Inspect agent-tool integrations (skills, plugins) detected for this project    |
| `arbiter kit`            | Cross-stack governance kit commands (requires --experimental.kit)              |
| `arbiter knowledge-map`  | Regenerate KNOWLEDGE_MAP.md line counts from current doc sizes                 |
| `arbiter notary`         | Notary system — track semantic doc changes                                     |
| `arbiter plugin`         | [BETA] Manage arbiter plugins (API not yet stable)                             |
| `arbiter report`         | Bundle a replay run for bug reports                                            |
| `arbiter review`         | Review artefacts (plans, code) against governance invariants                   |
| `arbiter task`           | Manage task lifecycle state                                                    |
| `arbiter trace`          | —                                                                              |
| `arbiter update`         | Re-generate governance files using stored config (arbiter.json)                |
| `arbiter upgrade-level`  | Upgrade governance level with a grace period for new gates                     |
| `arbiter verify`         | Probe toolchain compatibility for the detected stack                           |
| `arbiter work`           | Manage work units via decomposition backend                                    |
| `arbiter worktree`       | Manage git worktrees for parallel task development                             |

## arbiter agent-rules

Export or verify AI agent governance rules (#265).

**Subcommands:**

- `arbiter agent-rules export`
- `arbiter agent-rules verify` — Probe toolchain compatibility for the detected stack

## arbiter benchmark

Performance benchmarks for arbiter.

**Subcommands:**

- `arbiter benchmark hooks`

## arbiter blame

**Options:**

- `--format <fmt>` — Output format: text | json | mermaid | markdown-audit (default: text)
- `--dir <dir>` — Target directory (default: current directory)
- `--input <path>` — Override graph snapshot path (default: &lt;dir&gt;/.arbiter/graph.json)
- `--git-dir <path>` — Git repository directory for log harvesting (default: --dir)
- `--since <duration>` — Informational: time window for violation query (e.g. 90d)

## arbiter ci

Governance-aware CI planning (#261).

**Subcommands:**

- `arbiter ci plan`
- `arbiter ci verify-plan`

## arbiter compare

## arbiter configure

Modify arbiter.json configuration (interactive on TTY, or use --set).

**Options:**

- `--dir <dir>` — Target directory (default: current directory)
- `--set <path=value>` — Set a config path to a value (repeatable)
- `--json` — Emit machine-readable JSON output

## arbiter diff

Show what arbiter update would change (dry run).

**Options:**

- `--dir <dir>` — Target directory (default: current directory)
- `--json` — Emit machine-readable JSON output

## arbiter doctor

Diagnose and repair arbiter state.

**Subcommands:**

- `arbiter doctor repair-state`
- `arbiter doctor recover-lock`

**Options:**

- `--dir <dir>` — Target directory (default: current directory)
- `--json` — Emit machine-readable JSON output
- `--repair` — Auto-release stale .arbiter/.lock files detected by the health check (#824)

## arbiter experiments

Inspect registered experimental features.

**Subcommands:**

- `arbiter experiments list` — List open task worktrees

## arbiter explain

## arbiter feature-matrix

Feature/RTM matrix commands (INV-112).

**Subcommands:**

- `arbiter feature-matrix export`

## arbiter gauntlet

Pairwise/combinatorial test generation (#260).

**Subcommands:**

- `arbiter gauntlet generate` — Generate per-dimension reference docs (requires --experimental.kit)
- `arbiter gauntlet verify` — Probe toolchain compatibility for the detected stack

## arbiter graph

**Subcommands:**

- `arbiter graph build`

**Options:**

- `--dir <dir>` — Target directory (default: current directory)
- `--input <path>` — Override graph snapshot path (default: &lt;dir&gt;/.arbiter/graph.json)
- `--json` — Emit machine-readable JSON output

## arbiter harness

Run the four SSOT gates (ssot-core, doc-links, knowledge-map, canonical-paths).

**Options:**

- `--fast` — Stop at first gate failure
- `--dir <dir>` — Target directory (default: current directory)

## arbiter init

## arbiter integrations

Inspect agent-tool integrations (skills, plugins) detected for this project.

**Subcommands:**

- `arbiter integrations list` — List open task worktrees

## arbiter kit

Cross-stack governance kit commands (requires --experimental.kit).

**Subcommands:**

- `arbiter kit list` — List open task worktrees
- `arbiter kit validate` — Validate kit catalog: schema, parity, and redaction (requires --experimental.kit)
- `arbiter kit generate` — Generate per-dimension reference docs (requires --experimental.kit)
- `arbiter kit install`

## arbiter knowledge-map

Regenerate KNOWLEDGE_MAP.md line counts from current doc sizes.

**Options:**

- `--dir <dir>` — Target directory (default: current directory)

## arbiter notary

Notary system — track semantic doc changes.

**Subcommands:**

- `arbiter notary check` — Validate Notary footer for staged doc changes (fails if footer missing)
- `arbiter notary template` — Print expected Notary footer for staged doc changes

## arbiter plugin

[BETA] Manage arbiter plugins (API not yet stable).

**Subcommands:**

- `arbiter plugin list` — List open task worktrees

## arbiter report

Bundle a replay run for bug reports.

**Options:**

- `--run-id <id>` — Specific run to bundle (default: most recent in ~/.arbiter/logs/)
- `--auto` — Skip editor preview; bundle all files
- `--print-only` — Print manifest path without producing a tarball

## arbiter review

Review artefacts (plans, code) against governance invariants.

**Subcommands:**

- `arbiter review code`
- `arbiter review diff` — Show what arbiter update would change (dry run)

## arbiter task

Manage task lifecycle state.

**Subcommands:**

- `arbiter task resume` — Print recovery instructions for the current task phase
- `arbiter task advance`
- `arbiter task recover` — Print 3-layer recovery context for the current task (#694)
- `arbiter task record-red`
- `arbiter task record-tech-debt`

## arbiter trace

**Options:**

- `--depth <n>` — Maximum BFS depth (default: unlimited)
- `--format <fmt>` — Output format: json | dot | mermaid (default: json)
- `--dir <dir>` — Target directory (default: current directory)
- `--input <path>` — Override graph snapshot path (default: &lt;dir&gt;/.arbiter/graph.json)

## arbiter update

Re-generate governance files using stored config (arbiter.json).

**Options:**

- `--dir <dir>` — Target directory (default: current directory)
- `--github` — Activate live GitHub API calls (opt-in; ARBITER_GITHUB=1 also activates)
- `--json` — Emit machine-readable JSON output
- `--force` — Override adverse git state check (detached HEAD, rebase, etc.)

## arbiter upgrade-level

Upgrade governance level with a grace period for new gates.

**Options:**

- `--target <level>` — Target level (L2, L3, or L4)
- `--extend` — Extend an existing active grace period by --days (default: 30)
- `--days <n>` — Grace period length in days (default: 30)
- `--dir <dir>` — Target directory (default: current directory)
- `--json` — Emit machine-readable JSON output

## arbiter verify

Probe toolchain compatibility for the detected stack.

**Subcommands:**

- `arbiter verify evidence`
- `arbiter verify graph` — Manage the provenance graph (#259)

**Options:**

- `--json` — Emit JSON report
- `--dir <dir>` — Target directory (default: current directory)

## arbiter work

Manage work units via decomposition backend.

**Subcommands:**

- `arbiter work list` — List open task worktrees
- `arbiter work create`

## arbiter worktree

Manage git worktrees for parallel task development.

**Subcommands:**

- `arbiter worktree list` — List open task worktrees
<!-- END GENERATED:cli -->

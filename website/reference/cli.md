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

# Both supported tools, audit-grade governance
arbiter init --yes --tools claude,codex --level L3

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

| Value    | What it generates                                                    |
| -------- | -------------------------------------------------------------------- |
| `claude` | `.claude/CLAUDE.md`, `.claude/settings.json`, hooks, rules, commands |
| `codex`  | `.agents/CODEX.md`, `.agents/rules/`, `.agents/plan/`                |

Both supported tools: `--tools claude,codex`. These two are the whole list — see [ADR-095](https://github.com/LucaDominici/arbiter/blob/main/docs/internal/ADR/095-supported-ai-tools-claude-codex.md) for why the surface is narrow and [ADR-122](https://github.com/LucaDominici/arbiter/blob/main/docs/internal/ADR/122-experimental-tool-generators-retired.md) for the retirement of the five formerly-experimental generators. Any other value fails with `E_INVALID_TOOL`.

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

| File                                 | Behavior                                               |
| ------------------------------------ | ------------------------------------------------------ |
| `AGENTS.md`                          | Backed up as `AGENTS.md.arbiter-backup`, then replaced |
| `.claude/CLAUDE.md`                  | Backed up, then replaced                               |
| `.agents/CODEX.md`                   | Backed up, then replaced                               |
| `.claude/settings.json`              | Deep merged — custom hooks preserved                   |
| `.claude/hooks/*.mjs`                | **Skipped** if already exists                          |
| `.claude/rules/*.md`                 | **Skipped** if already exists                          |
| `.claude/commands/*.md`              | **Skipped** if already exists                          |
| `.agents/rules/*.md`                 | **Skipped** if already exists                          |
| `<project>/.github/workflows/ci.yml` | **Skipped** if already exists                          |
| `.github/PULL_REQUEST_TEMPLATE.md`   | **Skipped** if already exists                          |
| `.github/ISSUE_TEMPLATE/*`           | **Skipped** per file if already exists                 |
| `.github/dependabot.yml`             | **Skipped** if already exists                          |
| `scripts/check-all.mjs`              | **Skipped** if already exists                          |
| `SECURITY.md`, `.editorconfig`       | **Skipped** if already exists                          |

**Running arbiter init twice is safe** — idempotent by design.

---

## GitHub Setup

When `gh` is authenticated, `arbiter init` also:

1. **Provisions 14 standard labels** via `gh label create/edit`
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

## `arbiter check`

Probe toolchain compatibility for the detected project stack. `arbiter check` is kept as an alias.

```
arbiter check [options]
```

| Flag           | Type    | Default | Description                                       |
| -------------- | ------- | ------- | ------------------------------------------------- |
| `--dir <path>` | string  | `cwd`   | Target directory to detect the stack from         |
| `--json`       | boolean | `false` | Emit JSON report instead of human-readable output |

---

## `arbiter configure level`

**Hidden command** — fully functional but omitted from the default `arbiter --help` listing
and not part of the stable public surface; see [Experimental Commands](#experimental-commands)
below. List it from the CLI with `arbiter help --all`.

Upgrade the governance level with a bounded grace period for new gates.

```
arbiter configure level [options]
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

| Flag             | Type     | Default | Description                                                                                         |
| ---------------- | -------- | ------- | --------------------------------------------------------------------------------------------------- |
| `--dir <path>`   | string   | `cwd`   | Target directory (default: current directory)                                                       |
| `--github`       | boolean  | `false` | Force GitHub setup even if `useGitHub` is false in config                                           |
| `--json`         | boolean  | `false` | Emit machine-readable JSON output                                                                   |
| `--force`        | boolean  | `false` | Override adverse git state check (detached HEAD, rebase, merge, etc.) — emits warning and continues |
| `--only <globs>` | string[] | `[]`    | Restrict this run to the managed files matching these globs (comma-separated, repeatable)           |
| `-h, --help`     | —        | —       | Show help                                                                                           |

### Selecting what `update` may touch

By default `arbiter update` re-materializes every file recorded in
`.arbiter-generated-manifest.json`. A project that has since grown its own
hand-authored equivalent for part of that surface can narrow what it accepts, in
two directions — one mechanism, matched the same way in both:

| Mechanism        | Scope                | Honoured by         |
| ---------------- | -------------------- | ------------------- |
| `.arbiterignore` | permanent, committed | `update` and `diff` |
| `--only <globs>` | a single run         | `update`            |

`.arbiterignore` lives at the repo root and uses **gitignore syntax**: one pattern
per line, `#` comments and blank lines skipped, `!` negates, and the **last**
matching pattern decides. Patterns are matched against manifest keys — the
repo-relative POSIX path each generated file is tracked under in
`.arbiter-generated-manifest.json` — so `/AGENTS.md` is anchored to the root,
`docs/` covers everything under `docs`, `AGENTS.md` matches at any depth, and
`*` / `**` behave as usual.

```gitignore
# .arbiterignore — this repo keeps its own CI numbering and docs
.github/workflows/**
docs/
# …but still take the shipped security hooks
!.claude/hooks/check-no-pii.mjs
```

Semantics:

- An ignored file is **never written**. `update` reports it as
  `skipped (.arbiterignore)`; `diff` gives it its own `ignored` status and stops
  counting it as a pending change.
- Its entry **stays in `.arbiter-generated-manifest.json`**, so deleting the
  pattern re-adopts the file on the next `update` — ignoring is reversible, not a
  deletion from arbiter's ownership record.
- `--only` is the inverse allowlist for one invocation, e.g.
  `arbiter update --only .claude/hooks/check-no-pii.mjs,.github/labels.yml`.
  Every other managed file is skipped and keeps its manifest entry. If `--only`
  matches nothing, `update` warns rather than silently doing nothing.
- On conflict, **`.arbiterignore` wins** over `--only` — a committed opt-out
  outranks one run's flag — and the run prints which files that affected.
- Ignoring a safety-class file (`.claude/hooks/*.mjs`) also takes it out of the
  safety-adopt ratchet's view. That is allowed, and `update` says so on stderr.

`arbiter init` does not emit an `.arbiterignore`: the file is the consumer's own,
and a generated copy would be restored after deletion and reported as withheld
after editing. Create it by hand when you need it.

---

## `arbiter configure`

Modify `arbiter.json` settings without re-running the wizard.

```
arbiter configure --set <path>=<value> [--set <path>=<value> ...]
```

---

## `arbiter status health`

Diagnose and repair arbiter state.

### `arbiter status health` (health check)

Run environment and project health checks. Exits 0 when all checks PASS or WARN; exits 1 on any FAIL.

```
arbiter status health [--dir <dir>] [--json]
```

Checks:

| Check             | PASS condition                                           | On FAIL                               |
| ----------------- | -------------------------------------------------------- | ------------------------------------- |
| Node.js version   | >= 22                                                    | Upgrade Node                          |
| git installed     | git found in PATH                                        | Install git                           |
| AGENTS.md present | file exists (only if arbiter.json found)                 | Run `arbiter init`                    |
| git hooks path    | `core.hooksPath` configured (only if arbiter.json found) | `git config core.hooksPath .githooks` |

### `arbiter lifecycle repair-state`

Re-derive `.arbiter-generated.json` from `arbiter.json` when the snapshot is corrupt or missing.

```
arbiter lifecycle repair-state [--dir <dir>] [--json]
```

Writes only `.arbiter-generated.json` — `arbiter.json` is never modified.

### `arbiter check tool-pins`

Compare the locally installed toolchain against the version pins recorded in the target's own
`.github/workflows/*.yml` (download-url, `FOO_VERSION:` env-pin, and `uses: owner/repo@vX.Y.Z`
action-tag shapes). Motivating failure mode: a local tool older than the CI pin still runs and
prints PASSED — worse than a missing tool, because it lies instead of warning.

```
arbiter check tool-pins [--dir <dir>] [--json]
```

- Local version older than the pin → **FAIL**, naming the tool, local version, pin version, and
  `workflow:line`.
- Tool absent, required by a job with no `continue-on-error` → **FAIL**; absent but only required
  by an advisory (`continue-on-error: true`) job → **WARN**.
- Read-only: only ever reads workflow files and runs `<tool> --version`.

This is local-vs-CI parity for an arbitrary target repo — a different axis from
`scripts/check-ci-tool-parity.mjs`, which checks arbiter's own CI-internal manifest/gate/workflow
alignment and is not applicable to a target project.

### `arbiter check fail-open`

Census `command -v <tool> || <fail-open>` presence-gate patterns (brace form, bare `exit 0` form,
and `if ! command -v` guard form) and positive `if command -v <tool>; then ... fi` presence gates
across the target's `scripts/` and `.githooks/`.

```
arbiter check fail-open [--dir <dir>] [--json] [--allowlist <path>]
```

- Findings are listed deterministically as `file:line`.
- Legitimate exceptions go in `.arbiter/fail-open-allowlist.json`
  (`{ "entries": [{ "file", "line", "reason" }] }`); an entry missing `reason` exits **2**.
- Read-only: never writes to the target (the allowlist is hand-authored, not auto-updated).

This censuses a different pattern class than `scripts/check-fail-closed-audit.mjs` (`|| true`,
swallowed `catch {}`, missing `set -euo pipefail`), which is self-scoped to arbiter's own repo.

---

## `arbiter explain`

Show a detailed explanation for an error code, invariant, CANON rule, or wizard flag.

```
arbiter explain <code>           # INV-NN, CANON-NN, E_CODE, or a wizard flag
arbiter explain hasPublicApi     # what answering "yes" to a wizard prompt generates
arbiter explain --list           # list all known codes grouped by category
arbiter explain --format json <code>
```

Codes:

| Prefix / code              | Source                                           |
| -------------------------- | ------------------------------------------------ |
| `INV-NN`                   | Invariant catalog (`src/invariants/catalog.ts`)  |
| `CANON-NN`                 | Process rules (`docs/internal/SYSTEM/CANON.md`)  |
| `E_*`                      | Error catalog (`src/utils/error-catalog.ts`)     |
| `hasPublicApi` etc. (FLAG) | Wizard flag cost map (`src/commands/explain.ts`) |

Wizard flag codes (`hasPublicApi`, `isMultiTenant`, `contractType`) describe the
machinery a "yes" answer generates (ZAP scan, contract suite, deprecation policy,
tenancy isolation), so a solo operator can weigh the cost before opting in. An
unknown code or flag exits with status `1`.

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

## `arbiter update --dry-run`

Show what `arbiter update` would change, without writing any files.

```
arbiter update --dry-run [options]
```

---

## `arbiter worktree`

Manage git worktrees for parallel task development.

```
git worktree add <task-id> [slug] [options]
arbiter worktree prepare <task-id> [path] [options]
git worktree remove <task-id> [options]
arbiter worktree check [--all]
arbiter worktree relink <task-id> [options]
```

---

## Plugins

There is no `plugin` CLI command (removed in the T2 command-surface cut). Third-party generator
plugins are `npm install`-ed by the user and loaded automatically by `arbiter init` / `arbiter update`
from the `plugins` field in `arbiter.json` — see [Plugin API Reference](../../docs/PLUGIN-API.md) for
the full authoring and loading contract.

---

## `arbiter.json`

Persisted config written by `arbiter init`, read by `arbiter update` and `arbiter update --dry-run`.

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

## Feature-Gated Commands

Feature-gated commands are gated behind the `ARBITER_EXPERIMENTAL` environment variable and carry no stability guarantee. They may change or be removed without a semver bump.

There are currently none: the `kit` catalog-browser command surface (list/show/explain — 78 governance
dimensions) was removed in the T2 command-surface cut. `kit` is still registered as an experiment in
`src/experimental/registry.ts`, but the flag is inert — no command reads it anymore. The underlying
`src/kit/` core (thresholds, brownfield detection) survives internally for `gold-audit`, the wizard,
and generators.

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
npm update -g @getarbiter/cli
arbiter update --dry-run    # preview what would change
arbiter update  # regenerate canonical files, preserve customizations
```

<!-- BEGIN GENERATED:cli -->

## Command Reference

| Command             | Description                                                                     |
| ------------------- | ------------------------------------------------------------------------------- |
| `arbiter audit`     | Evaluate release and product evidence                                           |
| `arbiter check`     | List open task worktrees                                                        |
| `arbiter configure` | Modify arbiter.json configuration (interactive on TTY, or use --set)            |
| `arbiter docs`      | Audit and maintain governed documentation                                       |
| `arbiter explain`   | Show detailed explanation for an error code, INV-NN invariant, or CANON-NN rule |
| `arbiter finding`   | Capture, inspect, triage, and promote engineering findings                      |
| `arbiter graph`     | Manage the provenance graph (#259)                                              |
| `arbiter init`      | Initialize AI governance in a project                                           |
| `arbiter lifecycle` | Manage task and recovery lifecycle state                                        |
| `arbiter review`    | Run distinct read-only engineering reviews                                      |
| `arbiter ship`      | Orchestrate an issue → reviewed, merged PR over the existing engine (#1206)     |
| `arbiter status`    | Read-only per-feature methodology report (Config + Emit facets)                 |
| `arbiter update`    | Re-generate governance files using stored config (arbiter.json)                 |
| `arbiter worktree`  | Prepare and inspect native host worktrees                                       |

## arbiter audit

Evaluate release and product evidence.

**Subcommands:**

- `arbiter audit readiness` — Deterministic gold-LEVEL band + missing-items report (#1414, wraps the engine)
- `arbiter audit docs` — Deterministic gold doc-set presence audit (H1, gold-doc-capability: wraps
- `arbiter audit product` — Validate exact-subject product-complete evidence

## arbiter check

List open task worktrees.

**Subcommands:**

- `arbiter check run` — Run a command under the per-repo gate mutex (#1873, ADR-103): every worktree of
- `arbiter check environment` — Probe toolchain compatibility for the detected stack
- `arbiter check evidence` — Verify the .evidence/SUMMARY.json snapshot (SHA + freshness window).
- `arbiter check plan` — Validate a PLAN.json against invariant rules and write REVIEW.json (#253)
- `arbiter check tdd` — Verify TDD red-phase evidence for a task — replayable audit (#553)
- `arbiter check tool-pins` — Compare local tool versions against CI workflow pins (see `check-ci-tool-parity.mjs`
- `arbiter check fail-open` — Census `command -v X || &lt;fail-open&gt;` and positive `if command -v X; then ... fi` gate-script presence-gates (see

**Options:**

- `--all` — Include non-task and detached linked worktrees
- `--json` — Emit machine-readable JSON output

## arbiter configure

Modify arbiter.json configuration (interactive on TTY, or use --set).

**Subcommands:**

- `arbiter configure show` — List every settable arbiter.json path with its current value (#1121)
- `arbiter configure method` — Methodology lens: per-feature Config+Emit wiring status over `configure` (#2039)
- `arbiter configure ignore` — Manage the per-file opt-out (.arbiterignore, #2353/#2662)
- `arbiter configure plugin` — Manage third-party arbiter configure plugins (arbiter.json `plugins[]`)
- `arbiter configure level` — Upgrade governance level with a grace period for new gates

**Options:**

- `--dir <dir>` — Target directory (default: current directory)
- `--set <path=value>` — Set a config path to a value (repeatable)
- `--preset <name>` — Apply a configuration preset: solo-homelab or industrial-grade
- `--json` — Emit machine-readable JSON output

## arbiter docs

Audit and maintain governed documentation.

**Subcommands:**

- `arbiter docs vault` — Sync/validate the Obsidian vault via the repo-owned wiki scripts (#1979)
- `arbiter docs scaffold` — Plan or apply governed documentation skeletons

## arbiter explain

Show detailed explanation for an error code, INV-NN invariant, or CANON-NN rule.

**Options:**

- `--format <format>` — Output format: text (default) or json
- `--list` — List all known codes grouped by category
- `--handoff <topic>` — Scaffold HANDOFF-&lt;TOPIC&gt;.md from the executable-handoff template (#1817 A7)
- `--out <dir>` — Target directory for --handoff (default: cwd)

## arbiter finding

Capture, inspect, triage, and promote engineering findings.

**Subcommands:**

- `arbiter finding add` — Capture an out-of-scope finding to the per-agent JSONL spool (#1401)
- `arbiter finding list` — List deduplicated findings without changing the spool
- `arbiter finding triage` — Classify findings against HEAD without writing or contacting GitHub
- `arbiter finding promote` — Revalidate, deduplicate, and file ready findings as GitHub issues

## arbiter graph

Manage the provenance graph (#259).

**Subcommands:**

- `arbiter graph build` — Build the provenance graph from invariants and write .arbiter/graph.json
- `arbiter graph check` — Verify the provenance graph (#259) — fails on orphan invariants (no enforces / no implements)
- `arbiter graph diff` — Semantic diff between two graph snapshots (#262)

## arbiter init

Initialize AI governance in a project.

**Options:**

- `-y, --yes` — Skip wizard — use auto-detected defaults
- `--tools <tools>` — Comma-separated list of AI tools (claude,codex)
- `--level <level>` — Governance level: L1, L2, L3, or L4
- `--tier <tier>` — Progressive-adoption tier: bootstrap (gentlest Day-1: L1 + brownfield) | L1 | L2 | L3 | L4. Overrides --level.
- `--language <lang>` — Override detected language (typescript|java|kotlin|rust|python|go|multi)
- `--archetype <archetype>` — Override detected archetype (backend-web-db|cli|library|data-pipeline|frontend-spa|embedded)
- `--dir <dir>` — Target directory (default: current directory)
- `--dry-run` — Preview what would be generated without writing files
- `--brownfield` — Auto-capture debt baseline after generation (locks current state as day-0 baseline)
- `--no-verify` — Skip toolchain compatibility probes after generation
- `--accept-beta-tools` — Allow generation of L3 features backed by beta-maturity tools (audit trail written to arbiter.json)
- `--backend <backend>` — Decomposition backend: github or markdown (overrides gh auth detection)
- `--json` — Emit machine-readable JSON output (requires --yes)
- `--quiet` — Suppress informational banners (e.g. telemetry notice)
- `--force` — Override adverse git state check (detached HEAD, rebase, etc.)
- `--preset <preset>` — Apply a meta-preset: industrial-grade (governance + compliance + observability + auth bundle) | solo-homelab (compliance off, governance ≤ L2, mutation off, no prod runbooks)
- `--auth-provider <provider>` — Override auth provider (used with --preset or standalone)
- `--observability-provider <provider>` — Override observability provider (used with --preset or standalone)
- `--deploy-target <target>` — Deploy target: ghcr | azure-container-app | aws-ecs | gcp-cloud-run | none (non-interactive complement to the wizard)
- `--github` — Activate GitHub API calls and set permitGitHub:true in stored config
- `--solo` — Set collaborationMode=trunk-solo (direct-merge, full local gate ≡ CI, CI as verification mirror). Shorthand for ADR-051 trunk-solo mode.
- `--recipe <path>` — Path or https:
  .option(

## arbiter lifecycle

Manage task and recovery lifecycle state.

**Subcommands:**

- `arbiter lifecycle repair-state` — Re-derive .arbiter-generated.json from arbiter.json (snapshot corruption recovery)
- `arbiter lifecycle recover-lock` — Force-release a stale .arbiter/.lock file left by a crashed process
- `arbiter lifecycle clean` — Remove arbiter backup files (_.arbiter-backup, .arbiter-generated.json.bak._)
- `arbiter lifecycle resume` — Print recovery instructions for the current task phase
- `arbiter lifecycle preflight` — Bind the native host to an exact adopted task worktree before lifecycle writes
- `arbiter lifecycle advance` — Advance (or reverse) the task lifecycle phase
- `arbiter lifecycle recover` — Print 3-layer recovery context for the current task (#694)
- `arbiter lifecycle record-red` — Record TDD red-phase evidence: run a failing test and capture evidence (#551)
- `arbiter lifecycle record-debt` — File a tech-debt GitHub issue and persist evidence (#702)
- `arbiter lifecycle start` — Initialise / update one task; multi-issue admission belongs to `arbiter ship` (#1206)
- `arbiter lifecycle get` — Print a single task-state field for shell consumers (#1206)
- `arbiter lifecycle checkpoint` — Pinpoint: snapshot the step-cursor so a mid-task /clear resumes exactly (#1206)

## arbiter review

Run distinct read-only engineering reviews.

**Subcommands:**

- `arbiter review cross-model` — Run the configured Codex review seat against a diff from stdin (#2357)

## arbiter ship

Orchestrate an issue → reviewed, merged PR over the existing engine (#1206).

**Options:**

- `--tier <tier>` — Task tier (XS|S|Standard)
- `--autonomy <level>` — Per-run autonomy override (L0|L1|L2|L3) — beats arbiter.json automation.autonomy (#1291)
- `--set <path=value>` — Per-run override of an overridable config path (repeatable, ADR-094).
- `--advance` — Advance to the next phase (runs that phase gate; fails if red)
- `--chain <id>` — Other issue id admitted to this ship train; requires --affinity and complete qualification
- `--chain-add <id>` — Append an issue to the open train; requires --affinity and complete qualification
- `--seal` — Seal the open train now — land it before starting another (#2331)
- `--affinity <json>` — Complete affinity components required by every multi-issue seed, replacement, or append
- `--outcome <outcome>` — Last attempt result: new-risk|no-progress|timeout|oom|rate-limit|tool-unavailable|ci-queue

## arbiter status

Read-only per-feature methodology report (Config + Emit facets).

**Subcommands:**

- `arbiter status health` — Run arbiter health checks

**Options:**

- `--dir <dir>` — Target directory (default: current directory)
- `--json` — Emit machine-readable JSON output

## arbiter update

Re-generate governance files using stored config (arbiter.json).

**Options:**

- `--dir <dir>` — Target directory (default: current directory)
- `--github` — Activate live GitHub API calls (opt-in; ARBITER_GITHUB=1 also activates)
- `--json` — Emit machine-readable JSON output
- `--dry-run` — Show what update would change without writing
- `--withheld` — With --dry-run, show only fixes withheld from modified files
- `--governance` — With --dry-run, audit governance files for staleness
- `--force` — Override adverse git state check (detached HEAD, rebase, etc.)
- `--adopt` — Force-adopt ALL currently-withheld files (not just safety-class), recording a
- `--no-adopt-safety` — Opt OUT of the default-on safety-class adoption (.claude/hooks/*.mjs). Leaves a
- `--adopt-gate-spine` — Opt IN to force-adopting the gate spine (scripts/check-all.mjs, scripts/lib/*.mjs) over a
- `--adopt-governance` — Opt IN to force-adopting governance files (AGENTS.md, .claude/settings.json) over a user-modified
- `--no-adopt-gate-spine` — DEPRECATED (#2453, removed in 0.8.0): no-op — withholding a customized gate spine is
- `--no-adopt-governance` — DEPRECATED (#2453, removed in 0.8.0): no-op — withholding a diverged governance file is
- `--adopt-plan` — Two-phase preview: print what --adopt/the default safety adoption WOULD change
- `--only <globs>` — Restrict this run to the managed files matching these globs (comma-separated,
- `--refresh-derived` — Force-refresh the codex-track derived file set (.agents/rules/_, .claude/hooks/_

## arbiter worktree

Prepare and inspect native host worktrees.

**Subcommands:**

- `arbiter worktree prepare` — Adopt and prepare an existing native Git worktree without owning its cleanup
- `arbiter worktree check` — List open task worktrees
- `arbiter worktree relink` — Re-materialize configured links for an existing task worktree

<!-- END GENERATED:cli -->

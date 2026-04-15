# Arbiter CLI Reference

## Commands

### `arbiter init`

Initialize AI governance in a project directory.

```
arbiter init [options]
```

**Options:**

| Flag              | Type    | Default        | Description                                           |
| ----------------- | ------- | -------------- | ----------------------------------------------------- |
| `-y, --yes`       | boolean | `false`        | Skip wizard — use auto-detected defaults              |
| `--tools <list>`  | string  | `claude,codex` | Comma-separated AI tools to configure                 |
| `--level <level>` | string  | `L2`           | Governance level: `L1`, `L2`, or `L3`                 |
| `--dir <path>`    | string  | `cwd`          | Target directory (default: current directory)         |
| `--dry-run`       | boolean | `false`        | Preview what would be generated without writing files |
| `--no-verify`     | boolean | `false`        | Skip toolchain compatibility probes after generation  |
| `-h, --help`      | —       | —              | Show help                                             |

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
arbiter init --yes --tools claude,codex,cursor,copilot --level L3

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

The wizard always shows what will happen before touching any files. Cancelling at the confirmation step exits without writing.

---

## Tool Values (`--tools`)

| Value     | What it generates                                                    |
| --------- | -------------------------------------------------------------------- |
| `claude`  | `.claude/CLAUDE.md`, `.claude/settings.json`, hooks, rules, commands |
| `codex`   | `.agents/CODEX.md`, `.agents/rules/`, `.agents/plan/`                |
| `cursor`  | `.cursorrules`                                                       |
| `copilot` | `.github/copilot-instructions.md`                                    |

Multiple tools: `--tools claude,codex`

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
   - Creates missing labels
   - Updates color/description on existing labels
   - Never deletes labels

2. **Applies branch protection to `main`** via `gh api`
   - Required status check: `CI Required`
   - Required review: 1 approving reviewer, dismiss stale
   - No force-push, no deletions

GitHub setup requires:

- `gh` CLI installed (`brew install gh` / `apt install gh`)
- Authenticated: `gh auth login`
- Repo admin access for branch protection (labels work with write access)

If `gh` is unavailable or not authenticated, GitHub setup is skipped with a diagnostic message. All file generation proceeds normally.

---

## `arbiter verify`

Probe toolchain compatibility for the detected project stack. Reads the project directory, detects the language (TypeScript, Java, Rust, Go, or Python), and checks that the installed tool versions fall within Arbiter's supported ranges. Also runs a per-stack build invocation probe to confirm the build toolchain is functional.

`arbiter verify` runs automatically after `arbiter init` unless `--no-verify` is passed.

```
arbiter verify [options]
```

**Options:**

| Flag           | Type    | Default | Description                                       |
| -------------- | ------- | ------- | ------------------------------------------------- |
| `--dir <path>` | string  | `cwd`   | Target directory to detect the stack from         |
| `--json`       | boolean | `false` | Emit JSON report instead of human-readable output |

**Exit codes:**

| Code | Meaning                                                     |
| ---- | ----------------------------------------------------------- |
| 0    | All probes passed or skipped (toolchain not installed)      |
| 1    | One or more probes failed (version outside supported range) |

**Probe states:**

| State     | Meaning                                                              |
| --------- | -------------------------------------------------------------------- |
| `passed`  | Tool installed; version within supported range                       |
| `skipped` | Tool not found on PATH (toolchain not installed — not a fatal error) |
| `failed`  | Tool installed but version is outside the supported range            |

**Build probes:**

After version probes, `arbiter verify` runs a build invocation probe in the target directory to confirm the build toolchain works end-to-end.

| Stack      | Build probe    | Command                    | File guard      |
| ---------- | -------------- | -------------------------- | --------------- |
| TypeScript | `tsc:noEmit`   | `npx tsc --noEmit`         | `tsconfig.json` |
| Java       | `gradlew:help` | `./gradlew help --offline` | `gradlew`       |
| Rust       | `cargo:check`  | `cargo check`              | `Cargo.toml`    |
| Go         | `go:build`     | `go build -n ./...`        | `go.mod`        |
| Python     | `ruff:version` | `ruff --version`           | (always run)    |

Build probes use `kind: "build"` in the JSON report. A missing file guard skips the probe (not a failure).

**Remediation hints:**

When a probe fails, the text output includes an upgrade hint:

```
  [failed] gradle  (version 6.9 outside >=7)
    → Upgrade Gradle wrapper: ./gradlew wrapper --gradle-version=8.x
```

**Example output (text):**

```
arbiter verify — stack: typescript  dir: /projects/my-app

  [passed] node  20.11.1
  [passed] npm  10.2.4

Result: OK
```

```
arbiter verify — stack: java  dir: /projects/my-app

  [passed] java  21.0.1
  [skipped] gradle  (toolchain-missing)
  [failed] mvn  (version 3.6 outside >=3.8)

Result: FAIL
```

**Example output (JSON):**

```bash
arbiter verify --json
```

```json
{
  "dir": "/projects/my-app",
  "stack": "typescript",
  "probes": [
    {
      "tool": "node",
      "status": "passed",
      "version": { "major": 20, "minor": 11, "patch": 1 }
    },
    {
      "tool": "npm",
      "status": "passed",
      "version": { "major": 10, "minor": 2, "patch": 4 }
    }
  ],
  "hasFailures": false
}
```

**Supported version ranges:**

| Stack      | Tool      | Minimum  |
| ---------- | --------- | -------- |
| TypeScript | `node`    | `>=18`   |
| TypeScript | `npm`     | `>=9`    |
| Java       | `java`    | `>=17`   |
| Java       | `gradle`  | `>=7`    |
| Java       | `mvn`     | `>=3.8`  |
| Kotlin     | `java`    | `>=17`   |
| Kotlin     | `kotlin`  | `>=1.9`  |
| Rust       | `rustc`   | `>=1.70` |
| Rust       | `cargo`   | `>=1.70` |
| Go         | `go`      | `>=1.21` |
| Python     | `python3` | `>=3.10` |
| Python     | `pip`     | `>=22`   |
| Python     | `ruff`    | `>=0.4`  |

Ranges are checked at major.minor granularity. Patch version is not enforced.

---

## `arbiter update`

Re-generate governance files using stored config from `arbiter.json`. Run after upgrading arbiter to pick up template improvements.

```
arbiter update [options]
```

**Options:**

| Flag           | Type    | Default | Description                                          |
| -------------- | ------- | ------- | ---------------------------------------------------- |
| `--dir <path>` | string  | `cwd`   | Target directory                                     |
| `--github`     | boolean | `false` | Force GitHub setup even if disabled in stored config |

**Behavior:**

- Reads `arbiter.json` — exits with error if not found (run `arbiter init` first)
- Re-detects language, framework, git info from current directory state
- Regenerates canonical files (AGENTS.md, CLAUDE.md, CODEX.md, .cursorrules, copilot-instructions.md) — backing up existing
- Skips hooks, rules, commands, workflows (customization-safe)
- Re-runs GitHub label provisioning + branch protection
- Saves updated `arbiter.json` with current settings

---

## `arbiter diff`

Show what `arbiter update` would change, without writing any files.

```
arbiter diff [options]
```

**Options:**

| Flag           | Type   | Default | Description      |
| -------------- | ------ | ------- | ---------------- |
| `--dir <path>` | string | `cwd`   | Target directory |

**Output symbols:**

| Symbol | Meaning                            |
| ------ | ---------------------------------- |
| `+`    | New file (would be created)        |
| `~`    | Content differs (would be updated) |
| `=`    | Unchanged (would be skipped)       |

**Example output:**

```
  Arbiter — diff (dry run)

  = AGENTS.md  (unchanged)
  ~ .claude/CLAUDE.md  (would update)
  = .agents/CODEX.md  (unchanged)
  + .cursorrules  (new file)
  = .github/copilot-instructions.md  (unchanged)

  Run `arbiter update` to apply changes.
```

---

## `arbiter worktree` / `arbiter wt`

Manage git worktrees for parallel task development. All subcommands work from the main repository root — never from inside an open worktree.

### `arbiter worktree open <task-id> [slug]`

Create a sibling worktree for a task branch. Safe to call from Claude Code — never spawns GUI terminals.

```
arbiter worktree open <task-id> [slug] [options]
arbiter wt open <task-id> [slug] [options]
```

**Options:**

| Flag              | Type   | Default | Description                         |
| ----------------- | ------ | ------- | ----------------------------------- |
| `--base <branch>` | string | `main`  | Base branch to create the task from |

**Behaviour:**

- Creates `<worktreesBase>/<taskId>[-slug]/` as a sibling of the repo (not nested)
- Creates and checks out branch `task/<taskId>[-slug]`
- Symlinks local-only files listed in `arbiter.json::worktree.links` (default: `.claude/settings.local.json`, `.env`)
- Writes a structured entry to `.arbiter/worktree-open.log.json`
- Prints the worktree path and a ready-to-paste `cd` command

**Refusals:**

- Working tree has staged/modified tracked files
- Running from inside a worktree (`.git` is a file, not a directory)
- Base branch does not exist
- Worktree already open for that task

**Example output:**

```
Worktree ready: /home/luca/work/repos/arbiter.worktrees/#97-my-feature
Branch:         task/#97-my-feature
Base:           main @ 4bacd7d
Links:          1 linked, 0 copied-from-template, 1 missing

Next:           cd '/home/luca/work/repos/arbiter.worktrees/#97-my-feature'
```

---

### `arbiter worktree close <task-id>`

Tear down a task worktree after its branch is merged. Runs a structured sequence of safety checks before removal.

```
arbiter worktree close <task-id> [options]
arbiter wt close <task-id> [options]
```

**Options:**

| Flag            | Type    | Default | Description                                                                                    |
| --------------- | ------- | ------- | ---------------------------------------------------------------------------------------------- |
| `--force`       | boolean | `false` | Close even if branch is unmerged or a hook fails                                               |
| `--keep-branch` | boolean | `false` | Do not delete the task branch after closing                                                    |
| `--no-fetch`    | boolean | `false` | Skip `git fetch origin` before the merge check                                                 |
| `--harvest`     | boolean | `false` | Copy modified/untracked files from worktree back to main repo before closing                   |
| `--harvest-all` | boolean | `false` | Like `--harvest` but auto-confirms all files and skips merge check (implies force for cleanup) |

**Sequence:**

1. Locate the first open-log entry for the task whose worktree directory still exists (skips entries for worktrees that were already closed — important when multiple worktrees share a task id)
2. Verify the worktree directory exists
3. Refuse if the worktree has uncommitted changes (bypassed by `--force`)
4. Refuse if the branch has not been merged into `origin/<base>` (bypassed by `--force`; skipped entirely by `--harvest-all`)
5. Warn about dangling symlinks (never throws)
6. Run `arbiter.json::worktree.closeHook` if configured; non-zero exit aborts (bypassed by `--force`)
7. If `--harvest` or `--harvest-all`: copy modified and untracked files from the worktree back to the main repo. Files that conflict with uncommitted changes in the main repo are skipped (not overwritten). `--harvest-all` auto-confirms all files without prompting.
8. `git worktree remove --force` + `git worktree prune`
9. Delete the task branch (skipped with `--keep-branch`)
10. Append a structured entry to `.arbiter/worktree-close.log.json`

---

### `arbiter worktree list`

List all open task worktrees.

```
arbiter worktree list
arbiter wt list
```

Reads from `git worktree list --porcelain` and filters to branches starting with `task/`. Shows worktrees that were opened but not yet closed.

---

### Worktree config in `arbiter.json`

The optional `worktree` key controls placement and symlink behaviour:

```json
{
  "worktree": {
    "base": null,
    "links": [
      { "path": ".claude/settings.local.json", "required": false },
      { "path": ".env", "template": ".env.example", "required": false },
      { "path": "node_modules", "required": false, "type": "directory" }
    ],
    "closeHook": null
  }
}
```

| Field       | Type           | Default    | Description                                                                    |
| ----------- | -------------- | ---------- | ------------------------------------------------------------------------------ |
| `base`      | `string\|null` | `null`     | Absolute path for worktrees dir. `null` → `<parent>/<repoName>.worktrees`      |
| `links`     | `LinkSpec[]`   | see CLI.md | Files to symlink (or copy from template) into each new worktree                |
| `closeHook` | `string\|null` | `null`     | Path to script invoked before removal. Receives worktree absolute path as `$1` |

**LinkSpec fields:**

| Field      | Type                  | Default     | Description                                               |
| ---------- | --------------------- | ----------- | --------------------------------------------------------- |
| `path`     | string                | —           | Relative path within the repo                             |
| `required` | boolean               | `false`     | If `true`, throws when source is absent                   |
| `template` | string                | —           | Fallback source path if `path` is absent in the main repo |
| `strategy` | `"symlink"\|"copy"`   | `"symlink"` | How to materialise the file in the worktree               |
| `type`     | `"file"\|"directory"` | `"file"`    | Whether `path` is a single file or a directory            |

**Environment variable override:**

Set `ARBITER_WORKTREES_DIR` to override `worktree.base` without editing `arbiter.json`. Useful for test environments.

---

## `arbiter.json`

Persisted config written by `arbiter init`, read by `arbiter update` and `arbiter diff`.

```json
{
  "version": "0.1",
  "tools": ["claude", "codex", "cursor", "copilot"],
  "governanceLevel": "L2",
  "useGitHub": true,
  "worktree": {
    "base": null,
    "links": [
      { "path": ".claude/settings.local.json", "required": false },
      { "path": ".env", "template": ".env.example", "required": false },
      { "path": "node_modules", "required": false, "type": "directory" }
    ],
    "closeHook": null
  }
}
```

Commit this file so that `arbiter update` works in CI and for teammates.

---

## Environment Variables

| Variable                | Source | Usage                                                          |
| ----------------------- | ------ | -------------------------------------------------------------- |
| `PATH`                  | Shell  | Locates `gh`, `git`, `node`, build tools                       |
| `HOME`                  | OS     | Resolves `~` in paths                                          |
| `ARBITER_WORKTREES_DIR` | Shell  | Overrides `arbiter.json::worktree.base` for worktree placement |

---

## Exit Codes

| Code | Meaning                                                                   |
| ---- | ------------------------------------------------------------------------- |
| 0    | Success                                                                   |
| 1    | Fatal error (template not found, permission denied, arbiter.json missing) |

Label provisioning and branch protection errors are non-fatal (logged, not thrown).

---

## Common Workflows

### Greenfield project (new repo, no existing governance)

```bash
mkdir my-project && cd my-project
git init && npm init -y
arbiter init
# Interactive wizard detects TypeScript, asks for tools + level
git add -A && git commit -m "chore: bootstrap AI governance"
```

### Brownfield project (existing repo, adding governance)

```bash
cd existing-project
arbiter init --yes --tools claude,codex --level L2
# Backs up any existing AGENTS.md, merges .claude/settings.json
# Skips files that already exist (hooks, workflows, rules)
git diff  # review changes
git add -A && git commit -m "chore: add arbiter governance"
```

### CI mode (non-interactive, scripted setup)

```bash
arbiter init --yes --tools claude --level L1 --dir /workspace
# No prompts, deterministic output
```

### Upgrading after arbiter version bump

```bash
npm update -g @arbiter/cli
arbiter diff            # preview what would change
arbiter update          # regenerate canonical files, preserve customizations
```

### Adding GitHub setup to an existing arbiter project

```bash
arbiter update --github
# Forces label provisioning + branch protection even if
# useGitHub was false in arbiter.json
```

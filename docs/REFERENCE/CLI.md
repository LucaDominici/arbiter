# Arbiter CLI Reference

## Commands

### `arbiter init`

Initialize AI governance in a project directory.

```
arbiter init [options]
```

**Options:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `-y, --yes` | boolean | `false` | Skip wizard — use auto-detected defaults |
| `--tools <list>` | string | `claude,codex` | Comma-separated AI tools to configure |
| `--level <level>` | string | `L2` | Governance level: `L1`, `L2`, or `L3` |
| `--dir <path>` | string | `cwd` | Target directory (default: current directory) |
| `-h, --help` | — | — | Show help |

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
```

---

## Tool Values (`--tools`)

| Value | What it generates |
|-------|------------------|
| `claude` | `.claude/CLAUDE.md`, `.claude/settings.json`, hooks, rules, commands |
| `codex` | `.agents/CODEX.md`, `.agents/rules/`, `.agents/plan/` |
| `cursor` | `.cursorrules` |
| `copilot` | `.github/copilot-instructions.md` |

Multiple tools: `--tools claude,codex`

---

## Governance Levels (`--level`)

| Level | L1 checks | L2 adds | L3 adds |
|-------|-----------|---------|---------|
| L1 | Format, lint, unit tests | — | — |
| L2 | Same as L1 | Integration tests, coverage, security audit | — |
| L3 | Same as L1 | Same as L2 | E2E tests, evidence artifacts |

**Choosing a level:**
- `L1` — small projects, fast iteration, no CI yet
- `L2` — standard (default) — matches CI, recommended for all active projects
- `L3` — compliance/audit-grade repos that require evidence

---

## Detection

`arbiter init` auto-detects:

| Signal | Detected value |
|--------|---------------|
| `package.json` present | Language: TypeScript |
| `Cargo.toml` present | Language: Rust |
| `pom.xml` / `build.gradle` | Language: Java |
| `go.mod` present | Language: Go |
| `pyproject.toml` / `requirements.txt` | Language: Python |
| `src-tauri/` present | Framework: tauri |
| `vite.config.*` / `next.config.*` | Framework: vite/next |
| `pom.xml` spring-boot dep | Framework: spring-boot |
| `git remote get-url origin` | GitHub owner + repo |
| `gh auth status` | GitHub auth + username |
| `AGENTS.md` exists | Will back up on regeneration |
| `.claude/` exists | Will merge (not overwrite) |
| `.agents/` exists | Will merge (not overwrite) |
| `.ai-rulez/` exists | Skip multi-tool config generation |

---

## Conflict Resolution

| File | Behavior |
|------|----------|
| `AGENTS.md` | Backed up as `AGENTS.md.bak`, then replaced |
| `.claude/CLAUDE.md` | Backed up, then replaced |
| `.agents/CODEX.md` | Backed up, then replaced |
| `.claude/settings.json` | Deep merged — custom hooks preserved |
| `.claude/hooks/*.sh` | **Skipped** if already exists |
| `.claude/rules/*.md` | **Skipped** if already exists |
| `.claude/commands/*.md` | **Skipped** if already exists |
| `.agents/rules/*.md` | **Skipped** if already exists |
| `.github/workflows/ci.yml` | **Skipped** if already exists |
| `.github/PULL_REQUEST_TEMPLATE.md` | **Skipped** if already exists |
| `.github/ISSUE_TEMPLATE/*` | **Skipped** per file if already exists |
| `.github/dependabot.yml` | **Skipped** if already exists |
| `scripts/check-all.sh` | **Skipped** if already exists |
| `SECURITY.md`, `.editorconfig` | **Skipped** if already exists |

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

## `arbiter update`

Re-generate governance files using stored config from `arbiter.json`. Run after upgrading arbiter to pick up template improvements.

```
arbiter update [options]
```

**Options:**

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--dir <path>` | string | `cwd` | Target directory |
| `--github` | boolean | `false` | Force GitHub setup even if disabled in stored config |

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

| Flag | Type | Default | Description |
|------|------|---------|-------------|
| `--dir <path>` | string | `cwd` | Target directory |

**Output symbols:**

| Symbol | Meaning |
|--------|---------|
| `+` | New file (would be created) |
| `~` | Content differs (would be updated) |
| `=` | Unchanged (would be skipped) |

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

## `arbiter.json`

Persisted config written by `arbiter init`, read by `arbiter update` and `arbiter diff`.

```json
{
  "version": "0.1",
  "tools": ["claude", "codex", "cursor", "copilot"],
  "governanceLevel": "L2",
  "useGitHub": true
}
```

Commit this file so that `arbiter update` works in CI and for teammates.

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Fatal error (template not found, permission denied, arbiter.json missing) |

Label provisioning and branch protection errors are non-fatal (logged, not thrown).

# Arbiter CLI Reference

## Exit codes (canonical convention)

All `arbiter` subcommands obey one exit-code convention:

| Code | Meaning            | CI semantics                      |
| ---- | ------------------ | --------------------------------- |
| `0`  | ok                 | must pass                         |
| `1`  | warning / advisory | CI should pass but surface a flag |
| `2`  | error / blocker    | CI must fail (hard stop)          |

The mapping `ok ↔ 0`, `warning ↔ 1`, `error ↔ 2` is encoded in
`src/utils/json-output.ts::statusToExitCode` and applies to every
command that emits a `--json` envelope. Per-command verdict tables below
(e.g. `review plan` PASS/WARN/FAIL) are aliases of this same triple.

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
| `--json`          | boolean | `false`        | Emit machine-readable JSON output (requires `--yes`)  |
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

The wizard always shows what will happen before touching any files. Cancelling at the confirmation step exits without writing.

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
   - Creates missing labels
   - Updates color/description on existing labels
   - Never deletes labels
   - If the initial label-list call fails (network, auth), the error is captured in the result's `errors[]` output with a `"list labels failed: <msg>"` prefix rather than silently proceeding

2. **Applies branch protection to `main`** via `gh api`
   - Required status check: `CI Required`
   - Required review: 1 approving reviewer, dismiss stale
   - No force-push, no deletions

3. **Creates a GitHub Project board** with Priority and Size fields
   - If field-create calls fail (insufficient scope, API limits), failures are captured in `warnings[]` and printed; `created: true` is still returned because the board itself was created successfully

GitHub setup requires:

- `gh` CLI installed (`brew install gh` / `apt install gh`)
- Authenticated: `gh auth login`
- Repo admin access for branch protection (labels work with write access)

If `gh` is unavailable or not authenticated, GitHub setup is skipped with a diagnostic message. All file generation proceeds normally.

---

## JSON Output (`--json`)

All commands support `--json` for machine-readable output. When `--json` is passed:

- All human-readable console output is suppressed
- A single JSON line is written to stdout on completion
- Exit codes map to: `0` = ok, `1` = error, `2` = warning

**Envelope schema:**

```json
{
  "command": "configure",
  "version": "1",
  "status": "ok | warning | error",
  "data": { ... },
  "errors": ["..."]
}
```

Fields:

- `command` — kebab-case command name (e.g. `init`, `configure`, `plugin-add`, `worktree-list`)
- `version` — always `"1"` (schema version)
- `status` — `"ok"` (success), `"warning"` (partial/advisory), or `"error"` (fatal)
- `data` — command-specific output (see per-command schemas below)
- `errors` — present only when `status` is `"error"`; array of error message strings

**Exit codes:**

| Code | Status    | Meaning                        |
| ---- | --------- | ------------------------------ |
| 0    | `ok`      | Command completed successfully |
| 1    | `error`   | Fatal error                    |
| 2    | `warning` | Completed with warnings        |

**Per-command JSON data schemas:**

| Command          | `data` fields                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `init`           | `{ created: number, skipped: number }`                                                                                                     |
| `update`         | `{ created: number, updated: number, skipped: number }`                                                                                    |
| `diff`           | `{ hasChanges: boolean, files: [{key: string, status: "new" \| "changed" \| "unchanged"}] }`                                               |
| `configure`      | `{ updated: string[] }`                                                                                                                    |
| `upgrade-level`  | `{ from: string, to: string, graceEndsAt: string, graceDays: number }` or `{ action: "extend", newEndsAt: string, extensionDays: number }` |
| `plugin-add`     | `{ pkg: string }`                                                                                                                          |
| `plugin-remove`  | `{ pkg: string }`                                                                                                                          |
| `plugin-list`    | `{ plugins: [{pkg: string, status: string}] }`                                                                                             |
| `worktree-open`  | `{ worktreePath: string, branch: string, baseBranch: string, baseRef: string }`                                                            |
| `worktree-close` | `{ worktreePath: string, branch: string, taskId: string }`                                                                                 |
| `worktree-list`  | `{ worktrees: [{path: string, branch: string \| null}] }`                                                                                  |
| `verify`         | see verify section (existing shape; not wrapped in envelope)                                                                               |

**Note on `init --json`:** requires `--yes`. The interactive wizard reads stdin and is incompatible with machine-readable output. Passing `--json` without `--yes` emits an error envelope and exits 1.

**Note on generator failures (`init` / `update`)** (#483): if any generator throws,
the failure is collected, summarised on stdout (`Generator failures (N): ...`),
and the command exits `2` (status `error`). Other generators still run to
completion — partial output is preserved, but the misconfiguration is no longer
silent. In `--json` mode the envelope's `errors[]` field carries the same lines.

**Note on `diff --json`:** `status` is `"warning"` when `hasChanges` is true (there are pending changes). Exit code 2 indicates changes detected.

**Note on `verify`:** the `verify` command already had `--json` before this release and uses a different direct-object format (not the standard envelope). It is unchanged to preserve existing consumers.

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

When `--json` is passed, the report includes an `effectiveConfig` field
holding the fully-resolved post-env-override `arbiter.json` snapshot — see
`Environment overrides` below (#233).

**Exit codes:**

| Code | Meaning                                                     |
| ---- | ----------------------------------------------------------- |
| 0    | All probes passed or skipped (toolchain not installed)      |
| 1    | One or more probes failed (version outside supported range) |

### `arbiter verify evidence`

Validate the `.evidence/SUMMARY.json` snapshot produced by an evidence
run (#238). Each file in `SUMMARY.json.files[]` is classified by
`src/risk/classifier.ts`; the highest-risk level drives gate strictness.

```
arbiter verify evidence [--json] [--dir <path>]
```

| Code | Meaning                                                                               |
| ---- | ------------------------------------------------------------------------------------- |
| 0    | SUMMARY.json present, sha matches, age ≤ 7 days                                       |
| 1    | SUMMARY.json missing / unreadable / unclassified files / stale on low-risk (R3/R4)    |
| 2    | sha mismatch (tampered) OR stale (>7 days) on medium/high-risk (R0/R1/R2) change sets |

Risk gating (highest level across `files[]` wins):

| Risk         | Stale severity                                        |
| ------------ | ----------------------------------------------------- |
| R0 / R1      | exit 2 (blocker)                                      |
| R2           | exit 2 (blocker)                                      |
| R3 / R4      | exit 1 (advisory)                                     |
| UNCLASSIFIED | exit 1 (manual review required — refuse to fail open) |

When `files[]` is absent, risk gating is skipped and stale evidence is
always advisory (exit 1).

The check is skipped only when `E2E_RISK_SKIP` matches the audited
pattern `<category>:#<issue>[:<slug>]` where `<category>` ∈ `flake`,
`infra`, `external` — e.g. `flake:#123`, `infra:#456:db-outage`. One
JSONL entry is appended to `.evidence/skip-log.jsonl` for audit. Any
other value (e.g. `lol`) is refused with a loud stderr warning and the
command falls through to normal verification.

## `arbiter review`

### `arbiter review plan <file>`

Run a Claude subagent over a plan markdown file (#235). Builds an XML
prompt that embeds the plan plus the SHA-256 digest of `AGENTS.md`
(SSOT anchor) and dispatches it via `runCli` (INV-12). The prompt is
persisted under `.evidence/review-<timestamp>/plan-review-prompt.txt`.

```
arbiter review plan <file> [--tier XS|S|Standard] [--json]
```

| Verdict | Meaning                                  | Exit code |
| ------- | ---------------------------------------- | --------- |
| `PASS`  | Plan is implementable as written         | 0         |
| `WARN`  | Fixable gaps; up to 2 revise-cycles      | 1         |
| `FAIL`  | Plan violates an invariant or incoherent | 2         |

### `arbiter review code`

Dispatch N parallel Claude subagents over the current diff (#236). Each
agent has a distinct persona (`bugs`, `type-safety`, `domain-consistency`,
`silent-failure-hunter`, `test-analyzer`); findings are aggregated into
blocker/warning/note buckets. Each agent's response is persisted under
`.evidence/review-<timestamp>/agent-<name>.json` for audit.

```
arbiter review code [--diff <ref>] [--tier XS|S|Standard]
                    [--evidence-dir <path>] [--json]
```

The agent count is tier-driven (`TIER_REVIEWER_COUNT` —
`src/review/tier-constants.ts`):

| Tier     | Reviewer agents |
| -------- | --------------- |
| XS       | 3               |
| S        | 3               |
| Standard | 5               |

Exit codes:

| State               | Exit code |
| ------------------- | --------- |
| No findings (clean) | 0         |
| Warnings only       | 1         |
| Any blocker finding | 2         |

Failures (dispatcher exception, timeout, malformed JSON) surface as a
blocker finding for the affected agent — never silently dropped.

## Environment overrides

`arbiter` honours a thin env-variable override layer applied after
config migration (precedence: **env > file > defaults** — #233):

| Pattern                      | Type    | Example                                  |
| ---------------------------- | ------- | ---------------------------------------- |
| `ARBITER_THRESHOLD__<FIELD>` | number  | `ARBITER_THRESHOLD__LINE_COVERAGE=85`    |
| `ARBITER_FEATURE__<FLAG>`    | boolean | `ARBITER_FEATURE__CONTRACT_TESTING=true` |
| `ARBITER_GOVERNANCE_LEVEL`   | enum    | `ARBITER_GOVERNANCE_LEVEL=L3`            |

Unknown keys, malformed values, and unrelated env vars are silently
ignored — env overrides cannot turn a valid config into an invalid one.

## Task tiers

Task tiers (XS / S / Standard) control plan depth and review-agent count
in the generated `/task` slash-command (#237). Defaults:

| Tier     | planDepth | reviewAgentCount |
| -------- | --------- | ---------------- |
| XS       | minimal   | 3                |
| S        | brief     | 3                |
| Standard | full      | 4                |

Override via `taskTiers` in `arbiter.json`. GitHub-backed projects get
`size:XS`, `size:S` and `size:Standard` labels provisioned at init.

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

## `arbiter upgrade-level`

Upgrade the governance level of a project with a bounded grace period for new gates.

```
arbiter upgrade-level [options]
```

**Options:**

| Flag            | Type    | Default | Description                                                        |
| --------------- | ------- | ------- | ------------------------------------------------------------------ |
| `--target <Lx>` | string  | —       | Target governance level: `L2` or `L3` (required unless `--extend`) |
| `--extend`      | boolean | `false` | Extend an existing active grace period by `--days`                 |
| `--days <n>`    | number  | `30`    | Grace period length in days                                        |
| `--dir <path>`  | string  | `cwd`   | Target directory                                                   |
| `--json`        | boolean | `false` | Emit machine-readable JSON output                                  |

**Behavior:**

1. Validates the target is a promotion (downgrade → exits with actionable error).
2. Runs `node scripts/capture-debt-baseline.mjs --update` to capture a debt snapshot (INV-33: must succeed before grace is persisted).
3. Sets `governanceLevel = target`, `graceFromLevel = previous`, `graceEndsAt = ISO(now + days)` in `arbiter.json`.
4. Regenerates `scripts/check-all.mjs` via `arbiter update`.

During the grace period, new L2 gates print `WARN (grace period)` and exit 0 instead of failing. After expiry, they hard-fail as normal.

**`--extend`:** Bumps an active (non-expired) `graceEndsAt` by `--days` and appends an audit entry to `.arbiter/grace-log.json`.

**Examples:**

```bash
# Upgrade from L1 to L2 with default 30-day grace
arbiter upgrade-level --target=L2

# Upgrade with a custom grace window
arbiter upgrade-level --target=L2 --days=14

# Extend an active grace period by 15 more days
arbiter upgrade-level --extend --days=15

# Inspect grace state
jq '{governanceLevel,graceFromLevel,graceEndsAt}' arbiter.json

# Simulate grace expiry (for testing)
jq '.graceEndsAt = "2000-01-01T00:00:00.000Z"' arbiter.json | sponge arbiter.json
node scripts/check-all.mjs L2   # L2 gates now hard-fail
```

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
| `--json`       | boolean | `false` | Emit machine-readable JSON output                    |

**Behavior:**

- Reads `arbiter.json` — exits with error if not found (run `arbiter init` first)
- Re-detects language, framework, git info from current directory state
- Diffs stored config against the previous snapshot to determine which generators are impacted
- Regenerates only impacted files (selective update); axis or governance changes trigger a full regeneration
- Skips hooks, rules, commands, workflows (customization-safe)
- Re-runs GitHub label provisioning + branch protection
- Saves updated `arbiter.json` and snapshot with current settings

---

## `arbiter configure`

Modify `arbiter.json` settings without re-running the wizard.

```
arbiter configure --set <path>=<value> [--set <path>=<value> ...]
```

**Options:**

| Flag           | Type    | Default | Description                                    |
| -------------- | ------- | ------- | ---------------------------------------------- |
| `--set <kv>`   | string  | —       | `path=value` assignment (repeatable); required |
| `--dir <path>` | string  | `cwd`   | Target directory                               |
| `--json`       | boolean | `false` | Emit machine-readable JSON output              |

**Supported paths:**

| Path                              | Type            | Constraint                                                                      |
| --------------------------------- | --------------- | ------------------------------------------------------------------------------- |
| `features.debtGates`              | boolean         | `true` / `false`                                                                |
| `features.securityScanning`       | boolean         | `true` / `false`                                                                |
| `features.mutationTesting`        | boolean         | `true` / `false`                                                                |
| `features.contractTesting`        | boolean         | `true` / `false`                                                                |
| `features.suppressions`           | boolean         | `true` / `false`                                                                |
| `features.evidenceHarness`        | boolean         | `true` / `false`                                                                |
| `tools`                           | comma-separated | `claude`, `codex`, `cursor`, `copilot`, `gemini`, `windsurf`, `aider`           |
| `governanceLevel`                 | string          | `L1`, `L2`, `L3`                                                                |
| `useGitHub`                       | boolean         | `true` / `false`                                                                |
| `archetype`                       | string          | `backend-web-db`, `cli`, `library`, `data-pipeline`, `frontend-spa`, `embedded` |
| `architectureStyle`               | string          | `hexagonal`, `layered`, `modular-monolith`, `none`                              |
| `isMultiTenant`                   | boolean         | `true` / `false`                                                                |
| `hasDatabase`                     | boolean         | `true` / `false`                                                                |
| `hasPublicApi`                    | boolean         | `true` / `false`                                                                |
| `contractType`                    | string          | `rest-owned`, `rest-public`, `graphql`, `grpc`, `message-queue`, `none`         |
| `thresholds.lineCoverage`         | number          | 1–100                                                                           |
| `thresholds.branchCoverage`       | number          | 1–100                                                                           |
| `thresholds.mutationScore`        | number          | 1–100                                                                           |
| `thresholds.cyclomaticComplexity` | number          | positive                                                                        |
| `thresholds.methodLength`         | number          | positive                                                                        |
| `thresholds.maxParams`            | number          | positive                                                                        |

**Behavior:**

- Parses each `--set` in order; later assignments override earlier ones for the same path
- Validates the resulting config with the full v2 schema before writing
- Exits non-zero without writing if validation fails
- Does not regenerate files — run `arbiter update` after to apply changes to generated outputs

**Examples:**

```bash
# Disable mutation testing
arbiter configure --set features.mutationTesting=false

# Raise line coverage target
arbiter configure --set thresholds.lineCoverage=90

# Multiple changes at once
arbiter configure --set features.debtGates=true --set thresholds.cyclomaticComplexity=10

# Change AI tools
arbiter configure --set tools=claude,cursor

# Then regenerate only the affected files
arbiter update
```

---

## `arbiter diff`

Show what `arbiter update` would change, without writing any files.

```
arbiter diff [options]
```

**Options:**

| Flag           | Type    | Default | Description                       |
| -------------- | ------- | ------- | --------------------------------- |
| `--dir <path>` | string  | `cwd`   | Target directory                  |
| `--json`       | boolean | `false` | Emit machine-readable JSON output |

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

| Flag              | Type    | Default | Description                         |
| ----------------- | ------- | ------- | ----------------------------------- |
| `--base <branch>` | string  | `main`  | Base branch to create the task from |
| `--json`          | boolean | `false` | Emit machine-readable JSON output   |

**Behaviour:**

- Creates `<worktreesBase>/<taskId>[-slug]/` as a sibling of the repo (not nested)
- Creates and checks out branch `task/<taskId>[-slug]`
- Symlinks local-only files listed in `arbiter.json::worktree.links` (default: `.claude/settings.local.json`, `.env`)
- Writes a structured entry to `.arbiter/worktree-open.log.json`
- Prints the worktree path and a ready-to-paste `cd` command
- `--base`: if the named branch does not exist locally, falls back to `origin/<base>` (useful in fresh clones where the branch is only available as a remote-tracking ref)

**Refusals:**

- Working tree has staged/modified tracked files
- Running from inside a worktree (`.git` is a file, not a directory)
- Base branch does not exist (checked as local ref first, then `origin/<base>`)
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
| `--json`        | boolean | `false` | Emit machine-readable JSON output                                                              |

**Sequence:**

1. Locate the first open-log entry for the task whose worktree directory still exists. Stale entries (path no longer on disk) are pruned from the log and reported via stderr. If no live entry is found, the command fails with an informative message.
2. Verify the worktree directory exists
3. Refuse if the worktree has uncommitted changes (bypassed by `--force`)
4. Refuse if the branch has not been merged into `origin/<base>` (bypassed by `--force`; skipped entirely by `--harvest-all`)
   - `--harvest-all` emits a stderr warning: "any un-merged commits will be permanently lost"
   - If `git fetch origin` fails before the merge check, a stderr warning is emitted ("git fetch failed — using cached refs, result may be stale") and the check proceeds with stale remote refs
5. Warn about dangling symlinks (never throws)
6. Run `arbiter.json::worktree.closeHook` if configured; non-zero exit aborts without `--force`; with `--force` the throw is suppressed but a warning is still emitted
7. If `--harvest` or `--harvest-all`: copy modified and untracked files from the worktree back to the main repo. Files that conflict with uncommitted changes in the main repo are skipped (not overwritten). `--harvest-all` auto-confirms all files without prompting.
8. `git worktree remove --force` + `git worktree prune`
9. Delete the task branch (skipped with `--keep-branch`); stderr warning on failure (branch deletion is best-effort)
10. Append a structured entry to `.arbiter/worktree-close.log.json`; `force` field is `true` when `--force` or `--harvest-all` was used

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

## `arbiter plugin`

Manage third-party generator plugins. Plugins are npm packages that extend `arbiter update` with custom file generation without forking arbiter.

> **Security:** Plugins execute Node.js code with arbiter's full privileges. Vet plugins the same way you vet any npm devDependency.

See also: [ADR-031 — Plugin API v1](../ADR/031-plugin-api-v1.md)

### `arbiter plugin add <pkg>`

Register a plugin. Validates the package is resolvable from `node_modules` before persisting.

```
arbiter plugin add <pkg> [options]
arbiter plugin add @company/arbiter-spring-boot
```

**Options:**

| Flag           | Type    | Default | Description                       |
| -------------- | ------- | ------- | --------------------------------- |
| `--dir <path>` | string  | `cwd`   | Target directory                  |
| `--json`       | boolean | `false` | Emit machine-readable JSON output |

**Behavior:**

1. Resolves `<pkg>` from `targetDir/node_modules` — fails with a clear error if not installed.
2. Validates the plugin shape (`name`, `apiVersion: "1"`, `generate`).
3. Appends `<pkg>` to `plugins[]` in `arbiter.json` (idempotent — no-op if already listed).
4. Prints a security advisory.

**Example output:**

```
  Plugin "@company/arbiter-spring-boot" added.

  Advisory: this plugin will execute Node code during `arbiter update`.
  Verify the source before use.
```

---

### `arbiter plugin remove <pkg>`

Remove a plugin from `arbiter.json`. Idempotent — no-op if the package is not listed.

```
arbiter plugin remove <pkg> [options]
```

**Options:**

| Flag           | Type    | Default | Description                       |
| -------------- | ------- | ------- | --------------------------------- |
| `--dir <path>` | string  | `cwd`   | Target directory                  |
| `--json`       | boolean | `false` | Emit machine-readable JSON output |

---

### `arbiter plugin list`

Show configured plugins and their resolution status.

```
arbiter plugin list [options]
```

**Options:**

| Flag           | Type    | Default | Description                       |
| -------------- | ------- | ------- | --------------------------------- |
| `--dir <path>` | string  | `cwd`   | Target directory                  |
| `--json`       | boolean | `false` | Emit machine-readable JSON output |

**Example output:**

```
  Configured plugins:

    @company/arbiter-spring-boot  resolved
    @company/arbiter-rails        not loadable: Cannot find module '@company/arbiter-rails'
```

---

### Plugin authoring

A plugin is an npm package that exports an `ArbiterPlugin` object. Install types from `@arbiter/cli/plugin`:

```js
// index.js
const { join } = require('node:path')

/** @type {import("@arbiter/cli/plugin").ArbiterPlugin} */
module.exports = {
  name: 'my-arbiter-plugin',
  apiVersion: '1',
  templateRoot: join(__dirname, 'templates'),

  detect(config) {
    return config.framework === 'spring-boot'
  },

  generate(ctx) {
    const content = ctx.renderTemplate('Application.java.ejs', {
      projectName: ctx.config.projectName,
    })
    return {
      files: [
        {
          path: join(ctx.targetDir, 'Application.java'),
          content,
          action: 'create',
        },
      ],
    }
  },
}
```

See `examples/plugin-spring-boot/` for a complete reference implementation.

**Plugin contract (`@arbiter/cli/plugin`):**

| Field          | Type                                   | Required | Description                                        |
| -------------- | -------------------------------------- | -------- | -------------------------------------------------- |
| `name`         | `string`                               | yes      | Lowercase, matches `[a-z0-9][a-z0-9-_]*`           |
| `apiVersion`   | `"1"`                                  | yes      | Literal string; binary compat check                |
| `templateRoot` | `string`                               | yes      | Absolute path to the plugin's `templates/` dir     |
| `detect`       | `(config: ArbiterConfig) => boolean`   | no       | Return `false` to skip this plugin for the project |
| `generate`     | `(ctx: PluginContext) => PluginResult` | yes      | Return `{ files: PluginFile[] }` to write          |

**`PluginFile` fields:**

| Field     | Type                                         | Default    | Description                             |
| --------- | -------------------------------------------- | ---------- | --------------------------------------- |
| `path`    | `string`                                     | —          | Absolute path to write                  |
| `content` | `string`                                     | —          | File content                            |
| `action`  | `"create" \| "backup-and-replace" \| "skip"` | `"create"` | Write behavior when file already exists |

**Plugin failure isolation:** a plugin that throws during `generate()` emits a warning and contributes zero files. The overall `arbiter update` continues.

---

## `arbiter.json`

Persisted config written by `arbiter init`, read by `arbiter update` and `arbiter diff`.

```json
{
  "version": "0.2",
  "tools": ["claude", "codex", "cursor", "copilot", "gemini", "windsurf", "aider"],
  "governanceLevel": "L2",
  "useGitHub": true,
  "plugins": ["@company/arbiter-spring-boot"],
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

## Global Flags

These flags apply to every `arbiter` command and are stripped before subcommand
parsing.

| Flag            | Description                                                   |
| --------------- | ------------------------------------------------------------- |
| `--no-evidence` | Skip writing to `.evidence/cmd-log.jsonl` for this invocation |

---

## Evidence Command Log (`.evidence/cmd-log.jsonl`)

Every `arbiter` invocation appends one line to `.evidence/cmd-log.jsonl` in the
working directory. The file uses JSONL format (one JSON object per line).

**Schema:**

| Field        | Type   | Description                                            |
| ------------ | ------ | ------------------------------------------------------ |
| `ts`         | string | ISO-8601 timestamp of the invocation                   |
| `cmd`        | string | First command token (e.g. `init`, `diff`, `--version`) |
| `args`       | array  | Remaining CLI tokens after `cmd`                       |
| `exit`       | number | Process exit code                                      |
| `durationMs` | number | Wall-clock milliseconds for the invocation             |
| `headSha`    | string | Short git SHA at invocation time, or `"unknown"`       |

**Rotation:** When `.evidence/cmd-log.jsonl` exceeds 10 MB, it is renamed to
`cmd-log.jsonl.1` (single backup, no accumulation) and a new file is started.

**Opt-out:** Pass `--no-evidence` to any command, or set `ARBITER_NO_EVIDENCE=1`
in the environment, to suppress logging entirely.

**Storage:** `.evidence/` is gitignored by default. The log is intended for
local audit trails and CI evidence collection — not for committing to the
repository.

---

## Environment Variables

| Variable                | Source | Usage                                                          |
| ----------------------- | ------ | -------------------------------------------------------------- |
| `PATH`                  | Shell  | Locates `gh`, `git`, `node`, build tools                       |
| `HOME`                  | OS     | Resolves `~` in paths                                          |
| `ARBITER_WORKTREES_DIR` | Shell  | Overrides `arbiter.json::worktree.base` for worktree placement |
| `ARBITER_NO_EVIDENCE`   | Shell  | Set to `1` to disable command logging globally                 |

---

## Exit Codes

| Code | Meaning                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------ |
| 0    | Success                                                                                          |
| 1    | Fatal error (template not found, permission denied, arbiter.json missing)                        |
| 2    | Warning — command completed but advisory conditions detected (e.g. `diff` found pending changes) |

Exit code 2 is only emitted when `--json` is used and the JSON status is `"warning"`. In human-readable mode, warnings are printed but the exit code is 0.

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

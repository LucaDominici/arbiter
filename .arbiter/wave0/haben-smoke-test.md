# Wave 0 — Haben smoke test arbiter

> **Chat**: 2026-05-26 · **Stream**: A — Arbiter Product · **DOD source**: `.arbiter/management/MILESTONES.md` §Active 1
> **Subject under test**: arbiter HEAD (`dist/cli.js`, src mtime 2026-05-26 03:49, dist mtime 03:50)
> **Target repo**: `~/work/repos/haben` (branch `task/fix-l1-gate-failures`, already arbiter-governed)
> **Operator**: Claude (manager, per DEC-001) · **Authorization**: Luca explicit — "haben lo puoi seviziare, l'obiettivo è arbiter a prova di audit"

---

## TL;DR

**Verdict: Wave 0 DOD met. Arbiter NOT audit-ready as-is.**

The smoke test surfaced **12 distinct findings** in a single `update` cycle. Two are unscheduled discoveries from the F4 follow-up: F11 reveals **152 orphan project boards** silently accumulated on the operator's GitHub account (only 1 of 153 boards is real user content), and F12 is an unrelated misconfig in the local arbiter clone. The arbiter-the-tool findings range from a remote-side-effect violation to four `L1` gate failures triggered by files arbiter itself just generated. The MILESTONES kill criterion ("if L1 doesn't go green in 2 weeks, escalate to refactor arbiter init") fires on day 1: L1 green after `arbiter update` is **structurally impossible** today without first fixing the template layer.

| DOD point | Status | Note |
|---|---|---|
| `arbiter update --dry-run` produces a coherent diff | ⚠️ Partial | Flag doesn't exist (it's `arbiter diff`). Output IS scoped to governance files, but **massively under-reports** (4 announced vs 37 actually touched). |
| `arbiter update` applied, L1 green | ❌ Applied — L1 RED (4/20 checks fail). | All 4 failures are caused by arbiter's own generated files violating arbiter's own checks. |
| ≥1 INV / issue documented against arbiter | ✅ | 10 findings below, all reproducible from a clean haben checkout. |
| Report in `.arbiter/wave0/haben-smoke-test.md` | ✅ | This document. |

**Kill criterion triggered**: "if L1 doesn't go green in 2 weeks, escalate to refactor arbiter init." Recommendation: this is not a 2-week countdown — it's a known structural gap that must be addressed before any Wave 2 work touches the templates.

---

## Test setup

- **CLI invocation**: `node /home/luca/work/repos/arbiter/dist/cli.js <cmd>` (HEAD build, NOT the `file:../arbiter/arbiter-cli-0.1.0.tgz` tarball haben pins in `package.json`)
- **Haben pre-state**: branch `task/fix-l1-gate-failures`, 4 tracked-file WIP edits (`COSTITUZIONE.md`, `GIMMICKS_2026.md`, `GREENFIELD_PLAN.md`, `README.md`), the rest of arbiter-generated content untracked from a prior `arbiter init` run.
- **Config (`.arbiter-generated.json`)**: archetype `backend-web-db`, hexagonal, governance level **L3**, tools `[claude, codex]`, `useGitHub: true`, `isMultiTenant: true`, lanes `[frontend, backend, docs]`.
- **Method**: dry-run first → shadow-copy diff before touching live → live apply with hard authorization → re-run for idempotence → diff after update → full L1 gate.

---

## Findings

> Numbering follows discovery order, not severity. Severity tag in header. All findings reproducible; logs preserved in scratchpad at `~/.local/share/claude-cowork/sessions/sleepy-ecstatic-faraday/haben-*.txt`.

### F1 — `arbiter diff` under-reports by 89% (SEVERE)

**Observation**: `arbiter diff` (and `arbiter diff --json`) reports **4 files** would change. `arbiter update` immediately after touches **37 files** (11 backed-up + 26 silently-created new).

**Files announced by `diff`**:
```
AGENTS.md, GLOBAL_INVARIANTS.md, .claude/CLAUDE.md, .agents/CODEX.md
```

**Files touched by `update` but invisible to `diff`** (15 backups overwritten / 26 created silently — partial list):
```
.claude/settings.json              (backed up + replaced — config file, missed)
.codex/config.toml                  (backed up + replaced — config file, missed)
docs/METHOD/SSOT_CORE_SET.md        (backed up + replaced)
docs/METHOD/ENGINEERING_DEFAULTS.md (backed up + replaced)
scripts/debt-lib.mjs                (backed up + replaced)
scripts/capture-debt-baseline.mjs   (backed up + replaced)
scripts/debt-report.mjs             (backed up + replaced)
.github/workflows/01-pr-fast.yml          (created silently)
.github/workflows/02-pr-extended.yml      (created silently)
.github/workflows/03-human-approval.yml   (created silently)
.github/workflows/05-release.yml          (created silently)
.github/workflows/06-nightly.yml          (created silently)
.github/workflows/07-weekly.yml           (created silently)
.github/workflows/08-monthly.yml          (created silently)
.github/workflows/09-heartbeat.yml        (created silently)
.github/workflows/_sigstore-retry-sign.yml(created silently)
.github/workflows/_notify.yml             (created silently)
.github/workflows/_label-sync.yml         (created silently)
.github/actions/sign-and-attest/action.yml(created silently)
.github/actions/setup-node-pnpm/action.yml(created silently)
.github/CODEOWNERS                        (created silently)
.github/labels.yml                        (created silently)
scripts/check-inline-suppressions.mjs     (created silently)
scripts/check-suppressions.mjs            (created silently)
scripts/check-stride-traceability.mjs     (created silently)
scripts/check-action-pins.mjs             (created silently)
scripts/check-workflow-perms.mjs          (created silently)
scripts/check-ci-tiers.mjs                (created silently)
scripts/check-test-naming.mjs             (created silently)
scripts/apply-branch-protection.mjs       (created silently)
scripts/pii-scan.mjs                      (created silently)
scripts/ingest-zap-report.mjs             (created silently)
suppressions/suppressions-schema.json     (created silently)
```

**Why this matters**: a governance tool whose dry-run hides 89% of its side effects breaks the trust contract. Operators reading `diff` output decide "safe to apply" based on a 4-line preview; they get a 37-file commit.

**Hypothesis**: `arbiter diff` compares only the top-level SSOT set (the 4 files it identifies as canonical), not the full template manifest. Either the diff scope must match update, or update must read the diff set and refuse to touch anything outside it.

**Repro**: `cd haben && node $ARBITER/dist/cli.js diff` then `… update`, compare outputs.

---

### F2 — Generated Markdown contains broken tables (SEVERE)

**Observation**: regenerated `.claude/CLAUDE.md` contains table rows that **don't close their final `|`**, breaking the table in strict Markdown renderers (and most CommonMark parsers will treat the row as malformed).

**Backup (correct)** — line 32:
```
| `PostToolUse` → Edit\|Write | `check-no-orphan-todo.mjs`  | Block orphan TODOs (INV-21)                   |
```

**Generated (broken)** — line 32:
```
| `PostToolUse` → Edit\|Write | `check-no-orphan-todo.mjs` | Block orphan TODOs (INV-21)
```

Same defect on line 34 (`check-no-any.mjs` row). The Markdown table generator strips trailing pipe; rendered output collapses the affected rows. This is **arbiter shipping malformed Markdown into the very files it controls**.

**Repro**: shadow copy → `node $ARBITER/dist/cli.js update` → `grep -n 'INV-21' .claude/CLAUDE.md` — observe missing trailing pipe.

---

### F3 — Format regressions across all regenerated Markdown (MEDIUM)

Three independent regressions per regenerated MD file:

a) **Padded tables → collapsed tables**. Every table loses its column-width alignment. Example from `AGENTS.md`:
   ```
   BEFORE: | Fact      | Value                                                  |
   AFTER:  | Fact | Value |
   ```
   Padded tables are best-practice in hand-written governance docs (Prettier MD default). Collapsing them is a regression in human readability.

b) **`npm test` → `npm run test`** (in `AGENTS.md`, `.agents/CODEX.md`). Both work, but `npm test` is the idiomatic short form. Templates regressed to the explicit `run` variant.

c) **`GLOBAL_INVARIANTS.md` grows 555 → 713 lines** (+158, +28%). The diff is **entirely blank-line insertions** between sections. No new content — just inflation. Side effect: any diff-based review tool drowns in noise on every regeneration.

d) **`.claude/settings.json` reformats `deny` array** from inline to multi-line on every run. Cosmetic, but compounds with F6 (non-idempotence): every `update` invocation produces a stage-able diff even when nothing semantic changed.

---

### F4 — Remote side effect on live GitHub from a "local update" command (SEVERE)

**Observation**: `arbiter update` issues ~25 `gh` API calls **without warning, without dry-run flag, without confirmation**, including one that **succeeded**:

```
└── Creating project board...
    Project board created: https://github.com/users/LucaDominici/projects/153
```

A command nominally named `update` (described in `--help` as "Re-generate governance files using stored config") materialized a real GitHub project board on the operator's account. `arbiter diff` previously announced zero remote operations — the dry-run scope is local-only, and the user cannot infer remote consequences from it.

The 25 failed `gh label create` calls (HTTP 404 on `LucaDominici/haben`) are correctly returning 404 because **the haben repo was never pushed to GitHub** (verified post-test: `gh repo view LucaDominici/haben` → "Could not resolve to a Repository"). The fail is honest, but the way arbiter swallows it (F9) is the bug.

The project board creation succeeded because `gh project create` is account-scoped (`/users/.../projects`), not repo-scoped — so the repo non-existence didn't gate it.

**Required**: a `--no-github` flag (or `--local-only`, or making `--github` opt-IN rather than opt-OUT), AND `arbiter diff` must enumerate the remote operations it would perform.

### F11 — Account-level project board accumulation: 152 orphan boards (CRITICAL)

**Discovered during F4 cleanup investigation**. Snapshot of LucaDominici GitHub account at 2026-05-26 17:38 UTC (preserved in `.arbiter/wave0/evidence/gh-projects-snapshot.json`):

| Title | Count | Number range | Owner content? |
|---|---|---|---|
| `Viafera Backlog` | 1 | #1 | **75 items — REAL user content** |
| `arbiter Board` | **141** | #2 - #142 | All empty (0 items each) |
| `viafera Board` | **10** | #143 - #152 | All empty |
| `haben Board` | **1** | #153 | Empty — created by today's test |
| **TOTAL** | **153** | #1 - #153 | 152 of 153 are arbiter-generated orphans |

**Mechanism**: arbiter's project-board creation step is idempotent **per-title within current session** (F8 confirms this from today's runs), but not **across project name changes**. Each time a repo gets a new title or arbiter regenerates without name-state, a new board is materialized. 141 `arbiter Board` entries imply at least 141 prior invocations of `arbiter init`/`update` on the arbiter repo itself or sibling projects, before any current "Already exists" check existed.

The current idempotence (F8 saying "Already exists" on second run) was effective only because the test ran in the same session against the same project name in close succession. Long-running accounts that re-`init` or re-`update` accumulate uncapped boards.

**Severity rationale**: this is not a one-time accident. It's a **persistent, account-polluting side effect** that arbiter has been performing **silently for weeks or months**. Most users would never check `gh project list` and would not notice. The cleanup is non-trivial (152 deletes) and lossy (no way to recover if the wrong board is deleted).

**Required fix**:
1. F4's `--no-github` flag (default true after fix) prevents future occurrence
2. arbiter must check for existing same-named board **across the account** before creating, not just probe its own session
3. Project board name must include a stable unique identifier (e.g., repo full path slug + creation date) so multiple repos with same name don't collide

**Bonifica**: cleanup script provided in `.arbiter/wave0/evidence/cleanup-orphan-boards.sh`. Preserves only #1 (`Viafera Backlog`). Operator must execute manually — Claude does not perform destructive remote ops per DEC-005 + general safety policy.

### F12 — arbiter local repo has misconfigured origin (OPERATIONAL — not arbiter bug)

**Observation**: `git remote -v` in `~/work/repos/arbiter` shows:
```
origin https://github.com/LucaDominici/haben.git (fetch)
origin https://github.com/LucaDominici/haben.git (push)
```

This is the haben URL, not the arbiter URL. The actual arbiter repo on GitHub (`LucaDominici/arbiter`, private, last pushed 2026-05-26 11:47) exists but the local clone has the wrong origin.

This is not an arbiter-the-tool bug — it's a misconfiguration of the local clone. But it matters because:
- Any `git push` from this repo would go to haben (which doesn't exist remotely, would fail)
- Any `gh repo` action from this directory infers the wrong project
- If Luca ran `arbiter update` here, the gh calls would target the wrong remote

**Fix**:
```bash
cd ~/work/repos/arbiter
git remote set-url origin https://github.com/LucaDominici/arbiter.git
git fetch origin
```

Listed here because it surfaced during the F4/F11 investigation; not part of the arbiter issue tracker but worth fixing before any Wave 0.5 PR work.

---

### F5 — `dist/cli.js` reports `--version 0.1.0` while haben pins `file:../arbiter/arbiter-cli-0.1.0.tgz` (MEDIUM)

**Observation**: both the live HEAD `dist/cli.js` and the tarball pinned in haben's `package.json` self-identify as `0.1.0`. Tarball is from May 24; HEAD dist is May 26. Two different code bases sharing one version string.

**Why this matters**: anyone reading the smoke-test report would think the test was run against the same `0.1.0` they have on disk. Build provenance must change with content. Suggested: stamp a git SHA or `0.1.0-dev.<sha>` for non-tag builds; CI should fail if `--version` doesn't include a SHA on a non-tag commit.

---

### F6 — `arbiter update` is not idempotent (SEVERE)

**Observation**: second `arbiter update` with no intervening changes re-executes all 37 file operations + all 25 `gh` calls. Output is byte-for-byte identical to first run.

**Implications**:
- CI hooks that "re-run update to confirm clean" produce spurious diffs every time
- Operators cannot tell from `update` output whether anything materially changed
- Files like `.claude/settings.json` (F3d) get re-formatted on every invocation, fighting any in-repo formatter
- Combined with F4: each run is another batch of remote API calls (mitigated only because the project board itself is idempotent — see F8)

A governance tool must converge. `update` should detect "current state matches template-derived state" and short-circuit. Today it doesn't even try.

---

### F7 — `arbiter diff` is inconsistent with `arbiter update`'s scope (SEVERE)

**Observation**: after `arbiter update`, `arbiter diff` reports:
```
= AGENTS.md (unchanged)
= GLOBAL_INVARIANTS.md (unchanged)
= .claude/CLAUDE.md (unchanged)
= .agents/CODEX.md (unchanged)
All files up to date. Nothing to update.
```

But a second `arbiter update` immediately after re-touches **37 files** (F6). Therefore `diff` is **lying in both directions**:
- Before update: "4 files will change" → actually 37 do
- After update: "0 changes needed" → next `update` will still rewrite 33+ files

This isn't just a UX bug — it's a correctness violation of the diff/apply contract. `diff` must enumerate exactly the operations `update` will perform, no more, no less.

---

### F8 — Project-board creation is idempotent, but the failed-label calls are not (MEDIUM)

**Observation**: on second `update`, the project-board step says `Already exists: https://github.com/users/LucaDominici/projects/153` — good. But the 25 `gh label create` calls fire again (and 404 again) on every invocation. arbiter doesn't probe label existence before attempting creation, and doesn't cache the previous failure.

**Why this matters**: every run wastes API quota and produces 25 stderr lines. On a working repo (where labels would succeed first time), every subsequent run would still issue 25 idempotent create calls. Suggested: pre-fetch existing labels (`gh label list --json name`), only create missing ones.

---

### F9 — Exit code 0 despite ~25 errors (SEVERE)

**Observation**: `arbiter update` exits **0** while having printed 25+ `Error: …` lines from failed `gh` calls. A CI wrapper of the form `arbiter update && next-step` is structurally blind to provisioning failures.

```
Error: bug: Command failed (exit 1): gh label create bug -R LucaDominici/haben ...
Error: ci: Command failed (exit 1): gh label create ci -R LucaDominici/haben ...
... (23 more) ...
Skipped (requires admin access): ... gh: Not Found (HTTP 404)
… exit 0
```

This is arguably the worst class of bug: silent failure with success exit. For a tool whose entire value proposition is enforcement, the gate-around-arbiter is broken.

---

### F10 — Generated files violate arbiter's own L1 gate (SMOKING GUN, SEVERE)

**Observation**: post-update `node scripts/check-all.mjs L1` produces **4 FAIL on 20 checks**, and **every single failure is on a file arbiter just generated**:

| Failed check | Cause | Files involved |
|---|---|---|
| `format` (Prettier) | 57 files non-compliant | Includes `GLOBAL_INVARIANTS.md`, `docs/METHOD/SSOT_CORE_SET.md`, `docs/METHOD/ENGINEERING_DEFAULTS.md`, and all `scripts/check-*.mjs` arbiter just wrote |
| `workflow runners` | Missing `${{ vars.CI_BUILD_RUNNER_LABEL \|\| 'docker-ci-build' }}` | A workflow generated by arbiter |
| `action pins (INV-75)` | 9 non-SHA action references | `05-release.yml`, `06-nightly.yml`, `07-weekly.yml` — all freshly generated. Examples: `slsa-framework/slsa-github-generator@v2.1.0`, `docker/setup-buildx-action@v3`, `zaproxy/action-full-scan@v0.10.0` |
| `workflow perms (INV-76)` | Missing top-level `permissions:` | `.github/workflows/_sigstore-retry-sign.yml` — generated by arbiter |

This is the most damning finding. The DOD "L1 green after update" is structurally unreachable today: arbiter's templates do not satisfy arbiter's gates. Every fresh `arbiter init` ships a project that fails its own L1 check before any user code is added.

**Implication for the matrix**: per CANON-02/03 (promoting an archetype to `proven`), the `backend-web-db` × `typescript/express` cell cannot be `proven` while its templates fail L1. This needs a fixture-level test in `__tests__/fixtures/real-projects/` (per INV-32) that asserts post-`update` L1 is green.

---

## Reproduction kit

For anyone wanting to verify these findings independently, with no GitHub side effects:

```bash
# 1. Shadow-copy haben (sandbox the repo)
rsync -a --exclude='node_modules' --exclude='.git' --exclude='dist' \
  ~/work/repos/haben/ /tmp/haben-shadow/

# 2. Verify the diff/update mismatch (F1, F7)
cd /tmp/haben-shadow
node ~/work/repos/arbiter/dist/cli.js diff      # 4 files
node ~/work/repos/arbiter/dist/cli.js diff --json | jq '.data.files | length'  # 4

# 3. To reproduce remote side-effect (F4), DO NOT do this against real GH:
#    Use a sandboxed gh auth or skip. The .arbiter-generated.json sets useGitHub: true.

# 4. Idempotence check (F6)
node ~/work/repos/arbiter/dist/cli.js update    # 37 ops
node ~/work/repos/arbiter/dist/cli.js update    # 37 ops again

# 5. Self-inconsistency (F10)
node scripts/check-all.mjs L1                    # 4 FAIL on freshly generated files
```

Captured logs:
- `~/.local/share/claude-cowork/sessions/sleepy-ecstatic-faraday/haben-diff.txt`
- `~/.local/share/claude-cowork/sessions/sleepy-ecstatic-faraday/haben-diff.json`
- `~/.local/share/claude-cowork/sessions/sleepy-ecstatic-faraday/haben-update-1st.txt`
- `~/.local/share/claude-cowork/sessions/sleepy-ecstatic-faraday/haben-update-2nd.txt`
- `~/.local/share/claude-cowork/sessions/sleepy-ecstatic-faraday/haben-diff-after.txt`
- `~/.local/share/claude-cowork/sessions/sleepy-ecstatic-faraday/haben-l1-gate.txt`

(These are session-scratch and will rotate. Recommended: when Luca commits this report, copy the relevant `.txt` logs to `.arbiter/wave0/evidence/`.)

---

## Recommended candidate issues for arbiter

Priority order (suggested):

| Issue | Title | Severity | Maps to finding |
|---|---|---|---|
| #W0-001 | `arbiter diff` enumerates a 4-file SSOT subset, not the full update scope | P0 | F1, F7 |
| #W0-002 | `arbiter update` performs unannounced remote `gh` writes (creates project boards) | P0 | F4 |
| #W0-003 | Generated MD tables drop trailing pipe — produces malformed Markdown | P0 | F2 |
| #W0-004 | `arbiter update` exit code is 0 despite remote provisioning failures | P0 | F9 |
| #W0-005 | Generated templates fail arbiter's own L1 gate (format/INV-75/INV-76/workflow-runners) | P0 | F10 |
| #W0-006 | `arbiter update` is not idempotent — every run rewrites all 37 files | P1 | F6 |
| #W0-007 | `arbiter update` re-issues all 25 `gh label create` calls without pre-check | P1 | F8 |
| #W0-008 | MD template generator regresses padded tables and inflates `GLOBAL_INVARIANTS.md` by 28% blank-line bloat | P2 | F3 |
| #W0-009 | `--version 0.1.0` collides between tarball (May 24) and HEAD dist (May 26) | P2 | F5 |
| #W0-010 | Add a fixture under `__tests__/fixtures/real-projects/` that asserts L1 green after `arbiter update` (INV-32 binding) | P1 | F10 follow-up |
| #W0-011 | Project boards must namespace by repo full path + creation date; existence check must scan account globally before create | P0 | F11 |
| #W0-012 | (Not an arbiter issue — local clone fix) `git remote set-url origin … /arbiter.git` in `~/work/repos/arbiter` | n/a | F12 |

P0 = blocks credibility / data integrity. P1 = blocks operator trust. P2 = quality of life.

---

## DOD verdict + handoff

- DOD points 1, 3, 4: **met** (with the F1 caveat — diff IS coherent in scope, just under-reporting).
- DOD point 2: **explicitly converted** by Luca's authorization to an audit run instead of a green-light objective. L1 went RED with 4/20 failures, all attributable to arbiter's generated artifacts (F10).
- Kill criterion ("if L1 doesn't go green in 2 weeks, escalate to refactor arbiter init"): **fires now**. The L1 failures are not haben-specific configuration drift; they are template-layer defects. No amount of haben tweaking would make L1 green without changing arbiter.

**Recommended next stream slice** (for MILESTONES.md):
- Promote a "Wave 0.5 — template self-consistency fix" before Active 2 (pipeline drift) advances further. The 5 P0 issues above are the unblock set.
- Once those merge, re-run this smoke test against haben (use this report as the regression target) — every finding has a repro line.

**Haben hygiene**: I left haben on `task/fix-l1-gate-failures` with the `arbiter update` applied. The 4 pre-existing tracked-file edits are untouched. If you want haben clean, `git restore` everything not in your WIP set, or `git clean -fdx -e .git` and re-checkout — none of the arbiter-generated content is committed.

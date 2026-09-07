---
title: 'Hook Contracts — `.claude/hooks/*.mjs`'
doc_version: '1.2.0'
status: active
last_review: '2026-08-22'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/method']
related: []
---

# Hook Contracts — `.claude/hooks/*.mjs`

> **Anti-rot gate:** `scripts/check-hook-contracts.mjs` (L1) diffs this file against the hooks
> directory. Add a row here whenever you add a hook file; remove the row when you delete the file.
> Mismatch → gate failure.
>
> **Loadability gate (#2324):** the same check also _runs_ every `.claude/hooks/*.mjs` and fails
> if any of them cannot load. A hook that crashes on import enforces nothing while still looking
> installed.

---

## Hook check surface matrix (#2326)

There are three distinct hook surfaces, and a check that covers one says **nothing** about the
others. #2324 was a defect present only in arbiter's own materialized copy: every check we had
inspected either the template pair or a generated project, so it survived 18 days. This table
exists so the next gap is visible by reading rather than by breaking.

| Check                                                            | Template pair (`src/templates/claude/hooks/`)                   | Generated project                                                               | Arbiter's own `.claude/hooks/`                                                                                                                           |
| ---------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/check-hook-contracts.mjs`                               | —                                                               | —                                                                               | **loads + documented** (#2324 floor)                                                                                                                     |
| `scripts/check-hardness-inventory.mjs` (default)                 | **declared + observed** (26 hooks, 7 spawned)                   | —                                                                               | —                                                                                                                                                        |
| `scripts/check-hardness-inventory.mjs --hooks-dir .claude/hooks` | —                                                               | —                                                                               | **declared + observed** (30 hooks, 12 spawned) — #2326                                                                                                   |
| `scripts/check-hook-routing.mjs`                                 | —                                                               | **full route** (emitted → dispatcher → settings)                                | ◐ **partial** — on self it falls back to `.arbiter/hooks-manifest.json`, whose entries are template-named, so only the 8 name-matching hooks are checked |
| `scripts/check-self-dogfood.mjs` (`checkRawHooks`)               | **byte-diff vs self copy**, for the 8 `REQUIRED_RAW_HOOKS` only | —                                                                               | same 8 only                                                                                                                                              |
| `scripts/probe-hooks.mjs`                                        | —                                                               | **behavioural**, 4 states × BARE/PRIMED/CLOSE/VERIFICATION (#2135 consumer bar) | — _by decision, see below_                                                                                                                               |
| `__tests__/hooks/empirical/*`                                    | **behavioural**                                                 | —                                                                               | — (fixtures are built from the template pair, so they are self-consistent by construction)                                                               |

**Known uncovered cells, stated rather than implied:**

- Hooks emitted by `src/detectors/language-hooks.ts` (`check-no-any`, `check-no-raw-types`,
  `check-no-mockmvc`) have **no template↔self pairing at all** — `scripts/check-self-dogfood.mjs` walks the
  `.ejs` corpus only. That is why three self copies drifted to a non-blocking exit 1 while their
  generator emitted exit 2. Tracked as a follow-up.
- `scripts/check-hook-routing.mjs`'s partial self coverage (above).
- 20 of arbiter's 30 self hooks are **declared, not observed** — see the ceiling below.

---

## Self-surface hardness contract (#2326)

`.arbiter/self-hooks-manifest.json` is the hardness SSOT for arbiter's **own** materialized hooks,
the sibling of `.arbiter/hooks-manifest.json` (which governs the template surface). Both are
enforced by the same checker under INV-36; the self run is gate-wired as
`hardness inventory (self hooks)` and takes a **measured ~200 ms** (five runs: 196 / 198 / 202 / 207 / 207 ms).

**Why the self run cannot reuse the template model.** Two structural reasons, both measured:

1. **Repo-root scoping.** Arbiter self-hardens its hooks with
   `if (!file.startsWith(process.cwd())) process.exit(0)`, which the shipped templates do not carry.
   The template harness writes fixtures into `os.tmpdir()`, so every such hook exits 0 — the gate
   would report a healthy blocker while the hook is dead.
2. **Own-lib provenance.** `.claude/hooks/lib.mjs` imports
   `scripts/lib/suppressions-shared.mjs` (a two-level relative specifier in the source),
   unresolvable from a staged tmpdir; and a hook staged
   beside a _template-rendered_ lib is not the pair that broke in #2324.

So `selfSurface: true` makes the checker spawn each hook **in place**, with `cwd` at the repo root
and the fixture written inside the repo, under a **pid-scoped** `.arb-hardness-tmp-<pid>/` (gitignored,
removed in a `finally`; pid-scoped so concurrent gates cannot delete each other's fixtures).

Writing into the live repo is a write-then-delete primitive aimed at the working tree, so it is
**guarded, not merely conventional**:

- `fixture.path` must resolve inside the repo AND inside a `.arb-hardness-tmp*` directory (or carry
  a `.arb-hardness-` basename). Anything else — `AGENTS.md`, `../escaped.ts` — **fails the check
  without writing**. A fixture helper truncated `docs/internal/SYSTEM/DECISIONS.md` during
  development of this very check; the guard exists so that cannot recur.
- `path-only` fixtures name an existing protected file (`LICENSE`), write nothing, and their target
  is **hashed before and after** the spawn — a modified target fails the check.
- `expectStderr` pins a verdict to the intended code path. `enforce-read-only` exits 2 fail-closed
  on an _unresolvable_ path (INV-96), so an exit-code-only probe would report PASS if the self lib's
  `resolveToolInputPath` regressed — which is exactly the #2324 shape.
- An `ADVISORY` entry whose source contains `process.exit(2)` fails: otherwise `ADVISORY` is an
  unasserted waiver that quietly removes a live blocker from the gate. The escape hatch is an
  explicit `promotedBy: "ARBITER_*_HARD"`, and that env var must actually appear in the hook source.

**The ceiling, stated as a number.** **10 of 30** hooks are `spawnable: true` and therefore
**observed** to block. The other 20 are **declared only** — they need live task state, a Stop
transcript, git history, or a dispatch payload that a file/env fixture cannot supply, and each
carries that reason in its manifest `rationale`. Two of those twenty are declared-only for a
sharper reason worth naming: `pre-edit-ssot-guard` would **consume the developer's one-shot
`.arbiter/ssot-bypass` token** if driven past its pattern match (a read-only gate check must never
eat user state), and `enforce-gate-before-pr`'s verdict depends on the live `.arbiter/gate-pass.json`
that `scripts/check-all.mjs` itself writes — probing it would make the gate go red because the previous gate
went green. Both need an isolated repo root; tracked as a follow-up. A green self run means: every declared-HARD hook that _can_ be driven
by a fixture does block, and every hook on disk has a declared hardness. It does **not** mean every
hook blocks. Extending the harness to state-bearing fixtures is a tracked follow-up.

**Why `scripts/probe-hooks.mjs` is not the self instrument.** It is the strongest _behavioural_ hook check
in the repo, but it is right for a generated project, where the tree is disposable by construction.
Against arbiter, measured: its `establishState()` does `git add -A` → `git commit` →
`git checkout -B main` and `rmSync('.claude/.task')`, so self-probing requires a synthetic copy —
and a synthetic copy manufactures false greens. `wiki-on-commit` early-exits because `HEAD~1` does
not resolve in a fresh `git init`; `check-circular-deps` and `check-no-unused-exports` are debounced
(20 s window, whole probe ~12 s) so three of four states are no-ops that classify as passes;
`node_modules` must be whole-dir symlinked, re-creating the shared-cache defect #1873 removed;
`.claude/settings.local.json` is an absolute symlink into the main checkout, so the copy is not
sealed; and the copy carries `.env` into `/tmp`. Cost: 4.1 s copy + a 16.0 s median probe, versus
~1.6 s in place. It also carries a private HARD/ADVISORY table that already contradicts ADR-032
(it declares `post-commit-check` HARD where the manifest declares it ADVISORY). It therefore stays
consumer-scoped, and the self surface is covered by the mechanism above instead.

**Known inconsistency, deliberately not resolved here.** `post-commit-check` is ADVISORY in
`.arbiter/hooks-manifest.json` (ADR-032, with a rationale), its template exits 2, and arbiter's
materialized copy exits 1. Those three cannot all be right. Adjudicating needs ADR-032, not a
unilateral flip, so it is filed rather than changed.

---

## Loadability contract (#2324)

Every hook in `.claude/hooks/` MUST load. This is enforced, not assumed.

**How it is checked.** `scripts/check-hook-contracts.mjs` spawns each hook as a child process with `{}` on
stdin and fails when stderr carries a module-resolution signature (`SyntaxError`,
`does not provide an export named`, `Cannot find module`, `ERR_MODULE_NOT_FOUND`,
`ERR_UNSUPPORTED_DIR_IMPORT`).

**Why spawned, never `import()`ed.** These hooks execute on load — `pre-edit-ssot-guard.mjs` calls
`process.exit(0)` at top level, others read stdin and write files. Importing them would terminate
the checker or fire real side effects.

**Why the payload is `{}`.** ESM resolution happens before any user code runs, so a broken import
surfaces regardless of payload — while an empty one makes every hook bail at its first field check
instead of doing real work.

**What is NOT a failure.** Exit 0 (allow) and exit 2 (block) are both healthy verdicts. Only a
load failure fails the gate.

**Why this exists.** `pre-edit-ssot-guard.mjs` imported `isPathInThisRepo` from a
`.claude/hooks/lib.mjs` that never exported it, and crashed on every `Edit`/`Write` for 18 days.
Two blind spots hid it, and both are structural rather than accidental:

1. `.claude/hooks/lib.mjs` carries a **whole-file divergence pin** in `.dogfood-divergences.json`.
   Re-pinning the hash on each change absorbs any drift, including a missing export.
2. `__tests__/hooks/empirical/ssot-guard.test.ts` builds its fixture from the **template pair**
   (template hook + rendered template lib), so it is self-consistent by construction and can never
   observe self-pair drift. `scripts/probe-hooks.mjs` does execute hooks, but takes `--root <repo>`
   and is aimed at _generated_ projects.

**Testing contract.** The loadability tests are mutation-flip shaped: `scripts/check-hook-contracts.mjs`
takes `--root <dir>` so the same fixture tree is asserted green, then one planted defect must flip
it red. A gate never observed to flip proves nothing.

**Corollary for `.claude/hooks/lib.mjs`.** Its approved divergence from the template is exactly one
thing — `findInlineSuppression` delegates to `scripts/lib/suppressions-shared.mjs` instead of the
template's inlined parser. Before re-pinning that entry, diff the **export surface** against the
rendered template; a subset is a bug, not a divergence.

Generated from audit #615. Last updated: 2026-05-17.

---

## Scope and threat model (#2022)

Issue #2022 investigated why settings-hook guards were silent for delegated Agent-tool sessions.

**Q1 — Do `.claude/settings.json` PreToolUse hooks apply to subagent Bash calls?** Observed:
no. Two independent data points show both event classes are silent: `enforce-gate-before-pr.mjs`
did not intercept real subagent `gh pr create` calls, and `wiki-on-commit.mjs` did not run after a
subagent `git commit`.

**Q2 — Is hook resolution cwd- or worktree-sensitive?** Not the operative cause observed here.
The same hook chain is silent for both events, while the pre-PR hook blocks correctly when driven
directly with its crafted stdin payload. The distinguishing observation is the delegated session,
not its cwd; no unobserved harness-internal resolution claim is made.

**Verification (AC-2022.1, re-checked 2026-08-03):** the measured answers above still hold. No
harness-level fix exists or is expected — the harness is a closed-source external binary, and the
delegated session is the factor, not the checkout cwd. Evidence: run #2000 canary report (issue
#2000 thread, PR #2021 bypass-test) — two real subagent `gh pr create` Bash invocations in a
dedicated worktree were not intercepted by the PreToolUse chain, while the same hook exits 2 when
driven directly with its crafted stdin payload (verified twice in run #2000: A1a audit + canary).

**Q3 — What is the threat model when delegated sessions are structurally un-hooked?** The
following boundary statement applies.

- The **ENFORCED** boundary is CI plus branch protection: `gate` and `gate-full` in
  `.github/workflows/01-pr-fast.yml`, with `gate-full` running
  `node scripts/check-all.mjs L2 --json gate-result.json` as the required `CI Required` status
  check — the backstop that kept PR #2021 unmergeable despite the silent subagent.
- Local `.claude/settings.json` PreToolUse and PostToolUse hooks are defence-in-depth. They are
  advisory for delegated sessions because the harness does not run that hook chain there.
- Git hooks are distinct: `git config core.hooksPath .githooks` makes them git-level hooks, which
  do fire for delegated-session `git commit` and `git push` commands (`.githooks/pre-push` runs
  the L2 gate and exits 1 on failure). They are the local control that survives delegation.
- Bot-authored PRs are additionally gated by the AI-PR gate (INV-91): `_ai-draft-check.yml`
  fails CI (`core.setFailed`) for a bot-authored PR that lacks the `approved-by-human` label.
- The #2054 Bash-channel pattern guard in `stop-dangerous.mjs` uses this same settings-hook chain
  and inherits the delegated-session limitation.
- Therefore, no Arbiter enforcement claim may rest on a `.claude/settings.json` hook alone.

**Enforcement verification (AC-2022.2/3, 2026-08-03):** all three compensating controls are wired
and fail-closed, verified on this tree — `core.hooksPath=.githooks` (`commit-msg`/`pre-commit`/
`pre-push` present, pre-push runs L2 and exits 1), `_ai-draft-check.yml` INV-91 fails closed for
bot-authored PRs, and branch protection requires `CI Required` (gate-full L2). Residual gap:
nothing local prevents a delegated session from running `gh pr create` without gate-pass.json —
only the CI boundary closes it. Tracked as follow-up issue #2233 (enforcement surface: a
per-session PreToolUse hook contract, or moving the PR-create guard into the git pre-push chain).

---

## Concurrency Classes

| Class         | Meaning                                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SAFE**      | Pure reads, stdout-inject, or append-only writes. Safe to run concurrently with any other hook.                                                       |
| **SERIALIZE** | Read-modify-write to shared state. Must be the sole writer to its path during execution. Avoid new SERIALIZE hooks — redesign to append-only instead. |
| **EXCLUSIVE** | Holds a lock or modifies git index. Cannot run concurrently with other hooks touching the same resource.                                              |

---

## Registered Hooks

Hooks wired in `.claude/settings.json`.

| Hook                            | Event              | Trigger      | I/O                          | Shared Paths                                                                                | Concurrency Class                                                                                 |
| ------------------------------- | ------------------ | ------------ | ---------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `stop-dangerous.mjs`            | PreToolUse         | Bash         | read                         | —                                                                                           | SAFE                                                                                              |
| `enforce-read-only.mjs`         | PreToolUse         | Edit\|Write  | read                         | —                                                                                           | SAFE                                                                                              |
| `pre-edit-load-memory.mjs`      | PreToolUse         | Edit\|Write  | read, stdout-inject          | `.claude/memory-impl.md`                                                                    | SAFE                                                                                              |
| `pre-edit-ssot-guard.mjs`       | PreToolUse         | Edit\|Write  | read, stdout-inject          | —                                                                                           | SAFE                                                                                              |
| `pre-edit-plan-anchor.mjs`      | PreToolUse         | Edit\|Write  | read, stdout-inject          | `.claude/.task-*`, `.claude/plans/`                                                         | SAFE                                                                                              |
| `post-commit-check.mjs`         | PostToolUse        | Bash         | read (git log)               | —                                                                                           | SAFE                                                                                              |
| `wiki-on-commit.mjs`            | PostToolUse        | Bash         | run (gen-wiki.mjs)           | Incremental wiki regen for changed docs                                                     | SAFE                                                                                              |
| `check-no-direct-spawn.mjs`     | PostToolUse        | Edit\|Write  | read                         | —                                                                                           | SAFE                                                                                              |
| `check-no-orphan-todo.mjs`      | PostToolUse        | Edit\|Write  | read                         | —                                                                                           | SAFE                                                                                              |
| `check-no-placeholders.mjs`     | PostToolUse        | Edit\|Write  | read                         | —                                                                                           | SAFE                                                                                              |
| `check-no-pii.mjs`              | PostToolUse        | Edit\|Write  | read                         | —                                                                                           | SAFE                                                                                              |
| `check-no-unused-exports.mjs`   | PostToolUse        | Edit\|Write  | read (knip)                  | —                                                                                           | SAFE                                                                                              |
| `check-no-any.mjs`              | PostToolUse        | Edit\|Write  | read                         | —                                                                                           | SAFE                                                                                              |
| `post-edit-artifact-schema.mjs` | PostToolUse        | Edit\|Write  | read                         | `docs/internal/SYSTEM/ID-REGISTRY.md`, `.arbiter/evidence/agent-returns/`                   | SAFE (INV-142; exit 2 on a schema violation, fails OPEN if its validator or schema is unloadable) |
| `check-circular-deps.mjs`       | PostToolUse        | Edit\|Write  | read (madge)                 | —                                                                                           | SAFE                                                                                              |
| `post-edit-dispatch.mjs`        | PostToolUse        | Edit\|Write  | read, append-write           | `.claude/hooks/logs/hook-events.log`                                                        | SAFE                                                                                              |
| `post-brainstorm-stop.mjs`      | UserPromptSubmit   | \*           | read, delete                 | `.arbiter/brainstorm-active`                                                                | SAFE                                                                                              |
| `skill-forced-eval.mjs`         | UserPromptSubmit   | \*           | read, stderr-block           | `.claude/.task/status.json`, transcript                                                     | SAFE (#2383; exit 2 after edit without successful Skill(tdd))                                     |
| `guard-task-completion.mjs`     | UserPromptSubmit   | \*           | read                         | `.claude/.task-*`                                                                           | SAFE                                                                                              |
| `guard-done-evidence.mjs`       | UserPromptSubmit   | \*           | read                         | `.claude/.task/status.json`, `arbiter.json`, `.claude/.last-done-evidence.json`, pinned src | SAFE (#1872, flag-gated)                                                                          |
| `stop-evidence-guard.mjs`       | Stop               | \*           | read (transcript, git)       | `.arbiter/evidence/*`, `.claude/.task/`                                                     | SAFE                                                                                              |
| `closer-mode-guard.mjs`         | PreToolUse         | Bash         | read (task state, git)       | `.claude/.task/`                                                                            | SAFE                                                                                              |
| `debug-state-on-failure.mjs`    | PostToolUseFailure | Bash         | create-or-append-write       | `.evidence/<task>/DEBUG_STATE.md`                                                           | SAFE                                                                                              |
| `exitplanmode-banner.mjs`       | PostToolUse        | ExitPlanMode | read, stdout-inject          | `.claude/.task/status.json`                                                                 | SAFE                                                                                              |
| `pre-compact.mjs`               | PreCompact         | \*           | read, stdout-inject          | `.claude/.task-*`                                                                           | SAFE                                                                                              |
| `pre-spawn-worktree-guard.mjs`  | PreToolUse         | Task\|Agent  | read, create-or-append-write | `.arbiter/agents-active.json`, `.claude/agents/agent-write-classes.json`                    | SAFE                                                                                              |
| `post-subagent-release.mjs`     | SubagentStop       | \*           | read, overwrite-write        | `.arbiter/agents-active.json`                                                               | SAFE (#2403; cleanup companion to pre-spawn-worktree-guard.mjs; always exits 0)                   |
| `enforce-gate-before-pr.mjs`    | PreToolUse         | Bash         | read (gate marker, git)      | `.arbiter/gate/`                                                                            | SAFE                                                                                              |
| `stop-finding-loss.mjs`         | Stop               | \*           | read (transcript)            | `.arbiter/findings/*`, `.arbiter/evidence/agent-returns/*`                                  | SAFE (E6b #1948; advisory, hard via ARBITER_FINDING_LOSS_HARD=1; activated per OD-14 2026-07-17)  |

---

## Utility Modules

Shared helpers imported by hooks. Not registered as hooks themselves.

| File      | Purpose                                                                                                           | Shared Paths                                       | Concurrency Class |
| --------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ----------------- |
| `lib.mjs` | Shared utilities: `readTaskState`, `getRepoRoot`, `logInfo/Warn/Error`, `findInlineSuppression`, `sanitizeTaskId` | `.claude/hooks/logs/hook-events.log` (append-only) | SAFE              |

---

## Unregistered Hook Files

Present in `.claude/hooks/` but not wired in `settings.json`. Document reason for non-registration.

> Corrected #2326: `check-no-skipped-tests.mjs` was listed here but IS wired in
> `.claude/settings.json`. Row removed.

| Hook                     | Reason Not Registered                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check-no-mockmvc.mjs`   | PostToolUse Java guard (INV-29): blocks MockMvc imports; only applies to Java files. Not registered in arbiter self-config (no Java sources here). |
| `check-no-raw-types.mjs` | PostToolUse Java guard: blocks unparameterized generic types in Java files. Not registered in arbiter self-config (no Java sources here).          |
| `hooks.mjs`              | Arbiter-generated hook dispatcher for target projects. Present here as dogfood; not registered as Claude Code hook in arbiter's own settings.json. |

---

## Invariants

1. **No SERIALIZE hooks.** If you find yourself writing a hook that reads then rewrites a file, use `openSync('wx')` for the first write and `appendFileSync` for subsequent writes instead.
2. **Shared log writes are append-only.** `lib.mjs` `logInfo/logWarn/logError` use `appendFileSync` → POSIX atomic for entries < 4KB (PIPE_BUF).
3. **debug-state-on-failure is SAFE.** Uses `openSync('wx')` (O_CREAT|O_EXCL) for header creation — concurrent first-creates fail silently on EEXIST and fall through to `appendFileSync`. Each attempt entry is a single `appendFileSync` call (< 4KB).
4. **Hooks must not acquire file locks.** If a hook needs exclusive access, redesign using atomic primitives above. `src/utils/file-lock.ts` is for CLI commands, not hooks.

---

## Shipped-hook dogfood corpus (#1090)

Eight hooks are emitted **verbatim** to target projects by `src/generators/claude.ts`
(`readTemplate` → `writeFile`, no EJS render): `stop-dangerous`, `enforce-read-only`,
`pre-edit-ssot-guard`, `enforce-gate-before-pr`, `check-no-unused-exports`,
`check-no-skipped-tests`, `post-brainstorm-stop`, `pre-spawn-worktree-guard`.
(Corrected #2326: this list previously named `check-no-orphan-todo` and `check-no-placeholders`,
which are **not** in `REQUIRED_RAW_HOOKS` — see `scripts/check-self-dogfood.mjs:67-76`. A surface
doc that misstates its own corpus is the failure this file exists to prevent.) `scripts/check-self-dogfood.mjs`
(`checkRawHooks`, exported as `REQUIRED_RAW_HOOKS`) diffs each shipped template against arbiter's
materialized `.claude/hooks/` copy and **fails closed** on undocumented drift — closing the INV-45
gap where the corpus walk collected only `.ejs`, so a shipped hook could silently weaken.

Arbiter intentionally self-hardens four of these beyond the shipped template (repo-root scoping,
`lib.mjs` inline-suppression, and dropping `AGENTS.md` from `enforce-read-only`'s read-only set
because arbiter _authors_ its own `AGENTS.md` whereas a target's is generated and must stay locked).
Each divergence carries a dated rationale in `.dogfood-divergences.json` and is deliberately **not**
back-ported: back-porting the repo-root bypass was empirically shown to break the INV-36 HARD-hook
contract.

`pre-edit-ssot-guard`'s divergence healed this way (#2045): its guarded-path list moved from a
hardcoded array to a runtime read of `arbiter.json` `governance.ssotGuardPatterns` (additive over
the shipped template's `DEFAULT_SSOT_PATTERNS`), so the template and the materialized copy are now
byte-identical code — arbiter's own `docs/internal/...` paths live in `arbiter.json`, not in the
hook source. Its `.dogfood-divergences.json` entry was removed accordingly. The same commit added a
one-shot file bypass at `.arbiter/ssot-bypass` (single-line reason, consumed on the next
guarded-file attempt regardless of outcome) alongside the existing `ARBITER_SSOT_BYPASS=1` env var —
both now log a `BYPASS` event to `.arbiter/evidence/bypass-log.jsonl`, parity with
`pre-edit-plan-anchor`'s `ARBITER_PLAN_BYPASS` accounting (#1949).

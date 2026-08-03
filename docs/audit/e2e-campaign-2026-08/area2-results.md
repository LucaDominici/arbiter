---
title: 'E2E campaign — area 2 results (config lifecycle) — arbiter'
doc_version: '1.0.0'
status: active
last_review: '2026-08-03'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/audit']
related: []
---

# AREA 2 — Config lifecycle, drift & regeneration — E2E results

Binary: `node /home/luca/work/repos/arbiter/dist/cli.js` (v0.5.0)
Targets (disposable, real git repos):

- `T = /tmp/rtm-a2-8lAU` — `init -y --level L2`, then a **project-wired custom check**
  (`RTM-A2-CUSTOM-CHECK`, 2 lines) added to `scripts/check-all.mjs` and committed.
- `T2 = /tmp/rtm-a2b-JGNh` — pristine L2 → `upgrade-level --target L3`.
- `T3 = /tmp/rtm-a2c-TTV5` — pristine L1 → `upgrade-level --target L2` (control).
- `T4 = /tmp/rtm-a2d-sohp` — pristine `init -y --level L4`, used to quantify F1's downgrade.

Arbiter repo untouched: every mutating call passed an explicit `--dir <target>`; verified with
`git -C /home/luca/work/repos/arbiter status --porcelain` → **empty** at end of pass. (The
session-start snapshot listed `?? arbiter.worktrees/`; that directory is absent now and was not
touched by this pass — flagging it only so the campaign does not attribute the delta here.)
"Writes nothing" is asserted as: no tracked-file hash change (`git ls-files -z | xargs -0 sha256sum`
set-diff) **and** empty `git status --porcelain`.

---

## Results table

| req id                                                                  | use case                                                                  | commands                                                                                                                              | verdict                                                    | evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | notes                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A2-4 (PRIORITY)** preview↔apply of the DESTRUCTIVE adopt              | user force-adopts the gate spine over a customized `check-all.mjs`        | `update --adopt-plan --dir $T` → `update --adopt-plan --adopt-gate-spine --dir $T` → `update --adopt-gate-spine --dir $T`             | **PASS (with 3 defects, see F1/F2/F3)**                    | preview claimed `scripts/check-all.mjs (-2 +0 lines)` + 5 always-rewrite files; apply produced exactly those 6 **plus** 2 unclaimed (`arbiter.json`, `.arbiter-generated-manifest.json`) and 1 new untracked (`.arbiter-generated.json`). `claimed-not-changed = ∅`. Both preview runs left tracked hashes byte-identical (`NO_TRACKED_CHANGE_RUN1/RUN2`).                                                                                                                                                                                                                       | Preview is a **strict subset** of reality, never a superset — no claimed change failed to land. Line counts (`-2 +0`) match the exact 2 lines lost.                                                                                                                                                                               |
| A2-4b destructive-warning surfacing                                     | user must be told before losing work                                      | `grep -in "destruct\|warn\|danger\|irrevers\|lost" run3-apply.txt`                                                                    | **FAIL (F1, MED)**                                         | zero matches other than an unrelated filename `stop-dangerous.mjs`. Apply output ends `Done! 0 created, 1 updated…` + `Adopted 1 safety-class/withheld file(s)`. No pre-warning, no confirm, no diff shown.                                                                                                                                                                                                                                                                                                                                                                      | The word DESTRUCTIVE appears only in `--help`.                                                                                                                                                                                                                                                                                    |
| A2-4c preview must be reachable by the documented route                 | `--adopt-gate-spine` help says "preview with `--adopt-plan` first"        | `update --adopt-plan --dir $T`                                                                                                        | **FAIL (F2, MED)**                                         | output: `adopt-plan: nothing to adopt (no withheld file matches the adopt policy).` — a **false all-clear**. Only `--adopt-plan --adopt-gate-spine` reveals the spine.                                                                                                                                                                                                                                                                                                                                                                                                           | Following the help literally shows a user nothing at risk, then the next command destroys their gate wiring.                                                                                                                                                                                                                      |
| A2-4d backup / recovery path                                            | can the lost gate wiring be recovered?                                    | `ls .arbiter/evidence/local-overrides/`; sha verify                                                                                   | **PASS (mechanism) / FAIL (durability+reversal, F3, MED)** | `scripts__check-all.mjs.json` holds `priorContent` + `priorContentSha256` = `ffd536f1…` — byte-identical to the pre-apply on-disk hash; `priorContent.includes("RTM-A2-CUSTOM-CHECK") === true`.                                                                                                                                                                                                                                                                                                                                                                                 | But: `git check-ignore` → `.gitignore:42:.arbiter/` (a `git clean -fdx` or fresh clone loses the only copy), **no CLI command reverses it** (`help --all \| grep -i revert\|restore\|rollback\|undo` → NONE), and `local-overrides` appears in **zero** target `.md` docs. `--adopt` help calls it "a reversible local-override". |
| A2-4e `arbiter:preserve` marker vs the gate spine (#1983)               | project declares it owns the spine                                        | insert `// arbiter:preserve` into `check-all.mjs`; `update --adopt-gate-spine --dir $T`                                               | **PASS**                                                   | custom check survived (`grep -c RTM-A2-CUSTOM-CHECK` = 1); output: `Warning: 1 protected file(s) remain withheld … a gate-spine file adopts only under --adopt-gate-spine` + names `check-safety-adopt-ratchet.mjs` as the follow-up gate.                                                                                                                                                                                                                                                                                                                                       | Marker protects beyond the derived set. This is the correct, documented escape hatch — it is just not surfaced at the moment of destruction.                                                                                                                                                                                      |
| A2-4f machine-readable preview                                          | CI wants the plan as JSON                                                 | `update --adopt-plan --adopt-gate-spine --json --dir $T`                                                                              | **PASS**                                                   | `{"command":"update","version":"1","status":"ok","data":{"adoptPlan":[{"path":"scripts/check-all.mjs","removed":2,"added":0}],"wouldRegenerate":[…5…],"withheld":[]}}`                                                                                                                                                                                                                                                                                                                                                                                                           | JSON payload matches the text preview exactly.                                                                                                                                                                                                                                                                                    |
| **A2-1** `update` idempotence                                           | team re-syncs governance                                                  | `update --dir $T` ×2, commit between                                                                                                  | **PASS**                                                   | run A: 7 modified + 1 new; commit; run B: `git status --porcelain` → `[]` (empty). Custom check still present (=1).                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Second run is a true no-op on tracked files.                                                                                                                                                                                                                                                                                      |
| **A2-2** withheld-fix visibility                                        | hand-edited file is never clobbered                                       | `diff --withheld --dir $T`; then plain `update --dir $T`                                                                              | **PASS**                                                   | `Withheld template fixes (1) … ! scripts/check-all.mjs (template fix WITHHELD — user-modified)`; after plain `update`, `grep -c RTM-A2-CUSTOM-CHECK` = 1.                                                                                                                                                                                                                                                                                                                                                                                                                        | Default `update` is non-destructive to the spine (behaviour since #2119).                                                                                                                                                                                                                                                         |
| **A2-3** governance drift is fail-closed                                | someone weakens the Iron Laws / deny-list                                 | `diff --governance --dir $T` clean; then delete an Iron-Law sentence; then remove `Bash(rm -rf /*)` from `.claude/settings.json` deny | **PASS (both directions)**                                 | clean → `Governance sections are up to date.` **exit 0**. Iron-Law deleted → `STALE AGENTS.md: Iron Laws — content differs from current template` **exit 1**. Deny entry removed → `STALE .claude/settings.json: deny list — missing entries: Bash(rm -rf /*)` **exit 1**.                                                                                                                                                                                                                                                                                                       | Deny-list drift names the exact missing entry; AGENTS.md drift names the section (not the line). Fires only on real drift — not a permanently-red check.                                                                                                                                                                          |
| **A2-5** `configure` without the wizard                                 | user flips one setting                                                    | `configure --set governanceLevel=L3 --json --dir $T`; 4 negative cases                                                                | **PASS**                                                   | valid: `{"…","data":{"updated":["governanceLevel=L3"]}}` exit 0, `arbiter.json.governanceLevel === "L3"`. Unknown path → `Error: Unknown configuration path: nonexistent.path` exit 1. Bad enum → `governanceLevel must be one of L1, L2, L3, L4 — got L99` exit 1. Type error → `thresholds.lineCoverage must be a number — got: banana` exit 1. Range → `must be a number between 1 and 100` exit 1; value stayed `80` (no partial write).                                                                                                                                     | See F5: errors are text-only even under `--json`. See F6: this path changes level with **no grace period at all**, bypassing `upgrade-level`.                                                                                                                                                                                     |
| **REQ-014** `arbiter.json` is the complete, discoverable config surface | "what can I configure?"                                                   | `settings --json --dir $T`, then `configure --set <path>=<current>` for all 38                                                        | **PASS**                                                   | 7 groups / 38 paths. 32 scalar paths round-tripped **OK: 32, FAIL: 0**. The 6 null-valued paths set explicitly: 4 OK, 2 rejected with a _correct_ named enum error (`Invalid solo.mergeMode: "ff-only". Valid: direct, pr-ff`; `Invalid branchingStrategy: "trunk". Valid: trunk-direct, github-flow, github-flow-with-develop`).                                                                                                                                                                                                                                                | Every advertised path is settable. See F4: `settings --json` emits a **bare array**, not the `{command,version,status,data}` envelope every other `--json` command uses.                                                                                                                                                          |
| **A2-6** grace period on level upgrade — validation half                | bad input rejected                                                        | `upgrade-level --target L3 --days -1 / 0 / abc`, `--target L1`                                                                        | **PASS**                                                   | all exit 1 with named codes: `invalid_days` (`Must be a positive integer (>= 1)`) ×3, `invalid_target` (`Valid values: L2, L3, L4`).                                                                                                                                                                                                                                                                                                                                                                                                                                             | Downgrade is correctly refused.                                                                                                                                                                                                                                                                                                   |
| **A2-6** grace period on level upgrade — **behavioural half**           | L2 → L3 must warn-not-fail on day 1                                       | `upgrade-level --target L3 --days 14 --dir $T2` → `update --dir $T2` → `node scripts/check-all.mjs L1`                                | **FAIL (F0, HIGH)**                                        | CLI reports `{"status":"ok","data":{"from":"L2","to":"L3","graceEndsAt":"2026-08-16T…","graceDays":14}}` and writes `graceFromLevel:"L2"`, `graceEndsAt` to `arbiter.json`. Freshly regenerated spine, line 163: `const _levelOk = _cfg.graceFromLevel === 'L1' && _projectLevel === 'L2'`. Gate run emits **no `[GRACE]` line at all** — neither ACTIVE nor IGNORED. **Control (T3, L1→L2)** with the identical command emits `[GRACE] Grace period ends in 14 day(s) (2026-08-16). L2 gates WARN-only until then.`                                                             | Every L2→L3 and L3→L4 grace period is **silently inert** while the CLI reports success. Root cause + fix below.                                                                                                                                                                                                                   |
| **A2-6b** grace anti-fake-green guard covers the L2-sourced window      | hand-edited far-future `graceEndsAt`                                      | `node scripts/check-grace-window.mjs` on T2                                                                                           | **FAIL (part of F0)**                                      | PASS(17ms). Source line 55: `if (cfg.graceFromLevel !== 'L1' \|\| !cfg.graceEndsAt) { … NO-DATA … PASS }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | The over-long-window guard short-circuits on any non-L1 source level, so an L2-sourced window of any length is never flagged. Double-inert with F0.                                                                                                                                                                               |
| **A2-7** state-file corruption is recoverable                           | `.arbiter-generated.json` truncated by a crash                            | truncate to 50 % → `update --dir $T2` → `doctor repair-state --dir $T2`                                                               | **PASS**                                                   | `update` warns with a named code and a remediation: `[warn] config.snapshot_unreadable .arbiter-generated.json … is unreadable (Expected double-quoted property name in JSON at position 882) — delete the file to regenerate on next 'arbiter update'`, exit 0, and **self-heals** (`state parses after update: YES`). `doctor repair-state` → `doctor: snapshot re-derived from arbiter.json → …/.arbiter-generated.json`, and honestly warns `generated-manifest … is NOT re-derivable from config`. `doctor --json` health still emits a valid envelope on the corrupt tree. | Best-behaved recovery path in the area.                                                                                                                                                                                                                                                                                           |
| **CFG-C1** corrupted `arbiter.json` — truncated mid-JSON                | crash / bad merge mangles the config                                      | truncate to 50 % → `update --dir $T3`                                                                                                 | **PASS**                                                   | `EXIT=78`; `Config error [E_CONFIG_INVALID]: arbiter.json … has invalid JSON: Unterminated string in JSON at position 738 … Fix or delete and re-run.` + `Hint: Fix the JSON syntax or delete arbiter.json and run 'arbiter init'.` + `Run 'arbiter explain E_CONFIG_INVALID'`.                                                                                                                                                                                                                                                                                                  | Fail-closed with a machine code and a working `explain` pointer.                                                                                                                                                                                                                                                                  |
| **CFG-C2** corrupted `arbiter.json` — wrong type on a governance field  | merge-conflict artifact leaves `governanceLevel: 42` on an **L4** project | `configure --set governanceLevel=L4` → `update` (settle) → set `governanceLevel=42` → `update --dir $T3`                              | **FAIL (F00, HIGH)**                                       | before: `governanceLevel: "L4"`, spine `const _projectLevel = 'L4'`. After: **`EXIT=0`**, `governanceLevel: "L2"`, spine `const _projectLevel = 'L2'`. Only two stderr `[warn]` lines: `config.v2_passthrough_invalid … deferring to the migration fallback` and `config.coerced_fields … (governanceLevel: 42 → "L2")`. The coerced value is **persisted** to `arbiter.json`, and `.arbiter-generated.json`'s stored `config.governanceLevel` is likewise overwritten to `L2`, destroying the last record of the true level.                                                    | **Silent two-level governance downgrade on a fail-open path.** The regenerated gate is green while running strictly fewer checks (56 `runCheck` calls at the L2 render). Contrast with CFG-C1, which is correctly fail-closed for a _syntax_ error — a _semantic_ error on the single most security-relevant field is fail-open.  |
| **A2-8** adverse git state refused unless forced                        | user runs `init`/`update` mid-rebase or on detached HEAD                  | detached HEAD, then a genuine conflicted `git rebase` (`.git/rebase-merge` present)                                                   | **PASS**                                                   | detached: `EXIT=1` — `Error: HEAD is detached at a42d82e. arbiter cannot safely write files in detached HEAD state.` + `Checkout a branch first` + `Use --force to override this check.`; `--force` → `EXIT=0`. mid-rebase: **both** `update` and `init -y` → `EXIT=1`, `Error: A git rebase is in progress. arbiter cannot safely write files during a rebase. Complete or abort the rebase first: git rebase --continue`; `--force` → `EXIT=0`.                                                                                                                                | Message names the condition and the escape hatch, but carries **no `E_*` code** (unlike `E_CONFIG_INVALID`), and `--json` emits the same plain text on stderr instead of an error envelope — see F5.                                                                                                                              |

---

## Verdict counts

| verdict  | n   |
| -------- | --- |
| PASS     | 12  |
| FAIL     | 6   |
| BLOCKED  | 0   |
| SKIP-TTY | 0   |

18 rows exercised. The 6 FAIL rows map to findings **F1–F6**; **F7/F8** are defects observed
_within_ PASS rows (the row's requirement was met, the JSON contract around it was not), so they
are listed under findings but not counted as row failures.

Rows carried as PASS-with-defects (A2-4) are counted once as PASS; their three sub-defects
(A2-4b / A2-4c / A2-4d-durability) are the F3/F4/F5 FAIL rows.

TTY-interactive paths (`configure` without `--set`, `doctor --interactive`,
`upgrade-level --interactive`) were **not** exercised — every flow in this area has a complete
headless equivalent (`--set`, `repair-state`, `--target/--days`), so no row needed a pty. No
SKIP-TTY was necessary.

---

## FAILs by severity

### F1 — HIGH — silent governance downgrade on a semantically-invalid `arbiter.json`

`update` coerces an out-of-domain `governanceLevel` to the `L2` default, **persists** it, exits 0,
and regenerates the whole gate spine one or two levels lower. `.arbiter-generated.json` is
overwritten in the same run, so the true prior level survives nowhere on disk.

**Quantified on a pristine L4 target (T4)** — `init -y --level L4`, settle, set
`governanceLevel: 42`, `update`:

- `runCheck` count is **74 before and 74 after** — the check _count_ is not the tell (the number
  in the earlier note was from a different target and is superseded).
- `diff -u` of the L4 spine vs the coerced spine = **33 changed lines**, and they are the
  substantive ones:
  - `const _projectLevel = 'L4'` → `'L2'`;
  - the **L3/L4 evidence gate (INV-33)** block — an inline check over `.evidence/SUMMARY.json`,
    not a `runCheck` call, which is why the count hides it — is **removed entirely**;
  - the debt ratchet weakens from `scripts/debt-report.mjs --require-improvement` to
    `scripts/debt-report.mjs --gate`.

Blast radius: an L4 project loses its evidence gate and its improvement-requiring ratchet, exits 0,
and still reports a green gate — a fail-open on the field that decides what "green" means. Contrast
CFG-C1, where a _syntax_ error in the same file is correctly fail-closed with `E_CONFIG_INVALID`.
**Fix:** treat coercion of `governanceLevel` (and any level-bearing field) as fail-closed — raise
`E_CONFIG_INVALID` as the truncation path already does, instead of routing it through the migration
`coerced_fields` default.

### F2 — HIGH — `upgrade-level` reports success for a grace period that is not implemented

`upgrade-level --target L3|L4 --days N` validates input, returns `status:"ok"` with a real
`graceEndsAt`, and persists `graceFromLevel`/`graceEndsAt` — but the generated spine gates on
`_cfg.graceFromLevel === 'L1' && _projectLevel === 'L2'`, so the new gates are HARD on day 1 and
the gate prints no `[GRACE]` line at all (verified against an L1→L2 control that _does_ print
`[GRACE] Grace period ends in 14 day(s) … L2 gates WARN-only until then.`).

**Root cause is the CLI, not the gate.** `docs/internal/ADR/028-level-upgrade-grace-and-contract-type.md`
is explicit: _"**Scope:** MVP covers L1 → L2 only (D1). The `graceFromLevel` field is stored for
future L2 → L3 widening"_ and _"L2 → L3 grace is deferred. The field is stored but the template
only soft-fails for `graceFromLevel === "L1"`. Widening is one conditional change."_ The narrow
gate binding is therefore **by design**; the defect is that the command accepts `--target L3|L4`
with `--days`, claims success, and writes config fields for a window that cannot exist. The same
ADR specifies the signature as `--target=<L2|L3>`, so `L4` is accepted beyond even the intended
surface. `check-grace-window.mjs` short-circuits on the same `'L1'` literal, so an arbitrarily
far-future L2-sourced `graceEndsAt` is never flagged either.

Verdict is FAIL regardless of which side is "wrong": A2-6's stated use case is literally the
**L2 → L3 migration**, and it does not happen while the CLI reports that it did.
**Fix (pick one, ADR-028 favours the first):** have `upgrade-level` refuse — or loudly warn and
refuse to persist `graceEndsAt` — for any `--target` above L2 until the widening lands; _or_
implement the ADR's "one conditional change" by making the binding relational in both
`check-all.mjs.ejs` and `check-grace-window.mjs`.

### F3 — MEDIUM — no destructive warning at the moment of destruction

`update --adopt-gate-spine` prints nothing resembling a warning before or during the overwrite;
"DESTRUCTIVE" lives only in `--help`. The only signal is a past-tense `Adopted 1 … file(s)` line.
**Fix:** print the `--adopt-plan` summary (file list + `-N +M`) and the recovery path _before_
writing, on the apply path.

### F4 — MEDIUM — the documented preview route gives a false all-clear

`--adopt-gate-spine`'s own help says "preview with `--adopt-plan` first"; `--adopt-plan` alone
answers `nothing to adopt (no withheld file matches the adopt policy)`. Only the combined
`--adopt-plan --adopt-gate-spine` reveals the spine.
**Fix:** have `--adopt-plan` always enumerate what each adopt flag _would_ add, or amend the
`--adopt-gate-spine` help to say "preview with `--adopt-plan --adopt-gate-spine`".

### F5 — MEDIUM — "reversible local-override" has no reversal and no durable home

The override record is excellent (byte-exact `priorContent` + verified sha256) but lives under
gitignored `.arbiter/`, has no `arbiter` command that restores it, and is mentioned in no
generated doc. One `git clean -fdx` after a bad adopt is unrecoverable data loss.
**Fix:** add a restore path (e.g. `arbiter update --revert-adopt <path>`) and name the artifact in
the apply output.

### F6 — MEDIUM — a clean `init` is not update-stable: the first `update` immediately dirties the tree

On a freshly initialised target with **zero** user edits, the first `arbiter update` modifies 7
tracked files — `AGENTS.md`, `arbiter.json`, `.claude/knowledge-map.json`,
`.claude/hooks/post-edit-dispatch.mjs`, `docs/COMMANDS.md`, `docs/steering/tech.md`,
`.arbiter-generated-manifest.json` — and writes a new `.arbiter-generated.json`. Idempotence holds
from run 2 onward (A2-1 is correctly PASS on the literal recipe), but every day-1 adopter who runs
`init` then `update` gets a 7-file diff arbiter produced against itself, including a silent schema
migration of the user's own config (`+ "$schemaVersion": 4`, `+ kit`, `+ databaseEngine`, `+ lanes`).
**Fix:** make `init` emit the same render `update` converges to — i.e. `init` should already write
`$schemaVersion` and the derived fields, so `init; update` is a no-op.

### F7 — LOW — `settings --json` breaks the JSON envelope contract

`settings --json` emits a bare top-level array; `update`, `configure`, `upgrade-level` and
`doctor` all emit `{command,version,status,data}`. A generic consumer cannot parse both.

### F8 — LOW — error paths ignore `--json`

`configure --set <bad>`, `update` on adverse git state, and `upgrade-level` validation failures all
print human text to stderr even under `--json`, with no error envelope and no `E_*` code (only the
config-load path emits `E_CONFIG_INVALID`). Scripted callers must scrape strings.

---

## Additional observations (not FAILs)

- **Two doors to the same change, one with a grace period.** `configure --set governanceLevel=L3`
  changes the level with no grace record at all, bypassing `upgrade-level` entirely. Given F0, the
  "safe" door is currently the one that does nothing extra.
- **Preview under-reports arbiter's own bookkeeping.** `arbiter.json` and
  `.arbiter-generated-manifest.json` are mutated by every `update` but appear in no `--adopt-plan`
  output. `arbiter.json` in particular is user-owned surface (see F6 for the schema migration).
- **`--adopt-plan` reports line _counts_, not lines.** `(-2 +0 lines vs. current on-disk content)`
  is accurate but does not show _which_ wiring is about to be lost.
- Generated commit-msg/pre-commit hooks fired correctly in the target on the very first commit
  (`commit-msg rejected: subject must look like 'type(scope): description'`) — incidental evidence
  for AREA 4, recorded here only because it was observed.

## Explicitly not exercised

- **Version/schema migration from an older `$schemaVersion`.** Only observed incidentally: the
  `config.v2_passthrough_invalid` warning shows a v0.2 passthrough path exists, and a fresh
  `init` + `update` migrates `→ $schemaVersion: 4`. No hand-crafted v1/v2/v3 `arbiter.json` was
  fed to `update` to verify a real upgrade path. **Recommended follow-up for the next pass** —
  given F1, the migration fallback is the highest-value remaining untested surface in this area.
- **`upgrade-level --extend`** and its ADR-028 audit trail (`.arbiter/grace-log.json`) —
  out of budget; F2 makes the L3/L4 half of it moot until resolved.
- **Interactive TTY paths** — every flow here has a complete headless equivalent, so no pty was
  needed (no SKIP-TTY rows).

</content>

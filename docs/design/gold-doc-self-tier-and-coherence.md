---
title: 'Gold-Doc Addendum — self-tier floor & CLI-surface coherence'
doc_version: '0.1.0'
status: draft
last_review: '2026-07-12'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'audience/agent', 'kind/design']
related:
  [
    'docs/design/gold-doc-capability.md',
    'standards/gold-doc-set.yml',
    'scripts/check-doc-set.mjs',
    'scripts/check-phantom-command-scan.mjs',
    'scripts/lib/cli-command-names.mjs',
  ]
---

# Gold-Doc Addendum — self-tier floor & CLI-surface coherence

**Design doc — an addendum to `docs/design/gold-doc-capability.md`.** It closes the two design
holes the cross-project gap hunt filed against the capability (AR-5 and AR-3/AR-4,
`<governed-consumer-repo>/docs/audit/CROSS-PROJECT-GAPS.md` §ARBITER): (1) the tier axis of Tranche 1 would
**demote arbiter itself to the SOLO column** the moment it lands, because `arbiter.json` says
`trunk-solo` — the exact opposite of the parent design's "Self = Enterprise always" rule; (2) H7
(coherence blind to `arbiter <sub>` ghosts) is unbuilt, the T2 command cut (`3bd2f1db`) killed
`arbiter mark` while the anti-context-rot skill, two playbooks, and two emitted templates still
instruct it, and the cut's "zero-ref" verification never looked at the doc/template surface at all.

Every anchor below was re-verified against the working tree on `feat/gold-doc-capability-t0-t2`
(which carries the uncommitted Tranche-1 diff — `tiers{}` in the manifest + column resolution in
the engine). Live command outputs are quoted verbatim.

---

## Fix 1 — Self-tier floor: Self stays Enterprise under `trunk-solo`

### 1.1 Verified current state — the regression is not hypothetical, it is live in-tree

The Tranche-1 diff already implements collaborationMode → column resolution:

- `scripts/check-doc-set.mjs:124` — `TIER_COLUMN = { 'trunk-solo': 'solo', 'peer-review': 'small', 'gated-review': 'enterprise' }`
- `scripts/check-doc-set.mjs:126-131` — `resolveCollaborationMode()`: explicit `collaborationMode`
  wins, else the `soloDevMode` back-compat alias forces `trunk-solo`.
- `scripts/check-doc-set.mjs:134-144` — `loadTierColumn()` reads `arbiter.json` **at CWD** and
  returns the column. No override of any kind exists.
- `arbiter.json` — `"collaborationMode": "trunk-solo"` **and** `"features": { "soloDevMode": true }`:
  self resolves to `solo` twice over.

Live proof (`node scripts/check-doc-set.mjs --json`, this tree):

```
"tierColumn": "solo",
"totals": { "applicable": 12, "present": 12, "missingMandatory": 0, "missingRecommended": 0, "na": 36 }
```

Against the parent design's §6.1 baseline (`applicable: 20, present: 19, na: 28`), **8 checks went
dormant on self** — exactly the 8 always-rows whose `solo` cell is `o`/`-`:
`CONTRIBUTING.md`, `docs/GOVERNANCE.md`, `docs/SEMVER.md`, `CODE_OF_CONDUCT.md`, `ROADMAP.md`,
`docs/GLOSSARY.md`, `PRIVACY.md`, `docs/technical-debt.md`. Seven of the eight exist and are now
un-gated; the eighth (`docs/technical-debt.md`, the only §6.1 gap) is no longer even reported.
Self went "green" by shrinking its own bar — H6 made worse, as AR-5 predicted.

### 1.2 Design — `tier_floor` in `standards/doc-profile` (a floor, never a dial)

One new key in the doc-set profile, with **max() semantics on the ordering
`solo < small < enterprise`**:

```yaml
# standards/doc-profile (self)
tier_floor:
  enterprise # framework: npm-published artifact + plugin API — Self = Enterprise
  # always (docs/design/gold-doc-capability.md §1, §6.1). A floor can only
  # RAISE the collaborationMode-derived column, never lower it.
```

- **Effective column = max(derived, floor).** `trunk-solo` + `tier_floor: enterprise` ⇒
  `enterprise`. `gated-review` + `tier_floor: solo` ⇒ still `enterprise` — the floor cannot be
  used to dodge the cathedral, so the anti-cathedral guardrail (parent §2) survives untouched.
- **Absent key = today's behavior.** Governed repos keep pure collaborationMode derivation;
  right-sizing is unaffected. The floor is an opt-in commitment a repo makes about itself.
- **Fail-closed (INV-96):** a `tier_floor` value outside `{solo, small, enterprise}` is a config
  error → exit 1 with a message — mirroring the malformed-`tiers{}`-cell rule already in
  `requirementFor` (`scripts/check-doc-set.mjs:158-160`). Never silently ignored.

Why the profile and not `arbiter.json`: the engine already reads both files
(`arbiter.json` at `:135`, the profile at `:172-180` via `loadOverlays()`), the profile is the
doc-set-scoped per-repo config by design (overlays + `allow` live there), and this avoids any
`src/config/schema.ts` churn / `$schemaVersion` bump — `VALID_COLLABORATION_MODES`
(`src/config/schema.ts:435-439`) stays exactly as is. Rejected alternatives in §1.6.

### 1.3 Hook points (file:line)

| Where                                                  | Change                                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `scripts/check-doc-set.mjs:172-180` (`loadOverlays`)   | Also parse and return `tierFloor` from the profile YAML; validate the value (fail-closed exit 1).                   |
| `scripts/check-doc-set.mjs:134-144` (`loadTierColumn`) | Becomes `resolveEffectiveColumn(derived, floor)` = max on `solo<small<enterprise`.                                  |
| `scripts/check-doc-set.mjs:277-292` (report object)    | `tierColumn` stays the **effective** column; add `tierDerived` + `tierFloor` so every audit is self-explanatory.    |
| `standards/doc-profile`                                | Self adds `tier_floor: enterprise` with the rationale comment above.                                                |
| `src/templates/standards/doc-profile.ejs`              | Document the key in the header comment; emitted default = **absent** (governed repos are never auto-raised).        |
| `src/commands/doc-set.ts:20-36` (`DocSetPayload`)      | Add `tierDerived` / `tierFloor` fields (additive, non-breaking — the wrapper forwards the engine verdict verbatim). |
| `scripts/check-all.mjs:353-356`                        | **Unchanged** — `--strict` presence stays HARD (INV-135); it simply starts grading the enterprise column again.     |

### 1.4 Red path — prova

- **Live red (today, captured above):** self run resolves `tierColumn: "solo"`, 8 enterprise
  obligations dormant. **After the fix:** the same run resolves `tierColumn: "enterprise"`,
  `tierDerived: "solo"`, `tierFloor: "enterprise"`, the 8 rows re-enter `applicable` (12→20) and
  `docs/technical-debt.md` surfaces as `missingMandatory` (its enterprise cell is `R`,
  `standards/gold-doc-set.yml:238`) — so `check-all`'s strict wiring goes RED until self actually
  writes its debt register. That failure is the point: Self evaluated → Enterprise column, not Solo,
  with a real consequence, not a cosmetic label.
- **Unit fixtures** (engine already takes `--manifest`/`--profile`, `:65-66`; fixture repo dir with
  its own `arbiter.json`): (a) `trunk-solo` + `tier_floor: enterprise` → `docs/GOVERNANCE.md`
  missing = mandatory gap, exit 1 under `--strict` (RED today: it is skipped as dormant);
  (b) `gated-review` + `tier_floor: solo` → column stays `enterprise` (floor never lowers);
  (c) `tier_floor: banana` → exit 1 config error.

### 1.5 Consequence scheduled, not hidden

Landing the floor makes self honestly RED on `docs/technical-debt.md` (enterprise `R`). The
landing PR must therefore include a real `docs/technical-debt.md` — and there is genuine content
waiting for it: the methodology's TO-CREATE enforcer debt (M1/M4/M6/M8/M11-M15, AR-7) is exactly a
technical-debt register's first page.

### 1.6 Rejected alternatives

- **`self_tier` special-case in `check-all.mjs`** (pass a flag only at the self call-site,
  `:353-356`): fixes self but leaves the class open — any governed framework repo
  (solo-maintained, enterprise-consumed) has the same shape; and it splits tier truth between a
  call-site and the config.
- **Field in `arbiter.json`:** schema churn + `$schemaVersion` bump + migration for a doc-set-scoped
  concern; the profile is already the doc-set's per-repo config surface.
- **Auto-derivation from repo facts** (e.g. `archetype: library` ⇒ enterprise): speculative;
  promotion of _individual_ docs by triggers already exists (`applies` overlays). A whole-column
  floor is a governance commitment — keep it explicit, one line, reviewed.

### 1.7 Sequencing rule (hard)

The Tranche-1 diff is **uncommitted working-tree state**. If it lands without the floor, main gets
a window where self grades itself SOLO. Rule: **floor lands in the same PR as (or before) the
`tiers{}` resolution — never after.**

---

## Fix 2 — CLI-surface coherence (H7) + restore `arbiter mark`

### 2.1 Verified anatomy of the failure class

The T2 cut (`3bd2f1db`, "each verified zero-ref outside cli.ts/its own tests") deleted 17
commands. Its verification had **two** blind spots, not one:

1. **Emission boundary (cross-repo):** the same commit that deleted `doc-set` **kept**
   `src/templates/scripts/check-doc-set.mjs.ejs` shelling
   `spawnSync('npx', ['--no-install', 'arbiter', 'doc-set', ...])` (verified via
   `git show 3bd2f1db:src/templates/scripts/check-doc-set.mjs.ejs`) — so every governed repo's
   emitted runner (e.g. `acme-consumer/scripts/check-doc-set.mjs:18`) broke, and every _future_ scaffold
   would have been born broken. That is H1's root cause; T0 (`f471ce3e`) restored the command but
   not the guard.
2. **Doc/agent surface (intra-repo!):** `arbiter mark` was cut with live instructions to run it in
   `.claude/skills/context-rot-management/SKILL.md:21,52,112,122` (layer 2 of the 3-layer
   durable-redundancy protocol), `.claude/commands/ship.md:58,306`, `.claude/commands/task.md:29`,
   and the emitted templates `src/templates/claude/commands/ship.md.ejs:58,347` and
   `task.md.ejs:34`. The "zero-ref" grep only covered code surfaces. (Correction to the gap
   report's count: `src/templates/docs/steering/structure.md.ejs:39` says "an arbiter marker" —
   prose, not an invocation; a backtick-anchored scanner rightly ignores it. Two emitted templates
   instruct `mark`, not three.)

The guard for this class **already exists in embryo**: `scripts/check-phantom-command-scan.mjs`
(INV-111 ext, F2 #1838) validates backtick-cited `arbiter <cmd>` against `src/cli.ts` through the
shared SSOT parser `scripts/lib/cli-command-names.mjs` (`extractTopLevelCommandNames`, which
**includes hidden commands** — `:22-34`, so the hidden `doc-set` at `src/cli.ts:884` counts — plus
`extractCommandAliases`, `:50-55`). It is wired HARD in self `check-all`
(`scripts/check-all.mjs:183-185`). **But its roots are only `['PRIVACY.md', 'docs', 'website']`
(`check-phantom-command-scan.mjs:44`)** — it never looks at `.claude/` or `src/templates/`, which
is precisely where both blind spots live. H7 is therefore not a new gate: it is four missing scan
roots, one file-extension rule, and one extra matcher.

### 2.2 Design (a) — extend `check-phantom-command-scan.mjs` to the agent surface + emission boundary

| Where                           | Change                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `:44` `ROOTS`                   | Add `.claude/skills`, `.claude/commands`, `.claude/agents`, `src/templates`. **Not** `.claude/plans` — historical planning records legitimately cite dead commands (verified: 8 stale citations there, all noise), same exclusion rationale as `docs/internal`.                                                                                                                                   |
| `:48-49` `SKIP_PATH_SEGMENTS`   | Add `docs/design/` — design docs are proposal records (`solo-developer-gate-model.md` cites proposed `arbiter watch` and the cut `ship-on-red`), same class as ADR/roadmap archives. Current-state promises must not live in `docs/design/`.                                                                                                                                                      |
| `:88-96` `collectMarkdownFiles` | Also accept `*.md.ejs` — these render byte-for-byte into governed `.claude/commands/*.md`, so scanning the template source validates every future emission.                                                                                                                                                                                                                                       |
| new matcher beside `:66`        | Spawn-array form for emitted thin runners: `/'arbiter',\s*'([a-z][a-z0-9-]*)'/g` over `src/templates/scripts/*.mjs.ejs` (verified two instances: `check-doc-set.mjs.ejs:18`, `gold-audit.mjs.ejs:19`). Plus the fenced-line form `^(?:npx\s+(?:--no-install\s+)?)?arbiter\s+([a-z][a-z0-9-]*)` inside fenced code blocks (the `ship.md:58` shape), sharing the existing `PROSE_STOPWORDS` filter. |
| wiring                          | None — rides the existing HARD self gate at `scripts/check-all.mjs:183-185`.                                                                                                                                                                                                                                                                                                                      |

**Why template-source scanning closes the cross-repo boundary:** governed repos contain only what
the templates emit; validating the template corpus against `cli.ts` **in the same PR** means a
command deletion that strands any current emission goes RED before merge. Applied retroactively,
this check fails `3bd2f1db` itself (the kept `doc-set` runner template) — H1 would never have
shipped.

**Accepted blind spots (documented, all verified empty or bounded today):**
(i) EJS-interpolated command names — none exist (the only `arbiter <%= %>` in the corpus is a
version string, `src/templates/governance/solo-dev-exception.md.ejs:68`);
(ii) sub-subcommand depth (`arbiter task <ghost-sub>` passes — first-token granularity, unchanged
from the existing gate);
(iii) runners **already emitted into repos in the field** predate any template fix — that residual
class is what (b) covers.

### 2.3 Design (b) — emitted-surface ledger + tombstone protocol (the deletion-time memory)

Templates prove what _will_ be emitted; nothing records what _was_ emitted into repos that haven't
run `arbiter update` since. One committed data file provides that memory:

```yaml
# standards/cli-emitted-surface.yml — append-only ledger of CLI commands that ship
# inside emitted artifacts (runners, playbooks). Deleting one is a downstream break.
- command: doc-set
  emitted_by: ['src/templates/scripts/check-doc-set.mjs.ejs']
  since: '#1428'
  status: active # active | tombstoned
- command: gold-audit
  emitted_by: ['src/templates/scripts/gold-audit.mjs.ejs']
  since: '#1419'
  status: active
- command: mark
  emitted_by:
    ['src/templates/claude/commands/ship.md.ejs', 'src/templates/claude/commands/task.md.ejs']
  since: '#1206'
  status: active
# … task, ship, note, update, init, configure, worktree(+wt), gate-exec, review, evidence, explain —
# initial population = the extended scan's own citation inventory on first run.
```

Assertions folded into the same scan's `main()` (reusing the already-parsed command set — one SSOT
parser, no second engine): **active ⇒ registered in `cli.ts`**; **tombstoned ⇒ still registered,
as a stub** (hidden command whose action prints `removed in <ver>; use <replacement>` and exits 2,
carrying a `// TOMBSTONE(#issue)` marker); **every command the templates cite ⇒ has a ledger row**
(keeps the ledger complete by construction). Removal protocol for an emitted command:
`active → tombstoned` + stub for ≥1 minor release, then delete row + stub together. This is the
"cross-repo ref-check before command deletion" gate AR-3 asked for, as data + one loop — not a
process document. Priority: (a)+(c) are the landing PR; (b) can follow in its own small PR.

### 2.4 Design (c) — `arbiter mark`: RESTORE (not remove), and the evidence for it

Decision: **restore**. Every piece of the feature except the 40-line CLI writer is alive today:

- **Reader alive:** `arbiter task resume` (`src/cli.ts:1248`) still implements pinpoint-resume
  (#1206) — `src/commands/task.ts:86-93` reads `state.cursor` and lands on the exact next action.
- **Substrate alive:** `src/commands/task-state.ts` still exports `writeUnifiedState` (`:232`),
  `appendLog` (`:273`), `TddPhase`/`isTddPhase` (`:62-66`) — every import of the deleted file
  resolves unchanged.
- **Writer dead:** verified no remaining `cursor` writers outside task-state defaults — so #1206
  is currently an unreachable feature: live reader, no possible writer.
- **Consumers everywhere:** the skill + 2 playbooks + 2 emitted templates (§2.1) all instruct
  `arbiter mark` — governed repos are scaffolded with instructions for a command that errors.
- **ADR fit:** mark is exactly the ADR-054 pattern (state as fields on the unified status doc via
  the single-writer), so restoring it needs no new decision record — the "status.json fields vs
  restore" fork in the gap report is a false dichotomy: mark **is** the status-fields writer.

Restore = three artifacts recovered verbatim from `3bd2f1db^`: `src/commands/task-mark.ts`, the
hidden top-level registration block (`git show 3bd2f1db^:src/cli.ts` around `:1573`,
`.command('mark', { hidden: true })` → `runTaskMark`), and `__tests__/commands/task-mark.test.ts`.
Plus: ledger row (`status: active`), and resolve the methodology doc's §M3 transitional note
("repoint skills when T2 lands") the other way — mark is canon, the skill stays as written.

One more live ghost the extended scan surfaced (bonus yield, disposition in the same PR):
`.claude/agents/context-checker.md:28` cites `arbiter context-pack`, which **never existed** in
`cli.ts` (`git log --all -S 'context-pack' -- src/cli.ts` is empty) — reword the agent doc to state
CONTEXT_PACK.md's real provenance.

### 2.5 Red path — prova (live, captured on this tree)

**No seeding needed — the extended scan is RED against today's repo:**

```
$ node scripts/check-phantom-command-scan.mjs --roots=.claude/skills,.claude/commands,.claude/agents,src/templates
  phantom: .claude/skills/context-rot-management/SKILL.md: `arbiter mark` is not a registered command
  phantom: .claude/commands/ship.md: `arbiter mark` is not a registered command
  phantom: .claude/commands/task.md: `arbiter mark` is not a registered command
  phantom: .claude/agents/context-checker.md: `arbiter context-pack` is not a registered command
[check-phantom-command-scan] FAIL: 4 phantom command citation(s) found   (exit=1)
```

(The two `*.md.ejs` mark citations join this list once the extension filter lands.) After (c)
restores `mark` and the `context-pack` reword, the same run is GREEN — the check's first real run
catches and then certifies the fix.

**Seeded ghost (permanent unit fixture):** the scanner already takes `--cli=` / `--roots=` fixture
overrides (`:40-45`) and has a test file (`__tests__/check-phantom-command-scan.test.ts`). Add: a
fixture `src/templates/claude/commands/x.md.ejs` citing `` `arbiter ghostcmd` `` and a fixture
runner with `'arbiter', 'ghostcmd'` → scan exits 1 naming both; remove the citation → exits 0.

**Also red today, resolved by this design:** the _default-roots_ scan already FAILS on this branch
(3 citations: the sealed methodology doc cites `arbiter mark` — fixed by the restore; the sealed
gate-model design doc cites `ship-on-red`/`watch` — fixed by the `docs/design/` skip). **This file
itself adds 4 more** (verified: 7 total after writing it) — a design doc cannot discuss dead
commands without citing them, which is the living demonstration of why `docs/design/` belongs in
`SKIP_PATH_SEGMENTS`. T5b′ leaves `check-all` green, per the parent's tranche rule.

---

## Tranche mapping (addendum to parent §8)

| Addendum tranche                  | Contents                                                                              | Depends on                         | Constraint                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **T1b — self-tier floor**         | §1: `tier_floor` in engine + profile + payload; self `docs/technical-debt.md`         | none                               | **Same PR as (or before) the in-tree Tranche-1 diff** — never after (§1.7).                                                                                                                                                                                                                                                                                                                |
| **T5b′ — CLI-surface coherence**  | §2.2 scan extension + §2.4 mark restore + `context-pack` reword + `docs/design/` skip | none (independent of Tranches 1-4) | Restore lands with the scan extension in one PR, else the gate lands red. Implements parent Tranche 5(b) early; supersedes the "extend `check-emission-coherence.mjs`" sketch in parent §5.4 — the phantom scan already owns command-existence with the SSOT `cli.ts` parser; emission-coherence keeps owning file-path existence (two drift models, two gates, per its own CATALOG note). |
| **T5b″ — emitted-surface ledger** | §2.3 ledger + tombstone assertions                                                    | T5b′                               | Follow-up PR; append-only data + one assertion loop.                                                                                                                                                                                                                                                                                                                                       |

Parent Tranche 5(a) (enroll the charter docs, raise the self profile) is unchanged — T1b is the
mechanism it presupposed and did not specify.

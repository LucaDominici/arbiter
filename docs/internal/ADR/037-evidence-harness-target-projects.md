---
title: 'ADR-037: Evidence Harness for Target Projects'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: '037'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-037: Evidence Harness for Target Projects

**Status:** Accepted  
**Date:** 2026-05-06  
**Issue:** #407  
**Tier:** Layer 3 — Esecuzione (Verified-Done Execution)

---

## Context

Prior to this ADR, Arbiter's task lifecycle enforcement (INV-38, ADR-034) blocked premature
completion claims via phase checks and agent-dispatch counts. However, none of these mechanisms
verified that the _work product itself_ — the actual source files — matched the state that was
present when the gate ran. An agent could:

1. Run the L2 gate at time T (passes)
2. Make additional edits at time T+1 (potentially breaking)
3. Claim "task complete" at time T+2

The completion guard saw `phase = verification` and blocked with exit 2, but only until the phase
was manually advanced. There was no persistent link between "gate green" and "source state".

Reference pattern: a prior internal project uses `guard-ui-claim.mjs` + `.last-done-evidence.json` to enforce
that the specific UI files which passed gate inspection are unchanged before accepting done claims.

---

## Decision

Generate three artifacts for target projects at L2+:

### 1. `guard-done-evidence.mjs.ejs` (UserPromptSubmit hook)

Hard-blocks (exit 2) completion claims until `.claude/.last-done-evidence.json`:

- Exists
- Has `all_green: true` (gate was green when evidence was captured)
- SHA-256 of every `pinned_files[]` entry matches the current working tree

This closes the time-gap between gate run and done claim.

### 2. `done-evidence.mjs.ejs` (CLI script, `node scripts/done-evidence.mjs`)

1. Runs the L2 gate (`node scripts/check-all.mjs L2`)
2. If green: walks `pin_dirs` filtering by `pin_extensions` (from `evidence-files.json`), computes
   SHA-256 of each file, writes `.claude/.last-done-evidence.json`
3. If red: exits 1, prints failures, blocks evidence capture

Workflow position: runs after Phase 8 (gate) and before Phase 11 (cleanup/close). Called
automatically by `arbiter task advance --to complete` as a prerequisite.

### 3. `evidence-files.json.ejs` (per-archetype pin config)

Declares which directories and file extensions are load-bearing for done state:

- TypeScript: `src/`, `__tests__/`, extensions `.ts .tsx .mjs .js`
- Java: `src/main/java/`, `src/test/java/`, extension `.java`
- Python: `src/`, `tests/`, extension `.py`
- Rust: `src/`, `tests/`, extension `.rs`
- Go: `.`, extension `.go` (excludes `vendor/`)

### 4. Journey-first Definition-of-Done (#A2, extends INV-114)

The three artifacts above prove the gate was green over unchanged files, but green tests do not
prove the shipped product works: a prior project shipped built images whose production UI ran in
fixture mode (dead buttons) while every test passed, because the acceptance journey had only ever
been exercised against the dev server.

When the evidence harness is enabled (`enableEvidenceHarness === true`, i.e. L4 or any project that
opts in), `stop-evidence-guard.mjs` requires a **fourth** correlated artifact before it will allow a
completion claim to stand: `.arbiter/evidence/journey/<taskId>.json`, with

- `branch` / `sha` — correlated to the current branch and an ancestor of HEAD (same anti-stale rule
  as the other three artifacts);
- `spec` — the acceptance E2E spec the task declared up front and ran;
- `target` — **must be `"artifact"`** (the run exercised the built compose image / `dist`), never a
  dev-server-only run.

A missing, stale, spec-less, or dev-server-only journey artifact blocks the stop (exit 2) with a
message naming the specific defect. The check is config-gated: projects without the evidence harness
keep the three-artifact contract unchanged.

---

## Consequences

**Positive:**

- Closes the gate-run ↔ done-claim time gap mechanically (INV-38 extended)
- Evidence file is human-readable JSON — can be committed, audited, or attached to PR
- Consistent with a prior internal project's reference pattern (validated in production)
- No external dependencies — Node 20+ built-ins only (`crypto`, `fs`, `child_process`)

**Negative:**

- L2 gate runs twice per task (Phase 8 + done-evidence) — accepted; redundancy is intentional safety
- Evidence is local-machine state (`.gitignore`'d) — not portable across machines in v1.0
  (deferred: distributed evidence, cryptographic signatures, evidence retention beyond current task)
- Adding a new hook to `settings.json.ejs` increases UserPromptSubmit hook chain length
  (now: skill-forced-eval → guard-task-completion → guard-done-evidence)

---

## Alternatives Considered

**Crypto signatures on evidence:** SHA-256 sufficient for v1.0. Cryptographic signatures
deferred until there is a demonstrated need for tamper-proof audit trail.

**Auto-advance on green gate:** Too magical. Explicit `node scripts/done-evidence.mjs` run
keeps human intention in the loop.

**Single merged hook:** Keeping guard-task-completion and guard-done-evidence separate preserves
single-responsibility and allows independent empirical testing (INV-36 + INV-38).

---

## Amendment (2026-06-13, #1345) — emission condition realigned to the harness flag

The original Decision states the three artifacts are generated "at **L2+**". The
implementation had drifted: `done-evidence.mjs` and `evidence-files.json` were emitted
**L4-only** (`generateEvidenceRetention`), while the `guard-done-evidence.mjs` hook is
emitted whenever the evidence harness is enabled (`enableEvidenceHarness !== false`).
Because `runInit` defaults `enableEvidenceHarness` to `governanceLevel === 'L4'`, the
three artifacts only co-appeared at L4 — but any project that explicitly enables the
harness below L4 (e.g. a prior internal project at L2) got the **guard hook without the script it tells the
user to run**: a completion **deadlock** (the hook hard-blocks and instructs
`node scripts/done-evidence.mjs`, which was never emitted).

Resolution:

- `done-evidence.mjs` is now emitted under the **same** condition as its guard hook
  (`enableEvidenceHarness !== false`), so script and guard always travel together.
- `evidence-files.json` remains gated at L4 as the **optional** per-archetype pin config;
  `done-evidence.mjs`'s `loadConfig()` returns a safe default when it is absent, so the
  script is fully functional without it below L4.
- The `Makefile` `evidence:` target and the ship `Complete`-phase `done-evidence` step are
  now gated on the same flag, so neither references a script that was not emitted.
- The emission-coherence gate (INV-123) was widened to scan `Makefile` and
  `.claude/commands/*.md`, the two source kinds that previously hid this dangling
  reference.

## Amendment (2026-07-10, #1839) — self-dogfood status (F3 friction cut)

The F3 wave audit (#1839) flagged arbiter's own `arbiter.json` (`features.evidenceHarness:
false`, `features.contractTesting: false`) as a possible dogfood gap: arbiter sells both
features to target projects but does not run them on itself. Investigated and resolved as
follows, per CANON's self-dogfood rule (`docs/internal/SYSTEM/CANON.md`), which requires
dogfooding "where arbiter's governance level qualifies" — not unconditionally:

- **`contractTesting` — closed, no-op-verified.** `generateContractTesting` short-circuits
  whenever `contractType === 'none'` or `hasPublicApi === false` (ADR-028), both true for
  arbiter's own config (a CLI library with no owned/consumed API). Confirmed via `arbiter
diff` in an isolated sandbox: flipping the flag to `true` produces **zero** file changes.
  Flag flipped to `true` in this amendment's PR — matches the tool-wide default
  (`enableContractTesting !== false`) at zero risk.
- **`evidenceHarness` — deliberately deferred, not neglected.** This ADR's own Decision
  defaults the harness to L4 (arbiter self runs at `governanceLevel: L2`, a considered choice
  for a trunk-solo CLI library — see `website/problems/dogfooding-trust.md`), so the flag being
  off is consistent with the documented default, not an oversight. A sandboxed `arbiter update`
  dry-run (flag flipped true) was run to check whether activation is safe to bundle here: it is
  not — arbiter's `.claude/settings.json` carries a hand-tuned, per-hook structure with several
  self-only hooks confirmed intentional in `.dogfood-divergences.json` (tracked for narrowing in
  #1090); a mechanical `arbiter update` collapses that structure into the generic template's
  consolidated `hooks.mjs <EventName>` dispatcher, silently dropping the arbiter-internal-only
  hooks. Activating the harness for real requires the same hand-adaptation given to
  `guard-task-completion.mjs` and the other self-only hooks (#1092), not a blind regenerate.
  Tracked as #1872.

## Related

- ADR-034: Phase-lifecycle hard enforcement (#406)
- ADR-032: Hook hardness manifest (#410)
- ADR-028: Level-upgrade grace and contract-type axis (`hasPublicApi` gate)
- INV-38: Phase-tracked lifecycle enforcement (extended by this ADR)
- #407: Implementation issue
- #1839: F3 friction cut (self-dogfood status audit)
- #1872: Follow-up — hand-adapt evidenceHarness into arbiter's own hook chain

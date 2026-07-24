---
title: 'ADR-110: Acceptance-criteria anchor — entry gate, external DoD, FIT review, rework telemetry'
doc_version: '1.0.0'
status: active
last_review: '2026-07-21'
owner: ''
canonical_id: '110'
tags: ['audience/dev', 'kind/adr']
related: ['042-gate-tiers', '105-never-brick-config-migration']
enforces: ['INV-138']
---

# ADR-110: Acceptance-criteria anchor — entry gate, external DoD, FIT review, rework telemetry

**Project:** arbiter
**Date:** 2026-07-21
**Status:** Accepted
**Issue:** — (direct owner directive, 2026-07-21; branch `claude/acceptance-criteria-rework-71axfn`)

## Context

Rework in the issue → /task → gate → review chain is almost never bad generation — it is
faithful execution of a fuzzy target. A green gate certifies mechanics (tests pass, lint
clean), not intent; rework is born in the gap between "green" and "what was actually
asked". The criterion for "done right" lived in the requester's head, not in the artifact.
Four leverage points were identified (in descending order of leverage): (1) issues enter
waves without explicit acceptance criteria; (2) the implementing agent writes acceptance
tests from its own interpretation of the issue — self-grading; (3) reviewers judge code
quality, not fit against the declared target; (4) rework is not instrumented, so the
issue-template weakness that produces it is never localized.

## Decision

Introduce **INV-138** (selfOnly, flag-gated `features.acceptanceAnchor` /
`ARBITER_ACCEPTANCE_ANCHOR`) implementing all four proposals as one anchored chain:

1. **Entry gate ("grill" upstream of every wave)** — `scripts/issue-readiness.mjs`
   (orchestration-time, gh allowed, deliberately NOT in check-all). An issue is workable
   only with explicit `AC-N:` acceptance criteria beyond template stock lines /
   unreplaced placeholders, a Non-goals section, and the files/contracts touched.
   Unready ⇒ `needs-clarification` label + generated checklist comment + exclusion from
   the wave (/ship preflight STOPs). Only issues actually selected into a wave are
   labeled/commented — no mass backlog sweep; commenting is skipped when the label is
   already present. Legacy issues therefore migrate lazily, at selection time.
2. **External DoD anchor** — the task plan freezes the issue's AC **verbatim** under
   `## Acceptance Criteria` (stable explicit `AC-N` ids; bare checkboxes are rejected as
   a renumbering hazard) plus `## Non-Goals`. Tests cite `AC-N` in their titles; the
   mapping line lands in the red commit body. The AC↔test-title mapping stays a reviewer
   rubric, deliberately NOT a grep gate (CANON-22: contested heuristics advise).
3. **FIT review** — reviewers receive the frozen anchor as an explicit rubric: for each
   `AC-N`, cite the diff/test `file:line` that proves it; verdicts land in
   `.arbiter/evidence/ac-fit/<task>.json` (`arbiter-ac-fit-v1`, committed).
   `scripts/check-acceptance.mjs` (wired `runCheck` at L1) validates the anchor during
   implementation phases and hard-requires an all-PASS, evidence-cited ac-fit artifact at
   verification/close — the mechanical form of "unproven criterion = REJECT". Wave mode:
   plans anchored as `wave-N.md#group` are resolved by stripping the fragment, and the
   integrate step invokes `--plan .claude/plans/wave-N.md` in the main tree (per-worktree
   status.json never reaches the integrate gate, so skill text + integrate-time
   invocation carry wave enforcement).
4. **Rework telemetry** — `scripts/rework-log.mjs` appends enum-validated
   `{reason × caught}` entries to the committed `.arbiter/rework/ledger.jsonl`
   (paired gitignore negations; `merge=union`). `report` aggregates and maps each reason
   to the issue-template section that is too loose. The `caught` axis (review | gate |
   post-merge) empirically answers "is rework a review tax or a verification hole"
   instead of guessing.

Pure parsing/validation core: `scripts/lib/acceptance-criteria.mjs` (no I/O; listed in
the fail-closed-audit SKIP_FILES; consumers own the INV-53 exit contract, failing closed
exit 2 on malformed state, unreadable plans, unknown phases — with reset instructions and
the `ARBITER_ACCEPTANCE_ANCHOR=0` escape named in the error).

## Consequences

- Underspecification is paid as a prompt before dispatch, not as a thrown-away PR after
  review. The readiness gate turns "roba da rifare" into `needs-clarification` upstream.
- arbiter self-config enables the flag (`arbiter.json`); targets get it opt-in
  (`OPTIONAL_FEATURE_FLAGS` — never the required list, per ADR-105; activation via
  `arbiter configure features.acceptanceAnchor=true` / settings catalog / env). No
  recipe field yet: the recipe `evidenceHarness` precedent is schema-only/unconsumed, and
  adding dead recipe surface was rejected. `PATH_TO_KEYS` omission is deliberate — no
  generator consumes the flag.
- Track-B emission (templating `check-acceptance.mjs` + `issue-readiness.mjs` +
  `rework-log.mjs` for target projects per CANON-01 dual-sided declination) is a tracked
  follow-up; INV-138 is `selfOnly` until then, mirroring the INV-107/INV-117 precedent.
  The skill/agent text (wave-drain, ship, tdd, red-team) IS templated already, so targets
  inherit the process contract now and the mechanical gate later.
- The stop-evidence-guard (INV-114) is intentionally untouched: ac-fit enforcement rides
  the existing L1 gate, adding no new hook surface (CANON-10 table unchanged).
- SSOT edits in this change (AGENTS.md §Invariants row, this ADR) are the amendment this
  ADR documents; the public mirror `website/governance/AGENTS.md` is regenerated in the
  same commit.

## Amendment (same day) — Merge Contract

Owner directive (2026-07-21, second operational constraint): before writing, each slice
derives its **merge contract** from six sources — acceptance criteria, repo policy
(INV/CANON in scope), required tests, CI expectations, review/security surfaces, and
dependencies. Code and tests are born against that contract; adversarial review runs
against it before push. Wired as prose in `/ship` ("Merge Contract" section) and in the
wave-drain Phase-1 manifest (which IS the contract, per group). The hard-gated core stays
the `AC-N` anchor (`check-acceptance`); the other five sources are reviewer rubric, per
CANON-22.

## Amendment (same day) — diff red-team fixes

The pre-merge red-team pass (verdict REWORK, 14 findings) drove these decisions:

- **Target-graceful skills:** the templated ship/wave-drain readiness step explicitly
  skips when `scripts/issue-readiness.mjs` is absent (`Cannot find module` is never a
  not-ready verdict) — closes the mass-mislabel hazard in targets until Track-B lands.
- **Heading normalization:** numbered/emphasized form headings (`### 6. Non-Goals`) are
  normalized before classification; section-token matches are word-bounded; fenced code
  blocks are never parsed (a doc quoting the grammar cannot satisfy the anchor).
- **Wave id namespacing:** wave plans freeze per-issue ids as `AC-<issue>.<n>`;
  duplicate ids in an anchor are a gate error (they would collapse distinct criteria
  into one fit verdict). The wave integrate command validates fit too
  (`--plan … --ac-fit .arbiter/evidence/ac-fit/wave-N.json`).
- **Wave workers:** a task anchored to `wave-N.md#group` skips the per-task ac-fit
  REQUIREMENT at verification/close (integrate-time validation owns wave fit); an
  existing artifact is still validated. Workers normally stop before those phases.
- **ac-fit hardening:** artifact taskId must match the active task (stale-copy guard),
  duplicate ids inside the artifact are errors, evidence lines must be positive
  integers, and the sanitized filename rule (`#42` → `42.json`) is stated in the skills.
- **Escape hatch:** `ARBITER_ACCEPTANCE_ANCHOR=0` is advertised only on exit-2
  stale-state paths, never on genuine FAILs. The env var stays `isGateBypass: false` in
  the registry deliberately: like `ARBITER_EVIDENCE_HARNESS`, it is the activation
  toggle of an opt-in feature, not a bypass of a mandatory gate.
- Empty/absent task phase maps to `preflight` (SKIP), mirroring `normalizePhase`.

## Amendment (same day) — Track-B tool emission

The INV-123 emission-coherence gate rejected the interim state (command-doc references
are unguarded by construction and can never be silenced by the optional-emissions
manifest), forcing the honest resolution early: `issue-readiness.mjs`,
`rework-log.mjs` and the shared `lib/acceptance-criteria.mjs` are now EMITTED to every
governed target via `src/generators/check-all.ts` UNCONDITIONAL_EMISSIONS, with
byte-parity render tests (`__tests__/templates/acceptance-anchor-scripts-render.test.ts`)
proving CANON-01 dual-sided declination by construction. What remains follow-up is only
the `check-acceptance.mjs` GATE wiring inside the generated `check-all.mjs` (hence
INV-138 stays `selfOnly`). The `[ -f … ]` guards in ship.md remain for brownfield trees
that predate the emission.

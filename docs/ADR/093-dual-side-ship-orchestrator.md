---
title: 'ADR-093: Dual-Side the /ship Orchestrator'
doc_version: '1.0.0'
status: proposed
last_review: '2026-06-11'
owner: ''
canonical_id: '093'
tags: ['audience/dev', 'kind/adr']
related: ['088-ship-as-orchestration-entrypoint', '051-collaboration-mode-workflow-axis']
---

# ADR-093: Dual-Side the /ship Orchestrator

**Project:** arbiter
**Date:** 2026-06-11
**Status:** Proposed

## Context

ADR-088 made `/ship` the single orchestration entrypoint — issue → reviewed → merged PR.
But the entire ship stack is **self-only** (CANON-01 dual-sided declination unsatisfied for
orchestration): the `arbiter ship` engine (`src/commands/task-ship.ts`), `ship --batch`
(#1263), affinity (#1259), and size→verticals (#1260) all serve arbiter's own repo. A
consumer repo scaffolded by arbiter inherits only the low-level `arbiter task` engine, not
the orchestration loop, batch, or any fix-on-red capability.

The `haben-redux-pilot.md` live pilot (go-live #1) proves the gap: to run haben unattended
under arbiter governance we had to **rebuild ship-batch semantics outside arbiter** — a
stateless tick supervisor (`.redux/supervisor.sh`), a tick prompt, and failure-signature
memory (`.redux/attempts.json`, 2-strike escalation). That external rebuild is precisely the
drift CANON-01 exists to prevent, and it adds a capability arbiter lacks: an autonomous
diagnose → reproduce-locally → root-cause-fix → push loop that escalates instead of
retry-looping.

## Decision

Adopt the **hybrid** packaging: extend arbiter's existing engine/driver split across the
dual-side boundary.

1. **Engine = `arbiter ship` CLI** is the SSOT for all deterministic sequencing. De-self-only
   it to run against any `arbiter.json` repo. It owns next-action computation, phase
   auto-advance, batch, affinity, size→verticals, and the new **fix-on-red policy**
   (failure-signature computation, attempts memory, 2-strike escalation, reproduce-gate
   next-action). Versioned via the consumer's pinned `arbiter` npm dependency — no copy to
   drift.

2. **Driver = thin generated artifact** runs the model-requiring steps (write code, review,
   diagnose a red log, author the fix). Generalize the pilot's `supervisor.sh` +
   `TICK_PROMPT.md` into a generated `.arbiter/ship/` driver + a thin `.claude/commands/ship.md`.
   The driver calls the engine for every decision and holds no sequencing logic. Its drift
   surface is covered by the dogfood parity gate (CANON-14).

3. **Fix-on-red** lives in the engine (deterministic policy) + driver (model diagnosis), never
   a hook. Existing hooks (no `--no-verify`, gate-before-push, no-commit-to-main) remain the
   floor the fix must not violate. The pilot's `.redux/attempts.json` becomes the
   engine-owned, schema-validated `.arbiter/ship/<task-id>/attempts.json` (per-task dir —
   prevents cross-task strike contamination; hardened in #1289 review).

4. **Autonomy gating (L0–L3)** keys ship behaviors off `arbiter.json` →
   `automation.autonomy`: L0 ask-each-step · L1 ask-on-risky-only (auto-merge ok) · L2
   autonomous-stop-on-red · L3 full-auto wave + autonomous fix-on-red + per-issue sub-agent
   auto-spawn. Floor invariants (2-strike escalation, reproduce-before-push, no `--no-verify`,
   no commit-to-main) hold at every level. `arbiter doctor` adds a coherence guard
   (L3+no-CI and L4-governance+autonomous-push are incoherent). This ADR defines the minimal
   `automation` block; the Project-Profile work (#1258/#1261) extends it.

5. **Self-only-forever boundary.** Template-authoring orchestration (`src/templates/`,
   CANON-04/05/13/14/18), matrix/fixture promotion (CANON-02/03, INV-32), the existing
   selfOnly invariants (INV-107/108/111/117/120), and kit-source-leakage (INV-85) stay
   self-only — they govern arbiter-authoring concerns that do not exist in a consumer repo,
   so emitting them would be map-fiction (INV-115).

## Consequences

### Positive

- Consumer repos get the full issue→merged-PR pipeline + autonomous fix-on-red, versioned
  with the arbiter dependency, satisfying CANON-01 for orchestration.
- The pilot stops being a one-off external rebuild; its semantics become a generated,
  tested feature.
- Sequencing stays in the tested engine (CANON-06); only the irreducibly-model step lives
  in a prompt — minimal drift surface.

### Negative

- Two artifacts (engine + thin driver) must stay coherent; relies on the dogfood parity gate.
- Autonomy gating blocks on the Project-Profile/autonomy taxonomy (#1258/#1261) being
  ratified; this ADR co-defines the minimal `automation.autonomy` field to unblock.
- Adds a per-harness driver concern (Claude Code first; Codex/others later).

## Links

- Related ADRs: ADR-088 (ship entrypoint), ADR-051 (collaboration-mode axis + coherence matrix)
- Seed: `.arbiter/management/haben-redux-pilot.md`, `.arbiter/strategy/BRAINSTORM-project-profile-autonomy.md`
- Design: `.arbiter/design/dual-side-ship.md`
- Tracking issue: #1287
- Implementation issues: #1288 (de-self-only `arbiter ship` engine), #1289 (fix-on-red
  module — signature memory + 2-strike escalation), #1290 (thin consumer driver —
  supervisor + tick prompt + `/ship` command), #1291 (autonomy-level gating L0–L3),
  #1292 (doctor coherence guard + self-only boundary doc)
  </content>

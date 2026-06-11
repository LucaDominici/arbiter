---
title: 'ADR-094: Project Profile Resolver — one catalog + one precedence layer'
doc_version: '1.0.0'
status: proposed
last_review: '2026-06-11'
owner: ''
canonical_id: '094'
tags: ['audience/dev', 'kind/adr']
related:
  [
    '093-dual-side-ship-orchestrator',
    '051-collaboration-mode-workflow-axis',
    '088-ship-as-orchestration-entrypoint',
  ]
---

# ADR-094: Project Profile Resolver — one catalog + one precedence layer

**Project:** arbiter
**Date:** 2026-06-11
**Status:** Proposed

## Context

Per-run flags (`--affinity`, `--level`, `--units`, max-worktrees, `--autonomy`…) do not scale: each
new knob tends to grow a bespoke commander option, a bespoke validator, and a bespoke
`flag ?? config ?? default` chain. The brainstorm (`.arbiter/strategy/BRAINSTORM-project-profile-autonomy.md`,
issue #1258) proposed the opposite: convention over configuration — answer a short init interview once,
persist a **Project Profile** in `arbiter.json`, and have `ship` / wave / `task` derive behavior from
it, with flags surviving only as rare overrides (precedence: **flag > session > project profile >
derived default**).

Most of that brainstorm has already shipped since it was written (2026-06-07); this ADR records those
decisions and resolves the residual. Mapping the brainstorm's seven open questions to their answers:

| Q   | Topic                              | Resolved by                                                                                                          |
| --- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Q1  | Settings-surface SSOT              | #1121 — `arbiter.json` is the single source; `arbiter settings` reads it; `.claude/settings.json` stays harness-only |
| Q2  | Autonomy taxonomy L0–L3            | ADR-093 / #1291 — `automation.autonomy`, `AUTONOMY_GRANTS`, `--autonomy` override (`src/commands/ship-profile.ts`)   |
| Q3  | Asked vs derived at init           | #1261 — init wizard writes the minimal profile                                                                       |
| Q5  | Affinity + size as engine features | #1259 / #1260 — `src/affinity/affinity.ts`, `src/sizing/sizing.ts`, computed unconditionally (no flag)               |
| Q6  | Doctor coherence (autonomy)        | #1292 — `checkAutonomyCoherence` (`src/commands/doctor.ts`, matrix in `src/commands/wizard/coherence.ts`)            |
| Q7  | Dual-sided                         | ADR-093 §5 self-only boundary                                                                                        |

ADR-093 §4 deliberately defined only the **minimal** `automation` block and deferred the full
Project-Profile decision here: _"This ADR defines the minimal `automation` block; the Project-Profile
work (#1258/#1261) extends it."_

The genuine residual: `AutomationConfig` (`src/config/schema.ts`) holds only `autonomy`. The
brainstorm's other orchestration prefs — max-parallel-worktrees, default gate-level, affinity-batching
toggle — are not persisted or derived. **Q4 (override grammar)** is undecided, and `--autonomy` is
still a one-off special case rather than an instance of a general pattern. The repo already contains
the substrate to unify on, unused for overrides:

- a typed config-path catalog + validators — `ALLOWED_PATHS`, `parseValue`, `parseEnumPathValue`,
  `applySet` in `src/commands/configure.ts` (already validates `automation.autonomy`; already shared by
  `arbiter settings`, #1121);
- a load-time env-override layer — `applyEnvOverrides()` in `src/config/env-overrides.ts`;
- a session layer — `.claude/.task/status.json`, used today only for `tier`
  (`review.ts`: `opts.tier ?? readTierFile(dir) ?? default`) — the one place the brainstorm's
  "flag > session > …" precedence is actually realized.

These exist but are wired ad-hoc: every setting re-implements its own precedence inline, and
`--autonomy` has its own `resolveAutonomyOverride`.

## Decision

Make convention-over-configuration **structural**: a single config-path catalog plus a single
precedence resolver, so every surface — init wizard, `arbiter settings`, `arbiter configure`, env,
per-run override, `arbiter doctor` — is fed from the same place. `--autonomy` becomes an instance of
the general mechanism, not a special case.

1. **Ratify the SSOT boundary (Q1).** `arbiter.json` is the Project Profile (single source).
   `arbiter configure` and the init wizard edit it; `arbiter settings` is the read-only discovery
   view; `.claude/settings.json` stays harness-only. No second surface.

2. **One unified override grammar — `--set <path>=<value>` (repeatable), not N bespoke flags (Q4).**
   It reuses the existing catalog + validators in `src/commands/configure.ts`. Per-run overrides are
   gated by a curated **`OVERRIDABLE_PATHS`** subset (the `automation.*` orchestration knobs) —
   deliberately _not_ all of `ALLOWED_PATHS` (e.g. `governanceLevel` must not be per-run-flipped).
   `--autonomy` survives only as ergonomic sugar desugaring to `--set automation.autonomy=…` — same
   validator, same resolver, no special case. (`--gate-level` may follow as a second alias.) This
   retires the bespoke `resolveAutonomyOverride` path.

3. **One precedence resolver.** A single `resolveSetting(path)` layers, in one place:
   per-run override (`--set` / alias) → **session** (`.claude/.task/status.json`) → env
   (`src/config/env-overrides.ts`) → `arbiter.json` profile → derived default
   (`src/config/collaboration-mode-defaults.ts`, the ADR-051 single derivation site). It replaces the
   scattered inline `?? ?? ??` chains; `resolveShipProfile` becomes a caller, not a bespoke chain.
   Side benefit: routing `--autonomy` through the session layer makes it survive a mid-wave `/clear`
   (today it does not), matching the `tier` precedent.

4. **Profile fields become pure data (Q3 residual).** Extend `AutomationConfig` with optional
   `maxParallelWorktrees?: number`, `defaultGateLevel?: 'L1' | 'L2'`, `affinityBatching?: boolean`
   alongside `autonomy`. Because the catalog and resolver are unified, adding a field is one schema
   field plus one catalog entry, and the wizard / settings / configure / env / `--set` / doctor pick
   it up for free — no new bespoke plumbing per field.

5. **Doctor coherence extension (Q6 residual).** `arbiter doctor` validates the new fields — e.g.
   `maxParallelWorktrees > 1` is incoherent with `collaborationMode: trunk-solo` (worktree: never);
   `defaultGateLevel: L1` is incoherent with L3/L4 governance — extending the ADR-051/093 matrix in
   `src/commands/wizard/coherence.ts`.

6. **Dual-sided (Q7).** Generated consumer projects inherit the profile block and the same flag-free
   ergonomics, within the ADR-093 §5 self-only boundary.

## Consequences

### Positive

- One mental model: a path is settable, overridable, and coherence-checked through a single catalog
  and a single resolver. New profile knobs cost one schema field + one catalog entry.
- Flags stop proliferating: `--set` plus a couple of ergonomic aliases replace a per-knob flag zoo.
- `--autonomy` (and any future override) resolves through one tested precedence path and gains
  `/clear` stickiness for free via the session layer.
- The override surface is auditable: `OVERRIDABLE_PATHS` is the explicit allow-list of what a single
  run may change, separate from what `configure` may persist.

### Negative

- Introduces a migration risk when the new `automation.*` fields land (`$schemaVersion` bump may be
  required) and grows the coherence matrix.
- A general `--set` grammar is more powerful than single-purpose flags; the `OVERRIDABLE_PATHS`
  allow-list must be curated conservatively to prevent unsafe per-run flips.
- Two implementation steps (resolver first, then fields) must land in order.

## Links

- Related ADRs: ADR-093 (dual-side ship, minimal `automation` block), ADR-051 (collaboration-mode
  axis + coherence matrix, single derivation site), ADR-088 (ship as orchestration entrypoint)
- Seed: `.arbiter/strategy/BRAINSTORM-project-profile-autonomy.md`
- Tracking issue: #1258 (brainstorm)
- Implementation issues: #1305 (unified override resolver + `--set` grammar, desugar `--autonomy`),
  #1306 (profile fields `maxParallelWorktrees` / `defaultGateLevel` / `affinityBatching` + doctor
  coherence; depends on #1305)
- Already shipped: #1121, #1259, #1260, #1261, #1291, #1292

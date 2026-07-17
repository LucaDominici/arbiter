---
title: 'ADR-106: Codex-track parity contract — derive-from-Claude + gate-enforced parity surface'
doc_version: '1.0.0'
status: active
last_review: '2026-07-16'
owner: ''
canonical_id: '106'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-106: Codex-track parity contract — derive-from-Claude + gate-enforced parity surface

**Project:** arbiter
**Date:** 2026-07-16
**Status:** Accepted

## Context

Arbiter generates two governance tracks:

- Claude: `CLAUDE.md`, rules, hooks, agents, skills, and commands.
- Codex: `CODEX.md`, a shared-rule subset, `codex-adapter.mjs`, and `config.toml`.

Empirical triage for issue #1966 found no drift in shared generators: 153 of 153 generated
files were byte-identical under equivalent configuration.

Drift exists in parallel Codex-only copies:

- The Codex `90-exec-protocol` rule omits the complete CANON-22 Root-Cause Discipline
  section, removing one hard stop for Codex agents.
- The `CODEX.md` Known Limitations table documents 10 Claude hooks while the Claude track
  emits substantially more relevant hooks; the remainder are neither bridged nor declared
  as gaps.

Parallel maintenance therefore weakens governance guarantees and makes documentation
unreliable.

## Decision

Shared rules SHALL use a derive-from-Claude model.

Claude rule templates are the single canonical source. The Codex generator SHALL derive
Codex representations from those templates instead of maintaining parallel Codex-only
copies.

The repository gate SHALL include a parity check (`scripts/check-codex-parity.mjs`,
following the `check-self-dogfood` pattern). It SHALL:

1. Compare normalized generated representations derived from the canonical source.
2. Fail on any non-allowlisted divergence.
3. Validate that every allowlisted divergence is explicit, intentional, and covered by
   tests.
4. Fail when the generated `CODEX.md` Known Limitations table does not match the actual
   Claude hook inventory.
5. Detect missing, stale, duplicated, or incorrectly classified hook entries.

Every file emitted by either track root is classified into exactly one parity class —
DERIVED, ALLOWLISTED, or BY-DESIGN-EXCLUSIVE — and the classification surface must cover
100% of the emitted files (an unclassified emission is a gate failure).

Intentional platform differences SHALL be represented by a narrow, explicit allowlist
(`scripts/data/codex-parity-allowlist.json`). The allowlist SHALL include rationale and
automated coverage, and every entry must stay current (a stale entry is a gate failure).

Native hooks, skills, agents, and commands remain Claude-only by design. They are outside
Codex feature-parity scope. Exclusivity is declared, never inferred: every
BY-DESIGN-EXCLUSIVE item carries an explicit reviewed declaration
(`scripts/data/codex-parity-exclusive.json`).

Their absence SHALL be recorded in a generated Known Limitations table derived from the
actual generated inventories. The table SHALL NOT be maintained manually.

Per-track file counts and identities are ratcheted against a committed baseline
(`scripts/data/codex-parity-baseline.json`) compared at the merge-base with `origin/main`;
unexplained shrinkage is a gate failure, and missing merge-base history fails closed.

`codex-adapter.mjs` and `config.toml` remain Codex-specific outputs. Their
platform-specific behavior does not require structural identity with Claude artifacts,
but any governance divergence remains subject to the parity contract and allowlist.

## Testing

The full test protocol — non-vacuity mutations (CANON-22 drop, Known-Limitations drift,
allowlist staleness, missing/extra emissions, wrong exclusivity), golden evolution
protocol, coverage axes, failure playbook, and exact gate commands — is defined in the
runbook: `docs/internal/METHOD/CODEX_PARITY_RUNBOOK.md`. The operator-facing entry for
gate failures is `website/problems/codex-parity.md`.

## Consequences

### Positive

- CANON-22 and future shared-rule changes propagate automatically to Codex.
- Unintentional governance weakening becomes a gate failure.
- Known Limitations becomes inventory-backed and cannot silently become stale.
- Shared-rule maintenance moves to one canonical template set.

### Negative

- Codex generation requires normalization and derivation logic.
- Intentional differences incur explicit allowlist and test maintenance.
- Claude-only capabilities remain unsupported in Codex without being misrepresented as
  parity gaps or bridge coverage.

## Alternatives Considered

### Keep parallel Claude and Codex rule copies

Rejected. It preserves the failure mode demonstrated by the missing CANON-22 section and
requires manual synchronization.

### Compare generated files byte-for-byte

Rejected. Platform-specific wrappers and formatting make raw equality too strict.
Normalized semantic comparison isolates governance-relevant divergence.

### Maintain Known Limitations manually

Rejected. Manual documentation already diverged from the emitted hook inventory and
provides no enforceable completeness guarantee.

### Require full Codex implementation of all Claude capabilities

Rejected. Native hooks, skills, agents, and commands are Claude-only by design. The
contract requires accurate generated disclosure, not artificial implementation parity.

## Links

- Related ADRs: ADR-095 (supported AI tools: claude + codex), ADR-002 (thin pointer pattern)
- Issues: #1966

## Amendment (2026-07-17, #1966) — self-track scope extension

The parity contract extends to **arbiter's own materialized codex track**: the
`.agents/**` and `.codex/**` files committed in this repository.

The original gate (`scripts/check-codex-parity.mjs`) satisfies the SHALL clauses above
for **generated output**: it bakes a fixture project into an empty directory and verifies
the fresh emission. It is structurally blind to the repository's own materialized copies
— a bake into an empty directory can never observe rot in files that already exist. The
rot vector is `skipIfExists: true` on the derived rules and the adapter: once
materialized, `arbiter update` never refreshes them in place, and no gate read the self
roots at all. Confirmed live rot found this cycle: the materialized
`.agents/rules/90-exec-protocol.md` was missing the entire CANON-22 Root-Cause Discipline
section (the exact regression that motivated this ADR, alive in self-config), the derived
rules `50-batch-execution` and `60-incidental-capture` were missing entirely,
`.agents/CODEX.md` carried a hand-rolled static Known-Limitations table predating the
generated one, and `.codex/config.toml` lacked the current `check-no-skipped-tests`
wiring.

The self-config half of the contract is closed by a second gate,
`scripts/check-codex-self-parity.mjs`. It SHALL:

1. Emit the codex track fresh via the repository's own generator and resolved config
   into an empty temp directory, so `skipIfExists` can never suppress output.
2. Compare the emission against the materialized `.agents/**` + `.codex/**`, stripping
   repo-side leading doc-frontmatter before compare.
3. Classify every repository file under those roots into exactly one class —
   EMITTED-MATCH, PINNED, or RUNTIME-ARTIFACT — with 100% coverage. An unclassified
   file, or an emitted file with no repository counterpart, is a gate failure.

Intentional divergences live in `scripts/data/codex-self-parity-divergences.json` (dated
rationale + content-hash pins, CANON-14 semantics; a drifted, healed, or dead pin is a
gate failure). Declared repo-runtime artifacts — files the repository legitimately writes
under the roots but the generator never emits, e.g. `.agents/plan/PLAN.json` — live in
`scripts/data/codex-self-parity-runtime-artifacts.json`. Exit codes are 0/1/2
fail-closed. The check runs in the L2 gate immediately after `codex parity (#1966)`; CI
inherits it via check-all L2.

Together the two gates complete the contract: the fixture gate proves that fresh
emissions match the canonical source; the self-parity gate proves that arbiter's own
materialization matches today's fresh emission. The rotted files above were
re-materialized in the same change; the gate keeps them current mechanically.

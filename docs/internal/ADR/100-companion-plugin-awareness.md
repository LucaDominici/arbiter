---
title: 'Companion-plugin awareness in /ship'
doc_version: '1.0.0'
status: active
last_review: '2026-07-01'
owner: ''
canonical_id: '100'
tags: ['audience/dev', 'kind/adr']
related: ['093-dual-side-ship-orchestrator', '094-project-profile-resolver']
---

# ADR-100: Companion-plugin awareness in /ship

**Project:** arbiter
**Date:** 2026-07-01
**Status:** Accepted

## Context

arbiter fights over-engineering **detectively, at gate-time**: jscpd (duplication ratchet), knip
(dead code), the complexity ceiling, CANON-16 refactor-first. It has no mechanism that biases the
agent **preventively, at drafting-time** — nothing that makes it write _less_ in the first place.

External **companion** plugins fill exactly that gap. The motivating case is
[ponytail](https://github.com/DietrichGebert/ponytail) (MIT): a persistent "lazy senior dev" persona
that climbs a YAGNI ladder (reuse → stdlib → native → shortest diff) before writing. A trial on the
a prior internal product repo showed ponytail surfaces real, systemic duplication (11 domain packages
reimplementing the same `ValidationError`/`ValidationErrors` pattern, already drifted into two
inconsistent implementations) that arbiter's _syntactic_ gates miss by construction. The two are
orthogonal — prevention at prompt-time vs detection at gate-time — hence genuinely complementary.

Users already run companions (superpowers, caveman are installed). We want arbiter to recognise and
compose with them **as a system**, not ad hoc — and to do so **without vendoring** any companion's
code (interoperability, not derivation), and **without taking a hard dependency**: absent companion ⇒
`/ship` behaves exactly as before.

## Decision

Make `/ship` companion-aware through a small, extensible registry — **not** a plugin runtime.

1. **Registry (reuse, don't duplicate).** Extend the existing `SkillEntry` in
   `src/integrations/skills-matrix.ts` with an optional `companion?: CompanionPolicy`
   (`label`, `defaultMode: lite|full`, optional `greenInstruction`). ponytail is one entry. Adding a
   future companion is one entry. `bareName` is promoted to a shared export (was duplicated).
2. **Resolution (home-only, primitives-only).** `src/integrations/companions.ts` `resolveCompanions`
   reuses the hardened `detectInstalledSkills` in **HOME-ONLY** mode (`targetDir:''`) — the target
   repo is never scanned, so a hostile project cannot spoof activation by committing
   `.claude/plugins/ponytail`. It takes primitives (`self`, `claudeHome`, override map), never a
   `ShipProfile`, so `ship-profile.ts` can value-import it without an import cycle.
3. **Composition.** `ShipProfile.companions` is resolved once (empty on arbiter-self). The `green`
   phase action appends the companion's YAGNI instruction; `buildShipStepLines` prints a
   `Companion:` announcement line iff non-empty (mirroring the "surfaced, not faked" self-only-checks
   rendering).
4. **Policy (the agreed "smart" way).** Product repos only, **never arbiter-self** (its complexity is
   load-bearing). `lite|full` only, **never `ultra`** (ultra skips tests → violates TDD/INV-26).
   arbiter's gates remain the safety net if the persona cuts too much. Optional `arbiter.json`
   `companions` map disables/downgrades per companion; absent ⇒ auto-activate in policy default.
5. **Measurement contract.** During `/ship` verification, a product repo with at least one active
   companion writes `.arbiter/evidence/companions/<task-id>.json` (`CompanionEvidenceV1`) containing
   the active companion ids/modes, branch diff stats, and `recordedAt`. Companion-free runs and
   arbiter-self write nothing. The evidence is observational only; no gate consumes it yet.

## Consequences

### Positive

- Closes a real gap: drafting-time minimalism arbiter's detective gates cannot provide.
- Extensible "plugin-aware" spine: one registry entry per future companion.
- Zero coupling / zero risk: no vendored code, no hard dependency, graceful degradation, honest
  announcement so composition is visible and auditable.
- Reuses `detectInstalledSkills` + `SKILLS_MATRIX` + `bareName` (CANON-22, no duplication).

### Negative

- One more optional `arbiter.json` field to document.
- Companion behaviour is opaque to arbiter (it is an external persona) — mitigated by keeping the
  gates authoritative and never running `ultra`.
- Adds ponytail to the `SKILLS_MATRIX`/replacement-matrix SSOTs (kept in parity, `beta` status).
- Known tension: ponytail may push "remove abstraction" while Architecture/Domain auditors defend
  load-bearing structure. Both remain advisory; the evidence stream gives future reconciliation work
  real per-task data instead of a faith-based claim.

## Links

- Related ADRs: ADR-093 (dual-side ship orchestrator), ADR-094 (project-profile resolver)
- Issues: #1730

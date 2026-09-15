# #2677 — promote seven absence gates to executable flip proof

## Goal

Replace the seven CANON-25 deferrals with bad/clean fixtures that prove each gate observes its
intended subject: a violated absence exits 1 and the corresponding clean fixture exits 0. Lower the
deferral ceiling once per promoted gate. Keep the existing guard-flip harness and gate roster as the
only authorities.

## Delivery

1. **Workflow guards (this slice)**
   - Reuse the existing fail-closed `--dir` support in workflow integrity and workflow parallelism.
   - Add the same fail-closed root semantics to unwired guards and its standalone emitted template.
   - Add flip fixtures for all three, remove their ledger rows, and lower both ceiling pins 22 → 19.
   - Verify bad=1/clean=0 per gate, generated-template parity, `deferred=19`, and
     `ledger-problems=0`.
2. **Generated truth guards**
   - Add minimum root injection only where still absent for llms.txt, API snapshots, and GOLD
     registries.
   - Add coherent bad/clean fixtures, remove the three ledger rows, and lower 19 → 16.
3. **Examples drift**
   - Reuse the existing generator/check path or add only the missing root argument.
   - Prove drift and clean regeneration, remove the final row, and lower 16 → 15.

Each delivery lands independently through `/ship`; later slices re-ground on current `main`.

## Verification contract

- Every promoted registry entry rejects its planted bad fixture with exit 1.
- Every promoted registry entry accepts its clean fixture with exit 0.
- Missing, empty, flag-shaped, or nonexistent explicit roots exit 2.
- The committed deferral ledger length, its `ceiling`, and `MAX_DEFERRED` remain equal.
- `node scripts/check-guard-flip.mjs` reports no vacuous or uncovered gates and no ledger problems.
- Targeted Vitest, generated-template parity, format, lint, and the native final gate pass on one
  frozen HEAD before PR/CI/merge.

## Acceptance Criteria

- [ ] AC-2677.1: The three workflow gates get a `--dir`/root injection where needed and a flip
  fixture proving non-zero exit on the violated absence.
- [ ] AC-2677.2: Their three ledger rows are removed and `MAX_DEFERRED` plus the ledger `ceiling`
  are tightened from 22 to 19.
- [ ] AC-2677.3: `check-guard-flip` reports `deferred=19` and `ledger-problems=0` for this delivery.

## Non-Goals

- Replacing the guard-flip harness, evidence store, gate roster, or `/ship` lifecycle.
- Combining the seven independent gate implementations into a new generalized framework.
- Changing what the seven product gates classify beyond the root injection required for proof.

## Scope controls

No new evidence store, registry, abstraction, dependency, workflow, or issue. Documentation changes
are limited to this executable plan and user-facing help that changes with `--dir`.

# ADR-014: Tech Debt Prevention Strategy — Foundation-First Milestone Resequencing

**Status:** Accepted
**Date:** 2026-04-02
**Deciders:** Luca Dominici

## Context

A retroactive analysis of M1-M11 (comparing Arbiter's generated output against the production baseline enforcement) uncovered systemic gaps:

- **5 CRITICAL findings:** Go and Python stacks produce non-functional output — empty CI jobs that always pass, empty gate scripts that check nothing, no coding standards, no invariants. Users of these stacks get decorative governance with zero enforcement.
- **8 MAJOR findings:** INV-01 (circular deps), INV-02 (public API), INV-05 (dead code) have zero enforcement. INV-08 (no main commits) has no local enforcement. Documentation references `.sh` filenames while hooks are `.mjs`. Cross-product tests validate broken output as expected behavior.
- **14 MINOR findings:** Dead `.sh` hook files, inconsistent backup suffixes in docs, missing Dependabot ecosystems, TypeScript-specific lines in stack-agnostic templates.

Additionally, Arbiter does not generate any tech debt prevention tooling (coverage thresholds, complexity limits, dead code detection) for any stack — and has none configured for its own codebase either.

The original feature request was for a **novel anti-tech-debt mechanism** (something that doesn't exist even in the prior-art baseline). However, building this on a broken foundation would compound the problem.

## Decision

Insert 5 new milestones (M12–M16) before the previously planned M12–M16 (now renumbered M17–M21). The new milestones follow a strict bottom-up order:

| New # | Old # | Name                                        | Why this position                                                              |
| ----- | ----- | ------------------------------------------- | ------------------------------------------------------------------------------ |
| M12   | NEW   | Go/Python Stack Parity                      | Fix CRITICAL bugs first — everything else depends on all 5 stacks working      |
| M13   | NEW   | Documentation Alignment + Retroactive Fixes | Can't trust docs for new work until drift is resolved                          |
| M14   | NEW   | Arbiter Self-Enforcement                    | Dog-food before generating for users                                           |
| M15   | NEW   | Generated Per-Stack Tech Debt Gates         | Generate the enforcement (coverage, complexity, dead code) for target projects |
| M16   | NEW   | Novel Anti-Tech-Debt Mechanism              | The original feature request, built on solid foundations                       |
| M17   | M12   | Advanced Hooks                              |                                                                                |
| M18   | M14   | Rich Invariant Catalog                      | Moved after M12 so Go/Python invariants exist                                  |
| M19   | M13   | Skills & Sub-Agents                         |                                                                                |
| M20   | M15   | SSOT Framework                              |                                                                                |
| M21   | M16   | Richer GitHub Integration                   |                                                                                |

### Testing Protocol (mandatory per milestone)

Every milestone must be validated on **real open-source projects from GitHub** — one per supported stack:

1. Clone a real project (TypeScript, Rust, Java/Gradle, Java/Maven, Go, Python)
2. Run `arbiter init` from a clean state
3. Verify: all generated files are syntactically correct and functionally active
4. Verify: gate script runs meaningful checks (not "ALL PASSED" with zero checks)
5. Verify: CI workflow would succeed on the project
6. **Regression scope:** test the current milestone's changes PLUS all previous milestones' functionality
7. Attach test report as a comment on the milestone's GitHub issue

## Rationale

**Why bottom-up:** Building features (hooks, skills, SSOT) on top of broken Go/Python support and unenforced invariants creates compounding tech debt. Fixing foundations first means later milestones build on verified, working infrastructure.

**Why real-project testing:** Unit tests verified that Go/Python produce empty output and marked it as "expected behavior." Only integration against real projects surfaces these failures. Fixture-based tests are necessary but not sufficient.

**Why novel anti-debt before advanced hooks:** The anti-debt mechanism may itself require hooks or extend the hook system. Designing it before the advanced hooks milestone allows the hook architecture to accommodate debt detection from the start.

**Alternatives considered:**

- **Parallel tracks** (fix foundations + build features simultaneously): Rejected. Shared template files mean merge conflicts and rework.
- **Skip Go/Python** (mark as "experimental"): Rejected. Arbiter's value proposition is "any project in one command." Half-broken stack support undermines trust.
- **Merge M12+M13** (one big cleanup milestone): Rejected. Mixing template code changes (M12) with documentation-only changes (M13) complicates review and rollback.

## Consequences

**Positive:**

- All 5 stacks produce functional governance before any new features are added
- Documentation matches reality before users encounter discrepancies
- Arbiter dog-foods its own enforcement before generating for others
- Each milestone has a concrete, verifiable exit gate (real-project test reports)

**Negative:**

- Previously planned M12–M16 features are delayed by 5 milestones
- Feature comparison score (currently 37/85) will not increase until M17+
- More milestones to track (21 total vs 16)

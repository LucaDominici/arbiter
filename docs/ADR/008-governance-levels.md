# ADR-008: Governance levels L1/L2/L3

**Status:** Accepted
**Date:** 2026-04-01
**Deciders:** Luca Dominici

## Context

Different development phases have different quality gate needs. Pre-commit hooks must be fast; CI must be thorough; audit-grade repos need evidence artifacts. A single gate level forces a trade-off between speed and thoroughness.

## Decision

Three gate levels, strictly nested (L1 ⊂ L2 ⊂ L3):

| Level | Checks | Default use |
|-------|--------|-------------|
| L1 | Format + lint + unit tests | Pre-commit (fast) |
| L2 | L1 + integration + coverage + audit | Pre-push, CI (default) |
| L3 | L2 + E2E + evidence artifacts | Release, audit-grade repos |

## Rationale

- L2 is the default because it matches CI exactly -- local and CI are the same gate, so "works locally" means "will pass CI".
- L1 exists for speed in tight iteration loops (pre-commit hook).
- L3 exists for repos with compliance or audit requirements (viafera being the reference implementation).
- Strict nesting ensures L2 never passes while L1 fails.

## Consequences

**Positive:**
- Local-CI parity: developers know that passing L2 locally means CI will pass.
- Fast feedback during development (L1) without sacrificing thoroughness at push time (L2).
- Audit-grade repos get a dedicated level (L3) without burdening everyday development.

**Negative:**
- Three levels add conceptual overhead for new contributors.
- L3 evidence artifact generation may be slow, discouraging its use outside release workflows.
- Custom checks that don't fit neatly into the three levels require project-specific configuration.

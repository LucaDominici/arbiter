# Test Taxonomy — arbiter

<!-- arbiter-managed: test-pyramid-profile (INV-89) -->
<!-- Archetype: library -->

This document defines the test pyramid for **arbiter**.
Each level maps to a CI stage in `ci.yml` and a check in `scripts/check-all.mjs`.

---

## Pyramid Levels

| Level                 | Description                                                           | Tools                                          |
| --------------------- | --------------------------------------------------------------------- | ---------------------------------------------- |
| **L1 Unit**           | Unit tests for all public API surface — every exported function/class | `JUnit/pytest/vitest/cargo test`               |
| **L2 Property-Based** | Generative / property-based tests to find edge cases                  | `fast-check, Hypothesis, proptest, QuickCheck` |

---

## Conventions

- **L1 tests** run on every commit (pre-commit hook via `scripts/check-all.mjs L1`).
- **L2+ tests** run on push/PR (`scripts/check-all.mjs L2`).
- Test files live next to the code they test (co-located) or in a top-level `tests/` directory.
- Every public function/method must have at least one test.

- Property-based tests must cover all public API inputs. Use `fast-check` / `Hypothesis` / `proptest`.

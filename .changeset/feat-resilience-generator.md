---
'arbiter': minor
---

feat(governance): resilience patterns generator (#1176)

Adds `src/generators/resilience.ts` — a stack-aware advisory generator for
`backend-web-db` projects at L2+. Emits `docs/governance/RESILIENCE.md` with
copy-pasteable defaults for circuit breaker, retry/backoff, rate limiter, and
timeout budgets. TypeScript (cockatiel) and Java (Resilience4j) get concrete
config blocks; `multi` emits both; Go/Python/Kotlin degrade gracefully. L3/L4
governance level appends a hard-requirements enforcement addendum.

- CANON-04: template render test
- CANON-05: generator unit tests (happy path, idempotency, negatives, null-guard)
- CANON-11: brownfield skipIfExists test
- FEATURE_MATRIX: REQ-051 row, status Done
- No new INV — advisory pattern, not machine-enforceable in arbiter self-gate

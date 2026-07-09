---
'@arbiter/cli': patch
---

Fix Java's generated BDD example (`ExampleBddIT.java`) so it actually runs
green instead of silently failing once wired up (#1042/#1840). The generator
now also emits `ExampleSteps.java`, the Cucumber glue for `example.feature`'s
Given/When/Then steps — without it the suite resolved every step as UNDEFINED
and failed (Cucumber is strict by default), the same class of gap Go/Rust/TS
already close by shipping their step definitions alongside the suite/runner.
The generated `check-test-naming.mjs` Java check no longer flags non-test
support classes under `src/test/java` that aren't JUnit/Suite entry points
(mirrors the existing Go/TypeScript content-based heuristics), so the new
glue class doesn't trip the naming gate.

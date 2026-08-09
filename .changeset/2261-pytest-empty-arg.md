---
'@arbiter/cli': patch
---

Fixed the generated Python `check-all.mjs`'s "unit tests" (and L2 "audit")
checks emitting a spurious empty-string positional arg (`pytest ''`) for a
zero-arg gate-registry command. That extra `''` made `pytest` bypass
`pyproject.toml`'s `testpaths` scoping and collect the whole `tests/` tree
(including the playwright-only `tests/e2e/`), failing the generated
project's own L1 gate on first run.

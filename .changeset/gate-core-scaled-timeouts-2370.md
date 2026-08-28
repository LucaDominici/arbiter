---
'@arbiter/cli': patch
---

Gate step timeouts now scale with the available CPU cores, allowing the full gate to run
on supported 4-core machines. Timed-out steps are reported as `TIMEOUT` instead of a
generic `FAIL`, while retaining the same fail-closed exit behavior.

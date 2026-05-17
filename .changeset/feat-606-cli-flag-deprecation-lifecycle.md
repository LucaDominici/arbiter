---
'@arbiter/cli': minor
---

Add CLI flag deprecation lifecycle (#606). Introduces three-stage deprecation: `warn` (flag passes through with stderr notice), `hide` (flag suppressed from --help with notice), `remove` (flag rejected with replacement hint). Lifecycle enforced by `check-deprecations.mjs` gate. Registry ships empty; flags added as they are deprecated.

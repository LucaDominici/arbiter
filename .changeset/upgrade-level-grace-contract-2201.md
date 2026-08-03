---
'@arbiter/cli': patch
---

`arbiter upgrade-level` now rejects grace transitions other than L1 to L2, so
unsupported upgrades cannot persist a grace window ignored by generated gates.

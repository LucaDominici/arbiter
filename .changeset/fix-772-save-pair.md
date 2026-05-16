---
'@arbiter/cli': patch
---

fix(#772): replace sequential saveConfig+saveSnapshot with saveConfigAndSnapshot — serializes once before any write, preventing inconsistent state on ENOSPC

---
'@arbiter/cli': patch
---

fix(#773): route writeTaskStatus through atomicWrite — tmp file now registered in inFlightTmpPaths for SIGTERM cleanup

---
'@arbiter/cli': patch
---

Fixed `arbiter doc-set` / `arbiter gold-audit` crashing with `MODULE_NOT_FOUND` for every
real consumer install (npm registry or git dependency). `package.json`'s `files[]` never
included `scripts/`, but both commands shell out to `scripts/check-doc-set.mjs` /
`scripts/gold-audit.mjs` (and their shared lib deps) at runtime — the bug was invisible on
this dev checkout, where `arbiter` is globally linked straight to the source tree.

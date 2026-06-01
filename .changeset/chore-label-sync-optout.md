---
'arbiter': patch
---

chore(#1131): add DISABLE_LABEL_SYNC opt-out + prune live duplicate labels (slice 3)

`_label-sync` now skips when the `DISABLE_LABEL_SYNC` repo variable is `'true'`, so a repo that manages its own label taxonomy (the framework source repo) does not get `.github/labels.yml` additively injected into its live label set. arbiter-self sets the variable.

Also documents the two-taxonomy model (canonical shipped set vs arbiter-self's legacy namespaced labels) in `docs/GOVERNANCE/LABELS.md`; live duplicate-label pruning and the optional shape convergence are tracked in #1134.

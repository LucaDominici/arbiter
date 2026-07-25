---
'@arbiter/cli': patch
---

Drop the `-covermode=atomic` pin from the generated `scripts/evidence-collect.mjs` Go coverage step
(#2106) — the same cache-split class #2104 removed from `check-all.mjs`.

covermode is part of Go's test-cache key, so the pinned run shares nothing with the default-covermode
coverage run in the gate over the same packages and re-executes the whole suite (231.4 s vs 0.77 s
measured on a governed project). #2104 spared this call site on the assumption that evidence collection
runs on a fresh CI checkout with a cold cache; that assumption was never verified and is false — no
generated workflow invokes the script at all, so it runs where an operator runs it: the same working tree
as the gate, warm cache.

Statement coverage is unchanged; `atomic` is only required under `-race`, which collects no coverage here.

---
'@arbiter/cli': patch
---

Fixed `npm install github:LucaDominici/arbiter#<ref>` failing outright on some npm/git version
pairings (self-hosted CI runners observed it, exit 128 "fatal: not in a git directory"). The
`prepare` lifecycle script's `git config core.hooksPath` half — which only matters for a real
contributor checkout of this repo — could abort the whole install and skip
`scripts/prepare-lifecycle.mjs`, the half that actually builds `dist/` for a consumer. It now
tolerates that failure instead of propagating it.

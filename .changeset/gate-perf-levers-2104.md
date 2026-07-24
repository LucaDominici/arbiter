---
'@arbiter/cli': patch
---

Three measured gate levers ported into the generated gate (#2104). The emitted
`scripts/lib/run-helpers.mjs` gains `resolveTmpfsTmpdir()` and the emitted
`scripts/check-all.mjs` uses it to point `TMPDIR` at `/dev/shm` before any child
process spawns, but only when the caller has not set one and only when the tmpfs
has at least 4 GiB free — the guard is free space, never mere existence, because
`/dev/shm` defaults to 64 MB inside containers and `TMPDIR` also relocates Go's
build work dirs. On an fsync-bound DB-fixture suite this moved the same
`-count=1` coverage run from 210s at 21% CPU to 33.7s at 101% CPU. The Go
`coverage profile` step no longer pins `-covermode=atomic`: `debt-lib.mjs` reruns
the whole suite with the default covermode in the same gate and covermode
partitions Go's test cache, so the pin forced a full 231.4s second pass that is
now a 0.77s cache hit (statement coverage is identical between the modes). And
`scripts/lib/glob-walk.mjs`'s `walkRepo` now prunes nested checkouts — a git
worktree, submodule or vendored clone inside the working tree carries its own
`.git` and belongs to a different commit, so folding its files in made every
consumer (debt ratchet, secret scan, doc-link and TODO gates) measure the wrong
tree. Existing projects pick these up by re-running `arbiter update`; a
user-modified `scripts/check-all.mjs` is preserved, not overwritten, so it needs
a manual re-sync.

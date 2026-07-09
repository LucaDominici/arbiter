---
'@arbiter/cli': patch
---

Adds `.github/workflows/generator-matrix.yml`, a dedicated dispatchable +
weekly + pre-release entry point for arbiter's DEEP generator E2E cells (TS
packaged-artifact; Python/Go/Rust/Java fixture-functional), independent of
the broad nightly sweep that already runs them bundled (#1840 F4 tranche 2).
Kotlin is excluded — declassified to snapshot-only pre-publish (README
already didn't list it as supported; #1803 is the re-promotion path).
Toolchain-pin coherence (the #1854/#1856 incident class) is locked by a new
regression test sharing a `MIN_GO_FOR_PINNED_TOOL` registry with the
`_nightly.yml.ejs` guard.

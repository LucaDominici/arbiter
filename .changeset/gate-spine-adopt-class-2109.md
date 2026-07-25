---
'@arbiter/cli': minor
---

`arbiter update` now force-adopts the gate spine (`scripts/check-all.mjs`, `scripts/lib/*.mjs`) over a
user-modified copy, the way it already does for safety hooks (#2109).

Previously a project that edited its gate entrypoint once never received another correctness or security
fix for it: the file is `skipIfExists`, so it stayed withheld forever behind a warning. The failure was
self-sealing — `check-all.mjs` is also what wires the anti-erosion ratchet into the gate, so the guard was
delivered through the channel the erosion blocked.

Adoption is reversible (a `.arbiter/evidence/local-overrides/<slug>.json` envelope stores the prior content
verbatim), previewable with `--adopt-plan`, and opt-out-able with the new `--no-adopt-gate-spine` —
independent of `--no-adopt-safety`, so freezing a custom gate entrypoint never disarms safety-hook
adoption. A spine left frozen turns `check-safety-adopt-ratchet.mjs` red rather than hiding.

`scripts/check-*.mjs` leaf checks are deliberately NOT in the class: that is where a project tunes its own
thresholds.

**Upgrade note:** if you deliberately maintain a customized `scripts/check-all.mjs` or `scripts/lib/*.mjs`,
run `arbiter update --adopt-plan` first to see the diff, and pass `--no-adopt-gate-spine` to keep it.

---
'@arbiter/cli': minor
---

Add a `runnerProfile` config axis (`solo` | `fleet`) to the CI cadence model
(ADR-101). `fleet` is the default and is byte-identical to the previous output:
the heavy scheduled jobs (fuzz, soak-e2e) stay in the nightly workflow with the
full nightly hard gate. `solo` moves those jobs to the weekly workflow for
resource-constrained single-runner setups, preserving enforcement: the weekly
gate hard-fails on a fuzz/soak failure and still files a regression issue. The
axis is wired through the wizard (new select prompt), `arbiter.json` schema
validation, config diff (scoped regeneration of GitHub workflows), and
persistence (the `fleet` default is collapsed to absence, so existing configs
are untouched).

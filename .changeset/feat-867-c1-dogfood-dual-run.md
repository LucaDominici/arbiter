---
'@arbiter/cli': minor
---

Phase C1 of #867: arbiter self-dogfoods the 8-tier CI structure. Generates `.github/workflows/0[1-9]-*.yml` from the templates introduced in #866. Adds `.arbiter/workflow-exemptions.json` mechanism (consumed by `scripts/check-arbiter-self-dogfood.mjs`) to allow listed files to be skipped during the dual-run window, paired 1:1 with sunset conditions in `docs/SYSTEM/CI-TIER-EXCEPTIONS.md`. Legacy 18-workflow set still active; PR-3 migrates orphan jobs and PR-4 deletes them.

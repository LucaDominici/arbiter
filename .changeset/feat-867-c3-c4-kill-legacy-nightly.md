---
'@arbiter/cli': minor
---

Phase C3+C4 of #867: remove the legacy `generateNightly` pipeline (superseded by the 8-tier model from #866). Deletes `src/generators/nightly.ts`, `src/templates/github/workflows/nightly.yml.ejs`, the `nightly` registry entry, and the M25 `generateNightly` cross-product tests. Also fixes `.github/workflows/security-scan.yml:24` — removes the `continue-on-error: true` on the gitleaks step so novel secret leaks block PR/merge instead of being silently advisory. Documents in `docs/SYSTEM/CI-TIER-EXCEPTIONS.md` that arbiter's 18 legacy workflows persist as arbiter's internal test suite while the 8 tier files are the public spec demo — original PR-3/PR-4 plan to fold all legacy into templates was the wrong architecture.

---
'arbiter': minor
---

feat(governance): GLOBAL_INVARIANTS↔catalog coverage parity gate (INV-110)

GLOBAL_INVARIANTS.md drifted to 53/107 invariant coverage with no guarding gate.
Added the 13 missing always-active invariants (INV-27/28/29/33/72/95/97/98/99/100/101/107/108)
and `scripts/check-global-invariants-parity.mjs` (L1) — forward (every alwaysActive
invariant documented) + reverse (no phantom rows), mirroring the AGENTS.md↔catalog
parity gate (CANON-08). Promoted to INV-110 (selfOnly governance) with AGENTS.md rows.
The dual-ADR consolidation + CLI-ref gate from the same task are recorded for a
careful follow-up in docs/audits/dual-adr-cli-followup-2026-06-02.md (the ADR store
has 8 id collisions + orphaned decisions — too risky to rush).

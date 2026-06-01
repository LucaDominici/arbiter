---
'arbiter': minor
---

feat(quality): CANON-22 evidence-based quality — un-blind gates + real DRY/duplication enforcement

**Un-blind (PART A).** Removed the blanket `ignoreIssues` mute from `knip.json` (a live CANON-09 violation — a gate that hid its own findings). Resolved the surfaced rot: deleted dead `src/context-pack/`, `src/commands/tooling-promote.ts`, the orphan `src/templates/css/.stylelintrc.json.ejs`, and the unused `src/kit/index.ts` barrel; wired the `integrations list` CLI command; gated the `pharma` generator behind `industryOverlay==='pharma'`; declared `src/adapters/index.ts` a knip `entry` (INV-88 surface). Fixed the vacuous `madge --circular src` (0 files scanned) → `--extensions ts,tsx,js,jsx` in arbiter CI, the generated `01-pr-fast.yml.ejs`, the qa-audit schema, and both `check-all` variants. The ~37 tested-but-uncalled exports knip masks are recorded as a tracked anti-bloat burn-down (`docs/audits/unwired-exports-2026-06-01.md`) where a hard `ts-prune` gate lands after burn-down — not muted, not faked.

**Real DRY / anti-bloat (PART B).** New `src/generators/duplication.ts` emits a governance-scaled `.jscpd.json` + the jscpd devDep to TypeScript targets (dual-sided with arbiter's own dogfooded `jscpd` gate). Added `duplicationPercentage` to the debt ratchet (Lehman entropy — a patch can't raise duplication). Added a root-cause-or-record-debt rule to `90-exec-protocol.md` and Anti-Bloat & Root-Cause vectors (symptom-vs-root-cause, dup-of-existing-helper, missed-extraction) to the red-team agent. Trimmed the `clean-code` skill to a gate-map.

**CANON-22 (PART C).** New `docs/SYSTEM/CANON.md` entry separating Tier-1 validated metrics (McCabe, CK/Basili, Khomh/Palomba, Juergens, Lehman, SEI/SQALE, Boehm) that may HARD-GATE from Tier-2 contested heuristics (SOLID, DRY-as-dogma, cognitive complexity) that may only advise. Graduated the duplication gate + ratchet to INV-109 with AGENTS.md↔catalog parity.

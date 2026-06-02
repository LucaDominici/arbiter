---
'arbiter': patch
---

fix(governance): collapse dual ADR store + CLI-ref single-source gate (INV-111)

Three-part governance hardening completing the deferred items from PR #1143:

**1. ADR dual-store collapse (Items 1+2)**

- Extracted 11 orphaned formal ADRs (ADR-077..087) from `docs/SYSTEM/DECISIONS.md`
  — decisions that existed only in the legacy log with colliding IDs:
  - ADR-077: Agent Registry Introduction (was ADR-053 in DECISIONS)
  - ADR-078: ISO 27001/NIS2/GDPR Compliance Gate Mapping (was ADR-052)
  - ADR-079: Red-Team SSOT Alignment Checks (was ADR-051)
  - ADR-080: Operations Handbook Generator (was ADR-049)
  - ADR-081: 25-Dimension Test Taxonomy Extension (was ADR-048)
  - ADR-082: MCP Fallback Determinism + Skip-Test Guard (was ADR-046)
  - ADR-083: Matrix Downgrade-vs-Fix Verdict (was ADR-043)
  - ADR-084: User-Toggle Catalog Preconditions (was ADR-044)
  - ADR-085: Evidence Prune + Red-Team SSOT Alignment Vectors (was ADR-047)
  - ADR-086: Four-Pillar SSOT Infrastructure (was mislabeled ADR-042 sub-entry)
  - ADR-087: Rust INV-04 Checkers + Rebased Docs-Check (was second ADR-042)
- Reduced `docs/SYSTEM/DECISIONS.md` to a **generated digest** (87-row ADR index,
  idempotent). Extended `scripts/gen-adr-readme.mjs` to emit both `docs/ADR/README.md`
  and `docs/SYSTEM/DECISIONS.md` from the same per-file SSOT parse.
- Wired `gen-adr-readme.mjs --check` into the L1 gate so digest can't drift.
- `check-adr-index.mjs` (INV-107) confirms: 87 ADR files, all IDs consistent, no dups.

**2. CLI-ref single-source gate (Item 4, INV-111)**

- Added `scripts/gen-cli-ref.mjs`: regex-parse `.command()` tree from `src/cli.ts`
  (no build step), emit a marker-delimited generated region into `website/reference/cli.md`.
  Bidirectional `--check`: registered ↔ documented, no phantom, no missing.
- 28 top-level commands now documented; 4 previously phantom command references
  (governance/use/state/version) confirmed not to exist (they were prose-only mentions).
- Wired as `cli ref parity (INV-111)` L1 gate.
- New invariant INV-111 registered in catalog, AGENTS.md, and GLOBAL_INVARIANTS.md.

**3. Item 3 (GLOBAL_INVARIANTS parity) — already done in #1143**

INV-110 + `scripts/check-global-invariants-parity.mjs` shipped in PR #1143 (commit
e73cdee0). Confirmed: 51 always-active invariants in parity, gate wired L1, passing.
Not rebuilt; stated explicitly to avoid silent scope drop.

Per-decision map (zero-loss proof): every heading in the old DECISIONS.md was assigned
(a) stale dup → drop (decision also in docs/ADR/) or (b) orphan → extracted to 077+
or (c) non-ADR commit-log entry → preserved in git history (not formal ADR).
Before: 76 ADR files. After: 87 ADR files. Zero decisions lost.

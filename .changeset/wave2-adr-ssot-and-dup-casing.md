---
'@arbiter/cli': minor
---

docs(#1099): Wave 2 — docs/ADR/ as canonical ADR SSOT + RUNBOOKS casing collapse

Track A: git mv docs/RUNBOOKS/ → docs/runbooks/ (case collision), update docs-backfill-tags.mjs, regenerate INDEX.md.

Track B: promote docs/ADR/ to canonical ADR SSOT (freeze docs/SYSTEM/DECISIONS.md as legacy); migrate DECISIONS-only ADR-054..072 into per-file docs; assign ADR-073 (FE Governance Generator, was accidental ADR-055 duplicate) and ADR-074 (Risk register, was accidental ADR-050 duplicate); fix docs/ADR/041-044 mis-titled frontmatter (were ADR-001..004, now ADR-041..044); populate canonical_id in all 74 ADR files; rewrite src/graph/builders/adr.ts to parse per-file YAML frontmatter instead of DECISIONS.md section-headings; regenerate docs/ADR/README.md via new generator; add scripts/check-adr-index.mjs gate (INV-97) to enforce unique numbers, canonical_id match, and README coverage at L1.

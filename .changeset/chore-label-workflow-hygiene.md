---
'arbiter': patch
---

chore(ci): prune no-consumer labels, define applied-but-undefined labels, fix trunk-solo nightly double-emit (#1131)

Slice 1 of the label + workflow hygiene wave:

- Generator: trunk-solo (incl. the `enableSoloDevMode` alias) at L3/L4 no longer emits both `06-nightly.yml` and `06-nightly-lite.yml`; it gets the lite nightly only (and not the full nightly/weekly/monthly suite), via `resolveCollaborationMode()` at both emit guards. Same root-cause fix also resolves the mode for the CI-gap guards (codeql/frontend-quality/OSSF), which previously read the raw (often undefined) `collaborationMode` and silently suppressed `15-codeql.yml` for default-resolved peer-review configs.
- Labels (dual-track `labels.yml.ejs` + `.github/labels.yml`): removed 10 no-consumer labels (`wave-0..3`, `quality-wave`, `approved`, `size: L`, `size: XL`, `ready-for-review`, `ai-generated`); added 5 applied-but-undefined labels (`in-progress` promoted to ALWAYS, `in-review`, `stale`, `no-stale`, `governance`).
- Docs: new `docs/GOVERNANCE/LABELS.md` catalogue — every surviving label cites its consumer — linked from the governance index.

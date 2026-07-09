---
'@arbiter/cli': patch
---

Wave F2 of the flagship epic (#1836): promotes 4 ceremony rules from prose-reviewed
to wired gates (#1838). CANON-10 (hook↔doc parity between `.claude/settings.json`
and `.claude/CLAUDE.md`) is now enforced by `check-hook-doc-parity.mjs`. INV-111 is
extended beyond the generated CLI-reference region to hand-authored prose
(PRIVACY.md, docs/, website/, excluding decision/roadmap archives and the
changelog) via `check-phantom-command-scan.mjs`. `check-version-parity.mjs` closes
the version-drift class fixed once already in F1 (#1837) by permanently checking
package.json, the compiled CLI's `--version` output, and CHANGELOG.md's top entry
all agree. `check-doc-links.mjs` now also scans website/ (previously excluded
outright over VitePress route false-positives — it now resolves `/`-absolute
routes and extensionless relative sibling links the same way VitePress itself
does) and self-referential `github.com/.../blob|tree/...` URLs anywhere in the
corpus, which caught 2 live dead links in `website/.vitepress/config.ts` (ADR
Ledger / Decisions nav entries still pointed at the pre-#1770 `docs/ADR` and
`docs/SYSTEM/DECISIONS.md` paths) and a dead `/privacy` route on the homepage —
all fixed in this PR alongside the gate that now guards them.

---
'arbiter-cli': patch
---

docs(wave1): Obsidian-friendly doc index + zero-risk deletes

- Enrich `docs/INDEX.md` generator: grouped by top-level directory,
  real markdown links (Obsidian-clickable + graph-wired, GitHub/VitePress-portable),
  `status` and `kind/*` tag per entry, `canonical_id` column retained.
- Export `collectDocs()` and `buildIndex()` from `scripts/gen-doc-index.mjs`
  for testability; add first unit test suite (15 tests, RED→GREEN).
- Switch generator from `import.meta.url` root to `process.cwd()` (consistent
  with other gate scripts; enables temp-dir CLI testing).
- Parse `tags: [...]` frontmatter arrays into `string[]` (was raw string).
- Delete three stale/wrong-stack docs: `docs/SYSTEM/CI-SMOKE.md` (stray
  timestamp), `docs/security/STRIDE.md` (empty casing-dup of
  `docs/SECURITY/STRIDE.md`), `docs/COMMANDS.md` (gradle/Java dogfood artifact).
- Add `*.bak.*` to `.gitignore` (anti-recurrence for timestamped generated backups).

---
title: 'Canonical Paths — arbiter'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: ['audience/dev', 'kind/ssot']
related: []
---

# Canonical Paths — arbiter

**Purpose:** Aliasing registry for documents that have moved or been renamed. Before reporting a broken link, check this file for a redirect.
**Location:** `docs/METHOD/CANONICAL_PATHS.md`

---

## Aliases

| Old Path                                        | Current Path                                             | Moved Date |
| ----------------------------------------------- | -------------------------------------------------------- | ---------- |
| `docs/ARCHITECTURE/CANONICAL-SOURCE-MODEL.md`   | `docs/architecture/CANONICAL-SOURCE-MODEL.md`            | 2026-05-19 |
| `docs/ARCHITECTURE/CONFLICT-RESOLUTION.md`      | `docs/architecture/CONFLICT-RESOLUTION.md`               | 2026-05-19 |
| `docs/ARCHITECTURE/OVERVIEW.md`                 | `docs/architecture/OVERVIEW.md`                          | 2026-05-19 |
| `docs/ARCHITECTURE/TEMPLATE-SYSTEM.md`          | `docs/architecture/TEMPLATE-SYSTEM.md`                   | 2026-05-19 |
| `docs/AUDIT/compat-fixes-854-855-2026-05-18.md` | `docs/audits/compat-fixes-854-855-2026-05-18.md`         | 2026-05-19 |
| `docs/RECIPES/B10-debug-mode.md`                | `docs/REFERENCE/recipes/B10-debug-mode.md`               | 2026-06-01 |
| `docs/RECIPES/perf-debugging.md`                | `docs/REFERENCE/recipes/perf-debugging.md`               | 2026-06-01 |
| `docs/RECIPES/sibling-worktree.md`              | `docs/REFERENCE/recipes/sibling-worktree.md`             | 2026-06-01 |
| `docs/RECIPES/cost-optimized-phase-handoff.md`  | `docs/REFERENCE/recipes/cost-optimized-phase-handoff.md` | 2026-06-01 |

---

## Usage

When a document is moved or renamed:

1. Add a row to the Aliases table above: `| \`old/path.md\` | \`new/path.md\` | YYYY-MM-DD |`
2. The `check-doc-links.mjs` gate will follow this redirect instead of reporting a broken link.
3. Do not remove old alias entries — they provide a permanent redirect trail.
4. Run `node scripts/check-canonical-paths.mjs` to verify all redirect targets exist.

---
title: 'Open arbiter as an Obsidian Vault'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: 'OBSIDIAN'
tags: []
related: []
---

# Open arbiter as an Obsidian Vault

The repository is configured as a browsable [Obsidian](https://obsidian.md/)
vault rooted at the repository root. Use it to navigate the doc graph,
preview cross-references, and search frontmatter.

## Setup (one-time)

1. Install Obsidian (free) for your platform.
2. Open Obsidian → "Open folder as vault".
3. Select the repository root (NOT `docs/` — the root contains AGENTS.md and
   GLOBAL_INVARIANTS.md which belong in the graph).
4. Accept the prompt to trust the vault.

The shared `.obsidian/` config (see "What lives in `.obsidian/`" below) is
committed; per-user UI state is gitignored.

## What lives in `.obsidian/`

| File                    | Committed | Purpose                                                          |
| ----------------------- | --------- | ---------------------------------------------------------------- |
| `app.json`              | yes       | Vault-wide settings: link format, attachment folder, ignore list |
| `core-plugins.json`     | yes       | Enabled core plugins                                             |
| `graph.json`            | yes       | Graph view defaults                                              |
| `workspace.json`        | NO        | Per-user open tabs + window state                                |
| `workspace-mobile.json` | NO        | Per-user mobile UI state                                         |

The ignore list under `app.json` skips `node_modules/`, `dist/`, `.git/`,
`.coverage-tmp/`, `.evidence/`, `report/`, `.changeset/`, and `api/` so the
graph stays focused on hand-authored docs.

## Conventions

- **Links are markdown, not `[[wikilinks]]`.** Obsidian renders standard
  `[text](relative/path.md)` natively; markdown links remain portable to
  GitHub and VitePress without a transform.
- **No callouts (`> [!note]`) in source.** They render as plain blockquotes
  on GitHub; only adopt them after every doc renderer in the toolchain
  supports them.
- **Tags follow the closed vocabulary in [`docs/METHOD/TAG_TAXONOMY.md`](docs/METHOD/TAG_TAXONOMY.md).**
- **Attachments go under `.obsidian/attachments/`** (configured in `app.json`).

## What Obsidian gives you

- Graph view across the hand-authored docs (skips generated and vendored).
- Frontmatter-aware search (e.g. `tag:#kind/adr status:active`).
- Backlinks panel — see which docs reference the current file.
- Local search across all 300+ docs without leaving the editor.

## What Obsidian does NOT replace

- The `docs/METHOD/KNOWLEDGE_MAP.md` curated navigation spine. Obsidian's
  graph is exhaustive; KNOWLEDGE_MAP is opinionated.
- The CI gate `scripts/check-doc-links.mjs`. Obsidian's broken-link UI is a
  hint; the gate is the contract.
- The `docs/METHOD/SSOT_CORE_SET.md` inventory. Obsidian lists every file;
  SSOT_CORE_SET lists the canonical ones.

---
generated: true
source: 'docs/METHOD/TAG_TAXONOMY.md'
source_sha: 'fbe31ffa9cc04fe11523b41807d5469f1d0da381'
last_updated: '2026-06-06'
---

# arbiter Tag Taxonomy

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/METHOD/TAG_TAXONOMY.md](../docs/METHOD/TAG_TAXONOMY.md)

# arbiter Tag Taxonomy

Closed vocabulary for the `tags:` frontmatter field. Adding a tag that is not
listed here is a CANON-16-style violation: extend this taxonomy first, then
use the tag.

Tags are populated by the P5 backfill pass of the docs frontmatter codemod.
Until then, every `tags:` field reads `[]`.

## Taxonomy

### Document kind

| Tag               | Purpose                                                        |
| ----------------- | -------------------------------------------------------------- |
| `kind/adr`        | Architecture Decision Record under `docs/ADR/`                 |
| `kind/runbook`    | Operational runbook (incident response, maintenance procedure) |
| `kind/spine`      | Directory index / spine README pointing at sibling docs        |
| `kind/ssot`       | Canonical source of truth governed by SSOT_CORE_SET            |
| `kind/canon`      | Process rule (CANON-NN entry)                                  |
| `kind/invariant`  | Invariant definition (INV-NN tier reference)                   |
| `kind/reference`  | Reference card; concise lookup material                        |
| `kind/method`     | Process / methodology document under `docs/METHOD/`            |
| `kind/audit`      | Snapshot or audit report under `docs/audits/`                  |
| `kind/migration`  | Migration guide under `docs/MIGRATION/`                        |
| `kind/setup`      | Install / setup / quickstart                                   |
| `kind/governance` | Governance / RACI / contributor policy                         |
| `kind/security`   | Security / compliance / threat model                           |
| `kind/api`        | Public API surface doc                                         |
| `kind/internal`   | Internal-only doc; not part of the public surface              |
| `kind/archive`    | Archived doc retained for historical context                   |

### Audience

| Tag                | For whom                                                       |
| ------------------ | -------------------------------------------------------------- |
| `audience/dev`     | Developers contributing to arbiter or building on it           |
| `audience/ops`     | Operators / SRE running arbiter or arbiter-scaffolded projects |
| `audience/agent`   | Read by Claude Code / agents during a task                     |
| `audience/auditor` | Compliance / regulatory reviewer                               |

### Lifecycle

| Tag                    | Meaning                                        |
| ---------------------- | ---------------------------------------------- |
| `lifecycle/draft`      | Work in progress; do not depend on contents    |
| `lifecycle/active`     | Current; safe to reference                     |
| `lifecycle/deprecated` | Superseded; pending removal                    |
| `lifecycle/archived`   | Kept for history only; no longer authoritative |

(Mirrors the frontmatter `status:` field; the tag exists so the taxonomy is searchable in tools like Obsidian.)

### Scope

| Tag                | Scope                                                        |
| ------------------ | ------------------------------------------------------------ |
| `scope/self`       | Concerns arbiter as a project (self-config)                  |
| `scope/framework`  | Concerns the framework arbiter scaffolds for target projects |
| `scope/dual-track` | Cross-cuts both; dual-track contract applies (CANON-16)      |

## Conventions

- Tags are kebab-case, prefixed by category (e.g. `kind/adr`, never `adr`).
- Multiple categories may apply (e.g. `[kind/adr, audience/dev, scope/dual-track]`).
- Tags are NOT GitHub issue labels; the two spaces share no namespace.
- Removing a tag from this taxonomy requires sweeping every doc that uses it.

## Adding a new tag

1. Confirm no existing tag covers the concept.
2. Open a docs PR adding the row to this file (CANON-16 dual-track does not apply — taxonomy is self-only).
3. Backfill any docs that should adopt the new tag in the same PR.

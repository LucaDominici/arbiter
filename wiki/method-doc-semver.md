---
generated: true
source: 'docs/METHOD/DOC_SEMVER.md'
source_sha: 'b06df8152e723198591cdb36e3810fb18829388a'
last_updated: '2026-06-07'
---

# Document Semver Policy (doc_version)

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/METHOD/DOC_SEMVER.md](../docs/METHOD/DOC_SEMVER.md)

# Document Semver Policy (`doc_version`)

Defines how the `doc_version:` frontmatter field on hand-authored .md docs is
bumped.

`doc_version` is **per-document content versioning** and is intentionally
distinct from the **product semver** described in [`../SEMVER.md`](../SEMVER.md).
The product semver governs the `@arbiter/cli` package; `doc_version` governs
the meaning of an individual document. Two axes, two registers.

## When to bump

### MAJOR (X.0.0)

| Trigger                                                                |
| ---------------------------------------------------------------------- |
| Section removed without an alias in `CANONICAL_PATHS.md`               |
| Stated policy reversed (e.g. recommendation flipped to anti-pattern)   |
| Document supersession (frontmatter `status: deprecated` or `archived`) |
| Schema of a referenced artifact changed in a way readers must re-learn |

### MINOR (x.Y.0)

| Trigger                                                                      |
| ---------------------------------------------------------------------------- |
| New section added                                                            |
| New rule added to an existing list (e.g. INV-NN appended to invariant table) |
| New example, diagram, or worked-through scenario                             |
| Expanded scope of existing content (audience widened, additional rationale)  |

### PATCH (x.y.Z)

| Trigger                                     |
| ------------------------------------------- |
| Typo fix, grammar polish, formatting        |
| Link target updated to a canonical path     |
| Wording clarified without changing meaning  |
| Line counts refreshed in `KNOWLEDGE_MAP.md` |

## Defaults

- New documents start at `doc_version: "1.0.0"`.
- The frontmatter codemod (`scripts/docs-add-frontmatter.mjs`) sets `1.0.0`
  for every doc that lacks the field; subsequent edits MUST bump per the
  matrix above.

## Conflicts with product semver

The two axes never share a number. A doc-only PR that bumps `doc_version`
on a single file does NOT bump the `@arbiter/cli` package version. A product
MAJOR release does NOT bump every `doc_version` to MAJOR.

If a product MAJOR change requires docs to be rewritten, the _affected_
docs bump their own MAJOR independently when their content changes.

## Verification

`scripts/check-doc-style.mjs` (planned, P8) enforces:

- Every required frontmatter key is present
- `doc_version` matches the semver shape `\d+\.\d+\.\d+`
- `last_review` is ISO date format
- `status` is one of `draft | active | deprecated | archived`

Until P8 ships, the codemod's `--check` mode is the de facto guard.

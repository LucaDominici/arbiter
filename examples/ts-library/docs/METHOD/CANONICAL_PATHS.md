# Canonical Paths — ts-library-fixture

**Purpose:** Aliasing registry for documents that have moved. Before reporting a broken link, check this file for the current location of the referenced document.
**Location:** `docs/METHOD/CANONICAL_PATHS.md`

---

## Aliases

| Old Path | Current Path | Moved Date |
|----------|--------------|------------|

---

## Usage

When a document is moved or renamed:

1. Add a row to the Aliases table above: old path → new path + ISO date.
2. Do **not** remove the old entry until all references are updated.
3. Run `node scripts/check-doc-links.mjs` to verify no broken links remain after the redirect is added.
4. Run `node scripts/check-canonical-paths.mjs` to confirm the new path exists.

> Entries may be purged once all references are updated and the old path no longer appears in any document.

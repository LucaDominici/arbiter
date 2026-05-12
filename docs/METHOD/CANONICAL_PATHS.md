# Canonical Paths — arbiter

**Purpose:** Aliasing registry for documents that have moved or been renamed. Before reporting a broken link, check this file for a redirect.
**Location:** `docs/METHOD/CANONICAL_PATHS.md`

---

## Aliases

| Old Path | Current Path | Moved Date |
| -------- | ------------ | ---------- |

---

## Usage

When a document is moved or renamed:

1. Add a row to the Aliases table above: `| \`old/path.md\` | \`new/path.md\` | YYYY-MM-DD |`
2. The `check-doc-links.mjs` gate will follow this redirect instead of reporting a broken link.
3. Do not remove old alias entries — they provide a permanent redirect trail.
4. Run `node scripts/check-canonical-paths.mjs` to verify all redirect targets exist.

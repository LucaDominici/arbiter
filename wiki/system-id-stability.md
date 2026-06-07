---
generated: true
source: 'docs/SYSTEM/ID-STABILITY.md'
source_sha: '962556cbaccd546601e707d7569cf785338e7322'
last_updated: '2026-06-07'
---

# Invariant ID Stability Policy

> **Non-authoritative:** This page is compiled from source. On conflict, the SSOT source wins.
> Source: [docs/SYSTEM/ID-STABILITY.md](../docs/SYSTEM/ID-STABILITY.md)

# Invariant ID Stability Policy

**Issue:** #610  
**Enforced by:** `scripts/check-id-stability.mjs` (L2 gate)

---

## Write-Once Rule

Invariant IDs (e.g., `INV-01`, `INV-42`) are write-once public identifiers. Once an ID appears in `INVARIANT_CATALOG`, it may never be deleted without a retire marker, and it may never be reused for a different invariant.

This matters because:

- Generated AGENTS.md files in target projects reference IDs by name.
- Downstream CI hooks and suppression files cite IDs.
- Removing or reassigning an ID silently breaks any target that pinned it.

## Retirement Protocol

When an invariant is superseded or no longer applicable:

1. **Do not delete the entry from `catalog.ts`.**
2. Add `status: 'retired'` to the entry.
3. Add `retiredReason` explaining why (e.g., "Superseded by INV-62 which covers the same concern with stronger enforcement").
4. Optionally add `redirectTo` pointing to the replacement ID.
5. The entry remains in the catalog forever, clearly marked.

```ts
{
  id: 'INV-XX',
  // ... other fields
  status: 'retired',
  retiredReason: 'Superseded by INV-YY (stronger enforcement added in W3).',
  redirectTo: 'INV-YY',
}
```

Retired entries are excluded from generated output (AGENTS.md, filter results) but remain in the catalog as a permanent record.

## CI Enforcement

`scripts/check-id-stability.mjs` runs as an L2 gate. It:

1. Diffs `src/invariants/catalog.ts` against `origin/main`.
2. If `catalog.ts` changed, loads both versions via `tsx`.
3. Compares IDs: any ID present in `origin/main` that is absent in HEAD without `status: 'retired'` fails the gate.

This prevents accidental removal of IDs during refactors.

## Redirect Handling

The `redirectTo` field stores redirect data in the catalog. Future CLI support (`arbiter explain <old-ID>`) will surface this to users and is tracked in issue #545.

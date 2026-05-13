# Graph Fixtures (#259)

Synthetic invariant catalogs used to exercise the Wave-1 provenance graph (`src/graph/`).
The fixtures are intentionally tiny — three or four invariants is enough to drive every code path:

- `catalog-orphan.json` — one INV has no `enforcement` string ⇒ orphan invariant detected by `verify graph`.
- `catalog-clean.json` — every INV has an `enforcement` string ⇒ `verify graph` passes.

The format is a literal JSON array of `Invariant` records (see `src/invariants/types.ts`).
Tests load these via `JSON.parse` and feed them to `buildInvNodes` directly, so the fixtures
never need a TypeScript toolchain to load.

---
title: Audit — Tested-but-unwired exports (anti-bloat burn-down)
type: audit
status: active
date: 2026-06-01
doc_version: '1.0.0'
last_review: '2026-06-01'
owner: ''
canonical_id: ''
tags: ['audience/auditor', 'audience/dev', 'kind/audit']
related: []
---

# Audit — Tested-but-unwired exports (anti-bloat burn-down)

**Date:** 2026-06-01
**Wave:** CANON-22 evidence-based quality (un-blind gates)
**Tool:** `npx ts-prune` (tsconfig excludes `__tests__/`, so an export with no _non-test_ importer is surfaced).
**Status:** BURN-DOWN COMPLETE (2026-06-01). All 37 entries resolved by **deletion** —
user confirmed "delete all" (the kit subsystem feature stays intact; only its
callerless helper exports were removed, see Resolution). The `ts-prune --error`
hard gate is **not yet wired** — its promotion is a follow-up (see Gate promotion),
deliberately split out because wiring a generated gate for target projects is a
Track-B change requiring a generic exempt policy, not arbiter-specific barrels.

## Resolution (2026-06-01)

All 37 deleted. tsc clean, full vitest green, repo-wide non-`.ts` sweep
(`.mjs`/`.cjs`/`.ejs`/`.json`) found zero references to any deleted symbol or
file. `ts-prune` now reports **0 non-exempt findings** (exempt = the published-API
barrels `adapters|compatibility|invariants|experimental/index.ts`, named-convention
helpers `_*`/`*ForTest`/`*Cache`/`__internal`, INV-89 `generateAntiDriftValidators`,
and cross-module re-exports `DebtBaseline*`/`SkillMatrixEntry`).

**Second-order cascades beyond the 37** (dead once their only callers — the 37 —
were removed; each verified zero external + zero non-`.ts` reference):

- **Whole files deleted (8):** `src/config/strictness-tiers.ts`,
  `src/config/thresholds-by-level.ts`, `src/detectors/modules.ts`,
  `src/kit/tooling-discovery.ts`, `src/notary/delta.ts`,
  `src/utils/release-bucket.ts`, `src/utils/seed.ts`, `src/utils/vault-sync.ts`.
- **`src/utils/seed.ts`** — note: `createSeededRng` + `canonicalJsonHash` were **not**
  in the original 37; they were kept alive only by the (test-only) `seededClock` /
  `deriveSeedFromConfig`. Once those went, the whole module was unreferenced (the
  `#637`/`#639` "reproducible build" consumers no longer exist). Deleted as a
  cascade, not exempted (exempting live-dead code would be a CANON-09 lie).
- **Trimmed type/data cascades:** the `KIT_THRESHOLDS` data + its interfaces in
  `src/kit/thresholds.ts` (kept only `BrownfieldClass`); the overlay/category-map
  schemas + `deriveKit`/`normalizeMatrixCell` in `src/kit/schema.ts`; the dead
  `TML`/`Gate`/`Disposition` + `VALID_DISPOSITIONS` in `src/kit/taxonomy.ts`;
  the `ContextBlock`/`RedTeamFinding`/`RedTeamEvidenceV1` schemas in `src/types/plan.ts`.
- **`defaultConfig`** relocated to a test-only fixture
  (`__tests__/helpers/default-config.ts`) — it had no production caller but seeded
  three test suites; relocating keeps the fixture without claiming it is product code.

---

## Why this doc exists (CANON-09)

The CANON-22 wave removes `knip.json`'s `ignoreIssues` block because a muted gate that claims enforcement while permitting findings is a CANON-09 violation ("claimed enforcement not wired = a lie").

`ts-prune` surfaces a **second** class the un-blinded `knip` still masks: exports that `knip` treats as used because a **test** imports them, but which have **zero production call-site**. A unit-tested function the product never calls is bloat with a test pinning it alive (YAGNI / anti-bloat — the project's #1 quality concern).

Adding a hard `ts-prune --error` gate in the same PR would require **either** deleting 37 functions+tests mid-wave (off-theme, risky, starves the duplication/CANON-22 work) **or** shipping a 37-entry ignore/baseline — which is exactly the muted-gate (`ignoreIssues`) anti-pattern this wave deletes. Both are incoherent. So the gate is recorded here and lands green **after** this list reaches zero.

This mirrors the CANON-17 precedent (`docs/audits/fs-callers-2026-05-17.md`): an enumerated audit baseline that a future gate promotion consumes.

## What is NOT on this list

- `knip`-detectable dead files/exports — resolved in the CANON-22 PR (un-blinded, green).
- Published API entrypoints (`package.json` `exports`: `cli.ts`, `types/plugin.ts`, `invariants/index.ts`, `compatibility/index.ts`) — legitimate external surface.
- INV-88 `src/adapters/index.ts` (StackAdapter reference surface) and INV-89 `src/generators/anti-drift-validators.ts` (Track-B emitter) — governance-required, not bloat.
  - **Honesty caveat (CANON-09):** `src/adapters/index.ts` is declared a knip `entry` (`!`) rather than fixed, because nothing in the production graph imports the barrel and `check-adapter-coverage.mjs` (INV-88) only verifies the per-language adapter _files exist_, not that the barrel/registry is reachable. So the `entry` is an author-judgment exemption justified by INV-88 file-existence, **not** by reachability — it is recorded here, not silently laundered from `ignoreIssues` into `entry`. Burn-down option: wire a real consumer (a CLI/generator path that imports the barrel) to make the entry honest, or delete the barrel and mark the per-language files as entries.
- Named-convention test/internal helpers (`_*`, `*ForTest`, `reset*`, `clear*Cache`, `__internal`) — intentional test surface.

---

## Burn-down list (37) — each: delete (symbol + its test) OR wire a real production caller

Verified 2026-06-01: each symbol below has a dedicated unit test but **zero** non-test production reference (typed imports; `\bsym\b` grep reliable — no string-keyed dispatch among these).

### commands / config

- `runPluginListValidate` — src/commands/plugin.ts
- `writeBacklog` — src/commands/task.ts
- `getStrictnessTierRules` — src/config/strictness-tiers.ts
- `getCiThresholds` — src/config/thresholds-by-level.ts
- `defaultConfig` — src/utils/config.ts

### detectors / graph / risk / notary / evidence

- `detectModules` — src/detectors/modules.ts
- `isNodeKind` — src/graph/model.ts
- `isEdgeKind` — src/graph/model.ts
- `isClassified` — src/risk/classifier.ts
- `assertClassified` — src/risk/classifier.ts
- `diffMarkdownSections` — src/notary/delta.ts
- `verifySummary` — src/evidence/summary.ts
- `EvidenceSummary` — src/evidence/summary.ts
- `RequiredField` — src/evidence/summary.ts

### kit subsystem (largest cluster — likely lost its prod caller when the `kit/index.ts` barrel was abandoned)

- `findById` — src/kit/catalog.ts
- `byTml` — src/kit/catalog.ts
- `byGate` — src/kit/catalog.ts
- `deriveKit` — src/kit/schema.ts
- `normalizeMatrixCell` — src/kit/schema.ts
- `KitOverlayCell` — src/kit/schema.ts
- `KIT_THRESHOLDS` — src/kit/thresholds.ts
- `resolveThreshold` — src/kit/thresholds.ts
- `languageToThresholdStack` — src/kit/thresholds.ts
- `buildToolingProposal` — src/kit/tooling-discovery.ts
- `AcceptedFutureWave` — src/kit/taxonomy.ts
- `UNIVERSAL_APPLIES` — src/kit/applicability.ts

### utils / internal / integrations / types

- `copyStaticFile` — src/utils/fs.ts (note: fs.ts comment marks it a "standard fs helper" post-#1077; confirm refactor left it callerless)
- `withRunId` — src/utils/logger.ts
- `renderString` — src/utils/render.ts
- `releaseBucket` — src/utils/release-bucket.ts
- `seededClock` — src/utils/seed.ts
- `deriveSeedFromConfig` — src/utils/seed.ts
- `writeVaultFile` — src/utils/vault-sync.ts
- `warnDeprecated` — src/internal/deprecate.ts
- `hasSuperpowersSkill` — src/integrations/skill-detector.ts
- `ContextBlock` — src/types/plan.ts
- `RedTeamFinding` — src/types/plan.ts

---

## Gate promotion — FOLLOW-UP (separate Track-B PR)

Step 1 (resolve every entry) is **DONE** (see Resolution). The remaining gate-wiring
is a deliberate follow-up: it is a **Track-B (template/generator) change** and must
ship dual-complete with a _generic_ exempt policy, not arbiter's specific barrels.
A bare `ts-prune --error` also over-fires on `(used in module)` exports, so the gate
needs a filter wrapper (drop `used in module`, drop the exempt allowlist, fail on the
remainder) rather than the raw CLI flag.

1. ✅ Resolve every entry above (all 37 deleted; see Resolution).
2. Add `ts-prune` devDep + a self filter-gate (`scripts/check-unwired-exports.mjs`)
   and the template mirror (`static-analysis/ts-prunerc.json.ejs` +
   `src/templates/scripts/check-all.mjs.ejs`). The template exempt policy must be
   **generic** — named-convention helpers + the target's own `package.json` `exports`
   / barrels — since a generated TS project has none of arbiter's `adapters|compatibility|invariants/index.ts` surfaces.
3. Wire the filter-gate at L2 in `scripts/check-all.mjs` and the template; add `ts-prune`
   to target devDeps in `src/generators/debt-gates.ts` (or it is dead-on-arrival).
4. Gate must be **green with zero ignored real findings** — no baseline of live dead code (CANON-09).

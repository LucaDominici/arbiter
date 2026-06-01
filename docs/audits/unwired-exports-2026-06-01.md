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
**Status:** OPEN burn-down. The `ts-prune --error` **hard gate is deferred to this burn-down**, not muted in the CANON-22 PR.

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

## Gate promotion (definition of done for this burn-down)

1. Resolve every entry above (delete symbol+test, or wire a production caller).
2. Add `ts-prune` devDep + `.ts-prunerc.json` (self) and `static-analysis/ts-prunerc.json.ejs` (template, dual-sided) ignoring **only** the published-API entrypoints + INV-88/89 surfaces + named-convention helpers.
3. Wire `runCheck('unwired exports', 'npx', ['ts-prune', '--error'])` at L2 in `scripts/check-all.mjs` and `src/templates/scripts/check-all.mjs.ejs`. Add `ts-prune` to the target devDeps in `src/generators/debt-gates.ts` (or it is dead-on-arrival).
4. Gate must be **green with zero ignored real findings** — no baseline of live dead code (CANON-09).

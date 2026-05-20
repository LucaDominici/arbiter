---
title: 'ADR-028: Grace Period for Level Upgrade + Contract Type Axis'
doc_version: '1.0.0'
status: active
last_review: '2026-05-20'
owner: ''
canonical_id: ''
tags: []
related: []
---

# ADR-028: Grace Period for Level Upgrade + Contract Type Axis

**Status:** Accepted
**Date:** 2026-04-16
**Resolves:** issues #92 (MK), #93 (ML)
**Refs:** [ADR-022](022-universal-baseline-freeze.md) (feeds MK); M28 (consumes ML)

---

## Context

### MK — Grace Period for Level Upgrade

Upgrading from L1 to L2 today is a hard cliff: coverage, PMD/ESLint complexity, ArchUnit, and dependency audit gates all activate the instant `governanceLevel` changes in `arbiter.json`. Projects carrying existing technical debt immediately fail, discouraging adoption. The solution is a bounded warn-only period — long enough for teams to fix the gaps, short enough to prevent indefinite deferral.

ADR-022 (universal baseline freeze) already ships `capture-debt-baseline.mjs --update`. MK wires that baseline capture into the upgrade flow so the cliff becomes a slope: teams see WARN on new L2 gates, with a countdown, and can ratchet the debt down incrementally before the grace expires.

### ML — Contract Testing by Contract Type

M28 was originally scoped around Pact, which only fits the `rest-owned` case (consumer and provider both owned, REST transport). Real projects use OpenAPI diff (public APIs they don't control), graphql-inspector (GraphQL schemas), buf breaking (gRPC), or Avro/Protobuf schema registries (message queues). A single Pact generator would be wrong for 80% of archetypes.

The fix is a `contractType` axis on `ProjectConfig`: persist the choice, ask the wizard only when `hasPublicApi === true`, and let M28 branch on the stored value to generate the right tooling.

---

## Decision

### Part I — Grace Period (MK)

**New command: `arbiter upgrade-level --target=<L2|L3>`**

1. Validates the target is a promotion (not same-level or downgrade).
2. Runs `node scripts/capture-debt-baseline.mjs --update` via `runCli` (INV-33: baseline must succeed before persisting `graceEndsAt`). Aborts on non-zero exit.
3. Persists `governanceLevel = target`, `graceFromLevel = current`, `graceEndsAt = ISO(now + days)` (default 30 days, overridable via `--days`).

**`--extend` flag:** Bumps `graceEndsAt` for an active (non-expired) grace period. Appends an audit entry to `.arbiter/grace-log.json` (append-only, never deleted). Rejects if no active grace exists.

**Downgrade:** Rejected with an actionable error. Teams that need to downgrade edit `arbiter.json` manually and run `arbiter update`.

**Grace guard in `check-all.mjs` template:**

The generated script reads `arbiter.json` at runtime. If `graceFromLevel === "L1"` and `graceEndsAt` is in the future, all L2 `runCheck` calls receive `{ soft: true }`. Soft failures print `WARN (grace period)` and do not increment the failure counter, so the script exits 0. When grace expires, the same code paths hard-fail as normal.

**Scope:** MVP covers L1 → L2 only (D1). The `graceFromLevel` field is stored for future L2 → L3 widening (a boolean flip in the template).

**INV-33:** Enforced in `runUpgradeLevel` — `saveConfig` is only called after `runCli` returns exit 0.

### Part II — Contract Type Axis (ML)

**`ContractType` union (in `src/wizard/types.ts`):**

```
"rest-owned" | "rest-public" | "graphql" | "grpc" | "message-queue" | "none"
```

**Default map (pure function `defaultContractType` in `src/wizard/archetype-defaults.ts`):**

| Archetype                           | `hasPublicApi` | `contractType`    |
| ----------------------------------- | -------------- | ----------------- |
| `backend-web-db`                    | `true`         | `"rest-owned"`    |
| `frontend-spa`                      | `true`         | `"rest-public"`   |
| `data-pipeline`                     | `true`         | `"message-queue"` |
| any                                 | `false`        | `"none"`          |
| `library`, `cli`, `embedded`, other | any            | `"none"`          |

**Wizard:** `contractType` question is gated by `shouldAskContractType({ hasPublicApi })` — only shown when `hasPublicApi === true`. The `when:` function is extracted as a named export so it can be unit-tested directly (Inquirer `when:` functions are not exercised by mocked `runWizard` tests).

**Persistence:** `contractType` is optional on `ArbiterConfig` for backward compatibility. All five config-read call sites (`init`, `update`, `diff`, `obsidian`, `defaultConfig`) use `?? defaultContractType(...)` fallback.

**M28 consumer:** The M28 generator will branch on `config.contractType` to generate the correct contract testing setup. INV-34 (contract testing enforcement) is deferred to M28.

---

## Consequences

**Positive:**

- L1 → L2 migration is now incremental, not a cliff. Teams get 30 days of WARN before hard-fail resumes.
- `graceEndsAt` in `arbiter.json` is visible to CI and can be surfaced in PR descriptions or dashboards.
- `.arbiter/grace-log.json` provides an audit trail of all extension events.
- `contractType` decouples M28 from Pact-only assumptions. Five contract testing strategies are now first-class.
- All new fields are optional — no migration needed for existing `arbiter.json` files.

**Negative / Trade-offs:**

- L2 → L3 grace is deferred. The field is stored but the template only soft-fails for `graceFromLevel === "L1"`. Widening is one conditional change.
- `check-all.mjs` reads `arbiter.json` from `process.cwd()`. Projects that run the script from a non-root directory will not pick up grace state (documented: run from repo root, which is existing convention).
- INV-34 (contract testing enforcement) is not added until M28 ships.

**Back-compat:** All new `ArbiterConfig` fields are optional. `CURRENT_VERSION` stays `"0.1"`. No migration script needed.

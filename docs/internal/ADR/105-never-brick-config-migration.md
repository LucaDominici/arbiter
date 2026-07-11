---
title: 'ADR-105: never-brick config migration — coercible vs fatal fields'
doc_version: '1.0.0'
status: active
last_review: '2026-07-11'
owner: ''
canonical_id: '105'
tags: ['audience/dev', 'kind/adr']
related: []
---

# ADR-105: never-brick config migration — coercible vs fatal fields

**Project:** arbiter
**Date:** 2026-07-11
**Status:** Accepted

## Context

`loadConfig` ran every `arbiter.json` through `migrate()` (reshape to the current
schema version) and then `validateConfig()` (strict schema check), hard-throwing
`E_CONFIG_INVALID` on any validation failure. In practice this bricked historically
-valid configs the moment a single field went stale: the flagship case was
`contractType: 'pact'` (a Pact contract-testing flavor removed from the
`ContractType` union) surviving in an otherwise-current v0.2 config. The throw
did not even happen in `loadConfig` — `migrateV1ToV2`'s v0.2-passthrough branch
called `validateConfig(raw)` and threw internally on failure, **before**
`loadConfig`'s own validation (and any fallback) ever ran. A tool whose own
config-migration bricks a real target on a routine drift (a removed enum
member, a renamed flag) cannot credibly demand config discipline from anyone
else — this was reproducible against the arbiter project's own showcase
target (a real, in-active-development repo, not a fixture).

## Decision

Split every config-validation failure into exactly two classes:

- **FATAL** — the JSON is unparseable, or the parsed value is not an object,
  or (a distinct, deliberate guard, unrelated to this ADR) `$schemaVersion` is
  from a future build the current binary cannot understand. These stay hard
  errors: there is no default that vests a genuinely broken/from-the-future
  file with meaning.
- **COERCIBLE** — a closed set of "axis/identity" fields whose job is only to
  steer template/generator *selection*, never gate/threshold strictness:
  `contractType`, `databaseEngine`, `strictnessTier`, `thresholdProfile`,
  `runnerProfile`, `industryOverlay` (unknown/removed enum value → field
  dropped, becomes "not configured"), `lanes` (invalid entries filtered),
  `governanceLevel` (missing/unrecognized → `'L2'`, arbiter's own existing
  default), `tools` (unknown entries filtered to `AI_TOOLS`; falls back to
  `['claude', 'codex']` if that would empty the array), and
  `useGitHub`/`permitGitHub` (neither present as boolean → `permitGitHub:
  false`). Each default is already precedented elsewhere in the codebase
  (`migrateV1ToV2`, `defaultConfig()` test fixture) — this ADR does not invent
  new defaults, it makes the existing ones reachable from the strict-load
  path instead of only from fresh `init`.

Deliberately **excluded** from the coercible set (and therefore still FATAL if
malformed): `features`, `thresholds`, `decomposition`, `frontend`,
`automation`, `contextPack`, `taskTiers`, `kit`, `companions`, `governance`,
`conformanceThresholds`, `channel`. Every one of these directly controls gate
strictness or CI composition — silently defaulting a broken shape there could
mask a real misconfiguration instead of repairing a stale migration. Never-
brick is a promise about *legacy drift on identity/classification fields*, not
a general license to swallow any invalid config.

Implementation (mechanical, `src/config/schema.ts` +
`src/utils/config.ts::loadConfig` + `src/config/migrations/v1-to-v2.ts`):

1. `migrateV1ToV2`'s v0.2-passthrough branch no longer throws on a strict
   `validateConfig` failure. It logs a WARN and passes the raw shape through
   un-normalized — migration's job is to reshape, not gate-keep. The single
   authoritative validate/coerce/validate pass happens once, at the end of
   the chain, in `loadConfig`.
2. New pure function `sanitizeCoercibleFields(raw)` in `schema.ts` — colocated
   with the same enum allow-lists `validateConfig` already uses (`CONTRACT_TYPES`,
   `DATABASE_ENGINES`, `GOVERNANCE_LEVELS`, `AI_TOOLS`, …, now exported so
   there is exactly one source of truth). Returns `{ draft, report }`, never
   mutates its input, and is a no-op (empty report) on an already-valid config.
3. `loadConfig`: on a first `validateConfig` failure, call
   `sanitizeCoercibleFields` and re-validate. Only if it is *still* invalid —
   i.e. the failure is outside the coercible set — is `E_CONFIG_INVALID`
   thrown. A successful coercion is surfaced as a single `getLogger().warn`
   listing every field touched (`from` → `to`), never a silent swallow.

Migration itself remains forward-only, additive and idempotent (unchanged);
this ADR only changes what happens when the reshaped result still fails
strict validation.

## Consequences

### Positive

- A legacy/partial `arbiter.json` can no longer fatally brick `diff`/`doctor`/
  any other config-loading command on the identity/classification axis —
  proven end-to-end against the arbiter project's own real showcase target
  (previously `E_CONFIG_INVALID`, now exit 0 with real output on both `diff`
  and `doctor`).
- The fatal/coercible split is enforced by one closed allow-list
  (`sanitizeCoercibleFields`), not per-call-site special-casing — a future
  axis field only needs one line here to gain the same protection.
- Zero behavior change for any config that already validates cleanly (the
  fallback is only ever reached after a first failed `validateConfig` call).

### Negative

- `sanitizeCoercibleFields` duplicates, in shape, the field list
  `validateOptionalEnums`/`validateOptionalScalars`/the top-level checks in
  `validateConfig` already cover — two lists to keep in sync if a new axis
  field is added. Mitigated by sharing the exact same exported `ReadonlySet`
  constants (not a second copy of the allowed values) and by the corpus test
  (`__tests__/config/never-brick-migration.test.ts`) asserting the specific
  fields this ADR promises to coerce.
- The excluded/FATAL set (`features`, `thresholds`, …) is a judgment call:
  if a future legacy-drift case turns out to live in one of those blocks, it
  is still a hard `E_CONFIG_INVALID` today. That is intentional (see
  Decision) but worth re-litigating if it recurs in practice.

## Links

- Related ADRs: none
- Issues: none (executed as playbook tranche T0, `docs/EXECUTION-PLAYBOOK.md` §T0)

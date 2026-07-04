// SPDX-License-Identifier: Apache-2.0
import ejs from 'ejs'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { levelAtLeast, LEVEL_ORDER } from '../config/levels.js'
import type { GovernanceLevel } from '../wizard/types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = join(__dirname, '..', 'templates')

function isGovernanceLevel(value: unknown): value is GovernanceLevel {
  return typeof value === 'string' && (LEVEL_ORDER as readonly string[]).includes(value)
}

/**
 * Guarantee `basePackage` is an own key of the render data (value `undefined`
 * when unset). EJS renders with `with(locals)`, so a bare `basePackage`
 * reference throws `ReferenceError` when the key is absent — but resolves to
 * `undefined` (letting each template's own `||`/`?:` fallback run) when the key
 * is present with value `undefined`. Many Java templates reference bare
 * `basePackage`; normalizing here at the single render boundary keeps them all
 * crash-safe without editing template bodies (#1348).
 *
 * Returns the input unchanged when the key is already present (no-op for the
 * common case); otherwise a shallow copy with the key added (never mutates the
 * caller's object).
 */
export function withBasePackageDefault(data: object): object {
  if (Object.prototype.hasOwnProperty.call(data, 'basePackage')) return data
  return { ...data, basePackage: undefined }
}

/**
 * Guarantee `isL2Plus`/`isL3Plus`/`isL4` are own keys of the render data, derived
 * from the ordinal SSOT `levelAtLeast` (`src/config/levels.ts`, #1516) instead of
 * being hand-rolled per template as `governanceLevel === 'L3'` literals — the exact
 * pattern that silently excluded L4 in 5 places and downgraded L4 *below* L3 (#1720).
 *
 * EJS renders with `with(locals)`, so a bare `isL3Plus` reference throws
 * `ReferenceError` when the key is absent. Injecting the keys here — once, at the
 * single render boundary — lets every template reference them safely without a
 * per-template guard.
 *
 * The three keys are ALWAYS recomputed from `governanceLevel` — deliberately
 * different from `withBasePackageDefault`'s only-if-absent policy. They are purely
 * derived values of the ordinal SSOT; letting a caller-supplied stale flag shadow
 * the SSOT would reintroduce the exact hand-rolled-boolean divergence this helper
 * exists to kill.
 *
 * An absent or invalid `governanceLevel` yields all three keys `false` rather than
 * throwing — every level-branching template in this repo always supplies a valid
 * `governanceLevel`, so this is a safe (never observed) default, not a
 * silent-downgrade vector.
 *
 * Always returns a shallow copy (never mutates the caller's object).
 */
export function withLevelBooleans(data: object): object {
  const level = (data as { governanceLevel?: unknown }).governanceLevel
  return {
    ...data,
    isL2Plus: isGovernanceLevel(level) && levelAtLeast(level, 'L2'),
    isL3Plus: isGovernanceLevel(level) && levelAtLeast(level, 'L3'),
    isL4: isGovernanceLevel(level) && level === 'L4',
  }
}

export type ServiceBucket = 'service' | 'cli' | 'batch' | 'lib'

const ARCHETYPE_TO_BUCKET: Readonly<Record<string, ServiceBucket>> = {
  'backend-web-db': 'service',
  cli: 'cli',
  embedded: 'cli',
  'data-pipeline': 'batch',
}

/**
 * Resolve a project archetype to its CI-emission "service bucket" (service / cli / batch /
 * lib) — the single canonical mapping now consumed by both the workflow EJS templates (via
 * `withServiceBucket` below) and the L3 maturity gate (`deriveWorkflowCapabilities` /
 * `workflowCtx` in `commands/init.ts`).
 *
 * Previously this exact map was hand-duplicated 6 times: inline in each of 5 workflow EJS
 * templates (`_nightly`, `_shared-security`, `_weekly`, `05-release`, `02-pr-extended`) and
 * again as `serviceBucket()` in `init.ts` — a drift vector flagged as tech debt (CANON-22)
 * behind #1678 and fixed at the root here (#1723).
 */
export function resolveServiceBucket(archetype: unknown): ServiceBucket {
  return (typeof archetype === 'string' ? ARCHETYPE_TO_BUCKET[archetype] : undefined) ?? 'lib'
}

/**
 * Guarantee `serviceBucket`/`isService`/`isCli`/`isBatch` are own keys of the render data,
 * derived from `archetype` via `resolveServiceBucket` (#1723) — the same single-render-
 * boundary pattern as `withLevelBooleans`/`withBasePackageDefault` above: EJS renders with
 * `with(locals)`, so injecting the derived keys here once lets every template reference
 * them without re-declaring the archetype→bucket map itself.
 *
 * Always returns a shallow copy (never mutates the caller's object).
 */
export function withServiceBucket(data: object): object {
  const archetype = (data as { archetype?: unknown }).archetype
  const bucket = resolveServiceBucket(archetype)
  return {
    ...data,
    serviceBucket: bucket,
    isService: bucket === 'service',
    isCli: bucket === 'cli',
    isBatch: bucket === 'batch',
  }
}

function withRenderDefaults(data: object): object {
  return withServiceBucket(withLevelBooleans(withBasePackageDefault(data)))
}

/**
 * Render an EJS template file relative to the templates/ directory.
 *
 * `data` is typed as `object` so call sites can pass typed domain objects
 * (e.g. `ProjectConfig`) directly without an `as unknown as Record<…>`
 * double-cast. EJS accesses properties dynamically at template-eval time,
 * so a structural `object` is sufficient at the boundary.
 */
export function renderTemplate(templatePath: string, data: object): string {
  const fullPath = join(TEMPLATES_DIR, templatePath)
  const source = readFileSync(fullPath, 'utf-8')
  return ejs.render(source, withRenderDefaults(data), { filename: fullPath })
}

/**
 * Render an EJS template from an absolute file path.
 * Used by the plugin runner to render templates from plugin-owned templateRoot.
 */
export function renderFromAbsPath(absPath: string, data: object): string {
  const source = readFileSync(absPath, 'utf-8')
  return ejs.render(source, withRenderDefaults(data), { filename: absPath })
}

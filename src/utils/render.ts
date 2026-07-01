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
 * Mirrors `withBasePackageDefault`'s no-clobber own-key contract: EJS renders with
 * `with(locals)`, so a bare `isL3Plus` reference throws `ReferenceError` when the key
 * is absent. Injecting the keys here — once, at the single render boundary — lets
 * every template reference them safely without a per-template guard.
 *
 * A key already present on `data` (including an explicit override) is left untouched.
 * An absent or invalid `governanceLevel` yields all three keys `false` rather than
 * throwing — every level-branching template in this repo always supplies a valid
 * `governanceLevel`, so this is a safe (never observed) default, not a silent-downgrade
 * vector.
 *
 * Returns the input unchanged when all three keys are already present (no-op for the
 * common case); otherwise a shallow copy with the missing keys added (never mutates
 * the caller's object).
 */
export function withLevelBooleans(data: object): object {
  const HAS = (key: string): boolean => Object.prototype.hasOwnProperty.call(data, key)
  if (HAS('isL2Plus') && HAS('isL3Plus') && HAS('isL4')) return data

  const level = (data as { governanceLevel?: unknown }).governanceLevel
  const isL2Plus = isGovernanceLevel(level) && levelAtLeast(level, 'L2')
  const isL3Plus = isGovernanceLevel(level) && levelAtLeast(level, 'L3')
  const isL4 = isGovernanceLevel(level) && level === 'L4'

  return {
    ...data,
    ...(HAS('isL2Plus') ? {} : { isL2Plus }),
    ...(HAS('isL3Plus') ? {} : { isL3Plus }),
    ...(HAS('isL4') ? {} : { isL4 }),
  }
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
  return ejs.render(source, withLevelBooleans(withBasePackageDefault(data)), { filename: fullPath })
}

/**
 * Render an EJS template from an absolute file path.
 * Used by the plugin runner to render templates from plugin-owned templateRoot.
 */
export function renderFromAbsPath(absPath: string, data: object): string {
  const source = readFileSync(absPath, 'utf-8')
  return ejs.render(source, withLevelBooleans(withBasePackageDefault(data)), { filename: absPath })
}

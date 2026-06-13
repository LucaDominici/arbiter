// SPDX-License-Identifier: Apache-2.0
import ejs from 'ejs'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = join(__dirname, '..', 'templates')

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
  return ejs.render(source, withBasePackageDefault(data), { filename: fullPath })
}

/**
 * Render an EJS template from an absolute file path.
 * Used by the plugin runner to render templates from plugin-owned templateRoot.
 */
export function renderFromAbsPath(absPath: string, data: object): string {
  const source = readFileSync(absPath, 'utf-8')
  return ejs.render(source, withBasePackageDefault(data), { filename: absPath })
}

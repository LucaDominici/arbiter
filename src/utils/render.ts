import ejs from 'ejs'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_DIR = join(__dirname, '..', 'templates')

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
  return ejs.render(source, data, { filename: fullPath })
}

export function renderString(template: string, data: object): string {
  return ejs.render(template, data)
}

/**
 * Render an EJS template from an absolute file path.
 * Used by the plugin runner to render templates from plugin-owned templateRoot.
 */
export function renderFromAbsPath(absPath: string, data: object): string {
  const source = readFileSync(absPath, 'utf-8')
  return ejs.render(source, data, { filename: absPath })
}

// SPDX-License-Identifier: Apache-2.0
// gen-doc-helpers.mjs — shared helpers for gen-gap.mjs and gen-status.mjs (#1222).
//
// Extracted from the two generators to eliminate byte-identical duplication flagged
// by the jscpd gate. All three functions are pure-export semantics; the module has
// no top-level side-effects and is intentionally excluded from the fail-closed audit.

import { readdirSync } from 'node:fs'

/**
 * Extract a frontmatter field value from markdown content.
 * @param {string} content
 * @param {string} key
 * @returns {string | null}
 */
export function fmField(content, key) {
  const m = content.match(new RegExp(`${key}:\\s*['"]?([^'"\\n]+)['"]?`))
  return m ? m[1].trim() : null
}

/**
 * Safe readdirSync wrapper for optional directories — returns [] if unreadable.
 * Only for directories that may not exist; do NOT use for required paths.
 * @param {string} dir
 * @returns {string[]}
 */
export function readdirSafe(dir) {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

/**
 * Format raw markdown via prettier with the project config.
 * resolveConfig(filepath) walks up from filepath to find .prettierrc — project
 * config applied; tmpdir callers get defaults (no .prettierrc → null → empty).
 * @param {string} raw
 * @param {string} filepath
 * @returns {Promise<string>}
 */
export async function prettify(raw, filepath) {
  const { format, resolveConfig } = await import('prettier')
  const config = (await resolveConfig(filepath)) ?? {}
  return format(raw, { ...config, parser: 'markdown' })
}

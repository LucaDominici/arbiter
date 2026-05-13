/**
 * CONTEXT_PACK generator (#254): deterministic generator that, given a task track
 * and a list of files, produces CONTEXT_PACK.md with @source: citations.
 *
 * Determinism guarantees:
 *   - Files are sorted alphabetically before emission
 *   - No Date.now(), no random IDs, no unsorted iteration
 *   - Same input always yields identical output
 */
import { TRACK_INV_MAP, type Track } from './track-mapping.js'

export interface AdrMapping {
  /** Glob-like pattern (supports `**` and `*` wildcards). */
  pattern: string
  /** ADR identifier, e.g. "ADR-007". */
  adr: string
}

export interface ContextPackInput {
  taskId: string
  track: Track
  files: string[]
  adrMappings: AdrMapping[]
}

const DOUBLE_STAR_SENTINEL = '__DOUBLESTAR__'

/**
 * Convert a glob-like pattern to a RegExp.
 * Supports:
 *   `**` — any path segment(s) including slashes
 *   `*`  — any characters except slash
 */
function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex specials except * and /
    .replace(/\*\*/g, DOUBLE_STAR_SENTINEL) // temporarily mark **
    .replace(/\*/g, '[^/]*') // * → any non-slash
    .replace(new RegExp(DOUBLE_STAR_SENTINEL, 'g'), '.*') // ** → anything

  return new RegExp(`^${escaped}$`)
}

function matchesPattern(filePath: string, pattern: string): boolean {
  return globToRegExp(pattern).test(filePath)
}

function findAdrsForFile(filePath: string, adrMappings: AdrMapping[]): string[] {
  return adrMappings
    .filter((m) => matchesPattern(filePath, m.pattern))
    .map((m) => m.adr)
    .sort()
}

/**
 * Generate a deterministic CONTEXT_PACK.md string.
 *
 * Output format:
 * ```
 * # CONTEXT_PACK — <taskId>
 *
 * Track: <track>
 *
 * ## Invariants
 *
 * - INV-XX: ...
 *
 * ## Files
 *
 * - @source: <file> [ADR-007, ADR-012]  (only when adrMappings match)
 * ```
 */
export function generateContextPack(input: ContextPackInput): string {
  const { taskId, track, adrMappings } = input
  const files = [...input.files].sort()
  const invs = TRACK_INV_MAP[track]

  const lines: string[] = []

  lines.push(`# CONTEXT_PACK — ${taskId}`)
  lines.push('')
  lines.push(`Track: ${track}`)
  lines.push('')
  lines.push('## Invariants')
  lines.push('')
  for (const inv of invs) {
    lines.push(`- ${inv}`)
  }
  lines.push('')
  lines.push('## Files')
  lines.push('')
  for (const f of files) {
    const adrs = findAdrsForFile(f, adrMappings)
    const adrSuffix = adrs.length > 0 ? `  [${adrs.join(', ')}]` : ''
    lines.push(`- @source: ${f}${adrSuffix}`)
  }
  lines.push('')

  return lines.join('\n')
}

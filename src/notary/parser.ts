// SPDX-License-Identifier: Apache-2.0
/**
 * Notary footer parser and validator.
 *
 * Footer format:
 *   Notary:
 *   - Delta: <FILE> §<SECTION> (<TYPE>, +N -N)
 *   - Intent: <REASON> [per <ADR|INV|TASK>]
 *   - Patch: <INDEX1> (<update>), <INDEX2> (N/A)
 *
 * Existing Code Survey (CANON-16):
 *   - grep for "export.*parser\|export.*Parser" src/ --include="*.ts" -l
 *     → found src/commands/verify-plan.ts parser (different domain: plan validation)
 *     → Rejected refactor: semantically different — this parses commit footers not plan files
 *   - Decision: new file justified — different responsibility and lifecycle
 *
 * #256
 */

export type DeltaChangeType = 'add' | 'modify' | 'delete' | 'move'

/**
 * The closed set of legal change types. `parseNotaryFooter` captures the type
 * with a permissive `(\w+)` regex and casts it to {@link DeltaChangeType}, so a
 * footer like `(rename, +1 -0)` yields a value typed as the union but absent
 * from it. {@link validateNotaryFooter} re-checks against this set at runtime so
 * the cast cannot silently smuggle an illegal value past validation. (#1536)
 */
const VALID_CHANGE_TYPES: ReadonlySet<string> = new Set<DeltaChangeType>([
  'add',
  'modify',
  'delete',
  'move',
])

export interface NotaryDelta {
  file: string
  section: string
  changeType: DeltaChangeType
  added: number
  removed: number
}

export interface NotaryPatch {
  file: string
  status: string
}

export interface NotaryFooter {
  deltas: NotaryDelta[]
  intent: string
  patches: NotaryPatch[]
}

// Regex patterns for parsing
const NOTARY_BLOCK_RE = /Notary:\n((?:- .+\n?)+)/
const DELTA_RE = /^- Delta:\s+(\S+)\s+§(\S+)\s+\((\w+),\s*\+(\d+)\s+-(\d+)\)$/
const INTENT_RE = /^- Intent:\s+(.+)$/
const PATCH_LINE_RE = /^- Patch:\s+(.+)$/
const PATCH_ENTRY_RE = /([^\s,()]+)\s+\(([^)]+)\)/g

/**
 * Parse a single Patch line which may contain multiple entries:
 * "docs/A.md (update), docs/B.md (N/A)"
 */
function parsePatchLine(line: string): NotaryPatch[] {
  const patches: NotaryPatch[] = []
  let match: RegExpExecArray | null
  PATCH_ENTRY_RE.lastIndex = 0
  while ((match = PATCH_ENTRY_RE.exec(line)) !== null) {
    const file = match[1]
    const status = match[2]
    if (file !== undefined && status !== undefined) {
      patches.push({ file, status })
    }
  }
  return patches
}

/**
 * Parse a Notary: block from a commit message.
 * Returns null if no Notary: block is present.
 */
export function parseNotaryFooter(commitMessage: string): NotaryFooter | null {
  const blockMatch = NOTARY_BLOCK_RE.exec(commitMessage)
  if (!blockMatch) return null

  const blockLines = (blockMatch[1] ?? '').split('\n').filter((l) => l.trim() !== '')

  const deltas: NotaryDelta[] = []
  let intent = ''
  const patches: NotaryPatch[] = []

  for (const line of blockLines) {
    const deltaMatch = DELTA_RE.exec(line)
    if (deltaMatch) {
      const file = deltaMatch[1] ?? ''
      const section = deltaMatch[2] ?? ''
      const changeTypeRaw = deltaMatch[3] ?? ''
      const addedRaw = deltaMatch[4] ?? '0'
      const removedRaw = deltaMatch[5] ?? '0'
      deltas.push({
        file,
        section,
        changeType: changeTypeRaw as DeltaChangeType,
        added: parseInt(addedRaw, 10),
        removed: parseInt(removedRaw, 10),
      })
      continue
    }

    const intentMatch = INTENT_RE.exec(line)
    if (intentMatch) {
      intent = (intentMatch[1] ?? '').trim()
      continue
    }

    const patchLineMatch = PATCH_LINE_RE.exec(line)
    if (patchLineMatch) {
      patches.push(...parsePatchLine(patchLineMatch[1] ?? ''))
    }
  }

  return { deltas, intent, patches }
}

/**
 * Validate a parsed NotaryFooter and return human-readable error messages.
 * Returns an empty array when valid.
 */
export function validateNotaryFooter(footer: NotaryFooter): string[] {
  const errors: string[] = []

  if (footer.deltas.length === 0) {
    errors.push('Notary footer must include at least one Delta entry')
  }

  if (!footer.intent || footer.intent.trim() === '') {
    errors.push('Notary footer must include a non-empty Intent entry')
  }

  if (footer.patches.length === 0) {
    errors.push('Notary footer must include at least one Patch entry')
  }

  footer.deltas.forEach((delta, i) => {
    if (!VALID_CHANGE_TYPES.has(delta.changeType)) {
      errors.push(
        `Notary footer Delta entry ${i + 1} has invalid change type "${delta.changeType}" ` +
          `(expected one of: add, modify, delete, move)`,
      )
    }
  })

  return errors
}

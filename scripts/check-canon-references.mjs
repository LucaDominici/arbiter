#!/usr/bin/env node
/**
 * Validates that every CANON-NN ID referenced in docs/internal/SYSTEM/CANON.md
 * exists as a heading in that file. Fails with exit 1 on undefined references.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

const canonPath = resolve('docs/internal/SYSTEM/CANON.md')

// Exit codes (INV-53): 0 = all refs resolve, 1 = undefined/empty refs, 2 = CANON.md unreadable.
function main() {
  let content
  try {
    content = readFileSync(canonPath, 'utf8')
  } catch (err) {
    // #2418: an unreadable CANON.md used to crash with a raw stack under the generic
    // node exit code. It is an invocation/IO fault — name it and exit 2.
    process.stderr.write(
      `[check-canon-references] ERROR — cannot read ${canonPath}: ${err?.message ?? err}\n`,
    )
    return 2
  }

  const definedIds = new Set([...content.matchAll(/^## (CANON-\d+)/gm)].map((m) => m[1]))

  if (definedIds.size === 0) {
    console.error(
      '[check-canon-references] ERROR — no CANON-NN headings found in docs/internal/SYSTEM/CANON.md; file may be empty or corrupt',
    )
    return 1
  }

  const referencedIds = new Set([...content.matchAll(/CANON-(\d+)/g)].map((m) => `CANON-${m[1]}`))
  const undefinedRefs = [...referencedIds].filter((id) => !definedIds.has(id))

  if (undefinedRefs.length > 0) {
    console.warn(
      `[check-canon-references] WARNING: referenced but undefined CANON IDs: ${undefinedRefs.join(', ')}`,
    )
    console.warn('[check-canon-references] Add missing entries to docs/internal/SYSTEM/CANON.md')
    return 1
  }

  process.stdout.write(
    `[check-canon-references] OK — ${definedIds.size} CANON entries defined, all cross-references valid\n`,
  )
  return 0
}

try {
  process.exit(main())
} catch (err) {
  // Fail-closed (INV-96): any unexpected error is a hard gate failure, never a silent pass.
  process.stderr.write(`[check-canon-references] unexpected error — ${err?.message ?? err}\n`)
  process.exit(1)
}

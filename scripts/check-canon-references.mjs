#!/usr/bin/env node
/**
 * Validates that every CANON-NN ID referenced in docs/internal/SYSTEM/CANON.md
 * exists as a heading in that file. Fails with exit 1 on undefined references.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

const canonPath = resolve('docs/internal/SYSTEM/CANON.md')
const content = readFileSync(canonPath, 'utf8')

const definedIds = new Set([...content.matchAll(/^## (CANON-\d+)/gm)].map((m) => m[1]))

if (definedIds.size === 0) {
  console.error(
    '[check-canon-references] ERROR — no CANON-NN headings found in docs/internal/SYSTEM/CANON.md; file may be empty or corrupt',
  )
  process.exit(1)
}

const referencedIds = new Set([...content.matchAll(/CANON-(\d+)/g)].map((m) => `CANON-${m[1]}`))

const undefinedRefs = [...referencedIds].filter((id) => !definedIds.has(id))

if (undefinedRefs.length > 0) {
  console.warn(
    `[check-canon-references] WARNING: referenced but undefined CANON IDs: ${undefinedRefs.join(', ')}`,
  )
  console.warn('[check-canon-references] Add missing entries to docs/internal/SYSTEM/CANON.md')
  process.exit(1)
}

process.stdout.write(
  `[check-canon-references] OK — ${definedIds.size} CANON entries defined, all cross-references valid\n`,
)

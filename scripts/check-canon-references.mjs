#!/usr/bin/env node
/**
 * Validates that every CANON-NN ID referenced in docs/SYSTEM/CANON.md
 * exists as a heading in that file. Warn-only for now; promote to L1 gate
 * once all open issues carry canon labels.
 */

import { readFileSync } from 'fs'
import { resolve } from 'path'

const canonPath = resolve('docs/SYSTEM/CANON.md')
const content = readFileSync(canonPath, 'utf8')

const definedIds = new Set([...content.matchAll(/^## (CANON-\d+)/gm)].map((m) => m[1]))

const referencedIds = new Set([...content.matchAll(/CANON-(\d+)/g)].map((m) => `CANON-${m[1]}`))

const undefinedRefs = [...referencedIds].filter((id) => !definedIds.has(id))

if (undefinedRefs.length > 0) {
  console.warn(
    `[check-canon-references] WARNING: referenced but undefined CANON IDs: ${undefinedRefs.join(', ')}`,
  )
  console.warn('[check-canon-references] Add missing entries to docs/SYSTEM/CANON.md')
  process.exit(0) // warn-only; change to process.exit(1) when promoted to gate
}

console.log(
  `[check-canon-references] OK — ${definedIds.size} CANON entries defined, all cross-references valid`,
)

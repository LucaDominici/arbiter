#!/usr/bin/env node
// INV-NN ID stability gate (#610): fails if any catalog ID present in origin/main
// is absent in HEAD without status:"retired". Prevents accidental ID deletion.
//
// Usage: node scripts/check-id-stability.mjs
// Exits 0 if stable or catalog unchanged; exits 1 on violation.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()

function git(...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf-8' })
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

// Check if catalog.ts changed vs origin/main
const diffResult = git('diff', 'origin/main', '--name-only')
if (!diffResult.ok) {
  // Not a git repo or no origin — skip
  process.exit(0)
}

const changedFiles = diffResult.stdout.split('\n')
if (!changedFiles.includes('src/invariants/catalog.ts')) {
  // Catalog unchanged — nothing to check
  process.exit(0)
}

// Extract IDs and their retire status from a catalog.ts source string
function extractIds(src) {
  const ids = new Map() // id → { retired: boolean }
  const lines = src.split('\n')
  let currentId = null
  let blockLines = []

  for (const line of lines) {
    const idMatch = /^\s+id:\s*['"]([A-Z]+-\d+)['"]/.exec(line)
    if (idMatch) {
      currentId = idMatch[1]
      blockLines = [line]
    } else if (currentId) {
      blockLines.push(line)
      // Entry block ends at closing brace at entry indentation
      if (/^  \},?$/.test(line)) {
        const blockText = blockLines.join('\n')
        const retired = /status:\s*['"]retired['"]/.test(blockText)
        ids.set(currentId, { retired })
        currentId = null
        blockLines = []
      }
    }
  }

  return ids
}

// Get origin/main version of catalog.ts
const originResult = git('show', 'origin/main:src/invariants/catalog.ts')
if (!originResult.ok) {
  // origin/main doesn't have the catalog — new file, nothing to check
  process.exit(0)
}
const originSrc = originResult.stdout

// Get HEAD version (fall back to working tree if no commit yet)
const headResult = git('show', 'HEAD:src/invariants/catalog.ts')
const headSrc = headResult.ok
  ? headResult.stdout
  : readFileSync(resolve(root, 'src/invariants/catalog.ts'), 'utf-8')

const originIds = extractIds(originSrc)
const headIds = extractIds(headSrc)

const violations = []
for (const [id, { retired: wasRetired }] of originIds) {
  if (wasRetired) continue // already retired in origin — ok

  if (!headIds.has(id)) {
    violations.push(`  ${id}: removed without retire marker`)
  }
}

if (violations.length > 0) {
  process.stderr.write(
    `[check-id-stability] FAIL: ${violations.length} ID(s) removed from catalog without status:"retired":\n` +
      violations.join('\n') +
      '\n\n' +
      'To retire an ID, add status:"retired" + retiredReason to the entry.\n' +
      'See docs/SYSTEM/ID-STABILITY.md for the retirement protocol.\n',
  )
  process.exit(1)
}

process.stdout.write(`[check-id-stability] PASS: all ${originIds.size} origin IDs accounted for\n`)
process.exit(0)

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

// #2418: every branch below used to exit 0 SILENTLY on any git failure, so "this checkout
// has no baseline" and "git is broken / the repo is unreadable" produced the same green.
// An absent baseline ref is a resolved fact and is ANNOUNCED; a git invocation that fails
// for any other reason is an error (INV-53 exit 2), never a pass.
const baselineRef = git('rev-parse', '--verify', '--quiet', 'origin/main')
if (!baselineRef.ok) {
  process.stderr.write(
    '[check-id-stability] SKIP — origin/main is not present in this checkout, so there is ' +
      'no baseline catalog to compare against\n',
  )
  process.exit(0)
}

// Check if catalog.ts changed vs origin/main
const diffResult = git('diff', 'origin/main', '--name-only')
if (!diffResult.ok) {
  process.stderr.write(
    `[check-id-stability] ERROR — cannot diff against origin/main: ${diffResult.stderr.trim()}\n`,
  )
  process.exit(2)
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
      // Finalize previous entry if a new id: line appears before a closing brace
      if (currentId !== null) {
        const blockText = blockLines.join('\n')
        const retired = /status:\s*['"]retired['"]/.test(blockText)
        ids.set(currentId, { retired })
      }
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
  // The catalog does not exist on origin/main — it is a new file, so no ID can have been
  // removed. Announced rather than silent (#2418).
  process.stderr.write(
    '[check-id-stability] SKIP — src/invariants/catalog.ts does not exist on origin/main ' +
      '(new file), so no ID can have been dropped\n',
  )
  process.exit(0)
}
const originSrc = originResult.stdout

// Get HEAD version (fall back to working tree if no commit yet)
const headResult = git('show', 'HEAD:src/invariants/catalog.ts')
let headSrc = headResult.stdout
if (!headResult.ok) {
  try {
    headSrc = readFileSync(resolve(root, 'src/invariants/catalog.ts'), 'utf-8')
  } catch (err) {
    // #2418: this read used to run bare. The catalog exists on origin/main but is
    // unreadable here — that is an error, and treating it as an empty HEAD would report
    // EVERY invariant as removed.
    process.stderr.write(
      `[check-id-stability] ERROR — catalog.ts is on origin/main but unreadable in the ` +
        `working tree: ${err?.message ?? err}\n`,
    )
    process.exit(2)
  }
}

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

#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
/**
 * Gate: verify every .mjs file in .claude/hooks/ is documented in
 * docs/SYSTEM/HOOK-CONTRACTS.md and vice-versa.
 *
 * Exits 1 if any hook is undocumented or any doc entry has no matching file.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const hooksDir = join(root, '.claude', 'hooks')
const docPath = join(root, 'docs', 'SYSTEM', 'HOOK-CONTRACTS.md')

if (!existsSync(docPath)) {
  process.stderr.write(`check-hook-contracts: HOOK-CONTRACTS.md not found at ${docPath}\n`)
  process.exit(1)
}

// Collect .mjs filenames from the hooks directory
const filesInDir = new Set(
  readdirSync(hooksDir)
    .filter((f) => f.endsWith('.mjs'))
    .sort(),
)

// Collect hook filenames referenced in the doc (backtick-quoted *.mjs)
const docContent = readFileSync(docPath, 'utf-8')
const docMatches = docContent.matchAll(/`([a-z][a-z0-9-]*\.mjs)`/g)
const filesInDoc = new Set([...docMatches].map((m) => m[1]))

const undocumented = [...filesInDir].filter((f) => !filesInDoc.has(f))
const phantom = [...filesInDoc].filter((f) => !filesInDir.has(f))

let ok = true

if (undocumented.length > 0) {
  process.stderr.write(
    `check-hook-contracts: hooks present in directory but missing from HOOK-CONTRACTS.md:\n` +
      undocumented.map((f) => `  - ${f}`).join('\n') +
      '\n',
  )
  ok = false
}

if (phantom.length > 0) {
  process.stderr.write(
    `check-hook-contracts: hooks documented in HOOK-CONTRACTS.md but not found in directory:\n` +
      phantom.map((f) => `  - ${f}`).join('\n') +
      '\n',
  )
  ok = false
}

if (ok) {
  process.stdout.write(`check-hook-contracts: OK — ${filesInDir.size} hooks documented\n`)
  process.exit(0)
} else {
  process.exit(1)
}

#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: Guards src/generators/*.ts against direct node:fs write-op imports.
// CATALOG: Rejected fold-in into check-all.mjs because it requires generator-specific allowlist state.
// CATALOG: Rejected fold-in into check-no-direct-spawn.mjs because it enforces a different rule class (fs vs child_process).
//
// Prevents new src/generators/*.ts files from importing write-operation APIs
// directly from 'node:fs'. New generators must route writes through utils/fs.ts
// so that the dryRun flag is honoured at every call site.
//
// Read-only ops (readFileSync, existsSync) are not restricted.
// chmod/unlink post-write ops are separately tracked in the allowlist.
//
// Allowlist: legacy generators that already have guarded writes (added before this
// gate existed). Each entry is expected to guard all write calls with !dryRun.
// This list should SHRINK over time as generators are migrated to utils/fs.ts.
//
// Usage: node scripts/check-no-direct-fs-in-generators.mjs
// Exits 1 if any violation found.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

// Write-class APIs that bypass utils/fs.ts dryRun logic
const WRITE_OPS = /\b(writeFileSync|mkdirSync|copyFileSync|appendFileSync|renameSync)\b/

// Allowlisted generators with guarded writes (must be kept ≤ current list)
const ALLOWLIST = new Set([
  // #1519: api-middleware, contract-testing, debt-gates, githooks were removed —
  // they now route every package.json write through utils/pkg.ts mutatePackageJson
  // (atomic fs façade), so they no longer import raw node:fs write-ops.
  'claude.ts',
  'github-setup.ts',
  'integration-testing.ts',
  'kit.ts',
  'local-wrapper.ts',
  'seed.ts',
])

// Default or namespace import patterns also grant access to write APIs via fs.*
const DEFAULT_IMPORT = /import\s+\w+\s+from\s+'node:fs'/
const NAMESPACE_IMPORT = /import\s+\*\s+as\s+\w+\s+from\s+'node:fs'/
// write-class method calls on a namespace/default binding
const NS_WRITE_OPS = /\b\w+\.(writeFileSync|mkdirSync|copyFileSync|appendFileSync|renameSync)\s*\(/

try {
  const generatorsDir = join(process.cwd(), 'src', 'generators')
  let violations = 0

  for (const entry of readdirSync(generatorsDir)) {
    if (!entry.endsWith('.ts')) continue
    if (ALLOWLIST.has(entry)) continue

    const full = join(generatorsDir, entry)
    const src = readFileSync(full, 'utf-8')

    if (!src.includes("from 'node:fs'")) continue

    // Named import: import { writeFileSync } from 'node:fs'
    const namedImportMatch = src.match(/import\s*\{([^}]+)\}\s*from\s*'node:fs'/)
    if (namedImportMatch && WRITE_OPS.test(namedImportMatch[1])) {
      process.stderr.write(
        `  ${relative(process.cwd(), full)}: imports write-op from 'node:fs' — route through utils/fs.ts or add to allowlist with guarded writes\n`,
      )
      violations++
      continue
    }

    // Default or namespace import with write-class call: import fs from 'node:fs'; fs.writeFileSync(...)
    if ((DEFAULT_IMPORT.test(src) || NAMESPACE_IMPORT.test(src)) && NS_WRITE_OPS.test(src)) {
      process.stderr.write(
        `  ${relative(process.cwd(), full)}: default/namespace import of 'node:fs' with write call — route through utils/fs.ts or add to allowlist with guarded writes\n`,
      )
      violations++
    }
  }

  if (violations > 0) {
    process.stderr.write(
      `\n  ${violations} generator(s) import direct write APIs from 'node:fs'.\n` +
        `  New generators must use utils/fs.ts writeFile() which honours --dry-run.\n`,
    )
    process.exit(1)
  }
} catch (err) {
  process.stderr.write(`check-no-direct-fs-in-generators: unexpected error: ${String(err)}\n`)
  process.exit(1)
}

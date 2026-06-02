#!/usr/bin/env node
// check-spdx-headers.mjs — verify every src/**/*.ts file starts with SPDX-License-Identifier
// header: // SPDX-License-Identifier: Apache-2.0 (first non-empty line or within first 5 lines)
// Usage: node scripts/check-spdx-headers.mjs [--dir=path]
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, extname } from 'node:path'

const args = process.argv.slice(2)
const dirArg = args.find((a) => a.startsWith('--dir='))
const root = process.cwd()
const srcDir = dirArg ? resolve(dirArg.slice('--dir='.length)) : resolve(root, 'src')

const SPDX_IDENTIFIER = 'SPDX-License-Identifier: Apache-2.0'

/**
 * Recursively collect all .ts files under dir, excluding test paths.
 * @param {string} dir
 * @returns {string[]}
 */
function collectTsFiles(dir) {
  /** @type {string[]} */
  const files = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return files
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectTsFiles(full))
    } else if (entry.isFile() && extname(entry.name) === '.ts') {
      files.push(full)
    }
  }
  return files
}

/**
 * Return true if the file contains the SPDX identifier within its first 5 lines.
 * @param {string} filePath
 * @returns {boolean}
 */
function hasSpdxHeader(filePath) {
  let content
  try {
    content = readFileSync(filePath, 'utf-8')
  } catch {
    return false
  }
  const lines = content.split('\n').slice(0, 5)
  return lines.some((line) => line.includes(SPDX_IDENTIFIER))
}

const tsFiles = collectTsFiles(srcDir)
const missing = tsFiles.filter((f) => !hasSpdxHeader(f))

if (missing.length > 0) {
  process.stderr.write(`[check-spdx-headers] FAIL: ${missing.length} file(s) missing SPDX header\n`)
  for (const f of missing) {
    process.stderr.write(`  ${f}\n`)
  }
  process.stderr.write(
    `[check-spdx-headers] Add "// SPDX-License-Identifier: Apache-2.0" as the first line of each file.\n`,
  )
  process.exit(1)
}

process.stdout.write(
  `[check-spdx-headers] OK — all ${tsFiles.length} src/**/*.ts files have SPDX header\n`,
)

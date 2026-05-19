#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — SHA-pin self-check gate (INV-76, transition mode)
// Scans .github/workflows/ and .github/actions/ for non-SHA action refs.
// Transition mode: always exits 0; violations reported to stderr as [TRANSITION-WARN].
// Note: runCheck buffers and discards output for exit-0 processes — [TRANSITION-WARN] lines
// are visible when the script is run directly but suppressed in gate summary output.
// Does not read governanceLevel — self script must not inherit L2 hard-fail semantics.
// TODO(#886): flip process.exit(0) to process.exit(1) when W10 ships SHA-pinned workflows
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const CWD = process.cwd()

function collectYamlFiles(dir) {
  if (!existsSync(dir)) return []
  const results = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (err) {
    process.stderr.write(`  [check-action-pins] warn: cannot read ${dir}: ${err.message}\n`)
    return results
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...collectYamlFiles(full))
    } else if (entry.isFile() && (entry.name.endsWith('.yml') || entry.name.endsWith('.yaml'))) {
      results.push(full)
    }
  }
  return results
}

const yamlFiles = [
  ...collectYamlFiles(join(CWD, '.github', 'workflows')),
  ...collectYamlFiles(join(CWD, '.github', 'actions')),
]

// SHA-pinned: exactly 40 hex characters after @  (case-insensitive per git convention)
const SHA_PATTERN = /^[0-9a-f]{40}$/i
// Matches 'uses: action@ref' and '- uses: action@ref'; captures action (group 1) and ref (group 2).
// USES_PATTERN requires leading whitespace; column-0 'uses:' is not valid GitHub Actions syntax.
const USES_PATTERN = /^\s+(?:-\s+)?uses:\s+["']?([^@\s"']+)@([^\s#"']+)["']?/gm

const violations = []
for (const file of yamlFiles) {
  let content
  try {
    content = readFileSync(file, 'utf-8')
  } catch (err) {
    process.stderr.write(`  [check-action-pins] warn: cannot read ${file}: ${err.message}\n`)
    continue
  }
  for (const match of content.matchAll(USES_PATTERN)) {
    const action = match[1]
    const ref = match[2]
    if (action.startsWith('.')) continue
    if (action.startsWith('docker://')) continue
    if (!SHA_PATTERN.test(ref)) {
      violations.push({ file: relative(CWD, file), action, ref })
    }
  }
}

if (violations.length === 0) {
  console.log('  check-action-pins: all action references are SHA-pinned')
  process.exit(0)
}

// Transition mode: warn to stderr (visible in gate runs) but do not fail
// TODO(#886): flip process.exit(0) to process.exit(1) when W10 ships SHA-pinned workflows
process.stderr.write(
  `  [TRANSITION-WARN] check-action-pins: ${violations.length} non-SHA action reference(s) — INV-76 transition (W10 #886 to enforce):\n`,
)
for (const v of violations) {
  process.stderr.write(`    ${v.file}: ${v.action}@${v.ref}\n`)
}
process.exit(0)

#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — SHA-pin self-check gate (INV-76, transition mode)
// Scans .github/workflows/ and .github/actions/ for non-SHA action refs.
// Transition mode: always exits 0; violations reported as [TRANSITION-WARN].
// Does not read governanceLevel — self script must not inherit L2 hard-fail semantics.
// TODO(#886): flip process.exit(0) to process.exit(1) when W10 ships SHA-pinned workflows
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const CWD = process.cwd()

function collectYamlFiles(dir) {
  if (!existsSync(dir)) return []
  const results = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
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

function stripQuotes(s) {
  return (s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))
    ? s.slice(1, -1)
    : s
}

const violations = []
for (const file of yamlFiles) {
  const content = readFileSync(file, 'utf-8')
  for (const match of content.matchAll(USES_PATTERN)) {
    const action = stripQuotes(match[1])
    const ref = stripQuotes(match[2])
    if (action.startsWith('.')) continue
    if (action.startsWith('docker://')) continue
    if (!SHA_PATTERN.test(ref)) {
      violations.push({ file: file.replace(CWD + '/', ''), action, ref })
    }
  }
}

if (violations.length === 0) {
  console.log('  check-action-pins: all action references are SHA-pinned')
  process.exit(0)
}

// Transition mode: warn but do not fail — flip to exit(1) at TODO(#886)
console.log(
  `  [TRANSITION-WARN] check-action-pins: ${violations.length} non-SHA action reference(s) — INV-76 transition (W10 #886 to enforce):`,
)
for (const v of violations) {
  console.log(`    ${v.file}: ${v.action}@${v.ref}`)
}
process.exit(0) // TODO(#886): flip to process.exit(1) when W10 ships SHA-pinned workflows

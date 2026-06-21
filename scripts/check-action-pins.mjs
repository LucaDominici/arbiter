#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — SHA-pin self-check gate (INV-76, enforced)
// Scans .github/workflows/ and .github/actions/ for non-SHA action refs.
// Enforced (#886): any non-SHA remote action ref fails the gate (exit 1). Local composite
// actions (./…) and docker:// refs are exempt. All arbiter workflows + composite actions are
// 40-hex pinned, so this gate passes clean; a future tag-pinned ref is a hard stop.
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { collectYamlFiles } from './lib/workflow-scan.mjs'

const CWD = process.cwd()

const onReadError = (dir, err) =>
  process.stderr.write(`  [check-action-pins] warn: cannot read ${dir}: ${err.message}\n`)

const yamlFiles = [
  ...collectYamlFiles(join(CWD, '.github', 'workflows'), { onReadError }),
  ...collectYamlFiles(join(CWD, '.github', 'actions'), { onReadError }),
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

// Enforced (#886): a non-SHA action reference is a hard stop — fail the gate.
process.stderr.write(
  `  check-action-pins: ${violations.length} non-SHA action reference(s) — INV-76 requires 40-hex SHA pins:\n`,
)
for (const v of violations) {
  process.stderr.write(`    ${v.file}: ${v.action}@${v.ref}\n`)
}
process.exit(1)

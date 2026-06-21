#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — SHA-pin self-check gate (INV-76, enforced)
// Scans .github/workflows/ and .github/actions/ for non-SHA action refs.
// ALSO scans the workflow TEMPLATES arbiter SHIPS (src/templates/**/workflows/*.ejs): a
// fabricated/short/tag SHA in an .ejs template is emitted verbatim into a user's project, so a
// blind spot there ships a broken, unverifiable pin to consumers while the self-gate stays green.
// (#1491 / security-privacy MAJOR-3). Templated refs (action@<%= … %> / action@${ … }) are
// expression interpolation, not literal pins, and are skipped.
// Enforced (#886): any non-SHA remote action ref fails the gate (exit 1). Local composite
// actions (./…) and docker:// refs are exempt. All arbiter workflows + composite actions are
// 40-hex pinned, so this gate passes clean; a future tag-pinned ref is a hard stop.
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

import { collectYamlFiles, collectWorkflowTemplates } from './lib/workflow-scan.mjs'

const CWD = process.cwd()

const onReadError = (dir, err) =>
  process.stderr.write(`  [check-action-pins] warn: cannot read ${dir}: ${err.message}\n`)

const yamlFiles = [
  ...collectYamlFiles(join(CWD, '.github', 'workflows'), { onReadError }),
  ...collectYamlFiles(join(CWD, '.github', 'actions'), { onReadError }),
]

// Workflow templates arbiter emits to user projects. A bad pin here never lands in arbiter's own
// .github/ (so the yaml scan above misses it) but ships to every generated project — fail-closed.
const templateFiles = collectWorkflowTemplates(join(CWD, 'src', 'templates'), { onReadError })

// SHA-pinned: exactly 40 hex characters after @  (case-insensitive per git convention)
const SHA_PATTERN = /^[0-9a-f]{40}$/i
// A templated ref is EJS output (<%= … %>) or a shell/GitHub expression (${ … } / ${{ … }})
// interpolated at render time, not a literal pin — it cannot be SHA-validated statically.
const TEMPLATED_REF = /^(?:<%|\$\{)/
// Matches 'uses: action@ref' and '- uses: action@ref'; captures action (group 1) and ref (group 2).
// USES_PATTERN requires leading whitespace; column-0 'uses:' is not valid GitHub Actions syntax.
const USES_PATTERN = /^\s+(?:-\s+)?uses:\s+["']?([^@\s"']+)@([^\s#"']+)["']?/gm

const violations = []
const scan = (file, content) => {
  for (const match of content.matchAll(USES_PATTERN)) {
    const action = match[1]
    const ref = match[2]
    if (action.startsWith('.')) continue
    if (action.startsWith('docker://')) continue
    if (TEMPLATED_REF.test(ref)) continue
    if (!SHA_PATTERN.test(ref)) {
      violations.push({ file: relative(CWD, file), action, ref })
    }
  }
}

for (const file of [...yamlFiles, ...templateFiles]) {
  let content
  try {
    content = readFileSync(file, 'utf-8')
  } catch (err) {
    process.stderr.write(`  [check-action-pins] warn: cannot read ${file}: ${err.message}\n`)
    continue
  }
  scan(file, content)
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

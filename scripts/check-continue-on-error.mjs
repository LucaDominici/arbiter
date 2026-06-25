#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: anti-fake-green parser-backed continue-on-error guard (A3, #1497). A GATING job/step
// CATALOG:   carrying a const-true `continue-on-error` swallows its own failure — a red gate goes
// CATALOG:   green with the regression never surfaced. Unlike the regex sibling check-workflow-
// CATALOG:   test-integrity, the truthy value is read through the YAML 1.1 boolean grammar, so the
// CATALOG:   const-true forms a regex misses are caught: `on`/`yes`/`y` (YAML-1.1 → true) and
// CATALOG:   `${{ true }}`. js-yaml confirms when present; a tolerant token set is the fallback.
// CATALOG:   Sole exempt step = artifact up/download; informational workflows, an audited
// CATALOG:   `# arbiter-allow-continue-on-error` marker and the drift-shadow `parity` step are
// CATALOG:   honored. When run in arbiter it ALSO vets the workflow TEMPLATES it ships
// CATALOG:   (src/templates/**/workflows/*.ejs) so a poisoned `.ejs` cannot ship a swallowed gate
// CATALOG:   to every generated project. NO-DATA (no workflows) = PASS.
// CATALOG: Rejected fold-in into check-workflow-test-integrity.mjs: that gate is a deliberately
// CATALOG:   conservative regex (it cannot parse the YAML-1.1 `on:`→true trap) and is wired into
// CATALOG:   check-all directly; this parser-backed guard is folded into the anti-fake-green
// CATALOG:   aggregate and additionally scans the shipped templates — distinct surface + lifecycle.
// Exit codes per INV-53: 0=PASS, 1=FAIL (swallowed gate), 2=ERROR (self).
// Usage: node scripts/check-continue-on-error.mjs [--dir <path>] [--help]
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  collectYamlFiles,
  collectWorkflowTemplates,
  parseHelpAndDir,
} from './lib/workflow-scan.mjs'
import { findContinueOnErrorViolations } from './lib/continue-on-error-core.mjs'

const args = process.argv.slice(2)
const { cwd: ROOT } = parseHelpAndDir(args, {
  usage: [
    'Usage: node scripts/check-continue-on-error.mjs [--dir <path>]',
    '',
    'Parser-backed swallowed-gate guard. Fails when a GATING job/step carries a const-true',
    '`continue-on-error` — catching the YAML-1.1 `on`/`yes` and `${{ true }}` forms a plain',
    'regex misses. The sole sanctioned step is an artifact up/download; informational workflows',
    'and an audited `# arbiter-allow-continue-on-error` marker are exempt. In the arbiter repo it',
    'also vets the shipped workflow TEMPLATES. NO-DATA (no workflows) is a PASS.',
    '',
    'Options:',
    '  --dir <path>    Root directory to scan (default: cwd)',
    '  --help, -h      Show this help and exit',
    '',
  ].join('\n'),
})

function main() {
  const findings = []

  // 1) The project's own emitted workflows.
  for (const file of collectYamlFiles(join(ROOT, '.github', 'workflows'))) {
    for (const v of findContinueOnErrorViolations(file)) findings.push(v)
  }

  // 2) When run inside arbiter, also vet the workflow TEMPLATES it ships — a poisoned `.ejs` would
  //    ship a swallowed gate to every generated project while the arbiter self-gate stays green.
  const templatesRoot = join(ROOT, 'src', 'templates')
  if (existsSync(templatesRoot)) {
    for (const file of collectWorkflowTemplates(templatesRoot)) {
      for (const v of findContinueOnErrorViolations(file)) findings.push(v)
    }
  }

  if (findings.length > 0) {
    process.stderr.write(
      'check-continue-on-error: FAIL — a GATING job/step swallows its failure via continue-on-error:\n',
    )
    for (const f of findings) process.stderr.write(`    ${f}\n`)
    process.stderr.write(
      '  Fix: let the gate fail the run. If the step is genuinely non-blocking, make it an\n' +
        '  artifact up/download, an informational workflow, or annotate it with an audited\n' +
        '  `# arbiter-allow-continue-on-error: <reason>` marker.\n',
    )
    return 1
  }

  process.stdout.write(
    'check-continue-on-error: no swallowed gates — PASS (NO-DATA when no workflows)\n',
  )
  return 0
}

try {
  process.exit(main())
} catch (e) {
  process.stderr.write(`check-continue-on-error: ERROR — ${e?.message ?? e}\n`)
  process.exit(2)
}

#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: anti-fake-green secret-presence guard (#1497). A CI step that depends on a secret which
// CATALOG:   is EMPTY must FAIL loudly — never silently skip and report green. The classic vector:
// CATALOG:     [ -z "$SECRET" ] && { echo "no secret — skip"; exit 0; }   # green, work never done
// CATALOG:   This guard scans workflow run-steps for the silent-skip-on-empty-secret idiom: an
// CATALOG:   emptiness test on a secret-backed env/assignment var that reaches `exit 0` WITHOUT an
// CATALOG:   explicit `vars.SKIP_<NAME>` opt-out. The ONLY sanctioned skip is an explicit
// CATALOG:   SKIP_<NAME>=true; otherwise the empty-secret branch must `exit 1` loud. The auto-
// CATALOG:   provided secrets.GITHUB_TOKEN is exempt (always present), and informational workflows
// CATALOG:   (heartbeat/nightly/weekly/monthly/notify) are exempt — their best-effort steps are not
// CATALOG:   gates. When run in the arbiter repo it ALSO vets the workflow TEMPLATES it ships
// CATALOG:   (src/templates/**/workflows/*.ejs), so a poisoned template cannot ship a fake-green to
// CATALOG:   every generated project. NO-DATA (no workflows / no secret steps) = PASS.
// CATALOG: Rejected fold-in into check-workflow-test-integrity (continue-on-error axis): a
// CATALOG:   different fake-green (skip-on-empty-secret vs a swallowed step failure) — kept focused.
// Exit codes per INV-53: 0=PASS, 1=FAIL (unguarded secret-skip), 2=ERROR (self).
// Usage: node scripts/check-secret-presence.mjs [--dir <path>] [--help]
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  collectYamlFiles,
  collectWorkflowTemplates,
  parseHelpAndDir,
} from './lib/workflow-scan.mjs'
import { findSecretSkipViolations } from './lib/secret-presence-core.mjs'

const args = process.argv.slice(2)
const { cwd: ROOT } = parseHelpAndDir(args, {
  usage: [
    'Usage: node scripts/check-secret-presence.mjs [--dir <path>]',
    '',
    'Fails when a workflow run-step tests a secret-backed variable for emptiness and then',
    '`exit 0` (silent skip) without an explicit `vars.SKIP_<NAME>` opt-out — a fake-green where',
    'a missing secret turns a gate green with the real work never done. The sanctioned shape:',
    '  test -n "$SECRET" || { [ "${SKIP_X}" = "true" ] && exit 0 || { echo "::error::..."; exit 1; }; }',
    'GITHUB_TOKEN and informational workflows (heartbeat/nightly/weekly/monthly/notify) are exempt.',
    'NO-DATA (no workflows or no secret-dependent steps) is a PASS.',
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
  const wfDir = join(ROOT, '.github', 'workflows')
  for (const file of collectYamlFiles(wfDir)) {
    for (const v of findSecretSkipViolations(file)) findings.push(v)
  }

  // 2) When run inside arbiter, also vet the workflow TEMPLATES it ships — a poisoned `.ejs`
  //    would ship a silent-skip fake-green to every generated project while self stays green.
  const templatesRoot = join(ROOT, 'src', 'templates')
  if (existsSync(templatesRoot)) {
    for (const file of collectWorkflowTemplates(templatesRoot)) {
      for (const v of findSecretSkipViolations(file)) findings.push(v)
    }
  }

  if (findings.length > 0) {
    process.stderr.write(
      'check-secret-presence: FAIL — secret-dependent step silently skips on an empty secret:\n',
    )
    for (const f of findings) process.stderr.write(`    ${f}\n`)
    process.stderr.write(
      '  Fix: gate the skip behind an explicit `vars.SKIP_<NAME>=true`, otherwise fail loud:\n' +
        '    test -n "$SECRET" || { [ "${SKIP_X}" = "true" ] && exit 0 \\\n' +
        '      || { echo "::error::SECRET is empty and SKIP_X is not true"; exit 1; }; }\n',
    )
    return 1
  }

  process.stdout.write(
    'check-secret-presence: no unguarded secret-skip steps — PASS (NO-DATA when no secret steps)\n',
  )
  return 0
}

try {
  process.exit(main())
} catch (e) {
  process.stderr.write(`check-secret-presence: ERROR — ${e?.message ?? e}\n`)
  process.exit(2)
}

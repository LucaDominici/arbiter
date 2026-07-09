#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// arbiter — E2E flaky-test quarantine hygiene gate (#1445, INV-130).
//
// The quarantine registry (.arbiter/e2e/quarantine.json) ANNOTATES known-unstable
// tests but NEVER suppresses them: quarantined tests still run and still report, and
// CI's exit code is unchanged by an entry's mere presence. What this gate enforces is
// that the registry itself does not ROT — a quarantine must be a temporary, owned,
// tracked exception, not a permanent silent mute. Every entry must carry the full
// required-field set AND a FUTURE `expires` date; an expired, malformed, or
// incomplete entry fails closed. Self-SKIPs (exit 0) when no registry is present.
//
// Exit codes (INV-53): 0 = clean / no registry · 1 = expired or malformed entry ·
// 2 = unexpected error.
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { validateQuarantine, QUARANTINE_REQUIRED_FIELDS } from './lib/e2e-reliability.mjs'

function parseDir(argv) {
  const i = argv.indexOf('--dir')
  return i >= 0 && argv[i + 1] ? argv[i + 1] : process.cwd()
}
const ROOT = parseDir(process.argv.slice(2))
const REGISTRY = join(ROOT, '.arbiter', 'e2e', 'quarantine.json')

if (!existsSync(REGISTRY)) {
  process.stdout.write(
    'check-e2e-quarantine: OK — no quarantine registry (.arbiter/e2e/quarantine.json absent)\n',
  )
  process.exit(0)
}

let registry
try {
  registry = JSON.parse(readFileSync(REGISTRY, 'utf-8'))
} catch (err) {
  // A present-but-broken registry must not silently pass — fail closed.
  process.stderr.write(
    `check-e2e-quarantine: FAIL — ${REGISTRY} is not valid JSON: ${err.message}\n`,
  )
  process.exit(1)
}

let result
try {
  result = validateQuarantine(registry, new Date())
} catch (err) {
  process.stderr.write(`check-e2e-quarantine: error validating registry: ${err.message}\n`)
  process.exit(2)
}

if (!result.ok) {
  process.stderr.write(
    `check-e2e-quarantine: FAIL — ${result.errors.length} quarantine issue(s):\n`,
  )
  for (const e of result.errors) process.stderr.write(`  [FAIL] ${e}\n`)
  process.stderr.write(
    `Each entry needs fields [${QUARANTINE_REQUIRED_FIELDS.join(', ')}] and a FUTURE 'expires' date. ` +
      'A quarantine is a temporary owned exception, not a permanent mute.\n',
  )
  process.exit(1)
}

const count = Array.isArray(registry) ? registry.length : (registry.entries || []).length
process.stdout.write(
  `check-e2e-quarantine: OK — ${count} quarantine entry(ies), all complete and unexpired\n`,
)
process.exit(0)

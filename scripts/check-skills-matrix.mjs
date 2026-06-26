#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Validate a skills-matrix.json (defaults to src/compatibility/skills-matrix.json):
//   1. Required fields present + integrationStatus is a known enum value
//      (a standalone re-implementation — this gate does NOT load Zod or
//      skills-validator.ts; it runs as plain node with zero TS deps)
//   2. All `replaces` entries reference a canonical SKILL_NAME
// Usage: node scripts/check-skills-matrix.mjs [matrix.json]
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const matrixPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(root, 'src/compatibility/skills-matrix.json')

// Canonical allow-list — read from the SKILL_NAMES SSOT (src/generators/
// skill-names.json) so this plain-JS gate cannot drift from the TS sources the
// way a hand-copied Set did (#1583). One source feeds skills.ts, the validator,
// and this gate.
const namesPath = resolve(root, 'src/generators/skill-names.json')
let VALID_SKILL_NAMES
try {
  VALID_SKILL_NAMES = new Set(JSON.parse(readFileSync(namesPath, 'utf-8')))
} catch (err) {
  console.error(`[skills-matrix] FAIL: cannot read SKILL_NAMES SSOT ${namesPath}: ${err.message}`)
  process.exit(1)
}

let raw
try {
  raw = JSON.parse(readFileSync(matrixPath, 'utf-8'))
} catch (err) {
  console.error(`[skills-matrix] FAIL: cannot read ${matrixPath}: ${err.message}`)
  process.exit(1)
}

const errors = []

if (raw.$schemaVersion !== 1) {
  errors.push(`$schemaVersion must be 1, got ${raw.$schemaVersion}`)
}
if (!Array.isArray(raw.skills)) {
  errors.push('skills must be an array')
} else {
  for (const skill of raw.skills) {
    const required = [
      'skillId',
      'pluginOwner',
      'versionRange',
      'role',
      'integrationStatus',
      'replaces',
      'referenceUrl',
    ]
    for (const field of required) {
      if (skill[field] === undefined)
        errors.push(`"${skill.skillId ?? '?'}" missing field: ${field}`)
    }
    const validStatuses = ['proven', 'beta', 'unknown']
    if (!validStatuses.includes(skill.integrationStatus)) {
      errors.push(`"${skill.skillId}" has invalid integrationStatus: "${skill.integrationStatus}"`)
    }
    if (Array.isArray(skill.replaces)) {
      for (const name of skill.replaces) {
        if (!VALID_SKILL_NAMES.has(name)) {
          errors.push(
            `"${skill.skillId}" replaces unknown SKILL_NAME "${name}". Valid: ${[...VALID_SKILL_NAMES].join(', ')}`,
          )
        }
      }
    }
  }
}

if (errors.length > 0) {
  console.error(`[skills-matrix] FAIL: ${errors.length} error(s):`)
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}

process.stdout.write(`[skills-matrix] PASS: ${raw.skills.length} entries, all valid
`)

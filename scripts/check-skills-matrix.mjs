#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Validate src/compatibility/skills-matrix.json:
//   1. Schema is valid (Zod via skills-validator.ts)
//   2. All `replaces` entries reference actual SKILL_NAMES from generators/skills.ts
// Usage: node scripts/check-skills-matrix.mjs
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
const matrixPath = resolve(root, 'src/compatibility/skills-matrix.json')

const VALID_SKILL_NAMES = new Set([
  'tdd',
  'verification',
  'architect-review',
  'clean-code',
  'understand-code',
  'codebase-audit',
  'epic-decompose',
  'configure',
])

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

console.log(`[skills-matrix] PASS: ${raw.skills.length} entries, all valid`)

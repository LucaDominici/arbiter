#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// scripts/check-evidence-bundle.mjs
// INV-90 gate: validate every .evidence/task-NNN/*.json against schemas/evidence-bundle.schema.json.
//
// Usage: node scripts/check-evidence-bundle.mjs [--evidence-dir=<path>] [--schema=<path>]
//
// Exit codes:
//   0 — all bundles valid (or no bundles found — vacuous pass)
//   1 — one or more bundles failed schema validation (no provenance violation involved)
//   2 — any bundle's `provenance` block is present but malformed (#2164; dominant — wins
//       over exit 1 even when non-provenance violations are also present)
//
// Arguments:
//   --evidence-dir=<path>   Override evidence directory (default: .evidence/)
//   --schema=<path>         Override schema file path (default: schemas/evidence-bundle.schema.json)
//   --help                  Print usage and exit 0

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(__dirname, '..')

// ─── Argument parsing ─────────────────────────────────────────────────────────

const args = process.argv.slice(2)

if (args.includes('--help')) {
  process.stdout.write(
    [
      'Usage: node scripts/check-evidence-bundle.mjs [--evidence-dir=<path>] [--schema=<path>]',
      '',
      'Validates every .evidence/task-NNN/*.json file against schemas/evidence-bundle.schema.json.',
      'Exits 0 when all bundles are valid or no bundles are found.',
      'Exits 1 when any bundle fails schema validation.',
      '',
      'Options:',
      '  --evidence-dir=<path>   Evidence directory (default: .evidence/)',
      '  --schema=<path>         Schema file path (default: schemas/evidence-bundle.schema.json)',
      '  --help                  Show this help and exit',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

const evidenceDirArg = args.find((a) => a.startsWith('--evidence-dir='))
const schemaArg = args.find((a) => a.startsWith('--schema='))

const evidenceDir = evidenceDirArg
  ? resolve(evidenceDirArg.split('=')[1])
  : resolve(repoRoot, '.evidence')

const schemaPath = schemaArg
  ? resolve(schemaArg.split('=')[1])
  : resolve(repoRoot, 'schemas', 'evidence-bundle.schema.json')

// ─── Schema loading ───────────────────────────────────────────────────────────

/** @type {Record<string, unknown>} */
let schema
try {
  schema = JSON.parse(readFileSync(schemaPath, 'utf-8'))
} catch (err) {
  process.stdout.write(
    `[check-evidence-bundle] FAIL: cannot load schema at ${schemaPath}: ${err.message}\n`,
  )
  process.exit(1)
}

// ─── Minimal JSON Schema v7 validator ────────────────────────────────────────
// Implements required subset: type, required, additionalProperties, properties,
// enum, pattern, minLength, format (partial), items, $ref, $defs.

/**
 * Resolve a $ref within the root schema.
 * Supports only local $defs references: "#/$defs/Name".
 * @param {string} ref
 * @param {Record<string, unknown>} rootSchema
 * @returns {Record<string, unknown>}
 */
function resolveRef(ref, rootSchema) {
  if (!ref.startsWith('#/')) {
    throw new Error(`Unsupported $ref: ${ref}`)
  }
  const parts = ref.slice(2).split('/')
  let node = rootSchema
  for (const part of parts) {
    if (typeof node !== 'object' || node === null || !(part in node)) {
      throw new Error(`Cannot resolve $ref: ${ref}`)
    }
    node = /** @type {Record<string, unknown>} */ (node)[part]
  }
  return /** @type {Record<string, unknown>} */ (node)
}

/**
 * Validate a value against a JSON Schema node.
 * Returns an array of validation error messages (empty = valid).
 * @param {unknown} value
 * @param {Record<string, unknown>} schemaNode
 * @param {Record<string, unknown>} rootSchema
 * @param {string} path
 * @returns {string[]}
 */
function validate(value, schemaNode, rootSchema, path) {
  /** @type {string[]} */
  const errors = []

  // Resolve $ref
  if ('$ref' in schemaNode) {
    const resolved = resolveRef(/** @type {string} */ (schemaNode['$ref']), rootSchema)
    return validate(value, resolved, rootSchema, path)
  }

  // type check
  if ('type' in schemaNode) {
    const expected = schemaNode['type']
    const actual = Array.isArray(value) ? 'array' : typeof value
    if (actual !== expected) {
      errors.push(`${path}: expected type "${expected}", got "${actual}"`)
      return errors // no point checking further if type is wrong
    }
  }

  // enum check
  if ('enum' in schemaNode && Array.isArray(schemaNode['enum'])) {
    if (!schemaNode['enum'].includes(value)) {
      errors.push(
        `${path}: value ${JSON.stringify(value)} not in enum ${JSON.stringify(schemaNode['enum'])}`,
      )
    }
  }

  // string-specific checks
  if (typeof value === 'string') {
    if ('minLength' in schemaNode && typeof schemaNode['minLength'] === 'number') {
      if (value.length < schemaNode['minLength']) {
        errors.push(`${path}: string length ${value.length} < minLength ${schemaNode['minLength']}`)
      }
    }
    if ('pattern' in schemaNode && typeof schemaNode['pattern'] === 'string') {
      const re = new RegExp(schemaNode['pattern'])
      if (!re.test(value)) {
        errors.push(`${path}: value "${value}" does not match pattern "${schemaNode['pattern']}"`)
      }
    }
    // format: date-time — basic ISO 8601 check
    if (schemaNode['format'] === 'date-time') {
      const d = Date.parse(value)
      if (Number.isNaN(d)) {
        errors.push(`${path}: value "${value}" is not a valid date-time`)
      }
    }
  }

  // object-specific checks
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const obj = /** @type {Record<string, unknown>} */ (value)

    // required properties
    if ('required' in schemaNode && Array.isArray(schemaNode['required'])) {
      for (const req of schemaNode['required']) {
        if (!(req in obj)) {
          errors.push(`${path}: missing required property "${req}"`)
        }
      }
    }

    // additionalProperties: false
    if (schemaNode['additionalProperties'] === false && 'properties' in schemaNode) {
      const allowed = new Set(
        Object.keys(/** @type {Record<string, unknown>} */ (schemaNode['properties'])),
      )
      for (const key of Object.keys(obj)) {
        if (!allowed.has(key)) {
          errors.push(`${path}: additional property "${key}" is not allowed`)
        }
      }
    }

    // validate each property
    if ('properties' in schemaNode && typeof schemaNode['properties'] === 'object') {
      const props = /** @type {Record<string, unknown>} */ (schemaNode['properties'])
      for (const [key, propSchema] of Object.entries(props)) {
        if (key in obj) {
          const childErrors = validate(
            obj[key],
            /** @type {Record<string, unknown>} */ (propSchema),
            rootSchema,
            `${path}.${key}`,
          )
          errors.push(...childErrors)
        }
      }
    }
  }

  // array-specific checks
  if (Array.isArray(value)) {
    if (
      'items' in schemaNode &&
      typeof schemaNode['items'] === 'object' &&
      schemaNode['items'] !== null
    ) {
      const itemSchema = /** @type {Record<string, unknown>} */ (schemaNode['items'])
      for (let i = 0; i < value.length; i++) {
        const childErrors = validate(value[i], itemSchema, rootSchema, `${path}[${i}]`)
        errors.push(...childErrors)
      }
    }
  }

  return errors
}

// ─── Bundle discovery ─────────────────────────────────────────────────────────

if (!existsSync(evidenceDir)) {
  process.stdout.write(
    `[check-evidence-bundle] OK — evidence directory not found at ${evidenceDir}, vacuous pass\n`,
  )
  process.exit(0)
}

/** @type {string[]} */
const taskDirs = []
try {
  for (const entry of readdirSync(evidenceDir)) {
    const full = join(evidenceDir, entry)
    if (entry.startsWith('task-') && statSync(full).isDirectory()) {
      taskDirs.push(full)
    }
  }
} catch (err) {
  process.stdout.write(
    `[check-evidence-bundle] FAIL: cannot read evidence directory: ${err.message}\n`,
  )
  process.exit(1)
}

if (taskDirs.length === 0) {
  process.stdout.write(
    `[check-evidence-bundle] OK — no task evidence directories found, vacuous pass\n`,
  )
  process.exit(0)
}

// ─── Validation loop ──────────────────────────────────────────────────────────

let totalBundles = 0
let violations = 0
// #2164: a malformed `provenance` block is dominant — it exits 2 even when other,
// non-provenance violations are also present in the same or another bundle. Any other
// violation (with no provenance violation anywhere in the run) keeps the pre-existing
// exit 1.
let provenanceViolation = false

for (const taskDir of taskDirs) {
  /** @type {string[]} */
  let jsonFiles
  try {
    jsonFiles = readdirSync(taskDir).filter((f) => f.endsWith('.json'))
  } catch (err) {
    process.stdout.write(
      `[check-evidence-bundle] FAIL: cannot read task dir ${taskDir}: ${err.message}\n`,
    )
    violations++
    continue
  }

  for (const jsonFile of jsonFiles) {
    const filePath = join(taskDir, jsonFile)
    totalBundles++

    /** @type {unknown} */
    let parsed
    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf-8'))
    } catch (err) {
      process.stdout.write(
        `[check-evidence-bundle] FAIL: invalid JSON in ${filePath}: ${err.message}\n`,
      )
      violations++
      continue
    }

    const errors = validate(parsed, schema, schema, filePath)
    if (errors.length > 0) {
      const provenancePrefix = `${filePath}.provenance`
      for (const err of errors) {
        process.stdout.write(`[check-evidence-bundle] FAIL: ${err}\n`)
        if (err.startsWith(provenancePrefix)) {
          provenanceViolation = true
        }
      }
      violations++
    }
  }
}

// ─── Result ───────────────────────────────────────────────────────────────────

if (provenanceViolation) {
  process.stdout.write(
    `[check-evidence-bundle] FAIL: malformed provenance block (${violations} bundle(s) failed, ${totalBundles} checked)\n`,
  )
  process.exit(2)
}

if (violations > 0) {
  process.stdout.write(
    `[check-evidence-bundle] FAIL: ${violations} bundle(s) failed schema validation (${totalBundles} checked)\n`,
  )
  process.exit(1)
}

process.stdout.write(
  `[check-evidence-bundle] OK — ${totalBundles} evidence bundle(s) passed schema validation\n`,
)
process.exit(0)

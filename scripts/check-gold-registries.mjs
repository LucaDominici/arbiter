#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// check-gold-registries.mjs — per-stack false-gap meta-gate (#1413).
//
// Validates every per-stack registry standards/gold-registry.<stack>.yml:
//   1. it parses as YAML and carries a `checks` array,
//   2. every check is SAFE (risk !== 'RISKY') — the false-gap meta-gate: a fragile single-proxy
//      grep or app-specific absolute count is RISKY and must never silently score a stack,
//   3. every value-op check (the report-reading kind) declares format + select + op and either a
//      threshold_ref OR an args.expected literal — no value check may score on an unresolved bar,
//   4. every threshold_ref a registry references EXISTS in standards/thresholds.yml — a dangling ref
//      would resolve to N (no silent pass) but is a registry authoring error, caught here.
//
// This is the additive per-stack companion to gold-audit --strict (which gates a single registry).
// The integrator wires the runCheck line into scripts/check-all.mjs at Phase 4 (do NOT edit it here).
//
// Exit codes (INV-53 contract): 0 PASS, 1 violations found, 2 IO error.
//
// Usage: node scripts/check-gold-registries.mjs [--standards DIR]

import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'

const args = process.argv.slice(2)
const stdArg = args.indexOf('--standards')
const STANDARDS = stdArg >= 0 && args[stdArg + 1] ? resolve(args[stdArg + 1]) : resolve('standards')

const VALUE_FORMATS = new Set(['json', 'xml', 'regex', 'go-coverprofile'])
const VALUE_OPS = new Set(['gte', 'lte', 'eq'])
const PER_STACK_RE = /^gold-registry\.([a-z0-9-]+)\.yml$/i

let violations = 0
const fail = (msg) => {
  process.stdout.write(`  ${msg}\n`)
  violations++
}

/** Load the threshold_ref keys declared in standards/thresholds.yml (or empty set if absent). */
function loadThresholdRefs() {
  const abs = join(STANDARDS, 'thresholds.yml')
  if (!existsSync(abs)) return { refs: new Set(), present: false }
  let doc
  try {
    doc = parseYaml(readFileSync(abs, 'utf-8')) || {}
  } catch (err) {
    process.stdout.write(`  Cannot parse thresholds.yml: ${err.message}\n`)
    process.exit(2)
  }
  const table =
    doc && typeof doc.thresholds === 'object' && doc.thresholds !== null ? doc.thresholds : {}
  return { refs: new Set(Object.keys(table)), present: true }
}

function validateCheck(file, check, knownRefs) {
  const id = check && check.id ? String(check.id) : '<no-id>'
  if (check.risk === 'RISKY') {
    fail(`${file}: check '${id}' is RISKY — the false-gap meta-gate refuses fragile checks`)
  }
  if (check.type !== 'value') return
  const a = check.args || {}
  // Legacy single-line value checks (equals, no format) are still allowed; only report-reading
  // value checks (with a format) carry the extended contract.
  if (a.format === undefined || a.format === '') return
  if (!VALUE_FORMATS.has(a.format)) {
    fail(`${file}: value check '${id}' has invalid format '${a.format}' (json|xml|regex)`)
  }
  if (typeof a.select !== 'string' || a.select.length === 0) {
    fail(`${file}: value check '${id}' missing args.select`)
  }
  if (!VALUE_OPS.has(a.op)) {
    fail(`${file}: value check '${id}' has invalid op '${a.op}' (gte|lte|eq)`)
  }
  const hasRef = typeof check.threshold_ref === 'string' && check.threshold_ref.length > 0
  const hasLiteral = typeof a.expected === 'number' && Number.isFinite(a.expected)
  if (!hasRef && !hasLiteral) {
    fail(`${file}: value check '${id}' has neither threshold_ref nor args.expected`)
  }
  if (hasRef && !knownRefs.refs.has(check.threshold_ref)) {
    fail(
      `${file}: value check '${id}' references unknown threshold_ref '${check.threshold_ref}' ` +
        `(add it to standards/thresholds.yml)`,
    )
  }
}

function validateRegistry(name, knownRefs) {
  const abs = join(STANDARDS, name)
  let doc
  try {
    doc = parseYaml(readFileSync(abs, 'utf-8'))
  } catch (err) {
    fail(`${name}: malformed YAML — ${err.message}`)
    return
  }
  if (!doc || !Array.isArray(doc.checks)) {
    fail(`${name}: missing or non-array 'checks'`)
    return
  }
  const seen = new Set()
  for (const check of doc.checks) {
    if (!check || !check.id) {
      fail(`${name}: a check is missing its id`)
      continue
    }
    if (seen.has(check.id)) fail(`${name}: duplicate check id '${check.id}'`)
    seen.add(check.id)
    validateCheck(name, check, knownRefs)
  }
}

function main() {
  if (!existsSync(STANDARDS)) {
    process.stdout.write(`check-gold-registries: SKIP — no ${STANDARDS}\n`)
    // #2052: recognized marker so runCheck surfaces SKIP, not PASS, in the gate summary.
    process.stdout.write(`[SKIP] no ${STANDARDS}\n`)
    return 0
  }
  const knownRefs = loadThresholdRefs()
  const files = readdirSync(STANDARDS).filter((f) => PER_STACK_RE.test(f))
  if (files.length === 0) {
    process.stdout.write(
      'check-gold-registries: no per-stack registries found (nothing to check)\n',
    )
    return 0
  }
  for (const name of files.sort()) validateRegistry(name, knownRefs)

  if (violations > 0) {
    process.stdout.write(
      `\ncheck-gold-registries: FAIL — ${violations} violation(s) across ${files.length} per-stack registry/ies.\n`,
    )
    return 1
  }
  process.stdout.write(
    `check-gold-registries: OK — ${files.length} per-stack registry/ies, all checks SAFE.\n`,
  )
  return 0
}

try {
  process.exit(main())
} catch (err) {
  process.stderr.write(`check-gold-registries: unexpected error — ${err?.message ?? err}\n`)
  process.exit(2)
}

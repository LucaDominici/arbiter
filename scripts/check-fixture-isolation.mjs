#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// CATALOG: fixture-isolation guard (#2181). Fixture and smoke output must never contaminate the
// CATALOG:   real evidence roots (.arbiter/evidence and .evidence): the #2176 /ship-v2 study
// CATALOG:   found fake-* finding IDs in real results that passed mechanical checks until a
// CATALOG:   semantic judge caught them. This scans parsed JSON/JSONL keys and scalar values.
// CATALOG: Rejected fold-in into check-evidence-bundle.mjs (INV-90 validates evidence SCHEMA; a
// CATALOG:   fake-* finding id is schema-valid — different axis) and check-anti-proforma.mjs
// CATALOG:   (assertion presence in TEST files — different corpus). NO-DATA is a PASS.
// Exit codes per INV-53: 0=PASS/NO-DATA, 1=FAIL (contamination), 2=ERROR (self).
// Usage: node scripts/check-fixture-isolation.mjs [--dir <path>] [--help]
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  process.stdout.write(
    'Usage: node scripts/check-fixture-isolation.mjs [--dir <path>]\n' +
      '  Fails when fixture or smoke markers contaminate parsed JSON/JSONL in real evidence roots.\n' +
      '  NO-DATA (no evidence roots) is a PASS.\n',
  )
  process.exit(0)
}

const dirIdx = args.indexOf('--dir')
const dirArg =
  dirIdx >= 0 && args[dirIdx + 1]
    ? args[dirIdx + 1]
    : args.find((arg) => arg.startsWith('--dir='))?.slice('--dir='.length)
const ROOT = dirArg ? resolve(dirArg) : process.cwd()

function walkFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const file = join(dir, entry.name)
    if (entry.isDirectory()) files.push(...walkFiles(file))
    else if (entry.isFile() && (entry.name.endsWith('.json') || entry.name.endsWith('.jsonl')))
      files.push(file)
  }
  return files
}

function childPath(parent, key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`
}

function isViolation(value) {
  return !/\s/.test(value) && (/^fake-/.test(value) || value.includes('STUDY_FAKE'))
}

function collectViolations(value, jsonPath, findings, file) {
  if (typeof value === 'string') {
    if (isViolation(value)) findings.push({ file, jsonPath, value })
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectViolations(item, `${jsonPath}[${index}]`, findings, file))
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const keyPath = childPath(jsonPath, key)
      if (isViolation(key)) findings.push({ file, jsonPath: keyPath, value: key })
      collectViolations(child, keyPath, findings, file)
    }
  }
}

function documents(file) {
  const contents = readFileSync(file, 'utf-8')
  return file.endsWith('.jsonl')
    ? contents.split(/\r?\n/).filter((line) => line.trim() !== '')
    : [contents]
}

function main() {
  const findings = []
  let scannedFiles = 0
  for (const evidenceRoot of [join(ROOT, '.arbiter', 'evidence'), join(ROOT, '.evidence')]) {
    if (!existsSync(evidenceRoot)) continue
    for (const file of walkFiles(evidenceRoot)) {
      scannedFiles += 1
      for (const document of documents(file)) {
        let parsed
        try {
          parsed = JSON.parse(document)
        } catch (err) {
          process.stderr.write(
            `check-fixture-isolation: malformed JSON in ${relative(ROOT, file)} — ${err?.message ?? err}\n`,
          )
          findings.push({ file, jsonPath: '$', value: '<malformed JSON document>' })
          continue
        }
        collectViolations(parsed, '$', findings, file)
      }
    }
  }

  if (findings.length > 0) {
    for (const finding of findings) {
      process.stderr.write(
        `check-fixture-isolation: ${relative(ROOT, finding.file)} ${finding.jsonPath} ${finding.value}\n`,
      )
    }
    process.stdout.write(
      `check-fixture-isolation: FAIL — ${findings.length} contamination finding(s)\n`,
    )
    return 1
  }

  process.stdout.write(
    `check-fixture-isolation: PASS — scanned ${scannedFiles} JSON/JSONL file(s)\n`,
  )
  return 0
}

try {
  process.exit(main())
} catch (e) {
  process.stderr.write(`check-fixture-isolation: ERROR — ${e?.message ?? e}\n`)
  process.exit(2)
}

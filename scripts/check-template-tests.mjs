#!/usr/bin/env node
// INV-48: Every EJS template under src/templates/ must have a render test (CANON-04).
// Uses a ratchet: fails if the count of untested EJS files INCREASES beyond the committed baseline.
// Update baseline: node scripts/check-template-tests.mjs --update-baseline
// Usage: node scripts/check-template-tests.mjs [--templates=path] [--tests=path] [--baseline=file]
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, relative } from 'node:path'

const args = process.argv.slice(2)
const updateBaseline = args.includes('--update-baseline')
const templatesArg = args.find((a) => a.startsWith('--templates='))
const testsArg = args.find((a) => a.startsWith('--tests='))
const baselineArg = args.find((a) => a.startsWith('--baseline='))

const root = process.cwd()
const templatesDir = templatesArg
  ? resolve(templatesArg.split('=')[1])
  : resolve(root, 'src/templates')
const testsDir = testsArg ? resolve(testsArg.split('=')[1]) : resolve(root, '__tests__/templates')
const baselineFile = baselineArg
  ? resolve(baselineArg.split('=')[1])
  : resolve(root, '.template-tests-baseline.txt')

function collectEjsFiles(dir) {
  const results = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      results.push(...collectEjsFiles(full))
    } else if (entry.endsWith('.ejs')) {
      results.push(full)
    }
  }
  return results
}

function collectTestContent(dir) {
  const content = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (entry.endsWith('.ts') || entry.endsWith('.js')) {
      content.push(readFileSync(full, 'utf-8'))
    }
  }
  return content.join('\n')
}

const ejsFiles = collectEjsFiles(templatesDir)
const testContent = collectTestContent(testsDir)

const missing = []
for (const ejsFile of ejsFiles) {
  const relPath = relative(templatesDir, ejsFile)
  const stem = relPath.replace(/\.ejs$/, '')
  if (!testContent.includes(relPath) && !testContent.includes(stem)) {
    missing.push(relPath)
  }
}

const currentCount = missing.length

if (updateBaseline) {
  writeFileSync(baselineFile, String(currentCount))
  console.log(`[check-template-tests] Baseline updated to ${currentCount} untested EJS files`)
  process.exit(0)
}

const baseline = existsSync(baselineFile)
  ? parseInt(readFileSync(baselineFile, 'utf-8').trim(), 10)
  : 0

if (currentCount > baseline) {
  console.log(
    `[check-template-tests] FAIL: regression — ${currentCount} untested EJS files (baseline: ${baseline})`,
  )
  console.log('  New untested files (compared to baseline):')
  for (const f of missing.slice(0, 10)) {
    console.log(`    ${f}`)
  }
  if (missing.length > 10) {
    console.log(`    ... and ${missing.length - 10} more`)
  }
  console.log(
    '  To update baseline after adding tests: node scripts/check-template-tests.mjs --update-baseline',
  )
  process.exit(1)
}

console.log(
  `[check-template-tests] OK — ${currentCount} untested EJS files (baseline: ${baseline})`,
)

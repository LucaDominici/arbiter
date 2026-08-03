#!/usr/bin/env node
// CATALOG: B1 (docs/audit/ACTION_PLAN.md, 2026-07-11) — CANON-11 minimal ratchet gate.
// CATALOG: Sibling of check-template-tests.mjs / check-generator-tests.mjs / check-command-tests.mjs
// CATALOG: (same "artifact class -> test correspondence" family, one script per class by existing
// CATALOG: convention). Rejected fold-in: those three assert 1:1 EXISTENCE per artifact; this one
// CATALOG: is a ratchet over a 52-generator PRE-EXISTING gap (folding would force choosing one
// CATALOG: script's semantics for four different artifact classes with different coverage states).
//
// CANON-11: Every file-emitting generator should have a brownfield test verifying that
// re-running init on an existing project respects skipIfExists/backup semantics.
// Ratchet (mirrors check-template-tests.mjs / INV-48): fails only if the count of
// generators with NO brownfield coverage INCREASES beyond the committed baseline.
// Update baseline: node scripts/check-brownfield-tests.mjs --update-baseline
// Usage: node scripts/check-brownfield-tests.mjs [--generators=path] [--tests=path] [--baseline=file]
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { resolve, join, basename } from 'node:path'
import { isMainModule } from './lib/run-helpers.mjs'

function collectTestContent(dir) {
  const content = []
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.test.ts')) continue
    content.push(readFileSync(join(dir, entry), 'utf-8'))
  }
  return content.join('\n')
}

export function main() {
  const args = process.argv.slice(2)
  const updateBaseline = args.includes('--update-baseline')
  const generatorsArg = args.find((a) => a.startsWith('--generators='))
  const testsArg = args.find((a) => a.startsWith('--tests='))
  const baselineArg = args.find((a) => a.startsWith('--baseline='))

  const root = process.cwd()
  const generatorsDir = generatorsArg
    ? resolve(generatorsArg.split('=')[1])
    : resolve(root, 'src/generators')
  const testsDir = testsArg
    ? resolve(testsArg.split('=')[1])
    : resolve(root, '__tests__/brownfield')
  const baselineFile = baselineArg
    ? resolve(baselineArg.split('=')[1])
    : resolve(root, '.brownfield-tests-baseline.txt')

  const generators = readdirSync(generatorsDir).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.d.ts') && !f.endsWith('.test.ts'),
  )
  const testContent = collectTestContent(testsDir)

  const missing = []
  for (const gen of generators) {
    const stem = basename(gen, '.ts')
    if (!testContent.includes(stem)) missing.push(stem)
  }

  const currentCount = missing.length

  if (updateBaseline) {
    writeFileSync(baselineFile, String(currentCount))
    process.stdout.write(
      `[check-brownfield-tests] Baseline updated to ${currentCount} generators without brownfield coverage\n`,
    )
    process.exit(0)
  }

  const baseline = existsSync(baselineFile)
    ? parseInt(readFileSync(baselineFile, 'utf-8').trim(), 10)
    : 0

  if (currentCount > baseline) {
    process.stdout.write(
      `[check-brownfield-tests] FAIL: regression — ${currentCount} generators without brownfield coverage (baseline: ${baseline})\n`,
    )
    process.stdout.write('  New uncovered generators (compared to baseline):\n')
    for (const f of missing.slice(0, 10)) {
      process.stdout.write(`    ${f}.ts\n`)
    }
    if (missing.length > 10) {
      process.stdout.write(`    ... and ${missing.length - 10} more\n`)
    }
    process.stdout.write(
      '  To update baseline after adding tests: node scripts/check-brownfield-tests.mjs --update-baseline\n',
    )
    process.exit(1)
  }

  process.stdout.write(
    `[check-brownfield-tests] OK — ${currentCount} generators without brownfield coverage (baseline: ${baseline})\n`,
  )
}

if (isMainModule(import.meta.url)) {
  try {
    main()
  } catch (err) {
    // Fail-closed (INV-96): an unexpected error must block, never silently pass.
    process.stderr.write(
      `[check-brownfield-tests] unexpected error: ${err instanceof Error ? err.stack : String(err)}\n`,
    )
    process.exit(1)
  }
}

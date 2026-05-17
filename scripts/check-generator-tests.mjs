#!/usr/bin/env node
// INV-49: Every src/generators/*.ts must have a matching __tests__/generators/*.test.ts (CANON-05).
// Usage: node scripts/check-generator-tests.mjs [--generators=path] [--tests=path]
import { readdirSync, existsSync } from 'node:fs'
import { resolve, basename, join } from 'node:path'

const args = process.argv.slice(2)
const generatorsArg = args.find((a) => a.startsWith('--generators='))
const testsArg = args.find((a) => a.startsWith('--tests='))

const root = process.cwd()
const generatorsDir = generatorsArg
  ? resolve(generatorsArg.split('=')[1])
  : resolve(root, 'src/generators')
const testsDir = testsArg ? resolve(testsArg.split('=')[1]) : resolve(root, '__tests__/generators')

const generators = readdirSync(generatorsDir).filter(
  (f) => f.endsWith('.ts') && !f.endsWith('.d.ts'),
)

let violations = 0
for (const gen of generators) {
  const stem = basename(gen, '.ts')
  const testFile = join(testsDir, `${stem}.test.ts`)
  if (!existsSync(testFile)) {
    process.stdout.write(`  MISSING: __tests__/generators/${stem}.test.ts
`)
    violations++
  }
}

if (violations > 0) {
  process.stdout.write(`[check-generator-tests] FAIL: ${violations} generator(s) lack unit tests
`)
  process.exit(1)
}
process.stdout
  .write(`[check-generator-tests] OK — all ${generators.length} generators have test files
`)

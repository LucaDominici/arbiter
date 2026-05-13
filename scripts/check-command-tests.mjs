#!/usr/bin/env node
// INV-50: Every src/commands/*.ts must have at least one __tests__/commands/*.test.ts (CANON-06).
// A command is covered if any test file name starts with the command's basename.
// Usage: node scripts/check-command-tests.mjs [--commands=path] [--tests=path]
import { readdirSync } from 'node:fs'
import { resolve, basename } from 'node:path'

const args = process.argv.slice(2)
const commandsArg = args.find((a) => a.startsWith('--commands='))
const testsArg = args.find((a) => a.startsWith('--tests='))

const root = process.cwd()
const commandsDir = commandsArg ? resolve(commandsArg.split('=')[1]) : resolve(root, 'src/commands')
const testsDir = testsArg ? resolve(testsArg.split('=')[1]) : resolve(root, '__tests__/commands')

const commands = readdirSync(commandsDir).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
if (commands.length === 0) {
  console.log(`[check-command-tests] FATAL: no *.ts files found in ${commandsDir} — wrong path?`)
  process.exit(1)
}
const testFiles = readdirSync(testsDir).filter((f) => f.endsWith('.test.ts'))

let violations = 0
for (const cmd of commands) {
  const stem = basename(cmd, '.ts')
  // Require a word-boundary delimiter so "work.ts" is not shadowed by "worktree.test.ts"
  const hasCoverage = testFiles.some(
    (t) => t === `${stem}.test.ts` || t.startsWith(`${stem}-`) || t.startsWith(`${stem}.`),
  )
  if (!hasCoverage) {
    console.log(`  MISSING: __tests__/commands/${stem}*.test.ts`)
    violations++
  }
}

if (violations > 0) {
  console.log(`[check-command-tests] FAIL: ${violations} command(s) lack test files`)
  process.exit(1)
}
console.log(`[check-command-tests] OK — all ${commands.length} commands have test files`)

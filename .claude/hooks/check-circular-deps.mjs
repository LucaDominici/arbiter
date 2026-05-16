#!/usr/bin/env node
// Arbiter hook: detect circular dependencies after TypeScript/JS edits
// Hook type: PostToolUse (Edit|Write) — TypeScript projects only
// Runs madge --circular on src/ for project-wide cycle detection. Exits 2 if circular deps found.
// Soft-skips when madge is not installed in node_modules.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const file = process.env.CLAUDE_TOOL_INPUT_PATH ?? ''
if (!file) process.exit(0)

const isJs =
  file.endsWith('.ts') || file.endsWith('.tsx') || file.endsWith('.js') || file.endsWith('.jsx')
if (!isJs) process.exit(0)

const repoRoot = process.cwd()
const madgeBin = join(repoRoot, 'node_modules', '.bin', 'madge')
if (!existsSync(madgeBin)) {
  process.stdout.write(
    `[arbiter] circular-deps: madge not installed — skip (run: npm install -D madge)\n`,
  )
  process.exit(0)
}

const srcDir = existsSync(join(repoRoot, 'src')) ? 'src' : '.'
const result = spawnSync(madgeBin, ['--circular', '--extensions', 'ts,tsx,js,jsx', srcDir], {
  encoding: 'utf-8',
  cwd: repoRoot,
  shell: false,
})

if (result.error) {
  process.stderr.write(`[arbiter] circular-deps: failed to spawn madge: ${result.error.message}\n`)
  process.exit(0)
}

if (result.signal) {
  process.stderr.write(`[arbiter] circular-deps: madge killed by signal ${result.signal}\n`)
  process.exit(0)
}

const output = (result.stdout ?? '').trim()
const circularLines = output.split('\n').filter((l) => l.includes(' > '))

if (result.status !== 0 || circularLines.length > 0) {
  process.stderr.write(
    `[arbiter] INV-01: Circular dependency detected (triggered by ${file.replace(repoRoot + '/', '')}):\n`,
  )
  circularLines.slice(0, 5).forEach((l) => process.stderr.write(`  ${l}\n`))
  if (!circularLines.length && output) process.stderr.write(`  ${output.slice(0, 400)}\n`)
  process.stderr.write(`[arbiter] Run \`arbiter explain INV-01\` for details.\n`)
  process.exit(2)
}

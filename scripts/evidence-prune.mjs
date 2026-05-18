#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Arbiter — evidence-prune.mjs
// Manual maintenance script for .evidence/ runs.
// Unlike evidence-rotate.mjs (automated, count-only), this supports:
//   --keep-last=N   keep the N most recent runs (default: 5)
//   --keep-days=D   keep runs newer than D days
//   --dry-run       list what would be removed without deleting
//   --yes           skip the confirmation prompt
//
// Usage: node scripts/evidence-prune.mjs [--dry-run] [--yes] [--keep-last=N] [--keep-days=D]
import { existsSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
function flag(name) {
  return args.includes(name)
}
function opt(name) {
  const entry = args.find((a) => a.startsWith(`${name}=`))
  return entry ? entry.split('=')[1] : undefined
}

const DRY_RUN = flag('--dry-run')
const YES = flag('--yes')
const keepLast = opt('--keep-last') ? parseInt(opt('--keep-last'), 10) : 5
const keepDays = opt('--keep-days') ? parseFloat(opt('--keep-days')) : undefined

const EVIDENCE_DIR = join(process.cwd(), '.evidence')

if (!existsSync(EVIDENCE_DIR)) {
  console.log('No .evidence/ directory found — nothing to prune.')
  process.exit(0)
}

const allRuns = readdirSync(EVIDENCE_DIR)
  .filter((n) => n.startsWith('run-'))
  .sort()

const now = Date.now()
const keepDaysMs = keepDays != null ? keepDays * 24 * 60 * 60 * 1000 : undefined

function shouldKeep(name, index) {
  const rank = allRuns.length - index
  if (rank <= keepLast) return true
  if (keepDaysMs != null) {
    try {
      const mtime = statSync(join(EVIDENCE_DIR, name)).mtimeMs
      if (now - mtime < keepDaysMs) return true
    } catch {
      return false
    }
  }
  return false
}

const toDelete = allRuns.filter((name, idx) => !shouldKeep(name, idx))

if (toDelete.length === 0) {
  console.log(
    `No runs to prune (keeping last ${keepLast}${keepDaysMs != null ? ` or < ${keepDays}d` : ''}).`,
  )
  process.exit(0)
}

console.log(`Runs to delete (${toDelete.length}):`)
for (const name of toDelete) {
  console.log(`  .evidence/${name}`)
}

if (DRY_RUN) {
  console.log('\n--dry-run: nothing deleted.')
  process.exit(0)
}

async function confirm() {
  if (YES) return true
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(`\nDelete ${toDelete.length} run(s)? Type YES to confirm: `, (answer) => {
      rl.close()
      resolve(answer.trim() === 'YES')
    })
  })
}

const ok = await confirm()
if (!ok) {
  console.log('Aborted.')
  process.exit(0)
}

for (const name of toDelete) {
  rmSync(join(EVIDENCE_DIR, name), { recursive: true, force: true })
  console.log(`  deleted: ${name}`)
}
console.log(`Done. Removed ${toDelete.length} run(s), kept ${allRuns.length - toDelete.length}.`)

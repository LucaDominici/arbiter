#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Regenerates src/kit/baseline.json from current src/kit/derived.json.
// Usage: node scripts/update-kit-baseline.mjs --task=#NNN [--allow-shrink]
//
// Refuses to write a shrunk baseline unless --allow-shrink is passed.
// On shrink, appends removed dimension IDs to .kit-removals.log (committed).
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

const args = process.argv.slice(2)
const taskArg = args.find((a) => a.startsWith('--task='))
const allowShrink = args.includes('--allow-shrink')

if (!taskArg) {
  process.stderr.write('update-kit-baseline: --task=#NNN is required\n')
  process.exit(1)
}

const task = taskArg.replace('--task=', '')

const derivedPath = join(ROOT, 'src/kit/derived.json')
const baselinePath = join(ROOT, 'src/kit/baseline.json')
const removalsLog = join(ROOT, '.kit-removals.log')

const derived = JSON.parse(readFileSync(derivedPath, 'utf-8'))
const STACKS = ['java', 'typescript', 'python', 'go', 'rust']

const tmlCounts = { L1: 0, L2: 0, L3: 0 }
for (const d of derived) tmlCounts[d.tml]++

const gapPerStack = {}
for (const s of STACKS) {
  gapPerStack[s] = derived.filter((d) => d.perStack[s].kind === 'gap').length
}

const matrixRatioPerStack = {}
for (const s of STACKS) {
  const covered = derived.filter((d) => ['tool', 'equivalent'].includes(d.perStack[s].kind)).length
  matrixRatioPerStack[s] = Math.round((covered / derived.length) * 10000) / 10000
}

const newBaseline = {
  capturedAt: new Date().toISOString().slice(0, 10),
  capturedForTask: task,
  tml: tmlCounts,
  total: derived.length,
  gapPerStack,
  matrixRatioPerStack,
  ids: derived.map((d) => d.id),
}

// Check for shrinkage if prior baseline exists
if (existsSync(baselinePath)) {
  const prior = JSON.parse(readFileSync(baselinePath, 'utf-8'))
  const priorIds = new Set(prior.ids ?? [])

  if (newBaseline.total < prior.total && !allowShrink) {
    process.stderr.write(
      `update-kit-baseline: refusing to shrink baseline from ${prior.total} to ${newBaseline.total} dims.\n` +
        `Run with --allow-shrink to override.\n`,
    )
    process.exit(1)
  }

  // Log removed IDs if shrinking
  if (newBaseline.total < prior.total) {
    const removedIds = Array.from(priorIds).filter((id) => !derived.some((d) => d.id === id))
    if (removedIds.length > 0) {
      const entry = `${new Date().toISOString()} task=${task} removed=${removedIds.join(',')}\n`
      appendFileSync(removalsLog, entry)
      process.stdout.write(
        `update-kit-baseline: logged ${removedIds.length} removed IDs to .kit-removals.log\n` +
          `  Remember to commit .kit-removals.log so the removal is visible in the PR diff.\n`,
      )
    }
  }
}

writeFileSync(baselinePath, JSON.stringify(newBaseline, null, 2) + '\n')
process.stdout.write(
  `update-kit-baseline: wrote baseline for task=${task} (${newBaseline.total} dims, L1=${tmlCounts.L1} L2=${tmlCounts.L2} L3=${tmlCounts.L3})\n`,
)

#!/usr/bin/env node
// exitplanmode-banner.mjs — prints a next-step banner when ExitPlanMode fires (#1210)
// Hook type: PostToolUse:ExitPlanMode — fires after the agent leaves plan mode
// stdout is shown to the model as a banner; always exits 0 (non-blocking)
// FAIL-OPEN-INTENT: advisory banner — any error must not block the agent workflow
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const BANNER_PHASES = new Set(['plan', 'red-team-review'])

function git(args) {
  return (spawnSync('git', args, { encoding: 'utf-8' }).stdout ?? '').trim()
}

try {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  if (/^(?:backup|preserve|wip)\//.test(branch)) process.exit(0)

  const root = git(['rev-parse', '--show-toplevel'])
  const statusPath = join(root, '.claude', '.task', 'status.json')

  if (!existsSync(statusPath)) process.exit(0)

  let state
  try {
    state = JSON.parse(readFileSync(statusPath, 'utf-8'))
  } catch {
    // FAIL-OPEN-INTENT: corrupted status file — silently skip banner
    process.exit(0)
  }

  if (!BANNER_PHASES.has(state.phase)) process.exit(0)

  const taskId = (state.taskId ?? '').replace(/^#/, '')
  process.stdout.write(`[arbiter] Plan mode ended — run: arbiter ship #${taskId} --advance\n`)
  process.exit(0)
} catch (err) {
  process.stderr.write(
    `[exitplanmode-banner] unexpected error: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
}

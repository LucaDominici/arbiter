#!/usr/bin/env node
// Arbiter hook: preserve session state across context compaction
// Hook type: PreCompact — fires before automatic context compaction
// stdout is injected as context the model sees immediately after compaction
// Always exits 0 (non-blocking)
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { readTaskState, getRepoRoot, sanitizeTaskId } from './lib.mjs'

const root = getRepoRoot()
const state = readTaskState(root)

const branch =
  spawnSync('git', ['branch', '--show-current'], {
    encoding: 'utf-8',
    cwd: root,
  }).stdout?.trim() ?? 'unknown'

let backlogBlock = ''
if (state.taskId && state.taskId !== 'unknown') {
  const backlogPath = join(root, '.arbiter', 'evidence', sanitizeTaskId(state.taskId), 'BACKLOG.md')
  if (existsSync(backlogPath)) {
    try {
      const body = readFileSync(backlogPath, 'utf-8')
      backlogBlock =
        `\n━━━ BACKLOG (recovery layer 1) ━━━\n` +
        body +
        (body.endsWith('\n') ? '' : '\n') +
        `━━━ END BACKLOG ━━━\n`
    } catch {
      // best-effort — never block compaction on a backlog read failure
    }
  }
}

process.stdout.write(
  `━━━ SESSION STATE (preserved across compaction) ━━━\n` +
    `Branch : ${branch}\n` +
    `Task   : ${state.taskId}\n` +
    `Tier   : ${state.tier}\n` +
    `Phase  : ${state.phase}\n` +
    `Plan   : ${state.plan}\n` +
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
    backlogBlock +
    `IMPORTANT: Context was compacted. Resume work from the phase/step above.\n` +
    `Re-read AGENTS.md if branch/task/phase are "unknown".\n`,
)

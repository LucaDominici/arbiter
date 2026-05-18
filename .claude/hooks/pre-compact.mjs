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

let costBlock = ''
if (state.taskId && state.taskId !== 'unknown') {
  const costPath = join(root, '.arbiter', 'evidence', 'cost', `${state.taskId}.json`)
  if (existsSync(costPath)) {
    try {
      const raw = readFileSync(costPath, 'utf-8')
      const report = JSON.parse(raw)
      const lines = [`\n━━━ COST EVIDENCE (flushed pre-compaction) ━━━`]
      for (const [phase, data] of Object.entries(report.byPhase ?? {})) {
        lines.push(
          `  ${phase}: in=${data?.in ?? 'N/A'} out=${data?.out ?? 'N/A'} samples=${data?.samples ?? 'N/A'}`,
        )
      }
      if (report.totals) {
        lines.push(`  totals: in=${report.totals?.in ?? 'N/A'} out=${report.totals?.out ?? 'N/A'}`)
      }
      lines.push(`━━━ END COST EVIDENCE ━━━\n`)
      costBlock = lines.join('\n')
    } catch {
      // best-effort — never block compaction on a cost read failure
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
    costBlock +
    `IMPORTANT: Context was compacted. Resume work from the phase/step above.\n` +
    `Re-read AGENTS.md if branch/task/phase are "unknown".\n`,
)

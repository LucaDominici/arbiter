#!/usr/bin/env node
// Arbiter hook: persist debug state when test/gate commands fail
// Hook type: PostToolUseFailure (Bash)
// Creates/updates DEBUG_STATE.md in .evidence/ so debug context survives context resets
// Only triggers for test/gate commands — skips unrelated bash failures
// Always exits 0 (non-blocking)

import { readTaskState, getRepoRoot, logWarn } from './lib.mjs'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

// Read failure info from stdin (PostToolUseFailure JSON payload)
let command = ''
let errorOutput = ''
try {
  const raw = readFileSync(0, 'utf-8')
  const payload = JSON.parse(raw)
  command = payload?.tool_input?.command ?? payload?.command ?? ''
  errorOutput = (payload?.error ?? payload?.stderr ?? '').slice(0, 2000)
} catch {
  process.exit(0)
}

// Only trigger for test/gate commands matching this project's stack
const TEST_PATTERNS = [
  /\bnpm\s+(run\s+)?test\b/,
  /\bnpx\s+vitest\b/,
  /\bcargo\s+test\b/,
  /\bgo\s+test\b/,
  /\bpytest\b/,
  /\b\.\/gradlew\s+test\b/,
  /\bmvn\s+(test|verify)\b/,
  /\bnode\s+scripts\/check-all\.mjs\b/,
  new RegExp('npm run test'),
]
if (!TEST_PATTERNS.some((p) => p.test(command))) process.exit(0)

const root = getRepoRoot()
const { taskId } = readTaskState(root)

// Determine evidence directory
const evidenceDir =
  taskId && taskId !== 'unknown'
    ? join(root, '.evidence', `task-${taskId.replace(/^#/, '')}`)
    : join(root, '.evidence', `debug-${new Date().toISOString().slice(0, 10)}`)

mkdirSync(evidenceDir, { recursive: true })

const debugFile = join(evidenceDir, 'DEBUG_STATE.md')
const timestamp = new Date().toISOString()
const branch =
  spawnSync('git', ['branch', '--show-current'], {
    encoding: 'utf-8',
    cwd: root,
  }).stdout?.trim() ?? 'unknown'

if (existsSync(debugFile)) {
  // Increment failure count and append history entry
  let content = readFileSync(debugFile, 'utf-8')
  const match = content.match(/\*\*Failure Count:\*\*\s*(\d+)/)
  const count = match ? parseInt(match[1], 10) + 1 : 2

  content = content.replace(/\*\*Failure Count:\*\*\s*\d+/, `**Failure Count:** ${count}`)
  content +=
    `\n### Attempt ${count} — ${timestamp}\n\n` +
    `- **Command:** \`${command}\`\n` +
    `- **Result:** FAIL\n` +
    `- **Output (truncated):** ${errorOutput.slice(0, 500)}\n`

  writeFileSync(debugFile, content, 'utf-8')
  process.stderr.write(`[DEBUG-STATE] Failure #${count} recorded in ${debugFile}\n`)
} else {
  // Create new DEBUG_STATE.md
  const content =
    `# Debug State — Task ${taskId}\n\n` +
    `**Created:** ${timestamp}\n` +
    `**Branch:** ${branch}\n` +
    `**Failure Count:** 1\n\n` +
    `---\n\n` +
    `## Current Hypothesis\n\n` +
    `_To be filled by the agent after analyzing the failure._\n\n` +
    `## Command Run\n\n` +
    `\`\`\`bash\n${command}\n\`\`\`\n\n` +
    `## Output (truncated)\n\n` +
    `\`\`\`\n${errorOutput.slice(0, 1000)}\n\`\`\`\n\n` +
    `## Next Action\n\n` +
    `_To be determined after root-cause analysis._\n\n` +
    `---\n\n` +
    `## History\n\n` +
    `### Attempt 1 — ${timestamp}\n\n` +
    `- **Command:** \`${command}\`\n` +
    `- **Result:** FAIL\n` +
    `- **Output (truncated):** ${errorOutput.slice(0, 500)}\n`

  writeFileSync(debugFile, content, 'utf-8')
  process.stderr.write(`[DEBUG-STATE] Failure #1 recorded in ${debugFile}\n`)
}

logWarn(`debug-state: failure captured for command: ${command.slice(0, 80)}`)

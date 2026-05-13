#!/usr/bin/env node
// Arbiter hook: hard-block edits to governance/SSOT documents
// Fires on: PreToolUse → Edit|Write
// Exit 2: block — stderr returned to Claude as error context; user is NOT prompted
// Bypass: ARBITER_SSOT_BYPASS=1 (session-scoped — see CONTRIBUTING.md)
import { spawnSync } from 'node:child_process'
import { resolve, relative } from 'node:path'

const file = process.env.CLAUDE_TOOL_INPUT_PATH ?? ''

if (process.env.ARBITER_SSOT_BYPASS === '1') process.exit(0)

// Anchor to repo root so external paths with matching names are not blocked.
const gitResult = spawnSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf-8',
})
// Fall back to CWD when git is unavailable (e.g. rsync temp dir); still anchors correctly.
const repoRoot = gitResult.stdout.trim() || process.cwd()
const absFile = resolve(file)
const rel = relative(repoRoot, absFile)

// If file is outside the repo, allow it.
if (rel.startsWith('..')) process.exit(0)

const SSOT_PATTERNS = [
  'AGENTS.md',
  '.claude/CLAUDE.md',
  '.agents/CODEX.md',
  'docs/METHOD/',
  'docs/SYSTEM/DECISIONS',
  'docs/SYSTEM/CANON.md',
  'docs/ADR/',
]

for (const pattern of SSOT_PATTERNS) {
  if (rel.includes(pattern)) {
    process.stderr.write(
      `[arbiter] SSOT GUARD: ${file} is a high-authority governance document.\n` +
        `Editing requires explicit ADR or amendment. Set ARBITER_SSOT_BYPASS=1 for legitimate edits.\n`,
    )
    process.exit(2)
  }
}

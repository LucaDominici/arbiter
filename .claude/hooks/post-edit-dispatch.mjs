#!/usr/bin/env node
// Arbiter hook: run format + lint after file edits
// Hook type: PostToolUse (Edit|Write)
// Stack: typescript | Format: npx prettier --check . | Lint: npm run lint
// Skips non-source files (docs, config, lock files, generated dirs)
// Always exits 0 (non-blocking, informational)

import { getRepoRoot, logInfo, logWarn, resolveToolInputPath } from './lib.mjs'
import { existsSync } from 'node:fs'
import { extname } from 'node:path'
import { spawnSync } from 'node:child_process'

// Resolve the just-edited file path from the Claude Code stdin-JSON payload
// (tool_input.file_path), falling back to the CLAUDE_TOOL_INPUT_PATH env var (Codex path).
const filePath = resolveToolInputPath()
if (!filePath) process.exit(0)

// Skip .md docs, .json config, lock files, build artifacts
const SKIP_PATTERNS = /\.(md|json|yaml|yml|txt|log|lock|toml|xml|html|css|svg|png|jpg|gif)$/i
const SKIP_DIRS = /\/(node_modules|build|dist|target|\.git|\.cache|__pycache__|\.venv)\//

if (SKIP_PATTERNS.test(filePath) || SKIP_DIRS.test(filePath)) process.exit(0)

// Only process source files for this language
const SOURCE_EXTS = ['.ts', '.tsx', '.js', '.jsx']
if (SOURCE_EXTS.length > 0 && !SOURCE_EXTS.includes(extname(filePath).toLowerCase()))
  process.exit(0)

if (!existsSync(filePath)) process.exit(0)

const root = getRepoRoot()

// ── Step 1: FORMAT ──────────────────────────────────────────────────────────
const formatParts = 'npx prettier --check .'.split(' ')
const formatResult = spawnSync(formatParts[0], [...formatParts.slice(1)], {
  encoding: 'utf-8',
  cwd: root,
  shell: false,
  timeout: 10000,
})
if (formatResult.status === 0) {
  process.stderr.write(`[post-edit] Formatted: ${filePath.split('/').pop()}\n`)
  logInfo(`post-edit-dispatch: formatted ${filePath}`)
} else {
  process.stderr.write(
    `[post-edit] Format check issues in ${filePath.split('/').pop()} (non-blocking)\n`,
  )
  logWarn(`post-edit-dispatch: format-issues ${filePath}`)
}

// ── Step 2: LINT ────────────────────────────────────────────────────────────
const lintParts = 'npm run lint'.split(' ')
const lintResult = spawnSync(lintParts[0], [...lintParts.slice(1)], {
  encoding: 'utf-8',
  cwd: root,
  shell: false,
  timeout: 15000,
})
if (lintResult.status === 0) {
  process.stderr.write(`[post-edit] Lint passed\n`)
  logInfo(`post-edit-dispatch: lint-passed ${filePath}`)
} else {
  process.stderr.write(`[post-edit] Lint issues detected (non-blocking)\n`)
  logWarn(`post-edit-dispatch: lint-issues ${filePath}`)
}

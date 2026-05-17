#!/usr/bin/env node
// Arbiter hook: block non-conventional commit messages after git commit (INV-22)
// Fires on: PostToolUse → Bash
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const command = process.env.CLAUDE_TOOL_INPUT_COMMAND ?? ''

// Only act on git commit commands
if (!/^git commit/.test(command)) process.exit(0)

// Get last commit message
const result = spawnSync('git', ['log', '-1', '--format=%s'], {
  encoding: 'utf-8',
})
const msg = (result.stdout ?? '').trim()

// git log failed or no commits yet — skip check
if (result.status !== 0 || !msg) process.exit(0)

// Check conventional commit format: type(scope): summary
const CONVENTIONAL =
  /^(feat|fix|refactor|test|docs|ci|chore|perf|style|build|revert)(\([^)]+\))?: .{1,72}$/
if (!CONVENTIONAL.test(msg)) {
  process.stderr.write(`[arbiter] INV-22: Commit message does not follow convention: ${msg}\n`)
  process.stderr.write(`[arbiter] Expected: type(scope): summary (e.g., feat(auth): add login)\n`)
  process.stderr.write(`[arbiter] Run \`arbiter explain INV-22\` for details.\n`)
  process.exit(1)
}

// Track-aware post-commit checklist (#724)
// Dynamic import so a missing shared lib exits 0 rather than crashing all commits (RT-EH-001)
let detectTracks
try {
  const __dir = dirname(fileURLToPath(import.meta.url))
  ;({ detectTracks } = await import(join(__dir, '..', '..', 'scripts', 'detect-track.mjs')))
} catch (err) {
  process.stderr.write(`[arbiter] track detection skipped: ${err.message}\n`)
  process.exit(0)
}
if (typeof detectTracks !== 'function') {
  process.stderr.write('[arbiter] track detection skipped: detectTracks export missing\n')
  process.exit(0)
}

const trackDiff = spawnSync('git', ['diff', '--name-only', 'HEAD~1', 'HEAD'], { encoding: 'utf-8' })
const commitFiles =
  trackDiff.status === 0 ? (trackDiff.stdout ?? '').split('\n').filter(Boolean) : []

const { tracks, hasFE, hasBE, hasDocs } = detectTracks(commitFiles)

if (tracks.length > 0) {
  const label = tracks.length > 1 ? 'Tracks' : 'Track'
  process.stdout.write(`[arbiter] ${label}: ${tracks.join(' + ')}\n`)
  if (hasFE) {
    process.stdout.write('  FE: vitest run --reporter dot\n')
    process.stdout.write('  FE: tsc --noEmit (verify types)\n')
  }
  if (hasBE) {
    process.stdout.write('  BE: vitest run --reporter dot\n')
    process.stdout.write('  BE: no new lint warnings (eslint src)\n')
  }
  if (hasDocs) {
    process.stdout.write('  Docs: node scripts/check-doc-links.mjs\n')
    process.stdout.write('  Docs: verify internal links resolve\n')
  }
}

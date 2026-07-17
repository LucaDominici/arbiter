#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Arbiter hook: block gh pr create unless gate marker is fresh (R1.S5)
// FAIL-OPEN-INTENT: hook exits 0 for non-PR commands; gate-fail exits 2 explicitly
// Fires on: PreToolUse → Bash
// Exit 2: block — stderr returned to Claude as error context
//
// #1990: worktree-aware. A session cwd on repo root must not gate a `gh pr
// create` that actually targets a different worktree (`cd <dir> && gh pr
// create ...`, or `--head <branch>` naming a branch checked out elsewhere).
// resolveTargetRoot() finds that worktree and the marker is validated
// against ITS HEAD, not the session cwd's. `gh issue create` is exempt
// (opening an issue is not a completion claim) — the segment-anchored match
// below also refuses to treat `gh pr create` mentioned inside a
// `gh issue create --body "..."` string as a real invocation.
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { resolveToolInputCommand } from './lib.mjs'

// Resolve the command from stdin-JSON (real Claude Code) or the env var (Codex).
// Reading only the env var made this guard silently inert under Claude Code (#1565).
const command = resolveToolInputCommand()

// Split on shell chain operators and match each segment anchored at its start.
// This is what makes `gh issue create --body "run gh pr create after"` safe:
// that segment starts with `gh issue create`, not `gh pr create`, so it never
// matches — no separate exemption list needed for gh issue create.
const segments = command.split(/&&|\|\||;|\|/).map((s) => s.trim())
const prCreateIndex = segments.findIndex((s) => /^gh\s+pr\s+create\b/.test(s))
if (prCreateIndex === -1) process.exit(0)

if (process.env.ARBITER_SKIP_GATE_MARKER === '1') {
  process.stderr.write('[arbiter] Gate marker check bypassed (ARBITER_SKIP_GATE_MARKER=1)\n')
  process.exit(0)
}

/**
 * Finds the worktree the `gh pr create` invocation actually targets, if any.
 * Checked in order:
 *   1. A `cd <dir> &&` segment earlier in the same command chain.
 *   2. A `--head <branch>` flag naming a branch checked out in another worktree.
 * Returns the worktree's toplevel path, or null when neither is present (the
 * caller then falls back to the previous cwd-based resolution unchanged).
 */
function resolveTargetRoot(cmdSegments, prIndex) {
  for (let i = prIndex - 1; i >= 0; i--) {
    const cdMatch = cmdSegments[i].match(/^cd\s+(.+)$/)
    if (!cdMatch) continue
    const dir = cdMatch[1].trim().replace(/^["']|["']$/g, '')
    const top = spawnSync(
      'git',
      ['-C', resolve(process.cwd(), dir), 'rev-parse', '--show-toplevel'],
      { encoding: 'utf-8' },
    )
    if (top.status === 0 && top.stdout.trim()) return top.stdout.trim()
    break
  }

  const headMatch = cmdSegments[prIndex].match(/--head[= ]("?)([^"\s]+)\1/)
  if (headMatch) {
    const branch = headMatch[2]
    const listResult = spawnSync('git', ['worktree', 'list', '--porcelain'], { encoding: 'utf-8' })
    if (listResult.status === 0) {
      for (const entry of listResult.stdout.split('\n\n')) {
        const wtPath = entry.match(/^worktree (.+)$/m)?.[1]
        const wtBranch = entry.match(/^branch refs\/heads\/(.+)$/m)?.[1]
        if (wtPath && wtBranch === branch) return wtPath
      }
    }
  }

  return null
}

const resolvedRoot = resolveTargetRoot(segments, prCreateIndex)

let repoRoot
if (resolvedRoot) {
  repoRoot = resolvedRoot
} else {
  const gitResult = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' })
  repoRoot = gitResult.stdout.trim() || process.cwd()
}

const markerPath = resolve(repoRoot, '.arbiter/gate-pass.json')
const rootNote = resolvedRoot ? ` (worktree: ${repoRoot})` : ''

if (!existsSync(markerPath)) {
  process.stderr.write(
    `[arbiter] GATE GUARD: No gate-pass.json found${rootNote}.\n` +
      'Run `node scripts/check-all.mjs L2` before creating a PR.\n',
  )
  process.exit(2)
}

let marker
try {
  marker = JSON.parse(readFileSync(markerPath, 'utf-8'))
} catch (err) {
  process.stderr.write(
    `[arbiter] GATE GUARD: gate-pass.json is invalid${rootNote}: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(2)
}

const headResult = spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf-8' })
const currentHead = headResult.stdout.trim()

if (marker.head_sha !== currentHead) {
  process.stderr.write(
    `[arbiter] GATE GUARD: gate-pass.json is stale${rootNote}.\n` +
      `Marker SHA: ${marker.head_sha}\n` +
      `Current HEAD: ${currentHead}\n` +
      'Run `node scripts/check-all.mjs L2` again after your last commit.\n',
  )
  process.exit(2)
}

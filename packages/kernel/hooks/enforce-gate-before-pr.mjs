#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Arbiter hook: block gh pr create unless gate marker is fresh (R1.S5)
// Fires on: PreToolUse → Bash
// Exit 2: block — stderr returned to Claude as error context
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { resolveToolInputCommand } from './lib.mjs'

// Resolve the command from stdin-JSON (real Claude Code) or the env var (Codex).
// Reading only the env var made this guard silently inert under Claude Code (#1565).
const command = resolveToolInputCommand()
if (!command.includes('gh pr create')) process.exit(0)

if (process.env.ARBITER_SKIP_GATE_MARKER === '1') {
  process.stderr.write('[arbiter] Gate marker check bypassed (ARBITER_SKIP_GATE_MARKER=1)\n')
  process.exit(0)
}

const gitResult = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' })
const repoRoot = gitResult.stdout.trim() || process.cwd()
const markerPath = resolve(repoRoot, '.arbiter/gate-pass.json')

if (!existsSync(markerPath)) {
  process.stderr.write(
    '[arbiter] GATE GUARD: No gate-pass.json found.\n' +
      'Run `node scripts/check-all.mjs L2` before creating a PR.\n',
  )
  process.exit(2)
}

let marker
try {
  marker = JSON.parse(readFileSync(markerPath, 'utf-8'))
} catch (err) {
  process.stderr.write(
    `[arbiter] GATE GUARD: gate-pass.json is invalid: ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(2)
}

const headResult = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' })
const currentHead = headResult.stdout.trim()

if (marker.head_sha !== currentHead) {
  process.stderr.write(
    '[arbiter] GATE GUARD: gate-pass.json is stale.\n' +
      `Marker SHA: ${marker.head_sha}\n` +
      `Current HEAD: ${currentHead}\n` +
      'Run `node scripts/check-all.mjs L2` again after your last commit.\n',
  )
  process.exit(2)
}

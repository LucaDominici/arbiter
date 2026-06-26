#!/usr/bin/env node
// Arbiter hook: incremental wiki regeneration after commits that touch docs/ (INV-116)
// Fires on: PostToolUse → Bash (git commit)
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { resolveToolInputCommand } from './lib.mjs'

try {
  // Resolve the command from stdin-JSON (real Claude Code) or the env var (Codex).
  // Reading only the env var made this guard silently inert under Claude Code (#1565).
  const command = resolveToolInputCommand()

  // Only act on git commit commands
  if (!/^git commit/.test(command)) process.exit(0)

  // Check if any docs/ files changed in the last commit
  const diff = spawnSync('git', ['diff', '--name-only', 'HEAD~1', 'HEAD', '--', 'docs/'], {
    encoding: 'utf-8',
  })
  const changedDocs = (diff.stdout ?? '')
    .trim()
    .split('\n')
    .filter((f) => f.endsWith('.md'))

  // No docs/ changes — skip wiki regen
  if (changedDocs.length === 0) process.exit(0)

  // wiki/ must exist (skip if not yet bootstrapped)
  const wikiDir = join(process.cwd(), 'wiki')
  if (!existsSync(wikiDir)) process.exit(0)

  // Incremental regeneration for changed source docs
  const result = spawnSync('node', ['scripts/gen-wiki.mjs', '--changed'], {
    encoding: 'utf-8',
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    process.stderr.write('[arbiter] wiki-on-commit: gen-wiki.mjs --changed failed\n')
    process.exit(1)
  }
} catch (err) {
  process.stderr.write(
    `[arbiter] wiki-on-commit: fatal — ${err instanceof Error ? err.message : String(err)}\n`,
  )
  process.exit(1)
}

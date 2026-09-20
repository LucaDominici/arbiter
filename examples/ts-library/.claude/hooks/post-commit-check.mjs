#!/usr/bin/env node
// Arbiter advisory: report non-conventional commit messages after git commits (INV-22)
import { spawnSync } from 'node:child_process'
import { resolveToolInputCommand } from './lib.mjs'

// Resolve the command from stdin-JSON (real Claude Code) or the env var (Codex).
// Reading only the env var made this guard silently inert under Claude Code (#1565).
const command = resolveToolInputCommand()

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
  process.stderr.write(`[arbiter] Advisory: non-conventional commit message: ${msg}\n`)
}

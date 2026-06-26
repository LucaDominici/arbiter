#!/usr/bin/env node
// Arbiter hook: block dangerous bash commands
// Fires on: PreToolUse → Bash
import { resolveToolInputCommand } from './lib.mjs'

// Resolve the command from stdin-JSON (real Claude Code) or the env var (Codex).
// Reading only the env var made this guard silently inert under Claude Code (#1565).
const command = resolveToolInputCommand()

const DANGEROUS_PATTERNS = [
  'rm -rf /',
  'rm -rf ~',
  'git push --force',
  'git push -f ',
  'git reset --hard',
  'DROP TABLE',
  'DROP DATABASE',
  'sudo rm',
  '> /dev/sda',
]

for (const pattern of DANGEROUS_PATTERNS) {
  if (command.includes(pattern)) {
    process.stderr.write(`[arbiter] Blocked dangerous command: ${command}\n`)
    process.exit(1)
  }
}

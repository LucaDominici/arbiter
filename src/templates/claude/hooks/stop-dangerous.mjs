#!/usr/bin/env node
// Arbiter hook: block dangerous bash commands
// Fires on: PreToolUse → Bash
// Delegated Agent-tool sessions do not run the `.claude/settings.json` hook chain.
// This hook is defence-in-depth/advisory there; CI plus branch protection enforce.
// See `docs/internal/SYSTEM/HOOK-CONTRACTS.md#scope-and-threat-model` (#2022).
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
    // Exit 2 is the ONLY blocking code for a PreToolUse hook (#1631): it aborts the
    // Bash call and feeds stderr to the agent. Any other non-zero exit (incl. 1) is
    // non-blocking — the dangerous command would run anyway.
    process.exit(2)
  }
}

// ponytail: string-level pattern guard — obfuscation (base64, $VAR indirection, helper
// script) defeats it by design; the enforced boundary is the CI gate, see
// docs/design/anti-context-rot-enforcers.md.
const protectedPathPattern =
  /(?:^|[\s"'`])((?:\.\/|\/[^\s"'`]*)?\.arbiter\/(?:gate-pass\.json|status\.json|evidence(?:\/[^\s"'`]*)?))(?=$|[\s"'`,;)&|])/
const writeIntentPattern =
  /\d?(?:>>|>)\s*(?:\.\/|\/[^\s"'`]*)?\.arbiter\/(?:gate-pass\.json|status\.json|evidence(?:\/[^\s"'`]*)?)(?=$|[\s"'`,;)&|])|(?:^|[\s;|&])(?:cp|mv|tee|sed\s+-i\S*|truncate|rm|unlink|python3?\s+-c|node\s+-e)(?=$|[\s;|&])/

const protectedPath = command.match(protectedPathPattern)?.[1]
if (protectedPath && writeIntentPattern.test(command)) {
  process.stderr.write(`[arbiter] Blocked protected Arbiter state write: ${protectedPath}\n`)
  process.exit(2)
}

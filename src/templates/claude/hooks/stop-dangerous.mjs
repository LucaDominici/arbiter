#!/usr/bin/env node
// Arbiter hook: block dangerous bash commands
// Fires on: PreToolUse → Bash
// Delegated Agent-tool sessions do not run the `.claude/settings.json` hook chain.
// This hook is defence-in-depth/advisory there; CI plus branch protection enforce.
// See `docs/internal/SYSTEM/HOOK-CONTRACTS.md#scope-and-threat-model` (#2022).
import { resolveToolInputCommand, stripQuotedAndHeredocs } from './lib.mjs'

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

// #2403: protected-Arbiter-state-write guard. The previous form scanned free TEXT for
// an evidence path plus a write-ish word anywhere in a `;`/`&&`/`|`-split segment —
// including inside a quoted string — so `gh issue create --body "rm ...evidence..."`
// (free text) and the ship playbook's own `node -e` evidence writers both false-blocked.
// This scans only the COMMAND HEAD of each segment, after (a) stripping quoted spans and
// heredoc bodies (stripQuotedAndHeredocs — a mentioned path never counts) and (b)
// stripping a leading `sudo`/env-var assignment: a destructive verb (rm, unlink,
// truncate, mv, cp, `sed -i`) whose arguments reference the protected path, OR a
// `>`/`>>` redirect whose target is the protected path. `node scripts/*.mjs`,
// `arbiter …`, `node -e`, `gh …`, `git …`, `cat`, `printf`, `echo` (without a redirect
// onto the path) are never destructive heads, so they pass regardless of what their
// (redacted) arguments contain.
const protectedPathPattern =
  /(?:^|[\s"'`])((?:\.\/|\/[^\s"'`]*)?\.arbiter\/(?:gate-pass\.json|status\.json|evidence(?:\/[^\s"'`]*)?))(?=$|[\s"'`,;)&|])/
const DESTRUCTIVE_HEADS = new Set(['rm', 'unlink', 'truncate', 'mv', 'cp', 'tee'])

/** Drops a leading `sudo` and any leading `FOO=bar` env assignments before head detection. */
function stripLeading(seg) {
  let s = seg.trim().replace(/^sudo\s+/, '')
  while (/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/.test(s)) {
    s = s.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/, '')
  }
  return s
}

/** True when a `>`/`>>` redirect target (any fd) in `seg` is the protected path. */
function redirectsIntoProtectedPath(seg) {
  const redirectPattern = /(?:^|\s)\d*(>>|>)\s*(\S+)/g
  let m
  while ((m = redirectPattern.exec(seg))) {
    if (protectedPathPattern.test(` ${m[2]} `)) return true
  }
  return false
}

/** True when `seg`'s head is a destructive verb AND its arguments name the protected path. */
function destructiveHeadOnProtectedPath(seg) {
  const tokens = seg.split(/\s+/).filter(Boolean)
  const head = tokens[0] ?? ''
  const isSedInPlace = head === 'sed' && tokens.some((t) => t === '--in-place' || /^-i/.test(t))
  if (!DESTRUCTIVE_HEADS.has(head) && !isSedInPlace) return false
  return protectedPathPattern.test(seg)
}

const redactedCommand = stripQuotedAndHeredocs(command)
const commandParts = redactedCommand.split(/\|\||&&|;|\|/).map(stripLeading)
for (const commandPart of commandParts) {
  if (redirectsIntoProtectedPath(commandPart) || destructiveHeadOnProtectedPath(commandPart)) {
    process.stderr.write(`[arbiter] Blocked protected Arbiter state write: ${command}\n`)
    process.exit(2)
  }
}

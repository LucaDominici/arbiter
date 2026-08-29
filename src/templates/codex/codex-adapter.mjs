#!/usr/bin/env node
// Codex CLI hook adapter — bridges the Codex hook payload to Claude Code hooks.
// Usage: node .codex/codex-adapter.mjs [--event <HookEventName>] <hook-path>
//
// Codex and Claude Code deliver the SAME envelope on stdin
// (`{ hook_event_name, tool_name, tool_input, cwd, session_id, transcript_path, ... }`);
// only the tool vocabulary differs. This adapter rewrites the Codex tool vocabulary
// (`Bash`/`bash` -> `Bash`, `apply_patch` -> `Edit`/`Write` once per file) and pipes the
// rewritten payload on the hook's stdin, while ALSO exporting the legacy
// `CLAUDE_TOOL_INPUT_*` env vars. Both channels are populated on purpose: hooks that
// parse stdin JSON and hooks that read the env var both work, and `lib.mjs`'s
// resolveToolInput{Path,Command} prefers stdin with an env fallback (#1565).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
let eventOverride = ''
if (argv[0] === '--event') {
  eventOverride = argv[1] ?? ''
  argv.splice(0, 2)
}
const hookPath = argv[0]
if (!hookPath) {
  process.stderr.write(
    '[codex-adapter] FATAL: no hook path provided as argument.\n' +
      'Usage: node .codex/codex-adapter.mjs [--event <HookEventName>] <hook-path>\n' +
      'Check .codex/config.toml for correct hook command wiring.\n',
  )
  process.exit(2)
}

let raw = ''
try {
  raw = readFileSync(0, 'utf-8').trim()
  // FAIL-OPEN-INTENT: stdin unreadable — no payload means nothing to check, so let the
  // tool call through rather than hard-blocking every Codex action on an adapter I/O fault.
} catch (err) {
  process.stderr.write(`[codex-adapter] failed to read stdin payload: ${String(err)}\n`)
  process.exit(0)
}

if (!raw) process.exit(0)

let payload
try {
  payload = JSON.parse(raw)
  // FAIL-OPEN-INTENT: payload is not JSON — same reasoning as above; an unparseable
  // envelope carries no command/path to judge, so blocking would be arbitrary.
} catch (err) {
  process.stderr.write(`[codex-adapter] failed to parse stdin as JSON: ${String(err)}\n`)
  process.exit(0)
}

const toolName = payload?.tool_name ?? ''
const toolInput = payload?.tool_input ?? {}
const hookEventName = payload?.hook_event_name ?? eventOverride
const env = { ...process.env }

/**
 * Runs the target hook once with `payloadOverrides` merged onto the incoming envelope.
 * Every field Codex sent is preserved (transcript_path, session_id, turn_id, model, ...) —
 * hooks read those directly. Exits the adapter on the first non-zero hook exit.
 */
function runHook(payloadOverrides, envOverrides) {
  const childPayload = { ...payload, ...payloadOverrides }
  if (hookEventName) childPayload.hook_event_name = hookEventName
  try {
    execFileSync('node', [hookPath], {
      env: { ...env, ...envOverrides },
      input: JSON.stringify(childPayload),
      // fd 0 must be a pipe to carry `input`; stderr/stdout stay inherited so a blocking
      // hook's message reaches Codex unchanged.
      stdio: ['pipe', 'inherit', 'inherit'],
    })
  } catch (err) {
    if (err instanceof Error && 'status' in err) {
      if (typeof err.status === 'number') process.exit(err.status)
      // null status: hook was killed by signal or timed out — hard block
      process.stderr.write(
        `[codex-adapter] hook '${hookPath}' was killed by signal (status=null)\n`,
      )
      process.exit(2)
    }
    process.stderr.write(`[codex-adapter] unexpected error spawning hook: ${String(err)}\n`)
    process.exit(2)
  }
}

// Extract file paths or command depending on tool
if (toolName === 'apply_patch') {
  // tool_input.command is a unified diff; extract file paths from directive lines.
  // "Move to:" captures the rename destination so SSOT/read-only guards check the target.
  const patchBody = toolInput.command ?? ''
  const files = []
  for (const line of patchBody.split('\n')) {
    const m = line.match(/^\*\*\* (Update File|Add File|Delete File|Move to): (.+)$/)
    // A newly created file maps to Write; every other directive edits an existing path.
    if (m) files.push({ path: m[2].trim(), tool: m[1] === 'Add File' ? 'Write' : 'Edit' })
  }

  if (files.length === 0) process.exit(0)

  // Run the hook once per file — path-scoped hooks need one file_path each.
  // Propagates the first non-zero exit code.
  for (const file of files) {
    runHook(
      { tool_name: file.tool, tool_input: { file_path: file.path } },
      { CLAUDE_TOOL_INPUT_PATH: file.path },
    )
  }
  process.exit(0)
}

// codex-cli sends 'Bash' (capital B) for shell calls; 'bash' is kept for older
// builds. Both spellings must also be in the config.toml matcher, or the hook
// never reaches this adapter at all.
if (toolName === 'Bash' || toolName === 'bash') {
  const command = toolInput.command ?? ''
  if (!command) process.exit(0)
  runHook({ tool_name: 'Bash', tool_input: { command } }, { CLAUDE_TOOL_INPUT_COMMAND: command })
  process.exit(0)
}

// Non-tool events (UserPromptSubmit, SessionStart, PreCompact, ...) carry no tool
// vocabulary to translate — forward the envelope verbatim, exactly once.
if (!toolName) {
  runHook({}, {})
  process.exit(0)
}

// Unknown tool — no-op
process.exit(0)

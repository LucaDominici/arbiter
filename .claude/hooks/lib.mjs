// Arbiter hook library — shared utilities for all hooks
// Project: arbiter
import {
  mkdirSync,
  appendFileSync,
  readFileSync,
  existsSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { parseArgs } from '../../scripts/lib/suppressions-shared.mjs'

const PROJECT = 'arbiter'
const LOG_DIR = '.claude/hooks/logs'
const LOG_FILE = `${LOG_DIR}/hook-events.log`

mkdirSync(LOG_DIR, { recursive: true })

function logEvent(level, message) {
  const ts = new Date().toISOString()
  appendFileSync(LOG_FILE, `[${ts}] [${PROJECT}] [${level}] ${message}\n`)
}

export const logInfo = (msg) => logEvent('INFO', msg)
export const logWarn = (msg) => logEvent('WARN', msg)
export const logError = (msg) => logEvent('ERROR', msg)

/**
 * Per-edit debounce for whole-graph hooks (#1515). knip / madge analyse the
 * entire project graph and cannot be scoped to one file, so running them on
 * every save is O(repo)/edit. This caps them to at most once per `windowMs`
 * across a burst of edits (the L1 gate re-runs them authoritatively before
 * commit/push, so a skipped per-edit run never weakens enforcement). Keyed by
 * cwd so sibling repos do not share a marker. Fail-open: any FS error runs the
 * check rather than silently disabling it. Set ARBITER_HOOK_DEBOUNCE_MS=0 to
 * disable. Returns true when the caller should skip (still within the window).
 */
export function debounceHook(
  key,
  windowMs = Number(process.env.ARBITER_HOOK_DEBOUNCE_MS ?? 20000),
) {
  if (!(windowMs > 0)) return false
  try {
    const dir = join(tmpdir(), 'arbiter-hook-debounce')
    const id = createHash('sha1').update(process.cwd()).digest('hex').slice(0, 16)
    const marker = join(dir, `${key}-${id}`)
    if (existsSync(marker) && Date.now() - statSync(marker).mtimeMs < windowMs) return true
    mkdirSync(dir, { recursive: true })
    writeFileSync(marker, String(Date.now()))
  } catch {
    // fail-open: never silently disable enforcement on a transient FS error.
  }
  return false
}

/**
 * Scope a whole-repo format/lint command to the single edited file (#1515).
 * Per-edit hooks must not re-scan the entire repo. Rewrites a configured
 * command into an argv targeting one file when the tool supports it:
 *   - npm/yarn/pnpm "lint" script indirection → direct `npx eslint <file>`
 *   - known per-file tools (prettier/eslint/ruff/black/gofmt/rustfmt/biome):
 *     strip trailing whole-repo path tokens, append the file
 *   - whole-graph tools (cargo/mvn/gradle/golangci-lint/go): returned unchanged
 *     (not meaningfully scopeable to one file — left to the gate).
 * Returns an argv array ready for spawnSync.
 */
export function scopeCommandToFile(command, file) {
  const toks = String(command || '')
    .split(' ')
    .filter(Boolean)
  if (toks.length === 0) return toks
  if (/^(npm|yarn|pnpm)$/.test(toks[0]) && toks.includes('lint')) return ['npx', 'eslint', file]
  const tool = toks[0] === 'npx' ? toks[1] : toks[0]
  const SCOPEABLE = new Set(['prettier', 'eslint', 'ruff', 'black', 'gofmt', 'rustfmt', 'biome'])
  if (!SCOPEABLE.has(tool)) return toks
  const REPO_TARGETS = new Set(['.', './', 'src', '__tests__', 'tests'])
  while (toks.length > 1 && REPO_TARGETS.has(toks[toks.length - 1])) toks.pop()
  toks.push(file)
  return toks
}

/**
 * Checks whether an inline arbiter-suppress directive on the same or previous line
 * covers the given invariant ID. Returns true if a valid, non-expired directive is found.
 * @param {string} fileContent - full file content
 * @param {number} lineIndex - 0-based line index of the violation
 * @param {string|null} invId - e.g. "INV-04", or null to match any valid directive
 */
export function findInlineSuppression(fileContent, lineIndex, invId) {
  const lines = fileContent.split('\n')
  const candidateLines = [lines[lineIndex]]
  if (lineIndex > 0) candidateLines.unshift(lines[lineIndex - 1])

  const SUPPRESS_RE = /\/\/\s*arbiter-suppress\(([^)]+)\)/

  for (const line of candidateLines) {
    const m = SUPPRESS_RE.test(line) ? line.match(SUPPRESS_RE) : null
    if (!m) continue

    const argsStr = m[1]
    const parts = parseArgs(argsStr)
    if (parts.length === 0) continue

    const firstPart = parts[0]
    if (invId !== null && firstPart !== invId) continue

    const kvPairs = {}
    for (let i = 1; i < parts.length; i++) {
      const eqIdx = parts[i].indexOf('=')
      if (eqIdx === -1) continue
      const key = parts[i].slice(0, eqIdx).trim()
      let val = parts[i].slice(eqIdx + 1).trim()
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1)
      }
      kvPairs[key] = val
    }

    if (!kvPairs.until || !kvPairs.reason || !kvPairs.owner) continue

    const expiry = new Date(kvPairs.until)
    if (isNaN(expiry.getTime())) continue
    if (expiry.getTime() < Date.now()) continue
    if (kvPairs.reason.length < 10) continue

    return true
  }
  return false
}

/**
 * Sanitize a task id into a safe filesystem segment AND safe regex literal.
 * MUST stay in lockstep with `src/review/dispatch.ts::sanitizeTaskId`.
 * Parity enforced by `__tests__/lib/sanitize-task-id-parity.test.ts`.
 */
export function sanitizeTaskId(raw) {
  const cleaned = String(raw ?? '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 64)
  return cleaned.length > 0 ? cleaned : 'unknown'
}

/**
 * Resolve the path of the file a tool is about to edit / has just edited.
 *
 * The Claude Code hook protocol delivers tool input as a JSON object on stdin
 * (`{ tool_name, tool_input: { file_path, ... } }`). The Codex adapter, by
 * contrast, translates that payload into the `CLAUDE_TOOL_INPUT_PATH`
 * environment variable before delegating to the hook. A hook that reads only
 * the env var silently no-ops under the stdin-JSON protocol (it sees an empty
 * path and exits 0 without inspecting the file). This resolver accepts BOTH:
 * it prefers the stdin-JSON `tool_input.file_path`, then falls back to the env
 * var (Codex path). Returns '' when neither is present.
 *
 * stdin (fd 0) is consumed at most once and only when it is a pipe/file; on a
 * TTY or when no payload is available it returns '' without blocking.
 *
 * @param {string} [rawStdin] Optional pre-read stdin payload (tests / callers
 *   that already buffered fd 0). When omitted, fd 0 is read directly.
 * @returns {string} The resolved file path, or '' if none could be determined.
 */
export function resolveToolInputPath(rawStdin) {
  let raw = rawStdin
  if (typeof raw !== 'string') {
    raw = ''
    try {
      // Reading fd 0 throws EAGAIN on an interactive TTY with no piped input;
      // treat any read failure as "no stdin payload" and fall through to env.
      raw = readFileSync(0, 'utf-8')
    } catch {
      raw = ''
    }
  }
  const trimmed = raw.trim()
  if (trimmed) {
    try {
      const payload = JSON.parse(trimmed)
      const fromStdin = payload?.tool_input?.file_path
      if (typeof fromStdin === 'string' && fromStdin.length > 0) {
        return fromStdin
      }
    } catch {
      // Not JSON (or not the expected shape) — fall through to the env fallback.
    }
  }
  const fromEnv = process.env.CLAUDE_TOOL_INPUT_PATH
  return typeof fromEnv === 'string' ? fromEnv : ''
}

/**
 * Resolve the shell command a Bash tool is about to run / has just run.
 *
 * The command-hook counterpart of resolveToolInputPath. The Claude Code hook
 * protocol delivers the Bash payload as a JSON object on stdin
 * (`{ tool_name, tool_input: { command, ... } }`); the Codex adapter instead
 * sets the `CLAUDE_TOOL_INPUT_COMMAND` environment variable. A hook that reads
 * only the env var silently no-ops under the stdin-JSON protocol (it sees an
 * empty command and exits 0 without inspecting it). This resolver accepts BOTH:
 * it prefers the stdin-JSON `tool_input.command`, then falls back to the env var
 * (Codex path). Returns '' when neither is present.
 *
 * stdin (fd 0) is consumed at most once and only when it is a pipe/file; on a
 * TTY or when no payload is available it returns '' without blocking.
 *
 * @param {string} [rawStdin] Optional pre-read stdin payload (tests / callers
 *   that already buffered fd 0). When omitted, fd 0 is read directly.
 * @returns {string} The resolved command, or '' if none could be determined.
 */
export function resolveToolInputCommand(rawStdin) {
  let raw = rawStdin
  if (typeof raw !== 'string') {
    raw = ''
    try {
      // Reading fd 0 throws EAGAIN on an interactive TTY with no piped input;
      // treat any read failure as "no stdin payload" and fall through to env.
      raw = readFileSync(0, 'utf-8')
    } catch {
      raw = ''
    }
  }
  const trimmed = raw.trim()
  if (trimmed) {
    try {
      const payload = JSON.parse(trimmed)
      const fromStdin = payload?.tool_input?.command
      if (typeof fromStdin === 'string' && fromStdin.length > 0) {
        return fromStdin
      }
    } catch {
      // Not JSON (or not the expected shape) — fall through to the env fallback.
    }
  }
  const fromEnv = process.env.CLAUDE_TOOL_INPUT_COMMAND
  return typeof fromEnv === 'string' ? fromEnv : ''
}

/** Returns the git repository root, falling back to process.cwd(). */
export function getRepoRoot() {
  const result = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf-8',
  })
  if (result.status === 0 && result.stdout) {
    return result.stdout.trim()
  }
  logWarn('getRepoRoot: git rev-parse failed, falling back to cwd')
  return process.cwd()
}

/**
 * Reads task state from the unified document `.claude/.task/status.json` in the given root.
 * Returns defaults ('unknown') when the document is absent or unreadable.
 */
export function readTaskState(root) {
  const statusPath = join(root, '.claude', '.task', 'status.json')
  let state = {}
  if (existsSync(statusPath)) {
    try {
      state = JSON.parse(readFileSync(statusPath, 'utf-8'))
    } catch (err) {
      // Fail visibly: a corrupt document silently disarms phase-gated guards, so warn rather
      // than treat corruption as a fresh tree.
      process.stderr.write(
        `[arbiter] warn: ${statusPath} is unreadable (${err.message}); treating task state as unknown.\n`,
      )
      state = {}
    }
  }
  const pick = (v) => (typeof v === 'string' && v.length > 0 ? v : 'unknown')
  return {
    taskId: pick(state.taskId),
    phase: pick(state.phase),
    plan: pick(state.plan),
    tier: pick(state.tier),
  }
}

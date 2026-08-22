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
import { join, extname, dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
// arbiter-only: hooks and scripts share ONE suppression-arg parser. The shipped
// template inlines its own copy because a generated project has no scripts/lib/.
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
 * Path-eligibility for post-edit-dispatch.mjs's Go format/lint dispatch (#486).
 * The hook is Go-only, so the `.go` extension is the real filter and there is no
 * lane-scoping: the previous LANES=["frontend","backend","docs"] gate silently
 * excluded cmd/ and internal/ — 99% of the repo's Go code — so gofmt/golangci-lint
 * never ran there. Returns true when the edited file should reach the dispatch.
 */
export function reachesDispatch(filePath) {
  if (!filePath) return false
  const SKIP_PATTERNS = /\.(md|json|yaml|yml|txt|log|lock|toml|xml|html|css|svg|png|jpg|gif)$/i
  const SKIP_DIRS = /\/(node_modules|build|dist|target|\.git|\.cache|__pycache__|\.venv)\//
  if (SKIP_PATTERNS.test(filePath) || SKIP_DIRS.test(filePath)) return false
  return extname(filePath).toLowerCase() === '.go'
}

/**
 * Environment for the hook's `golangci-lint run` (#487). Isolates golangci's cache
 * per worktree, mirroring check-all.mjs (#176, resolveGolangciCacheDir): the shared
 * default cache (~/.cache/golangci-lint) references deleted sibling-worktree paths
 * after a worktree is removed, leaking phantom-file findings across worktrees. The
 * cache dir is inlined (not imported from scripts/lib) to keep this hook library
 * dependency-free.
 */
export function lintEnv(root) {
  return { ...process.env, GOLANGCI_LINT_CACHE: join(root, '.golangci-cache') }
}

/**
 * Splits the argument list of an `arbiter-suppress(...)` directive on top-level
 * commas, honoring single/double quoted values so a `reason="a, b"` stays intact.
 * Kept inline (no shared import) so the emitted hook library is dependency-free.
 */

/**
 * Checks whether an inline suppression directive on the same or previous line covers
 * the given invariant ID. The directive is a line comment of the form
 * `arbiter-suppress(INV-NN, until=YYYY-MM-DD, reason="...", owner=...)` (two leading
 * slashes mark it as a comment — kept out of this doc string so this file's own
 * suppression scanner does not mistake the example for a real directive, #1772).
 * Returns true only for a complete, non-expired directive (valid `until` date in the
 * future, `reason` >= 10 chars, `owner` present). Mirrors arbiter's own
 * `.claude/hooks/lib.mjs::findInlineSuppression` so generated projects get the
 * SAME honored escape hatch the hook messages advertise (#1553).
 * @param {string} fileContent full file content
 * @param {number} lineIndex 0-based line index of the violation
 * @param {string|null} invId e.g. "INV-12", or null to match any valid directive
 */
export function findInlineSuppression(fileContent, lineIndex, invId) {
  const lines = fileContent.split('\n')
  const candidateLines = [lines[lineIndex]]
  if (lineIndex > 0) candidateLines.unshift(lines[lineIndex - 1])

  const SUPPRESS_RE = /\/\/\s*arbiter-suppress\(([^)]+)\)/

  for (const line of candidateLines) {
    const m = SUPPRESS_RE.test(line) ? line.match(SUPPRESS_RE) : null
    if (!m) continue

    const parts = parseArgs(m[1])
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
 * MUST stay in lockstep with `src/utils/task-id.ts::sanitizeTaskId`.
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

// Directory these hooks were loaded from, and the checkout root above it
// (`<root>/.claude/hooks/lib.mjs`). This is the repo that OWNS the rules, which is
// what membership has to be measured against — see isPathInThisRepo (#565).
const HOOKS_DIR = dirname(fileURLToPath(import.meta.url))
const HOOK_OWNER_ROOT = resolve(HOOKS_DIR, '..', '..')

/** Absolute path of the shared .git dir every worktree of `dir`'s repo points at, or null. */
function gitCommonDir(dir) {
  const r = spawnSync('git', ['-C', dir, 'rev-parse', '--git-common-dir'], { encoding: 'utf-8' })
  if (r.status !== 0 || !r.stdout.trim()) return null
  // Relative inside a main working tree ('.git', '../../.git'), absolute inside a
  // linked worktree — resolve against `dir` so both forms compare equal.
  return resolve(dir, r.stdout.trim())
}

/**
 * True when `file` belongs to the repo that owns these hooks (#565).
 *
 * A subagent inherits the SESSION's CLAUDE_PROJECT_DIR, not the one of the repo it is
 * working in, so these Edit|Write hooks stay registered and fire on files belonging to
 * a different repository — an agent editing a sibling repo's AGENTS.md was blocked by
 * enforce-read-only here, which matches the substring and nothing else. This repo has no
 * governance over a foreign repo; that repo's own hooks decide.
 *
 * Membership is git identity, NOT a path prefix: a repo's linked worktrees live
 * outside the repo root (<repo>.worktrees/) and are legitimately covered, so
 * `startsWith(repoRoot)` would silently un-govern all of them.
 * `rev-parse --git-common-dir` is identical across the main checkout and every linked
 * worktree and distinct for any other repo — the same idea #549 used for the Bash side.
 *
 * The anchor is HOOK_OWNER_ROOT rather than `process.cwd()`, which is where this differs
 * from enforce-gate-before-pr.mjs: the reported session had its cwd inside the foreign
 * repo, so a cwd-anchored identity would call that repo "home" and keep blocking.
 *
 * Fail-closed on uncertainty (INV-96): an unresolvable path, or an own-identity that git
 * cannot report, keeps the guard armed. Not-foreign is the safe answer — a guard must not
 * disarm itself on doubt.
 *
 * Takes the ALREADY-RESOLVED path: fd 0 is consumed at most once, so a second
 * resolveToolInputPath() call inside here would read '' and wave everything through.
 *
 * @param {string} file Absolute or cwd-relative path from resolveToolInputPath().
 * @returns {boolean}
 */
export function isPathInThisRepo(file) {
  if (!file) return true
  const abs = resolve(file)
  // Ordinary edit inside the checkout these hooks came from: true by construction,
  // and worth short-circuiting — the alternative is two git spawns on every edit.
  if (abs === HOOK_OWNER_ROOT || abs.startsWith(HOOK_OWNER_ROOT + sep)) return true

  const home = gitCommonDir(HOOKS_DIR)
  if (!home) return true

  // A Write can target a file — or a whole directory tree — that does not exist yet;
  // `git -C` needs a real directory, so climb to the nearest existing ancestor.
  let dir = dirname(abs)
  while (!existsSync(dir)) {
    const parent = dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
  return gitCommonDir(dir) === home
}

/**
 * Added lines of a file vs HEAD, for diff-scoped PostToolUse scans (#609).
 *
 * PostToolUse Edit|Write hooks used to scan the WHOLE edited file, so a
 * pre-existing forbidden pattern on an UNCHANGED line (e.g. an HTML form-field
 * hint attribute, matched case-insensitively by the marker regex) blocked any
 * unrelated edit in the same file — a false positive on every touch. Scoping
 * the scan to the lines the edit actually added fixes it without weakening
 * detection of NEW offenses.
 *
 * `git ls-files --error-unmatch <file>` distinguishes untracked (new) files —
 * which `git diff HEAD` would show nothing for — from tracked-but-unchanged
 * (which legitimately has no added lines). Untracked files return
 * `{ tracked: false, added: null }` so the caller falls back to a whole-file
 * scan (every line is new). Tracked files return the added-line contents with
 * their 1-based line number in the new file, parsed from the `@@ +c,d @@`
 * hunk headers. The gate's `--all` walk is NOT affected — it stays whole-file
 * (that is the anti-drift gate; this helper is the PostToolUse path only).
 *
 * Runs git in `process.cwd()` (the worktree the hook fires in). Fail-open:
 * any git error degrades to `tracked: false` so the caller scans the whole
 * file rather than silently skipping an offense.
 *
 * @param {string} file Absolute or cwd-relative path.
 * @returns {{tracked: boolean, added: Array<{line: number, content: string}>|null}}
 */
export function addedLinesVsHEAD(file) {
  const tracked = spawnSync('git', ['ls-files', '--error-unmatch', file], { encoding: 'utf-8' })
  if (tracked.status !== 0) return { tracked: false, added: null }
  const diff = spawnSync('git', ['diff', 'HEAD', '--', file], { encoding: 'utf-8' })
  if (diff.status !== 0) return { tracked: false, added: null }
  const added = []
  let newLine = 0
  for (const line of diff.stdout.split('\n')) {
    const hunk = /^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/.exec(line)
    if (hunk) {
      newLine = parseInt(hunk[1], 10)
      continue
    }
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line.startsWith('+')) {
      added.push({ line: newLine, content: line.slice(1) })
      newLine++
    } else if (line.startsWith(' ')) {
      newLine++
    }
    // '-' lines and '\ No newline...' do not advance the new-file line counter.
  }
  return { tracked: true, added }
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

// Dangerous-command detection for stop-dangerous.mjs (#552). Kept here, beside
// resolveToolInputCommand, so the guard stays dependency-free.
const DANGEROUS_LITERALS = [
  'rm -rf /',
  'rm -rf ~',
  'git reset --hard',
  'DROP TABLE',
  'DROP DATABASE',
  'sudo rm',
  '> /dev/sda',
]

/**
 * True when `command` actually runs something destructive.
 *
 * The previous form was a bare substring scan with two failure modes in opposite
 * directions: it blocked `--force-with-lease` (the safe variant, needed after every
 * rebase) and it fired on a command merely *named* inside a quoted string or heredoc
 * body — a guard that cannot tell doing from mentioning gets routed around by habit.
 *
 * @param {string} command
 * @returns {boolean}
 */
export function isDangerousCommand(command) {
  const raw = String(command ?? '')
  // Literals stay on the raw text: a destructive argument is normally quoted
  // (`psql -c "DROP TABLE users"`), so stripping quotes would disarm them.
  if (DANGEROUS_LITERALS.some((p) => raw.includes(p))) return true

  // The forced push is the opposite case — it is the one that kept firing on prose
  // (an issue body describing this very guard), so it is matched on the text with
  // heredoc bodies and quoted spans removed. Heredocs first: they can contain quotes.
  const executed = raw
    .replace(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1[\s\S]*?^\s*\2\s*$/gm, ' ')
    .replace(/'[^']*'/g, ' ')
    .replace(/"[^"]*"/g, ' ')

  // --force-with-lease refuses to overwrite refs the local side has not seen, so it is
  // the form a rebase is supposed to use; only the unguarded variants are blocked.
  return /(?:^|[;&|]|\s)git\s+push\b(?![^;&|]*--force-with-lease)[^;&|]*(?:--force\b|\s-f\b)/.test(
    executed,
  )
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
    branch: pick(state.branch),
  }
}

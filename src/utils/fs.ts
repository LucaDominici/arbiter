// SPDX-License-Identifier: Apache-2.0
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  copyFileSync,
  renameSync,
  unlinkSync,
  readFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import { ArbiterError } from './errors.js'
import { getLogger } from './logger.js'
import { t } from '../i18n/index.js'
import { manifestKey } from '../state/generated-manifest.js'

// ── Atomic write + signal cleanup ────────────────────────────────────────────

const inFlightTmpPaths = new Set<string>()
let handlersRegistered = false

const FS_ERROR_KEYS: Record<string, string> = {
  ENOSPC: 'errors.E_FS_ENOSPC',
  EACCES: 'errors.E_FS_EACCES',
  EROFS: 'errors.E_FS_EROFS',
  EDQUOT: 'errors.E_FS_EDQUOT',
  EPERM: 'errors.E_FS_EPERM',
  ENOTDIR: 'errors.E_FS_ENOTDIR',
  EISDIR: 'errors.E_FS_EISDIR',
}

function atomicWrite(filePath: string, content: string): void {
  const tmpPath = `${filePath}.arbiter-tmp-${randomBytes(4).toString('hex')}`
  inFlightTmpPaths.add(tmpPath)
  try {
    writeFileSync(tmpPath, content, 'utf-8')
    renameSync(tmpPath, filePath)
  } catch (err) {
    try {
      unlinkSync(tmpPath)
    } catch {
      // best-effort cleanup; the primary error takes precedence.
      // the finally block will still remove tmpPath from inFlightTmpPaths,
      // so the signal handler will NOT retry — any stranded file from a read-only
      // or permission-denied filesystem must be removed manually.
    }
    const code = (err as NodeJS.ErrnoException).code ?? ''
    const key = FS_ERROR_KEYS[code]
    if (key) throw ArbiterError.fromKey(code, key, { path: filePath })
    throw err
  } finally {
    inFlightTmpPaths.delete(tmpPath)
  }
}

function doCleanup(): void {
  for (const p of inFlightTmpPaths) {
    try {
      unlinkSync(p)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        // non-ENOENT means the file exists but could not be removed (EACCES, EBUSY, etc.)
        // process.stderr.write is safe inside a signal handler; cannot throw here
        process.stderr.write(
          `[arbiter] warning: could not remove in-flight tmp file ${p} (${code ?? 'unknown'}) — remove manually\n`,
        )
      }
    }
    inFlightTmpPaths.delete(p)
  }
}

/** Clean up in-flight tmp files on user-initiated abort. */
export function cleanupInFlightTmpFiles(): void {
  doCleanup()
}

/** Register SIGTERM/SIGINT handlers that clean up in-flight temp files.
 *  Must be called explicitly from the CLI entry point — NOT at module load time,
 *  as that would interfere with test runners. */
export function registerCleanupHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      doCleanup()
      process.kill(process.pid, signal)
    })
  }
}

/** Exposed for testing only — registers a path as in-flight. */
export function _registerTmpPath(p: string): void {
  inFlightTmpPaths.add(p)
}

/** Exposed for testing only — returns i18n message for errno code, or null if not mapped. */
export function _translateFsError(code: string, path: string): string | null {
  const key = FS_ERROR_KEYS[code]
  return key ? t(key, { path }) : null
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * `'dry-run'` is retained for backward compatibility — a small number of
 * consumers (e.g. `kit-install` SCAFFOLD reporting) still pattern-match it. As
 * of #1077, the standard fs helpers (`writeFile`, `copyStaticFile`) no longer
 * emit it: in dryRun they compute the *prospective* action (created / skipped /
 * replaced / backed-up-and-replaced) without touching disk, so `diff` (registry-
 * dryRun) reports exactly what `update` (real run) would do. This is what makes
 * the two commands structurally incapable of drifting (F1/F7).
 */
export interface WriteResult {
  path: string
  action: 'created' | 'skipped' | 'replaced' | 'backed-up-and-replaced' | 'dry-run'
}

export type GeneratorRunOpts = { dryRun: boolean }

// ── Generation session (#1328) ───────────────────────────────────────────────
//
// A module-level "generation session" (same pattern as `inFlightTmpPaths`) lets
// `writeFile` make `skipIfExists` hash-aware WITHOUT threading a manifest param
// through the dozens of generator call-sites. The orchestrators (`init`,
// `update`, `diff`) bracket the registry run with begin/end; `writeFile` consults
// `prevHashes` to tell a pristine (unmodified-since-generation) file — safe to
// rewrite to propagate a fix — from a user-modified one, and records the new
// render hash into `newHashes` for the caller to persist to the manifest.

interface GenerationSession {
  targetDir: string
  prevHashes: Map<string, string>
  newHashes: Map<string, string>
  /** Test/observability seam: invoked when a fix is withheld from a file. */
  onWithheld?: (key: string) => void
}

let generationSession: GenerationSession | null = null

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Begin a generation session. Defensively OVERWRITES any pre-existing session
 * (A3): a leaked session from a prior command (e.g. a throw that bypassed `end`)
 * must never affect the next command in the same process (tests, batch mode).
 */
export function beginGenerationSession(opts: {
  targetDir: string
  prevHashes: Record<string, string>
  onWithheld?: (key: string) => void
}): void {
  generationSession = {
    targetDir: opts.targetDir,
    prevHashes: new Map(Object.entries(opts.prevHashes)),
    newHashes: new Map(),
    ...(opts.onWithheld ? { onWithheld: opts.onWithheld } : {}),
  }
}

/**
 * End the active session and return the recorded render hashes (targetDir-
 * relative, posix keys) for the caller to merge + persist. Always clears the
 * session (idempotent: returns `{}` when none is active).
 */
export function endGenerationSession(): Record<string, string> {
  const session = generationSession
  generationSession = null
  return session ? Object.fromEntries(session.newHashes) : {}
}

/**
 * Record arbiter's canonical render hash as the new baseline for a file — but
 * ONLY when the on-disk content now equals `content` (the caller passes
 * `baselineMatches`). The manifest invariant is: `manifest[key]` is the hash of
 * the bytes arbiter most recently WROTE (or confirmed byte-identical on disk),
 * so `sha256(disk) === manifest[key]` ⇔ pristine. Recording on a *withheld* skip
 * (disk ≠ content, file NOT written) would poison the baseline to a render that
 * is not on disk, permanently marking the file user-modified — so those callers
 * pass `baselineMatches=false`. Called AFTER a successful side effect (A2) so a
 * throwing `atomicWrite` never leaves a phantom hash. Non-relative/escaping keys
 * are skipped + warned (A7).
 */
function recordGeneratedHash(filePath: string, content: string): void {
  const session = generationSession
  if (!session) return
  const key = manifestKey(session.targetDir, filePath)
  if (key === null) {
    getLogger().warn(
      'fs.manifest_key_skipped',
      { path: filePath },
      `generated-manifest: skipping non-relative path (cannot key portably): ${filePath}`,
    )
    return
  }
  session.newHashes.set(key, sha256(content))
}

interface ResolvedWrite {
  action: WriteResult['action']
  /** True when the on-disk bytes will equal `content` after this op (record-eligible). */
  baselineMatches: boolean
}

/**
 * Compute the action `writeFile` would take, given on-disk state. Single source
 * of truth shared by real + dryRun paths so they can never diverge. The on-disk
 * bytes are read ONCE (A8) and reused for both the byte-identical check and the
 * pristine-hash check. Precedence:
 *   1. missing                                  → created (baselineMatches)
 *   2. exists + byte-identical content          → skipped (baselineMatches; idempotent)
 *   3. exists + skipIfExists + session + pristine (sha256(disk)==prevHash) + differs
 *                                               → replaced (propagate fix, #1328; baselineMatches)
 *   4. exists + skipIfExists (no session | unknown | user-modified)
 *                                               → skipped, NOT baselineMatches (+ withheld warn
 *                                                  when a session knows)
 *   5. exists + backup                          → backed-up-and-replaced (baselineMatches)
 *   6. exists                                   → replaced (baselineMatches)
 */
function resolveWriteAction(
  filePath: string,
  content: string,
  skipIfExists: boolean,
  backup: boolean,
): ResolvedWrite {
  if (!existsSync(filePath)) return { action: 'created', baselineMatches: true }
  // Single read: null = unreadable (treat as exists-but-unknown → legacy-safe).
  let disk: string | null
  try {
    disk = readFileSync(filePath, 'utf-8')
  } catch {
    disk = null
  }
  if (disk !== null && disk === content) return { action: 'skipped', baselineMatches: true }

  if (skipIfExists) {
    const session = generationSession
    if (session && disk !== null) {
      const key = manifestKey(session.targetDir, filePath)
      const prev = key === null ? undefined : session.prevHashes.get(key)
      if (prev !== undefined && sha256(disk) === prev) {
        // Pristine: unmodified since arbiter generated it → safe to rewrite.
        return { action: backup ? 'backed-up-and-replaced' : 'replaced', baselineMatches: true }
      }
      // User-modified or unknown provenance → preserve + surface the withheld fix.
      const withheldKey = key ?? filePath
      ;(session.onWithheld ?? defaultWithheldWarn)(withheldKey)
    }
    return { action: 'skipped', baselineMatches: false }
  }

  return { action: backup ? 'backed-up-and-replaced' : 'replaced', baselineMatches: true }
}

function defaultWithheldWarn(key: string): void {
  getLogger().warn(
    'fs.fix_withheld',
    { path: key },
    `user-modified, template fix NOT applied: ${key} (delete it to let \`arbiter update\` re-apply the current template)`,
  )
}

/**
 * Write a file atomically (temp-file + rename), creating parent directories as needed.
 * If the file already exists and skipIfExists=true, skip it — UNLESS a generation
 * session knows the on-disk content is pristine (matches the recorded render hash),
 * in which case it is rewritten to propagate a template fix (#1328).
 * If the file already exists and its content is byte-identical, skip it (idempotent).
 * If backup=true and file exists with differing content, copy it to
 * <path>.arbiter-backup before writing.
 * In dryRun mode the prospective action is computed and returned WITHOUT any
 * filesystem mutation. The render hash is recorded into the active generation
 * session AFTER a successful side effect, for every action.
 * On ENOSPC the temp file is cleaned up and a UserFacingError is thrown.
 */
export function writeFile(
  filePath: string,
  content: string,
  opts: { skipIfExists?: boolean; backup?: boolean; dryRun?: boolean } = {},
): WriteResult {
  const { skipIfExists = false, backup = false, dryRun = false } = opts
  const { action, baselineMatches } = resolveWriteAction(filePath, content, skipIfExists, backup)

  // Side effects (may throw → recordGeneratedHash below is never reached, so no
  // phantom hash is recorded for content that did not land — A2).
  if (!dryRun && action !== 'skipped') {
    if (action === 'backed-up-and-replaced') {
      copyFileSync(filePath, `${filePath}.arbiter-backup`)
    }
    mkdirSync(dirname(filePath), { recursive: true })
    atomicWrite(filePath, content)
  }

  // Record the baseline ONLY when disk == content (created/replaced/byte-identical)
  // and the side effect actually ran (never on dryRun — diff must not record a hash
  // for content that did not land — and never on a withheld skip, which would poison
  // the baseline; see recordGeneratedHash).
  if (!dryRun && baselineMatches) recordGeneratedHash(filePath, content)
  return { path: filePath, action }
}

/**
 * Deeply merge two settings.json objects. Arrays are unioned (no duplicates by 'command').
 * All top-level keys from `existing` are preserved unchanged unless arbiter manages them
 * (currently: `hooks`, `permissions`).
 *
 * When a non-special incoming key collides with a non-undefined existing value, the existing
 * value wins (no clobber) but a logger.warn is emitted listing the dropped keys so users
 * can pick up the new arbiter defaults if they choose (#286).
 */
export function mergeSettingsJson(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...existing }
  const dropped: string[] = []

  for (const [key, incomingVal] of Object.entries(incoming)) {
    const existingVal = existing[key]

    if (key === 'hooks' && isHooksObject(incomingVal) && isHooksObject(existingVal)) {
      result[key] = mergeHooks(existingVal, incomingVal)
    } else if (key === 'permissions' && isPermissions(incomingVal) && isPermissions(existingVal)) {
      result[key] = mergePermissions(existingVal, incomingVal)
    } else if (existingVal === undefined) {
      result[key] = incomingVal
    } else {
      dropped.push(key)
    }
  }

  if (dropped.length > 0) {
    getLogger().warn(
      'fs.settings_merge_preserved',
      { dropped_keys: dropped.join(',') },
      `settings.json merge preserved your existing values for these top-level keys; ` +
        `arbiter's new defaults were NOT applied: ${dropped.join(', ')}. ` +
        `Remove these keys from .claude/settings.json and re-run to pick up the new defaults.`,
    )
  }

  return result
}

type HookEntry = {
  matcher: string
  hooks: { type: string; command: string; timeout?: number }[]
}
type HooksObject = Record<string, HookEntry[]>
type Permissions = { allow?: string[]; deny?: string[] }

function isHooksObject(val: unknown): val is HooksObject {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

function isPermissions(val: unknown): val is Permissions {
  return typeof val === 'object' && val !== null && !Array.isArray(val)
}

/**
 * Known arbiter-managed hook basenames — used to clean up old entries when
 * upgrading to the dispatcher pattern (#248).
 */
const ARBITER_HOOK_BASENAMES = new Set([
  'stop-dangerous',
  'enforce-read-only',
  'pre-edit-ssot-guard',
  'check-no-orphan-todo',
  'check-no-placeholders',
  'lib',
  'post-commit-check',
  'check-no-unused-exports',
  'pre-edit-plan-anchor',
  'pre-compact',
  'post-edit-dispatch',
  'debug-state-on-failure',
  'skill-forced-eval',
  'guard-task-completion',
  'guard-done-evidence',
  'check-circular-deps',
  'check-no-pii',
  'hooks',
])

function extractHookBasename(command: string): string | null {
  const match = command.match(/\.claude\/hooks\/([^./\s]+)\.\w+/)
  return match?.[1] ?? null
}

function isDispatcherCommand(command: string): boolean {
  return /\.claude\/hooks\/hooks\.mjs\b/.test(command)
}

function mergeHooks(existing: HooksObject, incoming: HooksObject): HooksObject {
  const result: HooksObject = { ...existing }

  for (const [event, incomingEntries] of Object.entries(incoming)) {
    const existingEntries = existing[event] ?? []
    const merged = [...existingEntries]

    for (const incomingEntry of incomingEntries) {
      const existingEntry = merged.find((e) => e.matcher === incomingEntry.matcher)
      if (existingEntry) {
        mergeHookEntry(existingEntry, incomingEntry)
      } else {
        merged.push(incomingEntry)
      }
    }

    result[event] = merged
  }

  return result
}

function mergeHookEntry(existingEntry: HookEntry, incomingEntry: HookEntry): void {
  const hasDispatcherIncoming = incomingEntry.hooks.some((h) => isDispatcherCommand(h.command))

  for (const hook of incomingEntry.hooks) {
    if (hasDispatcherIncoming && isDispatcherCommand(hook.command)) {
      // Dispatcher upgrade: remove all previously arbiter-managed hook entries
      // so old individual hook commands don't persist alongside the new dispatcher.
      existingEntry.hooks = existingEntry.hooks.filter((h) => {
        const basename = extractHookBasename(h.command)
        return basename === null || !ARBITER_HOOK_BASENAMES.has(basename)
      })
    } else {
      const incomingBasename = extractHookBasename(hook.command)
      if (incomingBasename) {
        // Remove old variants of the same hook (e.g. .sh → .mjs upgrade)
        existingEntry.hooks = existingEntry.hooks.filter((h) => {
          const existingBasename = extractHookBasename(h.command)
          return existingBasename !== incomingBasename
        })
      }
    }
    // Add the incoming hook if not already present
    const existingCommands = new Set(existingEntry.hooks.map((h) => h.command))
    if (!existingCommands.has(hook.command)) {
      existingEntry.hooks.push(hook)
    }
  }
}

function mergePermissions(existing: Permissions, incoming: Permissions): Permissions {
  const unionArrays = (a: string[] = [], b: string[] = []): string[] => [...new Set([...a, ...b])]
  return {
    allow: unionArrays(existing.allow, incoming.allow),
    deny: unionArrays(existing.deny, incoming.deny),
  }
}

export function resolvedPath(targetDir: string, ...parts: string[]): string {
  return join(targetDir, ...parts)
}

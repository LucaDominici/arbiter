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
import { randomBytes } from 'node:crypto'
import { ArbiterError } from './errors.js'
import { getLogger } from './logger.js'
import { t } from '../i18n/index.js'

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

/**
 * Read existing file bytes for a content-equality check. Treats any read
 * failure (permission, race, directory-at-path) as "not equal" so the caller
 * converges toward writing — the safe direction for an idempotent generator and
 * the over-reporting (never under-reporting) direction for `diff` (INV-96).
 */
function contentEquals(filePath: string, content: string): boolean {
  try {
    return readFileSync(filePath, 'utf-8') === content
  } catch {
    return false
  }
}

/**
 * Compute the action `writeFile` would take, given the on-disk state. Single
 * source of truth shared by the real and dryRun paths so they can never
 * diverge. Precedence (order matters):
 *   1. missing                         → created
 *   2. exists + skipIfExists           → skipped
 *   3. exists + byte-identical content → skipped   (#1077 F6 idempotence)
 *   4. exists + backup                 → backed-up-and-replaced
 *   5. exists                          → replaced
 *
 * Content-equality is checked BEFORE the backup branch: an unchanged backup
 * file (AGENTS.md, CLAUDE.md, GLOBAL_INVARIANTS.md) must NOT be churned/backed
 * up on every run, or `update` is non-idempotent and `diff` over-reports.
 */
function resolveWriteAction(
  filePath: string,
  content: string,
  skipIfExists: boolean,
  backup: boolean,
): WriteResult['action'] {
  if (!existsSync(filePath)) return 'created'
  if (skipIfExists) return 'skipped'
  if (contentEquals(filePath, content)) return 'skipped'
  return backup ? 'backed-up-and-replaced' : 'replaced'
}

/**
 * Write a file atomically (temp-file + rename), creating parent directories as needed.
 * If the file already exists and skipIfExists=true, skip it.
 * If the file already exists and its content is byte-identical, skip it (idempotent).
 * If backup=true and file exists with differing content, copy it to
 * <path>.arbiter-backup before writing.
 * In dryRun mode the prospective action is computed and returned WITHOUT any
 * filesystem mutation.
 * On ENOSPC the temp file is cleaned up and a UserFacingError is thrown.
 */
export function writeFile(
  filePath: string,
  content: string,
  opts: { skipIfExists?: boolean; backup?: boolean; dryRun?: boolean } = {},
): WriteResult {
  const { skipIfExists = false, backup = false, dryRun = false } = opts
  const action = resolveWriteAction(filePath, content, skipIfExists, backup)

  if (dryRun || action === 'created') {
    if (!dryRun) {
      mkdirSync(dirname(filePath), { recursive: true })
      atomicWrite(filePath, content)
    }
    return { path: filePath, action }
  }

  if (action === 'skipped') return { path: filePath, action }

  if (action === 'backed-up-and-replaced') {
    copyFileSync(filePath, `${filePath}.arbiter-backup`)
  }
  mkdirSync(dirname(filePath), { recursive: true })
  atomicWrite(filePath, content)
  return { path: filePath, action }
}

/**
 * Copy a static file (non-template) to the target.
 * Mirrors {@link writeFile}'s skip semantics: skips when the destination exists
 * with byte-identical content (idempotent) and computes the prospective action
 * without writing in dryRun mode.
 */
export function copyStaticFile(
  src: string,
  dest: string,
  opts: { skipIfExists?: boolean; dryRun?: boolean } = {},
): WriteResult {
  const { skipIfExists = false, dryRun = false } = opts
  let action: WriteResult['action']
  if (!existsSync(dest)) {
    action = 'created'
  } else if (skipIfExists) {
    action = 'skipped'
  } else {
    action = sameFileContent(src, dest) ? 'skipped' : 'replaced'
  }

  if (!dryRun && action !== 'skipped') {
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(src, dest)
  }
  return { path: dest, action }
}

/** True when src and dest exist with byte-identical content. */
function sameFileContent(src: string, dest: string): boolean {
  try {
    return readFileSync(src).equals(readFileSync(dest))
  } catch {
    return false
  }
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

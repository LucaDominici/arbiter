// SPDX-License-Identifier: Apache-2.0
import { existsSync, mkdirSync, writeFileSync, copyFileSync, renameSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { UserFacingError } from './errors.js'

// ── Atomic write + signal cleanup ────────────────────────────────────────────

const inFlightTmpPaths = new Set<string>()
let handlersRegistered = false

const ENOSPC_MSGS: Record<string, (path: string) => string> = {
  ENOSPC: (p) =>
    `Disk full while writing ${p}. Free up space and retry.\n  Use \`df -h\` to check available space.`,
  EACCES: (p) => `Permission denied writing ${p}. Check file ownership and directory permissions.`,
  EROFS: (p) => `Cannot write ${p} — filesystem is read-only. Check mount options.`,
  EDQUOT: (p) => `Disk quota exceeded while writing ${p}. Free up space or raise your quota.`,
  EPERM: (p) =>
    `Operation not permitted writing ${p}. Common causes:\n` +
    `  1. Immutable bit set — check with \`lsattr ${p}\`, clear with \`chattr -i ${p}\`\n` +
    `  2. SELinux/AppArmor denial — check with \`ausearch -m AVC\` or \`dmesg | grep denied\`\n` +
    `  3. POSIX ACL restriction — check with \`getfacl ${p}\`\n` +
    `  4. Different owner — check with \`ls -la ${p}\``,
  ENOTDIR: (p) =>
    `Cannot write ${p} — a component of the path is not a directory. ` +
    `Check that no intermediate path segment is a regular file.`,
  EISDIR: (p) =>
    `Cannot write ${p} — target is a directory, expected a file. ` +
    `Remove or rename the directory at that path first.`,
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
    const factory = ENOSPC_MSGS[code]
    if (factory) throw new UserFacingError(factory(filePath))
    throw err
  } finally {
    inFlightTmpPaths.delete(tmpPath)
  }
}

function cleanupInFlightTmpFiles(): void {
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

/** Register SIGTERM/SIGINT handlers that clean up in-flight temp files.
 *  Must be called explicitly from the CLI entry point — NOT at module load time,
 *  as that would interfere with test runners. */
export function registerCleanupHandlers(): void {
  if (handlersRegistered) return
  handlersRegistered = true

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      cleanupInFlightTmpFiles()
      process.kill(process.pid, signal)
    })
  }
}

/** Exposed for testing only — cleans all registered in-flight tmp paths. */
export function _cleanupInFlightTmpFiles(): void {
  cleanupInFlightTmpFiles()
}

/** Exposed for testing only — registers a path as in-flight. */
export function _registerTmpPath(p: string): void {
  inFlightTmpPaths.add(p)
}

/** Exposed for testing only — returns translated UserFacingError message for errno code, or null if not mapped. */
export function _translateFsError(code: string, path: string): string | null {
  const factory = ENOSPC_MSGS[code]
  return factory ? factory(path) : null
}

// ─────────────────────────────────────────────────────────────────────────────

export interface WriteResult {
  path: string
  action: 'created' | 'skipped' | 'replaced' | 'backed-up-and-replaced'
}

/**
 * Write a file atomically (temp-file + rename), creating parent directories as needed.
 * If the file already exists and skipIfExists=true, skip it.
 * If backup=true and file exists, copy it to <path>.arbiter-backup before writing.
 * On ENOSPC the temp file is cleaned up and a UserFacingError is thrown.
 */
export function writeFile(
  filePath: string,
  content: string,
  opts: { skipIfExists?: boolean; backup?: boolean } = {},
): WriteResult {
  const { skipIfExists = false, backup = false } = opts

  if (existsSync(filePath)) {
    if (skipIfExists) {
      return { path: filePath, action: 'skipped' }
    }
    if (backup) {
      copyFileSync(filePath, `${filePath}.arbiter-backup`)
    }
    mkdirSync(dirname(filePath), { recursive: true })
    atomicWrite(filePath, content)
    return { path: filePath, action: backup ? 'backed-up-and-replaced' : 'replaced' }
  }

  mkdirSync(dirname(filePath), { recursive: true })
  atomicWrite(filePath, content)
  return { path: filePath, action: 'created' }
}

/**
 * Copy a static file (non-template) to the target.
 */
export function copyStaticFile(
  src: string,
  dest: string,
  opts: { skipIfExists?: boolean } = {},
): WriteResult {
  const existed = existsSync(dest)
  if (existed && opts.skipIfExists) {
    return { path: dest, action: 'skipped' }
  }
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(src, dest)
  return { path: dest, action: existed ? 'replaced' : 'created' }
}

/**
 * Deeply merge two settings.json objects. Arrays are unioned (no duplicates by 'command').
 * All top-level keys from `existing` are preserved unchanged unless arbiter manages them
 * (currently: `hooks`, `permissions`).
 *
 * When a non-special incoming key collides with a non-undefined existing value, the existing
 * value wins (no clobber) but a console.warn is emitted listing the dropped keys so users
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
    console.warn(
      `[arbiter] settings.json merge preserved your existing values for these top-level keys; ` +
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

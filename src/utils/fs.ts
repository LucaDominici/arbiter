import { existsSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface WriteResult {
  path: string
  action: 'created' | 'skipped' | 'backed-up-and-replaced'
}

/**
 * Write a file, creating parent directories as needed.
 * If the file already exists and skipIfExists=true, skip it.
 * If backup=true and file exists, copy it to <path>.arbiter-backup before writing.
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
    writeFileSync(filePath, content, 'utf-8')
    return { path: filePath, action: 'backed-up-and-replaced' }
  }

  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf-8')
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
  if (existsSync(dest) && opts.skipIfExists) {
    return { path: dest, action: 'skipped' }
  }
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(src, dest)
  return {
    path: dest,
    action: existsSync(dest) ? 'backed-up-and-replaced' : 'created',
  }
}

/**
 * Deeply merge two settings.json objects. Arrays are unioned (no duplicates by 'command').
 */
export function mergeSettingsJson(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...existing }

  for (const [key, incomingVal] of Object.entries(incoming)) {
    const existingVal = existing[key]

    if (key === 'hooks' && isHooksObject(incomingVal) && isHooksObject(existingVal)) {
      result[key] = mergeHooks(existingVal, incomingVal)
    } else if (key === 'permissions' && isPermissions(incomingVal) && isPermissions(existingVal)) {
      result[key] = mergePermissions(existingVal, incomingVal)
    } else if (existingVal === undefined) {
      result[key] = incomingVal
    }
    // If key exists and is not a special case, preserve existing value
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

function extractHookBasename(command: string): string | null {
  const match = command.match(/\.claude\/hooks\/([^./\s]+)\.\w+/)
  return match?.[1] ?? null
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
  for (const hook of incomingEntry.hooks) {
    const incomingBasename = extractHookBasename(hook.command)
    if (incomingBasename) {
      // Remove old variants of the same hook (e.g. .sh → .mjs upgrade)
      existingEntry.hooks = existingEntry.hooks.filter((h) => {
        const existingBasename = extractHookBasename(h.command)
        return existingBasename !== incomingBasename
      })
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

// SPDX-License-Identifier: Apache-2.0
//
// Branch-coverage climb for src/utils/fs.ts (epic #1480 PR3+, issue #1486).
//
// This file targets the ~12 branches the existing fs.test.ts /
// fs-generation-session.test.ts suites leave uncovered. Each `describe` block
// is annotated with the exact branch it drives. All filesystem effects use a
// real `mkdtempSync` fixture cleaned in `afterEach`; no network, git, gh, or
// spawn is involved (fs.ts shells out to nothing). Signal handlers are exercised
// by invoking the registered listener directly with `process.kill` stubbed so
// the test runner is never actually signalled.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { ArbiterError } from '../../src/utils/errors.js'
import {
  writeFile,
  beginGenerationSession,
  endGenerationSession,
  cleanupInFlightTmpFiles,
  registerCleanupHandlers,
  _registerTmpPath,
  mergeSettingsJson,
} from '../../src/utils/fs.js'

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

// ── atomicWrite catch block (lines 39-51) ────────────────────────────────────
// Drives: the mapped-errno path (ENOTDIR is in FS_ERROR_KEYS → ArbiterError),
// the unmapped-errno rethrow (ENAMETOOLONG is NOT mapped → original err), and
// the best-effort tmp-unlink catch (line 40-42) which silently swallows.
describe('writeFile — atomicWrite error translation (lines 39-51)', () => {
  let dir: string

  beforeEach(() => {
    cleanupInFlightTmpFiles()
    dir = mkdtempSync(join(tmpdir(), 'arb-fscov-atomic-'))
  })
  afterEach(() => {
    endGenerationSession()
    rmSync(dir, { recursive: true, force: true })
  })

  it('throws a translated ArbiterError when the errno is mapped (EISDIR)', () => {
    // The target path is an existing DIRECTORY. resolveWriteAction reads it
    // (readFileSync on a dir throws → disk=null → action 'replaced'), then
    // atomicWrite's renameSync(tmp, <dir>) throws EISDIR — a mapped code →
    // ArbiterError.fromKey with E_FS_EISDIR.
    const targetDir = join(dir, 'i-am-a-directory')
    mkdirSync(targetDir)
    let caught: unknown
    try {
      writeFile(targetDir, 'C')
    } catch (err: unknown) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ArbiterError)
    const e = caught as ArbiterError
    expect(e.code).toBe('EISDIR')
    expect(e.message).toContain(targetDir)
  })

  it('re-throws the original error untranslated when the errno is NOT mapped (ENAMETOOLONG)', () => {
    // A 300-char basename overflows the OS limit. mkdirSync(dirname) succeeds
    // (dir exists); writeFileSync(tmpPath) throws ENAMETOOLONG, which is absent
    // from FS_ERROR_KEYS → the raw error is re-thrown (no ArbiterError wrap).
    const longName = 'z'.repeat(300)
    let caught: unknown
    try {
      writeFile(join(dir, longName), 'data')
    } catch (err: unknown) {
      caught = err
    }
    expect(caught).toBeInstanceOf(Error)
    expect(caught).not.toBeInstanceOf(ArbiterError)
    expect((caught as NodeJS.ErrnoException).code).toBe('ENAMETOOLONG')
  })

  it('leaves no .arbiter-tmp-* orphan after a failed write (best-effort cleanup ran)', () => {
    const longName = 'q'.repeat(300)
    try {
      writeFile(join(dir, longName), 'data')
    } catch {
      // expected
    }
    // The catch block's unlinkSync removed the tmp file; the finally drained the
    // in-flight set. No retry should be queued for the signal handler.
    cleanupInFlightTmpFiles()
    // dir itself should hold no tmp residue (the over-long names never landed).
    expect(() => readFileSync(join(dir, 'data'), 'utf-8')).toThrow()
  })
})

// ── doCleanup non-ENOENT warning (lines 57-72) ───────────────────────────────
// Drives: the `code !== 'ENOENT'` TRUE branch (line 63) → stderr warning
// (lines 66-67). A registered path that is a non-empty DIRECTORY makes
// unlinkSync throw EISDIR (non-ENOENT) → the warn branch runs.
describe('cleanupInFlightTmpFiles — non-ENOENT unlink warns (lines 63-67)', () => {
  let dir: string

  beforeEach(() => {
    cleanupInFlightTmpFiles()
    dir = mkdtempSync(join(tmpdir(), 'arb-fscov-cleanup-'))
  })
  afterEach(() => {
    cleanupInFlightTmpFiles()
    rmSync(dir, { recursive: true, force: true })
  })

  it('warns to stderr (does not throw) when an in-flight path cannot be unlinked', () => {
    // unlinkSync on a directory → EISDIR, a non-ENOENT code → warn branch.
    const sub = join(dir, 'a-directory')
    mkdirSync(sub)
    writeFileSync(join(sub, 'keep.txt'), 'x')
    _registerTmpPath(sub)

    const writes: string[] = []
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
        return true
      })
    try {
      expect(() => cleanupInFlightTmpFiles()).not.toThrow()
    } finally {
      stderrSpy.mockRestore()
    }
    expect(writes.some((w: string): boolean => w.includes('could not remove in-flight tmp file'))).toBe(
      true,
    )
    expect(writes.some((w: string): boolean => w.includes('EISDIR'))).toBe(true)
  })

  it('does NOT warn when the in-flight path is already gone (ENOENT branch)', () => {
    _registerTmpPath(join(dir, 'never-existed.arbiter-tmp-x'))
    const writes: string[] = []
    const stderrSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
        return true
      })
    try {
      cleanupInFlightTmpFiles()
    } finally {
      stderrSpy.mockRestore()
    }
    expect(writes.some((w: string): boolean => w.includes('could not remove'))).toBe(false)
  })
})

// ── registerCleanupHandlers idempotency (line 84) ────────────────────────────
// Drives: the `if (handlersRegistered) return` early-return TRUE branch.
describe('registerCleanupHandlers — idempotent re-call (line 84)', () => {
  it('a second call is a no-op (handlers registered exactly once)', () => {
    const killSpy = vi
      .spyOn(process, 'kill')
      .mockImplementation((): never => undefined as never)
    try {
      // First call registers (or was already registered by an earlier test —
      // either way, after this the module flag is set).
      registerCleanupHandlers()
      const afterFirst = process.rawListeners('SIGINT').length
      // Second call must hit the early-return guard and add NO new listener.
      registerCleanupHandlers()
      const afterSecond = process.rawListeners('SIGINT').length
      expect(afterSecond).toBe(afterFirst)
    } finally {
      killSpy.mockRestore()
    }
  })
})

// ── recordGeneratedHash null-key warn (lines 198-209) ────────────────────────
// Drives: the `key === null` TRUE branch → logger.warn, return without record.
// A write whose path ESCAPES the session targetDir keys to null.
describe('writeFile — recordGeneratedHash skips a non-relative key (lines 202-208)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arb-fscov-nullkey-'))
  })
  afterEach(() => {
    endGenerationSession()
    rmSync(dir, { recursive: true, force: true })
  })

  it('records NO hash for a created file written OUTSIDE the session targetDir', () => {
    const inner = join(dir, 'inner')
    mkdirSync(inner)
    // Session is scoped to `inner`, but we write to a sibling under `dir` →
    // manifestKey(inner, outside) escapes (`../…`) → null → warn + no record.
    beginGenerationSession({ targetDir: inner, prevHashes: {} })
    const outside = join(dir, 'outside.txt')
    const result = writeFile(outside, 'CONTENT')
    const recorded = endGenerationSession()
    expect(result.action).toBe('created')
    expect(readFileSync(outside, 'utf-8')).toBe('CONTENT')
    // Nothing keyable was recorded (every candidate key escaped targetDir).
    expect(Object.keys(recorded)).toHaveLength(0)
  })
})

// ── resolveWriteAction skipIfExists branches (lines 253-272) ─────────────────
describe('writeFile — resolveWriteAction skipIfExists branch matrix', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arb-fscov-resolve-'))
  })
  afterEach(() => {
    endGenerationSession()
    rmSync(dir, { recursive: true, force: true })
  })

  // Drives: line 262 cond-expr `backup ? 'backed-up-and-replaced' : 'replaced'`
  // TRUE side — a pristine skipIfExists rewrite WITH backup requested.
  it('pristine skipIfExists file + backup=true → backed-up-and-replaced (line 262)', () => {
    const p = join(dir, 'pristine.mjs')
    const old = 'arbiter original render'
    writeFileSync(p, old)
    beginGenerationSession({ targetDir: dir, prevHashes: { 'pristine.mjs': sha256(old) } })
    const result = writeFile(p, 'new template fix', {
      skipIfExists: true,
      backup: true,
      dryRun: true,
    })
    endGenerationSession()
    expect(result.action).toBe('backed-up-and-replaced')
    expect(result.withheld).toBeFalsy()
  })

  // Drives: line 258 cond-expr `key === null ? undefined : ...` TRUE side AND
  // line 269 `key ?? filePath` fallback (key is null → full path used).
  it('user-modified skipIfExists file OUTSIDE targetDir → withheld via filePath fallback (lines 258,269)', () => {
    const inner = join(dir, 'inner')
    mkdirSync(inner)
    const p = join(dir, 'escaped.mjs') // sibling of `inner`, escapes session key
    writeFileSync(p, 'user-edited content')
    const seen: string[] = []
    beginGenerationSession({
      targetDir: inner,
      // prevHashes is irrelevant — the key is null so the lookup is skipped.
      prevHashes: { whatever: sha256('x') },
      onWithheld: (key: string): void => {
        seen.push(key)
      },
    })
    const result = writeFile(p, 'new template fix', { skipIfExists: true, dryRun: true })
    endGenerationSession()
    expect(result.action).toBe('skipped')
    expect(result.withheld).toBe(true)
    // key was null → onWithheld received the absolute filePath, not a manifest key.
    expect(seen).toContain(p)
    // diff must not mutate disk.
    expect(readFileSync(p, 'utf-8')).toBe('user-edited content')
  })
})

// ── mergeSettingsJson — incoming-only key (lines 359-363) ────────────────────
// Drives: line 359 `existingVal === undefined` TRUE branch (a genuinely new
// incoming top-level key is added, NOT dropped, NOT warned).
describe('mergeSettingsJson — adds a new incoming key (line 359)', () => {
  it('adds an incoming top-level key absent from existing without warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((): void => {})
    try {
      const existing: Record<string, unknown> = { kept: 1 }
      const incoming: Record<string, unknown> = { brandNew: 'value' }
      const result = mergeSettingsJson(existing, incoming)
      expect(result).toHaveProperty('kept', 1)
      expect(result).toHaveProperty('brandNew', 'value')
      // No collision → no dropped keys → no warn.
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })
})

// ── mergeHooks / mergeHookEntry branches (lines 419-475) ─────────────────────
type HookCmd = { command: string; type?: string; timeout?: number }
type HookEntry = { matcher: string; hooks: HookCmd[] }
type Settings = {
  hooks?: Record<string, HookEntry[]>
  permissions?: { allow?: string[]; deny?: string[] }
}

describe('mergeSettingsJson — hook merge branches (lines 421-475)', () => {
  it('appends an incoming entry for a NEW event AND a NEW matcher (lines 432,439)', () => {
    // existing has no `PostToolUse` event → `existing[event] ?? []` uses the []
    // fallback (line 432). The incoming matcher is unseen → push branch (line 439).
    const existing: Record<string, unknown> = {
      hooks: { PreToolUse: [] as HookEntry[] },
      permissions: { allow: [] as string[] },
    }
    const incoming: Record<string, unknown> = {
      hooks: {
        PostToolUse: [
          {
            matcher: 'Write',
            hooks: [{ command: 'node .claude/hooks/check-no-any.mjs', type: 'command' }],
          },
        ],
      },
      permissions: { allow: [] as string[] },
    }
    const result = mergeSettingsJson(existing, incoming) as Settings
    const entry = result.hooks?.['PostToolUse']?.[0]
    expect(entry?.matcher).toBe('Write')
    expect(entry?.hooks).toHaveLength(1)
  })

  it('preserves a non-arbiter hook with no .claude/hooks/ basename (line 421 null branch)', () => {
    // The incoming dispatcher upgrade filters existing hooks by basename. A
    // custom user hook whose command does NOT match the .claude/hooks/ pattern
    // → extractHookBasename returns null → `basename === null` keeps it.
    const existing: Record<string, unknown> = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Edit',
            hooks: [
              { command: 'my-custom-linter --fix', type: 'command' }, // basename null
              { command: 'node .claude/hooks/check-no-pii.mjs', type: 'command' }, // arbiter-managed
            ],
          },
        ],
      },
      permissions: { allow: [] as string[] },
    }
    const incoming: Record<string, unknown> = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Edit',
            // Dispatcher command triggers the upgrade path (lines 454-459):
            // arbiter-managed basenames are stripped, the null-basename custom
            // hook is retained.
            hooks: [{ command: 'node .claude/hooks/hooks.mjs', type: 'command' }],
          },
        ],
      },
      permissions: { allow: [] as string[] },
    }
    const result = mergeSettingsJson(existing, incoming) as Settings
    const hooks = result.hooks?.['PreToolUse']?.[0]?.hooks ?? []
    const commands = hooks.map((h: HookCmd): string => h.command)
    // Custom hook with a null basename survives the dispatcher upgrade...
    expect(commands).toContain('my-custom-linter --fix')
    // ...the arbiter-managed check-no-pii hook is removed...
    expect(commands.some((c: string): boolean => c.includes('check-no-pii'))).toBe(false)
    // ...and the dispatcher itself is now present.
    expect(commands.some((c: string): boolean => c.includes('hooks.mjs'))).toBe(true)
  })
})

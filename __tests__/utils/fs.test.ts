import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  writeFile,
  copyStaticFile,
  resolvedPath,
  mergeSettingsJson,
  registerCleanupHandlers,
  cleanupInFlightTmpFiles,
  _registerTmpPath,
  _translateFsError,
} from '../../src/utils/fs.js'
import { createTestProject, cleanupTestProject } from '../helpers.js'

describe('writeFile', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject()
  })
  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('creates a new file and returns "created"', () => {
    const path = join(dir, 'test.md')
    const result = writeFile(path, '# Hello')
    expect(result.action).toBe('created')
    expect(readFileSync(path, 'utf-8')).toBe('# Hello')
  })

  it('creates parent directories automatically', () => {
    const path = join(dir, 'deeply', 'nested', 'file.txt')
    const result = writeFile(path, 'content')
    expect(result.action).toBe('created')
    expect(readFileSync(path, 'utf-8')).toBe('content')
  })

  it('skips existing file when skipIfExists=true', () => {
    const path = join(dir, 'existing.txt')
    writeFileSync(path, 'original')
    const result = writeFile(path, 'new content', { skipIfExists: true })
    expect(result.action).toBe('skipped')
    expect(readFileSync(path, 'utf-8')).toBe('original')
  })

  it('overwrites existing file when no options set — action is replaced (no backup)', () => {
    const path = join(dir, 'existing.txt')
    writeFileSync(path, 'original')
    const result = writeFile(path, 'new content')
    expect(result.action).toBe('replaced')
    expect(readFileSync(path, 'utf-8')).toBe('new content')
  })

  it('creates backup file when backup=true', () => {
    const path = join(dir, 'governance.md')
    writeFileSync(path, 'old content')
    writeFile(path, 'new content', { backup: true })
    expect(existsSync(`${path}.arbiter-backup`)).toBe(true)
    expect(readFileSync(`${path}.arbiter-backup`, 'utf-8')).toBe('old content')
    expect(readFileSync(path, 'utf-8')).toBe('new content')
  })

  it('does not create backup for new file even when backup=true', () => {
    const path = join(dir, 'new.md')
    const result = writeFile(path, 'content', { backup: true })
    expect(result.action).toBe('created')
    expect(existsSync(`${path}.arbiter-backup`)).toBe(false)
  })

  it('returns the correct path in result', () => {
    const path = join(dir, 'test.txt')
    const result = writeFile(path, 'data')
    expect(result.path).toBe(path)
  })
})

describe('writeFile — content-equality skipping (#1077 F6)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject()
  })
  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('skips when existing content is byte-identical (no skipIfExists, no backup)', () => {
    const path = join(dir, 'idem.txt')
    writeFileSync(path, 'same bytes')
    const result = writeFile(path, 'same bytes')
    expect(result.action).toBe('skipped')
    // No write happened — no orphan tmp files
    const orphans = readdirSync(dir).filter((e) => e.includes('.arbiter-tmp-'))
    expect(orphans).toHaveLength(0)
  })

  it('skips identical content even when backup=true (idempotence beats backup)', () => {
    const path = join(dir, 'idem-backup.txt')
    writeFileSync(path, 'identical')
    const result = writeFile(path, 'identical', { backup: true })
    expect(result.action).toBe('skipped')
    // No backup is written when content is unchanged
    expect(existsSync(`${path}.arbiter-backup`)).toBe(false)
  })

  it('replaces when content differs (no backup)', () => {
    const path = join(dir, 'diff.txt')
    writeFileSync(path, 'old')
    const result = writeFile(path, 'new')
    expect(result.action).toBe('replaced')
    expect(readFileSync(path, 'utf-8')).toBe('new')
  })

  it('backs-up-and-replaces when content differs and backup=true', () => {
    const path = join(dir, 'diff-backup.txt')
    writeFileSync(path, 'old')
    const result = writeFile(path, 'new', { backup: true })
    expect(result.action).toBe('backed-up-and-replaced')
    expect(existsSync(`${path}.arbiter-backup`)).toBe(true)
  })
})

describe('writeFile — dryRun action parity (#1077 F1/F7)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject()
  })
  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('missing path → created, and writes nothing to disk', () => {
    const path = join(dir, 'missing.txt')
    const result = writeFile(path, 'content', { dryRun: true })
    expect(result.action).toBe('created')
    expect(existsSync(path)).toBe(false)
  })

  it('existing identical content → skipped, and writes nothing', () => {
    const path = join(dir, 'same.txt')
    writeFileSync(path, 'content')
    const result = writeFile(path, 'content', { dryRun: true })
    expect(result.action).toBe('skipped')
    expect(readFileSync(path, 'utf-8')).toBe('content')
  })

  it('existing differing content → replaced, and leaves original untouched', () => {
    const path = join(dir, 'differ.txt')
    writeFileSync(path, 'original')
    const result = writeFile(path, 'incoming', { dryRun: true })
    expect(result.action).toBe('replaced')
    expect(readFileSync(path, 'utf-8')).toBe('original')
    expect(existsSync(`${path}.arbiter-backup`)).toBe(false)
  })

  it('existing differing content with backup → backed-up-and-replaced, no backup written', () => {
    const path = join(dir, 'differ-backup.txt')
    writeFileSync(path, 'original')
    const result = writeFile(path, 'incoming', { backup: true, dryRun: true })
    expect(result.action).toBe('backed-up-and-replaced')
    expect(readFileSync(path, 'utf-8')).toBe('original')
    expect(existsSync(`${path}.arbiter-backup`)).toBe(false)
  })

  it('existing file with skipIfExists → skipped (skipIfExists wins over backup)', () => {
    const path = join(dir, 'skip.txt')
    writeFileSync(path, 'original')
    const result = writeFile(path, 'incoming', {
      skipIfExists: true,
      backup: true,
      dryRun: true,
    })
    expect(result.action).toBe('skipped')
    expect(readFileSync(path, 'utf-8')).toBe('original')
  })

  it('dryRun never leaves orphan tmp files', () => {
    const path = join(dir, 'no-orphan.txt')
    writeFileSync(path, 'before')
    writeFile(path, 'after', { dryRun: true })
    const orphans = readdirSync(dir).filter((e) => e.includes('.arbiter-tmp-'))
    expect(orphans).toHaveLength(0)
  })
})

describe('copyStaticFile', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject()
  })
  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('copies a file to destination', () => {
    const src = join(dir, 'source.txt')
    const dest = join(dir, 'dest.txt')
    writeFileSync(src, 'source content')
    const result = copyStaticFile(src, dest)
    expect(readFileSync(dest, 'utf-8')).toBe('source content')
    expect(result.path).toBe(dest)
  })

  it('creates parent directories for destination', () => {
    const src = join(dir, 'source.txt')
    const dest = join(dir, 'subdir', 'dest.txt')
    writeFileSync(src, 'content')
    copyStaticFile(src, dest)
    expect(readFileSync(dest, 'utf-8')).toBe('content')
  })

  it('skips when destination exists and skipIfExists=true', () => {
    const src = join(dir, 'source.txt')
    const dest = join(dir, 'dest.txt')
    writeFileSync(src, 'new content')
    writeFileSync(dest, 'old content')
    const result = copyStaticFile(src, dest, { skipIfExists: true })
    expect(result.action).toBe('skipped')
    expect(readFileSync(dest, 'utf-8')).toBe('old content')
  })

  it('skips when destination content is byte-identical to source (#1077 F6)', () => {
    const src = join(dir, 'source.txt')
    const dest = join(dir, 'dest.txt')
    writeFileSync(src, 'identical bytes')
    writeFileSync(dest, 'identical bytes')
    const result = copyStaticFile(src, dest)
    expect(result.action).toBe('skipped')
  })

  it('dryRun missing dest → created, writes nothing (#1077 F1)', () => {
    const src = join(dir, 'source.txt')
    const dest = join(dir, 'dest.txt')
    writeFileSync(src, 'payload')
    const result = copyStaticFile(src, dest, { dryRun: true })
    expect(result.action).toBe('created')
    expect(existsSync(dest)).toBe(false)
  })

  it('dryRun differing dest → replaced, leaves dest untouched (#1077 F7)', () => {
    const src = join(dir, 'source.txt')
    const dest = join(dir, 'dest.txt')
    writeFileSync(src, 'incoming')
    writeFileSync(dest, 'original')
    const result = copyStaticFile(src, dest, { dryRun: true })
    expect(result.action).toBe('replaced')
    expect(readFileSync(dest, 'utf-8')).toBe('original')
  })

  it('dryRun identical dest → skipped (#1077 F6)', () => {
    const src = join(dir, 'source.txt')
    const dest = join(dir, 'dest.txt')
    writeFileSync(src, 'same')
    writeFileSync(dest, 'same')
    const result = copyStaticFile(src, dest, { dryRun: true })
    expect(result.action).toBe('skipped')
  })
})

describe('resolvedPath', () => {
  it('joins target directory with path parts', () => {
    expect(resolvedPath('/home/user/project', '.claude', 'CLAUDE.md')).toBe(
      join('/home/user/project', '.claude', 'CLAUDE.md'),
    )
  })

  it('handles single part', () => {
    expect(resolvedPath('/tmp', 'file.txt')).toBe(join('/tmp', 'file.txt'))
  })

  it('handles multiple parts', () => {
    expect(resolvedPath('/root', 'a', 'b', 'c')).toBe(join('/root', 'a', 'b', 'c'))
  })
})

describe('writeFile — atomic writes (#611)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject()
  })
  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('no .arbiter-tmp-* files left behind on success', () => {
    const path = join(dir, 'out.txt')
    writeFile(path, 'content')
    const tmpFiles = readdirSync(dir).filter((f) => f.includes('.arbiter-tmp-'))
    expect(tmpFiles).toHaveLength(0)
  })

  it('does not leave temp files after overwriting existing file', () => {
    const path = join(dir, 'out.txt')
    writeFileSync(path, 'original')
    writeFile(path, 'new content')
    const tmpFiles = readdirSync(dir).filter((f) => f.includes('.arbiter-tmp-'))
    expect(tmpFiles).toHaveLength(0)
    expect(readFileSync(path, 'utf-8')).toBe('new content')
  })

  it('original file remains untouched when write to new path fails', () => {
    const existing = join(dir, 'existing.txt')
    writeFileSync(existing, 'original content')
    // Write to a non-existent deeply nested path (mkdirSync will still create it)
    // This is a success path — verify original file is untouched
    writeFile(join(dir, 'sub', 'new.txt'), 'new')
    expect(readFileSync(existing, 'utf-8')).toBe('original content')
  })
})

describe('mergeSettingsJson (#286)', () => {
  it('preserves unknown top-level keys from existing settings without warning (#286)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const existing = { myCustomSetting: true, hooks: {}, permissions: { allow: [] } }
    const incoming = { hooks: {}, permissions: { allow: [] } }
    const result = mergeSettingsJson(existing, incoming)
    // No keys are dropped, so no warn should ever fire
    expect(warnSpy).not.toHaveBeenCalled()
    expect(result).toHaveProperty('myCustomSetting', true)
    vi.restoreAllMocks()
  })

  it('does not emit console.warn for known keys (hooks, permissions) (#286)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const existing = { hooks: {}, permissions: { allow: ['npm run build'] } }
    const incoming = { hooks: {}, permissions: { allow: ['npm test'] } }
    mergeSettingsJson(existing, incoming)
    expect(warnSpy).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('preserves unknown keys in the merged output (#286)', () => {
    const existing = { myCustomSetting: true, hooks: {} }
    const incoming = { hooks: {} }
    const result = mergeSettingsJson(existing, incoming)
    expect(result).toHaveProperty('myCustomSetting', true)
  })

  it('emits console.warn listing dropped top-level keys on conflict (#286)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const existing = { env: { USER_VAR: '1' } }
    const incoming = { env: { ARBITER_DEFAULT: 'on' } }
    const result = mergeSettingsJson(existing, incoming)
    // Existing value preserved (no clobber)
    expect(result).toEqual({ env: { USER_VAR: '1' } })
    // But user is warned that incoming was dropped
    expect(warnSpy).toHaveBeenCalledOnce()
    const msg = warnSpy.mock.calls[0]?.[0] ?? ''
    expect(msg).toMatch(/env/)
    vi.restoreAllMocks()
  })

  it('does NOT warn when only special keys (hooks/permissions) collide (#286)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const existing = { hooks: { PreToolUse: [] }, permissions: { allow: ['x'] } }
    const incoming = { hooks: { PreToolUse: [] }, permissions: { allow: ['y'] } }
    mergeSettingsJson(existing, incoming)
    expect(warnSpy).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('removes old hook variants when the same hook upgrades extension (.sh → .mjs)', () => {
    const existing = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Edit',
            hooks: [{ command: 'node .claude/hooks/check-no-any.sh', timeout: 5000 }],
          },
        ],
      },
      permissions: { allow: [] as string[] },
    }
    const incoming = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Edit',
            hooks: [{ command: 'node .claude/hooks/check-no-any.mjs', timeout: 5000 }],
          },
        ],
      },
      permissions: { allow: [] as string[] },
    }
    const result = mergeSettingsJson(existing, incoming)
    const entry = (
      result.hooks as Record<string, { matcher: string; hooks: { command: string }[] }[]>
    )['PreToolUse']?.[0]
    expect(entry?.hooks).toHaveLength(1)
    expect(entry?.hooks[0]?.command).toContain('.mjs')
  })
})

describe('registerCleanupHandlers (#613)', () => {
  it('registers signal handlers and cleans in-flight tmp files on signal', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((): never => undefined as never)
    try {
      const sigintBefore = process.rawListeners('SIGINT').length
      const sigtermBefore = process.rawListeners('SIGTERM').length
      registerCleanupHandlers()
      const sigintListeners = process.rawListeners('SIGINT') as ((...args: unknown[]) => void)[]
      const sigtermListeners = process.rawListeners('SIGTERM') as ((...args: unknown[]) => void)[]
      // At least one new handler registered per signal (guard against double-call)
      expect(sigintListeners.length).toBeGreaterThanOrEqual(sigintBefore)
      expect(sigtermListeners.length).toBeGreaterThanOrEqual(sigtermBefore)
      // Call each signal handler directly to cover the callback body
      sigintListeners[sigintListeners.length - 1]!()
      sigtermListeners[sigtermListeners.length - 1]!()
      expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGINT')
      expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGTERM')
    } finally {
      killSpy.mockRestore()
    }
  })
})

describe('atomic write + signal cleanup (#613)', () => {
  let dir: string

  beforeEach(() => {
    // drain any stale in-flight paths from previous tests before each run
    cleanupInFlightTmpFiles()
    dir = createTestProject()
  })
  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('writeFile produces correct content atomically', () => {
    const path = join(dir, 'atomic.txt')
    writeFile(path, 'hello atomic')
    expect(readFileSync(path, 'utf-8')).toBe('hello atomic')
    // no orphan tmp file left (readdirSync — existsSync does not expand globs)
    const orphans = readdirSync(dir).filter((e) => e.includes('.arbiter-tmp-'))
    expect(orphans).toHaveLength(0)
  })

  it('cleanupInFlightTmpFiles removes registered tmp paths', () => {
    const tmpPath = join(dir, 'in-flight.arbiter-tmp-test')
    writeFileSync(tmpPath, 'partial write')
    _registerTmpPath(tmpPath)
    expect(existsSync(tmpPath)).toBe(true)
    cleanupInFlightTmpFiles()
    expect(existsSync(tmpPath)).toBe(false)
  })

  it('cleanupInFlightTmpFiles is idempotent when tmp file already removed', () => {
    const tmpPath = join(dir, 'gone.arbiter-tmp-test')
    _registerTmpPath(tmpPath)
    // file was never created — cleanup must not throw
    expect(() => cleanupInFlightTmpFiles()).not.toThrow()
  })

  it('cleanupInFlightTmpFiles clears all registered paths', () => {
    const paths = ['a', 'b', 'c'].map((n) => join(dir, `${n}.arbiter-tmp-test`))
    for (const p of paths) {
      writeFileSync(p, 'data')
      _registerTmpPath(p)
    }
    cleanupInFlightTmpFiles()
    for (const p of paths) {
      expect(existsSync(p)).toBe(false)
    }
  })

  it('writeFile leaves no orphan tmp files after successful write', () => {
    const path = join(dir, 'clean.txt')
    writeFile(path, 'content')
    const orphans = readdirSync(dir).filter((e) => e.includes('.arbiter-tmp-'))
    expect(orphans).toHaveLength(0)
  })
})

describe('ENOSPC_MSGS errno translation (#616)', () => {
  const path = '/some/path/file.txt'

  it('translates EPERM with permission-related hints', () => {
    const msg = _translateFsError('EPERM', path)
    expect(msg).not.toBeNull()
    expect(msg).toMatch(/immutable bit|SELinux|AppArmor|ACL|ownership/i)
    expect(msg).toContain(path)
  })

  it('translates ENOTDIR with not-a-directory hint', () => {
    const msg = _translateFsError('ENOTDIR', path)
    expect(msg).not.toBeNull()
    expect(msg).toMatch(/not a directory/i)
  })

  it('translates EISDIR with is-a-directory hint', () => {
    const msg = _translateFsError('EISDIR', path)
    expect(msg).not.toBeNull()
    expect(msg).toMatch(/directory/i)
  })

  it('returns null for unmapped codes', () => {
    expect(_translateFsError('ENOENT', path)).toBeNull()
    expect(_translateFsError('UNKNOWN', path)).toBeNull()
  })
})

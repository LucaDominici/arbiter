import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { statSync, lstatSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import {
  writeFile,
  resolvedPath,
  mergeSettingsJson,
  registerCleanupHandlers,
  cleanupInFlightTmpFiles,
  beginGenerationSession,
  endGenerationSession,
  _registerTmpPath,
  _translateFsError,
  writeFileTranslated,
  chmodTranslated,
  unlinkTranslated,
  rmTranslated,
  symlinkTranslated,
  mkdtempTranslated,
  createExclusiveTranslated,
  copyTreeTranslated,
  assertWritten,
} from '../../src/utils/fs.js'
import { ArbiterError } from '../../src/utils/errors.js'
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

describe('writeFile — preserve marker withholds overwrite (#1980)', () => {
  let dir: string

  beforeEach(() => {
    dir = createTestProject()
  })
  afterEach(() => {
    cleanupTestProject(dir)
  })

  it('leaves a marked file byte-identical and reports it withheld (no backup, no skipIfExists)', () => {
    const path = join(dir, 'GLOBAL_INVARIANTS.md')
    const stub = '<!-- arbiter:preserve -->\n# Hand-maintained pointer stub\nSee central docs.\n'
    writeFileSync(path, stub)
    const result = writeFile(path, '# Full generated content\n...')
    expect(result.action).toBe('skipped')
    expect(result.withheld).toBe(true)
    expect(readFileSync(path, 'utf-8')).toBe(stub)
  })

  it('withholds even when backup=true (fail-safe regardless of backup setting)', () => {
    const path = join(dir, 'marked-backup.md')
    const stub = '<!-- arbiter:preserve -->\nkeep me\n'
    writeFileSync(path, stub)
    const result = writeFile(path, 'new content', { backup: true })
    expect(result.action).toBe('skipped')
    expect(result.withheld).toBe(true)
    expect(readFileSync(path, 'utf-8')).toBe(stub)
    expect(existsSync(`${path}.arbiter-backup`)).toBe(false)
  })

  it('withholds even when skipIfExists=true and a generation session would otherwise adopt it', () => {
    const path = join(dir, 'marked-session.md')
    const stub = '<!-- arbiter:preserve -->\nkeep me\n'
    writeFileSync(path, stub)
    beginGenerationSession({
      targetDir: dir,
      prevHashes: {},
      adoptPredicate: () => true,
    })
    try {
      const result = writeFile(path, 'new content', { skipIfExists: true })
      expect(result.action).toBe('skipped')
      expect(result.withheld).toBe(true)
      expect(result.adopted).not.toBe(true)
    } finally {
      endGenerationSession()
    }
    expect(readFileSync(path, 'utf-8')).toBe(stub)
  })

  it('does not withhold a file without the marker', () => {
    const path = join(dir, 'unmarked.md')
    writeFileSync(path, 'plain content')
    const result = writeFile(path, 'new content')
    expect(result.action).toBe('replaced')
    expect(readFileSync(path, 'utf-8')).toBe('new content')
  })

  // #2533: evidence/log/data writers (task-record-red's TDD evidence, tech-debt.json,
  // the unified task-status document) are never subject to the preserve marker — they
  // are internal tooling state, not a generator-emitted target a downstream repo would
  // hand-customise and mark. A captured test_run_log that happens to quote AGENTS.md's
  // own `<!-- arbiter:preserve -->` comment must never freeze the evidence file.
  it('bypasses the withholding entirely when skipPreserveCheck=true, even though the marker is present', () => {
    const path = join(dir, 'evidence-like.json')
    const stub = JSON.stringify({ test_run_log: 'quotes <!-- arbiter:preserve --> verbatim' })
    writeFileSync(path, stub)
    const result = writeFile(path, JSON.stringify({ test_run_log: 'second run' }), {
      skipPreserveCheck: true,
    })
    expect(result.action).toBe('replaced')
    expect(result.withheld).toBeUndefined()
    expect(readFileSync(path, 'utf-8')).toBe(JSON.stringify({ test_run_log: 'second run' }))
  })

  it('skipPreserveCheck does not affect a normal generator target — the marker still withholds by default', () => {
    const path = join(dir, 'GLOBAL_INVARIANTS_2.md')
    const stub = '<!-- arbiter:preserve -->\nkeep me\n'
    writeFileSync(path, stub)
    const result = writeFile(path, 'new content')
    expect(result.action).toBe('skipped')
    expect(result.withheld).toBe(true)
  })
})

describe('assertWritten() (#2533 — a withheld write must never be reported as success)', () => {
  it('throws when the write was withheld and not adopted (content did NOT land)', () => {
    expect(() =>
      assertWritten(
        { path: '/repo/.arbiter/evidence/tdd/#1.json', action: 'skipped', withheld: true },
        'TDD evidence for #1',
      ),
    ).toThrow(/withheld/i)
  })

  it('names the path and the caller-supplied description in the thrown message', () => {
    expect(() =>
      assertWritten(
        { path: '/repo/x.json', action: 'skipped', withheld: true },
        'tech-debt evidence',
      ),
    ).toThrow(/\/repo\/x\.json/)
    expect(() =>
      assertWritten(
        { path: '/repo/x.json', action: 'skipped', withheld: true },
        'tech-debt evidence',
      ),
    ).toThrow(/tech-debt evidence/)
  })

  it('does not throw for a benign identical-content skip (withheld unset)', () => {
    expect(() => assertWritten({ path: '/x', action: 'skipped' }, 'evidence')).not.toThrow()
  })

  it('does not throw when withheld but force-adopted — the content DID land', () => {
    expect(() =>
      assertWritten({ path: '/x', action: 'replaced', withheld: true, adopted: true }, 'evidence'),
    ).not.toThrow()
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

describe('writeFile — withheld flag (#1344)', () => {
  let dir: string
  const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex')

  beforeEach(() => {
    dir = createTestProject()
  })
  afterEach(() => {
    endGenerationSession()
    cleanupTestProject(dir)
  })

  it('sets withheld=true when a user-modified skipIfExists file would receive a differing template fix', () => {
    const path = join(dir, 'gate.mjs')
    writeFileSync(path, 'user-edited content')
    // Manifest records arbiter's ORIGINAL render hash; the on-disk bytes differ
    // from it (user-modified) AND from the new render → fix withheld.
    beginGenerationSession({
      targetDir: dir,
      prevHashes: { 'gate.mjs': sha256('arbiter original render') },
    })
    const result = writeFile(path, 'new template fix', { skipIfExists: true, dryRun: true })
    endGenerationSession()
    expect(result.action).toBe('skipped')
    expect(result.withheld).toBe(true)
    // diff must not mutate disk.
    expect(readFileSync(path, 'utf-8')).toBe('user-edited content')
  })

  it('does NOT set withheld for a pristine skipIfExists file (it is rewritten, #1328 preserved)', () => {
    const path = join(dir, 'pristine.mjs')
    writeFileSync(path, 'arbiter original render')
    beginGenerationSession({
      targetDir: dir,
      prevHashes: { 'pristine.mjs': sha256('arbiter original render') },
    })
    const result = writeFile(path, 'new template fix', { skipIfExists: true, dryRun: true })
    endGenerationSession()
    expect(result.action).toBe('replaced')
    expect(result.withheld).toBeFalsy()
  })

  it('does NOT set withheld for a byte-identical skipIfExists file', () => {
    const path = join(dir, 'identical.mjs')
    writeFileSync(path, 'same bytes')
    beginGenerationSession({
      targetDir: dir,
      prevHashes: { 'identical.mjs': sha256('whatever') },
    })
    const result = writeFile(path, 'same bytes', { skipIfExists: true, dryRun: true })
    endGenerationSession()
    expect(result.action).toBe('skipped')
    expect(result.withheld).toBeFalsy()
  })

  it('does NOT set withheld for a created (missing) file', () => {
    const path = join(dir, 'created.mjs')
    beginGenerationSession({ targetDir: dir, prevHashes: {} })
    const result = writeFile(path, 'content', { skipIfExists: true, dryRun: true })
    endGenerationSession()
    expect(result.action).toBe('created')
    expect(result.withheld).toBeFalsy()
  })

  it('routes the withheld signal through onWithheld AND the returned flag', () => {
    const path = join(dir, 'both.mjs')
    writeFileSync(path, 'user-edited')
    const seen: string[] = []
    beginGenerationSession({
      targetDir: dir,
      prevHashes: { 'both.mjs': sha256('orig') },
      onWithheld: (key) => seen.push(key),
    })
    const result = writeFile(path, 'fix', { skipIfExists: true, dryRun: true })
    endGenerationSession()
    expect(result.withheld).toBe(true)
    expect(seen).toContain('both.mjs')
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
    // ENOENT is now mapped (#1717 / CANON-17) — only truly-unknown codes return null.
    expect(_translateFsError('UNKNOWN', path)).toBeNull()
  })

  it('translates ENOENT (added #1717 — a missing output dir is a CANON-17 code)', () => {
    const msg = _translateFsError('ENOENT', path)
    expect(msg).not.toBeNull()
    expect(msg).toContain(path)
    expect(msg).toMatch(/does not exist|create/i)
  })

  it('translates EBUSY (added #1717) with a busy/locked-file hint', () => {
    const msg = _translateFsError('EBUSY', path)
    expect(msg).not.toBeNull()
    expect(msg).toContain(path)
    expect(msg).toMatch(/busy|locked/i)
  })

  it('translates EMFILE (added #1717) with a too-many-open-files hint', () => {
    const msg = _translateFsError('EMFILE', path)
    expect(msg).not.toBeNull()
    expect(msg).toContain(path)
    expect(msg).toMatch(/too many open files|ulimit/i)
  })
})

// #1717 (CANON-17): writeFileTranslated is the approved CLI-output write façade — a thin
// direct write (no mkdir, no manifest/skipIfExists) that translates any fs errno failure
// into an ArbiterError. Unlike writeFile()/the rejected writeOutput draft, it does NOT
// create the parent directory: a missing --out dir must surface as a translated ENOENT,
// not be silently mkdir'd away.
describe('writeFileTranslated', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'write-file-translated-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes string content to an existing directory', () => {
    const out = join(dir, 'out.txt')
    writeFileTranslated(out, 'hello')
    expect(readFileSync(out, 'utf-8')).toBe('hello')
  })

  it('writes Buffer content (xlsx path)', () => {
    const out = join(dir, 'out.bin')
    const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04])
    writeFileTranslated(out, buf)
    expect(readFileSync(out)).toEqual(buf)
  })

  it('translates ENOENT into an ArbiterError when the parent directory does not exist (no mkdir)', () => {
    const out = join(dir, 'no-such-subdir', 'out.txt')
    try {
      writeFileTranslated(out, 'x')
      throw new Error('expected writeFileTranslated to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ArbiterError)
      expect((err as ArbiterError).code).toBe('ENOENT')
      expect((err as ArbiterError).message).toContain(out)
      expect(existsSync(out)).toBe(false)
    }
  })

  it('re-throws the original, unmapped error unchanged for an unmapped code (ENAMETOOLONG)', () => {
    // NAME_MAX=255 on Linux is a filesystem limit root cannot bypass — deterministic in CI.
    const longBasename = 'a'.repeat(300) + '.txt'
    const out = join(dir, longBasename)
    try {
      writeFileTranslated(out, 'x')
      throw new Error('expected writeFileTranslated to throw')
    } catch (err) {
      expect(err).not.toBeInstanceOf(ArbiterError)
      expect((err as NodeJS.ErrnoException).code).toBe('ENAMETOOLONG')
    }
  })
})

// #1991 residual tranche: the destructive/mutating ops joined the façade so the gate could
// name them. Every negative case here provokes EISDIR by operating on a DIRECTORY, never
// `chmod 000` — CI runs as root, and root ignores mode bits, so a permission-based guard
// would silently no-op the assertion into a fake green (#2288).
describe('destructive-op translated primitives (#1991)', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'fs-destructive-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('chmodTranslated sets the mode, and translates a missing path', () => {
    const f = join(dir, 'x.sh')
    writeFileSync(f, '#!/bin/sh\n')
    chmodTranslated(f, 0o755)
    expect(statSync(f).mode & 0o777).toBe(0o755)

    expect(() => chmodTranslated(join(dir, 'nope'), 0o755)).toThrow(ArbiterError)
  })

  it('unlinkTranslated removes a file, and translates EISDIR on a directory', () => {
    const f = join(dir, 'x.txt')
    writeFileSync(f, 'x')
    unlinkTranslated(f)
    expect(existsSync(f)).toBe(false)

    const sub = join(dir, 'sub')
    mkdirSync(sub)
    try {
      unlinkTranslated(sub)
      throw new Error('expected unlinkTranslated to throw on a directory')
    } catch (err) {
      expect(err).toBeInstanceOf(ArbiterError)
      // EISDIR on Linux, EPERM on macOS — both are catalogued, so both translate.
      expect(['EISDIR', 'EPERM']).toContain((err as ArbiterError).code)
    }
    expect(existsSync(sub)).toBe(true)
  })

  it('rmTranslated honours recursive/force and passes both option shapes through', () => {
    const sub = join(dir, 'tree', 'deep')
    mkdirSync(sub, { recursive: true })
    writeFileSync(join(sub, 'f'), 'x')
    rmTranslated(join(dir, 'tree'), { recursive: true, force: true })
    expect(existsSync(join(dir, 'tree'))).toBe(false)

    // force alone must swallow a missing path rather than translate it — the `{ force: true }`
    // shape is in real use for legacy dotfile cleanup and must stay non-throwing.
    expect(() => rmTranslated(join(dir, 'never-existed'), { force: true })).not.toThrow()
  })

  it('symlinkTranslated links, and leaves EEXIST RAW so a TOCTOU re-check still works', () => {
    const target = join(dir, 'target.txt')
    writeFileSync(target, 'x')
    const link = join(dir, 'link.txt')
    symlinkTranslated(target, link)
    expect(lstatSync(link).isSymbolicLink()).toBe(true)

    // EEXIST is deliberately absent from FS_ERROR_KEYS: src/worktree/links.ts branches on
    // `err.code === 'EEXIST'` to absorb a concurrent creation. Translating it would kill
    // that branch silently.
    try {
      symlinkTranslated(target, link)
      throw new Error('expected symlinkTranslated to throw on an existing path')
    } catch (err) {
      expect(err).not.toBeInstanceOf(ArbiterError)
      expect((err as NodeJS.ErrnoException).code).toBe('EEXIST')
    }
  })

  it('mkdtempTranslated returns a fresh directory, and translates a missing parent', () => {
    const made = mkdtempTranslated(join(dir, 'probe-'))
    expect(statSync(made).isDirectory()).toBe(true)
    expect(made.startsWith(join(dir, 'probe-'))).toBe(true)

    try {
      mkdtempTranslated(join(dir, 'no-such-dir', 'probe-'))
      throw new Error('expected mkdtempTranslated to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ArbiterError)
      expect((err as ArbiterError).code).toBe('ENOENT')
    }
  })

  it('createExclusiveTranslated writes content, and leaves EEXIST raw for the caller to branch on (#2294)', () => {
    const f = join(dir, 'lock.json')
    createExclusiveTranslated(f, '{"pid":1}')
    expect(readFileSync(f, 'utf-8')).toBe('{"pid":1}')

    // EEXIST is deliberately NOT translated: file-lock.ts branches on err.code === 'EEXIST'
    // to build a LockConflictError. A translated ArbiterError would kill that arm silently.
    try {
      createExclusiveTranslated(f, '{"pid":2}')
      throw new Error('expected createExclusiveTranslated to throw on an existing path')
    } catch (err) {
      expect(err).not.toBeInstanceOf(ArbiterError)
      expect((err as NodeJS.ErrnoException).code).toBe('EEXIST')
    }
    // The failed exclusive-create must not have clobbered the original content.
    expect(readFileSync(f, 'utf-8')).toBe('{"pid":1}')
  })

  it('createExclusiveTranslated translates a missing parent (ENOENT → ArbiterError)', () => {
    try {
      createExclusiveTranslated(join(dir, 'no-such-dir', 'lock.json'), '{}')
      throw new Error('expected createExclusiveTranslated to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ArbiterError)
      expect((err as ArbiterError).code).toBe('ENOENT')
    }
  })

  it('copyTreeTranslated copies a directory tree recursively, and translates a missing source (#2294)', () => {
    const src = join(dir, 'src')
    mkdirSync(join(src, 'nested'), { recursive: true })
    writeFileSync(join(src, 'a.txt'), 'a')
    writeFileSync(join(src, 'nested', 'b.txt'), 'b')

    const dest = join(dir, 'dest')
    copyTreeTranslated(src, dest, { recursive: true })
    expect(readFileSync(join(dest, 'a.txt'), 'utf-8')).toBe('a')
    expect(readFileSync(join(dest, 'nested', 'b.txt'), 'utf-8')).toBe('b')

    try {
      copyTreeTranslated(join(dir, 'no-such-src'), join(dir, 'x'), { recursive: true })
      throw new Error('expected copyTreeTranslated to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ArbiterError)
      expect((err as ArbiterError).code).toBe('ENOENT')
    }
  })
})

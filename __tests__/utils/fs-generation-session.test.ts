// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { writeFile, beginGenerationSession, endGenerationSession } from '../../src/utils/fs.js'

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

describe('fs generation session (#1328 hash-aware skipIfExists)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arb-gensess-'))
  })
  afterEach(() => {
    // always clear any lingering session so one test cannot leak into the next
    endGenerationSession()
    rmSync(dir, { recursive: true, force: true })
  })

  // ── #2295: absent file + recorded baseline = the consumer deleted what we emitted ──
  it('flags a re-emitted file as restored when a manifest baseline exists (#2295)', () => {
    const p = join(dir, 'scripts', 'check-all.mjs')
    beginGenerationSession({
      targetDir: dir,
      prevHashes: { 'scripts/check-all.mjs': sha('ARBITER-OLD-RENDER') },
    })
    const r = writeFile(p, 'RENDER')
    expect(r.action).toBe('created')
    expect(r.restored).toBe(true)
    expect(existsSync(p)).toBe(true)
    endGenerationSession()
  })

  it('does NOT flag a brand-new template with no baseline as restored (#2295 AC-3)', () => {
    const p = join(dir, 'scripts', 'brand-new.mjs')
    beginGenerationSession({ targetDir: dir, prevHashes: { 'other.mjs': sha('x') } })
    const r = writeFile(p, 'RENDER')
    expect(r.action).toBe('created')
    expect(r.restored).toBeUndefined()
    endGenerationSession()
  })

  it('does NOT flag a created file as restored with no active session (#2295)', () => {
    const r = writeFile(join(dir, 'no-session.txt'), 'RENDER')
    expect(r.action).toBe('created')
    expect(r.restored).toBeUndefined()
  })

  it('does NOT flag a path that escapes targetDir as restored (#2295)', () => {
    const outside = mkdtempSync(join(tmpdir(), 'arb-gensess-outside-'))
    try {
      beginGenerationSession({ targetDir: dir, prevHashes: { 'escaped.txt': sha('x') } })
      const r = writeFile(join(outside, 'escaped.txt'), 'RENDER')
      expect(r.action).toBe('created')
      expect(r.restored).toBeUndefined()
      endGenerationSession()
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('back-compat: no active session + skipIfExists + exists → skipped (legacy)', () => {
    const p = join(dir, 'f.txt')
    writeFileSync(p, 'OLD')
    const r = writeFile(p, 'NEW', { skipIfExists: true })
    expect(r.action).toBe('skipped')
    expect(readFileSync(p, 'utf-8')).toBe('OLD')
  })

  it('A4/propagate: session + skipIfExists + pristine (disk==prevHash) + differs → replaced', () => {
    const p = join(dir, 'scripts', 'check-all.mjs')
    // write the "old generated" content (mkdir handled by writeFile)
    const old = 'OLD-RENDER'
    writeFile(p, old) // creates
    beginGenerationSession({ targetDir: dir, prevHashes: { 'scripts/check-all.mjs': sha(old) } })
    const r = writeFile(p, 'NEW-RENDER', { skipIfExists: true })
    expect(r.action).toBe('replaced')
    expect(readFileSync(p, 'utf-8')).toBe('NEW-RENDER')
    endGenerationSession()
  })

  it('preserve: session + skipIfExists + user-modified (disk!=prevHash) + differs → skipped + warn', () => {
    const p = join(dir, 'hook.mjs')
    writeFileSync(p, 'USER-EDITED')
    const warn = vi.fn()
    // prevHash is for arbiter's OLD render, which differs from the user-edited disk content
    beginGenerationSession({
      targetDir: dir,
      prevHashes: { 'hook.mjs': sha('ARBITER-OLD-RENDER') },
      onWithheld: warn,
    })
    const r = writeFile(p, 'ARBITER-NEW-RENDER', { skipIfExists: true })
    expect(r.action).toBe('skipped')
    expect(readFileSync(p, 'utf-8')).toBe('USER-EDITED')
    expect(warn).toHaveBeenCalledOnce()
    endGenerationSession()
  })

  it('byte-identical under session → skipped (already current)', () => {
    const p = join(dir, 'same.txt')
    writeFile(p, 'SAME')
    beginGenerationSession({ targetDir: dir, prevHashes: { 'same.txt': sha('SAME') } })
    const r = writeFile(p, 'SAME', { skipIfExists: true })
    expect(r.action).toBe('skipped')
    endGenerationSession()
  })

  it('no-poison: a WITHHELD (user-modified) skip records NO baseline (stays withheld, never poisoned to the unwritten render)', () => {
    const p = join(dir, 'hook.mjs')
    writeFileSync(p, 'USER-EDITED')
    beginGenerationSession({
      targetDir: dir,
      prevHashes: { 'hook.mjs': sha('ARBITER-OLD') },
      onWithheld: () => {},
    })
    writeFile(p, 'ARBITER-NEW', { skipIfExists: true })
    const recorded = endGenerationSession()
    // Must NOT record sha('ARBITER-NEW') — disk still holds USER-EDITED.
    expect(recorded['hook.mjs']).toBeUndefined()
  })

  it('byte-identical skip records the on-disk baseline (so it is provenanced next run)', () => {
    const p = join(dir, 'same.txt')
    writeFile(p, 'SAME') // create outside session
    beginGenerationSession({ targetDir: dir, prevHashes: {} })
    writeFile(p, 'SAME', { skipIfExists: true })
    const recorded = endGenerationSession()
    expect(recorded['same.txt']).toBe(sha('SAME'))
  })

  it('A2/A6: a created file records its render hash in endGenerationSession()', () => {
    beginGenerationSession({ targetDir: dir, prevHashes: {} })
    writeFile(join(dir, 'new.txt'), 'CONTENT')
    const recorded = endGenerationSession()
    expect(recorded['new.txt']).toBe(sha('CONTENT'))
  })

  it('A2: a write whose atomicWrite throws records NO hash for that path', () => {
    // Make the parent a FILE so mkdir/rename throws ENOTDIR inside writeFile.
    writeFileSync(join(dir, 'blocker'), 'x')
    beginGenerationSession({ targetDir: dir, prevHashes: {} })
    expect(() => writeFile(join(dir, 'blocker', 'child.txt'), 'C')).toThrow()
    const recorded = endGenerationSession()
    expect(recorded['blocker/child.txt']).toBeUndefined()
  })

  it('A3: beginGenerationSession throws when a session is already active (#1531)', () => {
    beginGenerationSession({ targetDir: '/leaked/other', prevHashes: { x: sha('x') } })
    // A second begin while one is active means a missed `endGenerationSession`
    // (leaked finally) or an unsupported nested/concurrent generation. Fail loud
    // instead of silently clobbering the active session — the silent overwrite
    // could otherwise discard an in-flight manifest baseline (#1531).
    expect(() => beginGenerationSession({ targetDir: dir, prevHashes: {} })).toThrow(
      /already active/,
    )
    // The original session is untouched; the afterEach guard clears it.
  })

  it('A3b: sequential begin→end→begin in one process is allowed (#1531)', () => {
    beginGenerationSession({ targetDir: dir, prevHashes: {} })
    writeFile(join(dir, 'a.txt'), 'A')
    endGenerationSession()
    // A fresh session after a clean end must NOT throw — sequential reuse (tests,
    // batch) stays safe; only an unmatched begin is rejected.
    expect(() => beginGenerationSession({ targetDir: dir, prevHashes: {} })).not.toThrow()
    writeFile(join(dir, 'b.txt'), 'B')
    expect(endGenerationSession()['b.txt']).toBe(sha('B'))
  })

  it('dryRun records NO hash (diff must not record a baseline for content not written)', () => {
    beginGenerationSession({ targetDir: dir, prevHashes: {} })
    const r = writeFile(join(dir, 'ghost.txt'), 'GHOST', { dryRun: true })
    expect(r.action).toBe('created')
    expect(existsSync(join(dir, 'ghost.txt'))).toBe(false) // nothing written
    expect(endGenerationSession()['ghost.txt']).toBeUndefined() // nothing recorded
  })

  it('endGenerationSession with no active session returns empty and does not throw', () => {
    expect(endGenerationSession()).toEqual({})
  })

  describe('T1: force-adopt (adoptPredicate/onAdopt)', () => {
    it('the predicate sees provenanceKnown and decides unknown-provenance files (false → withheld, #2220)', () => {
      const p = join(dir, '.claude', 'hooks', 'unknown-hook.mjs')
      writeFile(p, '// user file\n')
      // Domain policy: informative classes stay provenance-gated. A predicate
      // that only adopts provenance-known files leaves this one withheld.
      const adoptPredicate = (key: string, provenanceKnown: boolean): boolean => provenanceKnown
      beginGenerationSession({
        targetDir: dir,
        prevHashes: {},
        adoptPredicate,
      })

      try {
        const result = writeFile(p, '// template render\n', { skipIfExists: true })
        expect(result.action).toBe('skipped')
        expect(result.withheld).toBe(true)
        expect(result.adopted).not.toBe(true)
        expect(readFileSync(p, 'utf-8')).toBe('// user file\n')
      } finally {
        endGenerationSession()
      }
    })

    it('a safety-class policy adopts unknown-provenance hooks by default (contract, noAdoptSafety)', () => {
      const p = join(dir, '.claude', 'hooks', 'stop-dangerous.mjs')
      mkdirSync(join(dir, '.claude', 'hooks'), { recursive: true })
      writeFileSync(p, '// user file\n')
      const onAdopt = vi.fn()
      beginGenerationSession({
        targetDir: dir,
        prevHashes: {},
        adoptPredicate: () => true,
        onAdopt,
      })

      try {
        const result = writeFile(p, '// template render\n', { skipIfExists: true })
        expect(result.action).toBe('replaced')
        expect(result.withheld).toBe(true)
        expect(result.adopted).toBe(true)
        expect(readFileSync(p, 'utf-8')).toBe('// template render\n')
        expect(onAdopt).toHaveBeenCalled()
      } finally {
        endGenerationSession()
      }
    })

    it('adoptPredicate matches → force-writes over user-modified content (adopted:true)', () => {
      const p = join(dir, 'hook.mjs')
      writeFileSync(p, 'USER-EDITED')
      const onAdopt = vi.fn()
      beginGenerationSession({
        targetDir: dir,
        prevHashes: { 'hook.mjs': sha('ARBITER-OLD-RENDER') },
        adoptPredicate: () => true,
        onAdopt,
      })
      const r = writeFile(p, 'ARBITER-NEW-RENDER', { skipIfExists: true })
      expect(r.action).toBe('replaced')
      expect(r.withheld).toBe(true)
      expect(r.adopted).toBe(true)
      expect(readFileSync(p, 'utf-8')).toBe('ARBITER-NEW-RENDER')
      expect(onAdopt).toHaveBeenCalledWith('hook.mjs', 'USER-EDITED', 'ARBITER-NEW-RENDER')
      endGenerationSession()
    })

    it('adoptPredicate returns false → falls back to the normal withheld/preserve path', () => {
      const p = join(dir, 'hook.mjs')
      writeFileSync(p, 'USER-EDITED')
      const onAdopt = vi.fn()
      const warn = vi.fn()
      beginGenerationSession({
        targetDir: dir,
        prevHashes: { 'hook.mjs': sha('ARBITER-OLD-RENDER') },
        adoptPredicate: () => false,
        onAdopt,
        onWithheld: warn,
      })
      const r = writeFile(p, 'ARBITER-NEW-RENDER', { skipIfExists: true })
      expect(r.action).toBe('skipped')
      expect(r.adopted).toBeUndefined()
      expect(readFileSync(p, 'utf-8')).toBe('USER-EDITED')
      expect(onAdopt).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledOnce()
      endGenerationSession()
    })

    it('force-adopt re-baselines the manifest hash to the newly-adopted content', () => {
      const p = join(dir, 'hook.mjs')
      writeFileSync(p, 'USER-EDITED')
      beginGenerationSession({
        targetDir: dir,
        prevHashes: { 'hook.mjs': sha('ARBITER-OLD-RENDER') },
        adoptPredicate: () => true,
      })
      writeFile(p, 'ARBITER-NEW-RENDER', { skipIfExists: true })
      const recorded = endGenerationSession()
      expect(recorded['hook.mjs']).toBe(sha('ARBITER-NEW-RENDER'))
    })

    it('adoptPredicate never fires on a pristine file (no adoption needed, no false onAdopt)', () => {
      const p = join(dir, 'scripts', 'check-all.mjs')
      writeFile(p, 'OLD-RENDER')
      const onAdopt = vi.fn()
      beginGenerationSession({
        targetDir: dir,
        prevHashes: { 'scripts/check-all.mjs': sha('OLD-RENDER') },
        adoptPredicate: () => true,
        onAdopt,
      })
      const r = writeFile(p, 'NEW-RENDER', { skipIfExists: true })
      expect(r.action).toBe('replaced')
      expect(r.adopted).toBeUndefined() // pristine propagation, not an adoption
      expect(onAdopt).not.toHaveBeenCalled()
      endGenerationSession()
    })

    it('dryRun + adopt: classifies as adopted but writes nothing (plan mode)', () => {
      const p = join(dir, 'hook.mjs')
      writeFileSync(p, 'USER-EDITED')
      const onAdopt = vi.fn()
      beginGenerationSession({
        targetDir: dir,
        prevHashes: { 'hook.mjs': sha('ARBITER-OLD-RENDER') },
        adoptPredicate: () => true,
        onAdopt,
      })
      const r = writeFile(p, 'ARBITER-NEW-RENDER', { skipIfExists: true, dryRun: true })
      expect(r.adopted).toBe(true)
      expect(readFileSync(p, 'utf-8')).toBe('USER-EDITED') // untouched
      expect(onAdopt).toHaveBeenCalledOnce() // still reported, for the plan preview
      endGenerationSession()
    })
  })
})

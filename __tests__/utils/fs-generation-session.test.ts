// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
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

  it('A3: beginGenerationSession defensively resets a leaked prior session', () => {
    beginGenerationSession({ targetDir: '/leaked/other', prevHashes: { x: sha('x') } })
    // no endGenerationSession — simulate a leak, then a new command begins
    beginGenerationSession({ targetDir: dir, prevHashes: {} })
    writeFile(join(dir, 'fresh.txt'), 'FRESH')
    const recorded = endGenerationSession()
    expect(recorded['fresh.txt']).toBe(sha('FRESH'))
    expect(recorded['x']).toBeUndefined()
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
})

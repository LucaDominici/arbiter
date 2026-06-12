// SPDX-License-Identifier: Apache-2.0
// #1328 integration: `arbiter update` propagates template fixes to pristine
// (unmodified-since-generation) skipIfExists files, preserves user-modified ones,
// and `arbiter diff` reports the pristine-stale file as changed (no longer lies).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { runInit } from '../../src/commands/init.js'
import { runUpdate } from '../../src/commands/update.js'
import { runDiff } from '../../src/commands/diff.js'
import { loadGeneratedManifest, saveGeneratedManifest } from '../../src/state/generated-manifest.js'

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

// Two files emitted with skipIfExists by an L2 init (verified present).
const PRISTINE = '.githooks/pre-push' // will be made pristine-stale → must propagate
const USERMOD = 'scripts/check-collab-mode-wired.mjs' // user-modified → must be preserved

function initGit(dir: string): void {
  for (const args of [
    ['init'],
    ['config', 'user.email', 'test@test.com'],
    ['config', 'user.name', 'Test'],
  ]) {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  }
}

describe('#1328 update propagates template fixes', () => {
  let dir: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'arb-1328-'))
    initGit(dir)
    await runInit({ yes: true, tools: 'claude', level: 'L2', dir, noVerify: true })
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('init writes a generated-manifest with a baseline for skipIfExists files', () => {
    const manifest = loadGeneratedManifest(dir)
    expect(manifest[PRISTINE]).toBeDefined()
    expect(manifest[USERMOD]).toBeDefined()
    // The baseline equals the hash of what is actually on disk (pristine after init).
    expect(manifest[PRISTINE]).toBe(sha(readFileSync(join(dir, PRISTINE), 'utf-8')))
  })

  it('AC1+AC2: rewrites a pristine-stale skipIfExists file, preserves a user-modified one', async () => {
    const fPath = join(dir, PRISTINE)
    const gPath = join(dir, USERMOD)
    const origF = readFileSync(fPath, 'utf-8')

    const manifest = loadGeneratedManifest(dir)
    // F: make disk differ from the current render but mark it pristine in the
    // manifest (disk hash == recorded baseline) → arbiter owns it → must rewrite.
    writeFileSync(fPath, 'STALE-GENERATED-CONTENT')
    manifest[PRISTINE] = sha('STALE-GENERATED-CONTENT')
    // G: user-modified — disk differs from the original baseline (left untouched).
    writeFileSync(gPath, '// USER EDIT — do not clobber\n')
    saveGeneratedManifest(dir, manifest)

    await runUpdate({ dir, github: false })

    // AC1: the pristine-stale file was rewritten to the current template render.
    expect(readFileSync(fPath, 'utf-8')).toBe(origF)
    expect(readFileSync(fPath, 'utf-8')).not.toBe('STALE-GENERATED-CONTENT')
    // AC2: the user-modified file was preserved.
    expect(readFileSync(gPath, 'utf-8')).toBe('// USER EDIT — do not clobber\n')

    // The manifest now records the freshly-written render for the propagated file.
    const after = loadGeneratedManifest(dir)
    expect(after[PRISTINE]).toBe(sha(origF))
  })

  it('A1: update never records arbiter.json / .arbiter-generated.json as manifest keys', async () => {
    await runUpdate({ dir, github: false })
    const manifest = loadGeneratedManifest(dir)
    expect(manifest['arbiter.json']).toBeUndefined()
    expect(manifest['.arbiter-generated.json']).toBeUndefined()
    expect(manifest['.arbiter-generated-manifest.json']).toBeUndefined()
  })

  it('AC3: diff reports a pristine-stale skipIfExists file as changed (no longer lies)', () => {
    const fPath = join(dir, PRISTINE)
    const manifest = loadGeneratedManifest(dir)
    writeFileSync(fPath, 'STALE-GENERATED-CONTENT')
    manifest[PRISTINE] = sha('STALE-GENERATED-CONTENT')
    saveGeneratedManifest(dir, manifest)

    const writes: string[] = []
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((s: unknown) => {
      writes.push(String(s))
      return true
    })
    try {
      runDiff({ dir, json: true })
    } finally {
      outSpy.mockRestore()
      exitSpy.mockRestore()
    }
    const payload = writes.find((w) => w.includes('"files"')) ?? '{}'
    const json = JSON.parse(payload) as {
      data?: { files?: { path: string; status: string }[] }
    }
    const entry = json.data?.files?.find((f) => f.path === PRISTINE)
    expect(entry?.status).toBe('changed')
  })
})

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
import {
  loadGeneratedManifest,
  saveGeneratedManifest,
  loadUnwiredGuards,
} from '../../src/state/generated-manifest.js'

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

// #1344: the visibility path. A user-modified skipIfExists file whose template
// render changed is a WITHHELD fix — diff/update must surface it distinctly, not
// silently collapse it into "unchanged".
describe('#1344 withheld template-fix visibility', () => {
  let dir: string

  function runDiffJson(opts: { withheld?: boolean }): {
    files?: { path: string; status: string }[]
    withheldCount?: number
    hasChanges?: boolean
  } {
    const writes: string[] = []
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((s: unknown) => {
      writes.push(String(s))
      return true
    })
    try {
      runDiff({ dir, json: true, ...(opts.withheld ? { withheld: true } : {}) })
    } finally {
      outSpy.mockRestore()
      exitSpy.mockRestore()
    }
    const payload = writes.find((w) => w.includes('"files"')) ?? '{}'
    const json = JSON.parse(payload) as {
      data?: {
        files?: { path: string; status: string }[]
        withheldCount?: number
        hasChanges?: boolean
      }
    }
    return json.data ?? {}
  }

  function makeWithheld(): void {
    // USERMOD is on disk with a baseline; user edits it so disk ≠ baseline AND
    // disk ≠ current render → the fix is withheld.
    const manifest = loadGeneratedManifest(dir)
    expect(manifest[USERMOD]).toBeDefined()
    writeFileSync(join(dir, USERMOD), '// USER EDIT — withholds the template fix\n')
    saveGeneratedManifest(dir, manifest)
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'arb-1344-'))
    initGit(dir)
    await runInit({ yes: true, tools: 'claude', level: 'L2', dir, noVerify: true })
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('AC1+AC2: diff reports a user-modified skipIfExists file as withheld (not unchanged)', () => {
    makeWithheld()
    const data = runDiffJson({})
    const entry = data.files?.find((f) => f.path === USERMOD)
    expect(entry?.status).toBe('withheld')
    expect(data.withheldCount).toBeGreaterThanOrEqual(1)
  })

  it('AC3: diff --withheld filters output to only withheld entries', () => {
    makeWithheld()
    const data = runDiffJson({ withheld: true })
    expect(data.files?.length).toBeGreaterThanOrEqual(1)
    expect(data.files?.every((f) => f.status === 'withheld')).toBe(true)
    expect(data.files?.some((f) => f.path === USERMOD)).toBe(true)
  })

  it('AC5: a pristine (unmodified) project reports zero withheld files (no false positive)', () => {
    const data = runDiffJson({})
    expect(data.withheldCount ?? 0).toBe(0)
    expect(data.files?.some((f) => f.status === 'withheld')).toBe(false)
  })

  it('a withheld fix is reported via withheldCount, surfacing the visible drift', () => {
    // The write-only `hasChanges`/idempotence contract (a withheld file is
    // preserved, not written, so it must not flip hasChanges) is locked
    // deterministically in the diff unit test; here we assert end-to-end that the
    // withheld file is counted as drift even though it is preserved on disk.
    makeWithheld()
    const data = runDiffJson({})
    const entry = data.files?.find((f) => f.path === USERMOD)
    expect(entry?.status).toBe('withheld')
    expect(data.withheldCount).toBeGreaterThanOrEqual(1)
  })

  it('AC4: update summary counts withheld files', async () => {
    makeWithheld()
    const writes: string[] = []
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((s: unknown) => {
      writes.push(String(s))
      return true
    })
    try {
      await runUpdate({ dir, github: false })
    } finally {
      outSpy.mockRestore()
    }
    const done = writes.find((w) => w.includes('withheld')) ?? ''
    expect(done).toMatch(/[1-9]\d* withheld/)
  })
})

// #1504 (M1): when check-all.mjs is WITHHELD and a guard script lands fresh (the
// anti-fake-green rollout footgun), the manifest must NOT silently claim that guard
// as delivered protection — it records it in an honest shipped-but-unwired section.
describe('#1504 manifest honesty for withheld-gate guards', () => {
  let dir: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'arb-1504-'))
    initGit(dir)
    await runInit({ yes: true, tools: 'claude', level: 'L2', dir, noVerify: true })
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('does NOT mark a freshly-landed guard as fully delivered when check-all is withheld', async () => {
    const manifest = loadGeneratedManifest(dir)
    // Pick a real guard script emitted by init (NOT check-all itself).
    const guardKey = Object.keys(manifest).find(
      (k) => /^scripts\/check-[^/]+\.mjs$/.test(k) && k !== 'scripts/check-all.mjs',
    )
    expect(guardKey).toBeDefined()
    if (!guardKey) return

    // Simulate the rollout footgun: the guard is ABSENT (predates this arbiter), so
    // `update` re-creates it = newly landed; meanwhile check-all.mjs is user-modified
    // so the template fix that wires the guard is withheld.
    rmSync(join(dir, guardKey))
    const withoutGuard = Object.fromEntries(
      Object.entries(manifest).filter(([k]) => k !== guardKey),
    )
    writeFileSync(join(dir, 'scripts', 'check-all.mjs'), '// USER EDIT — diverged gate\n')
    saveGeneratedManifest(dir, withoutGuard)

    // The unwired-gate warning fires here → update exits with the warning code (1);
    // swallow it so we can assert the manifest the run persisted before exiting.
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    try {
      await runUpdate({ dir, github: false })
    } finally {
      exitSpy.mockRestore()
    }

    // Honest status: the re-created guard is flagged shipped-but-unwired, NOT a
    // silent "delivered" file the project's manifest claims as live protection.
    const unwired = loadUnwiredGuards(dir)
    expect(unwired).toContain(guardKey)
    // The guard is still tracked in `files` (hash provenance for future fixes)…
    expect(loadGeneratedManifest(dir)[guardKey]).toBeDefined()
  })

  it('records NO unwired section on a clean update (check-all not withheld)', async () => {
    await runUpdate({ dir, github: false })
    expect(loadUnwiredGuards(dir)).toEqual([])
  })
})

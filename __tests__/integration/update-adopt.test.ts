// SPDX-License-Identifier: Apache-2.0
// T1 (convergence playbook, decisive red-path proof): a safety-class hook
// (`.claude/hooks/stop-dangerous.mjs`) that is user-modified (withheld) used to
// stay silently frozen forever — the erosion case (LAST-CHANCE §"the wound").
// This suite proves: (1) the erosion IS caught — the ratchet gate fails while
// the hook is withheld; (2) `update` (default, no flags) ADOPTS the fix,
// clearing the ratchet and preserving the prior content in a reversible
// local-override record; (3) `--no-adopt-safety` is the only way to keep it
// frozen, and doing so is what makes the ratchet fail — never a silent skip.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync, execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInit } from '../../src/commands/init.js'
import { runUpdate } from '../../src/commands/update.js'
import {
  loadGeneratedManifest,
  saveGeneratedManifest,
  loadWithheldSafety,
} from '../../src/state/generated-manifest.js'

const HOOK = '.claude/hooks/stop-dangerous.mjs'

function initGit(dir: string): void {
  for (const args of [
    ['init'],
    ['config', 'user.email', 'test@test.com'],
    ['config', 'user.name', 'Test'],
  ]) {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  }
}

/** Erode the hook: disk holds user-edited content, manifest baseline still
 * points at arbiter's OLD render → disk != baseline → withheld on next update. */
function erodeHook(dir: string): string {
  const manifest = loadGeneratedManifest(dir)
  expect(manifest[HOOK]).toBeDefined()
  const userContent = '// USER EDIT — this hook was hand-patched, do not clobber\n'
  writeFileSync(join(dir, HOOK), userContent)
  saveGeneratedManifest(dir, manifest)
  return userContent
}

/** Run the RATCHET SCRIPT AS EMITTED into the target project (not arbiter's own
 * source template) — this is what an actual consumer repo's gate would invoke. */
function runRatchet(dir: string): { status: number | null; stdout: string; stderr: string } {
  const script = join(dir, 'scripts', 'check-safety-adopt-ratchet.mjs')
  const r = spawnSync('node', [script], { cwd: dir, encoding: 'utf-8' })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

describe('T1 red-path: safety-class hook erosion is caught (not silent)', () => {
  let dir: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'arb-t1-adopt-'))
    initGit(dir)
    await runInit({ yes: true, tools: 'claude', level: 'L2', dir, noVerify: true })
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('sanity: init emits the safety-class hook AND the ratchet gate, and the gate starts green', () => {
    expect(existsSync(join(dir, HOOK))).toBe(true)
    expect(existsSync(join(dir, 'scripts/check-safety-adopt-ratchet.mjs'))).toBe(true)
    const ratchet = runRatchet(dir)
    expect(ratchet.status).toBe(0)
  })

  it('erosion caught: --no-adopt-safety keeps the hook frozen AND the ratchet FAILS', async () => {
    const userContent = erodeHook(dir)

    await runUpdate({ dir, github: false, noAdoptSafety: true })

    // The hook stays exactly as the user left it (adoption explicitly disabled).
    expect(readFileSync(join(dir, HOOK), 'utf-8')).toBe(userContent)

    // The manifest's honest withheldSafety section is non-empty — erosion is
    // recorded, not silently dropped.
    const withheld = loadWithheldSafety(dir)
    expect(withheld).toContain(HOOK)

    // The ratchet gate FAILS — this is the decisive proof: erosion is now
    // caught mechanically, not just documented.
    const ratchet = runRatchet(dir)
    expect(ratchet.status).toBe(1)
    expect(ratchet.stderr).toContain(HOOK)
    expect(ratchet.stderr.toLowerCase()).toContain('erosion')
  })

  it('erosion fixed: default `update` (no flags) ADOPTS the fix and the ratchet turns GREEN', async () => {
    const userContent = erodeHook(dir)

    await runUpdate({ dir, github: false }) // default: adoptSafety is on

    // The template fix LANDED over the user-modified content.
    const onDisk = readFileSync(join(dir, HOOK), 'utf-8')
    expect(onDisk).not.toBe(userContent)
    expect(onDisk).not.toContain('USER EDIT')

    // The manifest's withheldSafety section is empty again — no more erosion.
    expect(loadWithheldSafety(dir)).toEqual([])

    // The ratchet gate is GREEN.
    const ratchet = runRatchet(dir)
    expect(ratchet.status).toBe(0)

    // A reversible local-override record was written BEFORE the prior content
    // was lost — the adoption is not a silent discard.
    const overridesDir = join(dir, '.arbiter/evidence/local-overrides')
    expect(existsSync(overridesDir)).toBe(true)
    const files = readdirSync(overridesDir)
    expect(files.length).toBeGreaterThanOrEqual(1)
    const record = JSON.parse(readFileSync(join(overridesDir, files[0] as string), 'utf-8')) as {
      path: string
      priorContent: string
      newContent: string
    }
    expect(record.path).toBe(HOOK)
    expect(record.priorContent).toBe(userContent)
    expect(record.newContent).toBe(onDisk)
  })

  it('re-running update after adoption is a no-op (pristine again — idempotent)', async () => {
    erodeHook(dir)
    await runUpdate({ dir, github: false })
    const adopted = readFileSync(join(dir, HOOK), 'utf-8')

    await runUpdate({ dir, github: false })
    expect(readFileSync(join(dir, HOOK), 'utf-8')).toBe(adopted)
    expect(loadWithheldSafety(dir)).toEqual([])
  })

  it('--adopt-plan previews the adoption WITHOUT writing anything (two-phase plan/apply)', async () => {
    const userContent = erodeHook(dir)

    const writes: string[] = []
    const spy = (s: unknown): boolean => {
      writes.push(String(s))
      return true
    }
    const origWrite = process.stdout.write.bind(process.stdout)
    process.stdout.write = spy as typeof process.stdout.write
    try {
      await runUpdate({ dir, github: false, adoptPlan: true })
    } finally {
      process.stdout.write = origWrite
    }

    // Nothing was written — the user-modified content is untouched.
    expect(readFileSync(join(dir, HOOK), 'utf-8')).toBe(userContent)
    // No manifest mutation, no config write, no local-override record.
    expect(existsSync(join(dir, '.arbiter/evidence/local-overrides'))).toBe(false)
    // The plan output names the file.
    expect(writes.some((w) => w.includes(HOOK))).toBe(true)
  })

  it('--adopt broadens adoption to a non-safety-class withheld file too', async () => {
    const USERMOD = 'scripts/check-collab-mode-wired.mjs'
    const manifest = loadGeneratedManifest(dir)
    expect(manifest[USERMOD]).toBeDefined()
    const userContent = '// USER EDIT — non-safety-class withheld file\n'
    writeFileSync(join(dir, USERMOD), userContent)
    saveGeneratedManifest(dir, manifest)

    // Default (safety-class only) must NOT adopt this non-safety file.
    await runUpdate({ dir, github: false })
    expect(readFileSync(join(dir, USERMOD), 'utf-8')).toBe(userContent)

    // --adopt broadens adoption to it.
    await runUpdate({ dir, github: false, adopt: true })
    expect(readFileSync(join(dir, USERMOD), 'utf-8')).not.toBe(userContent)
  })
})

// SPDX-License-Identifier: Apache-2.0
// T1 (convergence playbook, decisive red-path proof): a safety-class hook
// (`.claude/hooks/stop-dangerous.mjs`) that is user-modified (withheld) used to
// stay silently frozen forever — the erosion case (LAST-CHANCE §"the wound").
// This suite proves: (1) the erosion IS caught — the ratchet gate fails while
// the hook is withheld; (2) `update` (default, no flags) ADOPTS the fix,
// clearing the ratchet and preserving the prior content in a reversible
// local-override record; (3) `--no-adopt-safety` is the only way to keep it
// frozen, and doing so is what makes the ratchet fail — never a silent skip.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

// #2109 — the same red path for the GATE SPINE. The safety class above covers
// `.claude/hooks/*.mjs`; `scripts/check-all.mjs` and `scripts/lib/*.mjs` were
// left out of it, and they are the delivery vector for every check arbiter
// ships later — including the wiring of the ratchet that is supposed to catch
// this exact erosion. Frozen spine = self-sealing erosion.
describe('#2109 red-path: gate-spine erosion is caught (not silent)', () => {
  let dir: string

  const SPINE = 'scripts/check-all.mjs'
  const SPINE_LIB = 'scripts/lib/glob-walk.mjs'

  /** Same erosion shape as erodeHook, for an arbitrary tracked key. */
  function erode(target: string, marker: string): string {
    const manifest = loadGeneratedManifest(dir)
    expect(manifest[target]).toBeDefined()
    const userContent = `// USER EDIT — ${marker}\n`
    writeFileSync(join(dir, target), userContent)
    saveGeneratedManifest(dir, manifest)
    return userContent
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'arb-2109-spine-'))
    initGit(dir)
    await runInit({ yes: true, tools: 'claude', level: 'L2', dir, noVerify: true })
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('sanity: init emits the gate spine and its libs', () => {
    expect(existsSync(join(dir, SPINE))).toBe(true)
    expect(existsSync(join(dir, SPINE_LIB))).toBe(true)
  })

  it('the gate entrypoint is ADOPTED by default — a correctness fix reaches a touched project', async () => {
    const userContent = erode(SPINE, 'hand-tuned gate entrypoint')

    await runUpdate({ dir, github: false })

    const onDisk = readFileSync(join(dir, SPINE), 'utf-8')
    expect(onDisk).not.toBe(userContent)
    expect(onDisk).not.toContain('USER EDIT')
    expect(loadWithheldSafety(dir)).toEqual([])
    expect(runRatchet(dir).status).toBe(0)
  })

  it('a scripts/lib helper is adopted too — monotonic by directory', async () => {
    const userContent = erode(SPINE_LIB, 'hand-tuned walker')
    await runUpdate({ dir, github: false })
    expect(readFileSync(join(dir, SPINE_LIB), 'utf-8')).not.toBe(userContent)
  })

  it('the prior content survives in a reversible local-override record', async () => {
    const userContent = erode(SPINE, 'hand-tuned gate entrypoint')
    await runUpdate({ dir, github: false })

    const overridesDir = join(dir, '.arbiter/evidence/local-overrides')
    const files = readdirSync(overridesDir)
    const record = JSON.parse(readFileSync(join(overridesDir, files[0] as string), 'utf-8')) as {
      path: string
      priorContent: string
      reason: string
    }
    expect(record.path).toBe(SPINE)
    expect(record.priorContent).toBe(userContent)
    expect(record.reason).toContain('#2109')
  })

  it('--no-adopt-gate-spine freezes it AND the ratchet FAILS — never a silent skip', async () => {
    const userContent = erode(SPINE, 'hand-tuned gate entrypoint')

    await runUpdate({ dir, github: false, noAdoptGateSpine: true })

    expect(readFileSync(join(dir, SPINE), 'utf-8')).toBe(userContent)
    expect(loadWithheldSafety(dir)).toContain(SPINE)

    const ratchet = runRatchet(dir)
    expect(ratchet.status).toBe(1)
    expect(ratchet.stderr).toContain(SPINE)
  })

  it('the two opt-outs are independent: freezing the spine leaves safety hooks adopted', async () => {
    const spineContent = erode(SPINE, 'hand-tuned gate entrypoint')
    const hookContent = erode(HOOK, 'hand-patched safety hook')

    await runUpdate({ dir, github: false, noAdoptGateSpine: true })

    expect(readFileSync(join(dir, SPINE), 'utf-8')).toBe(spineContent)
    expect(readFileSync(join(dir, HOOK), 'utf-8')).not.toBe(hookContent)
  })

  it('a leaf check script is NOT in the class — a project keeps its own thresholds', async () => {
    const LEAF = 'scripts/check-collab-mode-wired.mjs'
    const userContent = erode(LEAF, 'project-tuned leaf check')
    await runUpdate({ dir, github: false })
    expect(readFileSync(join(dir, LEAF), 'utf-8')).toBe(userContent)
  })
})

// #2120: `update` has three write channels and `--adopt-plan` showed one. The
// adopt channel (`skipIfExists` + diverged + policy match) was the only thing
// `printAdoptPlan` could see, because `runAdoptPlan` discarded the WriteResult[]
// that already held the prospective action for every other file. An always-
// rewrite file (`skipIfExists: false`) carrying a local fix was therefore
// clobbered by a run whose own preview never named it.
describe('#2120: --adopt-plan previews the regeneration channel, not only the adopt one', () => {
  let dir: string
  // Emitted with `skipIfExists: false, backup: true` (generators/debt-ratchet.ts)
  // — the always-rewrite class, invisible to the plan before this fix.
  const ALWAYS_REWRITE = 'scripts/debt-lib.mjs'

  function captureStdout(): { text: () => string; restore: () => void } {
    let buf = ''
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((chunk: string | Uint8Array): boolean => {
        buf += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8')
        return true
      })
    return { text: (): string => buf, restore: (): void => spy.mockRestore() }
  }

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'arb-2120-plan-'))
    initGit(dir)
    await runInit({ yes: true, tools: 'claude', level: 'L2', dir, noVerify: true })
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('names an always-rewrite file whose local edit the run would overwrite', async () => {
    writeFileSync(join(dir, ALWAYS_REWRITE), '// local edit\n')

    const out = captureStdout()
    try {
      await runUpdate({ dir, github: false, adoptPlan: true })
    } finally {
      out.restore()
    }

    expect(out.text()).toContain(ALWAYS_REWRITE)
    // Still read-only: the plan must not have written anything.
    expect(readFileSync(join(dir, ALWAYS_REWRITE), 'utf-8')).toBe('// local edit\n')
  })

  it('--json carries the same set as the text output (no channel disagrees)', async () => {
    writeFileSync(join(dir, ALWAYS_REWRITE), '// local edit\n')

    const out = captureStdout()
    try {
      await runUpdate({ dir, github: false, adoptPlan: true, json: true })
    } finally {
      out.restore()
    }

    const payload = JSON.parse(out.text()) as {
      data: { wouldRegenerate?: string[]; withheld?: string[] }
    }
    expect([...(payload.data.wouldRegenerate ?? []), ...(payload.data.withheld ?? [])]).toContain(
      ALWAYS_REWRITE,
    )
  })
})

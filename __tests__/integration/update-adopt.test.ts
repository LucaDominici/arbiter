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
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInit as runInitCommand } from '../../src/commands/init.js'
import { runUpdate } from '../../src/commands/update.js'
import {
  loadGeneratedManifest,
  saveGeneratedManifest,
  loadWithheldSafety,
} from '../../src/state/generated-manifest.js'

const HOOK = '.claude/hooks/stop-dangerous.mjs'
/** arbiter's own repo root — the CLI is spawned from source via tsx (no build step). */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function initGit(dir: string): void {
  for (const args of [
    ['init'],
    ['config', 'user.email', 'test@test.com'],
    ['config', 'user.name', 'Test'],
  ]) {
    execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  }
}

function runInit(options: Parameters<typeof runInitCommand>[0]) {
  return runInitCommand({ ...options, language: 'typescript' })
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

// #2119 — the gate spine is WITHHELD by default, reversing #2109. #2109 read
// `scripts/check-all.mjs` as a container arbiter owns; it is not. That file is
// by construction the point where a project wires its OWN checks, so adopting
// it deletes content instead of restoring a fix (measured on a real governed
// consumer: 25 project checks erased, 12 of them security, by a BARE
// `arbiter update`). The erosion class stays real for `.claude/hooks/*.mjs`,
// which arbiter owns whole; for the spine, the honest answer is to withhold and
// keep saying so — the ratchet's red is the debt register, and the documented
// exception it must accept is the `arbiter:preserve` marker.
describe('#2119 red-path: the gate spine is withheld, and the ratchet cycle terminates', () => {
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

  // R1 — the measured defect: a BARE `arbiter update` must not rewrite the file
  // in which a project wires its own checks.
  it('the gate entrypoint is WITHHELD by default — a project keeps its own checks', async () => {
    const userContent = erode(SPINE, 'hand-tuned gate entrypoint')

    await runUpdate({ dir, github: false }) // BARE — no flags at all

    expect(readFileSync(join(dir, SPINE), 'utf-8')).toBe(userContent)
  })

  // R2 — the ratchet cycle must TERMINATE. Today the gate demands in writing "a
  // documented, dated exception" and then refuses the only one that exists.
  it('a preserve-marked spine is the documented exception the ratchet ACCEPTS', async () => {
    writeFileSync(
      join(dir, SPINE),
      '// arbiter:preserve — project-owned gate entrypoint\n// USER EDIT\n',
    )

    await runUpdate({ dir, github: false })

    expect(readFileSync(join(dir, SPINE), 'utf-8')).toContain('USER EDIT')
    expect(runRatchet(dir).status).toBe(0)
  })

  // R3 — the prescription must never point at the command that erases the
  // project's checks. Weaker than R1/R2 on purpose: a negative assertion.
  it('never prescribes a bare `arbiter update` for a withheld spine', async () => {
    erode(SPINE, 'hand-tuned gate entrypoint')

    await runUpdate({ dir, github: false })

    const r = runRatchet(dir)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain(SPINE)
    expect(r.stderr).not.toMatch(/Run `arbiter update` \(both classes adopt by\s+default\)/)
  })

  it('a scripts/lib helper follows the same policy — monotonic by directory', async () => {
    const userContent = erode(SPINE_LIB, 'hand-tuned walker')

    await runUpdate({ dir, github: false })
    expect(readFileSync(join(dir, SPINE_LIB), 'utf-8')).toBe(userContent)

    await runUpdate({ dir, github: false, adoptGateSpine: true })
    expect(readFileSync(join(dir, SPINE_LIB), 'utf-8')).not.toBe(userContent)
  })

  it('N4 — under --adopt-gate-spine the prior content survives in a reversible record', async () => {
    const userContent = erode(SPINE, 'hand-tuned gate entrypoint')
    await runUpdate({ dir, github: false, adoptGateSpine: true })

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

  /** Run the real CLI from source (no build step) — the layer where the DEFAULT lives. */
  function runCli(...args: string[]): { status: number | null; stdout: string; stderr: string } {
    const r = spawnSync(
      process.execPath,
      ['--import', 'tsx/esm', join(REPO_ROOT, 'src/cli.ts'), 'update', '--dir', dir, ...args],
      { cwd: REPO_ROOT, encoding: 'utf-8' },
    )
    return { status: r.status, stdout: r.stdout, stderr: r.stderr }
  }

  // The defect #2119 fixes is a wrong DEFAULT, and a default lives in commander,
  // not in runUpdate's options object. Every other test here passes the option
  // explicitly, so none of them would catch the two ways this silently reverts:
  // reordering the `--adopt-gate-spine` / `--no-adopt-gate-spine` pair (commander
  // then defaults it to true), or mistyping the cli.ts → runUpdate mapping.
  it('the CLI default is WITHHOLD — a bare `arbiter update` leaves the spine alone', () => {
    const userContent = erode(SPINE, 'hand-tuned gate entrypoint')

    const r = runCli()

    expect(r.status).toBe(0)
    expect(readFileSync(join(dir, SPINE), 'utf-8')).toBe(userContent)
  })

  it('the CLI opt-in reaches the predicate — `--adopt-gate-spine` does overwrite', () => {
    const userContent = erode(SPINE, 'hand-tuned gate entrypoint')

    const r = runCli('--adopt-gate-spine')

    expect(r.status).toBe(0)
    expect(readFileSync(join(dir, SPINE), 'utf-8')).not.toBe(userContent)
  })

  // #2119 cost 2: the flag stays ACCEPTED so a consumer's moratorium script
  // (`arbiter update --no-adopt-gate-spine`) does not start failing on an
  // unknown option the day the default catches up with it.
  it('`--no-adopt-gate-spine` is still accepted by the CLI — now a no-op', () => {
    const r = runCli('--adopt-plan', '--no-adopt-gate-spine')
    expect(r.stderr).not.toContain('unknown option')
    expect(r.status).toBe(0)
  })

  // #2141 mirrors #2119: its legacy negated spelling must be accepted without
  // cancelling the destructive opt-in, whichever order a consumer script uses.
  it('`--no-adopt-governance` is a no-op beside `--adopt-governance`, in either order', () => {
    for (const args of [
      ['--adopt-governance', '--no-adopt-governance'],
      ['--no-adopt-governance', '--adopt-governance'],
    ]) {
      const userContent = erode('AGENTS.md', 'hand-tuned governance contract')

      const r = runCli(...args)

      expect(r.status).toBe(0)
      expect(readFileSync(join(dir, 'AGENTS.md'), 'utf-8')).not.toBe(userContent)
    }
  })

  // #2453: a permanent no-op living outside the CLI_DEPRECATED_FLAGS registry is
  // silent harm — a consumer who passes it believes they withheld the spine
  // deliberately, and gets no signal that the flag does nothing on its own
  // (withholding is already the unconditional default). The flag stays a no-op
  // (behavior does NOT change — see the two tests above), but it must now emit
  // a real deprecation notice carrying a removal version, on the actual CLI
  // process, not merely a table row in docs/DEPRECATIONS.md.
  it('#2453: `--no-adopt-gate-spine` emits a stderr deprecation notice with a removal version', () => {
    erode(SPINE, 'hand-tuned gate entrypoint')

    const r = runCli('--adopt-plan', '--no-adopt-gate-spine')

    expect(r.status).toBe(0)
    expect(r.stderr.toLowerCase()).toContain('deprecated')
    expect(r.stderr).toContain('--no-adopt-gate-spine')
    // Must name an actual future version, not just the word "deprecated" —
    // otherwise this is theater with no enforceable removal window.
    expect(r.stderr).toMatch(/\b\d+\.\d+\.\d+\b/)
  })

  it('#2453: `--no-adopt-governance` emits a stderr deprecation notice with a removal version', () => {
    erode('AGENTS.md', 'hand-tuned governance contract')

    const r = runCli('--adopt-plan', '--no-adopt-governance')

    expect(r.status).toBe(0)
    expect(r.stderr.toLowerCase()).toContain('deprecated')
    expect(r.stderr).toContain('--no-adopt-governance')
    expect(r.stderr).toMatch(/\b\d+\.\d+\.\d+\b/)
  })

  // The deprecation notice must fire on its own — a consumer relying only on
  // the withhold-by-default behavior (no flag at all) gets no notice, because
  // there is nothing deprecated about calling `update` bare.
  it('#2453: a bare `update` (no legacy flag) emits no deprecation notice', () => {
    erode(SPINE, 'hand-tuned gate entrypoint')

    const r = runCli('--adopt-plan')

    expect(r.status).toBe(0)
    expect(r.stderr.toLowerCase()).not.toContain('deprecated')
  })

  // N1 — the confinement of the fix: a PRISTINE spine (untouched since arbiter
  // generated it) must still receive template fixes. Only a CUSTOMIZED one is
  // frozen. Re-baselining the manifest onto the local bytes is what makes this
  // non-vacuous: byte-identical content would never reach the provenance branch.
  it('N1 — a pristine-stale spine is still rewritten (only customization freezes it)', async () => {
    const pristineStale = '// pristine: matches the recorded baseline, not the current render\n'
    writeFileSync(join(dir, SPINE), pristineStale)
    const manifest = loadGeneratedManifest(dir)
    manifest[SPINE] = createHash('sha256').update(pristineStale).digest('hex')
    saveGeneratedManifest(dir, manifest)

    await runUpdate({ dir, github: false })

    expect(readFileSync(join(dir, SPINE), 'utf-8')).not.toBe(pristineStale)
    expect(loadWithheldSafety(dir)).toEqual([])
    expect(runRatchet(dir).status).toBe(0)
  })

  // N3 — the two classes point in OPPOSITE directions, with no flag at all.
  it('N3 — one bare update withholds the spine and still adopts a safety hook', async () => {
    const spineContent = erode(SPINE, 'hand-tuned gate entrypoint')
    const hookContent = erode(HOOK, 'hand-patched safety hook')

    await runUpdate({ dir, github: false })

    expect(readFileSync(join(dir, SPINE), 'utf-8')).toBe(spineContent)
    expect(readFileSync(join(dir, HOOK), 'utf-8')).not.toBe(hookContent)
  })

  it('N2 — a leaf check script is still withheld too, unchanged by #2119', async () => {
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

  it('renders the "would regenerate" section for a pristine-stale always-rewrite file', async () => {
    // The regenerate bucket needs disk == baseline but ≠ the current render:
    // re-baseline the manifest onto the local content so provenance says
    // "pristine" (#2120 does not withhold it) while the render still differs.
    const local = '// pristine-stale: matches the baseline, not the template\n'
    writeFileSync(join(dir, ALWAYS_REWRITE), local)
    const manifest = loadGeneratedManifest(dir)
    manifest[ALWAYS_REWRITE] = createHash('sha256').update(local).digest('hex')
    saveGeneratedManifest(dir, manifest)

    const out = captureStdout()
    try {
      await runUpdate({ dir, github: false, adoptPlan: true })
    } finally {
      out.restore()
    }

    expect(out.text()).toContain('would regenerate')
    const section = out.text().slice(out.text().indexOf('would regenerate'))
    expect(section).toContain(ALWAYS_REWRITE)
    // Plan mode stays read-only.
    expect(readFileSync(join(dir, ALWAYS_REWRITE), 'utf-8')).toBe(local)
  })
})

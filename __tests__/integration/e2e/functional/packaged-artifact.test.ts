// SPDX-License-Identifier: Apache-2.0
// #1770 T8 — packaged-artifact E2E: prove the npm tarball works for an outsider.
//
// Simulates a real consumer end to end: `npm pack` this repo, install the TARBALL
// (never this repo's own dist/) into a fresh project, run `arbiter init` through
// the INSTALLED bin, assert the generated project's own L1 gate passes, then
// round-trip the task lifecycle (init → plan → red-team-review → red →
// record-red → green) through the installed CLI too.
//
// CANON-16 survey: virgin-init-matrix.test.ts (this dir) already runs
// `runGeneratedGate`/`initOverFixture`-style flows, but always in-process via
// `runInit()`/`runGenerators()` against the repo's own dist — never through a
// packaged tarball, and never exercises the task-lifecycle round-trip. The
// shared bits that DO transfer (the ts-library fixture, `initGit`/toolchain
// guards, `isOfflineFailure` classification) are reused from `../helpers.ts`
// (`initEmptyGit` was extracted there this task, see helpers.ts). The
// pack→install→invoke-through-bin flow and the task round-trip are new
// responsibilities with no existing helper to extend, so this is a new file.
//
// Reuses the `ts-library` fixture (via `stageFixture`) as the outsider's
// pre-existing TS scaffold: `arbiter init` never scaffolds the language layer
// itself (package.json/tsconfig/devDeps) — only the governance layer onto an
// existing project (#1321 finding) — so a hand-rolled "minimal package.json"
// would starve the generated gate of vitest/typescript and fail for a reason
// unrelated to packaging.
//
// Behind VITEST_L2=1 (nightly-tier, like its siblings): npm pack + two full
// npm installs + a full generated-project L1 gate run is not cheap.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hasBinary, isOfflineFailure, stageFixture } from '../helpers.js'

const L2 = process.env.VITEST_L2 === '1'
const REPO_ROOT = process.cwd()

type DepResult = { skip: string } | { ok: true }
type PackResult = { skip: string } | { tarball: string }

function npmPack(destDir: string): PackResult {
  const r = spawnSync('npm', ['pack', '--json', '--pack-destination', destDir], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    timeout: 180_000,
  })
  const out = (r.stdout ?? '') + (r.stderr ?? '')
  if (r.status !== 0) {
    if (isOfflineFailure(out)) return { skip: 'npm pack unavailable (offline)' }
    throw new Error(`npm pack failed (not offline):\n${out.slice(-2000)}`)
  }
  const parsed = JSON.parse(r.stdout) as Array<{ filename: string }>
  const filename = parsed[0]?.filename
  if (!filename) throw new Error(`npm pack --json produced no filename:\n${r.stdout}`)
  return { tarball: join(destDir, filename) }
}

function npmInstall(dir: string, extraArg?: string): DepResult {
  const args = ['install', '--no-audit', '--no-fund']
  if (extraArg) args.push(extraArg)
  const r = spawnSync('npm', args, { cwd: dir, encoding: 'utf-8', timeout: 300_000 })
  if (r.status === 0) return { ok: true }
  const out = (r.stdout ?? '') + (r.stderr ?? '')
  if (isOfflineFailure(out)) return { skip: 'npm install unavailable (offline)' }
  throw new Error(`npm install failed (not offline):\n${out.slice(-2000)}`)
}

function runGate(dir: string, level: 'L1' | 'L2'): { status: number; output: string } {
  const scriptPath = join(dir, 'scripts', 'check-all.mjs')
  if (!existsSync(scriptPath)) {
    return { status: 127, output: `check-all.mjs not generated at ${scriptPath}` }
  }
  const r = spawnSync('node', [scriptPath, level], {
    encoding: 'utf-8',
    cwd: dir,
    timeout: 240_000,
    env: { ...process.env, CI: 'true' },
  })
  return { status: r.status ?? 1, output: (r.stdout ?? '') + (r.stderr ?? '') }
}

// Run an `arbiter` subcommand through the tarball-INSTALLED bin — never this
// repo's own dist — so this test proves the PUBLISHED artifact works, not the
// working tree.
function runInstalledArbiter(
  dir: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): { status: number; output: string } {
  const bin = join(dir, 'node_modules', '.bin', 'arbiter')
  const r = spawnSync(bin, args, { cwd: dir, encoding: 'utf-8', timeout: 120_000, env })
  return { status: r.status ?? 1, output: (r.stdout ?? '') + (r.stderr ?? '') }
}

describe.skipIf(!L2)('packaged-artifact — outsider install E2E (#1770 T8)', () => {
  let packDir: string
  let projectDir: string

  beforeEach(() => {
    packDir = mkdtempSync(join(tmpdir(), 'arbiter-e2e-pack-'))
  })

  afterEach(() => {
    if (packDir != null) rmSync(packDir, { recursive: true, force: true })
    if (projectDir != null) rmSync(projectDir, { recursive: true, force: true })
  })

  it.skipIf(!hasBinary('npm') || !hasBinary('node'))(
    'npm-packaged tarball installs + arbiter init + L1 gate + red→green round-trip',
    () => {
      const pack = npmPack(packDir)
      if ('skip' in pack) {
        expect(pack.skip, 'npm pack unavailable — skipping outsider simulation').toBeTruthy()
        return
      }

      // Outsider's pre-existing TS project (arbiter init never scaffolds the
      // language layer itself — only the governance layer onto it, #1321).
      projectDir = stageFixture('ts-library')

      const install = npmInstall(projectDir, pack.tarball)
      if ('skip' in install) {
        expect(install.skip, 'npm install unavailable — skipping outsider simulation').toBeTruthy()
        return
      }

      // Prove the tarball actually installed arbiter's own bin (not a stale
      // global install / the repo's dist leaking in via PATH).
      expect(existsSync(join(projectDir, 'node_modules', '.bin', 'arbiter'))).toBe(true)

      const init = runInstalledArbiter(projectDir, [
        'init',
        '--yes',
        '--tools',
        'claude',
        '--level',
        'L2',
        '--language',
        'typescript',
        '--archetype',
        'library',
      ])
      expect(init.status, `arbiter init (installed) failed:\n${init.output.slice(-3000)}`).toBe(0)

      // arbiter init may have injected NEW devDependencies into package.json
      // (e.g. the TS gate toolchain's `injectTsGateToolchain`) that were absent
      // from the pre-existing fixture — a second install is required so the
      // generated gate's tools actually exist in node_modules (mirrors
      // virgin-init-matrix.test.ts's install-after-init ordering for TS cells).
      const postInitInstall = npmInstall(projectDir)
      if ('skip' in postInitInstall) {
        expect(
          postInitInstall.skip,
          'npm install (post-init) unavailable — skipping outsider simulation',
        ).toBeTruthy()
        return
      }

      execFileSync('git', ['add', '-A'], { cwd: projectDir, stdio: 'ignore' })
      execFileSync('git', ['commit', '-m', 'chore: post-init', '--no-verify'], {
        cwd: projectDir,
        stdio: 'ignore',
      })

      const gate = runGate(projectDir, 'L1')
      expect(
        gate.status,
        `generated project's own L1 gate did not execute:\n${gate.output.slice(-2000)}`,
      ).not.toBe(127)
      expect(
        gate.status,
        `generated project's own L1 gate failed:\n${gate.output.slice(-3000)}`,
      ).toBe(0)

      // ── Task round-trip, through the installed bin: init → plan →
      // red-team-review → red → record-red → green ──
      const taskId = '#9001'
      const taskInit = runInstalledArbiter(projectDir, ['task', 'init', '--id', taskId])
      expect(taskInit.status, `task init failed:\n${taskInit.output}`).toBe(0)

      // Strip CLAUDECODE so the handoff gate (red-team-review → red) takes its
      // deterministic inline (non-throwing) path — this test is a plain
      // subprocess, not an interactive Claude Code session.
      const noHandoffEnv = { ...process.env }
      delete noHandoffEnv.CLAUDECODE
      for (const phase of ['plan', 'red-team-review', 'red']) {
        const advance = runInstalledArbiter(
          projectDir,
          ['task', 'advance', '--to', phase],
          noHandoffEnv,
        )
        expect(advance.status, `advance --to ${phase} failed:\n${advance.output}`).toBe(0)
      }

      const testRelPath = 'src/e2e-red.test.ts'
      writeFileSync(
        join(projectDir, testRelPath),
        "import { expect, it } from 'vitest'\n" +
          "it('e2e red proof (#1770 T8)', () => {\n" +
          '  expect(1).toBe(2)\n' +
          '})\n',
      )
      execFileSync('git', ['add', '-A'], { cwd: projectDir, stdio: 'ignore' })
      execFileSync('git', ['commit', '-m', 'test: e2e red proof', '--no-verify'], {
        cwd: projectDir,
        stdio: 'ignore',
      })

      const recordRed = runInstalledArbiter(projectDir, [
        'task',
        'record-red',
        '--test-path',
        testRelPath,
      ])
      expect(recordRed.status, `record-red failed:\n${recordRed.output}`).toBe(0)

      const evidencePath = join(projectDir, '.arbiter', 'evidence', 'tdd', `${taskId}.json`)
      expect(existsSync(evidencePath), 'evidence file was not written').toBe(true)
      const evidence = JSON.parse(readFileSync(evidencePath, 'utf-8')) as {
        $schemaVersion: number
        task_id: string
        test_path: string
        test_commit_sha: string
      }
      expect(evidence.$schemaVersion).toBe(1)
      expect(evidence.task_id).toBe(taskId)
      expect(evidence.test_path).toBe(testRelPath)
      expect(/^[0-9a-f]{40}$/i.test(evidence.test_commit_sha)).toBe(true)

      const advanceGreen = runInstalledArbiter(projectDir, ['task', 'advance', '--to', 'green'])
      expect(advanceGreen.status, `advance --to green failed:\n${advanceGreen.output}`).toBe(0)
    },
    600_000,
  )
})

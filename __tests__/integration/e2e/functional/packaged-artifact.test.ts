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
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hasBinary, isOfflineFailure, stageFixture } from '../helpers.js'

const L2 = process.env.VITEST_L2 === '1'
const REPO_ROOT = process.cwd()

type DepResult = { skip: string } | { ok: true }
type PackResult = { skip: string } | { tarball: string }

// #2138: the release workflow packs ONCE and signs that tarball. When it points
// this variable at the packed artifact, every assertion below measures the exact
// bytes that get signed and published — never a fresh pack that merely resembles
// them. Set-but-missing is a hard error: a silent re-pack would reintroduce the
// artifact-identity bug this file exists to catch.
function prepackedTarball(): string | null {
  const provided = process.env.ARBITER_PACKED_TARBALL
  if (!provided) return null
  if (!existsSync(provided)) {
    throw new Error(`ARBITER_PACKED_TARBALL is set but the file does not exist: ${provided}`)
  }
  return provided
}

function npmPack(destDir: string, ignoreOverride = false): PackResult {
  const provided = ignoreOverride ? null : prepackedTarball()
  if (provided) return { tarball: provided }
  mkdirSync(destDir, { recursive: true })
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
    // stageFixture nests a fixed-name project dir under a random parent
    // (determinism for content hashing, see helpers.ts) — clean up the parent.
    if (projectDir != null) rmSync(dirname(projectDir), { recursive: true, force: true })
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

// ─── #2138/#2139: measure the artifact, do not assume it ─────────────────────
//
// The release pipeline was verified BY CONSTRUCTION — the workflow contained the
// right strings, so it was believed to sign what it publishes and to ship what it
// declares. Neither was measured. These tests measure both, over ONE tarball:
// the same bytes the release run signs (via ARBITER_PACKED_TARBALL) or a fresh
// `npm pack` when run locally/nightly.

type ExportTarget = { types?: string; import?: string }

function declaredExports(): Array<{ subpath: string; target: ExportTarget }> {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8')) as {
    name: string
    exports: Record<string, ExportTarget>
  }
  return Object.entries(pkg.exports).map(([subpath, target]) => ({ subpath, target }))
}

function packageName(): string {
  return (JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8')) as { name: string })
    .name
}

function sha256(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

describe.skipIf(!L2)('published package — signed bytes and declared surface (#2138/#2139)', () => {
  let workDir: string

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), 'arbiter-pkg-surface-'))
  })

  afterEach(() => {
    if (workDir != null) rmSync(workDir, { recursive: true, force: true })
  })

  // #2138: the design "pack in job A, sign it, publish that same file in job B"
  // is only sound if packing is reproducible — otherwise a rebuild anywhere in
  // the chain silently swaps the bytes, which is exactly the defect.
  it.skipIf(!hasBinary('npm'))(
    'npm pack is byte-reproducible (a rebuild cannot silently swap the artifact)',
    () => {
      const first = npmPack(join(workDir, 'a'), true)
      if ('skip' in first) {
        expect(first.skip).toBeTruthy()
        return
      }
      const second = npmPack(join(workDir, 'b'), true)
      if ('skip' in second) {
        expect(second.skip).toBeTruthy()
        return
      }
      expect(sha256(second.tarball)).toBe(sha256(first.tarball))
    },
    600_000,
  )

  // #2138 AC: the sha256 of the artifact we sign is the sha256 of the artifact
  // npm uploads. `npm publish <tarball>` reports the exact digests of the file it
  // would send — assert they are this file's digests, so signing this file and
  // publishing it cover the same bytes.
  it.skipIf(!hasBinary('npm'))(
    'npm publishes the signed tarball byte-for-byte (no repack between sign and publish)',
    () => {
      const pack = npmPack(join(workDir, 'pack'))
      if ('skip' in pack) {
        expect(pack.skip).toBeTruthy()
        return
      }
      const bytes = readFileSync(pack.tarball)
      const signedSha256 = createHash('sha256').update(bytes).digest('hex')

      const r = spawnSync(
        'npm',
        ['publish', '--dry-run', '--json', '--ignore-scripts', '--access', 'public', pack.tarball],
        { cwd: REPO_ROOT, encoding: 'utf-8', timeout: 300_000 },
      )
      const out = (r.stdout ?? '') + (r.stderr ?? '')
      if (r.status !== 0) {
        if (isOfflineFailure(out)) {
          expect(out, 'npm publish --dry-run unavailable (offline)').toBeTruthy()
          return
        }
        throw new Error(`npm publish --dry-run failed (not offline):\n${out.slice(-2000)}`)
      }
      const manifest = JSON.parse(r.stdout) as {
        size: number
        shasum: string
        integrity: string
        filename: string
      }

      expect(manifest.size).toBe(bytes.length)
      expect(manifest.shasum).toBe(createHash('sha1').update(bytes).digest('hex'))
      expect(manifest.integrity).toBe(
        `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
      )
      // The file we hashed is still the file on disk — nothing repacked it.
      expect(sha256(pack.tarball)).toBe(signedSha256)
    },
    600_000,
  )

  // #2139: every subpath the PACKAGE declares must import from the INSTALLED
  // package. Derived from package.json#exports — adding an export without a
  // working build target fails here, which a source-tree import never would.
  it.skipIf(!hasBinary('npm') || !hasBinary('node'))(
    'every declared exports subpath imports from the installed tarball',
    () => {
      const pack = npmPack(join(workDir, 'pack'))
      if ('skip' in pack) {
        expect(pack.skip).toBeTruthy()
        return
      }
      const consumer = join(workDir, 'consumer')
      mkdirSync(consumer, { recursive: true })
      writeFileSync(
        join(consumer, 'package.json'),
        JSON.stringify({ name: 'consumer', version: '1.0.0', private: true, type: 'module' }),
      )
      const install = npmInstall(consumer, pack.tarball)
      if ('skip' in install) {
        expect(install.skip).toBeTruthy()
        return
      }

      const name = packageName()
      const subpaths = declaredExports()
      expect(subpaths.length, 'package.json declares no exports').toBeGreaterThan(0)

      for (const { subpath, target } of subpaths) {
        const specifier = subpath === '.' ? name : `${name}${subpath.slice(1)}`

        // Resolution first, with no side effects: the exports map must point at a
        // file that the build actually emitted into the tarball. (`.` maps to the
        // CLI entrypoint, which RUNS on import — resolving it separately is the
        // only way to prove it shipped without executing it.)
        const resolved = spawnSync(
          'node',
          [
            '--input-type=module',
            '-e',
            `process.stdout.write('RESOLVED:' + import.meta.resolve(${JSON.stringify(specifier)}))`,
          ],
          { cwd: consumer, encoding: 'utf-8', timeout: 120_000 },
        )
        const resolveOut = (resolved.stdout ?? '') + (resolved.stderr ?? '')
        expect(
          resolved.status,
          `"${specifier}" does not resolve from the installed package:\n${resolveOut}`,
        ).toBe(0)
        const resolvedFile = fileURLToPath(
          resolveOut.slice(resolveOut.indexOf('RESOLVED:') + 'RESOLVED:'.length).trim(),
        )
        expect(existsSync(resolvedFile), `"${specifier}" resolves to a missing file`).toBe(true)

        // #2139 AC: the declared `types` entry must exist inside the tarball.
        const types = target.types
        expect(types, `exports["${subpath}"] declares no types entry`).toBeTruthy()
        const typesPath = join(
          consumer,
          'node_modules',
          name,
          (types as string).replace(/^\.\//, ''),
        )
        expect(existsSync(typesPath), `declared types missing from the package: ${types}`).toBe(true)

        // `.` is the CLI entrypoint: dist/cli.js runs `_main()` and exits on
        // import, and dist/cli.d.ts declares nothing. Assert it IS the bin the
        // package promises rather than pretending it is an importable library —
        // finding recorded under #2139 (docs/REFERENCE/api.md advertises `.` as
        // a stable API surface it is not).
        if (subpath === '.') {
          const bin = join(consumer, 'node_modules', name, 'dist', 'cli.js')
          expect(resolvedFile, 'root export is not the CLI entrypoint').toBe(bin)
          continue
        }

        const imported = spawnSync(
          'node',
          [
            '--input-type=module',
            '-e',
            `import * as m from ${JSON.stringify(specifier)}
             process.stdout.write('EXPORTS:' + JSON.stringify(Object.keys(m)))`,
          ],
          { cwd: consumer, encoding: 'utf-8', timeout: 120_000 },
        )
        const out = (imported.stdout ?? '') + (imported.stderr ?? '')
        expect(
          imported.status,
          `import "${specifier}" from the installed package failed:\n${out}`,
        ).toBe(0)
        const runtimeKeys = JSON.parse(
          out.slice(out.indexOf('EXPORTS:') + 'EXPORTS:'.length),
        ) as string[]

        // Expected symbols are DERIVED from the shipped .d.ts, never hand-listed:
        // every value the declaration promises must exist at runtime. (A types-only
        // entrypoint like ./plugin promises interfaces and no values — its runtime
        // module is legitimately `export {}`, but its declarations must be there.)
        const dts = readFileSync(typesPath, 'utf-8')
        const declaredValues = [
          ...dts.matchAll(/^export \{([^}]*)\}/gm),
          ...dts.matchAll(/^export declare (?:const|function|class|enum) (\w+)/gm),
        ].flatMap((m) =>
          (m[1] ?? '')
            .split(',')
            .map((s) => s.trim().split(/\s+as\s+/).pop()?.trim() ?? '')
            .filter(Boolean),
        )
        expect(
          dts.replace(/^export \{\};?$/m, '').includes('export'),
          `"${specifier}" ships a declaration file that declares nothing: ${types}`,
        ).toBe(true)
        for (const symbol of declaredValues) {
          expect(
            runtimeKeys,
            `"${specifier}" declares ${symbol} in ${types} but the installed module does not export it`,
          ).toContain(symbol)
        }
      }
    },
    900_000,
  )
})

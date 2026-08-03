// SPDX-License-Identifier: Apache-2.0
// Wave C3 (#1041) / #1042: functional harness — bake the fixture, then run the
// GENERATED project's own L1 gate inside the tmpdir. Asserts arbiter's generated
// governance actually gates the produced project (the core promise the framework
// makes to its users). Behind VITEST_L2=1 to keep pre-commit L1 fast; runs in the
// L2 integration suite gate entry (and the nightly `generated-gate-e2e` job).
//
// #1042 history: this harness was a blanket `it.skip` behind a CLOSED issue —
// "generator templates emit broken check-all.mjs references / a BDD test that
// breaks the default build". Those root causes are fixed (the BDD suites are now
// build-isolated: Go `//go:build bdd`, Rust `#![cfg(feature = "bdd")]`, Python
// `importorskip`; the go bdd gate-check SKIPs cleanly until godog is wired). The
// skip is replaced by an HONEST, readiness-gated assertion: every cell must EXECUTE
// the gate (no missing-module / exit 127 — the load-bearing #1041 guarantee), and
// must run GREEN where its dependencies are installable in the harness. A stack
// whose toolchain or deps are unavailable SKIPs WITH A REASON, never a false RED.
// Java un-skip (F4 / #1840): the last unconditional gap was cucumber/junit
// glue for the generated ExampleBddIT.java suite — closed by shipping an
// ExampleSteps.java step-definitions class alongside it (generators/behavioral-
// tests.ts) plus wiring the matching test deps into the java-library-gradle
// fixture's build.gradle (arbiter does not own/author a project's build.gradle,
// so this is fixture-owned, same as the fixture's other pre-existing test deps).
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runInit } from '../../../../src/commands/init.js'
import { isOfflineFailure, listFixtures, loadFixtureManifest, stageFixture } from '../helpers.js'

const L2 = process.env.VITEST_L2 === '1'

function hasBinary(bin: string): boolean {
  const r = spawnSync('which', [bin], { encoding: 'utf-8' })
  return r.status === 0 && r.stdout.trim().length > 0
}

// Required binaries the generated L1 gate shells out to, per language. A missing
// binary ⇒ SKIP-with-reason (absent toolchain ≠ false RED).
const CELL_BINARIES: Record<string, readonly string[]> = {
  typescript: ['node', 'npx'],
  go: ['go', 'gofmt', 'golangci-lint'],
  python: ['python3', 'ruff', 'pytest'],
  rust: ['cargo'],
  java: ['java'],
}

function toolchainSkipReason(language: string): string | null {
  const required = CELL_BINARIES[language] ?? ['node']
  const missing = required.filter((b) => !hasBinary(b))
  if (missing.length > 0) return `toolchain missing: ${missing.join(', ')}`
  return null
}

// Resolved dependency-install outcome. `pathPrefix` is a bin dir (e.g. a python venv's
// bin/) the generated gate must run with so it resolves the project-local toolchain.
type DepResult = { skip: string } | { ok: true; pathPrefix?: string }

// Install the project's own dependencies so the gate's unit/lint/typecheck checks can
// resolve them. Returns { skip } ONLY when the failure output proves it is a genuine
// network failure; any other install failure THROWS (the cell surfaces it as a hard
// RED) so a deterministic generated-output/harness defect can never masquerade as a
// skip or a green — the exact fake-green vector that let B5-class defects ship dark.
function installDeps(dir: string, language: string): DepResult {
  if (language === 'typescript') {
    const r = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 240_000,
    })
    if (r.status === 0) return { ok: true }
    const out = (r.stdout ?? '') + (r.stderr ?? '')
    if (isOfflineFailure(out)) return { skip: 'npm install unavailable (offline)' }
    throw new Error(`npm install failed (not offline):\n${out.slice(-2000)}`)
  }
  if (language === 'python') {
    // Install into an ISOLATED venv. A bare `pip install -e .` fails deterministically
    // on every PEP-668 externally-managed environment (Debian/Ubuntu default — incl.
    // the CI runner) with `externally-managed-environment`, which the old harness
    // silently laundered into a green so the python gate NEVER actually ran. A venv is
    // the canonical PEP-668-safe path and also makes the fixture package importable by
    // pytest; the gate's bare `pytest`/`ruff` then resolve to the venv via PATH.
    const venv = join(dir, '.venv')
    const mk = spawnSync('python3', ['-m', 'venv', venv], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 120_000,
    })
    if (mk.status !== 0) {
      const out = (mk.stdout ?? '') + (mk.stderr ?? '')
      if (isOfflineFailure(out)) return { skip: 'python venv creation unavailable (offline)' }
      throw new Error(`python venv creation failed (not offline):\n${out.slice(-2000)}`)
    }
    const venvBin = join(venv, 'bin')
    const venvPython = join(venvBin, 'python')
    const r = spawnSync(
      venvPython,
      ['-m', 'pip', 'install', '-e', '.', 'pytest', 'ruff', '--quiet'],
      {
        cwd: dir,
        encoding: 'utf-8',
        timeout: 240_000,
      },
    )
    if (r.status === 0) return { ok: true, pathPrefix: venvBin }
    const out = (r.stdout ?? '') + (r.stderr ?? '')
    if (isOfflineFailure(out)) return { skip: 'pip install unavailable (offline)' }
    throw new Error(`pip install -e . failed (not offline):\n${out.slice(-2000)}`)
  }
  // go/rust/java pull deps as part of their own build during the gate; nothing to
  // pre-install for the L1 fast gate (godog/cucumber BDD suites are build-isolated).
  return { ok: true }
}

function runGeneratedGate(dir: string, pathPrefix?: string): { status: number; output: string } {
  const scriptPath = join(dir, 'scripts', 'check-all.mjs')
  if (!existsSync(scriptPath)) {
    return { status: 127, output: `check-all.mjs not generated at ${scriptPath}` }
  }
  const env: NodeJS.ProcessEnv = { ...process.env, CI: 'true' }
  if (pathPrefix != null) env.PATH = `${pathPrefix}:${process.env.PATH ?? ''}`
  const r = spawnSync('node', [scriptPath, 'L1'], {
    encoding: 'utf-8',
    cwd: dir,
    timeout: 240_000,
    env,
  })
  return { status: r.status ?? 1, output: (r.stdout ?? '') + (r.stderr ?? '') }
}

function expectPortableTypeScriptToolchain(dir: string): void {
  const rollupManifest = join(dir, 'node_modules', 'rollup', 'package.json')
  if (!existsSync(rollupManifest)) return
  const rollupPackage = JSON.parse(readFileSync(rollupManifest, 'utf-8')) as { name?: string }
  expect(
    rollupPackage.name,
    'functional fixtures must use Rollup WASM so the gate runs across the supported glibc range',
  ).toBe('@rollup/wasm-node')
}

const fixtures = listFixtures('functional').sort()

describe.skipIf(!L2)('functional harness — generated L1 gate runs green (#1041/#1042)', () => {
  for (const fixture of fixtures) {
    const manifest = loadFixtureManifest(fixture)
    const language = manifest.language
    const skipReason = toolchainSkipReason(language)

    describe(`${fixture} (${language})`, () => {
      let dir: string

      beforeEach(() => {
        dir = stageFixture(fixture)
      })

      afterEach(() => {
        // stageFixture nests a fixed-name project dir under a random parent
        // (determinism for content hashing, see helpers.ts) — clean up the parent.
        if (dir != null) rmSync(dirname(dir), { recursive: true, force: true })
      })

      it.skipIf(skipReason != null)(
        `init → bake → execute generated L1 gate green`,
        async () => {
          await runInit({
            yes: true,
            tools: 'claude',
            level: 'L1',
            dir,
            dryRun: false,
            brownfield: false,
            noVerify: true,
            language: language as never,
            archetype: manifest.archetype as never,
          })

          // Re-commit fixture state after init so the generated gate sees a clean tree.
          execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
          execFileSync('git', ['commit', '-m', 'chore: post-init', '--no-verify'], {
            cwd: dir,
            stdio: 'ignore',
          })

          const dep = installDeps(dir, language)
          if ('skip' in dep) {
            // GENUINELY offline (network signature in install output) ⇒ SKIP rather than
            // false-RED. A deterministic install failure does NOT reach here — it throws
            // inside installDeps and fails the cell, so it can never be laundered green.
            expect(dep.skip, 'deps unavailable (offline) — skipping gate exec').toBeTruthy()
            return
          }
          if (language === 'typescript') expectPortableTypeScriptToolchain(dir)

          const result = runGeneratedGate(dir, dep.pathPrefix)
          // Load-bearing #1041/#1042 guarantee: the gate must EXECUTE — no missing
          // generated script (127) and no dangling generated module reference.
          expect(result.status, `gate did not execute:\n${result.output.slice(-2000)}`).not.toBe(
            127,
          )
          expect(result.output).not.toMatch(/Cannot find module/)
          // The generated BDD suites must NOT break the default build (the #1042
          // root cause): no unresolved cucumber/godog import cascading into the
          // unit/vet/lint checks.
          expect(result.output).not.toMatch(/no required module provides package.*godog/)
          expect(result.output).not.toMatch(/unresolved import `cucumber`/)
          // Green out of the box once deps are installed.
          expect(
            result.status,
            result.status === 0 ? '' : `generated L1 gate failed:\n${result.output.slice(-3000)}`,
          ).toBe(0)
        },
        240_000,
      )
    })
  }
})

// Day-1 regression net for #2193/#2194: these defects escaped because the
// functional fixture cells only emitted L1 and committed with --no-verify. This
// The generated L1 gate assertion requires network access for npm install and
// skips only on a genuine network failure; the two commit-smoke assertions run
// offline as well. It exercises L2 EMISSION through the generated L1 gate; it
// does not run the target's L2 gate, which additionally requires Docker/Playwright browsers.
describe.skipIf(!L2)('functional harness — day-1 L2 emission smoke (#2193/#2194)', () => {
  const fixture = 'ts-backend-web-db'
  const language = 'typescript'
  const skipReason = toolchainSkipReason(language)
  let dir: string
  let dep: DepResult

  beforeEach(async () => {
    dir = stageFixture(fixture)
    await runInit({
      yes: true,
      tools: 'claude',
      level: 'L2',
      dir,
      dryRun: false,
      brownfield: false,
      noVerify: true,
      language: 'typescript',
      archetype: 'backend-web-db',
    })
    execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
    execFileSync('git', ['commit', '-m', 'chore: post-init', '--no-verify'], {
      cwd: dir,
      stdio: 'ignore',
    })
    dep = installDeps(dir, language)
    if (!('skip' in dep)) expectPortableTypeScriptToolchain(dir)
  }, 240_000)

  afterEach(() => {
    if (dir != null) rmSync(dirname(dir), { recursive: true, force: true })
  })

  it.skipIf(skipReason != null)(
    'ts-backend-web-db: generated L1 gate passes after L2 init',
    () => {
      if ('skip' in dep) {
        expect(dep.skip, 'deps unavailable (offline) — skipping day-1 smoke').toBeTruthy()
        return
      }

      const result = runGeneratedGate(dir, dep.pathPrefix)
      expect(
        result.status,
        result.status === 0 ? '' : `generated L1 gate failed:\n${result.output.slice(-3000)}`,
      ).toBe(0)
    },
    240_000,
  )

  it.skipIf(skipReason != null)(
    'ts-backend-web-db: emitted commit-msg hook accepts valid and rejects malformed messages',
    () => {
      const msgFile = join(dir, '.git', 'day-1-commit-message')
      const hook = join(dir, '.githooks', 'commit-msg')
      writeFileSync(msgFile, 'chore: day-1 smoke\n')
      const valid = spawnSync('bash', [hook, msgFile], { cwd: dir, encoding: 'utf-8' })
      const validOutput = (valid.stdout ?? '') + (valid.stderr ?? '')
      expect(valid.status, `valid commit-msg hook failed:\n${validOutput}`).toBe(0)

      writeFileSync(msgFile, 'not a conventional message\n')
      const malformed = spawnSync('bash', [hook, msgFile], { cwd: dir, encoding: 'utf-8' })
      const malformedOutput = (malformed.stdout ?? '') + (malformed.stderr ?? '')
      expect(
        malformed.status ?? 1,
        `malformed commit message was accepted:\n${malformedOutput}`,
      ).not.toBe(0)
    },
    240_000,
  )

  it.skipIf(skipReason != null)(
    'ts-backend-web-db: a real conventional commit passes emitted githooks',
    () => {
      writeFileSync(join(dir, 'day-1-smoke.txt'), 'day-1 smoke\n')
      execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
      const commit = spawnSync('git', ['commit', '-m', 'chore: day-1 smoke'], {
        cwd: dir,
        encoding: 'utf-8',
      })
      const output = (commit.stdout ?? '') + (commit.stderr ?? '')
      expect(commit.status, `real commit failed:\n${output}`).toBe(0)
    },
    240_000,
  )
})

// B5 (arbiter audit, gate-thesis reliability) — red-path proof. Every cell
// above only proves the CLEAN fixture is green: green-only, the exact
// Beyoncé/broken-warnings gap the audit flags — a gate proven to pass never
// proves it can also FAIL. This reuses the SAME init -> bake -> install chain
// as the green cells above (the "catena intera generata"), then seeds one
// real violation and asserts the generated L1 gate's exit code goes non-zero
// — proof that the generated gate actually BLOCKS, not just that it runs.
describe.skipIf(!L2)(
  'functional harness — seeded violation turns the gate red (#1041/#1042, B5)',
  () => {
    const language = 'typescript'
    const skipReason = toolchainSkipReason(language)
    let dir: string

    beforeEach(() => {
      dir = stageFixture('ts-library')
    })

    afterEach(() => {
      if (dir != null) rmSync(dirname(dir), { recursive: true, force: true })
    })

    it.skipIf(skipReason != null)(
      'ts-library (typescript): a seeded type error makes the generated L1 gate exit non-zero',
      async () => {
        await runInit({
          yes: true,
          tools: 'claude',
          level: 'L1',
          dir,
          dryRun: false,
          brownfield: false,
          noVerify: true,
          language: 'typescript',
          archetype: 'library',
        })
        execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
        execFileSync('git', ['commit', '-m', 'chore: post-init', '--no-verify'], {
          cwd: dir,
          stdio: 'ignore',
        })

        const dep = installDeps(dir, language)
        if ('skip' in dep) {
          expect(dep.skip, 'deps unavailable (offline) — skipping gate exec').toBeTruthy()
          return
        }
        expectPortableTypeScriptToolchain(dir)

        // Seed the violation AFTER the clean init+install the green cell above
        // already proves passes: a deliberate type error (string assigned to a
        // number-typed const) that `tsc --noEmit` must reject regardless of
        // TypeScript version — no syntax breakage, so lint/format still parse
        // the file; only the typecheck check fires.
        writeFileSync(
          join(dir, 'src', 'index.ts'),
          readFileSync(join(dir, 'src', 'index.ts'), 'utf-8') +
            '\nconst _b5RedPathSeededViolation: number = "not-a-number"\n',
        )

        const result = runGeneratedGate(dir, dep.pathPrefix)
        expect(
          result.status,
          `seeded violation did not turn the gate red:\n${result.output.slice(-2000)}`,
        ).not.toBe(0)
        expect(result.output).toContain('[CHECK] typecheck ... FAIL')
      },
      240_000,
    )

    it.skipIf(skipReason != null)(
      'ts-library (typescript): a seeded AWS key makes the generated L1 gate exit non-zero',
      async () => {
        await runInit({
          yes: true,
          tools: 'claude',
          level: 'L1',
          dir,
          dryRun: false,
          brownfield: false,
          noVerify: true,
          language: 'typescript',
          archetype: 'library',
        })
        execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
        execFileSync('git', ['commit', '-m', 'chore: post-init', '--no-verify'], {
          cwd: dir,
          stdio: 'ignore',
        })

        const dep = installDeps(dir, language)
        if ('skip' in dep) {
          expect(dep.skip, 'deps unavailable (offline) — skipping gate exec').toBeTruthy()
          return
        }
        expectPortableTypeScriptToolchain(dir)

        writeFileSync(
          join(dir, 'src', 'leak.ts'),
          'export const _awsKey = "AKIAIOSFODNN7EXAMPLE";\n',
        )

        const result = runGeneratedGate(dir, dep.pathPrefix)
        expect(
          result.status,
          `seeded AWS key did not turn the gate red:\n${result.output.slice(-2000)}`,
        ).not.toBe(0)
        expect(result.output).toContain('[CHECK] secret scan ... FAIL')
      },
      240_000,
    )
  },
)

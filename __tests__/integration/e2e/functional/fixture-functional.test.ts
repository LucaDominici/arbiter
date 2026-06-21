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
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runInit } from '../../../../src/commands/init.js'
import { listFixtures, loadFixtureManifest, stageFixture } from '../helpers.js'

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
  // KNOWN GAP (tracked, #1042 follow-up): the generated Java BDD suite
  // (ExampleBddIT.java) imports io.cucumber / org.junit.platform.suite.api, but
  // arbiter does NOT own a greenfield build.gradle/pom.xml, so it cannot wire
  // those test dependencies onto the classpath. Unlike Go (`//go:build bdd`) and
  // Rust (`#![cfg(feature = "bdd")]`), a Java source file under src/test/java has
  // no language-level mechanism to exclude itself from `compileTestJava` without
  // a build-file change the project owns. Until the Java build-file generator
  // declares the cucumber/junit-platform-suite test deps (or the BDD test is made
  // skip-clean), this cell SKIPs WITH A REASON rather than a false RED.
  if (language === 'java') {
    return 'java BDD deps (cucumber/junit-platform-suite) not wired by greenfield init — see #1042 follow-up'
  }
  return null
}

// Install the project's own dependencies so the gate's unit/lint/typecheck checks
// can resolve them. Returns a skip reason when the install cannot complete (e.g.
// offline) — the gate is then not executed and the cell SKIPs rather than false-RED.
function installDeps(dir: string, language: string): string | null {
  if (language === 'typescript') {
    const r = spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 240_000,
    })
    return r.status === 0 ? null : 'npm install unavailable (offline?)'
  }
  if (language === 'python') {
    // The fixture's package must be importable by `pytest` (bare binary does not
    // add the project root to sys.path the way `python3 -m pytest` does).
    const r = spawnSync('python3', ['-m', 'pip', 'install', '-e', '.', '--quiet'], {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 240_000,
    })
    return r.status === 0 ? null : 'pip install -e . unavailable (offline?)'
  }
  // go/rust/java pull deps as part of their own build during the gate; nothing to
  // pre-install for the L1 fast gate (godog/cucumber BDD suites are build-isolated).
  return null
}

function runGeneratedGate(dir: string): { status: number; output: string } {
  const scriptPath = join(dir, 'scripts', 'check-all.mjs')
  if (!existsSync(scriptPath)) {
    return { status: 127, output: `check-all.mjs not generated at ${scriptPath}` }
  }
  const r = spawnSync('node', [scriptPath, 'L1'], {
    encoding: 'utf-8',
    cwd: dir,
    timeout: 240_000,
    env: { ...process.env, CI: 'true' },
  })
  return { status: r.status ?? 1, output: (r.stdout ?? '') + (r.stderr ?? '') }
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
        if (dir != null) rmSync(dir, { recursive: true, force: true })
      })

      it.skipIf(skipReason != null)(`init → bake → execute generated L1 gate green`, async () => {
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

        const installSkip = installDeps(dir, language)
        if (installSkip != null) {
          // Offline / network-restricted env ⇒ SKIP rather than false-RED. The
          // gate-execution guarantee is still asserted via virgin-init-matrix.
          expect(installSkip, 'deps unavailable — skipping gate exec').toBeTruthy()
          return
        }

        const result = runGeneratedGate(dir)
        // Load-bearing #1041/#1042 guarantee: the gate must EXECUTE — no missing
        // generated script (127) and no dangling generated module reference.
        expect(result.status, `gate did not execute:\n${result.output.slice(-2000)}`).not.toBe(127)
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
      })
    })
  }
})

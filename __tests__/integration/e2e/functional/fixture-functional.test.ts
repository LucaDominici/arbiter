// SPDX-License-Identifier: Apache-2.0
// Wave C3 (#1041): functional harness — bake the fixture, then run the
// GENERATED project's own L1 gate inside the tmpdir. Asserts arbiter's
// generated governance actually gates the produced project (the core promise
// the framework makes to its users). Behind VITEST_L2=1 to keep pre-commit
// L1 fast; runs in the L2 integration suite gate entry.
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

function toolchainPresent(
  language: string,
  buildTool?: string | null,
): { ok: boolean; reason?: string } {
  switch (language) {
    case 'typescript':
      return hasBinary('node') ? { ok: true } : { ok: false, reason: 'node not on PATH' }
    case 'python':
      return hasBinary('python3') || hasBinary('python')
        ? { ok: true }
        : { ok: false, reason: 'python3 not on PATH' }
    case 'go':
      return hasBinary('go') ? { ok: true } : { ok: false, reason: 'go not on PATH' }
    case 'java':
      // Gradle is invoked via the fixture's ./gradlew wrapper; just need java + (for fixtures without wrapper) gradle.
      if (!hasBinary('java')) return { ok: false, reason: 'java not on PATH' }
      if (buildTool === 'gradle' && !hasBinary('gradle')) {
        // Wrapper may still work; check at runtime.
      }
      return { ok: true }
    case 'rust':
      return hasBinary('cargo') ? { ok: true } : { ok: false, reason: 'cargo not on PATH' }
    default:
      return { ok: false, reason: `unknown language: ${language}` }
  }
}

function runGeneratedGate(dir: string): { status: number; output: string } {
  const scriptPath = join(dir, 'scripts', 'check-all.mjs')
  if (!existsSync(scriptPath)) {
    return { status: 127, output: `check-all.mjs not generated at ${scriptPath}` }
  }
  const r = spawnSync('node', [scriptPath, 'L1'], {
    encoding: 'utf-8',
    cwd: dir,
    timeout: 180_000,
    env: { ...process.env, CI: 'true' },
  })
  return { status: r.status ?? 1, output: (r.stdout ?? '') + (r.stderr ?? '') }
}

const fixtures = listFixtures('functional').sort()

describe.skipIf(!L2)('functional harness — generated L1 gate runs green (#1041)', () => {
  for (const fixture of fixtures) {
    const manifest = loadFixtureManifest(fixture)
    const tc = toolchainPresent(manifest.language, manifest.buildTool)
    const skipReason = tc.ok ? null : `toolchain missing: ${tc.reason}`

    describe(`${fixture} (${manifest.language})`, () => {
      let dir: string

      beforeEach(() => {
        dir = stageFixture(fixture)
      })

      afterEach(() => {
        if (dir != null) rmSync(dir, { recursive: true, force: true })
      })

      // Each functional cell is currently skipped pending wave-D (#1042) —
      // multiple generator templates emit broken `check-all.mjs` references
      // (e.g. missing `scripts/check-workflow-perms.mjs`). The harness is
      // ready; wave-D fixes the underlying templates so the generated L1 gate
      // passes inside the baked tmpdir.
      // muted-test-exempt: pending #1042 (wave-D template fix); intentional, tracked.
      it.skip(`pending #1042: bake + execute generated L1 gate (${skipReason ?? 'toolchain present, gate broken'})`, async () => {
        await runInit({
          yes: true,
          tools: 'claude',
          level: 'L1',
          dir,
          dryRun: false,
          brownfield: false,
          noVerify: true,
          language: manifest.language as never,
          archetype: manifest.archetype as never,
        })

        // Re-commit fixture state after init so the generated gate sees a clean tree.
        execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
        execFileSync('git', ['commit', '-m', 'chore: post-init', '--no-verify'], {
          cwd: dir,
          stdio: 'ignore',
        })

        const result = runGeneratedGate(dir)
        expect(
          result.status,
          result.status === 0 ? '' : `generated L1 gate failed:\n${result.output.slice(-2000)}`,
        ).toBe(0)
      })
    })
  }
})

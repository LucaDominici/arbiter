// SPDX-License-Identifier: Apache-2.0
// #2041 — declarative gate registry. RED tests: a gate's lane membership must be
// declarative (registry-driven, not hardcoded in the EJS ifs); L3 must be an
// executable LOCAL lane (no clamp); a layering contract test must be emitted
// into the consumer.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { renderTemplate } from '../../src/utils/render.js'
import { loadGateRegistry } from '../../src/generators/check-all.js'
import { makeConfig } from '../helpers.js'

function renderGate(data: Record<string, unknown>): string {
  return renderTemplate('scripts/check-all.mjs.ejs', data)
}

function runScript(
  scriptBody: string,
  args: string[],
): { status: number; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), 'gate-registry-'))
  try {
    writeFileSync(join(dir, 'check-all.mjs'), scriptBody, 'utf-8')
    // The emitted gate imports the helper trinity from ./lib/run-helpers.mjs —
    // render it alongside, exactly as the generator does.
    mkdirSync(join(dir, 'lib'), { recursive: true })
    writeFileSync(
      join(dir, 'lib', 'run-helpers.mjs'),
      renderTemplate('scripts/lib/run-helpers.mjs.ejs', {}),
      'utf-8',
    )
    // TypeScript + coverage-enabled renders the coverage-gate import as well.
    writeFileSync(
      join(dir, 'lib', 'coverage-gate.mjs'),
      renderTemplate('scripts/lib/coverage-gate.mjs.ejs', {
        projectName: 'test-project',
      }),
      'utf-8',
    )
    // Run from the fixture dir (a consumer runs the gate from its project root):
    // inline bodies read repo-local files (package.json, .github/workflows) and
    // must not observe the test runner's tree — nor hit the network.
    const r = spawnSync('node', [join(dir, 'check-all.mjs'), ...args], {
      cwd: dir,
      encoding: 'utf-8',
    })
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function baseData(dir: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  // Mirrors the enriched render data the generator builds (generateCheckAll):
  // coverageThreshold/coverageEnabled/mutationEnabled + the level booleans.
  const cfg = makeConfig(dir, {
    governanceLevel: 'L2',
    invariantTiers: ['architectural', 'governance', 'data', 'operational'],
    ...overrides,
  } as never) as unknown as Record<string, unknown>
  return {
    ...cfg,
    coverageThreshold: 80,
    coverageEnabled: true,
    mutationEnabled: true,
    isL2Plus: true,
    isL3Plus: false,
    isL4: false,
  }
}

describe('declarative gate registry (#2041)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gate-reg-fixture-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('AC-2041.2/4: a gate level declared in the registry drives its lane membership', () => {
    const data = baseData(dir)
    // The probe gate is declared at L2 in the registry data — it must run at L2
    // and be ABSENT from the L1 dry-run manifest. Today the level is hardcoded
    // in the EJS ifs and the gates data is ignored.
    const probe = {
      id: 'probe',
      name: 'probe gate',
      level: 'L2',
      kind: 'check',
      cmd: ['node', 'probe.mjs'],
    }
    const rendered = renderGate({ ...data, gates: [probe] })
    const l1 = runScript(rendered, ['--level', 'L1', '--dry-run'])
    expect(l1.stdout).not.toContain('probe gate')
    const l2 = runScript(rendered, ['--level', 'L2', '--dry-run'])
    expect(l2.stdout).toContain('probe gate')
  })

  it('AC-2041.1: L3 is an executable local lane — no clamp warning, L3 gates run', () => {
    // solo-reactivation (the L3 gate this proves runs) is trunk-solo/L3+-only
    // (#2222 emission-coherence fix) — the file it calls is only ever generated
    // for that combo (src/generators/solo-exception.ts), so exercise it here.
    const data = { ...baseData(dir), collaborationMode: 'trunk-solo', governanceLevel: 'L3' }
    const rendered = renderGate({ ...data, gates: loadGateRegistry({ ...data }) })
    const l3 = runScript(rendered, ['--level', 'L3', '--dry-run'])
    expect(l3.stderr).not.toContain('clamps to L2')
    expect(l3.stdout).toContain('solo reactivation')
  })

  // #2258: table-driven across arbiter's live-consumer languages — a TS-only
  // fixture data set masked the bug (nightly-audit-prod is the one L3 gate
  // that doesn't require isL3Plus), so go @ L2/trunk-solo emitted ZERO L3
  // gates and this same contract test FAILED "L3 lane declares zero gates"
  // for that cell. Spawns the actual emitted test-gate-layering.mjs against
  // the actual emitted registry — the production oracle, not a registry-shape
  // proxy.
  it.each([
    { language: 'typescript' },
    { language: 'go' },
    { language: 'rust' },
    { language: 'python' },
    { language: 'java', buildTool: 'gradle' },
    { language: 'java', buildTool: 'maven' },
    { language: 'kotlin', buildTool: 'gradle' },
  ] as const)(
    'AC-2041.3: a layering contract test is emitted for consumers ($language @ L2, trunk-solo)',
    ({ language, ...overrides }) => {
      const data = baseData(dir, { language, collaborationMode: 'trunk-solo', ...overrides })
      const registry = loadGateRegistry({ ...data })
      // The emitted test asserts L1 ⊂ L2 ⊂ L3 membership from the registry.
      const rendered = renderTemplate('scripts/test-gate-layering.mjs.ejs', data)
      expect(rendered).toMatch(/L1/)
      const scriptDir = mkdtempSync(join(tmpdir(), 'gate-layering-'))
      try {
        writeFileSync(join(scriptDir, 'test-gate-layering.mjs'), rendered, 'utf-8')
        mkdirSync(join(scriptDir, 'scripts'), { recursive: true })
        writeFileSync(
          join(scriptDir, 'scripts', 'check-all.mjs'),
          renderGate({ ...data, gates: registry }),
          'utf-8',
        )
        const r = spawnSync('node', [join(scriptDir, 'test-gate-layering.mjs')], {
          cwd: scriptDir,
          encoding: 'utf-8',
        })
        expect(r.status, r.stdout + r.stderr).toBe(0)
      } finally {
        rmSync(scriptDir, { recursive: true, force: true })
      }
    },
  )

  it.each([
    {
      buildTool: 'gradle',
      expected: ['./gradlew', 'build -q'],
    },
    {
      buildTool: 'maven',
      expected: ['mvn', 'verify -q'],
    },
  ] as const)('Java L3 lifecycle uses the full $buildTool lifecycle', ({ buildTool, expected }) => {
    const registry = loadGateRegistry(baseData(dir, { language: 'java', buildTool }))
    expect(registry.find((gate) => gate.id === 'java-lifecycle')?.cmd).toEqual(expected)
  })

  it('Kotlin L3 fixture owns an executable Gradle wrapper', () => {
    const fixture = resolve('__tests__/fixtures/real-projects/kotlin-backend-web-db-gradle')
    const wrapper = join(fixture, 'gradle', 'wrapper')
    const gradlew = join(fixture, 'gradlew')

    expect(existsSync(join(wrapper, 'gradle-wrapper.jar'))).toBe(true)
    expect(existsSync(join(wrapper, 'gradle-wrapper.properties'))).toBe(true)
    expect(statSync(gradlew).mode & 0o111).not.toBe(0)
    expect(readFileSync(gradlew, 'utf-8')).toContain('org.gradle.wrapper.GradleWrapperMain')
  })
})

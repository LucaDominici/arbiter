// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { generateAntiDriftValidators } from '../../src/generators/anti-drift-validators.js'
import { runGenerators } from '../../src/commands/init.js'
import type { ProjectConfig } from '../../src/wizard/types.js'
import { makeConfig } from '../helpers.js'

describe('generateAntiDriftValidators (INV-89, W6+F4)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-adv-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // #1318.2: anti-drift no longer double-emits the 4 always-on-owned scripts
  // (check-ssot-core/check-exit-code-contract/check-suppressions/
  // check-inline-suppressions). The github-owned 3 are now conditional-fallback
  // (emitted only when github-setup is disabled). makeConfig default is L2 +
  // useGitHub:false ⇒ github-setup disabled ⇒ anti-drift emits the github-3.
  // Total: 12 W6 + 4 F4 (validator-helptext + the 3 github fallbacks) = 16.
  // #1497: check-secret-presence added to the W6 dual-track batch (11 → 12).
  // #1497 A3: check-continue-on-error added to the W6 dual-track batch (12 → 13).
  // #1497 A2: check-min-test-execution added to the W6 Track-B-only batch (2 → 3 ⇒ total 17 → 18).
  it('emits 18 scripts total at L2/github-off (13 W6-dual + 3 W6-trackB + 4 F4)', () => {
    const result = generateAntiDriftValidators(makeConfig(dir))
    expect(result.files).toHaveLength(18)
  })

  // #1318.2: the 4 always-on-owned scripts are NEVER emitted by anti-drift —
  // their dedicated owners (ssot/self-validation/suppressions) always run.
  it('does NOT emit the 4 always-on-owned scripts (#1318.2 double-write fix)', () => {
    const paths = generateAntiDriftValidators(makeConfig(dir)).files.map((f) => f.path)
    for (const dropped of [
      'check-ssot-core.mjs',
      'check-exit-code-contract.mjs',
      'check-suppressions.mjs',
      'check-inline-suppressions.mjs',
    ]) {
      expect(paths.some((p) => p.endsWith(dropped))).toBe(false)
    }
  })

  it('does NOT emit check-pii-scan (duplicate of native pii-scan) or check-tier-coverage (arbiter-self meta-gate) (#1152)', () => {
    const paths = generateAntiDriftValidators(makeConfig(dir)).files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('check-pii-scan.mjs'))).toBe(false)
    expect(paths.some((p) => p.endsWith('check-tier-coverage.mjs'))).toBe(false)
  })

  it('emits all W6 script paths', () => {
    const result = generateAntiDriftValidators(makeConfig(dir))
    const paths = result.files.map((f) => f.path)
    const expected = [
      'check-suppression-rationale.mjs',
      'check-suppression-expiry.mjs',
      'check-secret-scan.mjs',
      'check-drift.mjs',
      'check-workflow-runners.mjs',
      'check-workflow-docs-sync.mjs',
      'check-workflow-test-integrity.mjs',
      'check-secret-presence.mjs',
      'check-continue-on-error.mjs',
      'check-pr-size-gate.mjs',
      'check-claude-md-lint.mjs',
      'check-workflow-sha-pinning.mjs',
      'check-workflow-job-naming.mjs',
    ]
    for (const name of expected) {
      expect(paths.some((p) => p.endsWith(name))).toBe(true)
    }
  })

  it('emits check-claude-md-lint.mjs as a dual-track context-file linter (#1266)', () => {
    const paths = generateAntiDriftValidators(makeConfig(dir)).files.map((f) => f.path)
    expect(paths.some((p) => p.endsWith('check-claude-md-lint.mjs'))).toBe(true)
    const content = readFileSync(join(dir, 'scripts', 'check-claude-md-lint.mjs'), 'utf-8')
    expect(content).toMatch(/^#!/)
    expect(content).toContain('--help')
    expect(content).toContain('INV-89')
    expect(content).not.toContain('<%')
    expect(content).not.toContain('%>')
  })

  // #1318.2: at L2/github-off (makeConfig default), github-setup is disabled, so
  // anti-drift emits the 3 github-owned fallbacks + the always-anti-drift-owned
  // validator-helptext. The 4 always-on-owned scripts are no longer emitted here.
  it('emits the surviving F4 script paths at L2/github-off (fallback github-3 + helptext)', () => {
    const result = generateAntiDriftValidators(makeConfig(dir))
    const paths = result.files.map((f) => f.path)
    const f4Expected = [
      'check-validator-helptext.mjs',
      'check-action-pins.mjs',
      'check-workflow-perms.mjs',
      'check-ci-tiers.mjs',
    ]
    for (const name of f4Expected) {
      expect(paths.some((p) => p.endsWith(name))).toBe(true)
    }
  })

  it('all emitted files have action=created on first call', () => {
    const result = generateAntiDriftValidators(makeConfig(dir))
    expect(result.files.every((f) => f.action === 'created')).toBe(true)
  })

  it('is idempotent (skipIfExists on second call)', () => {
    generateAntiDriftValidators(makeConfig(dir))
    const result2 = generateAntiDriftValidators(makeConfig(dir))
    expect(result2.files.every((f) => f.action === 'skipped')).toBe(true)
  })

  it('each emitted script has a shebang line', () => {
    generateAntiDriftValidators(makeConfig(dir))
    for (const name of [
      'check-suppression-rationale.mjs',
      'check-drift.mjs',
      'check-workflow-sha-pinning.mjs',
    ]) {
      const content = readFileSync(join(dir, 'scripts', name), 'utf-8')
      expect(content).toMatch(/^#!/)
    }
  })

  it('each emitted script contains --help support', () => {
    generateAntiDriftValidators(makeConfig(dir))
    for (const name of [
      'check-suppression-rationale.mjs',
      'check-suppression-expiry.mjs',
      'check-secret-scan.mjs',
      'check-drift.mjs',
      'check-workflow-runners.mjs',
      'check-workflow-docs-sync.mjs',
      'check-workflow-test-integrity.mjs',
      'check-secret-presence.mjs',
      'check-continue-on-error.mjs',
      'check-pr-size-gate.mjs',
      'check-workflow-sha-pinning.mjs',
      'check-workflow-job-naming.mjs',
      'check-validator-helptext.mjs',
      'check-action-pins.mjs',
      'check-workflow-perms.mjs',
      'check-ci-tiers.mjs',
    ]) {
      const content = readFileSync(join(dir, 'scripts', name), 'utf-8')
      expect(content).toContain('--help')
    }
  })

  it('each emitted script cites INV-89', () => {
    generateAntiDriftValidators(makeConfig(dir))
    for (const name of [
      'check-suppression-rationale.mjs',
      'check-secret-scan.mjs',
      'check-workflow-sha-pinning.mjs',
    ]) {
      const content = readFileSync(join(dir, 'scripts', name), 'utf-8')
      expect(content).toContain('INV-89')
    }
  })

  it('check-suppression-rationale: skips when no suppressions/ dir', () => {
    generateAntiDriftValidators(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'check-suppression-rationale.mjs'), 'utf-8')
    expect(content).toContain('SKIP')
    expect(content).toContain('suppressions/')
  })

  it('check-drift: skips when no drift manifest', () => {
    generateAntiDriftValidators(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'check-drift.mjs'), 'utf-8')
    expect(content).toContain('SKIP')
    expect(content).toContain('drift-manifest.json')
  })

  it('check-workflow-sha-pinning: validates 40-char hex SHA references', () => {
    generateAntiDriftValidators(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'check-workflow-sha-pinning.mjs'), 'utf-8')
    expect(content).toContain('[0-9a-f]{40}')
  })

  it('check-workflow-job-naming: validates name: field presence', () => {
    generateAntiDriftValidators(makeConfig(dir))
    const content = readFileSync(join(dir, 'scripts', 'check-workflow-job-naming.mjs'), 'utf-8')
    expect(content).toContain('name:')
    expect(content).toContain('has no name: field')
  })

  // RED test: registry integration (#1148 Slice C)
  it('buildRegistry includes anti-drift-validators spec [WIRING #1148]', async () => {
    const { buildRegistry } = await import('../../src/generators/registry.js')
    const specs = buildRegistry(makeConfig(dir))
    const spec = specs.find((s) => s.key === 'anti-drift-validators')
    expect(spec).toBeDefined()
    expect(spec?.enabled).toBe(true)
  })

  // #1152: every emitted anti-drift script MUST be wired into the generated
  // target check-all.mjs.ejs — otherwise it is dead weight giving a false
  // 'covered' signal. This locks emission and wiring in lockstep.
  it('every emitted anti-drift script is wired in the target check-all template (#1152)', () => {
    const template = readFileSync(resolve('src/templates/scripts/check-all.mjs.ejs'), 'utf-8')
    const emitted = generateAntiDriftValidators(makeConfig(dir)).files.map((f) =>
      f.path.split('/').pop(),
    )
    const unwired = emitted.filter((name) => name && !template.includes(`scripts/${name}`))
    expect(unwired).toEqual([])
  })

  it('no EJS tag leaks in any emitted script', () => {
    generateAntiDriftValidators(makeConfig(dir))
    for (const name of [
      'check-suppression-rationale.mjs',
      'check-suppression-expiry.mjs',
      'check-secret-scan.mjs',
      'check-drift.mjs',
      'check-workflow-runners.mjs',
      'check-workflow-docs-sync.mjs',
      'check-workflow-test-integrity.mjs',
      'check-secret-presence.mjs',
      'check-continue-on-error.mjs',
      'check-pr-size-gate.mjs',
      'check-workflow-sha-pinning.mjs',
      'check-workflow-job-naming.mjs',
      'check-validator-helptext.mjs',
      'check-action-pins.mjs',
      'check-workflow-perms.mjs',
      'check-ci-tiers.mjs',
    ]) {
      const content = readFileSync(join(dir, 'scripts', name), 'utf-8')
      expect(content).not.toContain('<%')
      expect(content).not.toContain('%>')
    }
  })
})

// ─── #1318.2: cross-generator exactly-once emission ──────────────────────────
// The double-write "N file(s) already exist" noise on virgin multi-lane init
// came from anti-drift AND the dedicated owner BOTH writing the same path. The
// root-cause fix makes anti-drift drop the 4 always-on-owned scripts entirely
// and emit the 3 github-owned scripts only as a fallback (when github-setup is
// disabled). This block proves exactly-once emission across the governance ×
// github matrix via the FULL registry (runGenerators), which is the only place
// the cross-generator collision is observable.
describe('anti-drift × owner exactly-once emission (#1318.2)', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arbiter-adv-xgen-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  // The 7 scripts that anti-drift used to double-emit with another generator.
  const GITHUB_OWNED = ['check-ci-tiers', 'check-action-pins', 'check-workflow-perms'] as const
  const ALWAYS_OWNED = [
    'check-ssot-core',
    'check-exit-code-contract',
    'check-suppressions',
    'check-inline-suppressions',
  ] as const
  const SHARED_SEVEN = [...GITHUB_OWNED, ...ALWAYS_OWNED] as const

  function emissionCount(config: ProjectConfig, script: string): number {
    return runGenerators(config).filter((f) => f.path.endsWith(`/${script}.mjs`)).length
  }

  // github-setup spec is enabled ⇔ (permitGitHub ?? useGitHub) && level !== 'L1'.
  // So github-3 has a dedicated owner exactly in {L2,L3} × github-on.
  // self-validation spec is enabled ⇔ enableSelfValidationHarness !== false
  // (registry.ts). So check-exit-code-contract has a dedicated owner only when
  // selfVal !== false; when selfVal === false anti-drift MUST be the fallback
  // emitter (else check-all.mjs:137 calls a missing module ⇒ MODULE_NOT_FOUND).
  const matrix: Array<{ level: 'L1' | 'L2' | 'L3'; github: boolean; selfVal: boolean }> = [
    { level: 'L1', github: true, selfVal: true },
    { level: 'L1', github: false, selfVal: true },
    { level: 'L2', github: true, selfVal: true },
    { level: 'L2', github: false, selfVal: true },
    { level: 'L3', github: true, selfVal: true },
    { level: 'L3', github: false, selfVal: true },
    // #1318: selfVal=false ⇒ self-validation disabled ⇒ anti-drift is the SOLE
    // emitter of check-exit-code-contract (fallback). Without the fix these RED.
    { level: 'L1', github: true, selfVal: false },
    { level: 'L1', github: false, selfVal: false },
    { level: 'L2', github: true, selfVal: false },
    { level: 'L2', github: false, selfVal: false },
    { level: 'L3', github: true, selfVal: false },
    { level: 'L3', github: false, selfVal: false },
  ]

  for (const cell of matrix) {
    it(`emits each of the 7 shared scripts exactly once — L=${cell.level} github=${cell.github} selfVal=${cell.selfVal}`, () => {
      const config = makeConfig(dir, {
        governanceLevel: cell.level,
        useGitHub: cell.github,
        permitGitHub: cell.github,
        githubOwner: cell.github ? 'acme' : null,
        githubRepo: cell.github ? 'demo' : null,
        enableSelfValidationHarness: cell.selfVal,
      })
      for (const script of SHARED_SEVEN) {
        expect(
          emissionCount(config, script),
          `${script} must be emitted exactly once at L=${cell.level} github=${cell.github} selfVal=${cell.selfVal}`,
        ).toBe(1)
      }
    })
  }
})
